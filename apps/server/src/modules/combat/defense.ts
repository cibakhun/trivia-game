import type { Db } from '@rdw/db';
import { canStartDefense } from '@rdw/game-core';
import type { DefenseResponse, SiegeStatus, SiegeSummary, SiegesResponse } from '@rdw/protocol';
import { sql } from 'kysely';
import { readGameNow } from '../../infra/clock.ts';
import { ApiError } from '../../infra/errors.ts';
import { appendBattleEvents, insertWorldEvents } from '../../infra/events.ts';
import { loadKingdoms } from '../kingdom/queries.ts';
import { loadHead, presentDefenseQuestion } from '../quiz/challenge.ts';
import { OPEN_SIEGE_STATUSES, settleSiege } from './settle.ts';
import { hasChallengeInProgress } from './situation.ts';
import { parseSnapshot, pvpOf, type SiegeRulesSnapshot } from './snapshot.ts';

/**
 * PvP-Verteidigung (SIEGE_SYSTEM §4 und §6.2, API.md §2.3): Der Verteidiger beginnt die
 * Verteidigung einer eröffneten Belagerung; die Wissensfrage ist ab diesem Moment gestellt.
 * Dazu die Belagerungsübersicht eines Spielers (§9).
 */

/** Grund, warum eine Verteidigung jetzt nicht beginnen kann; `null`: sie kann beginnen. */
function defenseBlock(
  deadlineAt: Date,
  now: Date,
  snapshot: SiegeRulesSnapshot,
): 'DEADLINE_PASSED' | 'DEADLINE_TOO_CLOSE' | null {
  const check = canStartDefense(deadlineAt.getTime(), now.getTime(), {
    defense: { startBuffer: pvpOf(snapshot).startBuffer },
    quiz: snapshot.quiz,
  });
  return check.ok ? null : check.error;
}

/**
 * Verteidigung beginnen. Sperrreihenfolge wie bei der Auswertung (Reiche → Region → Belagerung).
 * Eine Wiederholung durch denselben Verteidiger liefert die gestellte Frage erneut (als Reload,
 * QUIZ_ENGINE §6.2), ohne die Belagerung zu ändern.
 */
