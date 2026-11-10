import type { Db, Tx } from '@rdw/db';
import {
  CHALLENGE_START_WINDOW_MS,
  CORE_VERSION,
  chooseNewCapital,
  estimateDecides,
  formatDecimal,
  kingdomRank,
  parseDecimal,
  performanceFromSteps,
  resolveDuel,
  siegeEndState,
  type Performance,
} from '@rdw/game-core';
import { sql } from 'kysely';
import { gameNow, intervalMs } from '../../infra/clock.ts';
import { appendBattleEvents, insertWorldEvents, type WorldEvent } from '../../infra/events.ts';
import { parseSnapshot } from './snapshot.ts';

/**
 * Abschluss eines PvE-Kampfes (SIEGE_SYSTEM §2 Schritt 3–4, §5.3): abgelaufene Schritte auf
 * `TIMED_OUT` setzen, nie begonnene Herausforderungen beenden, vollständige auswerten und die
 * Wirkungen schreiben – in einer Transaktion mit fester Sperrreihenfolge
 * (Reiche → Region → Belagerung). Jeder Aufruf ist idempotent: Ist die Belagerung schon beendet
 * oder noch nicht fertig, ändert er nichts. Aufrufer: letzte Antwort, Lesezugriffe („lazy
 * resolution“), neuer Angriff desselben Spielers und der Aufräumlauf.
 */

export type SettleResult = 'RESOLVED' | 'PENDING' | 'NOOP';

type EndStatus = 'ATTACKER_WON' | 'DEFENDER_WON' | 'ATTACK_FAILED' | 'CANCELLED';

interface AnswerRow {
  readonly step_index: number;
  readonly status: string;
  readonly is_correct: boolean | null;
  readonly distance: string | null;
  readonly effective_ms: number | null;
  readonly answer_option_key: string | null;
  readonly answer_value: string | null;
}

function performanceOf(rows: readonly AnswerRow[]): Performance {
  const done = (step: number) =>
    rows.find(
      (row) => row.step_index === step && (row.status === 'ANSWERED' || row.status === 'GENERATED'),
    );
  const trivia = done(0);
  const estimate = done(1);
  return performanceFromSteps(
    trivia ? { correct: trivia.is_correct === true } : null,
    estimate && estimate.distance !== null && estimate.effective_ms !== null
      ? { distance: parseDecimal(estimate.distance), effectiveMs: estimate.effective_ms }
      : null,
  );
}

function summary(rows: readonly AnswerRow[], perf: Performance | null): Record<string, unknown> {
  const step = (i: number) => rows.find((row) => row.step_index === i) ?? null;
  return {
    trivia: step(0)
      ? {
          status: step(0)?.status,
          optionKey: step(0)?.answer_option_key,
          correct: step(0)?.is_correct,
        }
      : null,
    estimate: step(1)
      ? {
          status: step(1)?.status,
          value: step(1)?.answer_value,
          distance: step(1)?.distance,
          effectiveMs: step(1)?.effective_ms,
        }
      : null,
    answeredBoth: perf?.answeredBoth ?? false,
  };
}

export async function settleSiege(db: Db, siegeId: string): Promise<SettleResult> {
  return db.transaction().execute((tx) => settleInTransaction(tx, siegeId));
}

