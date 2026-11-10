import type { Db } from '@rdw/db';
import { CHALLENGE_START_WINDOW_MS } from '@rdw/game-core';
import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'kysely';
import { settleSiege } from './settle.ts';

/**
 * Aufräumen liegen gebliebener Herausforderungen (`challenge.expireStale`, ARCHITECTURE §11):
 * abgelaufene Schritte werden `TIMED_OUT` und ausgewertet, nie begonnene beendet. Bis zum
 * Worker-Prozess (Phase 3) läuft der Lauf minütlich im api-Prozess; Lesezugriffe und neue
 * Angriffe lösen dasselbe für den betroffenen Spieler sofort aus.
 */

/** Löst die laufenden PvE-Kämpfe eines Spielers auf, soweit sie fällig sind. */
export async function settleOpenSiegesOfUser(db: Db, userId: string): Promise<void> {
  const open = await db
    .selectFrom('sieges as s')
    .innerJoin('kingdoms as k', 'k.id', 's.attacker_kingdom_id')
    .select('s.id')
    .where('k.owner_user_id', '=', userId)
    .where('s.status', '=', 'PREPARING')
    .where('s.mode', '=', 'PVE')
    .execute();
  for (const { id } of open) await settleSiege(db, id);
}

/** Alle fälligen PvE-Kämpfe (höchstens `limit` je Lauf); liefert die Zahl der beendeten. */
export async function expireStaleChallenges(db: Db, limit = 100): Promise<number> {
  const due = await db
    .selectFrom('sieges as s')
    .select('s.id')
    .where('s.status', '=', 'PREPARING')
    .where('s.mode', '=', 'PVE')
    .where((eb) =>
      eb.or([
        eb.and([
          eb('s.attack_presented_at', 'is', null),
          eb(
            sql<Date>`s.created_at + ${sql.lit(CHALLENGE_START_WINDOW_MS / 1000)} * interval '1 second'`,
            '<=',
            sql<Date>`game_now()`,
          ),
        ]),
        eb.exists(
          eb
            .selectFrom('quiz_answers as a')
            .select('a.id')
            .whereRef('a.siege_id', '=', 's.id')
            .where('a.status', '=', 'PRESENTED')
            .where(
              sql<boolean>`a.answer_deadline_at + ((s.rules_snapshot -> 'defense' ->> 'settleGrace')::bigint * interval '1 millisecond') <= game_now()`,
            ),
        ),
      ]),
    )
    .orderBy('s.created_at')
    .limit(limit)
    .execute();
  let resolved = 0;
  for (const { id } of due) {
    if ((await settleSiege(db, id)) === 'RESOLVED') resolved++;
  }
  return resolved;
}

/** Startet den minütlichen Lauf; die Rückgabe beendet ihn. */
export function startChallengeSweeper(
  db: Db,
  log: FastifyBaseLogger,
  intervalMs = 60_000,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    expireStaleChallenges(db)
      .then((count) => {
        if (count > 0) log.info({ count }, 'Liegen gebliebene Herausforderungen beendet');
      })
      .catch((error: unknown) => log.error({ err: error }, 'Aufräumlauf fehlgeschlagen'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
