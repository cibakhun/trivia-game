import { randomUUID } from 'node:crypto';
import { advanceGameClock } from '@rdw/db/testing';
import {
  DEFAULT_RULES,
  challengeViewSchema,
  defenseResponseSchema,
  errorBodySchema,
  joinResponseSchema,
  meResponseSchema,
  siegesResponseSchema,
  type QuestionKind,
  type RulesConfig,
} from '@rdw/protocol';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { expireStaleChallenges } from '../src/index.ts';
import { loadCandidates } from '../src/modules/quiz/questions.ts';
import {
  createTestWorld,
  importFixtureQuestions,
  startTestServer,
  type TestServer,
} from './helpers.ts';
import { PLAYTEST, createPvpKit, type Pair, type Play, type Player } from './pvp-kit.ts';

/**
 * PvP über die HTTP-Schnittstelle (TEST_PLAN §7, Phase 2 Paket 1): verdecktes Gate, Eröffnung mit
 * Frist, Verteidigung, Auflösung beider Seiten, Fristablauf, Verteidigungspunkte mit Paarlimit,
 * Hauptstadt-Treffer mit Sperre je Angreifer, Abbruch und Neustart nach Totalverlust. Richtige
 * Antworten liest der Test wie ein Prüfer aus der Datenbank.
 */

const MINUTE = 60_000;

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
  expect(await importFixtureQuestions(server.db)).toBe(40);
  return () => server.close();
});

const {
  newPlayer,
  attack,
  startAttack,
  playAttacker,
  startDefense,
  playDefender,
  neutralNextTo,
  transferRegion,
  pvpPair,
} = createPvpKit(() => server);

function errorOf(response: { statusCode: number; json(): unknown }) {
  const { error } = errorBodySchema.parse(response.json());
  return { status: response.statusCode, code: error.code, details: error.details };
}

async function siegeRow(siegeId: string) {
  return server.db
    .selectFrom('sieges')
    .select([
      'status',
      'outcome',
      'outcome_reason',
      'opened_at',
      'base_deadline_at',
      'deadline_at',
      'max_deadline_at',
      'defense_started_at',
      'resolved_at',
    ])
    .where('id', '=', siegeId)
    .executeTakeFirstOrThrow();
}

async function battleEventTypes(siegeId: string): Promise<string[]> {
  const rows = await server.db
    .selectFrom('battle_events')
    .select('type')
    .where('siege_id', '=', siegeId)
    .orderBy('seq')
    .execute();
  return rows.map((r) => r.type);
}

async function personalEvents(instanceId: string, userId: string, type: string) {
  const rows = await server.db
    .selectFrom('world_events')
    .select('payload')
    .where('instance_id', '=', instanceId)
    .where('user_id', '=', userId)
    .where('type', '=', type)
    .orderBy('seq')
    .execute();
  return rows.map((r) => r.payload as Record<string, unknown>);
}

async function sieges(player: Player) {
  const response = await player.client.get(`/instances/${player.joined.instanceId}/sieges`);
  expect(response.statusCode, response.body).toBe(200);
  return siegesResponseSchema.parse(response.json());
}

async function view(player: Player, challengeId: string) {
  const response = await player.client.get(`/challenges/${challengeId}`);
  expect(response.statusCode, response.body).toBe(200);
  return challengeViewSchema.parse(response.json());
}

async function me(player: Player) {
  const response = await player.client.get('/me');
  expect(response.statusCode, response.body).toBe(200);
  return meResponseSchema.parse(response.json());
}

async function kingdomStats(kingdomId: string) {
  return server.db
    .selectFrom('kingdom_statistics')
    .select(['pvp_won', 'pvp_lost', 'defenses_won', 'defenses_lost', 'timeout_losses'])
    .select('defense_points')
    .where('kingdom_id', '=', kingdomId)
    .executeTakeFirstOrThrow();
}

async function playerStats(userId: string) {
  return server.db
    .selectFrom('player_statistics')
    .select(['battles', 'battles_won', 'defenses', 'defenses_won', 'defense_points'])
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
}

async function owner(regionId: string) {
  const row = await server.db
    .selectFrom('region_state')
    .select(['owner_kingdom_id', 'active_siege_id', 'is_capital', 'protection_reason'])
    .where('region_id', '=', regionId)
    .executeTakeFirstOrThrow();
  return row;
}