export async function startDefense(
  db: Db,
  params: { readonly userId: string; readonly siegeId: string },
): Promise<DefenseResponse> {
  const head = await db
    .selectFrom('sieges as s')
    .innerJoin('siege_participants as p', (join) =>
      join.onRef('p.siege_id', '=', 's.id').on('p.role', '=', 'DEFENDER'),
    )
    .innerJoin('quiz_challenges as c', 'c.siege_id', 's.id')
    .select([
      's.mode',
      's.opened_at',
      's.attacker_kingdom_id',
      's.defender_kingdom_id',
      's.target_region_id',
      'c.id as challenge_id',
    ])
    .where('s.id', '=', params.siegeId)
    .where('p.user_id', '=', params.userId)
    .executeTakeFirst();
  // Vor der Eröffnung ist die Belagerung für den Verteidiger unsichtbar (verdecktes Gate).
  if (!head || head.mode !== 'PVP' || head.opened_at === null || !head.defender_kingdom_id) {
    throw new ApiError(404, 'NOT_FOUND', 'Belagerung nicht gefunden');
  }
  const defenderKingdomId = head.defender_kingdom_id;
  // Fristablauf oder Abbruch (N10) zuerst auswerten
  await settleSiege(db, params.siegeId);

  return db.transaction().execute(async (tx) => {
    await tx
      .selectFrom('kingdoms')
      .select('id')
      .where('id', 'in', [head.attacker_kingdom_id, defenderKingdomId].sort())
      .orderBy('id')
      .forUpdate()
      .execute();
    await tx
      .selectFrom('region_state')
      .select('region_id')
      .where('region_id', '=', head.target_region_id)
      .forUpdate()
      .execute();
    const siege = await tx
      .selectFrom('sieges')
      .select(['instance_id', 'status', 'version', 'deadline_at', 'rules_snapshot'])
      .where('id', '=', params.siegeId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const now = await readGameNow(tx);
    const challenge = await loadHead(tx, head.challenge_id, params.userId);

    if (siege.status === 'DEFENDING') {
      const question = await presentDefenseQuestion(tx, challenge, now);
      return {
        siegeId: params.siegeId,
        challengeId: challenge.challengeId,
        question,
        serverTime: now.toISOString(),
      };
    }
    if (siege.status !== 'AWAITING_DEFENSE' || !siege.deadline_at) {
      throw new ApiError(409, 'CHALLENGE_CLOSED', 'Belagerung ist beendet', {
        status: siege.status,
      });
    }
    const snapshot = parseSnapshot(siege.rules_snapshot);
    const block = defenseBlock(siege.deadline_at, now, snapshot);
    if (block === 'DEADLINE_PASSED') {
      throw new ApiError(409, 'DEADLINE_PASSED', 'Die Frist ist abgelaufen', {
        deadlineAt: siege.deadline_at.toISOString(),
      });
    }
    if (block === 'DEADLINE_TOO_CLOSE') {
      throw new ApiError(409, 'DEADLINE_TOO_CLOSE', 'Zu wenig Zeit bis zum Fristende', {
        deadlineAt: siege.deadline_at.toISOString(),
      });
    }
    // Eine Herausforderung zur Zeit: eigener Angriff in Vorbereitung oder andere Verteidigung
    if (await hasChallengeInProgress(tx, defenderKingdomId)) {
      throw new ApiError(409, 'CHALLENGE_IN_PROGRESS', 'Erst die laufende Herausforderung beenden');
    }
    const updated = await tx
      .updateTable('sieges')
      .set({
        status: 'DEFENDING',
        defense_started_at: now,
        version: sql<number>`version + 1`,
      })
      .where('id', '=', params.siegeId)
      .where('status', '=', 'AWAITING_DEFENSE')
      .where('version', '=', siege.version)
      .executeTakeFirst();
    if (updated.numUpdatedRows !== 1n) throw new Error(`Belagerung ${params.siegeId}: geändert`);
    const question = await presentDefenseQuestion(tx, { ...challenge, status: 'DEFENDING' }, now);
    await appendBattleEvents(tx, params.siegeId, [
      { type: 'DEFENSE_STARTED', payload: { deadlineAt: siege.deadline_at.toISOString() } },
    ]);
    const attacker = await tx
      .selectFrom('kingdoms')
      .select('owner_user_id')
      .where('id', '=', head.attacker_kingdom_id)
      .executeTakeFirstOrThrow();
    if (attacker.owner_user_id) {
      await insertWorldEvents(tx, siege.instance_id, [
        {
          type: 'siege.updated',
          userId: attacker.owner_user_id,
          payload: {
            siegeId: params.siegeId,
            status: 'DEFENDING',
            defenseStartedAt: now.toISOString(),
            role: 'ATTACKER',
          },
        },
      ]);
    }
    return {
      siegeId: params.siegeId,
      challengeId: challenge.challengeId,
      question,
      serverTime: now.toISOString(),
    };
  });
}

/** Wie lange beendete Kämpfe in der Übersicht bleiben und wie viele höchstens. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 10;

/**
 * Belagerungsübersicht (SIEGE_SYSTEM §9): eingehende (eröffnete PvP-Belagerungen gegen Reiche des
 * Spielers), eigene offene Angriffe und die Kämpfe der letzten 24 Stunden. Fällige Kämpfe löst
 * der Aufrufer vorher auf. Vor der Eröffnung bleibt ein Angriff für den Verteidiger unsichtbar.
 */
export async function listSieges(
  db: Db,
  params: { readonly userId: string; readonly instanceId: string },
): Promise<SiegesResponse> {
  const now = await readGameNow(db);
  const rows = await db
    .selectFrom('sieges as s')
    .innerJoin('quiz_challenges as c', 'c.siege_id', 's.id')
    .innerJoin('regions as r', (join) =>
      join.onRef('r.id', '=', 's.target_region_id').onRef('r.instance_id', '=', 's.instance_id'),
    )
    .innerJoin('region_state as rs', 'rs.region_id', 's.target_region_id')
    .innerJoin('kingdoms as ak', 'ak.id', 's.attacker_kingdom_id')
    .leftJoin('kingdoms as dk', 'dk.id', 's.defender_kingdom_id')
    .leftJoin('battle_results as b', 'b.siege_id', 's.id')
    .select([
      's.id',
      's.mode',
      's.status',
      's.target_region_id',
      's.attacker_kingdom_id',
      's.defender_kingdom_id',
      's.created_at',
      's.opened_at',
      's.deadline_at',
      's.defense_started_at',
      's.resolved_at',
      's.outcome',
      's.outcome_reason',
      's.rules_snapshot',
      'c.id as challenge_id',
      'r.q',
      'r.r',
      'r.biome',
      'r.tier',
      'rs.is_capital',
      'b.defense_points',
      sql<boolean>`ak.owner_user_id = ${params.userId}`.as('is_attacker'),
    ])
    .where('s.instance_id', '=', params.instanceId)
    .where((eb) =>
      eb.or([
        eb('ak.owner_user_id', '=', params.userId),
        eb.and([eb('dk.owner_user_id', '=', params.userId), eb('s.opened_at', 'is not', null)]),
      ]),
    )
    .where((eb) =>
      eb.or([
        eb('s.status', 'in', [...OPEN_SIEGE_STATUSES]),
        eb('s.resolved_at', '>', new Date(now.getTime() - RECENT_WINDOW_MS)),
      ]),
    )
    .orderBy('s.created_at', 'desc')
    .execute();

  const kingdoms = await loadKingdoms(
    db,
    params.instanceId,
    rows.flatMap((row) =>
      row.defender_kingdom_id
        ? [row.attacker_kingdom_id, row.defender_kingdom_id]
        : [row.attacker_kingdom_id],
    ),
  );
  // Eigene Reiche mit laufender Herausforderung blockieren eine weitere Verteidigung
  const busy = new Map<string, boolean>();
  const isBusy = async (kingdomId: string) => {
    if (!busy.has(kingdomId)) busy.set(kingdomId, await hasChallengeInProgress(db, kingdomId));
    return busy.get(kingdomId) === true;
  };

  const incoming: SiegeSummary[] = [];
  const outgoing: SiegeSummary[] = [];
  const recent: SiegeSummary[] = [];
  for (const row of rows) {
    const attacker = kingdoms.get(row.attacker_kingdom_id);
    if (!attacker) throw new Error(`Belagerung ${row.id}: Angreiferreich fehlt`);
    const role = row.is_attacker ? 'ATTACKER' : 'DEFENDER';
    const status = row.status as SiegeStatus;
    const open = (OPEN_SIEGE_STATUSES as readonly string[]).includes(status);
    let defendBlockedBy: SiegeSummary['defendBlockedBy'] = null;
    let canDefend = false;
    if (role === 'DEFENDER' && status === 'AWAITING_DEFENSE' && row.deadline_at) {
      const block = defenseBlock(row.deadline_at, now, parseSnapshot(row.rules_snapshot));
      if (block !== null) defendBlockedBy = 'DEADLINE_TOO_CLOSE';
      else if (row.defender_kingdom_id && (await isBusy(row.defender_kingdom_id))) {
        defendBlockedBy = 'CHALLENGE_IN_PROGRESS';
      } else canDefend = true;
    }
    const summary: SiegeSummary = {
      siegeId: row.id,
      challengeId: row.challenge_id,
      mode: row.mode === 'PVP' ? 'PVP' : 'PVE',
      role,
      status,
      regionId: row.target_region_id,
      region: { q: row.q, r: row.r, biome: row.biome, tier: row.tier, isCapital: row.is_capital },
      attacker,
      defender: row.defender_kingdom_id ? (kingdoms.get(row.defender_kingdom_id) ?? null) : null,
      createdAt: row.created_at.toISOString(),
      openedAt: row.opened_at?.toISOString() ?? null,
      deadlineAt: row.deadline_at?.toISOString() ?? null,
      remainingMs:
        open && row.deadline_at ? Math.max(0, row.deadline_at.getTime() - now.getTime()) : null,
      defenseStartedAt: row.defense_started_at?.toISOString() ?? null,
      canDefend,
      defendBlockedBy,
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      winner: (row.outcome as SiegeSummary['winner']) ?? null,
      reason: (row.outcome_reason as SiegeSummary['reason']) ?? null,
      defensePoints: row.defense_points ?? null,
    };
    if (!open) {
      if (recent.length < RECENT_LIMIT) recent.push(summary);
    } else if (role === 'DEFENDER') incoming.push(summary);
    else outgoing.push(summary);
  }
  // Dringendste zuerst: kürzeste Restzeit (ohne Frist ans Ende)
  const byUrgency = (a: SiegeSummary, b: SiegeSummary) =>
    (a.remainingMs ?? Number.MAX_SAFE_INTEGER) - (b.remainingMs ?? Number.MAX_SAFE_INTEGER);
  incoming.sort(byUrgency);
  outgoing.sort(byUrgency);
  recent.sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
  return {
    instanceId: params.instanceId,
    incoming,
    outgoing,
    recent,
    serverTime: now.toISOString(),
  };
}
