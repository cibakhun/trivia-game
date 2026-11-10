import type { Db, Tx } from '@rdw/db';
import {
  CHALLENGE_START_WINDOW_MS,
  CORE_VERSION,
  NO_DEFENSE,
  defensePoints,
  estimateDecides,
  formatDecimal,
  hitCapital,
  isTimeoutDue,
  kingdomRank,
  openSiegeDeadlines,
  parseDecimal,
  performanceFromSteps,
  resolveDuel,
  siegeEndState,
  type Defense,
  type Performance,
} from '@rdw/game-core';
import { DAY_MS } from '@rdw/protocol';
import { sql } from 'kysely';
import { gameNow, intervalMs } from '../../infra/clock.ts';
import { canonicalJson, sha256Hex } from '../../infra/crypto.ts';
import { appendBattleEvents, insertWorldEvents, type WorldEvent } from '../../infra/events.ts';
import { recordExposure } from '../quiz/questions.ts';
import { capitalOf, parseSnapshot, pvpOf, type SiegeRulesSnapshot } from './snapshot.ts';

/**
 * Abschluss eines Kampfes (SIEGE_SYSTEM §2–§5.3, §8) in einer Transaktion mit fester
 * Sperrreihenfolge (Reiche → Region → Belagerung). Abgelaufene Schritte werden `TIMED_OUT`, nie
 * begonnene Herausforderungen beendet.
 *
 * - **PvE:** Sobald der Angreifer fertig ist, wird gegen die versiegelten NPC-Antworten
 *   ausgewertet.
 * - **PvP:** Ist der Angreifer fertig, wird die Belagerung eröffnet (`AWAITING_DEFENSE`, Frist
 *   startet, seine Leistung ist versiegelt). Aufgelöst wird, wenn der Verteidiger fertig ist oder
 *   die Frist ohne Verteidigung abgelaufen ist (`isTimeoutDue`). Ist das Angreiferreich nicht mehr
 *   aktiv, endet die Belagerung sofort mit `CANCELLED` (N10).
 *
 * Ein Sieg über eine Hauptstadt kostet sie ein Leben; nimmt er das letzte, übernimmt der
 * Angreifer das ganze Reich (GAME_RULES §3, ADR-037). Jeder Aufruf ist idempotent: Ist der Kampf
 * schon beendet oder noch nicht fällig, ändert er nichts. Aufrufer: letzte Antwort, Lesezugriffe
 * („lazy resolution“), Verteidigungsbeginn, neuer Angriff und der Aufräumlauf.
 */

export type SettleResult = 'RESOLVED' | 'OPENED' | 'PENDING' | 'NOOP';

type EndStatus =
  'ATTACKER_WON' | 'ATTACKER_WON_BY_TIMEOUT' | 'DEFENDER_WON' | 'ATTACK_FAILED' | 'CANCELLED';

/** Belagerungen, die noch nicht beendet sind (`RESOLVING` wird nie gespeichert). */
export const OPEN_SIEGE_STATUSES = ['PREPARING', 'AWAITING_DEFENSE', 'DEFENDING'] as const;

interface AnswerRow {
  readonly role: string;
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
    // Ohne Zeile für Schritt 1 wurde die Schätzfrage nie gestellt (Tiebreaker nicht nötig)
    rows.some((row) => row.step_index === 1),
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
    answeredAll: perf?.answeredAll ?? false,
  };
}

/** Ein Schritt ist erledigt: beantwortet oder abgelaufen. */
function finished(row: AnswerRow | undefined): boolean {
  return row?.status === 'ANSWERED' || row?.status === 'TIMED_OUT';
}

export async function settleSiege(db: Db, siegeId: string): Promise<SettleResult> {
  return db.transaction().execute((tx) => settleInTransaction(tx, siegeId));
}

interface KingdomRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly region_count: number;
  readonly owner_user_id: string | null;
  readonly npc_faction_id: string | null;
  readonly protection_reason: string | null;
  readonly capital_hits: number;
  readonly capital_hit_at: Date | null;
}

interface Locked {
  readonly siegeId: string;
  readonly mode: 'PVE' | 'PVP';
  readonly now: Date;
  readonly snapshot: SiegeRulesSnapshot;
  readonly siege: {
    readonly instance_id: string;
    readonly status: string;
    readonly version: number;
    readonly created_at: Date;
    readonly deadline_at: Date | null;
    readonly attacker_kingdom_id: string;
    readonly defender_kingdom_id: string | null;
    readonly defender_kind: string;
  };
  readonly region: {
    readonly region_id: string;
    readonly instance_id: string;
    readonly chunk_x: number;
    readonly chunk_y: number;
    readonly owner_kingdom_id: string | null;
    readonly is_capital: boolean;
    readonly active_siege_id: string | null;
  };
  readonly attackerKingdom: KingdomRow;
  readonly defenderKingdom: KingdomRow | undefined;
  readonly attackerRows: readonly AnswerRow[];
  readonly defenderRows: readonly AnswerRow[];
}

/** Ergebnis eines Kampfes, bevor die Wirkungen geschrieben werden. */
interface Ending {
  readonly kind: 'END';
  readonly status: EndStatus;
  readonly outcome: 'ATTACKER' | 'DEFENDER' | 'NONE';
  readonly reason: string;
  readonly attackerPerf: Performance | null;
  /** `null`: kein Duell (abgebrochen, nie begonnen); `NO_DEFENSE`: PvP ohne Verteidigung. */
  readonly defense: Defense | null;
}