/** Angriff bis zur Eröffnung der Belagerung. */
async function openSiege(pair: Pair, play: Play, target = pair.target) {
  const started = await startAttack(pair.attacker, target);
  expect(started.mode).toBe('PVP');
  await playAttacker(pair.attacker, started.challengeId, play);
  expect((await siegeRow(started.siegeId)).status).toBe('AWAITING_DEFENSE');
  return started;
}

// ---------------------------------------------------------------------------------------------

describe('PvP: Angriff, Eröffnung und Verteidigung', () => {
  it('eröffnet nach dem Angreifer die Belagerung, der Verteidiger verteidigt und verliert', async () => {
    const pair = await pvpPair({ keepAttackerProtection: true });
    const { attacker, defender, target, instanceId } = pair;
    const started = await startAttack(attacker, target);
    expect(started.mode).toBe('PVP');
    expect(started.defender).toMatchObject({ kind: 'PLAYER' });
    // Ein PvP-Angriff beendet den eigenen Anfängerschutz (GAME_RULES §7)
    const attackerKingdom = await server.db
      .selectFrom('kingdoms')
      .select(['protected_until', 'protection_reason'])
      .where('id', '=', attacker.joined.kingdom.id)
      .executeTakeFirstOrThrow();
    expect(attackerKingdom).toEqual({ protected_until: null, protection_reason: null });

    // Verdecktes Gate: vor der Eröffnung sieht der Verteidiger nichts
    expect((await defender.client.get(`/challenges/${started.challengeId}`)).statusCode).toBe(404);
    expect(errorOf(await startDefense(defender, started.siegeId)).status).toBe(404);
    expect((await sieges(defender)).incoming).toEqual([]);
    expect((await me(defender)).instances[0]?.incomingSieges).toBe(0);

    await playAttacker(attacker, started.challengeId, { trivia: true, exactEstimate: true });
    const opened = await siegeRow(started.siegeId);
    expect(opened.status).toBe('AWAITING_DEFENSE');
    expect(opened.opened_at).not.toBeNull();
    // Spieltest-Regeln: 10 min Frist, ohne Items keine Verlängerung
    expect(opened.deadline_at!.getTime() - opened.opened_at!.getTime()).toBe(10 * MINUTE);
    expect(opened.max_deadline_at).toEqual(opened.deadline_at);
    expect(await battleEventTypes(started.siegeId)).toEqual([
      'ATTACK_CREATED',
      'ATTACK_PRESENTED',
      'ATTACK_SUBMITTED',
    ]);
    expect(await personalEvents(instanceId, defender.userId, 'siege.opened')).toEqual([
      expect.objectContaining({ siegeId: started.siegeId, role: 'DEFENDER', mode: 'PVP' }),
    ]);
    expect(await personalEvents(instanceId, attacker.userId, 'siege.opened')).toHaveLength(1);

    // Angreifer wartet: alle Schritte beantwortet, Frist sichtbar, noch keine Auflösung
    const waiting = await view(attacker, started.challengeId);
    expect(waiting).toMatchObject({
      role: 'ATTACKER',
      status: 'AWAITING_DEFENSE',
      currentStep: null,
      question: null,
      resolution: null,
      deadlineAt: opened.deadline_at!.toISOString(),
    });
    expect(waiting.opponent?.id).toBe(defender.joined.kingdom.id);
    expect((await sieges(attacker)).outgoing).toEqual([
      expect.objectContaining({ siegeId: started.siegeId, role: 'ATTACKER', canDefend: false }),
    ]);

    // Verteidiger sieht die Belagerung und kann verteidigen
    const list = await sieges(defender);
    expect(list.incoming).toHaveLength(1);
    expect(list.incoming[0]).toMatchObject({
      siegeId: started.siegeId,
      challengeId: started.challengeId,
      role: 'DEFENDER',
      status: 'AWAITING_DEFENSE',
      canDefend: true,
      defendBlockedBy: null,
      regionId: target,
    });
    expect(list.incoming[0]?.attacker.id).toBe(attacker.joined.kingdom.id);
    expect(list.incoming[0]?.remainingMs).toBeGreaterThan(9 * MINUTE);
    expect((await me(defender)).instances[0]?.incomingSieges).toBe(1);
    const before = await view(defender, started.challengeId);
    expect(before).toMatchObject({ role: 'DEFENDER', status: 'AWAITING_DEFENSE', question: null });
    expect(before.steps.map((s) => s.status)).toEqual(['PENDING', 'PENDING']);
    expect(before.opponent?.id).toBe(attacker.joined.kingdom.id);
    // Fragen gibt es erst mit dem Verteidigungsbeginn
    expect(
      errorOf(await defender.client.post(`/challenges/${started.challengeId}/steps/0/present`)),
    ).toMatchObject({ status: 409, code: 'STEP_NOT_AVAILABLE' });

    const defense = await startDefense(defender, started.siegeId);
    expect(defense.statusCode, defense.body).toBe(200);
    const begun = defenseResponseSchema.parse(defense.json());
    expect(begun.question).toMatchObject({ step: 0, kind: 'TRIVIA' });
    expect((await siegeRow(started.siegeId)).status).toBe('DEFENDING');
    expect((await me(defender)).instances[0]?.openChallengeId).toBe(started.challengeId);
    expect(await personalEvents(instanceId, attacker.userId, 'siege.updated')).toEqual([
      expect.objectContaining({ siegeId: started.siegeId, status: 'DEFENDING' }),
    ]);
    // Wiederholung: dieselbe Frage mit derselben Präsentation (Reload)
    const again = defenseResponseSchema.parse(
      (await startDefense(defender, started.siegeId)).json(),
    );
    expect(again.question.presentedAt).toBe(begun.question.presentedAt);
    expect(again.question.kind === 'TRIVIA' && again.question.options).toEqual(
      begun.question.kind === 'TRIVIA' && begun.question.options,
    );
    // Der Reload gilt nur für die Antwort des Verteidigers (danach zählt nur die Serverzeit)
    const reloads = await server.db
      .selectFrom('battle_events')
      .select('payload')
      .where('siege_id', '=', started.siegeId)
      .where('type', '=', 'STEP_RELOADED')
      .execute();
    expect(reloads.map((r) => r.payload)).toEqual([{ step: 0, role: 'DEFENDER' }]);

    const result = await playDefender(defender, started.challengeId, {
      trivia: false,
      exactEstimate: true,
    });
    expect(result.resolution).toMatchObject({
      mode: 'PVP',
      status: 'ATTACKER_WON',
      winner: 'ATTACKER',
      reason: 'TRIVIA',
      conquered: true,
      // Vollständige Verteidigung ohne richtige Trivia: nur der Grundwert
      defensePoints: 5,
    });
    expect(result.resolution?.defender.kind).toBe('PLAYER');
    expect(result.resolution?.estimate).not.toBeNull();
    expect((await owner(target)).owner_kingdom_id).toBe(attacker.joined.kingdom.id);
    const history = await server.db
      .selectFrom('region_history')
      .select('cause')
      .where('siege_id', '=', started.siegeId)
      .execute();
    expect(history).toEqual([{ cause: 'CONQUEST_PVP' }]);

    // Beide sehen dieselbe Auflösung; der Angreifer jetzt auch
    expect((await view(attacker, started.challengeId)).resolution).toEqual(result.resolution);
    expect(await kingdomStats(attacker.joined.kingdom.id)).toMatchObject({ pvp_won: 1 });
    expect(await kingdomStats(defender.joined.kingdom.id)).toMatchObject({
      defenses_lost: 1,
      defense_points: 5,
    });
    expect(await playerStats(defender.userId)).toMatchObject({
      defenses: 1,
      defenses_won: 0,
      defense_points: 5,
    });
    expect(await personalEvents(instanceId, defender.userId, 'siege.resolved')).toEqual([
      expect.objectContaining({
        siegeId: started.siegeId,
        status: 'ATTACKER_WON',
        role: 'DEFENDER',
      }),
    ]);
    const after = await sieges(defender);
    expect(after.incoming).toEqual([]);
    expect(after.recent[0]).toMatchObject({ siegeId: started.siegeId, winner: 'ATTACKER' });
  });

  it('der Verteidiger gewinnt mit der besseren Schätzung und erhält Verteidigungspunkte', async () => {
    const pair = await pvpPair();
    const started = await openSiege(pair, { trivia: true, exactEstimate: false });
    const begun = defenseResponseSchema.parse(
      (await startDefense(pair.defender, started.siegeId)).json(),
    );
    const result = await playDefender(pair.defender, begun.challengeId, {
      trivia: true,
      exactEstimate: true,
    });
    expect(result.resolution).toMatchObject({
      status: 'DEFENDER_WON',
      winner: 'DEFENDER',
      reason: 'ESTIMATE',
      conquered: false,
      defensePoints: 10,
    });
    expect(await owner(pair.target)).toMatchObject({
      owner_kingdom_id: pair.defender.joined.kingdom.id,
      active_siege_id: null,
    });
    expect(await kingdomStats(pair.attacker.joined.kingdom.id)).toMatchObject({ pvp_lost: 1 });
    expect(await kingdomStats(pair.defender.joined.kingdom.id)).toMatchObject({
      defenses_won: 1,
      defense_points: 10,
    });
  });

  it('am Gate gescheiterter Angreifer verliert gegen jede Verteidigung', async () => {
    const pair = await pvpPair();
    const started = await openSiege(pair, { trivia: false, exactEstimate: true });
    await startDefense(pair.defender, started.siegeId);
    const result = await playDefender(pair.defender, started.challengeId, {
      trivia: false,
      exactEstimate: false,
    });
    expect(result.resolution).toMatchObject({
      winner: 'DEFENDER',
      reason: 'ATTACKER_GATE',
      defensePoints: 5,
    });
  });

  it('weist eine Verteidigung kurz vor Fristende oder während eines eigenen Angriffs ab', async () => {
    const pair = await pvpPair();
    const started = await openSiege(pair, { trivia: true, exactEstimate: true });

    // Eigene laufende Herausforderung blockiert
    const ownTarget = await neutralNextTo(pair.instanceId, pair.defender.joined.capitalRegionId);
    await startAttack(pair.defender, ownTarget);
    expect((await sieges(pair.defender)).incoming[0]).toMatchObject({
      canDefend: false,
      defendBlockedBy: 'CHALLENGE_IN_PROGRESS',
    });
    expect(errorOf(await startDefense(pair.defender, started.siegeId))).toMatchObject({
      status: 409,
      code: 'CHALLENGE_IN_PROGRESS',
    });

    // Restzeit kleiner als eine Herausforderung + Puffer (≈ 61 s)
    await advanceGameClock(server.database.pool, 10 * MINUTE - 30_000);
    expect(errorOf(await startDefense(pair.defender, started.siegeId))).toMatchObject({
      status: 409,
      code: 'DEADLINE_TOO_CLOSE',
    });
    expect((await sieges(pair.defender)).incoming[0]).toMatchObject({
      canDefend: false,
      defendBlockedBy: 'DEADLINE_TOO_CLOSE',
    });
  });
});

