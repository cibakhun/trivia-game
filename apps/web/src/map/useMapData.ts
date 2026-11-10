import type { ChunkCoord } from '@rdw/game-core';
import type { KingdomSummary, MapStaticResponse, RegionStateDto } from '@rdw/protocol';
import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { chunkKey, MAX_CHUNKS_PER_REQUEST } from './layout.ts';

/**
 * Kartendaten je Instanz (WORLD_SYSTEM §3.3): statische Regionen werden je Chunk einmal geladen,
 * der dynamische Zustand beim Laden eines Chunks und danach bei jeder Auffrischung.
 */

export type StaticRegion = MapStaticResponse['chunks'][number]['regions'][number];

export interface MapData {
  readonly statics: ReadonlyMap<string, StaticRegion>;
  readonly states: ReadonlyMap<string, RegionStateDto>;
  readonly kingdoms: ReadonlyMap<string, KingdomSummary>;
}

const EMPTY: MapData = { statics: new Map(), states: new Map(), kingdoms: new Map() };

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export function useMapData(instanceId: string) {
  const [data, setData] = useState<MapData>(EMPTY);
  const [error, setError] = useState<unknown>(null);
  const loaded = useRef(new Map<string, ChunkCoord>());
  const pending = useRef(new Set<string>());

  const merge = useCallback(
    (
      statics: readonly StaticRegion[],
      states: readonly RegionStateDto[],
      kingdoms: readonly KingdomSummary[],
    ) => {
      setData((previous) => {
        const nextStatics = new Map(previous.statics);
        for (const region of statics) nextStatics.set(region.id, region);
        const nextStates = new Map(previous.states);
        for (const state of states) nextStates.set(state.id, state);
        const nextKingdoms = new Map(previous.kingdoms);
        for (const kingdom of kingdoms) nextKingdoms.set(kingdom.id, kingdom);
        return { statics: nextStatics, states: nextStates, kingdoms: nextKingdoms };
      });
    },
    [],
  );

  /** Lädt fehlende Chunks (statisch und Zustand). */
  const ensureChunks = useCallback(
    async (chunks: readonly ChunkCoord[]) => {
      const missing = chunks.filter((chunk) => {
        const key = chunkKey(chunk);
        return !loaded.current.has(key) && !pending.current.has(key);
      });
      if (missing.length === 0) return;
      for (const chunk of missing) pending.current.add(chunkKey(chunk));
      try {
        for (const batch of batches(missing, MAX_CHUNKS_PER_REQUEST)) {
          const [statics, state] = await Promise.all([
            api.mapStatic(instanceId, batch),
            api.mapState(instanceId, batch),
          ]);
          merge(
            statics.chunks.flatMap((c) => c.regions),
            state.chunks.flatMap((c) => c.regions),
            state.kingdoms,
          );
          for (const chunk of batch) loaded.current.set(chunkKey(chunk), chunk);
        }
        setError(null);
      } catch (e) {
        setError(e);
      } finally {
        for (const chunk of missing) pending.current.delete(chunkKey(chunk));
      }
    },
    [instanceId, merge],
  );

  /** Liest den Zustand aller geladenen Chunks neu (nach einem Kampf, periodisch). */
  const refresh = useCallback(async () => {
    try {
      for (const batch of batches([...loaded.current.values()], MAX_CHUNKS_PER_REQUEST)) {
        const state = await api.mapState(instanceId, batch);
        merge(
          [],
          state.chunks.flatMap((c) => c.regions),
          state.kingdoms,
        );
      }
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [instanceId, merge]);

  return { data, error, ensureChunks, refresh };
}
