import { randomUUID } from 'node:crypto';
import { advanceGameClock } from '@rdw/db/testing';
import { areNeighbors } from '@rdw/game-core';
import {
  DEFAULT_RULES,
  PLAYTEST_RULES,
  answerResponseSchema,
  attackResponseSchema,
  challengeViewSchema,
  defenseResponseSchema,
  errorBodySchema,
  joinResponseSchema,
  meResponseSchema,
  siegesResponseSchema,
  type AnswerResponse,
  type AttackResponse,
  type JoinResponse,
  type RulesConfig,
} from '@rdw/protocol';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { expireStaleChallenges, type CreatedWorld } from '../src/index.ts';
import {
  TestClient,
  createTestWorld,
  importFixtureQuestions,
  startTestServer,
  type TestServer,
} from './helpers.ts';

/**
 * PvP über die HTTP-Schnittstelle (TEST_PLAN §7, Phase 2 Paket 1): verdecktes Gate, Eröffnung mit
 * Frist, Verteidigung, Auflösung beider Seiten, Fristablauf, Verteidigungspunkte mit Paarlimit,
 * Hauptstadt-Treffer mit Sperre je Angreifer, Abbruch und Neustart nach Totalverlust. Richtige
 * Antworten liest der Test wie ein Prüfer aus der Datenbank.
 */

const PLAYTEST = PLAYTEST_RULES as RulesConfig;
const MINUTE = 60_000;

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
  expect(await importFixtureQuestions(server.db)).toBe(40);
  return () => server.close();
});

interface Player {
  readonly client: TestClient;
  readonly userId: string;
  readonly joined: JoinResponse;
}

async function newPlayer(world: CreatedWorld): Promise<Player> {
  const client = new TestClient(server.app);
  const userId = await client.signUpGuest();
  const response = await client.join(world.worldId);
  expect(response.statusCode, response.body).toBe(201);
  return { client, userId, joined: joinResponseSchema.parse(response.json()) };
}

function errorOf(response: { statusCode: number; json(): unknown }) {
  const { error } = errorBodySchema.parse(response.json());
  return { status: response.statusCode, code: error.code, details: error.details };
}

function attack(player: Player, targetRegionId: string) {
  return player.client.post(`/instances/${player.joined.instanceId}/attacks`, {
    headers: { 'idempotency-key': randomUUID() },
    payload: { targetRegionId },
  });
}

async function startAttack(player: Player, targetRegionId: string): Promise<AttackResponse> {
  const response = await attack(player, targetRegionId);
  expect(response.statusCode, response.body).toBe(201);
  return attackResponseSchema.parse(response.json());
}

function answer(player: Player, challengeId: string, step: number, body: Record<string, unknown>) {
  return player.client.post(`/challenges/${challengeId}/steps/${step}/answer`, {
    headers: { 'idempotency-key': randomUUID() },
    payload: body,
  });
}

const presentationSchema = z.object({
  options: z.array(z.object({ token: z.string(), key: z.string() })),
});

type Role = 'ATTACKER' | 'DEFENDER';

/** Token einer richtigen bzw. falschen Option aus der Präsentation einer Seite. */
async function optionToken(challengeId: string, role: Role, correct: boolean): Promise<string> {
  const row = await server.db
    .selectFrom('quiz_answers as a')
    .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
    .innerJoin('quiz_challenge_steps as s', (join) =>
      join
        .onRef('s.challenge_id', '=', 'a.challenge_id')
        .onRef('s.step_index', '=', 'a.step_index'),
    )
    .select(['a.presentation', 's.version_id'])
    .where('a.challenge_id', '=', challengeId)
    .where('a.step_index', '=', 0)
    .where('p.role', '=', role)
    .executeTakeFirstOrThrow();
  const keys = await server.db
    .selectFrom('question_options')
    .select(['option_key', 'is_correct'])
    .where('version_id', '=', row.version_id)
    .execute();
  const wanted = new Set(keys.filter((k) => k.is_correct === correct).map((k) => k.option_key));
  const option = presentationSchema.parse(row.presentation).options.find((o) => wanted.has(o.key));
  if (!option) throw new Error('Option fehlt');
  return option.token;
}

/** Schätzung als deutsche Eingabe: exakt oder um eine Einheit daneben. */
async function estimateInput(challengeId: string, exact: boolean): Promise<string> {
  const row = await server.db
    .selectFrom('quiz_challenge_steps as s')
    .innerJoin('question_versions as v', 'v.id', 's.version_id')
    .select(['v.answer_value', 'v.input_max'])
    .where('s.challenge_id', '=', challengeId)
    .where('s.step_index', '=', 1)
    .executeTakeFirstOrThrow();
  if (row.answer_value === null) throw new Error('Schätzwert fehlt');
  if (exact) return row.answer_value.replace('.', ',');
  const value = Number(row.answer_value);
  const max = row.input_max === null ? Number.POSITIVE_INFINITY : Number(row.input_max);
  const off = value + 1 <= max ? value + 1 : value - 1;
  return String(off).replace('.', ',');
}

interface Play {
  readonly trivia: boolean;
  readonly exactEstimate: boolean;
}

