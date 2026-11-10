import { areNeighbors } from '@rdw/game-core';
import { API_PREFIX, meResponseSchema } from '@rdw/protocol';
import type { Page } from '@playwright/test';
import { sql } from 'kysely';
import { testDb } from './answers.ts';

/**
 * Aufbau für die PvP-Tests (E2E-02/03): Zwei frische Spieler in der Welt `spieltest` grenzen nach
 * ihrer Gründung meist nicht aneinander. Der Test gibt dem Verteidiger deshalb direkt in der
 * Testdatenbank eine Nachbarregion der Angreifer-Hauptstadt und hebt seinen Anfängerschutz auf,
 * wie ein Prüfer. Der Angreifer behält seinen Schutz, damit die Warnung sichtbar wird.
 */

export interface PlayerInfo {
  readonly instanceId: string;
  readonly kingdomId: string;
  readonly kingdomName: string;
  readonly capitalRegionId: string;
}

/** Reich des Spielers dieser Seite (über die API mit seinem Sitzungs-Cookie). */
export async function playerInfo(page: Page): Promise<PlayerInfo> {
  const response = await page.request.get(`${API_PREFIX}/me`);
  const me = meResponseSchema.parse(await response.json());
  const instance = me.instances.at(-1);
  const kingdom = instance?.kingdom;
  if (!instance || !kingdom?.capitalRegionId) throw new Error('Spieler ohne Reich');
  return {
    instanceId: instance.instanceId,
    kingdomId: kingdom.id,
    kingdomName: kingdom.name,
    capitalRegionId: kingdom.capitalRegionId,
  };
}

/** Gibt dem Verteidiger eine neutrale Nachbarregion der Angreifer-Hauptstadt; liefert ihre ID. */
export async function makeNeighbours(attacker: PlayerInfo, defender: PlayerInfo): Promise<string> {
  const db = testDb();
  const regions = await db
    .selectFrom('regions as r')
    .innerJoin('region_state as s', 's.region_id', 'r.id')
    .select(['r.id', 'r.q', 'r.r', 's.owner_kingdom_id', 's.active_siege_id'])
    .where('r.instance_id', '=', attacker.instanceId)
    .execute();
  const capital = regions.find((r) => r.id === attacker.capitalRegionId);
  if (!capital) throw new Error('Hauptstadt fehlt');
  const target = regions.find(
    (r) => r.owner_kingdom_id === null && r.active_siege_id === null && areNeighbors(capital, r),
  );
  if (!target) throw new Error('Keine neutrale Nachbarregion');
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('region_state')
      .set({
        owner_kingdom_id: defender.kingdomId,
        is_capital: false,
        owned_since: sql<Date>`game_now()`,
        protected_until: null,
        protection_reason: null,
      })
      .where('region_id', '=', target.id)
      .where('owner_kingdom_id', 'is', null)
      .execute();
    await tx
      .updateTable('kingdoms')
      .set({
        region_count: sql<number>`region_count + 1`,
        protected_until: null,
        protection_reason: null,
      })
      .where('id', '=', defender.kingdomId)
      .execute();
  });
  return target.id;
}
