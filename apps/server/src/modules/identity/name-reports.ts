import { newId, type Db, type Tx } from '@rdw/db';
import { DAY_MS } from '@rdw/protocol';
import { sql } from 'kysely';
import { gameNow, intervalMs } from '../../infra/clock.ts';
import { ApiError } from '../../infra/errors.ts';

/**
 * Namen melden (O-48, ADR-086). Wer mit jemandem in einer Partie sitzt, kann dessen Namen melden.
 * Die Meldung hält den Namen fest, wie er da stand. Die Spielleitung sieht offene Meldungen mit
 * `pnpm account:name-reports` und gibt einen Namen frei oder sperrt ihn. Sie benennt niemanden
 * selbst um (Entscheidung zu O-48): Ein gesperrter Name ist für alle gesperrt, und sein Träger
 * wählt sich selbst einen neuen, bevor er wieder eine Partie eröffnet oder einer beitritt.
 */

/** Höchstens so viele Meldungen je Spieler in 24 Stunden [E]. */
export const NAME_REPORTS_PER_DAY = 20;

/**
 * Meldet den Namen des Spielers auf `joinOrder`. Eine zweite offene Meldung desselben Kontos durch
 * denselben Spieler ändert nichts. Liefert den gemeldeten Namen.
 */
export async function reportPlayerName(
  tx: Tx,
  input: { readonly reporterId: string; readonly matchId: string; readonly joinOrder: number },
): Promise<string> {
  const seats = await tx
    .selectFrom('match_players as p')
    .leftJoin('player_profiles as pp', 'pp.user_id', 'p.user_id')
    .select(['p.join_order', 'p.user_id', 'pp.display_name'])
    .where('p.match_id', '=', input.matchId)
    .execute();
  if (!seats.some((seat) => seat.user_id === input.reporterId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Partie nicht gefunden');
  }
  const target = seats.find((seat) => seat.join_order === input.joinOrder);
  if (
    !target ||
    target.user_id === null ||
    target.user_id === input.reporterId ||
    target.display_name === null
  ) {
    throw new ApiError(422, 'NOT_REPORTABLE', 'Diesen Namen kann man nicht melden');
  }
  const open = await tx
    .selectFrom('name_reports')
    .select('id')
    .where('reporter_user_id', '=', input.reporterId)
    .where('reported_user_id', '=', target.user_id)
    .where('status', '=', 'OPEN')
    .executeTakeFirst();
  if (open) return target.display_name;
  const today = await tx
    .selectFrom('name_reports')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('reporter_user_id', '=', input.reporterId)
    .where(sql<boolean>`created_at > game_now() - ${intervalMs(DAY_MS)}`)
    .executeTakeFirstOrThrow();
  if (today.n >= NAME_REPORTS_PER_DAY) {
    throw new ApiError(429, 'RATE_LIMITED', 'Zu viele Meldungen heute', {
      retryAfterMs: DAY_MS,
    });
  }
  await tx
    .insertInto('name_reports')
    .values({
      id: newId(),
      reporter_user_id: input.reporterId,
      reported_user_id: target.user_id,
      reported_name: target.display_name,
      match_id: input.matchId,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  return target.display_name;
}

/** Offene Meldungen je Konto, für die Spielleitung. */
export interface OpenNameReport {
  readonly userId: string;
  /** Name jetzt; `null`, wenn das Konto keinen mehr hat. */
  readonly currentName: string | null;
  /** Gemeldete Namen (verschieden), älteste zuerst. */
  readonly reportedNames: readonly string[];
  readonly reporters: number;
  readonly firstAt: Date;
  readonly lastAt: Date;
  readonly blocked: boolean;
}

export async function listOpenNameReports(db: Db): Promise<OpenNameReport[]> {
  const rows = await db
    .selectFrom('name_reports as r')
    .leftJoin('player_profiles as p', 'p.user_id', 'r.reported_user_id')
    .select([
      'r.reported_user_id',
      'p.display_name',
      'p.name_blocked_at',
      sql<string[]>`array_agg(distinct r.reported_name)`.as('names'),
      sql<number>`count(distinct r.reporter_user_id)::int`.as('reporters'),
      sql<Date>`min(r.created_at)`.as('first_at'),
      sql<Date>`max(r.created_at)`.as('last_at'),
    ])
    .where('r.status', '=', 'OPEN')
    .groupBy(['r.reported_user_id', 'p.display_name', 'p.name_blocked_at'])
    .orderBy(sql`count(distinct r.reporter_user_id)`, 'desc')
    .orderBy(sql`min(r.created_at)`)
    .execute();
  return rows.map((row) => ({
    userId: row.reported_user_id,
    currentName: row.display_name,
    reportedNames: [...row.names].sort(),
    reporters: row.reporters,
    firstAt: row.first_at,
    lastAt: row.last_at,
    blocked: row.name_blocked_at !== null,
  }));
}

/**
 * Konto zu einem Namen, in jeder Schreibweise: zuerst der Spielername von jetzt, sonst ein Name aus
 * einer offenen Meldung (der Spieler hat sich inzwischen umbenannt).
 */
async function accountByName(tx: Tx, name: string): Promise<string | null> {
  const current = await tx
    .selectFrom('player_profiles')
    .select('user_id')
    .where(sql<boolean>`player_name_key(display_name) = player_name_key(${name})`)
    .executeTakeFirst();
  if (current) return current.user_id;
  const reported = await tx
    .selectFrom('name_reports')
    .select('reported_user_id')
    .where('status', '=', 'OPEN')
    .where(sql<boolean>`player_name_key(reported_name) = player_name_key(${name})`)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  return reported?.reported_user_id ?? null;
}

export type NameDecision = 'BLOCK' | 'DISMISS';

export interface NameDecisionResult {
  /** Gesperrte Namen (bei `BLOCK`): die gemeldeten Namen des Kontos. */
  readonly blockedNames: readonly string[];
  /** Muss der Spieler sich jetzt einen neuen Namen geben? */
  readonly mustRename: boolean;
  readonly resolved: number;
}

/**
 * Entscheidung der Spielleitung zu einem gemeldeten Konto. `BLOCK`: Die gemeldeten Namen kommen
 * auf die Sperrliste; trägt das Konto einen davon noch, muss es sich einen neuen geben. `DISMISS`:
 * Der Name bleibt. Beides erledigt die offenen Meldungen gegen das Konto. `null`, wenn es zu dem
 * Namen kein Konto mit offener Meldung gibt.
 */
export async function decideName(
  db: Db,
  name: string,
  decision: NameDecision,
): Promise<NameDecisionResult | null> {
  return db.transaction().execute(async (tx) => {
    const userId = await accountByName(tx, name);
    if (userId === null) return null;
    await tx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().execute();
    const reports = await tx
      .selectFrom('name_reports')
      .select(['reported_name', sql<string>`player_name_key(reported_name)`.as('key')])
      .where('reported_user_id', '=', userId)
      .where('status', '=', 'OPEN')
      .execute();
    if (reports.length === 0) return null;
    let blockedNames: string[] = [];
    let mustRename = false;
    if (decision === 'BLOCK') {
      const byKey = new Map(reports.map((r) => [r.key, r.reported_name]));
      blockedNames = [...byKey.values()].sort();
      for (const [key, blocked] of byKey) {
        await tx
          .insertInto('blocked_names')
          .values({ name_key: key, name: blocked })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
      const profile = await tx
        .selectFrom('player_profiles')
        .select(sql<string>`player_name_key(display_name)`.as('key'))
        .where('user_id', '=', userId)
        .executeTakeFirst();
      mustRename = profile !== undefined && byKey.has(profile.key);
      if (mustRename) {
        await tx
          .updateTable('player_profiles')
          .set({ name_blocked_at: gameNow })
          .where('user_id', '=', userId)
          .execute();
      }
    }
    const resolved = await tx
      .updateTable('name_reports')
      .set({ status: decision === 'BLOCK' ? 'BLOCKED' : 'DISMISSED', resolved_at: gameNow })
      .where('reported_user_id', '=', userId)
      .where('status', '=', 'OPEN')
      .executeTakeFirst();
    return { blockedNames, mustRename, resolved: Number(resolved.numUpdatedRows) };
  });
}

/** Muss das Konto erst einen neuen Namen wählen? Dann keine neue Partie (`NAME_BLOCKED`). */
export async function assertNameNotBlocked(db: Db | Tx, userId: string): Promise<void> {
  const row = await db
    .selectFrom('player_profiles')
    .select('name_blocked_at')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (row?.name_blocked_at) {
    throw new ApiError(409, 'NAME_BLOCKED', 'Bitte zuerst einen neuen Namen wählen');
  }
}