describe('PvP: Fristablauf, Abbruch und Sichtbarkeit', () => {
  it('ohne Verteidigung gewinnt der Angreifer zur Frist (Aufräumlauf)', async () => {
    const pair = await pvpPair();
    const started = await openSiege(pair, { trivia: true, exactEstimate: true });
    await advanceGameClock(server.database.pool, 10 * MINUTE + 6_000);
    expect(await expireStaleChallenges(server.db)).toBeGreaterThanOrEqual(1);
    expect(await siegeRow(started.siegeId)).toMatchObject({
      status: 'ATTACKER_WON_BY_TIMEOUT',
      outcome_reason: 'TIMEOUT',
    });
    expect((await owner(pair.target)).owner_kingdom_id).toBe(pair.attacker.joined.kingdom.id);
    const history = await server.db
      .selectFrom('region_history')
      .select('cause')
      .where('siege_id', '=', started.siegeId)
      .execute();
    expect(history).toEqual([{ cause: 'TIMEOUT' }]);
    expect(await kingdomStats(pair.defender.joined.kingdom.id)).toMatchObject({
      defenses_lost: 1,
      timeout_losses: 1,
      defense_points: 0,
    });
    // Der Verteidiger sieht die Auflösung; ihre Fragen gelten für ihn als gesehen
    const resolution = (await view(pair.defender, started.challengeId)).resolution;
    expect(resolution).toMatchObject({ winner: 'ATTACKER', reason: 'TIMEOUT', defensePoints: 0 });
    const exposure = await server.db
      .selectFrom('player_question_exposure')
      .select('question_id')
      .where('user_id', '=', pair.defender.userId)
      .execute();
    expect(exposure.length).toBeGreaterThanOrEqual(2);
  });

  it('ohne Verteidigung scheitert ein falscher Angreifer zur Frist am Gate (beim Lesen)', async () => {
    const pair = await pvpPair();
    const started = await openSiege(pair, { trivia: false, exactEstimate: true });
    await advanceGameClock(server.database.pool, 10 * MINUTE + 6_000);
    // Auflösung beim Lesen der Übersicht
    const list = await sieges(pair.defender);
    expect(list.incoming).toEqual([]);
    expect(list.recent[0]).toMatchObject({
      siegeId: started.siegeId,
      status: 'ATTACK_FAILED',
      winner: 'NONE',
      reason: 'ATTACKER_GATE',
    });
    expect((await owner(pair.target)).owner_kingdom_id).toBe(pair.defender.joined.kingdom.id);
    // Ein Gate-Fehlschlag ohne Verteidigung zählt nicht als Verteidigung
    expect(await kingdomStats(pair.defender.joined.kingdom.id)).toMatchObject({
      defenses_won: 0,
      defenses_lost: 0,
    });
  });

  it('ein abgebrochener Angriff bleibt für den Verteidiger unsichtbar', async () => {
    const pair = await pvpPair();
    const started = await startAttack(pair.attacker, pair.target);
    await pair.attacker.client.post(`/challenges/${started.challengeId}/steps/0/present`);
    await advanceGameClock(server.database.pool, 60_000);
    await expireStaleChallenges(server.db);
    expect(await siegeRow(started.siegeId)).toMatchObject({
      status: 'ATTACK_FAILED',
      outcome_reason: 'ABANDONED',
      opened_at: null,
    });
    expect((await pair.defender.client.get(`/challenges/${started.challengeId}`)).statusCode).toBe(
      404,
    );
    expect((await sieges(pair.defender)).recent).toEqual([]);
    expect(await personalEvents(pair.instanceId, pair.defender.userId, 'siege.resolved')).toEqual(
      [],
    );
  });

  it('bricht eine eröffnete Belagerung ab, wenn das Angreiferreich fällt (N10)', async () => {
    const pair = await pvpPair();
    const started = await openSiege(pair, { trivia: true, exactEstimate: true });
    await server.db
      .updateTable('kingdoms')
      .set({ status: 'FALLEN', fallen_at: sql<Date>`game_now()` })
      .where('id', '=', pair.attacker.joined.kingdom.id)
      .execute();
    await expireStaleChallenges(server.db);
    expect(await siegeRow(started.siegeId)).toMatchObject({
      status: 'CANCELLED',
      outcome_reason: 'CANCELLED',
    });
    expect(await owner(pair.target)).toMatchObject({
      owner_kingdom_id: pair.defender.joined.kingdom.id,
      active_siege_id: null,
    });
    expect(await personalEvents(pair.instanceId, pair.defender.userId, 'siege.resolved')).toEqual([
      expect.objectContaining({ siegeId: started.siegeId, status: 'CANCELLED' }),
    ]);
  });
});