type Decision = { readonly kind: 'PENDING' } | { readonly kind: 'OPEN' } | Ending;

function cancelled(): Ending {
  return {
    kind: 'END',
    status: 'CANCELLED',
    outcome: 'NONE',
    reason: 'CANCELLED',
    attackerPerf: null,
    defense: null,
  };
}

function duel(attackerRows: readonly AnswerRow[], defense: Defense): Ending {
  const attackerPerf = performanceOf(attackerRows);
  const outcome = resolveDuel(attackerPerf, defense);
  return {
    kind: 'END',
    status: siegeEndState(outcome),
    outcome: outcome.winner,
    reason: outcome.reason,
    attackerPerf,
    defense,
  };
}

async function settleInTransaction(tx: Tx, siegeId: string): Promise<SettleResult> {
  const head = await tx
    .selectFrom('sieges')
    .select(['status', 'mode', 'attacker_kingdom_id', 'defender_kingdom_id', 'target_region_id'])
    .where('id', '=', siegeId)
    .executeTakeFirst();
  if (!head || !(OPEN_SIEGE_STATUSES as readonly string[]).includes(head.status)) return 'NOOP';
  if (head.mode === 'PVE' && head.status !== 'PREPARING') return 'NOOP';

  const locked = await lockAndLoad(tx, siegeId, head);
  if (!locked) return 'NOOP';
  const decision = locked.mode === 'PVE' ? decidePve(locked) : decidePvp(locked);
  if (decision.kind === 'PENDING') return 'PENDING';

  // N12: Besitz und Reservierung müssen zur Belagerung passen; sonst ist eine Invariante verletzt.
  const { region, siege } = locked;
  if (region.owner_kingdom_id !== siege.defender_kingdom_id || region.active_siege_id !== siegeId) {
    throw new Error(`Belagerung ${siegeId}: Region ${region.region_id} passt nicht (I3/N12)`);
  }
  if (decision.kind === 'OPEN') {
    await openSiege(tx, locked);
    return 'OPENED';
  }
  await resolve(tx, locked, decision);
  return 'RESOLVED';
}

/**
 * Sperren in fester Reihenfolge (SIEGE_SYSTEM §5.1), dann abgelaufene Schritte auf `TIMED_OUT`
 * (erst ab `answer_deadline_at + settleGrace`, §6.1) und alle Antworten lesen.
 */
