import { randomUUID } from 'node:crypto';
import { advanceGameClock } from '@rdw/db/testing';
import {
  errorBodySchema,
  joinResponseSchema,
  kingdomResponseSchema,
  mapStateResponseSchema,
  mapStaticResponseSchema,
  regionDetailResponseSchema,
  type JoinResponse,
} from '@rdw/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CreatedWorld } from '../src/index.ts';
import { TestClient, createTestWorld, startTestServer, type TestServer } from './helpers.ts';

let server: TestServer;
let world: CreatedWorld;
let client: TestClient;

beforeAll(async () => {
  server = await startTestServer();
  world = await createTestWorld(server.db);
  client = new TestClient(server.app);
  await client.signUpGuest();
  return () => server.close();
});

function errorCode(response: { json(): unknown }): string {
  return errorBodySchema.parse(response.json()).error.code;
}

describe('Statische Kartendaten', () => {
  it('liefert alle Regionen der Testwelt in Chunk 0:0, per ETag cachebar', async () => {
    const path = `/instances/${world.instanceId}/map/static?chunks=0:0`;
    const response = await client.get(path);
    expect(response.statusCode).toBe(200);
    const body = mapStaticResponseSchema.parse(response.json());
    expect(body.mapgenVersion).toBe(1);
    expect(body.chunks).toHaveLength(1);
    expect(body.chunks[0]?.regions).toHaveLength(150);
    expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    const etag = response.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const cached = await client.get(path, { headers: { 'if-none-match': etag } });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');
  });

  it('liefert leere Chunks mit, ohne sie dauerhaft cachebar zu machen', async () => {
    const response = await client.get(
      `/instances/${world.instanceId}/map/static?chunks=1:0,0:0,0:0`,
    );
    const body = mapStaticResponseSchema.parse(response.json());
    expect(body.chunks.map((c) => [c.chunkX, c.chunkY, c.regions.length])).toEqual([
      [0, 0, 150],
      [1, 0, 0],
    ]);
    expect(response.headers['cache-control']).toBe('private, no-cache');
  });

  it('prüft Chunks, Instanz und Sitzung', async () => {
    const base = `/instances/${world.instanceId}/map/static`;
    expect(errorCode(await client.get(base))).toBe('VALIDATION_FAILED');
    expect(errorCode(await client.get(`${base}?chunks=a:b`))).toBe('VALIDATION_FAILED');
    const many = Array.from({ length: 65 }, (_, i) => `${i}:0`).join(',');
    expect(errorCode(await client.get(`${base}?chunks=${many}`))).toBe('VALIDATION_FAILED');
    const unknown = await client.get(`/instances/${randomUUID()}/map/static?chunks=0:0`);
    expect(unknown.statusCode).toBe(404);
    expect((await new TestClient(server.app).get(`${base}?chunks=0:0`)).statusCode).toBe(401);
  });
});

describe('Zustand, Regionen und Reiche', () => {
  let joinedOnce: JoinResponse | undefined;
  /** Beitritt einmal je Datei; jeder Test holt ihn selbst, damit ein Fehler im ersten nicht folgt. */
  async function joinOnce(): Promise<JoinResponse> {
    joinedOnce ??= joinResponseSchema.parse((await client.join(world.worldId)).json());
    return joinedOnce;
  }

  it('liefert Besitz, NPC-Reiche und den Ereignisstand', async () => {
    const path = `/instances/${world.instanceId}/map/state?chunks=0:0`;
    const before = mapStateResponseSchema.parse((await client.get(path)).json());
    expect(before.seq).toBe('0');
    const regions = before.chunks[0]?.regions ?? [];
    expect(regions).toHaveLength(150);
    expect(regions.filter((r) => r.ownerKingdomId !== null)).toHaveLength(41);
    expect(regions.filter((r) => r.isCapital)).toHaveLength(6);
    expect(before.kingdoms.map((k) => k.archetype).sort()).toEqual(
      ['HEAVY', 'LIGHT', 'LIGHT', 'LIGHT', 'MEDIUM', 'MEDIUM'].sort(),
    );
    const heavy = before.kingdoms.find((k) => k.archetype === 'HEAVY');
    expect(heavy).toMatchObject({ kind: 'NPC', regionCount: 10, rank: 'VILLAGE_LEAGUE' });
    expect(regions.find((r) => r.id === heavy?.capitalRegionId)?.isCapital).toBe(true);

    const joined = await joinOnce();
    const after = mapStateResponseSchema.parse((await client.get(path)).json());
    expect(after.seq).toBe('2');
    expect(after.chunks[0]?.regions.find((r) => r.id === joined.capitalRegionId)).toEqual({
      id: joined.capitalRegionId,
      ownerKingdomId: joined.kingdom.id,
      isCapital: true,
      protectedUntil: null,
      underSiege: false,
    });
    expect(after.kingdoms.find((k) => k.id === joined.kingdom.id)).toEqual(joined.kingdom);
  });

  it('liefert Regionsdetails mit Besitzer', async () => {
    const joined = await joinOnce();
    const capital = regionDetailResponseSchema.parse(
      (await client.get(`/instances/${world.instanceId}/regions/${joined.capitalRegionId}`)).json(),
    );
    expect(capital.region).toMatchObject({
      id: joined.capitalRegionId,
      ownerKingdomId: joined.kingdom.id,
      isCapital: true,
      chunkX: 0,
      chunkY: 0,
      underSiege: false,
      protectedUntil: null,
    });
    expect(capital.region.ownedSince).not.toBeNull();
    expect(capital.owner).toEqual(joined.kingdom);

    const target = regionDetailResponseSchema.parse(
      (
        await client.get(
          `/instances/${world.instanceId}/regions/${joined.tutorialTargetRegionId as string}`,
        )
      ).json(),
    );
    expect(target.owner).toBeNull();
    expect(target.region.ownedSince).toBeNull();

    const elsewhere = await createTestWorld(server.db);
    const wrongInstance = await client.get(
      `/instances/${elsewhere.instanceId}/regions/${joined.capitalRegionId}`,
    );
    expect(wrongInstance.statusCode).toBe(404);
    expect(errorCode(await client.get(`/instances/${world.instanceId}/regions/0`))).toBe(
      'VALIDATION_FAILED',
    );
    const huge = await client.get(`/instances/${world.instanceId}/regions/9223372036854775808`);
    expect(errorCode(huge)).toBe('VALIDATION_FAILED');
  });

  it('liefert Reichsprofile; der Anfängerschutz endet nach 72 Stunden', async () => {
    const joined = await joinOnce();
    const path = `/instances/${world.instanceId}/kingdoms/${joined.kingdom.id}`;
    const profile = kingdomResponseSchema.parse((await client.get(path)).json()).kingdom;
    expect(profile).toMatchObject({ ...joined.kingdom, generation: 1 });
    expect(profile.foundedAt).toBeTruthy();

    await advanceGameClock(server.database.pool, 72 * 3600_000 + 1000);
    const later = kingdomResponseSchema.parse((await client.get(path)).json()).kingdom;
    expect(later.protectedUntil).toBeNull();
    expect(later.protectionReason).toBeNull();
    await advanceGameClock(server.database.pool, -(72 * 3600_000 + 1000));

    expect(
      (await client.get(`/instances/${world.instanceId}/kingdoms/${randomUUID()}`)).statusCode,
    ).toBe(404);
    expect(errorCode(await client.get(`/instances/${world.instanceId}/kingdoms/x`))).toBe(
      'VALIDATION_FAILED',
    );
  });
});
