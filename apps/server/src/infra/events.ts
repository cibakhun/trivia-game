import type { Db } from '@rdw/db';
import { gameNow } from './clock.ts';

/**
 * Ereignisse: Outbox `world_events` (ARCHITECTURE §10, `seq` vergibt der Trigger) und das
 * Kampfprotokoll `battle_events` (je Belagerung fortlaufend nummeriert).
 */

export interface WorldEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  /** Chunk-Kanal; fehlt bei rein persönlichen Ereignissen. */
  readonly chunk?: { readonly x: number; readonly y: number };
  /** Persönlicher Kanal des Kontos. */
  readonly userId?: string;
}

/** Schreibt alle Ereignisse einer Transaktion in einer Anweisung, als Letztes vor dem Commit. */
export async function insertWorldEvents(
  db: Db,
  instanceId: string,
  events: readonly WorldEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await db
    .insertInto('world_events')
    .values(
      events.map((event) => ({
        instance_id: instanceId,
        chunk_x: event.chunk?.x ?? null,
        chunk_y: event.chunk?.y ?? null,
        user_id: event.userId ?? null,
        type: event.type,
        payload: JSON.stringify(event.payload),
        created_at: gameNow,
      })),
    )
    .execute();
}

export interface BattleEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Hängt Einträge an das Kampfprotokoll an. Der Aufrufer hält die Zeilensperre der Belagerung,
 * sonst könnten zwei Transaktionen dieselbe Nummer wählen (`unique(siege_id, seq)` würde das
 * abweisen).
 */
export async function appendBattleEvents(
  db: Db,
  siegeId: string,
  events: readonly BattleEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const { last } = await db
    .selectFrom('battle_events')
    .select((eb) => eb.fn.coalesce(eb.fn.max('seq'), eb.lit(0)).as('last'))
    .where('siege_id', '=', siegeId)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('battle_events')
    .values(
      events.map((event, i) => ({
        siege_id: siegeId,
        seq: Number(last) + 1 + i,
        type: event.type,
        payload: JSON.stringify(event.payload),
        at: gameNow,
      })),
    )
    .execute();
}
