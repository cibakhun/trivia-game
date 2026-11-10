import type { Db } from '@rdw/db';

/**
 * Gemeinsame Begriffe zum Belagerungsstatus für Kampf, Fragenauswahl und Weltabfragen, ohne
 * Abhängigkeit von der Auflösung (`settle.ts` importiert die Fragenauswahl).
 */

/** Belagerungen, die noch nicht beendet sind (`RESOLVING` wird nie gespeichert). */
export const OPEN_SIEGE_STATUSES = ['PREPARING', 'AWAITING_DEFENSE', 'DEFENDING'] as const;

/**
 * Herausforderung, die das Reich gerade bearbeitet (GAME_RULES §7: höchstens eine je Spieler):
 * ein eigener Angriff in Vorbereitung oder eine begonnene Verteidigung; `null` = keine.
 */
export async function openChallengeOf(db: Db, kingdomId: string): Promise<string | null> {
  const open = await db
    .selectFrom('sieges as s')
    .innerJoin('quiz_challenges as c', 'c.siege_id', 's.id')
    .select('c.id')
    .where((eb) =>
      eb.or([
        eb.and([eb('s.attacker_kingdom_id', '=', kingdomId), eb('s.status', '=', 'PREPARING')]),
        eb.and([eb('s.defender_kingdom_id', '=', kingdomId), eb('s.status', '=', 'DEFENDING')]),
      ]),
    )
    .orderBy('s.created_at')
    .limit(1)
    .executeTakeFirst();
  return open?.id ?? null;
}