describe('PvP: Punkte, Hauptstadt und Grenzen', () => {
  it('vergibt Verteidigungspunkte höchstens zweimal je Reichspaar in 24 Stunden', async () => {
    const pair = await pvpPair();
    const points: number[] = [];
    for (let round = 0; round < 3; round++) {
      const started = await openSiege(pair, { trivia: false, exactEstimate: true });
      await startDefense(pair.defender, started.siegeId);
      const result = await playDefender(pair.defender, started.challengeId, {
        trivia: true,
        exactEstimate: true,
      });
      points.push(result.resolution?.defensePoints ?? -1);
    }
    expect(points).toEqual([10, 10, 0]);
    const last = await server.db
      .selectFrom('battle_results as b')
      .innerJoin('sieges as s', 's.id', 'b.siege_id')
      .select('b.defender_summary')
      .where('s.attacker_kingdom_id', '=', pair.attacker.joined.kingdom.id)
      .orderBy('b.decided_at', 'desc')
      .executeTakeFirstOrThrow();
    expect(last.defender_summary).toMatchObject({ pointsPairLimited: true });
    expect(await kingdomStats(pair.defender.joined.kingdom.id)).toMatchObject({
      defenses_won: 3,
      defense_points: 20,
    });
  });

  it('trifft die Hauptstadt eines Spielers und sperrt denselben Angreifer danach', async () => {
    const pair = await pvpPair();
    const capital = pair.defender.joined.capitalRegionId;
    // Angreifer erhält eine Nachbarregion der gegnerischen Hauptstadt
    const foothold = await neutralNextTo(pair.instanceId, capital);
    await transferRegion(foothold, pair.attacker.joined.kingdom.id);

    const started = await openSiege(pair, { trivia: true, exactEstimate: true }, capital);
    await advanceGameClock(server.database.pool, 10 * MINUTE + 6_000);
    await expireStaleChallenges(server.db);
    const resolution = (await view(pair.attacker, started.challengeId)).resolution;
    expect(resolution).toMatchObject({
      status: 'ATTACKER_WON_BY_TIMEOUT',
      conquered: false,
      capital: { takenOver: false, livesLeft: 2, maxLives: 3 },
    });
    expect(await owner(capital)).toMatchObject({
      owner_kingdom_id: pair.defender.joined.kingdom.id,
      is_capital: true,
      protection_reason: 'CAPITAL_HIT',
    });

    // Nach dem Trefferschutz (2 min), aber innerhalb der Sperre je Angreifer (15 min)
    await advanceGameClock(server.database.pool, 3 * MINUTE);
    const blocked = errorOf(await attack(pair.attacker, capital));
    expect(blocked).toMatchObject({ status: 409, code: 'CAPITAL_HIT_COOLDOWN' });
    expect(typeof blocked.details?.until).toBe('string');
    await advanceGameClock(server.database.pool, 13 * MINUTE);
    expect((await attack(pair.attacker, capital)).statusCode).toBe(201);
  });

  it('nutzt mit Standardregeln 24 Stunden Frist und sperrt die belagerte Region', async () => {
    const pair = await pvpPair({ rules: DEFAULT_RULES.ETERNAL });
    const started = await openSiege(pair, { trivia: true, exactEstimate: true });
    const row = await siegeRow(started.siegeId);
    expect(row.deadline_at!.getTime() - row.opened_at!.getTime()).toBe(24 * 60 * MINUTE);
    expect(row.max_deadline_at!.getTime() - row.opened_at!.getTime()).toBe(48 * 60 * MINUTE);
    // Belagerte Region ist reserviert
    expect(errorOf(await attack(pair.attacker, pair.target))).toMatchObject({
      code: 'REGION_UNDER_SIEGE',
    });
  });

  it('begrenzt neu eröffnete Belagerungen je Angreifer im gleitenden Fenster', async () => {
    const rules: RulesConfig = {
      ...PLAYTEST,
      attack: {
        ...PLAYTEST.attack,
        maxNewPvpSiegesPerAttacker: { count: 1, windowMs: 60 * MINUTE },
      },
    };
    const pair = await pvpPair({ rules });
    await openSiege(pair, { trivia: true, exactEstimate: true });
    const second = await neutralNextTo(pair.instanceId, pair.attacker.joined.capitalRegionId);
    await transferRegion(second, pair.defender.joined.kingdom.id);
    const refused = errorOf(await attack(pair.attacker, second));
    expect(refused).toMatchObject({ status: 409, code: 'ATTACKER_SIEGE_LIMIT' });
    expect(refused.details).toHaveProperty('resetAt');
    // Nach dem Fenster wieder erlaubt (die erste Belagerung ist inzwischen durch Zeitablauf entschieden)
    await advanceGameClock(server.database.pool, 61 * MINUTE);
    expect((await attack(pair.attacker, second)).statusCode).toBe(201);
  });

  it('löst eine abgelaufene eigene Verteidigung auf, bevor sie eine neue blockiert', async () => {
    const pair = await pvpPair();
    const first = await openSiege(pair, { trivia: true, exactEstimate: true });
    const secondTarget = await neutralNextTo(pair.instanceId, pair.attacker.joined.capitalRegionId);
    await transferRegion(secondTarget, pair.defender.joined.kingdom.id);
    const second = await openSiege(pair, { trivia: true, exactEstimate: true }, secondTarget);
    // Verteidigung der ersten Belagerung begonnen und liegen gelassen
    expect((await startDefense(pair.defender, first.siegeId)).statusCode).toBe(200);
    expect(errorOf(await startDefense(pair.defender, second.siegeId))).toMatchObject({
      status: 409,
      code: 'CHALLENGE_IN_PROGRESS',
    });
    // Wissensfrage samt Kulanz abgelaufen: Die erste Belagerung wird aufgelöst, die zweite beginnt
    await advanceGameClock(server.database.pool, 30_000);
    expect((await startDefense(pair.defender, second.siegeId)).statusCode).toBe(200);
    expect((await siegeRow(first.siegeId)).status).toBe('ATTACKER_WON');
  });

  it('meidet Fragen aus offenen Belagerungen beider Spieler', async () => {
    const pair = await pvpPair();
    const started = await openSiege(pair, { trivia: true, exactEstimate: true });
    const steps = await server.db
      .selectFrom('quiz_challenge_steps as st')
      .innerJoin('question_versions as v', 'v.id', 'st.version_id')
      .select(['st.kind', 'v.question_id'])
      .where('st.challenge_id', '=', started.challengeId)
      .execute();
    const now = new Date(Date.now() + 365 * 24 * 60 * MINUTE);
    for (const step of steps) {
      // Der Verteidiger hat die Fragen noch nie gestellt bekommen, sie gelten trotzdem als gesehen
      const candidates = await loadCandidates(server.db, {
        kind: step.kind as QuestionKind,
        userIds: [pair.defender.userId],
        allowFixtures: true,
        now,
      });
      expect(candidates.find((c) => c.questionId === step.question_id)?.lastSeenAt).toBe(
        now.getTime(),
      );
      const exposure = await server.db
        .selectFrom('player_question_exposure')
        .select('question_id')
        .where('user_id', '=', pair.defender.userId)
        .where('question_id', '=', step.question_id)
        .execute();
      expect(exposure).toEqual([]);
    }
  });
});