/** Angreifer beantwortet im PvP immer beide Fragen; danach ist die Belagerung eröffnet. */
async function playAttacker(player: Player, challengeId: string, play: Play) {
  const presented = await player.client.post(`/challenges/${challengeId}/steps/0/present`);
  expect(presented.statusCode, presented.body).toBe(200);
  const first = answerResponseSchema.parse(
    (
      await answer(player, challengeId, 0, {
        optionToken: await optionToken(challengeId, 'ATTACKER', play.trivia),
        clientElapsedMs: 0,
      })
    ).json(),
  );
  // Im PvP kommt die Schätzfrage immer, ohne Hinweis, ob sie zählt ([O-19] A)
  expect(first.next?.kind).toBe('ESTIMATE');
  expect(first.resolution).toBeNull();
  const second = await answer(player, challengeId, 1, {
    rawInput: await estimateInput(challengeId, play.exactEstimate),
    locale: 'de',
    clientElapsedMs: 0,
  });
  expect(second.statusCode, second.body).toBe(200);
  const done = answerResponseSchema.parse(second.json());
  expect(done.next).toBeNull();
  expect(done.resolution).toBeNull();
  return done;
}

function startDefense(player: Player, siegeId: string) {
  return player.client.post(`/sieges/${siegeId}/defense`);
}

/** Verteidiger: Schritt 0 kam mit dem Verteidigungsbeginn, Schritt 1 mit der Antwort. */
async function playDefender(
  player: Player,
  challengeId: string,
  play: Play,
): Promise<AnswerResponse> {
  const first = answerResponseSchema.parse(
    (
      await answer(player, challengeId, 0, {
        optionToken: await optionToken(challengeId, 'DEFENDER', play.trivia),
        clientElapsedMs: 0,
      })
    ).json(),
  );
  expect(first.next?.kind).toBe('ESTIMATE');
  expect(first.resolution).toBeNull();
  const second = await answer(player, challengeId, 1, {
    rawInput: await estimateInput(challengeId, play.exactEstimate),
    locale: 'de',
    clientElapsedMs: 0,
  });
  expect(second.statusCode, second.body).toBe(200);
  return answerResponseSchema.parse(second.json());
}

async function regionsOf(instanceId: string) {
  return server.db
    .selectFrom('regions as r')
    .innerJoin('region_state as s', 's.region_id', 'r.id')
    .select([
      'r.id',
      'r.q',
      'r.r',
      's.owner_kingdom_id',
      's.is_capital',
      's.active_siege_id',
      sql<boolean>`coalesce(s.protected_until > game_now(), false)`.as('protected'),
    ])
    .where('r.instance_id', '=', instanceId)
    .orderBy('r.id')
    .execute();
}

/** Neutrale, freie Nachbarregion einer Region. */
async function neutralNextTo(instanceId: string, regionId: string): Promise<string> {
  const regions = await regionsOf(instanceId);
  const center = regions.find((r) => r.id === regionId);
  if (!center) throw new Error('Region fehlt');
  const target = regions.find(
    (r) =>
      r.owner_kingdom_id === null &&
      r.active_siege_id === null &&
      !r.protected &&
      areNeighbors(center, r),
  );
  if (!target) throw new Error('Keine neutrale Nachbarregion');
  return target.id;
}

/** Überträgt eine Region direkt in der Datenbank (Testaufbau) und hält die Regionszahlen gleich. */
async function transferRegion(regionId: string, toKingdomId: string): Promise<void> {
  await server.db.transaction().execute(async (tx) => {
    const state = await tx
      .selectFrom('region_state')
      .select('owner_kingdom_id')
      .where('region_id', '=', regionId)
      .executeTakeFirstOrThrow();
    if (state.owner_kingdom_id) {
      await tx
        .updateTable('kingdoms')
        .set({ region_count: sql<number>`region_count - 1` })
        .where('id', '=', state.owner_kingdom_id)
        .execute();
    }
    await tx
      .updateTable('kingdoms')
      .set({ region_count: sql<number>`region_count + 1` })
      .where('id', '=', toKingdomId)
      .execute();
    await tx
      .updateTable('region_state')
      .set({
        owner_kingdom_id: toKingdomId,
        is_capital: false,
        owned_since: sql<Date>`game_now()`,
        protected_until: null,
        protection_reason: null,
      })
      .where('region_id', '=', regionId)
      .execute();
  });
}

async function clearProtection(kingdomId: string): Promise<void> {
  await server.db
    .updateTable('kingdoms')
    .set({ protected_until: null, protection_reason: null })
    .where('id', '=', kingdomId)
    .execute();
}

interface Pair {
  readonly attacker: Player;
  readonly defender: Player;
  /** Region des Verteidigers neben der Hauptstadt des Angreifers (keine Hauptstadt). */
  readonly target: string;
  readonly instanceId: string;
}

/** Zwei Spieler in einer Welt; der Verteidiger besitzt eine Nachbarregion des Angreifers. */
async function pvpPair(
  options: { rules?: RulesConfig; keepAttackerProtection?: boolean } = {},
): Promise<Pair> {
  const world = await createTestWorld(server.db, { rules: options.rules ?? PLAYTEST });
  const attacker = await newPlayer(world);
  const defender = await newPlayer(world);
  const instanceId = attacker.joined.instanceId;
  const target = await neutralNextTo(instanceId, attacker.joined.capitalRegionId);
  await transferRegion(target, defender.joined.kingdom.id);
  await clearProtection(defender.joined.kingdom.id);
  if (!options.keepAttackerProtection) await clearProtection(attacker.joined.kingdom.id);
  return { attacker, defender, target, instanceId };
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

  it('nutzt mit Standardregeln 24 Stunden Frist und begrenzt neue Belagerungen je Angreifer', async () => {
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
