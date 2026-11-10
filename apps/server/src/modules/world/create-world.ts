import { newId, type Db, type Tx } from '@rdw/db';
import {
  MAPGEN_VERSION,
  axialKey,
  biomeCode,
  chunkOf,
  factionNamingRng,
  generateKingdomName,
  generateWorld,
  kingdomName,
  pickKingdomColor,
  placeFactions,
  type FactionArchetype,
  type MapPreset,
} from '@rdw/game-core';
import { DEFAULT_RULES, type WorldMode } from '@rdw/protocol';
import { sql } from 'kysely';
import { canonicalJson, sha256Hex } from '../../infra/crypto.ts';
import { gameNow } from '../../infra/clock.ts';

/**
 * Legt eine Welt mit einer laufenden Instanz an (WORLD_SYSTEM §2–3): Regelversion, Karte aus
 * Seed und Vorlage, NPC-Fraktionen mit ihren Reichen. Alles in einer Transaktion; bricht etwas
 * ab, bleibt nichts zurück. Die Erzeugung hängt nur vom öffentlichen Seed ab und braucht kein
 * RNG-Geheimnis.
 *
 * Die Ausgangslage ist kein Ereignis der Historie: `region_history` beginnt mit der ersten
 * Änderung nach der Erzeugung, `kingdom_history` hält die Gründung der NPC-Reiche fest.
 */

/** Persönlichkeit je Archetyp (NPC_SYSTEM §2: Expansion gering/regelmäßig/häufig) [E]. */
const FACTION_PERSONALITY: Readonly<
  Record<FactionArchetype, { readonly aggression: string; readonly expansion: string }>
> = Object.freeze({
  LIGHT: { aggression: '0.2', expansion: '0.2' },
  MEDIUM: { aggression: '0.5', expansion: '0.5' },
  HEAVY: { aggression: '0.8', expansion: '0.8' },
});

export interface CreateWorldOptions {
  readonly slug: string;
  /** i18n-Schlüssel des Weltnamens, z. B. `world.test`. */
  readonly nameKey: string;
  readonly mode: WorldMode;
  readonly seed: bigint;
  readonly preset: MapPreset;
  readonly capacity: number;
}

export interface CreatedWorld {
  readonly worldId: string;
  readonly instanceId: string;
  readonly rulesId: string;
  readonly regions: number;
  readonly factions: readonly { readonly archetype: FactionArchetype; readonly regions: number }[];
}

const INSERT_BATCH = 1000;

export async function createWorld(db: Db, options: CreateWorldOptions): Promise<CreatedWorld> {
  if (!Number.isSafeInteger(options.capacity) || options.capacity < 1) {
    throw new RangeError(`Kapazität muss ≥ 1 sein: ${options.capacity}`);
  }
  if (options.mode !== 'ETERNAL') {
    // Daily/Weekly brauchen Saisons (world_seasons) und kommen mit Phase 6.
    throw new RangeError(`Modus ${options.mode} wird noch nicht unterstützt`);
  }
  // vor der Transaktion: reine Berechnung, wirft bei ungültigem Seed oder fehlendem Platz
  const cells = generateWorld(options.seed, options.preset.shape);
  const factions = placeFactions(options.seed, cells, options.preset.factions);
  return db.transaction().execute((tx) => insertWorld(tx, options, cells, factions));
}

