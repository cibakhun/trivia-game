import { newId, type Db, type Tx } from '@rdw/db';
import { ACCOUNT_DELETION_GRACE_DAYS, DAY_MS, EMAIL_VERIFY_DAYS, HOUR_MS } from '@rdw/protocol';
import type { FastifyBaseLogger } from 'fastify';
import { sql, type RawBuilder } from 'kysely';
import { randomInt } from 'node:crypto';
import { gameNow, intervalMs } from '../../infra/clock.ts';
import { OPEN_SIEGE_STATUSES } from '../combat/siege-status.ts';
import { settleOpenSiegesOfUser } from '../combat/sweeper.ts';

/**
 * Kontolöschung (SECURITY.md §5.2, ADR-045, ADR-086). Die Kontopflege löscht inaktive Gastkonten
 * (O-03: 90 Tage ohne Anmeldung), Konten mit Löschantrag (`DELETE /me`, O-47: registrierte nach
 * 7 Tagen, Gäste sofort) und registrierte Konten, die ihre E-Mail nicht binnen 30 Tagen bestätigt
 * haben (O-48), alle mit derselben Kaskade.
 *
 * Ablauf in einer Transaktion: Kontozeile sperren (neue Verweise warten an der
 * Fremdschlüsselprüfung und scheitern nach dem Commit), Platzhalterkonto anlegen, persönliche
 * Daten löschen, Protokolle schwärzen (auch die Konto-ID in der Prüfspur der Reichsgründung),
 * Spielhistorie auf den Platzhalter umstellen, Kontozeile löschen. Alle Fremdschlüssel auf `users` sind `ON DELETE RESTRICT`: Bleibt ein Verweis übrig,
 * scheitert das Löschen und alles wird zurückgerollt.
 */

export type ReferenceHandling = 'DELETE' | 'REDACT' | 'ANONYMIZE';

/**
 * Jede Spalte mit einer Konto-ID und was die Löschung mit ihr tut. Ein Integrationstest
 * vergleicht die Liste mit dem Datenbankkatalog, damit keine neue Spalte vergessen wird.
 */
export const ACCOUNT_REFERENCES: Readonly<Record<string, ReferenceHandling>> = Object.freeze({
  'sessions.user_id': 'DELETE',
  'player_profiles.user_id': 'DELETE',
  'player_settings.user_id': 'DELETE',
  'player_statistics.user_id': 'DELETE',
  'player_question_exposure.user_id': 'DELETE',
  'idempotency_keys.user_id': 'DELETE',
  'email_verifications.user_id': 'DELETE',
  // Meldungen gegen das Konto erledigen sich mit ihm; eigene Meldungen zählen anonym weiter
  'name_reports.reported_user_id': 'DELETE',
  'name_reports.reporter_user_id': 'ANONYMIZE',
  'world_events.user_id': 'REDACT',
  'world_rules.created_by': 'ANONYMIZE',
  'questions.created_by': 'ANONYMIZE',
  'world_participants.user_id': 'ANONYMIZE',
  'kingdoms.owner_user_id': 'ANONYMIZE',
  'season_results.user_id': 'ANONYMIZE',
  'siege_participants.user_id': 'ANONYMIZE',
  'matches.host_user_id': 'ANONYMIZE',
  'match_players.user_id': 'ANONYMIZE',
});

/** Inaktive Gastkonten werden nach dieser Zeit ohne Anmeldung gelöscht (O-03). */
export const GUEST_INACTIVITY_MS = 90 * DAY_MS;
/** Frist zwischen Löschantrag und Löschung eines registrierten Kontos (O-47 B). */
export const DELETION_GRACE_MS = ACCOUNT_DELETION_GRACE_DAYS * DAY_MS;
/** Frist für die Bestätigung der E-Mail (O-48). */
export const EMAIL_VERIFY_MS = EMAIL_VERIFY_DAYS * DAY_MS;
/** Bestätigungslinks bleiben so lange gespeichert (Bremse für neue Links, Wiederholungen). */
const EMAIL_LINK_RETENTION_MS = 30 * DAY_MS;
/** Höchstens so viele Löschungen je Lauf. */
const CLEANUP_BATCH = 50;
/**
 * Höchstens so viele Konten werden je Lauf geprüft, auch wenn viele davon warten müssen (offene
 * Belagerung) oder scheitern. So verdrängen die ältesten nicht dauerhaft alle späteren.
 */
const CLEANUP_CANDIDATE_FACTOR = 4;

