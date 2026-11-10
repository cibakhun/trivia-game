import { randomUUID } from 'node:crypto';
import { advanceGameClock } from '@rdw/db/testing';
import { areNeighbors, hexDistance } from '@rdw/game-core';
import {
  answerResponseSchema,
  attackResponseSchema,
  challengeViewSchema,
  errorBodySchema,
  joinResponseSchema,
  mapStateResponseSchema,
  meResponseSchema,
  presentResponseSchema,
  regionDetailResponseSchema,
  type AnswerRequest,
  type AnswerResponse,
  type AttackResponse,
  type JoinResponse,
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
 * PvE-Kampf über die HTTP-Schnittstelle (TEST_PLAN §7, Abnahme „Gebietseroberung PvE“): Angriff,
 * Fragen, Antworten, Auflösung und alle Wirkungen in der Datenbank. Richtige Antworten liest der
 * Test wie ein Prüfer aus der Datenbank; der Client bekommt sie nie zu sehen.
 */

let server: TestServer;
let world: CreatedWorld;

beforeAll(async () => {
  server = await startTestServer();
  expect(await importFixtureQuestions(server.db)).toBe(40);
  world = await createTestWorld(server.db);
  return () => server.close();
});

interface Player {
  readonly client: TestClient;
  readonly userId: string;
  readonly joined: JoinResponse;
}

/** Neuer Gast mit Reich; ohne Angabe in einer eigenen Welt (Startregionen sind begrenzt). */
async function newPlayer(target?: CreatedWorld): Promise<Player> {
  const client = new TestClient(server.app);
  const userId = await client.signUpGuest();
  const response = await client.join((target ?? (await createTestWorld(server.db))).worldId);
  expect(response.statusCode, response.body).toBe(201);
  return { client, userId, joined: joinResponseSchema.parse(response.json()) };
}

function tutorialTarget(player: Player): string {
  const target = player.joined.tutorialTargetRegionId;
  if (target === null) throw new Error('Keine Tutorial-Region');
  return target;
}

function errorOf(response: { statusCode: number; json(): unknown }) {
  const { error } = errorBodySchema.parse(response.json());
  return { status: response.statusCode, code: error.code, details: error.details };
}

function attack(
  client: TestClient,
  instanceId: string,
  targetRegionId: string,
  key = randomUUID(),
) {
  return client.post(`/instances/${instanceId}/attacks`, {
    headers: { 'idempotency-key': key },
    payload: { targetRegionId },
  });
}

async function startAttack(player: Player, targetRegionId: string): Promise<AttackResponse> {
  const response = await attack(player.client, player.joined.instanceId, targetRegionId);
  expect(response.statusCode, response.body).toBe(201);
  return attackResponseSchema.parse(response.json());
}

function present(client: TestClient, challengeId: string, step: number) {
  return client.post(`/challenges/${challengeId}/steps/${step}/present`);
}

function answer(
  client: TestClient,
  challengeId: string,
  step: number,
  body: AnswerRequest | Record<string, unknown>,
  key = randomUUID(),
) {
  return client.post(`/challenges/${challengeId}/steps/${step}/answer`, {
    headers: { 'idempotency-key': key },
    payload: body,
  });
}

const presentationSchema = z.object({
  options: z.array(z.object({ token: z.string(), key: z.string() })),
});

/** Token einer richtigen bzw. falschen Option aus der Präsentation des Angreifers. */
async function optionToken(challengeId: string, correct: boolean): Promise<string> {
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
    .where('p.role', '=', 'ATTACKER')
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

/** Der exakte Schätzwert als deutsche Eingabe. */
async function estimateInput(challengeId: string): Promise<string> {
  const row = await server.db
    .selectFrom('quiz_challenge_steps as s')
    .innerJoin('question_versions as v', 'v.id', 's.version_id')
    .select(['v.answer_value', 'v.input_max'])
    .where('s.challenge_id', '=', challengeId)
    .where('s.step_index', '=', 1)
    .executeTakeFirstOrThrow();
  if (row.answer_value === null) throw new Error('Schätzwert fehlt');
  return row.answer_value.replace('.', ',');
}

/** Spielt eine Herausforderung durch; die Schätzung ist exakt und sofort abgegeben. */
async function playChallenge(
  player: Player,
  challengeId: string,
  triviaCorrect: boolean,
): Promise<AnswerResponse> {
  const presented = await present(player.client, challengeId, 0);
  expect(presented.statusCode, presented.body).toBe(200);
  const first = await answer(player.client, challengeId, 0, {
    optionToken: await optionToken(challengeId, triviaCorrect),
    clientElapsedMs: 0,
  });
  expect(first.statusCode, first.body).toBe(200);
  const afterTrivia = answerResponseSchema.parse(first.json());
  expect(afterTrivia.next?.kind).toBe('ESTIMATE');
  expect(afterTrivia.resolution).toBeNull();
  const second = await answer(player.client, challengeId, 1, {
    rawInput: await estimateInput(challengeId),
    locale: 'de',
    clientElapsedMs: 0,
  });
  expect(second.statusCode, second.body).toBe(200);
  return answerResponseSchema.parse(second.json());
}

interface RegionRow {
  readonly id: string;
  readonly q: number;
  readonly r: number;
  readonly owner_kingdom_id: string | null;
  readonly is_capital: boolean;
  readonly active_siege_id: string | null;
  readonly protected: boolean;
}

async function regionsOf(instanceId: string): Promise<RegionRow[]> {
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

/** Eine angreifbare neutrale Nachbarregion des Reichs. */
async function neutralNeighbour(instanceId: string, kingdomId: string): Promise<string> {
  const regions = await regionsOf(instanceId);
  const owned = regions.filter((r) => r.owner_kingdom_id === kingdomId);
  const target = regions.find(
    (r) =>
      r.owner_kingdom_id === null &&
      r.active_siege_id === null &&
      !r.protected &&
      owned.some((o) => areNeighbors(o, r)),
  );
  if (!target) throw new Error('Keine neutrale Nachbarregion');
  return target.id;
}

/** Eine Region, die an keine Region des Reichs grenzt. */
async function distantRegion(instanceId: string, kingdomId: string): Promise<string> {
  const regions = await regionsOf(instanceId);
  const owned = regions.filter((r) => r.owner_kingdom_id === kingdomId);
  const target = regions.find(
    (r) => r.owner_kingdom_id === null && owned.every((o) => hexDistance(o, r) > 2),
  );
  if (!target) throw new Error('Keine entfernte Region');
  return target.id;
}

async function kingdomRow(kingdomId: string) {
  return server.db
    .selectFrom('kingdoms')
    .select([
      'region_count',
      'status',
      'protected_until',
      'protection_reason',
      'npc_faction_id',
      'fallen_at',
    ])
    .where('id', '=', kingdomId)
    .executeTakeFirstOrThrow();
}

async function capitalOf(kingdomId: string): Promise<string | null> {
  const row = await server.db
    .selectFrom('region_state')
    .select('region_id')
    .where('owner_kingdom_id', '=', kingdomId)
    .where('is_capital', '=', true)
    .executeTakeFirst();
  return row?.region_id ?? null;
}

/** Überträgt eine Region direkt in der Datenbank (Testaufbau) und hält die Regionszahlen gleich. */
async function transferRegion(regionId: string, toKingdomId: string | null): Promise<void> {
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
    if (toKingdomId) {
      await tx
        .updateTable('kingdoms')
        .set({ region_count: sql<number>`region_count + 1` })
        .where('id', '=', toKingdomId)
        .execute();
    }
    await tx
      .updateTable('region_state')
      .set({
        owner_kingdom_id: toKingdomId,
        is_capital: false,
        owned_since: toKingdomId ? sql<Date>`game_now()` : null,
        protected_until: null,
        protection_reason: null,
      })
      .where('region_id', '=', regionId)
      .execute();
  });
}

async function eventSeq(instanceId: string): Promise<string> {
  const row = await server.db
    .selectFrom('world_instances')
    .select('event_seq')
    .where('id', '=', instanceId)
    .executeTakeFirstOrThrow();
  return row.event_seq;
}

async function worldEventsSince(instanceId: string, seq: string) {
  return server.db
    .selectFrom('world_events')
    .select(['type', 'payload', 'user_id', 'chunk_x'])
    .where('instance_id', '=', instanceId)
    .where('seq', '>', seq)
    .orderBy('seq')
    .execute();
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

async function siegeRow(siegeId: string) {
  return server.db
    .selectFrom('sieges')
    .select(['status', 'outcome', 'outcome_reason', 'attack_presented_at', 'resolved_at'])
    .where('id', '=', siegeId)
    .executeTakeFirstOrThrow();
}

async function regionState(regionId: string) {
  return server.db
    .selectFrom('region_state')
    .select([
      'owner_kingdom_id',
      'is_capital',
      'active_siege_id',
      'protection_reason',
      sql<number | null>`extract(epoch from (protected_until - game_now()))::int`.as(
        'protected_seconds',
      ),
    ])
    .where('region_id', '=', regionId)
    .executeTakeFirstOrThrow();
}

async function regionDetail(player: Player, regionId: string) {
  const response = await player.client.get(
    `/instances/${player.joined.instanceId}/regions/${regionId}`,
  );
  expect(response.statusCode, response.body).toBe(200);
  return regionDetailResponseSchema.parse(response.json());
}

// ---------------------------------------------------------------------------------------------

describe('Angriffsberechtigung in den Regionsdetails', () => {
  it('zeigt eigene, entfernte und angreifbare Regionen', async () => {
    const player = await newPlayer();
    const { kingdom, capitalRegionId, instanceId } = player.joined;
    expect((await regionDetail(player, capitalRegionId)).attack).toEqual({
      allowed: false,
      mode: null,
      defenderKind: null,
      reason: 'OWN_REGION',
      until: null,
    });
    expect((await regionDetail(player, tutorialTarget(player))).attack).toEqual({
      allowed: true,
      mode: 'PVE',
      defenderKind: 'NEUTRAL',
      reason: null,
      until: null,
    });
    const far = await distantRegion(instanceId, kingdom.id);
    expect((await regionDetail(player, far)).attack.reason).toBe('NOT_ADJACENT');

    // Ohne Reich in der Welt: lesen ja, angreifen nein
    const visitor = new TestClient(server.app);
    await visitor.signUpGuest();
    const seen = regionDetailResponseSchema.parse(
      (await visitor.get(`/instances/${instanceId}/regions/${far}`)).json(),
    );
    expect(seen.attack).toMatchObject({ allowed: false, reason: 'NO_ACTIVE_KINGDOM' });
  });
});

describe('Gebietseroberung PvE', () => {
  it('erobert die Tutorial-Region mit richtigen Antworten', async () => {
    const player = await newPlayer();
    const { instanceId, kingdom } = player.joined;
    const target = tutorialTarget(player);
    const seqBefore = await eventSeq(instanceId);

    // 1. Angriff: Region reserviert, Antworten der Garnison vor der ersten Frage versiegelt
    const started = await startAttack(player, target);
    expect(started).toMatchObject({
      instanceId,
      mode: 'PVE',
      targetRegionId: target,
      defender: { kind: 'NEUTRAL', kingdom: null },
    });
    expect(started.steps).toEqual([
      { index: 0, kind: 'TRIVIA', timeLimitMs: 20_000 },
      { index: 1, kind: 'ESTIMATE', timeLimitMs: 30_000 },
    ]);
    expect((await regionState(target)).active_siege_id).toBe(started.siegeId);
    expect((await regionDetail(player, target)).region.underSiege).toBe(true);
    const sealed = await server.db
      .selectFrom('quiz_answers as a')
      .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
      .select(['p.role', 'a.step_index', 'a.status'])
      .where('a.siege_id', '=', started.siegeId)
      .orderBy('a.step_index')
      .execute();
    expect(sealed).toEqual([
      { role: 'DEFENDER', step_index: 0, status: 'GENERATED' },
      { role: 'DEFENDER', step_index: 1, status: 'GENERATED' },
    ]);
    expect(await battleEventTypes(started.siegeId)).toEqual([
      'ATTACK_CREATED',
      'NPC_ANSWERS_SEALED',
    ]);
    expect((await siegeRow(started.siegeId)).attack_presented_at).toBeNull();
    // Nach einem Reload findet der Client die laufende Herausforderung über das Profil
    const during = meResponseSchema.parse((await player.client.get('/me')).json());
    expect(during.instances[0]?.openChallengeId).toBe(started.challengeId);

    // 2. Trivia: nur Token und Texte, kein Hinweis auf die richtige Option
    const presentedResponse = await present(player.client, started.challengeId, 0);
    expect(presentedResponse.statusCode).toBe(200);
    const presented = presentResponseSchema.parse(presentedResponse.json());
    expect(presented.question).toMatchObject({ kind: 'TRIVIA', step: 0, timeLimitMs: 20_000 });
    expect(presentedResponse.body).not.toMatch(/correct|"key"|optionKey|answer/i);
    expect((await siegeRow(started.siegeId)).attack_presented_at).not.toBeNull();

    const first = answerResponseSchema.parse(
      (
        await answer(player.client, started.challengeId, 0, {
          optionToken: await optionToken(started.challengeId, true),
          clientElapsedMs: 0,
        })
      ).json(),
    );
    // Gespeichert, ohne Richtigkeit; die Schätzfrage kommt sofort
    expect(first).toMatchObject({ step: 0, status: 'ANSWERED', resolution: null });
    expect(first.next).toMatchObject({ kind: 'ESTIMATE', step: 1, timeLimitMs: 30_000 });
    expect(JSON.stringify(first)).not.toMatch(/correct/i);

    // 3. Exakte Schätzung → Sieg und Auflösung in der Antwort
    const last = answerResponseSchema.parse(
      (
        await answer(player.client, started.challengeId, 1, {
          rawInput: await estimateInput(started.challengeId),
          locale: 'de',
          clientElapsedMs: 0,
        })
      ).json(),
    );
    const resolution = last.resolution;
    expect(last.next).toBeNull();
    expect(resolution).toMatchObject({
      siegeId: started.siegeId,
      status: 'ATTACKER_WON',
      winner: 'ATTACKER',
      regionId: target,
      conquered: true,
      attacker: {
        kind: 'PLAYER',
        triviaCorrect: true,
        estimateDistance: '0',
        estimateEffectiveMs: 0,
      },
      defender: { kind: 'NEUTRAL', kingdom: null },
    });
    expect(['TRIVIA', 'ESTIMATE', 'SPEED']).toContain(resolution?.reason);
    expect(resolution?.regionProtectedUntil).not.toBeNull();
    expect(resolution?.trivia?.options.filter((o) => o.correct)).toHaveLength(1);
    expect(resolution?.estimate?.answerValue).toBeTruthy();

    // 4. Wirkungen: Besitz, Schutz, Reich, Verlauf, Kampfergebnis, Statistik, Ereignisse
    const state = await regionState(target);
    expect(state).toMatchObject({
      owner_kingdom_id: kingdom.id,
      is_capital: false,
      active_siege_id: null,
      protection_reason: 'CONQUEST',
    });
    expect(state.protected_seconds).toBeGreaterThan(6 * 3600 - 60);
    expect(state.protected_seconds).toBeLessThanOrEqual(6 * 3600);
    expect((await kingdomRow(kingdom.id)).region_count).toBe(2);
    expect(
      await server.db
        .selectFrom('region_history')
        .select(['from_kingdom_id', 'to_kingdom_id', 'cause', 'siege_id'])
        .where('region_id', '=', target)
        .execute(),
    ).toEqual([
      {
        from_kingdom_id: null,
        to_kingdom_id: kingdom.id,
        cause: 'CONQUEST_PVE',
        siege_id: started.siegeId,
      },
    ]);
    expect(await siegeRow(started.siegeId)).toMatchObject({
      status: 'ATTACKER_WON',
      outcome: 'ATTACKER',
      outcome_reason: resolution?.reason,
    });
    expect(
      await server.db
        .selectFrom('battle_results')
        .select(['winner_role', 'defended', 'defense_points', 'core_version'])
        .where('siege_id', '=', started.siegeId)
        .executeTakeFirst(),
    ).toEqual({ winner_role: 'ATTACKER', defended: true, defense_points: 0, core_version: '1' });
    expect(await battleEventTypes(started.siegeId)).toEqual([
      'ATTACK_CREATED',
      'NPC_ANSWERS_SEALED',
      'ATTACK_PRESENTED',
      'RESOLVED',
    ]);
    expect(
      await server.db
        .selectFrom('player_statistics')
        .select(['battles', 'battles_won', 'conquests', 'trivia_answered', 'trivia_correct'])
        .where('user_id', '=', player.userId)
        .executeTakeFirst(),
    ).toEqual({ battles: 1, battles_won: 1, conquests: 1, trivia_answered: 1, trivia_correct: 1 });
    const events = await worldEventsSince(instanceId, seqBefore);
    expect(events.map((e) => e.type)).toEqual([
      'region.changed',
      'region.changed',
      'kingdom.changed',
      'siege.resolved',
    ]);
    expect(events[0]?.payload).toEqual({
      regionId: target,
      ownerKingdomId: null,
      isCapital: false,
      protectedUntil: null,
      underSiege: true,
    });
    expect(events[1]?.payload).toMatchObject({
      regionId: target,
      ownerKingdomId: kingdom.id,
      underSiege: false,
    });
    expect(events[2]?.payload).toEqual({
      kingdomId: kingdom.id,
      status: 'ACTIVE',
      regionCount: 2,
      rank: 'SETTLEMENT',
      capitalRegionId: player.joined.capitalRegionId,
    });
    // Persönliches Ereignis: nur für den Angreifer, ohne Chunk
    expect(events[3]).toMatchObject({ user_id: player.userId, chunk_x: null });

    // 5. Lesesicht: Herausforderung, Karte, Profil
    const view = challengeViewSchema.parse(
      (await player.client.get(`/challenges/${started.challengeId}`)).json(),
    );
    expect(view).toMatchObject({
      status: 'ATTACKER_WON',
      currentStep: null,
      question: null,
      steps: [
        { index: 0, status: 'ANSWERED' },
        { index: 1, status: 'ANSWERED' },
      ],
    });
    expect(view.resolution).toEqual(resolution);
    const map = mapStateResponseSchema.parse(
      (await player.client.get(`/instances/${instanceId}/map/state?chunks=0:0`)).json(),
    );
    expect(map.chunks[0]?.regions.find((r) => r.id === target)).toMatchObject({
      ownerKingdomId: kingdom.id,
      underSiege: false,
    });
    const me = meResponseSchema.parse((await player.client.get('/me')).json());
    expect(me.instances[0]?.kingdom?.regionCount).toBe(2);
    expect(me.instances[0]?.tutorialTargetRegionId).toBeNull();
    expect(me.instances[0]?.openChallengeId).toBeNull();
  });

  it('scheitert am verdeckten Gate bei falscher Trivia-Antwort', async () => {
    const player = await newPlayer();
    const target = tutorialTarget(player);
    const started = await startAttack(player, target);
    const result = await playChallenge(player, started.challengeId, false);
    expect(result.resolution).toMatchObject({
      status: 'DEFENDER_WON',
      winner: 'DEFENDER',
      reason: 'ATTACKER_GATE',
      conquered: false,
      regionProtectedUntil: null,
      attacker: { triviaCorrect: false, estimateDistance: '0' },
    });
    expect(await regionState(target)).toMatchObject({
      owner_kingdom_id: null,
      active_siege_id: null,
    });
    expect((await kingdomRow(player.joined.kingdom.id)).region_count).toBe(1);
    expect(
      await server.db
        .selectFrom('player_statistics')
        .select(['battles', 'battles_won', 'trivia_answered', 'trivia_correct'])
        .where('user_id', '=', player.userId)
        .executeTakeFirst(),
    ).toEqual({ battles: 1, battles_won: 0, trivia_answered: 1, trivia_correct: 0 });
    // Ein neuer Versuch ist sofort möglich
    expect((await regionDetail(player, target)).attack.allowed).toBe(true);
  });

  it('hält mehrere Eroberungen über ein erneutes Öffnen hinweg', async () => {
    const player = await newPlayer();
    const { instanceId, kingdom } = player.joined;
    for (let i = 0; i < 4; i++) {
      const target = await neutralNeighbour(instanceId, kingdom.id);
      const started = await startAttack(player, target);
      const result = await playChallenge(player, started.challengeId, true);
      expect(result.resolution?.conquered).toBe(true);
    }
    expect(await kingdomRow(kingdom.id)).toMatchObject({ region_count: 5, status: 'ACTIVE' });
    const ranks = await server.db
      .selectFrom('kingdom_history')
      .select('payload')
      .where('kingdom_id', '=', kingdom.id)
      .where('kind', '=', 'RANK_CHANGED')
      .execute();
    expect(ranks.map((r) => r.payload)).toEqual([
      expect.objectContaining({ from: 'SETTLEMENT', to: 'VILLAGE_LEAGUE' }),
    ]);

    // Browser neu geöffnet: dieselbe Sitzung (Cookie), derselbe Stand
    const reopened = new TestClient(server.app);
    for (const [name, value] of player.client.cookies) reopened.cookies.set(name, value);
    const me = meResponseSchema.parse((await reopened.get('/me')).json());
    expect(me.user.id).toBe(player.userId);
    expect(me.instances[0]?.kingdom).toMatchObject({
      id: kingdom.id,
      regionCount: 5,
      rank: 'VILLAGE_LEAGUE',
    });
    const map = mapStateResponseSchema.parse(
      (await reopened.get(`/instances/${instanceId}/map/state?chunks=0:0`)).json(),
    );
    expect(map.chunks[0]?.regions.filter((r) => r.ownerKingdomId === kingdom.id)).toHaveLength(5);
  });

  it('verlegt die Hauptstadt eines NPC-Reichs und lässt es fallen', async () => {
    const player = await newPlayer();
    const { instanceId, kingdom } = player.joined;
    // Aufbau: das kleinste NPC-Reich auf Hauptstadt und einen Nachbarn verkleinern und dem
    // Spieler eine Region neben der Hauptstadt geben.
    const npc = await server.db
      .selectFrom('kingdoms')
      .select(['id', 'npc_faction_id'])
      .where('instance_id', '=', instanceId)
      .where('kind', '=', 'NPC')
      .where('status', '=', 'ACTIVE')
      .orderBy('region_count')
      .orderBy('id')
      .executeTakeFirstOrThrow();
    const regions = await regionsOf(instanceId);
    const npcRegions = regions.filter((r) => r.owner_kingdom_id === npc.id);
    const capital = npcRegions.find((r) => r.is_capital);
    if (!capital) throw new Error('NPC-Hauptstadt fehlt');
    const keep = npcRegions.find((r) => !r.is_capital && areNeighbors(r, capital));
    if (!keep) throw new Error('Kein NPC-Nachbar der Hauptstadt');
    for (const region of npcRegions) {
      if (region.id !== capital.id && region.id !== keep.id) await transferRegion(region.id, null);
    }
    const foothold = (await regionsOf(instanceId)).find(
      (r) => r.owner_kingdom_id === null && areNeighbors(r, capital),
    );
    if (!foothold) throw new Error('Kein freier Nachbar der NPC-Hauptstadt');
    await transferRegion(foothold.id, kingdom.id);
    expect((await kingdomRow(npc.id)).region_count).toBe(2);

    const detail = await regionDetail(player, capital.id);
    expect(detail.attack).toMatchObject({ allowed: true, mode: 'PVE', defenderKind: 'NPC' });
    expect(detail.owner?.id).toBe(npc.id);

    // Hauptstadt erobert → neue Hauptstadt im Rest des Reichs
    const first = await startAttack(player, capital.id);
    expect(first.defender).toMatchObject({ kind: 'NPC', kingdom: { id: npc.id } });
    const won = await playChallenge(player, first.challengeId, true);
    expect(won.resolution).toMatchObject({
      conquered: true,
      defender: { kind: 'NPC', kingdom: { id: npc.id } },
    });
    expect(await capitalOf(npc.id)).toBe(keep.id);
    expect((await kingdomRow(npc.id)).region_count).toBe(1);
    expect(await regionState(capital.id)).toMatchObject({
      owner_kingdom_id: kingdom.id,
      is_capital: false,
    });

    // Letzte Region erobert → Reich fällt, Fraktion ruht
    const second = await startAttack(player, keep.id);
    expect((await playChallenge(player, second.challengeId, true)).resolution?.conquered).toBe(
      true,
    );
    const fallen = await kingdomRow(npc.id);
    expect(fallen).toMatchObject({ region_count: 0, status: 'FALLEN' });
    expect(fallen.fallen_at).not.toBeNull();
    expect(await capitalOf(npc.id)).toBeNull();
    const history = await server.db
      .selectFrom('kingdom_history')
      .select(['kind', 'payload'])
      .where('kingdom_id', '=', npc.id)
      .orderBy('id')
      .execute();
    expect(history.map((h) => h.kind)).toEqual([
      'FOUNDED',
      'CAPITAL_CHANGED',
      'FALLEN',
      'RANK_CHANGED',
    ]);
    expect(history[1]?.payload).toMatchObject({
      from: capital.id,
      to: keep.id,
      cause: 'CAPITAL_LOST',
    });
    expect(history[3]?.payload).toEqual({ from: 'SETTLEMENT', to: null, regionCount: 0 });
    const faction = await server.db
      .selectFrom('npc_factions')
      .select('status')
      .where('id', '=', npc.npc_faction_id as string)
      .executeTakeFirstOrThrow();
    expect(faction.status).toBe('DORMANT');
    expect(
      await server.db
        .selectFrom('kingdom_statistics')
        .select(['defenses_lost'])
        .where('kingdom_id', '=', npc.id)
        .executeTakeFirst(),
    ).toEqual({ defenses_lost: 2 });
  });
});

describe('Angriff: Prüfungen und Idempotenz', () => {
  it('lehnt unzulässige Angriffe mit dem passenden Fehler ab', async () => {
    const player = await newPlayer();
    const { instanceId, kingdom, capitalRegionId } = player.joined;
    const target = tutorialTarget(player);

    expect((await new TestClient(server.app).get('/me')).statusCode).toBe(401);
    const noKey = await player.client.post(`/instances/${instanceId}/attacks`, {
      payload: { targetRegionId: target },
    });
    expect(errorOf(noKey)).toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(
      errorOf(
        await player.client.post(`/instances/${instanceId}/attacks`, {
          headers: { 'idempotency-key': randomUUID() },
          payload: { targetRegionId: target, extra: 1 },
        }),
      ),
    ).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(errorOf(await attack(player.client, randomUUID(), target)).status).toBe(404);
    expect(errorOf(await attack(player.client, instanceId, '999999999')).status).toBe(404);
    expect(errorOf(await attack(player.client, instanceId, capitalRegionId))).toMatchObject({
      status: 409,
      code: 'OWN_REGION',
    });
    const far = await distantRegion(instanceId, kingdom.id);
    expect(errorOf(await attack(player.client, instanceId, far))).toMatchObject({
      status: 409,
      code: 'NOT_ADJACENT',
    });

    const visitor = new TestClient(server.app);
    await visitor.signUpGuest();
    expect(errorOf(await attack(visitor, instanceId, target))).toMatchObject({
      status: 403,
      code: 'NO_ACTIVE_KINGDOM',
    });

    // Regionsschutz mit Ablaufzeit
    await server.db
      .updateTable('region_state')
      .set({
        protected_until: sql<Date>`game_now() + interval '1 hour'`,
        protection_reason: 'ADMIN',
      })
      .where('region_id', '=', target)
      .execute();
    const protectedRegion = errorOf(await attack(player.client, instanceId, target));
    expect(protectedRegion).toMatchObject({ status: 409, code: 'REGION_PROTECTED' });
    expect(typeof protectedRegion.details?.until).toBe('string');
    expect((await regionDetail(player, target)).attack).toMatchObject({
      reason: 'REGION_PROTECTED',
      until: protectedRegion.details?.until,
    });
    await server.db
      .updateTable('region_state')
      .set({ protected_until: null, protection_reason: null })
      .where('region_id', '=', target)
      .execute();
  });

  it('lehnt Angriffe auf Spielerreiche ab: Schutz, dann PvP erst ab Phase 2', async () => {
    const player = await newPlayer(world);
    const other = await newPlayer(world);
    const target = await neutralNeighbour(player.joined.instanceId, player.joined.kingdom.id);
    await transferRegion(target, other.joined.kingdom.id);
    const protectedKingdom = errorOf(await attack(player.client, player.joined.instanceId, target));
    expect(protectedKingdom).toMatchObject({ status: 409, code: 'KINGDOM_PROTECTED' });
    expect((await regionDetail(player, target)).attack).toMatchObject({
      allowed: false,
      reason: 'KINGDOM_PROTECTED',
    });

    await server.db
      .updateTable('kingdoms')
      .set({ protected_until: null, protection_reason: null })
      .where('id', '=', other.joined.kingdom.id)
      .execute();
    expect((await regionDetail(player, target)).attack).toEqual({
      allowed: false,
      mode: 'PVP',
      defenderKind: 'PLAYER',
      reason: 'PVP_NOT_AVAILABLE',
      until: null,
    });
    expect(errorOf(await attack(player.client, player.joined.instanceId, target))).toMatchObject({
      status: 409,
      code: 'PVP_NOT_AVAILABLE',
    });
  });

  it('wiederholt einen Angriff mit demselben Schlüssel ohne zweite Wirkung', async () => {
    const player = await newPlayer();
    const { instanceId, kingdom } = player.joined;
    const target = tutorialTarget(player);
    const key = randomUUID();
    const first = await attack(player.client, instanceId, target, key);
    expect(first.statusCode).toBe(201);
    const replay = await attack(player.client, instanceId, target, key);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    const sieges = await server.db
      .selectFrom('sieges')
      .select('id')
      .where('attacker_kingdom_id', '=', kingdom.id)
      .execute();
    expect(sieges).toHaveLength(1);

    const other = await neutralNeighbour(instanceId, kingdom.id);
    expect(errorOf(await attack(player.client, instanceId, other, key))).toMatchObject({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    // Gleiche Region erneut: belagert; andere Region: Herausforderung läuft noch
    expect(errorOf(await attack(player.client, instanceId, target))).toMatchObject({
      status: 409,
      code: 'REGION_UNDER_SIEGE',
    });
    expect(errorOf(await attack(player.client, instanceId, other))).toMatchObject({
      status: 409,
      code: 'CHALLENGE_IN_PROGRESS',
    });
    // Andere Spieler sehen die Herausforderung nicht
    const stranger = await newPlayer();
    const { challengeId } = attackResponseSchema.parse(first.json());
    expect((await stranger.client.get(`/challenges/${challengeId}`)).statusCode).toBe(404);
    expect((await present(stranger.client, challengeId, 0)).statusCode).toBe(404);

    // aufräumen: verloren spielen, damit die Region frei wird
    await playChallenge(player, challengeId, false);
  });
});

describe('Fragen und Antworten', () => {
  it('stellt nach Reload dieselbe Frage mit derselben Frist und prüft Antworten', async () => {
    const player = await newPlayer();
    const started = await startAttack(player, tutorialTarget(player));
    const { challengeId, siegeId } = started;

    expect(errorOf(await present(player.client, challengeId, 1))).toMatchObject({
      status: 409,
      code: 'STEP_NOT_AVAILABLE',
    });
    expect((await present(player.client, challengeId, 2)).statusCode).toBe(400);
    const first = presentResponseSchema.parse(
      (await present(player.client, challengeId, 0)).json(),
    );
    const again = presentResponseSchema.parse(
      (await present(player.client, challengeId, 0)).json(),
    );
    expect(again.question).toMatchObject({
      presentedAt: first.question.presentedAt,
      prompt: first.question.prompt,
    });
    if (first.question.kind !== 'TRIVIA' || again.question.kind !== 'TRIVIA') {
      throw new Error('Trivia erwartet');
    }
    expect(again.question.options).toEqual(first.question.options);
    expect(again.question.remainingMs).toBeLessThanOrEqual(first.question.remainingMs);
    expect(await battleEventTypes(siegeId)).toContain('STEP_RELOADED');
    const view = challengeViewSchema.parse(
      (await player.client.get(`/challenges/${challengeId}`)).json(),
    );
    expect(view).toMatchObject({ status: 'PREPARING', currentStep: 0, resolution: null });
    expect(view.question).toMatchObject({
      kind: 'TRIVIA',
      presentedAt: first.question.presentedAt,
      options: first.question.options,
    });

    // Ungültige Antworten
    expect(
      errorOf(await answer(player.client, challengeId, 0, { rawInput: '12', locale: 'de' })),
    ).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(
      errorOf(await answer(player.client, challengeId, 0, { optionToken: 'unbekannt' })),
    ).toMatchObject({ status: 422, code: 'INVALID_OPTION_TOKEN' });
    const noKey = await player.client.post(`/challenges/${challengeId}/steps/0/answer`, {
      payload: { optionToken: first.question.options[0]?.token },
    });
    expect(errorOf(noKey)).toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });

    // Antwort mit Wiederholung: gleiche Antwort → gleicher Stand, andere Antwort → Fehler
    const token = await optionToken(challengeId, true);
    const key = randomUUID();
    const saved = await answer(player.client, challengeId, 0, { optionToken: token }, key);
    expect(saved.statusCode).toBe(200);
    const repeated = await answer(player.client, challengeId, 0, { optionToken: token }, key);
    expect(repeated.statusCode).toBe(200);
    expect(answerResponseSchema.parse(repeated.json()).next).toMatchObject({
      kind: 'ESTIMATE',
      presentedAt: answerResponseSchema.parse(saved.json()).next?.presentedAt,
    });
    const otherToken = await optionToken(challengeId, false);
    expect(
      errorOf(await answer(player.client, challengeId, 0, { optionToken: otherToken }, key)),
    ).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
    // Nach dem Reload zählt die Serverzeit, nicht der Client-Timer
    const audit = await server.db
      .selectFrom('quiz_answers as a')
      .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
      .select(['a.audit', 'a.effective_ms', 'a.server_elapsed_ms', 'a.is_correct'])
      .where('a.challenge_id', '=', challengeId)
      .where('a.step_index', '=', 0)
      .where('p.role', '=', 'ATTACKER')
      .executeTakeFirstOrThrow();
    expect(audit.audit).toMatchObject({ reloaded: true, clientTimeUsed: false });
    expect(audit.effective_ms).toBe(audit.server_elapsed_ms);
    expect(audit.is_correct).toBe(true);

    // Schätzung: unlesbar, außerhalb des Bereichs, dann gültig
    expect(
      errorOf(await answer(player.client, challengeId, 1, { rawInput: 'viel', locale: 'de' })),
    ).toMatchObject({ status: 422, code: 'INVALID_NUMBER_INPUT' });
    const range = await server.db
      .selectFrom('quiz_challenge_steps as s')
      .innerJoin('question_versions as v', 'v.id', 's.version_id')
      .select('v.input_max')
      .where('s.challenge_id', '=', challengeId)
      .where('s.step_index', '=', 1)
      .executeTakeFirstOrThrow();
    const tooLarge = `${Number(range.input_max) * 10 + 1}`;
    expect(
      errorOf(await answer(player.client, challengeId, 1, { rawInput: tooLarge, locale: 'de' })),
    ).toMatchObject({ status: 422, code: 'ANSWER_OUT_OF_RANGE' });
    const done = answerResponseSchema.parse(
      (
        await answer(player.client, challengeId, 1, {
          rawInput: await estimateInput(challengeId),
          locale: 'de',
        })
      ).json(),
    );
    expect(done.resolution?.status).toBe('ATTACKER_WON');
    expect(errorOf(await present(player.client, challengeId, 0))).toMatchObject({
      status: 409,
      code: 'CHALLENGE_CLOSED',
    });
  });

  it('wertet eine verpasste erste Frage nach der Frist als falsch', async () => {
    const player = await newPlayer();
    const target = tutorialTarget(player);
    const started = await startAttack(player, target);
    presentResponseSchema.parse((await present(player.client, started.challengeId, 0)).json());
    // Zeitlimit 20 s + Latenzpuffer 0,5 s überschritten
    await advanceGameClock(server.database.pool, 21_000);
    const late = errorOf(
      await answer(player.client, started.challengeId, 0, {
        optionToken: await optionToken(started.challengeId, true),
      }),
    );
    expect(late).toMatchObject({ status: 409, code: 'STEP_EXPIRED' });
    // Innerhalb der Kulanzzeit bleibt der Schritt offen …
    const open = challengeViewSchema.parse(
      (await player.client.get(`/challenges/${started.challengeId}`)).json(),
    );
    expect(open.status).toBe('PREPARING');
    // … danach endet der Kampf beim nächsten Lesen ohne Schätzfrage
    await advanceGameClock(server.database.pool, 5_000);
    const closed = challengeViewSchema.parse(
      (await player.client.get(`/challenges/${started.challengeId}`)).json(),
    );
    expect(closed).toMatchObject({
      status: 'DEFENDER_WON',
      steps: [
        { index: 0, status: 'TIMED_OUT' },
        { index: 1, status: 'PENDING' },
      ],
      resolution: {
        winner: 'DEFENDER',
        reason: 'ATTACKER_GATE',
        conquered: false,
        attacker: { triviaAnswer: null, triviaCorrect: false, estimate: null },
        estimate: null,
      },
    });
    expect(await regionState(target)).toMatchObject({
      owner_kingdom_id: null,
      active_siege_id: null,
    });
  });

  it('beendet nie begonnene Herausforderungen im Aufräumlauf', async () => {
    const player = await newPlayer();
    const target = tutorialTarget(player);
    const started = await startAttack(player, target);
    expect(await expireStaleChallenges(server.db)).toBe(0);
    await advanceGameClock(server.database.pool, 121_000);
    // Auch das Profil löst fällige Kämpfe auf und meldet keine offene Herausforderung mehr
    const other = await newPlayer();
    const pending = await startAttack(other, tutorialTarget(other));
    await advanceGameClock(server.database.pool, 121_000);
    const me = meResponseSchema.parse((await other.client.get('/me')).json());
    expect(me.instances[0]?.openChallengeId).toBeNull();
    expect((await siegeRow(pending.siegeId)).outcome_reason).toBe('NEVER_STARTED');
    expect(await expireStaleChallenges(server.db)).toBeGreaterThanOrEqual(1);
    expect(await siegeRow(started.siegeId)).toMatchObject({
      status: 'ATTACK_FAILED',
      outcome: 'NONE',
      outcome_reason: 'NEVER_STARTED',
      attack_presented_at: null,
    });
    expect(await regionState(target)).toMatchObject({
      owner_kingdom_id: null,
      active_siege_id: null,
    });
    expect(
      await server.db
        .selectFrom('battle_results')
        .select(['winner_role', 'defended'])
        .where('siege_id', '=', started.siegeId)
        .executeTakeFirst(),
    ).toEqual({ winner_role: null, defended: false });
    // Kein Versuch verbraucht, keine Statistik: Angriff sofort wieder möglich
    expect(
      await server.db
        .selectFrom('player_statistics')
        .select('battles')
        .where('user_id', '=', player.userId)
        .executeTakeFirst(),
    ).toEqual({ battles: 0 });
    expect((await regionDetail(player, target)).attack.allowed).toBe(true);
  });
});
