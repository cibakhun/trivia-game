import type { Db } from '@rdw/db';
import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'kysely';
import { readGameNow } from '../../infra/clock.ts';
import type { MatchContext } from './context.ts';
import { expireLobbies } from './lobby.ts';
import { openRun } from './runs.ts';
import { loadMatch, loadPlayers } from './store.ts';

/**
 * Ablaufsteuerung der Partien (ADR-049): arbeitet fällige Fristen laufender Partien ab (Wahl nach
 * Zeitablauf, Auflösung, Ende der Anzeige, Ende der Rüstzeit) und lässt verwaiste Aufstellungen verfallen. Bis zum
 * Worker-Prozess läuft sie im api-Prozess, etwa zweimal je Sekunde; Lesen und Antworten holen
 * fällige Schritte zusätzlich sofort nach. Alles steht in der Datenbank, ein Neustart verliert
 * nichts: Nach dem Hochfahren arbeitet der erste Lauf auf, was in der Zwischenzeit fällig wurde.
 */

export type AdvanceOutcome = 'ADVANCED' | 'NOT_DUE' | 'BUSY';

/**
 * Arbeitet die fälligen Fristen einer Partie ab. Mit `skipLocked` überspringt der Lauf eine
 * Partie, die gerade jemand anders bearbeitet (`BUSY`).
 */
export async function advanceMatch(
  db: Db,
  ctx: MatchContext,
  matchId: string,
  options: { readonly skipLocked?: boolean } = {},
): Promise<AdvanceOutcome> {
  return db.transaction().execute(async (tx) => {
    const match = await loadMatch(tx, matchId, {
      lock: options.skipLocked ? 'UPDATE_SKIP_LOCKED' : 'UPDATE',
    });
    if (!match) return options.skipLocked ? 'BUSY' : 'NOT_DUE';
    const now = await readGameNow(tx);
    if (
      match.status !== 'RUNNING' ||
      match.phaseDeadlineAt === null ||
      match.phaseDeadlineAt.getTime() > now.getTime()
    ) {
      return 'NOT_DUE';
    }
    const run = openRun(tx, ctx, match, await loadPlayers(tx, matchId), now);
    await run.advanceDue();
    await run.commit();
    return 'ADVANCED';
  });
}

/** Ist die Partie fällig? Ohne Sperre; spart Lesern die Transaktion. */
export async function isMatchDue(db: Db, matchId: string): Promise<boolean> {
  const row = await db
    .selectFrom('matches')
    .select('id')
    .where('id', '=', matchId)
    .where('status', '=', 'RUNNING')
    .where('phase_deadline_at', '<=', sql<Date>`game_now()`)
    .executeTakeFirst();
  return row !== undefined;
}

/** Nach so vielen Fehlern in Folge wird eine Partie abgebrochen, statt sie endlos zu versuchen. */
const MAX_CONSECUTIVE_FAILURES = 5;

export interface MatchDriverState {
  /** Fehler in Folge je Partie (nur im Speicher; nach einem Neustart beginnt die Zählung neu). */
  readonly failures: Map<string, number>;
}

export function newDriverState(): MatchDriverState {
  return { failures: new Map() };
}

/** Ein Lauf: höchstens `limit` fällige Partien, dann verwaiste Aufstellungen. */
export async function runMatchDriverOnce(
  db: Db,
  ctx: MatchContext,
  options: {
    readonly limit?: number;
    readonly log?: Pick<FastifyBaseLogger, 'error'>;
    readonly state?: MatchDriverState;
  } = {},
): Promise<{ advanced: number; expiredLobbies: number }> {
  const state = options.state ?? newDriverState();
  const due = await db
    .selectFrom('matches')
    .select('id')
    .where('status', '=', 'RUNNING')
    .where('phase_deadline_at', '<=', sql<Date>`game_now()`)
    .orderBy('phase_deadline_at')
    .limit(options.limit ?? 50)
    .execute();
  let advanced = 0;
  for (const { id } of due) {
    try {
      if ((await advanceMatch(db, ctx, id, { skipLocked: true })) === 'ADVANCED') advanced++;
      state.failures.delete(id);
    } catch (error) {
      const failures = (state.failures.get(id) ?? 0) + 1;
      state.failures.set(id, failures);
      options.log?.error({ err: error, matchId: id, failures }, 'Partie konnte nicht weiterlaufen');
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        state.failures.delete(id);
        await abandonBroken(db, ctx, id).catch((abandonError: unknown) =>
          options.log?.error({ err: abandonError, matchId: id }, 'Partie nicht abzubrechen'),
        );
      }
    }
  }
  const expiredLobbies = await expireLobbies(db, { limit: 50 });
  return { advanced, expiredLobbies };
}

/** Bricht eine Partie ab, die wiederholt nicht weiterlaufen konnte (Programmfehler, Datenfehler). */
async function abandonBroken(db: Db, ctx: MatchContext, matchId: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const match = await loadMatch(tx, matchId, { lock: 'UPDATE' });
    if (match?.status !== 'RUNNING') return;
    const run = openRun(tx, ctx, match, await loadPlayers(tx, matchId), await readGameNow(tx));
    run.abandon('INTERNAL_ERROR');
    await run.commit();
  });
}

/** Startet die Ablaufsteuerung; die Rückgabe beendet sie. */
export function startMatchDriver(
  db: Db,
  ctx: MatchContext,
  log: FastifyBaseLogger,
  intervalMs = 500,
): () => void {
  const state = newDriverState();
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runMatchDriverOnce(db, ctx, { log, state })
      .then(({ expiredLobbies }) => {
        if (expiredLobbies > 0) log.info({ expiredLobbies }, 'Verwaiste Aufstellungen beendet');
      })
      .catch((error: unknown) => log.error({ err: error }, 'Ablaufsteuerung fehlgeschlagen'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
