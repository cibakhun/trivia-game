import type { Db } from '@rdw/db';
import { sql } from 'kysely';

/**
 * Spielzeit kommt aus der Datenbank (`game_now()`, DATA_MODEL §1): Ein Zeitversatz in Test und
 * Staging wirkt so überall gleich, und Server ohne synchronisierte Uhr rechnen nicht falsch.
 */
export const gameNow = sql<Date>`game_now()`;

export async function readGameNow(db: Db): Promise<Date> {
  const { rows } = await sql<{ now: Date }>`select game_now() as now`.execute(db);
  const row = rows[0];
  if (!row) throw new Error('game_now() lieferte keine Zeile');
  return row.now;
}

/** Intervall aus Millisekunden für SQL-Ausdrücke wie `game_now() + …`. */
export function intervalMs(ms: number) {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError(`Ungültige Dauer: ${ms}`);
  return sql<string>`make_interval(secs => ${ms}::double precision / 1000)`;
}