async function settleInTransaction(tx: Tx, siegeId: string): Promise<SettleResult> {
  const head = await tx
    .selectFrom('sieges')
    .select(['status', 'mode', 'attacker_kingdom_id', 'defender_kingdom_id', 'target_region_id'])
    .where('id', '=', siegeId)
    .executeTakeFirst();
  if (!head || head.status !== 'PREPARING' || head.mode !== 'PVE') return 'NOOP';

  // 1. Sperren in fester Reihenfolge (SIEGE_SYSTEM §5.1)
  const kingdomIds = [head.attacker_kingdom_id, head.defender_kingdom_id]
    .filter((id): id is string => id !== null)
    .sort();
  const kingdoms = await tx
    .selectFrom('kingdoms')
    .select([
      'id',
      'kind',
      'status',
      'region_count',
      'owner_user_id',
      'npc_faction_id',
      'protection_reason',
    ])
    .where('id', 'in', kingdomIds)
    .orderBy('id')
    .forUpdate()
    .execute();
  const region = await tx
    .selectFrom('region_state as s')
    .innerJoin('regions as r', 'r.id', 's.region_id')
    .select([
      's.region_id',
      's.instance_id',
      's.chunk_x',
      's.chunk_y',
      's.owner_kingdom_id',
      's.is_capital',
      's.active_siege_id',
      'r.q',
      'r.r',
    ])
    .where('s.region_id', '=', head.target_region_id)
    .forUpdate('s')
    .executeTakeFirstOrThrow();
  const siege = await tx
    .selectFrom('sieges')
    .select([
      'id',
      'instance_id',
      'status',
      'version',
      'created_at',
      'attack_presented_at',
      'attacker_kingdom_id',
      'defender_kingdom_id',
      'defender_kind',
      'rules_snapshot',
      sql<Date>`game_now()`.as('now'),
    ])
    .where('id', '=', siegeId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (siege.status !== 'PREPARING') return 'NOOP';
  const snapshot = parseSnapshot(siege.rules_snapshot);
  const attackerKingdom = kingdoms.find((k) => k.id === siege.attacker_kingdom_id);
  const defenderKingdom = siege.defender_kingdom_id
    ? kingdoms.find((k) => k.id === siege.defender_kingdom_id)
    : undefined;
  if (!attackerKingdom) throw new Error(`Belagerung ${siegeId}: Angreiferreich fehlt`);

  // 2. Abgelaufene Schritte: erst ab answer_deadline_at + settleGrace (SIEGE_SYSTEM §6.1)
  await tx
    .updateTable('quiz_answers')
    .set({ status: 'TIMED_OUT' })
    .where('siege_id', '=', siegeId)
    .where('status', '=', 'PRESENTED')
    .where(
      sql<boolean>`answer_deadline_at + ${intervalMs(snapshot.defense.settleGrace)} <= game_now()`,
    )
    .execute();
  const answers = await tx
    .selectFrom('quiz_answers as a')
    .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
    .select([
      'p.role',
      'p.user_id',
      'a.step_index',
      'a.status',
      'a.is_correct',
      'a.distance',
      'a.effective_ms',
      'a.answer_option_key',
      'a.answer_value',
    ])
    .where('a.siege_id', '=', siegeId)
    .orderBy('a.step_index')
    .execute();
  const attackerRows = answers.filter((a) => a.role === 'ATTACKER');
  const defenderRows = answers.filter((a) => a.role === 'DEFENDER');
  const step0 = attackerRows.find((a) => a.step_index === 0);
  const step1 = attackerRows.find((a) => a.step_index === 1);

  // 3. Fertig? Nie begonnen: erste Frage nicht innerhalb des Startfensters abgerufen.
  const now = siege.now;
  let ending: { status: EndStatus; outcome: 'ATTACKER' | 'DEFENDER' | 'NONE'; reason: string };
  let attackerPerf: Performance | null = null;
  let defenderPerf: Performance | null = null;
  if (!step0) {
    if (now.getTime() < siege.created_at.getTime() + CHALLENGE_START_WINDOW_MS) return 'PENDING';
    // N10 gilt auf jedem Weg: ein nicht mehr aktives Angreiferreich bricht ab
    ending =
      attackerKingdom.status !== 'ACTIVE'
        ? { status: 'CANCELLED', outcome: 'NONE', reason: 'CANCELLED' }
        : { status: 'ATTACK_FAILED', outcome: 'NONE', reason: 'NEVER_STARTED' };
  } else {
    // Verpasst der Spieler die Trivia-Frage, endet die Herausforderung ohne Schätzfrage [E].
    // Die Schätzfrage entscheidet nur einen Gleichstand (beide richtig, GAME_RULES §5.2); sonst
    // steht der Ausgang nach der Trivia-Frage fest.
    const defenderStep0 = defenderRows.find((a) => a.step_index === 0);
    const decidedByTrivia =
      step0.status === 'ANSWERED' &&
      !estimateDecides(step0.is_correct === true, defenderStep0?.is_correct === true);
    const complete =
      step0.status === 'TIMED_OUT' ||
      decidedByTrivia ||
      step1?.status === 'ANSWERED' ||
      step1?.status === 'TIMED_OUT';
    if (!complete) return 'PENDING';
    if (attackerKingdom.status !== 'ACTIVE') {
      // N10: Angreiferreich nicht mehr aktiv
      ending = { status: 'CANCELLED', outcome: 'NONE', reason: 'CANCELLED' };
    } else {
      attackerPerf = performanceOf(attackerRows);
      defenderPerf = performanceOf(defenderRows);
      // Im PvE steht die Verteidigung vorab fest, `NO_DEFENSE` gibt es nicht (QUIZ_ENGINE §8).
      const outcome = resolveDuel(attackerPerf, defenderPerf);
      const status = siegeEndState(outcome);
      if (status !== 'ATTACKER_WON' && status !== 'DEFENDER_WON') {
        throw new Error(`PvE-Auswertung ergab ${status}`);
      }
      ending = { status, outcome: outcome.winner, reason: outcome.reason };
    }
  }

  // N12: Besitz und Reservierung müssen zur Belagerung passen; sonst ist eine Invariante verletzt.
  if (region.owner_kingdom_id !== siege.defender_kingdom_id || region.active_siege_id !== siegeId) {
    throw new Error(`Belagerung ${siegeId}: Region ${region.region_id} passt nicht (I3/N12)`);
  }

  // 4. Endzustand, Ergebnis, Protokoll
  const updated = await tx
    .updateTable('sieges')
    .set({
      status: ending.status,
      outcome: ending.outcome,
      outcome_reason: ending.reason,
      resolved_at: gameNow,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', siegeId)
    .where('version', '=', siege.version)
    .executeTakeFirst();
  if (updated.numUpdatedRows !== 1n) throw new Error(`Belagerung ${siegeId}: Version geändert`);
  const conquered = ending.status === 'ATTACKER_WON';
  const resolvedDuel = attackerPerf !== null;
  await tx
    .insertInto('battle_results')
    .values({
      siege_id: siegeId,
      winner_role: ending.outcome === 'NONE' ? null : ending.outcome,
      reason: ending.reason,
      attacker_summary: JSON.stringify(summary(attackerRows, attackerPerf)),
      defender_summary: JSON.stringify({
        kind: siege.defender_kind,
        ...summary(defenderRows, defenderPerf),
      }),
      // Im PvE verteidigen NPC oder Garnison mit ihren versiegelten Antworten; Punkte gibt es nur
      // für Spielerreiche (GAME_RULES §5.5).
      defended: resolvedDuel,
      defense_points: 0,
      decided_at: gameNow,
      core_version: CORE_VERSION,
    })
    .execute();

  const events: WorldEvent[] = [];
  const chunk = { x: region.chunk_x, y: region.chunk_y };
  const attackerUserId = attackerKingdom.owner_user_id;

  if (conquered) {
    const protection = snapshot.protection.afterConquest;
    const conquest = await tx
      .updateTable('region_state')
      .set({
        owner_kingdom_id: siege.attacker_kingdom_id,
        is_capital: false,
        owned_since: gameNow,
        protected_until: protection > 0 ? sql<Date>`game_now() + ${intervalMs(protection)}` : null,
        protection_reason: protection > 0 ? 'CONQUEST' : null,
        active_siege_id: null,
        version: sql<string>`version + 1`,
        updated_at: gameNow,
      })
      .where('region_id', '=', region.region_id)
      .where('active_siege_id', '=', siegeId)
      .returning(['protected_until'])
      .executeTakeFirstOrThrow();
    events.push({
      type: 'region.changed',
      chunk,
      payload: {
        regionId: region.region_id,
        ownerKingdomId: siege.attacker_kingdom_id,
        isCapital: false,
        protectedUntil: conquest.protected_until?.toISOString() ?? null,
        underSiege: false,
      },
    });
    await tx
      .insertInto('region_history')
      .values({
        region_id: region.region_id,
        instance_id: region.instance_id,
        from_kingdom_id: siege.defender_kingdom_id,
        to_kingdom_id: siege.attacker_kingdom_id,
        cause: 'CONQUEST_PVE',
        siege_id: siegeId,
        at: gameNow,
      })
      .execute();

    // Angreifer: eine Region mehr; Anfängerschutz endet bei der Regionsgrenze (GAME_RULES §7)
    const before = attackerKingdom.region_count;
    const after = before + 1;
    const untilRegions = snapshot.protection.newPlayerUntilRegions;
    const endsNewbie =
      attackerKingdom.protection_reason === 'NEWBIE' &&
      untilRegions !== null &&
      after >= untilRegions;
    await tx
      .updateTable('kingdoms')
      .set({
        region_count: after,
        version: sql<string>`version + 1`,
        ...(endsNewbie ? { protected_until: null, protection_reason: null } : {}),
      })
      .where('id', '=', siege.attacker_kingdom_id)
      .execute();
    await tx
      .updateTable('kingdom_statistics')
      .set({
        max_regions: sql<number>`greatest(max_regions, ${after})`,
        // PvE-Eroberungen: NPC-Fraktion oder neutrale Garnison, beide antworten als NPC
        // (DATA_MODEL §4); diese Auswertung ist nur für PvE
        npc_regions_conquered: sql<number>`npc_regions_conquered + 1`,
        updated_at: gameNow,
      })
      .where('kingdom_id', '=', siege.attacker_kingdom_id)
      .execute();
    await recordRankChange(tx, siege.attacker_kingdom_id, before, after);
    events.push(await kingdomChanged(tx, siege.attacker_kingdom_id, chunk));

    if (defenderKingdom) {
      events.push(
        ...(await loseRegion(
          tx,
          defenderKingdom,
          region.region_id,
          region.is_capital,
          siegeId,
          chunk,
        )),
      );
    }
  } else {
    const released = await tx
      .updateTable('region_state')
      .set({ active_siege_id: null, version: sql<string>`version + 1`, updated_at: gameNow })
      .where('region_id', '=', region.region_id)
      .where('active_siege_id', '=', siegeId)
      .returning([
        sql<Date | null>`case when protected_until > game_now() then protected_until end`.as(
          'protected_until',
        ),
      ])
      .executeTakeFirstOrThrow();
    events.push({
      type: 'region.changed',
      chunk,
      payload: {
        regionId: region.region_id,
        ownerKingdomId: region.owner_kingdom_id,
        isCapital: region.is_capital,
        protectedUntil: released.protected_until?.toISOString() ?? null,
        underSiege: false,
      },
    });
  }

  if (defenderKingdom && resolvedDuel) {
    await tx
      .updateTable('kingdom_statistics')
      .set(
        conquered
          ? { defenses_lost: sql<number>`defenses_lost + 1`, updated_at: gameNow }
          : { defenses_won: sql<number>`defenses_won + 1`, updated_at: gameNow },
      )
      .where('kingdom_id', '=', defenderKingdom.id)
      .execute();
  }

  if (resolvedDuel && attackerUserId) {
    const trivia = step0?.status === 'ANSWERED';
    await tx
      .updateTable('player_statistics')
      .set({
        battles: sql<number>`battles + 1`,
        battles_won: sql<number>`battles_won + ${conquered ? 1 : 0}`,
        conquests: sql<number>`conquests + ${conquered ? 1 : 0}`,
        regions_max: sql<number>`greatest(regions_max, ${attackerKingdom.region_count + (conquered ? 1 : 0)})`,
        trivia_answered: sql<number>`trivia_answered + ${trivia ? 1 : 0}`,
        trivia_correct: sql<number>`trivia_correct + ${trivia && step0.is_correct ? 1 : 0}`,
        updated_at: gameNow,
      })
      .where('user_id', '=', attackerUserId)
      .execute();
  }

  await appendBattleEvents(tx, siegeId, [
    {
      type: 'RESOLVED',
      payload: {
        status: ending.status,
        outcome: ending.outcome,
        reason: ending.reason,
        attacker: attackerPerf ? describe(attackerPerf) : null,
        defender: defenderPerf ? describe(defenderPerf) : null,
        coreVersion: CORE_VERSION,
      },
    },
  ]);
  if (attackerUserId) {
    events.push({
      type: 'siege.resolved',
      userId: attackerUserId,
      payload: {
        siegeId,
        mode: 'PVE',
        regionId: region.region_id,
        status: ending.status,
        conquered,
      },
    });
  }
  await insertWorldEvents(tx, siege.instance_id, events);
  return 'RESOLVED';
}

function describe(perf: Performance): Record<string, unknown> {
  return {
    triviaCorrect: perf.triviaCorrect,
    estimateDistance: perf.estimateDistance ? formatDecimal(perf.estimateDistance) : null,
    estimateEffectiveMs: perf.estimateEffectiveMs,
    answeredBoth: perf.answeredBoth,
  };
}

async function recordRankChange(
  tx: Tx,
  kingdomId: string,
  before: number,
  after: number,
): Promise<void> {
  const from = kingdomRank(before);
  const to = kingdomRank(after);
  if (from === to) return;
  await tx
    .insertInto('kingdom_history')
    .values({
      kingdom_id: kingdomId,
      kind: 'RANK_CHANGED',
      payload: JSON.stringify({ from, to, regionCount: after }),
      at: gameNow,
    })
    .execute();
}

async function kingdomChanged(
  tx: Tx,
  kingdomId: string,
  chunk: { x: number; y: number },
): Promise<WorldEvent> {
  const row = await tx
    .selectFrom('kingdoms as k')
    .leftJoin('region_state as c', (join) =>
      join.onRef('c.owner_kingdom_id', '=', 'k.id').on('c.is_capital', '=', true),
    )
    .select(['k.region_count', 'k.status', 'c.region_id as capital'])
    .where('k.id', '=', kingdomId)
    .executeTakeFirstOrThrow();
  return {
    type: 'kingdom.changed',
    chunk,
    payload: {
      kingdomId,
      status: row.status,
      regionCount: row.region_count,
      rank: kingdomRank(row.region_count),
      capitalRegionId: row.capital,
    },
  };
}

/**
 * Das Verteidigerreich verliert die Region: Regionenzahl, ggf. neue Hauptstadt (GAME_RULES §3.3)
 * oder Totalverlust (§3.5, SIEGE_SYSTEM §8). Eine Fraktion ohne Regionen ruht (NPC_SYSTEM §5.4).
 */
async function loseRegion(
  tx: Tx,
  kingdom: { id: string; kind: string; region_count: number; npc_faction_id: string | null },
  regionId: string,
  wasCapital: boolean,
  siegeId: string,
  chunk: { x: number; y: number },
): Promise<WorldEvent[]> {
  const events: WorldEvent[] = [];
  const before = kingdom.region_count;
  const after = Math.max(0, before - 1);
  if (after === 0) {
    await tx
      .updateTable('kingdoms')
      .set({
        region_count: 0,
        status: 'FALLEN',
        fallen_at: gameNow,
        version: sql<string>`version + 1`,
      })
      .where('id', '=', kingdom.id)
      .execute();
    await tx
      .insertInto('kingdom_history')
      .values({
        kingdom_id: kingdom.id,
        kind: 'FALLEN',
        payload: JSON.stringify({ lastRegionId: regionId, siegeId }),
        at: gameNow,
      })
      .execute();
    if (kingdom.npc_faction_id) {
      await tx
        .updateTable('npc_factions')
        .set({ status: 'DORMANT' })
        .where('id', '=', kingdom.npc_faction_id)
        .execute();
    }
  } else {
    await tx
      .updateTable('kingdoms')
      .set({ region_count: after, version: sql<string>`version + 1` })
      .where('id', '=', kingdom.id)
      .execute();
    if (wasCapital) {
      // Besitzwechsel sperren immer zuerst das Reich (hier schon gesperrt); die Regionen des Reichs
      // brauchen deshalb keine eigene Sperre.
      const owned = await tx
        .selectFrom('region_state as s')
        .innerJoin('regions as r', 'r.id', 's.region_id')
        .select([
          's.region_id',
          'r.q',
          'r.r',
          's.owned_since',
          's.chunk_x',
          's.chunk_y',
          sql<Date | null>`case when s.protected_until > game_now() then s.protected_until end`.as(
            'protected_until',
          ),
          sql<boolean>`s.active_siege_id is not null`.as('under_siege'),
        ])
        .where('s.owner_kingdom_id', '=', kingdom.id)
        .orderBy('s.region_id')
        .execute();
      const capital = chooseNewCapital(
        owned.map((o) => ({
          id: o.region_id,
          q: o.q,
          r: o.r,
          ownedSince: o.owned_since?.getTime() ?? 0,
        })),
      );
      if (capital) {
        const row = owned.find((o) => o.region_id === capital.id);
        await tx
          .updateTable('region_state')
          .set({ is_capital: true, version: sql<string>`version + 1`, updated_at: gameNow })
          .where('region_id', '=', capital.id)
          .execute();
        await tx
          .insertInto('kingdom_history')
          .values({
            kingdom_id: kingdom.id,
            kind: 'CAPITAL_CHANGED',
            payload: JSON.stringify({
              from: regionId,
              to: capital.id,
              cause: 'CAPITAL_LOST',
              siegeId,
            }),
            at: gameNow,
          })
          .execute();
        if (row) {
          events.push({
            type: 'region.changed',
            chunk: { x: row.chunk_x, y: row.chunk_y },
            payload: {
              regionId: capital.id,
              ownerKingdomId: kingdom.id,
              isCapital: true,
              protectedUntil: row.protected_until?.toISOString() ?? null,
              underSiege: row.under_siege,
            },
          });
        }
      }
    }
  }
  await recordRankChange(tx, kingdom.id, before, after);
  events.push(await kingdomChanged(tx, kingdom.id, chunk));
  return events;
}
