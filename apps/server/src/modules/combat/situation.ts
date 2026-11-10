import type { Db } from '@rdw/db';
import {
  NO_PVP_COUNTS,
  checkAttackEligibility,
  neighbors,
  type AttackEligibility,
  type PvpCounts,
} from '@rdw/game-core';
import {
  capitalRules,
  parseRulesConfig,
  type AttackEligibilityDto,
  type RulesConfig,
} from '@rdw/protocol';
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
  readonly isCapital: boolean;
}

export interface DefenderKingdom {
  readonly id: string;
  readonly kind: 'PLAYER' | 'NPC';
  readonly npcFactionId: string | null;
  /** Besitzer eines Spielerreichs (Verteidiger im PvP). */
  readonly ownerUserId: string | null;
}

export interface AttackSituation {
  readonly now: Date;
  readonly rules: RulesConfig;
  readonly rulesId: string;
  readonly configHash: string;
  readonly target: TargetRegion;
  readonly attacker: {
    readonly id: string;
    readonly regionCount: number;
    readonly protectionReason: string | null;
  } | null;
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
      's.is_capital',
    ])
    .where('r.id', '=', params.regionId)
    .where('r.instance_id', '=', params.instanceId)
    .executeTakeFirst();
  if (!target) throw new ApiError(404, 'NOT_FOUND', 'Region nicht gefunden');

  const attacker = await db
    .selectFrom('kingdoms')
    .select(['id', 'region_count', 'protected_until', 'protection_reason'])
    .where('instance_id', '=', params.instanceId)
    .where('owner_user_id', '=', params.userId)
    .where('kind', '=', 'PLAYER')
    .where('status', '=', 'ACTIVE')
    .executeTakeFirst();

  const defenderRow = target.owner_kingdom_id
    ? await db
        .selectFrom('kingdoms')
        .select([
          'id',
          'kind',
          'region_count',
          'protected_until',
          'npc_faction_id',
          'owner_user_id',
        ])
        .where('id', '=', target.owner_kingdom_id)
        .executeTakeFirstOrThrow()
    : null;

  let adjacent = false;
  let challengeInProgress = false;
  let pveAttemptTimes: number[] = [];
  let pvp: PvpCounts = NO_PVP_COUNTS;
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

    challengeInProgress = await hasChallengeInProgress(db, attacker.id);

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
    if (defenderRow?.kind === 'PLAYER') {
      pvp = await loadPvpCounts(db, {
        instanceId: params.instanceId,
        userId: params.userId,
        attackerKingdomId: attacker.id,
        defenderKingdomId: defenderRow.id,
        targetRegionId: target.is_capital ? target.id : null,
        now,
        rules,
      });
    }
  }

  const eligibility = checkAttackEligibility({
    now: now.getTime(),
    instanceRunning: instance.status === 'RUNNING',
    attacker: attacker
      ? {
          id: attacker.id,
          regionCount: attacker.region_count,
          protectedUntil: attacker.protected_until?.getTime() ?? null,
        }
      : null,
    target: {
      ownerKingdomId: target.owner_kingdom_id,
      protectedUntil: target.protected_until?.getTime() ?? null,
      underSiege: target.active_siege_id !== null,
      isCapital: target.is_capital,
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
    pvp,
    rules: {
      maxPveAttemptsPerPlayer: rules.attack.maxPveAttemptsPerPlayer,
      rankGap: rules.protection.rankGap,
      maxNewPvpSiegesPerAttacker: rules.attack.maxNewPvpSiegesPerAttacker,
      maxPvpAttemptsPerAttacker: rules.attack.maxPvpAttemptsPerAttacker,
      maxOpenSiegesPerDefender: rules.attack.maxOpenSiegesPerDefender,
      capitalHitCooldownPerAttacker: capitalRules(rules).hitCooldownPerAttacker,
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
      isCapital: target.is_capital,
    },
    attacker: attacker
      ? {
          id: attacker.id,
          regionCount: attacker.region_count,
          protectionReason:
            attacker.protected_until && attacker.protected_until > now
              ? attacker.protection_reason
              : null,
        }
      : null,
    defender: defenderRow
      ? {
          id: defenderRow.id,
          kind: defenderRow.kind === 'NPC' ? 'NPC' : 'PLAYER',
          npcFactionId: defenderRow.npc_faction_id,
          ownerUserId: defenderRow.owner_user_id,
        }
      : null,
    eligibility,
  };
}

/**
 * Bearbeitet das Reich gerade eine Herausforderung (GAME_RULES §7: höchstens eine je Spieler)?
 * Ein eigener Angriff in Vorbereitung oder eine begonnene Verteidigung.
 */
export async function hasChallengeInProgress(db: Db, kingdomId: string): Promise<boolean> {
  const running = await db
    .selectFrom('sieges')
    .select('id')
    .where((eb) =>
      eb.or([
        eb.and([eb('attacker_kingdom_id', '=', kingdomId), eb('status', '=', 'PREPARING')]),
        eb.and([eb('defender_kingdom_id', '=', kingdomId), eb('status', '=', 'DEFENDING')]),
      ]),
    )
    .limit(1)
    .executeTakeFirst();
  return running !== undefined;
}

/** Zählungen für einen PvP-Angriff (SIEGE_SYSTEM §7), im gleitenden Fenster der Regeln. */
async function loadPvpCounts(
  db: Db,
  params: {
    readonly instanceId: string;
    readonly userId: string;
    readonly attackerKingdomId: string;
    readonly defenderKingdomId: string;
    /** Zielregion, falls sie die Hauptstadt des Zielreichs ist. */
    readonly targetRegionId: string | null;
    readonly now: Date;
    readonly rules: RulesConfig;
  },
): Promise<PvpCounts> {
  const { now, rules } = params;
  const since = (windowMs: number) => new Date(now.getTime() - windowMs);
  // Belagerungen und Versuche zählen je Spieler in der Instanz, auch über ein neues Reich hinweg
  const own = db
    .selectFrom('sieges as s')
    .innerJoin('kingdoms as k', 'k.id', 's.attacker_kingdom_id')
    .where('k.instance_id', '=', params.instanceId)
    .where('k.owner_user_id', '=', params.userId)
    .where('s.mode', '=', 'PVP');
  const opened = await own
    .select('s.opened_at')
    .where('s.opened_at', '>', since(rules.attack.maxNewPvpSiegesPerAttacker.windowMs))
    .execute();
  const attempts = await own
    .select('s.attack_presented_at')
    .where('s.attack_presented_at', '>', since(rules.attack.maxPvpAttemptsPerAttacker.windowMs))
    .execute();
  const { open } = await db
    .selectFrom('sieges')
    .select((eb) => eb.fn.countAll<string>().as('open'))
    .where('defender_kingdom_id', '=', params.defenderKingdomId)
    .where('status', 'in', ['PREPARING', 'AWAITING_DEFENSE', 'DEFENDING'])
    .executeTakeFirstOrThrow();
  let lastCapitalHitAt: number | null = null;
  if (params.targetRegionId !== null) {
    const hit = await db
      .selectFrom('battle_results as b')
      .innerJoin('sieges as s', 's.id', 'b.siege_id')
      .select((eb) => eb.fn.max('b.decided_at').as('at'))
      .where('s.attacker_kingdom_id', '=', params.attackerKingdomId)
      .where('s.defender_kingdom_id', '=', params.defenderKingdomId)
      .where('s.target_region_id', '=', params.targetRegionId)
      .where('b.capital_lives_left', 'is not', null)
      .executeTakeFirst();
    lastCapitalHitAt = hit?.at ? new Date(hit.at).getTime() : null;
  }
  return {
    openedTimes: opened.flatMap((row) => (row.opened_at ? [row.opened_at.getTime()] : [])),
    attemptTimes: attempts.flatMap((row) =>
      row.attack_presented_at ? [row.attack_presented_at.getTime()] : [],
    ),
    openSiegesAgainstDefender: Number(open),
    lastCapitalHitAt,
  };
}

/** Darstellung für die Regionsdetails. */
export function eligibilityDto(eligibility: AttackEligibility): AttackEligibilityDto {
  if (eligibility.ok) {
    return {
      allowed: true,
      mode: eligibility.mode,
      defenderKind: eligibility.defenderKind,
      reason: null,
      until: null,
      endsOwnProtection: eligibility.endsOwnProtection,
    };
  }
  const until = eligibility.details.until ?? eligibility.details.resetAt;
  return {
    allowed: false,
    mode: null,
    defenderKind: null,
    reason: eligibility.refusal,
    until: until === undefined ? null : new Date(until).toISOString(),
    endsOwnProtection: false,
  };
}

/** Fachlicher Fehler für eine abgelehnte Berechtigung (API.md §5). */
export function refusalError(eligibility: AttackEligibility): ApiError | null {
  if (eligibility.ok) return null;
  const dto = eligibilityDto(eligibility);
  const reason = dto.reason ?? 'VALIDATION_FAILED';
  const status = reason === 'NO_ACTIVE_KINGDOM' ? 403 : 409;
  const details: Record<string, unknown> = dto.until ? { until: dto.until } : {};
  if (eligibility.details.resetAt !== undefined && dto.until) details.resetAt = dto.until;
  return new ApiError(status, reason, `Angriff nicht möglich: ${reason}`, details);
}
