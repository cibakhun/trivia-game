import type { Db } from '@rdw/db';
import { kingdomName, kingdomRank } from '@rdw/game-core';
import type { KingdomProfile, KingdomSummary } from '@rdw/protocol';
import { sql } from 'kysely';

/**
 * Lesesicht auf Reiche (Modul kingdom, ARCHITECTURE §6). Schutzzeiten, die schon abgelaufen
 * sind, erscheinen als `null`, damit Clients nicht mit eigener Uhr vergleichen müssen.
 */

const ARCHETYPES = new Set(['LIGHT', 'MEDIUM', 'HEAVY'] as const);
const PROTECTION_REASONS = new Set(['NEWBIE', 'RESPAWN', 'VACATION'] as const);
const STATUSES = new Set(['ACTIVE', 'FALLEN', 'DISSOLVED'] as const);

function member<T extends string>(
  set: ReadonlySet<T>,
  value: string | null,
  what: string,
): T | null {
  if (value === null) return null;
  if (!set.has(value as T)) throw new Error(`Unerwarteter Wert für ${what}: ${value}`);
  return value as T;
}

function nameParts(value: unknown): { prefix: string; suffix: string } {
  const parts = value as { prefix?: unknown; suffix?: unknown } | null;
  if (typeof parts?.prefix !== 'string' || typeof parts.suffix !== 'string') {
    throw new Error('kingdoms.name_parts ohne prefix/suffix');
  }
  return { prefix: parts.prefix, suffix: parts.suffix };
}

function kingdomQuery(db: Db, instanceId: string) {
  return db
    .selectFrom('kingdoms as k')
    .leftJoin('npc_factions as f', 'f.id', 'k.npc_faction_id')
    .leftJoin('region_state as c', (join) =>
      join.onRef('c.owner_kingdom_id', '=', 'k.id').on('c.is_capital', '=', true),
    )
    .select([
      'k.id',
      'k.kind',
      'k.name_parts',
      'k.color',
      'k.status',
      'k.region_count',
      'k.generation',
      'k.founded_at',
      'f.archetype',
      'c.region_id as capital_region_id',
      sql<Date | null>`case when k.protected_until > game_now() then k.protected_until end`.as(
        'protected_until',
      ),
      sql<string | null>`case when k.protected_until > game_now() then k.protection_reason end`.as(
        'protection_reason',
      ),
    ])
    .where('k.instance_id', '=', instanceId);
}

type KingdomRow = Awaited<ReturnType<ReturnType<typeof kingdomQuery>['executeTakeFirstOrThrow']>>;

function toProfile(row: KingdomRow): KingdomProfile {
  const parts = nameParts(row.name_parts);
  const kind = row.kind === 'NPC' ? 'NPC' : 'PLAYER';
  return {
    id: row.id,
    kind,
    name: kingdomName(parts),
    nameParts: parts,
    color: row.color,
    status: member(STATUSES, row.status, 'status') ?? 'ACTIVE',
    regionCount: row.region_count,
    rank: kingdomRank(row.region_count),
    archetype: member(ARCHETYPES, row.archetype, 'archetype'),
    capitalRegionId: row.capital_region_id,
    protectedUntil: row.protected_until?.toISOString() ?? null,
    protectionReason: member(PROTECTION_REASONS, row.protection_reason, 'protection_reason'),
    foundedAt: row.founded_at.toISOString(),
    generation: row.generation,
  };
}

export function toSummary(profile: KingdomProfile): KingdomSummary {
  return {
    id: profile.id,
    kind: profile.kind,
    name: profile.name,
    nameParts: profile.nameParts,
    color: profile.color,
    status: profile.status,
    regionCount: profile.regionCount,
    rank: profile.rank,
    archetype: profile.archetype,
    capitalRegionId: profile.capitalRegionId,
    protectedUntil: profile.protectedUntil,
    protectionReason: profile.protectionReason,
  };
}

/** Reiche einer Instanz nach ID; unbekannte IDs fehlen in der Antwort. */
export async function loadKingdoms(
  db: Db,
  instanceId: string,
  ids: readonly string[],
): Promise<Map<string, KingdomSummary>> {
  if (ids.length === 0) return new Map();
  const rows = await kingdomQuery(db, instanceId)
    .where('k.id', 'in', [...new Set(ids)])
    .execute();
  return new Map(rows.map((row) => [row.id, toSummary(toProfile(row))]));
}

export async function loadKingdomProfile(
  db: Db,
  instanceId: string,
  kingdomId: string,
): Promise<KingdomProfile | null> {
  const row = await kingdomQuery(db, instanceId).where('k.id', '=', kingdomId).executeTakeFirst();
  return row ? toProfile(row) : null;
}