async function insertWorld(
  tx: Tx,
  options: CreateWorldOptions,
  cells: ReturnType<typeof generateWorld>,
  factions: ReturnType<typeof placeFactions>,
): Promise<CreatedWorld> {
  const worldId = newId();
  const rulesId = newId();
  const instanceId = newId();
  const config = DEFAULT_RULES[options.mode];

  await tx
    .insertInto('worlds')
    .values({ id: worldId, slug: options.slug, mode: options.mode, name_key: options.nameKey })
    .execute();
  await tx
    .insertInto('world_rules')
    .values({
      id: rulesId,
      world_id: worldId,
      version: 1,
      config: JSON.stringify(config),
      config_hash: sha256Hex(canonicalJson(config)),
      created_at: gameNow,
      notes: `Standardregeln DEFAULT_RULES.${options.mode}`,
    })
    .execute();
  await tx
    .updateTable('worlds')
    .set({ current_rules_id: rulesId })
    .where('id', '=', worldId)
    .execute();
  await tx
    .insertInto('world_instances')
    .values({
      id: instanceId,
      world_id: worldId,
      rules_id: rulesId,
      map_seed: options.seed.toString(),
      mapgen_version: MAPGEN_VERSION,
      capacity: options.capacity,
      status: 'RUNNING',
      starts_at: gameNow,
    })
    .execute();

  // Regionen und ihr Zustand
  const regionIds = new Map<string, string>();
  for (let i = 0; i < cells.length; i += INSERT_BATCH) {
    const batch = cells.slice(i, i + INSERT_BATCH);
    const rows = await tx
      .insertInto('regions')
      .values(
        batch.map((cell) => ({
          instance_id: instanceId,
          q: cell.q,
          r: cell.r,
          chunk_x: cell.chunkX,
          chunk_y: cell.chunkY,
          biome: biomeCode(cell.biome),
          tier: cell.tier,
        })),
      )
      .returning(['id', 'q', 'r'])
      .execute();
    for (const row of rows) regionIds.set(axialKey(row), row.id);
    await tx
      .insertInto('region_state')
      .values(
        batch.map((cell) => ({
          region_id: regionIds.get(axialKey(cell)) as string,
          instance_id: instanceId,
          chunk_x: cell.chunkX,
          chunk_y: cell.chunkY,
          updated_at: gameNow,
        })),
      )
      .execute();
  }

  // NPC-Fraktionen: jüngste Version des Basisprofils je Archetyp (Migration 0007)
  const profiles = await tx
    .selectFrom('npc_profiles')
    .select(['id', 'code'])
    .where('code', 'in', ['LIGHT', 'MEDIUM', 'HEAVY'])
    .orderBy('version', 'desc')
    .execute();
  const profileId = (archetype: FactionArchetype): string => {
    const profile = profiles.find((p) => p.code === archetype);
    if (!profile) throw new Error(`NPC-Profil ${archetype} fehlt (Migration 0007)`);
    return profile.id;
  };

  const rng = factionNamingRng(options.seed);
  const takenNames = new Set<string>();
  const colorUsage: number[] = [];
  for (const faction of factions) {
    const factionId = newId();
    const kingdomId = newId();
    const home = chunkOf(faction.capital);
    const name = generateKingdomName(rng, takenNames);
    takenNames.add(kingdomName(name));
    const color = pickKingdomColor(rng, colorUsage);
    colorUsage[color] = (colorUsage[color] ?? 0) + 1;
    const personality = FACTION_PERSONALITY[faction.archetype];

    await tx
      .insertInto('npc_factions')
      .values({
        id: factionId,
        instance_id: instanceId,
        name_key: `npc.faction.${faction.archetype.toLowerCase()}`,
        archetype: faction.archetype,
        profile_id: profileId(faction.archetype),
        aggression: personality.aggression,
        expansion: personality.expansion,
        home_chunk_x: home.chunkX,
        home_chunk_y: home.chunkY,
      })
      .execute();
    await tx
      .insertInto('kingdoms')
      .values({
        id: kingdomId,
        instance_id: instanceId,
        kind: 'NPC',
        npc_faction_id: factionId,
        name_parts: JSON.stringify(name),
        color,
        region_count: faction.cells.length,
        founded_at: gameNow,
      })
      .execute();
    const ids = faction.cells.map((cell) => regionIds.get(axialKey(cell)) as string);
    const capitalId = ids[0] as string;
    await tx
      .updateTable('region_state')
      .set({
        owner_kingdom_id: kingdomId,
        is_capital: sql<boolean>`region_id = ${capitalId}`,
        owned_since: gameNow,
        updated_at: gameNow,
      })
      .where('region_id', 'in', ids)
      .execute();
    await tx
      .insertInto('kingdom_statistics')
      .values({ kingdom_id: kingdomId, max_regions: ids.length, updated_at: gameNow })
      .execute();
    await tx
      .insertInto('kingdom_history')
      .values({
        kingdom_id: kingdomId,
        kind: 'FOUNDED',
        payload: JSON.stringify({
          source: 'WORLD_CREATED',
          capitalRegionId: capitalId,
          regions: ids.length,
        }),
        at: gameNow,
      })
      .execute();
  }

  return {
    worldId,
    instanceId,
    rulesId,
    regions: cells.length,
    factions: factions.map((f) => ({ archetype: f.archetype, regions: f.cells.length })),
  };
}