async function lockAndLoad(
  tx: Tx,
  siegeId: string,
  head: {
    readonly attacker_kingdom_id: string;
    readonly defender_kingdom_id: string | null;
    readonly target_region_id: string;
  },
): Promise<Locked | null> {
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
      'capital_hits',
      'capital_hit_at',
    ])
    .where('id', 'in', kingdomIds)
    .orderBy('id')
    .forUpdate()
    .execute();
  const region = await tx
    .selectFrom('region_state')
    .select([
      'region_id',
      'instance_id',
      'chunk_x',
      'chunk_y',
      'owner_kingdom_id',
      'is_capital',
      'active_siege_id',
    ])
    .where('region_id', '=', head.target_region_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const siege = await tx
    .selectFrom('sieges')
    .select([
      'instance_id',
      'mode',
      'status',
      'version',
      'created_at',
      'deadline_at',
      'attacker_kingdom_id',
      'defender_kingdom_id',
      'defender_kind',
      'rules_snapshot',
      sql<Date>`game_now()`.as('now'),
    ])
    .where('id', '=', siegeId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (!(OPEN_SIEGE_STATUSES as readonly string[]).includes(siege.status)) return null;
  const mode = siege.mode === 'PVP' ? 'PVP' : 'PVE';
  if (mode === 'PVE' && siege.status !== 'PREPARING') return null;
  const snapshot = parseSnapshot(siege.rules_snapshot);
  const attackerKingdom = kingdoms.find((k) => k.id === siege.attacker_kingdom_id);
  if (!attackerKingdom) throw new Error(`Belagerung ${siegeId}: Angreiferreich fehlt`);
  const defenderKingdom = siege.defender_kingdom_id
    ? kingdoms.find((k) => k.id === siege.defender_kingdom_id)
    : undefined;

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
  return {
    siegeId,
    mode,
    now: siege.now,
    snapshot,
    siege,
    region,
    attackerKingdom,
    defenderKingdom,
    attackerRows: answers.filter((a) => a.role === 'ATTACKER'),
    defenderRows: answers.filter((a) => a.role === 'DEFENDER'),
  };
}

/** Nie begonnen: erste Frage nicht innerhalb des Startfensters abgerufen (ARCHITECTURE §11). */
function neverStarted(locked: Locked): Decision {
  const { now, siege, attackerKingdom } = locked;
  if (now.getTime() < siege.created_at.getTime() + CHALLENGE_START_WINDOW_MS) {
    return { kind: 'PENDING' };
  }
  // N10 gilt auf jedem Weg: ein nicht mehr aktives Angreiferreich bricht ab
  if (attackerKingdom.status !== 'ACTIVE') return cancelled();
  return {
    kind: 'END',
    status: 'ATTACK_FAILED',
    outcome: 'NONE',
    reason: 'NEVER_STARTED',
    attackerPerf: null,
    defense: null,
  };
}

/** PvE: Auswertung gegen die versiegelten Antworten von NPC oder Garnison. */
function decidePve(locked: Locked): Decision {
  const { attackerRows, defenderRows, attackerKingdom } = locked;
  const step0 = attackerRows.find((a) => a.step_index === 0);
  const step1 = attackerRows.find((a) => a.step_index === 1);
  if (!step0) return neverStarted(locked);
  // Verpasst der Spieler die Trivia-Frage, endet die Herausforderung ohne Schätzfrage [E].
  // Die Schätzfrage entscheidet nur einen Gleichstand (beide richtig, GAME_RULES §5.2); sonst
  // steht der Ausgang nach der Trivia-Frage fest.
  const defenderStep0 = defenderRows.find((a) => a.step_index === 0);
  const decidedByTrivia =
    step0.status === 'ANSWERED' &&
    !estimateDecides(step0.is_correct === true, defenderStep0?.is_correct === true);
  const complete = step0.status === 'TIMED_OUT' || decidedByTrivia || finished(step1);
  if (!complete) return { kind: 'PENDING' };
  if (attackerKingdom.status !== 'ACTIVE') return cancelled(); // N10
  // Im PvE steht die Verteidigung vorab fest, `NO_DEFENSE` gibt es nicht (QUIZ_ENGINE §8).
  const ending = duel(attackerRows, performanceOf(defenderRows));
  if (ending.status !== 'ATTACKER_WON' && ending.status !== 'DEFENDER_WON') {
    throw new Error(`PvE-Auswertung ergab ${ending.status}`);
  }
  return ending;
}

/**
 * PvP (SIEGE_SYSTEM §3–§4): In `PREPARING` antwortet der Angreifer; ist er fertig, wird die
 * Belagerung eröffnet. Verpasst er die Wissensfrage, hat er abgebrochen (`ABANDONED`, zählt als
 * Versuch, keine Belagerung). In `AWAITING_DEFENSE` entscheidet nur der Fristablauf
 * (`NO_DEFENSE`), in `DEFENDING` der vollständige Verteidiger. Beide beantworten immer beide
 * Fragen; die Schätzung zählt nur bei Gleichstand ([O-19] A, in `resolveDuel`).
 */
function decidePvp(locked: Locked): Decision {
  const { siege, attackerRows, defenderRows, attackerKingdom, snapshot, now } = locked;
  if (siege.status === 'PREPARING') {
    const step0 = attackerRows.find((a) => a.step_index === 0);
    const step1 = attackerRows.find((a) => a.step_index === 1);
    if (!step0) return neverStarted(locked);
    if (step0.status === 'TIMED_OUT') {
      if (attackerKingdom.status !== 'ACTIVE') return cancelled();
      return {
        kind: 'END',
        status: 'ATTACK_FAILED',
        outcome: 'NONE',
        reason: 'ABANDONED',
        attackerPerf: null,
        defense: null,
      };
    }
    if (!finished(step1)) return { kind: 'PENDING' };
    if (attackerKingdom.status !== 'ACTIVE') return cancelled();
    return { kind: 'OPEN' };
  }
  // N10: Angreiferreich gefallen – sofort abbrechen, nicht erst zur Frist
  if (attackerKingdom.status !== 'ACTIVE') return cancelled();
  if (siege.status === 'AWAITING_DEFENSE') {
    if (!siege.deadline_at) throw new Error(`Belagerung ${locked.siegeId}: Frist fehlt`);
    const due = isTimeoutDue(
      { deadlineAt: siege.deadline_at.getTime(), settleGrace: snapshot.defense.settleGrace },
      now.getTime(),
    );
    return due ? duel(attackerRows, NO_DEFENSE) : { kind: 'PENDING' };
  }
  // DEFENDING: Schritt 0 wird mit dem Verteidigungsbeginn gestellt, Schritt 1 mit der Antwort
  // auf Schritt 0. Die Fragen enden vor der Frist (canStartDefense), ihre Zeitlimits reichen.
  const step0 = defenderRows.find((a) => a.step_index === 0);
  const step1 = defenderRows.find((a) => a.step_index === 1);
  const complete = step0?.status === 'TIMED_OUT' || finished(step1);
  if (!complete) return { kind: 'PENDING' };
  return duel(attackerRows, performanceOf(defenderRows));
}

/**
 * PvP: Der Angreifer ist fertig, seine Leistung ist versiegelt (auch bei falscher Antwort,
 * verdecktes Gate). Die Frist startet; Angreifer und Verteidiger erfahren nur die Frist.
 */
async function openSiege(tx: Tx, locked: Locked): Promise<void> {
  const { siegeId, siege, snapshot, now, attackerRows, region } = locked;
  const pvp = pvpOf(snapshot);
  const deadlines = openSiegeDeadlines(now.getTime(), pvp);
  const updated = await tx
    .updateTable('sieges')
    .set({
      status: 'AWAITING_DEFENSE',
      opened_at: new Date(deadlines.openedAt),
      base_deadline_at: new Date(deadlines.baseDeadlineAt),
      deadline_at: new Date(deadlines.deadlineAt),
      max_deadline_at: new Date(deadlines.maxDeadlineAt),
      version: sql<number>`version + 1`,
    })
    .where('id', '=', siegeId)
    .where('status', '=', 'PREPARING')
    .where('version', '=', siege.version)
    .executeTakeFirst();
  if (updated.numUpdatedRows !== 1n) throw new Error(`Belagerung ${siegeId}: Version geändert`);
  // Beleg, dass die Angreiferleistung vor der Verteidigung feststand (SIEGE_SYSTEM §4)
  await appendBattleEvents(tx, siegeId, [
    {
      type: 'ATTACK_SUBMITTED',
      payload: {
        commitment: sha256Hex(canonicalJson({ siegeId, answers: summary(attackerRows, null) })),
        deadlineAt: new Date(deadlines.deadlineAt).toISOString(),
      },
    },
  ]);
  const payload = {
    siegeId,
    mode: 'PVP',
    regionId: region.region_id,
    deadlineAt: new Date(deadlines.deadlineAt).toISOString(),
  };
  const events: WorldEvent[] = [];
  const attackerUserId = locked.attackerKingdom.owner_user_id;
  const defenderUserId = locked.defenderKingdom?.owner_user_id;
  if (attackerUserId) {
    events.push({
      type: 'siege.opened',
      userId: attackerUserId,
      payload: { ...payload, role: 'ATTACKER' },
    });
  }
  if (defenderUserId) {
    events.push({
      type: 'siege.opened',
      userId: defenderUserId,
      payload: { ...payload, role: 'DEFENDER' },
    });
  }
  await insertWorldEvents(tx, siege.instance_id, events);
}

/**
 * Verteidigungspunkte (GAME_RULES §5.5): nur für Spielerreiche im PvP, nach der eigenen Leistung
 * und höchstens `pointsPairLimitPerDay` punktbringende Verteidigungen je Reichspaar in 24 h
 * (gleitend, unter den Reichssperren gezählt). Verdächtig verknüpfte Konten gibt es noch nicht
 * (SECURITY §4, Phase 7).
 */
async function awardedDefensePoints(
  tx: Tx,
  locked: Locked,
  defense: Defense | null,
): Promise<{ readonly points: number; readonly pairLimited: boolean }> {
  if (locked.mode !== 'PVP' || defense === null || !locked.defenderKingdom) {
    return { points: 0, pairLimited: false };
  }
  const pvp = pvpOf(locked.snapshot);
  const points = defensePoints(defense, {
    forDefending: pvp.pointsForDefending,
    bonusCorrect: pvp.pointsBonusCorrect,
  });
  if (points === 0) return { points: 0, pairLimited: false };
  const { count } = await tx
    .selectFrom('battle_results as b')
    .innerJoin('sieges as s', 's.id', 'b.siege_id')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('s.attacker_kingdom_id', '=', locked.siege.attacker_kingdom_id)
    .where('s.defender_kingdom_id', '=', locked.defenderKingdom.id)
    .where('b.defense_points', '>', 0)
    .where('b.decided_at', '>', new Date(locked.now.getTime() - DAY_MS))
    .executeTakeFirstOrThrow();
  if (Number(count) >= pvp.pointsPairLimitPerDay) return { points: 0, pairLimited: true };
  return { points, pairLimited: false };
}

/** Endzustand, Ergebnis, Wirkungen und Protokoll in der Sperrtransaktion. */
async function resolve(tx: Tx, locked: Locked, ending: Ending): Promise<void> {
  const { siegeId, siege, region, snapshot, now, attackerKingdom, defenderKingdom } = locked;
  const { attackerRows, defenderRows, mode } = locked;
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
  const won = ending.status === 'ATTACKER_WON' || ending.status === 'ATTACKER_WON_BY_TIMEOUT';
  // Hauptstadt: Treffer (ein Leben weniger, Region bleibt) oder Übernahme des ganzen Reichs. Im
  // PvP hat jede Belagerung die volle Frist ([O-20] B); die Sperre je Angreifer prüft der Angriff.
  const capitalRules = capitalOf(snapshot);
  const capitalHit =
    won && defenderKingdom && region.is_capital
      ? hitCapital(
          {
            hits: defenderKingdom.capital_hits,
            lastHitAt: defenderKingdom.capital_hit_at?.getTime() ?? null,
          },
          capitalRules,
          now.getTime(),
        )
      : null;
  const conquered = won && capitalHit?.kind !== 'HIT';
  const takeover = capitalHit?.kind === 'TAKEOVER' ? defenderKingdom : undefined;
  const capitalLivesLeft = capitalHit
    ? capitalHit.kind === 'HIT'
      ? capitalHit.livesLeft
      : 0
    : null;
  // Schutz nach einem Treffer, einmal berechnet für Region und Ergebnis: Das Ergebnis ist
  // unveränderlich und behält ihn, auch wenn ein späterer Treffer den Schutz der Region ersetzt.
  const capitalProtectedUntil =
    capitalHit?.kind === 'HIT' && capitalRules.protectionAfterHit > 0
      ? new Date(now.getTime() + capitalRules.protectionAfterHit)
      : null;
  // Bei einer Übernahme alle Regionen des Reichs (Regionenzahl, von takeOverRegions geprüft)
  const regionsGained = conquered ? (takeover?.region_count ?? 1) : 0;
  // Begonnene Verteidigung: im PvE immer (NPC), im PvP mit eigenen Antworten
  const defended = ending.defense !== null && ending.defense !== NO_DEFENSE;
  const defenderPerf = defended ? ending.defense : null;
  const { points, pairLimited } = await awardedDefensePoints(tx, locked, ending.defense);
  await tx
    .insertInto('battle_results')
    .values({
      siege_id: siegeId,
      winner_role: ending.outcome === 'NONE' ? null : ending.outcome,
      reason: ending.reason,
      attacker_summary: JSON.stringify(summary(attackerRows, ending.attackerPerf)),
      defender_summary: JSON.stringify({
        kind: siege.defender_kind,
        ...summary(defenderRows, defenderPerf),
        ...(pairLimited ? { pointsPairLimited: true } : {}),
      }),
      defended,
      defense_points: points,
      decided_at: gameNow,
      core_version: CORE_VERSION,
      capital_lives_left: capitalLivesLeft,
      regions_taken: takeover ? regionsGained : null,
      capital_protected_until: capitalProtectedUntil,
    })
    .execute();

  const events: WorldEvent[] = [];
  const chunk = { x: region.chunk_x, y: region.chunk_y };
  const attackerUserId = attackerKingdom.owner_user_id;
  const defenderUserId = mode === 'PVP' ? (defenderKingdom?.owner_user_id ?? null) : null;
  // Nur eröffnete Belagerungen sind für den Verteidiger sichtbar (verdecktes Gate)
  if (defenderUserId && siege.status !== 'PREPARING') {
    await exposeToDefender(tx, locked, defenderUserId);
  }

  if (capitalHit?.kind === 'HIT' && defenderKingdom) {
    events.push(
      ...(await damageCapital(tx, {
        kingdomId: defenderKingdom.id,
        attackerKingdomId: siege.attacker_kingdom_id,
        regionId: region.region_id,
        siegeId,
        chunk,
        hits: capitalHit.damage.hits,
        livesLeft: capitalHit.livesLeft,
        protectedUntil: capitalProtectedUntil,
      })),
    );
  } else if (conquered) {
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
        cause:
          mode === 'PVE'
            ? 'CONQUEST_PVE'
            : ending.status === 'ATTACKER_WON_BY_TIMEOUT'
              ? 'TIMEOUT'
              : 'CONQUEST_PVP',
        siege_id: siegeId,
        at: gameNow,
      })
      .execute();

    // Übernahme: alle übrigen Regionen des Reichs gehen mit der Hauptstadt an den Angreifer
    const taken = takeover
      ? await takeOverRegions(tx, {
          from: takeover.id,
          to: siege.attacker_kingdom_id,
          capitalRegionId: region.region_id,
          siegeId,
          protection,
          expected: regionsGained - 1,
        })
      : [];
    events.push(...taken);

    // Angreifer: Regionen dazu; Anfängerschutz endet bei der Regionsgrenze (GAME_RULES §7)
    const before = attackerKingdom.region_count;
    const after = before + regionsGained;
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
        // Im PvE gewonnene Regionen: NPC-Fraktion oder neutrale Garnison, beide antworten als
        // NPC; bei einer Übernahme alle Regionen des Reichs (DATA_MODEL §4). Nur PvE.
        ...(mode === 'PVE'
          ? { npc_regions_conquered: sql<number>`npc_regions_conquered + ${regionsGained}` }
          : {}),
        updated_at: gameNow,
      })
      .where('kingdom_id', '=', siege.attacker_kingdom_id)
      .execute();
    if (takeover) {
      await tx
        .insertInto('kingdom_history')
        .values({
          kingdom_id: siege.attacker_kingdom_id,
          kind: 'TAKEOVER',
          payload: JSON.stringify({
            kingdomId: takeover.id,
            capitalRegionId: region.region_id,
            regions: regionsGained,
            siegeId,
          }),
          at: gameNow,
        })
        .execute();
    }
    await recordRankChange(tx, siege.attacker_kingdom_id, before, after);
    events.push(await kingdomChanged(tx, siege.attacker_kingdom_id, chunk));

    if (takeover) {
      events.push(
        ...(await fallKingdom(tx, takeover, {
          cause: 'TAKEOVER',
          byKingdomId: siege.attacker_kingdom_id,
          regionId: region.region_id,
          siegeId,
          chunk,
        })),
      );
    } else if (defenderKingdom) {
      events.push(...(await loseRegion(tx, defenderKingdom, region.region_id, siegeId, chunk)));
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

  await recordStatistics(tx, locked, ending, {
    won,
    conquered,
    regionsGained,
    defended,
    points,
  });

  await appendBattleEvents(tx, siegeId, [
    {
      type: 'RESOLVED',
      payload: {
        status: ending.status,
        outcome: ending.outcome,
        reason: ending.reason,
        attacker: ending.attackerPerf ? describe(ending.attackerPerf) : null,
        defender: defenderPerf ? describe(defenderPerf) : null,
        defensePoints: points,
        coreVersion: CORE_VERSION,
      },
    },
  ]);
  const resolved = {
    siegeId,
    mode,
    regionId: region.region_id,
    status: ending.status,
    conquered,
    capitalLivesLeft,
    kingdomTakenOver: takeover?.id ?? null,
  };
  if (attackerUserId) {
    events.push({
      type: 'siege.resolved',
      userId: attackerUserId,
      payload: { ...resolved, role: 'ATTACKER' },
    });
  }
  // Der Verteidiger erfährt nur von eröffneten Belagerungen (QUIZ_ENGINE §7.2): Ein Abbruch vor
  // der Eröffnung bleibt für ihn unsichtbar.
  if (defenderUserId && siege.status !== 'PREPARING') {
    events.push({
      type: 'siege.resolved',
      userId: defenderUserId,
      payload: { ...resolved, role: 'DEFENDER', defensePoints: points },
    });
  }
  await insertWorldEvents(tx, siege.instance_id, events);
}

