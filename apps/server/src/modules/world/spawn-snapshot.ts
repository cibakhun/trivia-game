import type { Db } from '@rdw/db';
import {
  AXIAL_DIRECTIONS,
  kingdomName,
  tutorialTarget,
  type Axial,
  type FactionArchetype,
  type KingdomNameParts,
  type SpawnKingdom,
  type SpawnRegion,
} from '@rdw/game-core';
import { sql } from 'kysely';

/**
 * Schnappschuss der Karte für Startregion und Tutorial-Ziel (WORLD_SYSTEM §4.2). Für die Testwelt
 * (≈ 150 Regionen) liest er die ganze Instanz; für große Eternal-Welten braucht es die
 * Kandidatenliste aus WORLD_SYSTEM §3.2 Schritt 5 (mit der Chunk-Freischaltung).
 */

export interface SnapshotRegion extends SpawnRegion {
  readonly chunkX: number;
  readonly chunkY: number;
}

export interface SpawnSnapshot {
  readonly regions: readonly SnapshotRegion[];
  /** Aktive Reiche. */
  readonly kingdoms: readonly SpawnKingdom[];
  /** Namen aller Reiche der Instanz, auch gefallener. */
  readonly names: ReadonlySet<string>;
  /** Zahl aktiver Reiche je Farbe. */
  readonly colorUsage: readonly number[];
}

export async function loadSpawnSnapshot(db: Db, instanceId: string): Promise<SpawnSnapshot> {
  const regionRows = await db
    .selectFrom('regions as r')
    .innerJoin('region_state as s', 's.region_id', 'r.id')
    .select([
      'r.id',
      'r.q',
      'r.r',
      'r.tier',
      'r.chunk_x',
      'r.chunk_y',
      's.owner_kingdom_id',
      sql<boolean>`s.active_siege_id is not null`.as('under_siege'),
    ])
    .where('r.instance_id', '=', instanceId)
    .execute();
  const kingdomRows = await db
    .selectFrom('kingdoms as k')
    .leftJoin('npc_factions as f', 'f.id', 'k.npc_faction_id')
    .leftJoin('region_state as c', (join) =>
      join.onRef('c.owner_kingdom_id', '=', 'k.id').on('c.is_capital', '=', true),
    )
    .leftJoin('regions as cr', 'cr.id', 'c.region_id')
    .select([
      'k.id',
      'k.kind',
      'k.status',
      'k.region_count',
      'k.name_parts',
      'k.color',
      'f.archetype',
      'cr.q',
      'cr.r',
    ])
    .where('k.instance_id', '=', instanceId)
    .execute();

  const names = new Set<string>();
  const colorUsage: number[] = [];
  const kingdoms: SpawnKingdom[] = [];
  for (const row of kingdomRows) {
    names.add(kingdomName(row.name_parts as unknown as KingdomNameParts));
    if (row.status !== 'ACTIVE') continue;
    colorUsage[row.color] = (colorUsage[row.color] ?? 0) + 1;
    kingdoms.push({
      id: row.id,
      kind: row.kind === 'NPC' ? 'NPC' : 'PLAYER',
      archetype: (row.archetype as FactionArchetype | null) ?? null,
      regionCount: row.region_count,
      capital: row.q !== null && row.r !== null ? { q: row.q, r: row.r } : null,
    });
  }
  return {
    regions: regionRows.map((row) => ({
      id: row.id,
      q: row.q,
      r: row.r,
      tier: row.tier,
      chunkX: row.chunk_x,
      chunkY: row.chunk_y,
      ownerKingdomId: row.owner_kingdom_id,
      underSiege: row.under_siege,
    })),
    kingdoms,
    names,
    colorUsage,
  };
}

/**
 * Tutorial-Ziel neben einer Hauptstadt (NPC_SYSTEM §4): liest nur die sechs Nachbarn.
 */
export async function tutorialTargetNear(
  db: Db,
  instanceId: string,
  capital: Axial,
): Promise<string | null> {
  const cells = AXIAL_DIRECTIONS.map((d) => ({ q: capital.q + d.q, r: capital.r + d.r }));
  const rows = await db
    .selectFrom('regions as r')
    .innerJoin('region_state as s', 's.region_id', 'r.id')
    .select([
      'r.id',
      'r.q',
      'r.r',
      'r.tier',
      's.owner_kingdom_id',
      sql<boolean>`s.active_siege_id is not null`.as('under_siege'),
    ])
    .where('r.instance_id', '=', instanceId)
    .where((eb) => eb.or(cells.map((c) => eb.and([eb('r.q', '=', c.q), eb('r.r', '=', c.r)]))))
    .execute();
  const target = tutorialTarget(
    rows.map((row) => ({
      id: row.id,
      q: row.q,
      r: row.r,
      tier: row.tier,
      ownerKingdomId: row.owner_kingdom_id,
      underSiege: row.under_siege,
    })),
    capital,
  );
  return target?.id ?? null;
}
