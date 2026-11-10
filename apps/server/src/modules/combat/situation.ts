import type { Db } from '@rdw/db';
import { checkAttackEligibility, neighbors, type AttackEligibility } from '@rdw/game-core';
import { parseRulesConfig, type AttackEligibilityDto, type RulesConfig } from '@rdw/protocol';
import { sql } from 'kysely';
import { ApiError } from '../../infra/errors.ts';

/**
 * Lage vor einem Angriff (GAME_RULES §4): sammelt alle Eingaben der Berechtigungsprüfung. Beim
 * Angriff läuft das in der Transaktion nach den Sperren (SIEGE_SYSTEM §5.1), für die
 * Regionsdetails ohne Sperren.
 */

export interface TargetRegion {
  readonly id: string;
  readonly q: number;
  readonly r: number;
  readonly tier: number;
  readonly chunkX: number;
  readonly chunkY: number;
  readonly ownerKingdomId: string | null;
  readonly activeSiegeId: string | null;
}

export interface DefenderKingdom {
  readonly id: string;
  readonly kind: 'PLAYER' | 'NPC';
  readonly npcFactionId: string | null;
}

export interface AttackSituation {
  readonly now: Date;
  readonly rules: RulesConfig;
  readonly rulesId: string;
  readonly configHash: string;
  readonly target: TargetRegion;
  readonly attacker: { readonly id: string; readonly regionCount: number } | null;
  readonly defender: DefenderKingdom | null;
  readonly eligibility: AttackEligibility;
}

export async function loadAttackSituation(
  db: Db,
  params: { readonly instanceId: string; readonly userId: string; readonly regionId: string },
): Promise<AttackSituation> {
  const instance = await db
    .selectFrom('world_instances as i')
    .innerJoin('world_rules as wr', 'wr.id', 'i.rules_id')
    .select([
      'i.status',
      'wr.id as rules_id',
      'wr.config',
      'wr.config_hash',
      sql<Date>`game_now()`.as('now'),
    ])
    .where('i.id', '=', params.instanceId)
    .executeTakeFirst();
  if (!instance) throw new ApiError(404, 'NOT_FOUND', 'Instanz nicht gefunden');
  const rules = parseRulesConfig(instance.config);
  const now = instance.now;

  const target = await db
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
      's.protected_until',
      's.active_siege_id',
    ])
    .where('r.id', '=', params.regionId)
    .where('r.instance_id', '=', params.instanceId)
    .executeTakeFirst();
  if (!target) throw new ApiError(404, 'NOT_FOUND', 'Region nicht gefunden');

  const attacker = await db
    .selectFrom('kingdoms')
    .select(['id', 'region_count'])
    .where('instance_id', '=', params.instanceId)
    .where('owner_user_id', '=', params.userId)
    .where('kind', '=', 'PLAYER')
    .where('status', '=', 'ACTIVE')
    .executeTakeFirst();

  const defenderRow = target.owner_kingdom_id
    ? await db
        .selectFrom('kingdoms')
        .select(['id', 'kind', 'region_count', 'protected_until', 'npc_faction_id'])
        .where('id', '=', target.owner_kingdom_id)
        .executeTakeFirstOrThrow()
    : null;

  let adjacent = false;
  let challengeInProgress = false;
  let pveAttemptTimes: number[] = [];
  if (attacker) {
    const around = neighbors(target);
    const neighbor = await db
      .selectFrom('regions as r')
      .innerJoin('region_state as s', 's.region_id', 'r.id')
      .select('r.id')
      .where('r.instance_id', '=', params.instanceId)
      .where('s.owner_kingdom_id', '=', attacker.id)
      .where((eb) => eb.or(around.map((n) => eb.and([eb('r.q', '=', n.q), eb('r.r', '=', n.r)]))))
      .limit(1)
      .executeTakeFirst();
    adjacent = neighbor !== undefined;

    const running = await db
      .selectFrom('sieges')
      .select('id')
      .where('attacker_kingdom_id', '=', attacker.id)
      .where('status', '=', 'PREPARING')
      .limit(1)
      .executeTakeFirst();
    challengeInProgress = running !== undefined;

    const budget = rules.attack.maxPveAttemptsPerPlayer;
    const attempts = await db
      .selectFrom('sieges as s')
      .innerJoin('kingdoms as k', 'k.id', 's.attacker_kingdom_id')
      .select('s.attack_presented_at')
      .where('k.instance_id', '=', params.instanceId)
      .where('k.owner_user_id', '=', params.userId)
      .where('s.mode', '=', 'PVE')
      .where('s.attack_presented_at', '>', new Date(now.getTime() - budget.windowMs))
      .execute();
    pveAttemptTimes = attempts.flatMap((a) =>
      a.attack_presented_at ? [a.attack_presented_at.getTime()] : [],
    );
  }

  const eligibility = checkAttackEligibility({
    now: now.getTime(),
    instanceRunning: instance.status === 'RUNNING',
    attacker: attacker ? { id: attacker.id, regionCount: attacker.region_count } : null,
    target: {
      ownerKingdomId: target.owner_kingdom_id,
      protectedUntil: target.protected_until?.getTime() ?? null,
      underSiege: target.active_siege_id !== null,
    },
    defender: defenderRow
      ? {
          kind: defenderRow.kind === 'NPC' ? 'NPC' : 'PLAYER',
          regionCount: defenderRow.region_count,
          protectedUntil: defenderRow.protected_until?.getTime() ?? null,
        }
      : null,
    adjacent,
    challengeInProgress,
    pveAttemptTimes,
    rules: {
      maxPveAttemptsPerPlayer: rules.attack.maxPveAttemptsPerPlayer,
      rankGap: rules.protection.rankGap,
    },
  });

  return {
    now,
    rules,
    rulesId: instance.rules_id,
    configHash: instance.config_hash,
    target: {
      id: target.id,
      q: target.q,
      r: target.r,
      tier: target.tier,
      chunkX: target.chunk_x,
      chunkY: target.chunk_y,
      ownerKingdomId: target.owner_kingdom_id,
      activeSiegeId: target.active_siege_id,
    },
    attacker: attacker ? { id: attacker.id, regionCount: attacker.region_count } : null,
    defender: defenderRow
      ? {
          id: defenderRow.id,
          kind: defenderRow.kind === 'NPC' ? 'NPC' : 'PLAYER',
          npcFactionId: defenderRow.npc_faction_id,
        }
      : null,
    eligibility,
  };
}