/**
 * Die Auflösung zeigt dem Verteidiger die Fragen des Angreifers, auch wenn er nicht (vollständig)
 * verteidigt hat. Danach gelten sie auch für ihn als gesehen und werden ihm nicht neu gestellt
 * (QUIZ_ENGINE §4).
 */
async function exposeToDefender(tx: Tx, locked: Locked, defenderUserId: string): Promise<void> {
  const unseen = locked.attackerRows
    .map((row) => row.step_index)
    .filter((step) => !locked.defenderRows.some((row) => row.step_index === step));
  if (unseen.length === 0) return;
  const questions = await tx
    .selectFrom('quiz_challenge_steps as st')
    .innerJoin('quiz_challenges as c', 'c.id', 'st.challenge_id')
    .innerJoin('question_versions as v', 'v.id', 'st.version_id')
    .select('v.question_id')
    .where('c.siege_id', '=', locked.siegeId)
    .where('st.step_index', 'in', unseen)
    .execute();
  for (const { question_id } of questions) await recordExposure(tx, defenderUserId, question_id);
}

/** Zähler in Reichs- und Spielerstatistik (DATA_MODEL §2 und §4). */
async function recordStatistics(
  tx: Tx,
  locked: Locked,
  ending: Ending,
  effect: {
    readonly won: boolean;
    readonly conquered: boolean;
    readonly regionsGained: number;
    readonly defended: boolean;
    readonly points: number;
  },
): Promise<void> {
  const { mode, siege, attackerKingdom, defenderKingdom, attackerRows, defenderRows } = locked;
  const resolvedDuel = ending.attackerPerf !== null;
  if (!resolvedDuel) return;
  const { won, conquered, regionsGained, defended, points } = effect;
  const defenderWon = ending.status === 'DEFENDER_WON';

  if (mode === 'PVP') {
    await tx
      .updateTable('kingdom_statistics')
      .set(
        won
          ? { pvp_won: sql<number>`pvp_won + 1`, updated_at: gameNow }
          : { pvp_lost: sql<number>`pvp_lost + 1`, updated_at: gameNow },
      )
      .where('kingdom_id', '=', siege.attacker_kingdom_id)
      .execute();
  }
  // Ein am Gate gescheiterter PvP-Angriff ohne Verteidigung zählt für den Verteidiger weder als
  // gewonnene noch als verlorene Verteidigung (QUIZ_ENGINE §8).
  if (defenderKingdom && (won || defenderWon)) {
    await tx
      .updateTable('kingdom_statistics')
      .set({
        ...(won
          ? { defenses_lost: sql<number>`defenses_lost + 1` }
          : { defenses_won: sql<number>`defenses_won + 1` }),
        ...(ending.status === 'ATTACKER_WON_BY_TIMEOUT'
          ? { timeout_losses: sql<number>`timeout_losses + 1` }
          : {}),
        defense_points: sql<number>`defense_points + ${points}`,
        updated_at: gameNow,
      })
      .where('kingdom_id', '=', defenderKingdom.id)
      .execute();
  }

  const attackerUserId = attackerKingdom.owner_user_id;
  if (attackerUserId) {
    const step0 = attackerRows.find((a) => a.step_index === 0);
    const trivia = step0?.status === 'ANSWERED';
    await tx
      .updateTable('player_statistics')
      .set({
        battles: sql<number>`battles + 1`,
        battles_won: sql<number>`battles_won + ${won ? 1 : 0}`,
        conquests: sql<number>`conquests + ${conquered ? 1 : 0}`,
        regions_max: sql<number>`greatest(regions_max, ${attackerKingdom.region_count + regionsGained})`,
        trivia_answered: sql<number>`trivia_answered + ${trivia ? 1 : 0}`,
        trivia_correct: sql<number>`trivia_correct + ${trivia && step0.is_correct ? 1 : 0}`,
        updated_at: gameNow,
      })
      .where('user_id', '=', attackerUserId)
      .execute();
  }
  const defenderUserId = mode === 'PVP' ? defenderKingdom?.owner_user_id : null;
  if (defenderUserId && defended) {
    const step0 = defenderRows.find((a) => a.step_index === 0);
    const trivia = step0?.status === 'ANSWERED';
    await tx
      .updateTable('player_statistics')
      .set({
        defenses: sql<number>`defenses + 1`,
        defenses_won: sql<number>`defenses_won + ${defenderWon ? 1 : 0}`,
        defense_points: sql<number>`defense_points + ${points}`,
        trivia_answered: sql<number>`trivia_answered + ${trivia ? 1 : 0}`,
        trivia_correct: sql<number>`trivia_correct + ${trivia && step0.is_correct ? 1 : 0}`,
        updated_at: gameNow,
      })
      .where('user_id', '=', defenderUserId)
      .execute();
  }
}