/** Name eines Reichs, dessen Konto gelöscht ist („Vergessenes Reich #4821“). */
export function forgottenKingdomName(): { prefix: string; suffix: string } {
  return { prefix: 'Vergessenes Reich #', suffix: String(randomInt(1000, 10_000)) };
}

/**
 * Löscht ein Konto nach SECURITY §5.2 und gibt die ID des Platzhalters zurück; `null`, wenn es
 * das Konto nicht mehr gibt. Die Kontozeile muss der Aufrufer nicht sperren.
 */
export async function deleteAccount(tx: Tx, userId: string): Promise<string | null> {
  const user = await tx
    .selectFrom('users')
    .select(['id', 'deleted_at'])
    .where('id', '=', userId)
    .forUpdate()
    .executeTakeFirst();
  if (!user || user.deleted_at !== null) return null;

  const placeholder = newId();
  await tx
    .insertInto('users')
    .values({ id: placeholder, is_guest: false, deleted_at: gameNow, created_at: gameNow })
    .execute();

  // Rohtexte der eigenen Antworten, solange die Teilnahme noch auf das Konto zeigt
  await tx
    .updateTable('quiz_answers')
    .set({ raw_input: null })
    .where('raw_input', 'is not', null)
    .where('participant_id', 'in', (eb) =>
      eb.selectFrom('siege_participants').select('id').where('user_id', '=', userId),
    )
    .execute();
  // Persönliche Ereignisse werden Platzhalter; die seq-Folge bleibt lückenlos
  await tx
    .updateTable('world_events')
    .set({ type: 'REDACTED', payload: '{}', user_id: null })
    .where('user_id', '=', userId)
    .execute();
  // Reiche behalten Geschichte und Regionen, verlieren aber den Namen
  const kingdoms = await tx
    .selectFrom('kingdoms')
    .select('id')
    .where('owner_user_id', '=', userId)
    .execute();
  for (const kingdom of kingdoms) {
    // Die Prüfspur der Gründung trägt die Konto-ID in der RNG-Entitäts-ID
    await sql`update kingdom_history set payload = payload #- '{spawn,rngEntityId}'
               where kingdom_id = ${kingdom.id}
                 and payload #> '{spawn,rngEntityId}' is not null`.execute(tx);
    await tx
      .updateTable('kingdoms')
      .set({ owner_user_id: placeholder, name_parts: JSON.stringify(forgottenKingdomName()) })
      .where('id', '=', kingdom.id)
      .execute();
  }

  for (const [reference, handling] of Object.entries(ACCOUNT_REFERENCES)) {
    const [table, column] = reference.split('.') as [string, string];
    if (handling === 'DELETE') {
      await sql`delete from ${sql.table(table)} where ${sql.ref(column)} = ${userId}`.execute(tx);
    } else if (handling === 'ANONYMIZE') {
      await sql`update ${sql.table(table)} set ${sql.ref(column)} = ${placeholder}
                 where ${sql.ref(column)} = ${userId}`.execute(tx);
    }
    // REDACT: oben erledigt (world_events)
  }
  await tx.deleteFrom('users').where('id', '=', userId).execute();
  return placeholder;
}

/** Warum ein Konto gelöscht wird; jede Art hat ihre Bedingung, die unter Sperre erneut gilt. */
export type DeletionReason = 'INACTIVE_GUEST' | 'REQUESTED' | 'EMAIL_UNVERIFIED';

/** Bedingung je Art, als SQL über `users` (ohne Alias). */
function dueCondition(reason: DeletionReason): RawBuilder<boolean> {
  switch (reason) {
    case 'INACTIVE_GUEST':
      return sql<boolean>`is_guest
        and coalesce(last_seen_at, created_at) < game_now() - ${intervalMs(GUEST_INACTIVITY_MS)}`;
    case 'REQUESTED':
      // Gäste kommen nach dem Antrag ohnehin nicht wieder herein: keine Frist
      return sql<boolean>`deletion_requested_at is not null
        and (is_guest or deletion_requested_at <= game_now() - ${intervalMs(DELETION_GRACE_MS)})`;
    case 'EMAIL_UNVERIFIED':
      return sql<boolean>`not is_guest and email_verified_at is null
        and email_due_at is not null and email_due_at <= game_now()`;
  }
}

