import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import {
  AXIAL_DIRECTIONS,
  MAPGEN_VERSION,
  axialKey,
  chooseStartRegion,
  createRng,
  deriveSeed,
  hexDistance,
  spawnCandidates,
  type Axial,
} from '@rdw/game-core';
import {
  DEFAULT_RULES,
  errorBodySchema,
  joinResponseSchema,
  meResponseSchema,
  worldsResponseSchema,
  type JoinResponse,
} from '@rdw/protocol';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/infra/crypto.ts';
import { loadSpawnSnapshot } from '../src/modules/world/spawn-snapshot.ts';
import type { CreatedWorld } from '../src/index.ts';
import {
  TEST_RNG_SECRET,
  TestClient,
  createTestWorld,
  startTestServer,
  type TestServer,
} from './helpers.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
  return () => server.close();
});

function errorCode(response: { json(): unknown }): string {
  return errorBodySchema.parse(response.json()).error.code;
}

async function regionCoords(regionId: string): Promise<Axial & { tier: number }> {
  return server.db
    .selectFrom('regions')
    .select(['q', 'r', 'tier'])
    .where('id', '=', regionId)
    .executeTakeFirstOrThrow();
}

describe('Testwelt anlegen', () => {
  let world: CreatedWorld;

  beforeAll(async () => {
    world = await createTestWorld(server.db, { capacity: 20 });
  });

  it('erzeugt Regeln, Instanz, 150 Regionen und sechs NPC-Reiche', async () => {
    expect(world.regions).toBe(150);
    const rules = await server.db
      .selectFrom('world_rules')
      .selectAll()
      .where('id', '=', world.rulesId)
      .executeTakeFirstOrThrow();
    expect(rules.config).toEqual(DEFAULT_RULES.ETERNAL);
    expect(rules.config_hash).toBe(
      createHash('sha256').update(canonicalJson(DEFAULT_RULES.ETERNAL)).digest('hex'),
    );
    const current = await server.db
      .selectFrom('worlds')
      .select(['current_rules_id', 'mode', 'status'])
      .where('id', '=', world.worldId)
      .executeTakeFirstOrThrow();
    expect(current).toEqual({ current_rules_id: world.rulesId, mode: 'ETERNAL', status: 'ACTIVE' });
    const instance = await server.db
      .selectFrom('world_instances')
      .selectAll()
      .where('id', '=', world.instanceId)
      .executeTakeFirstOrThrow();
    expect(instance).toMatchObject({
      status: 'RUNNING',
      map_seed: '2175',
      mapgen_version: MAPGEN_VERSION,
      capacity: 20,
      event_seq: '0',
      season_id: null,
    });

    const states = await server.db
      .selectFrom('region_state')
      .select(['owner_kingdom_id', 'is_capital'])
      .where('instance_id', '=', world.instanceId)
      .execute();
    expect(states).toHaveLength(150);
    const kingdoms = await server.db
      .selectFrom('kingdoms as k')
      .innerJoin('npc_factions as f', 'f.id', 'k.npc_faction_id')
      .innerJoin('npc_profiles as p', 'p.id', 'f.profile_id')
      .select(['k.id', 'k.kind', 'k.region_count', 'k.name_parts', 'f.archetype', 'p.code'])
      .where('k.instance_id', '=', world.instanceId)
      .execute();
    expect(kingdoms.map((k) => k.archetype).sort()).toEqual(
      ['HEAVY', 'LIGHT', 'LIGHT', 'LIGHT', 'MEDIUM', 'MEDIUM'].sort(),
    );
    for (const kingdom of kingdoms) {
      expect(kingdom.kind).toBe('NPC');
      expect(kingdom.code).toBe(kingdom.archetype);
      const owned = states.filter((s) => s.owner_kingdom_id === kingdom.id);
      expect(owned).toHaveLength(kingdom.region_count);
      expect(owned.filter((s) => s.is_capital)).toHaveLength(1);
    }
    expect(world.factions.map((f) => f.regions)).toEqual([10, 8, 8, 5, 5, 5]);
    const names = new Set(kingdoms.map((k) => JSON.stringify(k.name_parts)));
    expect(names.size).toBe(6);
    const history = await server.db
      .selectFrom('kingdom_history')
      .select('kind')
      .where(
        'kingdom_id',
        'in',
        kingdoms.map((k) => k.id),
      )
      .execute();
    expect(history.map((h) => h.kind)).toEqual(Array(6).fill('FOUNDED'));
    const stats = await server.db
      .selectFrom('kingdom_statistics')
      .select('max_regions')
      .where(
        'kingdom_id',
        'in',
        kingdoms.map((k) => k.id),
      )
      .execute();
    expect(stats.map((s) => s.max_regions).sort((a, b) => a - b)).toEqual([5, 5, 5, 8, 8, 10]);
  });

  it('ist aus dem Seed reproduzierbar (Karte und NPC-Namen)', async () => {
    const again = await createTestWorld(server.db);
    const layout = (instanceId: string) =>
      server.db
        .selectFrom('regions as r')
        .innerJoin('region_state as s', 's.region_id', 'r.id')
        .leftJoin('kingdoms as k', 'k.id', 's.owner_kingdom_id')
        .select(['r.q', 'r.r', 'r.biome', 'r.tier', 's.is_capital', 'k.name_parts', 'k.color'])
        .where('r.instance_id', '=', instanceId)
        .orderBy('r.r')
        .orderBy('r.q')
        .execute();
    expect(await layout(again.instanceId)).toEqual(await layout(world.instanceId));
  });

  it('legt bei einem Fehler nichts an', async () => {
    const before = await server.db
      .selectFrom('worlds')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    const slug = await server.db
      .selectFrom('worlds')
      .select('slug')
      .where('id', '=', world.worldId)
      .executeTakeFirstOrThrow();
    const { createWorld } = await import('../src/index.ts');
    const { testWorldPreset } = await import('@rdw/game-core');
    await expect(
      createWorld(server.db, {
        slug: slug.slug,
        nameKey: 'world.test',
        mode: 'ETERNAL',
        seed: 1n,
        preset: testWorldPreset(),
        capacity: 5,
      }),
    ).rejects.toThrow(/worlds_slug_key/);
    const after = await server.db
      .selectFrom('worlds')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
    await expect(
      createWorld(server.db, {
        slug: 'daily',
        nameKey: 'world.daily',
        mode: 'DAILY',
        seed: 1n,
        preset: testWorldPreset(),
        capacity: 5,
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('Beitritt (POST /worlds/:worldId/join)', () => {
  let world: CreatedWorld;
  let client: TestClient;
  let userId: string;
  let joined: JoinResponse;

  beforeAll(async () => {
    world = await createTestWorld(server.db, { capacity: 20 });
    client = new TestClient(server.app);
    userId = await client.signUpGuest();
  });

  it('listet die Welt und gründet ein Reich in einer Startregion', async () => {
    const before = worldsResponseSchema.parse((await client.get('/worlds')).json());
    const listed = before.worlds.find((w) => w.id === world.worldId);
    expect(listed?.instances).toEqual([
      expect.objectContaining({
        id: world.instanceId,
        participants: 0,
        joined: false,
        capacity: 20,
        endsAt: null,
        remainingMs: null,
      }),
    ]);

    const snapshot = await loadSpawnSnapshot(server.db, world.instanceId);
    const response = await client.join(world.worldId);
    expect(response.statusCode).toBe(201);
    joined = joinResponseSchema.parse(response.json());
    expect(joined.instanceId).toBe(world.instanceId);
    expect(joined.kingdom).toMatchObject({
      kind: 'PLAYER',
      status: 'ACTIVE',
      regionCount: 1,
      rank: 'SETTLEMENT',
      archetype: null,
      protectionReason: 'NEWBIE',
      capitalRegionId: joined.capitalRegionId,
    });
    expect(joined.kingdom.name).toBe(
      joined.kingdom.nameParts.prefix + joined.kingdom.nameParts.suffix,
    );
    const protectedMs =
      Date.parse(joined.kingdom.protectedUntil as string) - Date.parse(joined.serverTime);
    expect(Math.abs(protectedMs - 72 * 3600_000)).toBeLessThan(5_000);

    // Wahl nachrechenbar: gleicher Schnappschuss, gleicher Zufallsstrom → gleiche Region
    const rng = createRng(
      await deriveSeed(TEST_RNG_SECRET, 'spawn', `${world.instanceId}.${userId}.1`),
    );
    const expected = chooseStartRegion(spawnCandidates(snapshot.regions, snapshot.kingdoms), rng);
    expect(joined.capitalRegionId).toBe(expected?.id);

    const capital = await regionCoords(joined.capitalRegionId);
    expect(capital.tier).toBeLessThanOrEqual(2);
    const state = await server.db
      .selectFrom('region_state')
      .select(['owner_kingdom_id', 'is_capital', 'owned_since', 'version'])
      .where('region_id', '=', joined.capitalRegionId)
      .executeTakeFirstOrThrow();
    expect(state).toMatchObject({
      owner_kingdom_id: joined.kingdom.id,
      is_capital: true,
      version: '1',
    });
    expect(state.owned_since).not.toBeNull();

    const participant = await server.db
      .selectFrom('world_participants')
      .selectAll()
      .where('instance_id', '=', world.instanceId)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(participant).toMatchObject({ status: 'ACTIVE', current_kingdom_id: joined.kingdom.id });

    const history = await server.db
      .selectFrom('region_history')
      .selectAll()
      .where('region_id', '=', joined.capitalRegionId)
      .execute();
    expect(history).toEqual([
      expect.objectContaining({
        cause: 'START_CLAIM',
        from_kingdom_id: null,
        to_kingdom_id: joined.kingdom.id,
      }),
    ]);
    const founded = await server.db
      .selectFrom('kingdom_history')
      .select(['kind', 'payload'])
      .where('kingdom_id', '=', joined.kingdom.id)
      .executeTakeFirstOrThrow();
    expect(founded).toMatchObject({
      kind: 'FOUNDED',
      payload: {
        source: 'JOIN',
        generation: 1,
        capitalRegionId: joined.capitalRegionId,
        spawn: { rngPurpose: 'spawn', rngKeyId: 'test', rngVersion: 1 },
      },
    });
    const stats = await server.db
      .selectFrom('kingdom_statistics')
      .select('max_regions')
      .where('kingdom_id', '=', joined.kingdom.id)
      .executeTakeFirstOrThrow();
    expect(stats.max_regions).toBe(1);

    const events = await server.db
      .selectFrom('world_events')
      .select(['seq', 'type', 'chunk_x', 'chunk_y', 'user_id', 'payload'])
      .where('instance_id', '=', world.instanceId)
      .orderBy('seq')
      .execute();
    expect(events.map((e) => [e.seq, e.type])).toEqual([
      ['1', 'region.changed'],
      ['2', 'kingdom.changed'],
    ]);
    expect(events[0]?.payload).toEqual({
      regionId: joined.capitalRegionId,
      ownerKingdomId: joined.kingdom.id,
      isCapital: true,
      protectedUntil: null,
      underSiege: false,
    });
    expect(events.every((e) => e.user_id === null)).toBe(true);
  });

  it('nennt als Tutorial-Ziel den schwächsten freien Nachbarn, auch in /me', async () => {
    const capital = await regionCoords(joined.capitalRegionId);
    const target = await regionCoords(joined.tutorialTargetRegionId as string);
    expect(hexDistance(capital, target)).toBe(1);
    const neighbours = await server.db
      .selectFrom('regions as r')
      .innerJoin('region_state as s', 's.region_id', 'r.id')
      .select(['r.q', 'r.r', 'r.tier', 's.owner_kingdom_id'])
      .where('r.instance_id', '=', world.instanceId)
      .execute();
    const around = new Set(
      AXIAL_DIRECTIONS.map((d) => axialKey({ q: capital.q + d.q, r: capital.r + d.r })),
    );
    const free = neighbours.filter((n) => around.has(axialKey(n)) && n.owner_kingdom_id === null);
    expect(target.tier).toBe(Math.min(...free.map((n) => n.tier)));

    const me = meResponseSchema.parse((await client.get('/me')).json());
    expect(me.instances).toEqual([
      {
        instanceId: world.instanceId,
        worldId: world.worldId,
        worldSlug: expect.any(String) as string,
        mode: 'ETERNAL',
        status: 'RUNNING',
        kingdom: joined.kingdom,
        tutorialTargetRegionId: joined.tutorialTargetRegionId,
        openChallengeId: null,
      },
    ]);
    const after = worldsResponseSchema.parse((await client.get('/worlds')).json());
    expect(after.worlds.find((w) => w.id === world.worldId)?.instances[0]).toMatchObject({
      participants: 1,
      joined: true,
    });
  });

  it('wiederholt mit demselben Schlüssel ohne zweite Wirkung', async () => {
    const key = randomUUID();
    const other = new TestClient(server.app);
    await other.signUpGuest();
    const first = await other.join(world.worldId, key);
    expect(first.statusCode).toBe(201);
    const replay = await other.join(world.worldId, key);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    const fresh = await other.join(world.worldId);
    expect(fresh.statusCode).toBe(409);
    expect(errorCode(fresh)).toBe('ALREADY_JOINED');

    const secondWorld = await createTestWorld(server.db);
    const reused = await other.join(secondWorld.worldId, key);
    expect(reused.statusCode).toBe(422);
    expect(errorCode(reused)).toBe('IDEMPOTENCY_KEY_REUSED');

    const count = await server.db
      .selectFrom('kingdoms')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('instance_id', '=', world.instanceId)
      .where('kind', '=', 'PLAYER')
      .executeTakeFirstOrThrow();
    expect(count.n).toBe('2');
  });

  it('prüft Schlüssel, Welt-ID und Sitzung', async () => {
    const noKey = await client.post(`/worlds/${world.worldId}/join`);
    expect(noKey.statusCode).toBe(400);
    expect(errorCode(noKey)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const badKey = await client.post(`/worlds/${world.worldId}/join`, {
      headers: { 'idempotency-key': 'nicht-uuid' },
    });
    expect(errorCode(badKey)).toBe('VALIDATION_FAILED');
    expect(errorCode(await client.join('kaputt'))).toBe('VALIDATION_FAILED');
    const unknown = await client.join(randomUUID());
    expect(unknown.statusCode).toBe(404);
    expect(errorCode(unknown)).toBe('NOT_FOUND');
    const anonymous = new TestClient(server.app);
    expect((await anonymous.join(world.worldId)).statusCode).toBe(401);
  });

  it('verteilt gleichzeitige Beitritte auf verschiedene, ausreichend entfernte Startregionen', async () => {
    const crowded = await createTestWorld(server.db, { capacity: 20 });
    const clients = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const c = new TestClient(server.app);
        await c.signUpGuest();
        return c;
      }),
    );
    const responses = await Promise.all(clients.map((c) => c.join(crowded.worldId)));
    expect(responses.map((r) => r.statusCode)).toEqual(Array(6).fill(201));
    const capitals = await Promise.all(
      responses.map((r) => regionCoords(joinResponseSchema.parse(r.json()).capitalRegionId)),
    );
    for (const [i, a] of capitals.entries()) {
      expect(a.tier).toBeLessThanOrEqual(2);
      for (const b of capitals.slice(i + 1)) expect(hexDistance(a, b)).toBeGreaterThanOrEqual(3);
    }
    const seqs = await server.db
      .selectFrom('world_events')
      .select('seq')
      .where('instance_id', '=', crowded.instanceId)
      .orderBy('seq')
      .execute();
    expect(seqs.map((s) => Number(s.seq))).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('meldet volle Instanzen und fehlende Startregionen ohne Wirkung', async () => {
    const small = await createTestWorld(server.db, { capacity: 1 });
    const first = new TestClient(server.app);
    await first.signUpGuest();
    expect((await first.join(small.worldId)).statusCode).toBe(201);
    const second = new TestClient(server.app);
    await second.signUpGuest();
    const full = await second.join(small.worldId);
    expect(full.statusCode).toBe(409);
    expect(errorCode(full)).toBe('INSTANCE_FULL');

    const taken = await createTestWorld(server.db);
    const npc = await server.db
      .selectFrom('kingdoms')
      .select('id')
      .where('instance_id', '=', taken.instanceId)
      .executeTakeFirstOrThrow();
    await server.db
      .updateTable('region_state')
      .set({ owner_kingdom_id: npc.id, owned_since: sql<Date>`game_now()` })
      .where('instance_id', '=', taken.instanceId)
      .where('owner_kingdom_id', 'is', null)
      .execute();
    const none = await second.join(taken.worldId);
    expect(none.statusCode).toBe(409);
    expect(errorCode(none)).toBe('NO_START_REGION');
    const rows = await server.db
      .selectFrom('world_participants')
      .select('user_id')
      .where('instance_id', 'in', [small.instanceId, taken.instanceId])
      .execute();
    expect(rows).toHaveLength(1);
    const events = await server.db
      .selectFrom('world_events')
      .select('seq')
      .where('instance_id', '=', taken.instanceId)
      .execute();
    expect(events).toEqual([]);
  });
});