function describe(perf: Performance): Record<string, unknown> {
  return {
    triviaCorrect: perf.triviaCorrect,
    estimateDistance: perf.estimateDistance ? formatDecimal(perf.estimateDistance) : null,
    estimateEffectiveMs: perf.estimateEffectiveMs,
    answeredAll: perf.answeredAll,
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

interface KingdomRef {
  readonly id: string;
  readonly region_count: number;
  readonly npc_faction_id: string | null;
}

/**
 * Das Verteidigerreich verliert eine Region, die nicht seine Hauptstadt ist (eine Hauptstadt geht
 * nur mit dem ganzen Reich, `takeOverRegions`). Ohne Regionen fällt es (nur bei Daten ohne
 * Hauptstadt möglich, z. B. von Hand bereinigte Reiche).
 */
async function loseRegion(
  tx: Tx,
  kingdom: KingdomRef,
  regionId: string,
  siegeId: string,
  chunk: { x: number; y: number },
): Promise<WorldEvent[]> {
  const before = kingdom.region_count;
  const after = Math.max(0, before - 1);
  if (after === 0) {
    return fallKingdom(tx, kingdom, { cause: 'LAST_REGION', regionId, siegeId, chunk });
  }
  await tx
    .updateTable('kingdoms')
    .set({ region_count: after, version: sql<string>`version + 1` })
    .where('id', '=', kingdom.id)
    .execute();
  await recordRankChange(tx, kingdom.id, before, after);
  return [await kingdomChanged(tx, kingdom.id, chunk)];
}

/**
 * Totalverlust (GAME_RULES §3 Punkt 6, SIEGE_SYSTEM §8): Das Reich hat keine Regionen mehr und
 * fällt; eine NPC-Fraktion ruht danach (NPC_SYSTEM §5.4). Die Regionen hat der Aufrufer schon
 * übertragen.
 */
async function fallKingdom(
  tx: Tx,
  kingdom: KingdomRef,
  details: {
    readonly cause: 'TAKEOVER' | 'LAST_REGION';
    readonly byKingdomId?: string;
    readonly regionId: string;
    readonly siegeId: string;
    readonly chunk: { x: number; y: number };
  },
): Promise<WorldEvent[]> {
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
      payload: JSON.stringify(
        details.cause === 'TAKEOVER'
          ? {
              cause: 'TAKEOVER',
              byKingdomId: details.byKingdomId,
              capitalRegionId: details.regionId,
              regions: kingdom.region_count,
              siegeId: details.siegeId,
            }
          : { cause: 'LAST_REGION', lastRegionId: details.regionId, siegeId: details.siegeId },
      ),
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
  await recordRankChange(tx, kingdom.id, kingdom.region_count, 0);
  return [await kingdomChanged(tx, kingdom.id, details.chunk)];
}

/**
 * Treffer ohne Übernahme: Die Hauptstadt verliert ein Leben, bleibt beim Reich und ist für
 * `protection` geschützt. Der Erholungstakt beginnt neu (`capital_hit_at`).
 */
async function damageCapital(
  tx: Tx,
  hit: {
    readonly kingdomId: string;
    readonly attackerKingdomId: string;
    readonly regionId: string;
    readonly siegeId: string;
    readonly chunk: { x: number; y: number };
    readonly hits: number;
    readonly livesLeft: number;
    readonly protectedUntil: Date | null;
  },
): Promise<WorldEvent[]> {
  const protectedRow = await tx
    .updateTable('region_state')
    .set({
      active_siege_id: null,
      protected_until: hit.protectedUntil,
      protection_reason: hit.protectedUntil ? 'CAPITAL_HIT' : null,
      version: sql<string>`version + 1`,
      updated_at: gameNow,
    })
    .where('region_id', '=', hit.regionId)
    .where('active_siege_id', '=', hit.siegeId)
    .returning(['protected_until'])
    .executeTakeFirstOrThrow();
  await tx
    .updateTable('kingdoms')
    .set({
      capital_hits: hit.hits,
      capital_hit_at: gameNow,
      version: sql<string>`version + 1`,
    })
    .where('id', '=', hit.kingdomId)
    .execute();
  await tx
    .insertInto('kingdom_history')
    .values({
      kingdom_id: hit.kingdomId,
      kind: 'CAPITAL_HIT',
      payload: JSON.stringify({
        regionId: hit.regionId,
        byKingdomId: hit.attackerKingdomId,
        livesLeft: hit.livesLeft,
        siegeId: hit.siegeId,
      }),
      at: gameNow,
    })
    .execute();
  return [
    {
      type: 'region.changed',
      chunk: hit.chunk,
      payload: {
        regionId: hit.regionId,
        ownerKingdomId: hit.kingdomId,
        isCapital: true,
        protectedUntil: protectedRow.protected_until?.toISOString() ?? null,
        underSiege: false,
      },
    },
    await kingdomChanged(tx, hit.kingdomId, hit.chunk),
  ];
}

/**
 * Übernahme (GAME_RULES §3 Punkt 4): Alle übrigen Regionen des Reichs gehen an den Angreifer,
 * frisch erobert und mit Eroberungsschutz. Laufende Angriffe Dritter auf diese Regionen werden
 * abgebrochen (`CANCELLED`), weil ihr Verteidiger nicht mehr besteht. Beide Reiche sind bereits
 * gesperrt; wer Regionen dieses Reichs ändert, sperrt zuerst das Reich (SIEGE_SYSTEM §5.1).
 */
async function takeOverRegions(
  tx: Tx,
  params: {
    readonly from: string;
    readonly to: string;
    readonly capitalRegionId: string;
    readonly siegeId: string;
    readonly protection: number;
    /** Erwartete Zahl (Regionenzahl des Reichs ohne Hauptstadt), Prüfung der Invariante. */
    readonly expected: number;
  },
): Promise<WorldEvent[]> {
  const rest = await tx
    .selectFrom('region_state')
    .select(['region_id', 'instance_id', 'active_siege_id'])
    .where('owner_kingdom_id', '=', params.from)
    .where('region_id', '<>', params.capitalRegionId)
    .orderBy('region_id')
    .execute();
  if (rest.length !== params.expected) {
    throw new Error(
      `Übernahme ${params.siegeId}: ${rest.length} Regionen statt ${params.expected} (Regionenzahl)`,
    );
  }
  if (rest.length === 0) return [];

  const events: WorldEvent[] = [];
  for (const row of rest) {
    if (row.active_siege_id) events.push(...(await cancelSiege(tx, row.active_siege_id)));
  }
  const ids = rest.map((row) => row.region_id);
  const moved = await tx
    .updateTable('region_state')
    .set({
      owner_kingdom_id: params.to,
      is_capital: false,
      owned_since: gameNow,
      protected_until:
        params.protection > 0 ? sql<Date>`game_now() + ${intervalMs(params.protection)}` : null,
      protection_reason: params.protection > 0 ? 'CONQUEST' : null,
      active_siege_id: null,
      version: sql<string>`version + 1`,
      updated_at: gameNow,
    })
    .where('region_id', 'in', ids)
    .where('owner_kingdom_id', '=', params.from)
    .returning(['region_id', 'chunk_x', 'chunk_y', 'protected_until'])
    .execute();
  if (moved.length !== rest.length) {
    throw new Error(`Übernahme ${params.siegeId}: Regionen während der Übernahme verändert`);
  }
  await tx
    .insertInto('region_history')
    .values(
      rest.map((row) => ({
        region_id: row.region_id,
        instance_id: row.instance_id,
        from_kingdom_id: params.from,
        to_kingdom_id: params.to,
        cause: 'TAKEOVER',
        siege_id: params.siegeId,
        at: gameNow,
      })),
    )
    .execute();
  for (const row of moved) {
    events.push({
      type: 'region.changed',
      chunk: { x: row.chunk_x, y: row.chunk_y },
      payload: {
        regionId: row.region_id,
        ownerKingdomId: params.to,
        isCapital: false,
        protectedUntil: row.protected_until?.toISOString() ?? null,
        underSiege: false,
      },
    });
  }
  return events;
}

/**
 * Bricht eine offene Belagerung ab, deren Ziel bei einer Übernahme den Besitzer wechselt (auch
 * eine eröffnete PvP-Belagerung: Ihr Verteidiger besteht nicht mehr). Die Reservierung der Region
 * löst der Aufrufer mit der Übertragung.
 */
async function cancelSiege(tx: Tx, siegeId: string): Promise<WorldEvent[]> {
  const siege = await tx
    .selectFrom('sieges as s')
    .innerJoin('kingdoms as k', 'k.id', 's.attacker_kingdom_id')
    .leftJoin('kingdoms as d', 'd.id', 's.defender_kingdom_id')
    .select([
      's.status',
      's.version',
      's.mode',
      's.defender_kind',
      's.target_region_id',
      'k.owner_user_id',
      'd.owner_user_id as defender_user_id',
    ])
    .where('s.id', '=', siegeId)
    .forUpdate('s')
    .executeTakeFirstOrThrow();
  if (!(OPEN_SIEGE_STATUSES as readonly string[]).includes(siege.status)) {
    throw new Error(`Belagerung ${siegeId} reserviert eine Region, ist aber ${siege.status}`);
  }
  await tx
    .updateTable('sieges')
    .set({
      status: 'CANCELLED',
      outcome: 'NONE',
      outcome_reason: 'CANCELLED',
      resolved_at: gameNow,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', siegeId)
    .where('version', '=', siege.version)
    .execute();
  const answers = await tx
    .selectFrom('quiz_answers as a')
    .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
    .select([
      'p.role',
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
  await tx
    .insertInto('battle_results')
    .values({
      siege_id: siegeId,
      winner_role: null,
      reason: 'CANCELLED',
      attacker_summary: JSON.stringify(summary(attackerRows, null)),
      defender_summary: JSON.stringify({
        kind: siege.defender_kind,
        ...(siege.mode === 'PVP' ? summary(defenderRows, null) : {}),
        cancelled: 'TAKEOVER',
      }),
      defended: false,
      defense_points: 0,
      decided_at: gameNow,
      core_version: CORE_VERSION,
    })
    .execute();
  await appendBattleEvents(tx, siegeId, [
    {
      type: 'RESOLVED',
      payload: {
        status: 'CANCELLED',
        outcome: 'NONE',
        reason: 'CANCELLED',
        cause: 'TAKEOVER',
        coreVersion: CORE_VERSION,
      },
    },
  ]);
  const resolved = {
    siegeId,
    mode: siege.mode,
    regionId: siege.target_region_id,
    status: 'CANCELLED',
    conquered: false,
    capitalLivesLeft: null,
    kingdomTakenOver: null,
  };
  const events: WorldEvent[] = [];
  if (siege.owner_user_id) {
    events.push({
      type: 'siege.resolved',
      userId: siege.owner_user_id,
      payload: { ...resolved, role: 'ATTACKER' },
    });
  }
  // Wie bei `resolve`: Der Verteidiger erfährt nur von eröffneten PvP-Belagerungen.
  if (siege.mode === 'PVP' && siege.defender_user_id && siege.status !== 'PREPARING') {
    events.push({
      type: 'siege.resolved',
      userId: siege.defender_user_id,
      payload: { ...resolved, role: 'DEFENDER', defensePoints: 0 },
    });
  }
  return events;
}