/** Sitzt das Konto in einer Aufstellung oder laufenden Partie? Dann wartet die Löschung. */
export async function hasActiveMatch(db: Db | Tx, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom('match_players as p')
    .innerJoin('matches as m', 'm.id', 'p.match_id')
    .select('m.id')
    .where('p.user_id', '=', userId)
    .where('m.status', 'in', ['LOBBY', 'RUNNING'])
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Löscht ein Konto, wenn es aus diesem Grund noch fällig ist. Offene Kämpfe werden zuerst
 * ausgewertet; bleibt danach eine Belagerung offen (Frist läuft noch) oder sitzt das Konto in einer
 * Aufstellung oder laufenden Partie, wartet die Löschung auf einen späteren Lauf. Gibt `true`
 * zurück, wenn gelöscht wurde.
 */
export async function deleteIfDue(
  db: Db,
  userId: string,
  reason: DeletionReason,
  log?: Pick<FastifyBaseLogger, 'error'>,
): Promise<boolean> {
  await settleOpenSiegesOfUser(db, userId, log);
  return db.transaction().execute(async (tx) => {
    const user = await tx
      .selectFrom('users')
      .select('id')
      .where('id', '=', userId)
      .where('deleted_at', 'is', null)
      .where(dueCondition(reason))
      .forUpdate()
      .executeTakeFirst();
    if (!user) return false;
    const open = await tx
      .selectFrom('sieges as s')
      .innerJoin('kingdoms as k', (join) =>
        join.on((eb) =>
          eb.or([
            eb('k.id', '=', eb.ref('s.attacker_kingdom_id')),
            eb('k.id', '=', eb.ref('s.defender_kingdom_id')),
          ]),
        ),
      )
      .select('s.id')
      .where('k.owner_user_id', '=', userId)
      .where('s.status', 'in', [...OPEN_SIEGE_STATUSES])
      .limit(1)
      .executeTakeFirst();
    if (open) return false;
    if (await hasActiveMatch(tx, userId)) return false;
    return (await deleteAccount(tx, userId)) !== null;
  });
}

/** Löscht ein inaktives Gastkonto, wenn es das noch ist (siehe `deleteIfDue`). */
export function deleteInactiveGuest(
  db: Db,
  userId: string,
  log?: Pick<FastifyBaseLogger, 'error'>,
): Promise<boolean> {
  return deleteIfDue(db, userId, 'INACTIVE_GUEST', log);
}

export interface AccountCleanupResult {
  readonly deletedGuests: number;
  /** Konten mit Löschantrag (O-47). */
  readonly deletedOnRequest: number;
  /** Registrierte Konten ohne bestätigte E-Mail nach Fristende (O-48). */
  readonly deletedUnverified: number;
  readonly expiredSessions: number;
  readonly clearedBootstraps: number;
  /** Alte Bestätigungslinks. */
  readonly clearedEmailLinks: number;
}

export interface AccountCleanupOptions {
  /** Höchstens so viele Löschungen je Art und Lauf. */
  readonly batch?: number;
  /**
   * Stellt der Server Mails zu (ADR-086)? Ohne Zustellung kann niemand bestätigen: Dann löscht die
   * Pflege keine unbestätigten Konten und hält ihre Frist bei 30 Tagen ab jetzt. Wird der Versand
   * eingerichtet, hat so jeder noch volle 30 Tage.
   */
  readonly mailDelivers?: boolean;
}

/** Wann ein Konto aus diesem Grund fällig wurde; danach wird sortiert (älteste zuerst). */
function dueSince(reason: DeletionReason): RawBuilder<Date> {
  switch (reason) {
    case 'INACTIVE_GUEST':
      return sql<Date>`coalesce(last_seen_at, created_at)`;
    case 'REQUESTED':
      return sql<Date>`deletion_requested_at`;
    case 'EMAIL_UNVERIFIED':
      return sql<Date>`email_due_at`;
  }
}

/**
 * Löscht fällige Konten einer Art: höchstens `batch` Löschungen, die ältesten zuerst, dabei
 * höchstens viermal so viele Konten prüfen. So verdrängen Konten, die warten müssen (offene
 * Belagerung, laufende Partie) oder scheitern, die späteren nicht dauerhaft.
 */
async function deleteDue(
  db: Db,
  reason: DeletionReason,
  batch: number,
  log?: Pick<FastifyBaseLogger, 'error'>,
): Promise<number> {
  let deleted = 0;
  let examined = 0;
  // Blättern statt fester Liste: Wer warten muss oder scheitert, verdrängt die Späteren nicht.
  // Der Zeitstempel bleibt Text, damit die Mikrosekunden beim Weiterblättern erhalten bleiben.
  let after: { readonly at: string; readonly id: string } | null = null;
  const since = dueSince(reason);
  while (deleted < batch && examined < batch * CLEANUP_CANDIDATE_FACTOR) {
    const keyset: RawBuilder<boolean> =
      after === null
        ? sql<boolean>`true`
        : sql<boolean>`(${since}, id) > (${after.at}::timestamptz, ${after.id}::uuid)`;
    const page = await db
      .selectFrom('users')
      .select(['id', sql<string>`${since}::text`.as('due_at')])
      .where('deleted_at', 'is', null)
      .where(dueCondition(reason))
      .where(keyset)
      .orderBy(since)
      .orderBy('id')
      .limit(batch)
      .execute();
    for (const { id } of page) {
      if (deleted >= batch || examined >= batch * CLEANUP_CANDIDATE_FACTOR) break;
      examined += 1;
      try {
        if (await deleteIfDue(db, id, reason, log)) deleted += 1;
      } catch (error) {
        // Ein Konto, das sich nicht löschen lässt, hält die anderen nicht auf
        log?.error({ err: error, userId: id, reason }, 'Konto konnte nicht gelöscht werden');
      }
    }
    const last = page.at(-1);
    if (!last || page.length < batch) break;
    after = { at: last.due_at, id: last.id };
  }
  return deleted;
}

/**
 * Ein Lauf der Kontopflege: inaktive Gäste, Konten mit Löschantrag und (nur mit Mailversand)
 * Konten ohne bestätigte E-Mail löschen, abgelaufene Sitzungen löschen, Bootstrap-Hashes nach 24 h
 * leeren (API.md §1: dann ist auch das Cookie abgelaufen), alte Bestätigungslinks löschen.
 */
export async function cleanupAccounts(
  db: Db,
  log?: Pick<FastifyBaseLogger, 'error'>,
  batch = CLEANUP_BATCH,
  options: AccountCleanupOptions = {},
): Promise<AccountCleanupResult> {
  const deletedGuests = await deleteDue(db, 'INACTIVE_GUEST', batch, log);
  const deletedOnRequest = await deleteDue(db, 'REQUESTED', batch, log);
  let deletedUnverified = 0;
  if (options.mailDelivers) {
    deletedUnverified = await deleteDue(db, 'EMAIL_UNVERIFIED', batch, log);
  } else {
    await db
      .updateTable('users')
      .set({ email_due_at: sql<Date>`game_now() + ${intervalMs(EMAIL_VERIFY_MS)}` })
      .where('is_guest', '=', false)
      .where('deleted_at', 'is', null)
      .where('email_verified_at', 'is', null)
      .where(sql<boolean>`email_due_at < game_now() + ${intervalMs(EMAIL_VERIFY_MS)}`)
      .execute();
  }
  const sessions = await db
    .deleteFrom('sessions')
    .where('expires_at', '<=', gameNow)
    .executeTakeFirst();
  const bootstraps = await db
    .updateTable('users')
    .set({ guest_bootstrap_hash: null })
    .where('guest_bootstrap_hash', 'is not', null)
    .where(sql<boolean>`created_at < game_now() - ${intervalMs(DAY_MS)}`)
    .executeTakeFirst();
  const links = await db
    .deleteFrom('email_verifications')
    .where(sql<boolean>`created_at < game_now() - ${intervalMs(EMAIL_LINK_RETENTION_MS)}`)
    .executeTakeFirst();
  return {
    deletedGuests,
    deletedOnRequest,
    deletedUnverified,
    expiredSessions: Number(sessions.numDeletedRows),
    clearedBootstraps: Number(bootstraps.numUpdatedRows),
    clearedEmailLinks: Number(links.numDeletedRows),
  };
}

/**
 * Startet die stündliche Kontopflege im api-Prozess (bis zum Worker in Phase 3); der erste Lauf
 * kommt nach einer Minute. Die Rückgabe beendet sie.
 */
export function startAccountCleanup(
  db: Db,
  log: FastifyBaseLogger,
  options: { readonly mailDelivers: boolean; readonly intervalMs?: number },
): () => void {
  const intervalMs_ = options.intervalMs ?? HOUR_MS;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    cleanupAccounts(db, log, CLEANUP_BATCH, { mailDelivers: options.mailDelivers })
      .then((result) => {
        if (Object.values(result).some((n) => n > 0)) log.info(result, 'Kontopflege');
      })
      .catch((error: unknown) => log.error({ err: error }, 'Kontopflege fehlgeschlagen'))
      .finally(() => {
        running = false;
      });
  };
  const first = setTimeout(run, Math.min(60_000, intervalMs_));
  const timer = setInterval(run, intervalMs_);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
