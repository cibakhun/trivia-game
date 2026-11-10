import type { ChunkCoord } from '@rdw/game-core';
import type { MapStateResponse, MapStaticResponse } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import { chunkKey } from '../src/map/layout.ts';
import { EMPTY_CHUNK_TTL_MS, MapLoader, type MapSource } from '../src/map/map-loader.ts';

const INSTANCE = '00000000-0000-4000-8000-000000000001';
const T0 = 1_800_000_000_000;
const LAND: ChunkCoord = { chunkX: 0, chunkY: 0 };
const SEA: ChunkCoord = { chunkX: 5, chunkY: 5 };

/** Testquelle: Chunk (0,0) hat eine Region, alle anderen sind leer; Abrufe werden mitgezählt. */
function fakeSource() {
  const calls = { static: [] as string[][], state: [] as string[][] };
  let failing: Error | null = null;
  const source: MapSource = {
    mapStatic: (chunks) => {
      calls.static.push(chunks.map(chunkKey));
      if (failing) return Promise.reject(failing);
      return Promise.resolve<MapStaticResponse>({
        instanceId: INSTANCE,
        mapgenVersion: 1,
        chunks: chunks.map((c) => ({
          ...c,
          regions:
            chunkKey(c) === chunkKey(LAND) ? [{ id: '1', q: 0, r: 0, biome: 0, tier: 1 }] : [],
        })),
      });
    },
    mapState: (chunks) => {
      calls.state.push(chunks.map(chunkKey));
      if (failing) return Promise.reject(failing);
      return Promise.resolve<MapStateResponse>({
        instanceId: INSTANCE,
        seq: '1',
        chunks: chunks.map((c) => ({
          ...c,
          regions:
            chunkKey(c) === chunkKey(LAND)
              ? [
                  {
                    id: '1',
                    ownerKingdomId: null,
                    isCapital: false,
                    protectedUntil: null,
                    underSiege: false,
                  },
                ]
              : [],
        })),
        kingdoms: [],
        serverTime: new Date(T0).toISOString(),
      });
    },
  };
  return {
    source,
    calls,
    fail: (error: Error | null) => {
      failing = error;
    },
  };
}

function setup() {
  const fake = fakeSource();
  let now = T0;
  let changes = 0;
  const loader = new MapLoader(fake.source, () => now);
  loader.subscribe(() => changes++);
  return {
    ...fake,
    loader,
    changes: () => changes,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('Kartendaten laden (WORLD_SYSTEM §3.3)', () => {
  it('lädt Chunks mit Regionen einmal und frischt nur diese auf', async () => {
    const { loader, calls } = setup();
    await loader.ensureChunks([LAND, SEA]);
    expect(loader.data.statics.get('1')).toMatchObject({ q: 0, r: 0 });
    expect(loader.data.states.get('1')).toMatchObject({ ownerKingdomId: null });
    expect(loader.error).toBeNull();

    await loader.ensureChunks([LAND]);
    expect(calls.static).toEqual([['0:0', '5:5']]);

    await loader.refresh();
    expect(calls.state).toEqual([['0:0', '5:5'], ['0:0']]);
  });

  it('fragt leere Chunks erst nach Ablauf der Merkzeit erneut', async () => {
    const { loader, calls, advance } = setup();
    await loader.ensureChunks([SEA]);
    advance(EMPTY_CHUNK_TTL_MS - 1);
    await loader.ensureChunks([SEA]);
    expect(calls.static).toHaveLength(1);

    advance(1);
    await loader.ensureChunks([SEA]);
    expect(calls.static).toEqual([['5:5'], ['5:5']]);
  });

  it('fragt einen Chunk nicht doppelt an und wartet auf den laufenden Abruf', async () => {
    const fake = fakeSource();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loader = new MapLoader({
      mapStatic: async (chunks) => {
        await gate;
        return fake.source.mapStatic(chunks);
      },
      mapState: (chunks) => fake.source.mapState(chunks),
    });
    const first = loader.ensureChunks([LAND]);
    let secondDone = false;
    const second = loader.ensureChunks([LAND]).then(() => {
      secondDone = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondDone).toBe(false);

    release();
    await second;
    // Der zweite Aufruf endet erst mit den Daten des ersten Abrufs
    expect(loader.data.statics.has('1')).toBe(true);
    await first;
    expect(fake.calls.static).toEqual([['0:0']]);
  });

  it('meldet Änderungen an Abonnenten und liefert stabile Stände', async () => {
    const { loader } = setup();
    const before = loader.getSnapshot();
    expect(loader.getSnapshot()).toBe(before);
    let calls = 0;
    const unsubscribe = loader.subscribe(() => calls++);
    await loader.ensureChunks([LAND]);
    expect(calls).toBeGreaterThan(0);
    expect(loader.getSnapshot()).not.toBe(before);
    unsubscribe();
    const seen = calls;
    await loader.refresh();
    expect(calls).toBe(seen);
  });

  it('lässt eine gelungene Auffrischung einen gescheiterten Chunk-Abruf nicht verdecken', async () => {
    const { loader, fail, changes } = setup();
    await loader.ensureChunks([LAND]);
    const before = changes();

    const lost = new Error('offline');
    fail(lost);
    await loader.ensureChunks([{ chunkX: 1, chunkY: 0 }]);
    expect(loader.error).toBe(lost);
    expect(changes()).toBeGreaterThan(before);

    // Auffrischung gelingt wieder, der fehlende Chunk fehlt aber weiterhin
    fail(null);
    await loader.refresh();
    expect(loader.error).toBe(lost);

    // Erst ein gelungener Chunk-Abruf nimmt den Fehler weg; der Chunk wird erneut gefragt
    await loader.ensureChunks([{ chunkX: 1, chunkY: 0 }]);
    expect(loader.error).toBeNull();
  });

  it('meldet eine gescheiterte Auffrischung, bis eine Auffrischung wieder gelingt', async () => {
    const { loader, fail } = setup();
    await loader.ensureChunks([LAND]);
    const data = loader.data;

    const lost = new Error('offline');
    fail(lost);
    await loader.refresh();
    expect(loader.error).toBe(lost);
    expect(loader.data).toBe(data);

    fail(null);
    await loader.refresh();
    expect(loader.error).toBeNull();
    expect(loader.data).not.toBe(data);
  });
});
