import type { Db } from '@rdw/db';
import { CHALLENGE_START_WINDOW_MS } from '@rdw/game-core';
import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'kysely';
import { pruneIdempotencyKeys } from '../../infra/idempotency.ts';
import { settleSiege } from './settle.ts';

/**
 * Aufräumen liegen gebliebener Herausforderungen (`challenge.expireStale`, ARCHITECTURE §11):
 * abgelaufene Schritte werden `TIMED_OUT` und ausgewertet, nie begonnene beendet. Bis zum
 * Worker-Prozess (Phase 3) läuft der Lauf minütlich im api-Prozess; Lesezugriffe und neue
 * Angriffe lösen dasselbe für den betroffenen Spieler sofort aus.
 */

/** `settleGrace` aus dem Regel-Schnappschuss der Belagerung als Intervall. */
const SETTLE_GRACE = sql<string>`((s.rules_snapshot -> 'defense' ->> 'settleGrace')::bigint * interval '1 millisecond')`;

/**
 * Fällige Kämpfe (muss zu `settleSiege` passen). Nur diese werden unter Sperren ausgewertet;
 * Lesezugriffe sperren nichts, solange kein Kampf fällig ist.
 *
 * - **`PREPARING`** (PvE und PvP): nie begonnen und Startfenster abgelaufen, ein gestellter
 *   Schritt über Frist + `settleGrace`, oder fertig beantwortet und noch offen; im PvE auch: Trivia
 *   beantwortet ohne Gleichstand, also ohne Schätzfrage. Im PvP eröffnet die Auswertung die
 *   Belagerung.
 * - **`AWAITING_DEFENSE`**: Frist + `settleGrace` abgelaufen (Sieg durch Fristablauf oder am Gate
 *   gescheitert) oder Angreiferreich nicht mehr aktiv (Abbruch, N10).
 * - **`DEFENDING`**: Schritt des Verteidigers über Frist + `settleGrace`, Verteidigung fertig
 *   beantwortet oder Angreiferreich nicht mehr aktiv.
 */
function dueSieges(db: Db, options: { readonly userId?: string; readonly limit: number }) {
  let query = db
    .selectFrom('sieges as s')
    .select('s.id')
    .where((eb) => {
      const stepExpired = eb.exists(
        eb
          .selectFrom('quiz_answers as a')
          .select('a.id')
          .whereRef('a.siege_id', '=', 's.id')
          .where('a.status', '=', 'PRESENTED')
          .where(sql<boolean>`a.answer_deadline_at + ${SETTLE_GRACE} <= game_now()`),
      );
      const completedBy = (role: 'ATTACKER' | 'DEFENDER') =>
        eb.exists(
          eb
            .selectFrom('quiz_answers as a')
            .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
            .select('a.id')
            .whereRef('a.siege_id', '=', 's.id')
            .where('p.role', '=', role)
            .where((inner) =>
              inner.or([
                inner.and([
                  inner('a.step_index', '=', 1),
                  inner('a.status', 'in', ['ANSWERED', 'TIMED_OUT']),
                ]),
                inner.and([inner('a.step_index', '=', 0), inner('a.status', '=', 'TIMED_OUT')]),
              ]),
            ),
        );
      const attackerInactive = eb.exists(
        eb
          .selectFrom('kingdoms as ak')
          .select('ak.id')
          .whereRef('ak.id', '=', 's.attacker_kingdom_id')
          .where('ak.status', '<>', 'ACTIVE'),
      );
      return eb.or([
        eb.and([
          eb('s.status', '=', 'PREPARING'),
          eb.or([
            eb.and([
              eb('s.attack_presented_at', 'is', null),
              eb(
                sql<Date>`s.created_at + ${sql.lit(CHALLENGE_START_WINDOW_MS / 1000)} * interval '1 second'`,
                '<=',
                sql<Date>`game_now()`,
              ),
            ]),
            stepExpired,
            // vollständig beantwortet, aber noch nicht ausgewertet (z. B. Abbruch nach dem Speichern)
            completedBy('ATTACKER'),
            // PvE: Trivia-Frage beantwortet, aber kein Gleichstand (Angreifer falsch oder
            // Verteidigung falsch): die Schätzfrage entfällt, der Ausgang steht fest (GAME_RULES §5.2)
            eb.and([
              eb('s.mode', '=', 'PVE'),
              eb.exists(
                eb
                  .selectFrom('quiz_answers as a')
                  .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
                  .select('a.id')
                  .whereRef('a.siege_id', '=', 's.id')
                  .where('p.role', '=', 'ATTACKER')
                  .where('a.step_index', '=', 0)
                  .where('a.status', '=', 'ANSWERED')
                  .where((inner) =>
                    inner.or([
                      inner('a.is_correct', '=', false),
                      inner.not(
                        inner.exists(
                          inner
                            .selectFrom('quiz_answers as d')
                            .innerJoin('siege_participants as dp', 'dp.id', 'd.participant_id')
                            .select('d.id')
                            .whereRef('d.siege_id', '=', 's.id')
                            .where('dp.role', '=', 'DEFENDER')
                            .where('d.step_index', '=', 0)
                            .where('d.is_correct', '=', true),
                        ),
                      ),
                    ]),
                  ),
              ),
            ]),
          ]),
        ]),
        eb.and([
          eb('s.status', '=', 'AWAITING_DEFENSE'),
          eb.or([sql<boolean>`s.deadline_at + ${SETTLE_GRACE} <= game_now()`, attackerInactive]),
        ]),
        eb.and([
          eb('s.status', '=', 'DEFENDING'),
          eb.or([stepExpired, completedBy('DEFENDER'), attackerInactive]),
        ]),
      ]);
    });
  if (options.userId !== undefined) {
    const userId = options.userId;
    // Angreifer oder (PvP) Verteidiger
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('kingdoms as k')
          .select('k.id')
          .where((inner) =>
            inner.or([
              inner('k.id', '=', inner.ref('s.attacker_kingdom_id')),
              inner('k.id', '=', inner.ref('s.defender_kingdom_id')),
            ]),
          )
          .where('k.owner_user_id', '=', userId),
      ),
    );
  }
  return query.orderBy('s.created_at').limit(options.limit).execute();
}