/** Darstellung für die Regionsdetails; PvP folgt mit Phase 2 und gilt bis dahin als nicht möglich. */
export function eligibilityDto(eligibility: AttackEligibility): AttackEligibilityDto {
  if (eligibility.ok) {
    if (eligibility.mode === 'PVP') {
      return {
        allowed: false,
        mode: 'PVP',
        defenderKind: eligibility.defenderKind,
        reason: 'PVP_NOT_AVAILABLE',
        until: null,
      };
    }
    return {
      allowed: true,
      mode: eligibility.mode,
      defenderKind: eligibility.defenderKind,
      reason: null,
      until: null,
    };
  }
  const until = eligibility.details.until ?? eligibility.details.resetAt;
  return {
    allowed: false,
    mode: null,
    defenderKind: null,
    reason: eligibility.refusal,
    until: until === undefined ? null : new Date(until).toISOString(),
  };
}

/** Fachlicher Fehler für eine abgelehnte Berechtigung (API.md §5). */
export function refusalError(eligibility: AttackEligibility): ApiError | null {
  const dto = eligibilityDto(eligibility);
  if (dto.allowed) return null;
  const reason = dto.reason ?? 'VALIDATION_FAILED';
  const status = reason === 'NO_ACTIVE_KINGDOM' ? 403 : 409;
  const details: Record<string, unknown> = dto.until ? { until: dto.until } : {};
  if (reason === 'ATTACKER_ATTEMPT_LIMIT' && dto.until) details.resetAt = dto.until;
  return new ApiError(status, reason, `Angriff nicht möglich: ${reason}`, details);
}