describe('Neustart nach Totalverlust (POST /instances/:id/respawn)', () => {
  it('gründet nach dem Fall ein neues Reich mit Wiederaufbauschutz', async () => {
    const world = await createTestWorld(server.db, { rules: PLAYTEST });
    const player = await newPlayer(world);
    const { instanceId, kingdom, capitalRegionId } = player.joined;
    const respawn = (key = randomUUID()) =>
      player.client.post(`/instances/${instanceId}/respawn`, {
        headers: { 'idempotency-key': key },
      });
    expect(errorOf(await respawn())).toMatchObject({ status: 409, code: 'KINGDOM_ACTIVE' });

    // Fall im Testaufbau: Hauptstadt geht verloren, Reich fällt
    await server.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('region_state')
        .set({ owner_kingdom_id: null, is_capital: false, owned_since: null })
        .where('region_id', '=', capitalRegionId)
        .execute();
      await tx
        .updateTable('kingdoms')
        .set({ status: 'FALLEN', fallen_at: sql<Date>`game_now()`, region_count: 0 })
        .where('id', '=', kingdom.id)
        .execute();
    });
    const key = randomUUID();
    const response = await respawn(key);
    expect(response.statusCode, response.body).toBe(201);
    const reborn = joinResponseSchema.parse(response.json());
    expect(reborn.kingdom.id).not.toBe(kingdom.id);
    expect(reborn.kingdom).toMatchObject({
      status: 'ACTIVE',
      regionCount: 1,
      protectionReason: 'RESPAWN',
    });
    const row = await server.db
      .selectFrom('kingdoms')
      .select(['generation', 'protection_reason'])
      .where('id', '=', reborn.kingdom.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ generation: 2, protection_reason: 'RESPAWN' });
    expect((await me(player)).instances[0]?.kingdom?.id).toBe(reborn.kingdom.id);
    // Wiederholung mit demselben Schlüssel: dieselbe Antwort; neuer Schlüssel: Reich besteht
    const replay = await respawn(key);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(errorOf(await respawn())).toMatchObject({ status: 409, code: 'KINGDOM_ACTIVE' });
  });
});