/**
 * Wertet die Kämpfe einzeln aus; ein fehlerhafter Kampf blockiert die übrigen nicht und wird
 * protokolliert. Liefert die Zahl der beendeten.
 */
async function settleEach(
  db: Db,
  ids: readonly { id: string }[],
  log: Pick<FastifyBaseLogger, 'error'> | undefined,
): Promise<number> {
  let resolved = 0;
  for (const { id } of ids) {
    try {
      if ((await settleSiege(db, id)) === 'RESOLVED') resolved++;
    } catch (error) {
      log?.error({ err: error, siegeId: id }, 'Kampf konnte nicht ausgewertet werden');
    }
  }
  return resolved;
}

/**
 * Löst die fälligen Kämpfe eines Spielers auf, als Angreifer und als Verteidiger. Scheitert ein
 * Kampf, bleibt die Anfrage des Spielers trotzdem beantwortbar; der Aufräumlauf versucht es
 * erneut.
 */
export async function settleOpenSiegesOfUser(
  db: Db,
  userId: string,
  log?: Pick<FastifyBaseLogger, 'error'>,
): Promise<void> {
  await settleEach(db, await dueSieges(db, { userId, limit: 20 }), log);
}

/** Alle fälligen Kämpfe (höchstens `limit` je Lauf); liefert die Zahl der beendeten. */
export async function expireStaleChallenges(
  db: Db,
  limit = 100,
  log?: Pick<FastifyBaseLogger, 'error'>,
): Promise<number> {
  return settleEach(db, await dueSieges(db, { limit }), log);
}

/** Startet den minütlichen Lauf (Kämpfe, dann Idempotenz-Einträge); die Rückgabe beendet ihn. */
export function startChallengeSweeper(
  db: Db,
  log: FastifyBaseLogger,
  intervalMs = 60_000,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    expireStaleChallenges(db, 100, log)
      .then(async (count) => {
        if (count > 0) log.info({ count }, 'Liegen gebliebene Herausforderungen beendet');
        const pruned = await pruneIdempotencyKeys(db);
        if (pruned > 0) log.info({ pruned }, 'Abgelaufene Idempotenz-Einträge gelöscht');
      })
      .catch((error: unknown) => log.error({ err: error }, 'Aufräumlauf fehlgeschlagen'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
