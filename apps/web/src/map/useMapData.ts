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

/** Leere Chunks (Rand, Meer) werden nicht dauerhaft gemerkt, sondern nach dieser Zeit neu gefragt. */
const EMPTY_CHUNK_TTL_MS = 5 * 60_000;

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export function useMapData(instanceId: string) {
  const [data, setData] = useState<MapData>(EMPTY);
  // Getrennte Fehler: Eine gelungene Auffrischung darf einen fehlgeschlagenen Chunk-Abruf nicht
  // verdecken, dessen Regionen weiterhin fehlen.
  const [loadError, setLoadError] = useState<unknown>(null);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  /** Chunks mit Regionen; nur sie werden aufgefrischt. */
  const loaded = useRef(new Map<string, ChunkCoord>());
  /** Leere Chunks mit Ablaufzeitpunkt (ms seit Epoche). */
  const emptyUntil = useRef(new Map<string, number>());
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
      const now = Date.now();
      const missing = chunks.filter((chunk) => {
        const key = chunkKey(chunk);
        return (
          !loaded.current.has(key) &&
          !pending.current.has(key) &&
          (emptyUntil.current.get(key) ?? 0) <= now
        );
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
          const withRegions = new Set(
            statics.chunks.filter((c) => c.regions.length > 0).map((c) => chunkKey(c)),
          );
          for (const chunk of batch) {
            const key = chunkKey(chunk);
            if (withRegions.has(key)) {
              loaded.current.set(key, chunk);
              emptyUntil.current.delete(key);
            } else {
              emptyUntil.current.set(key, Date.now() + EMPTY_CHUNK_TTL_MS);
            }
          }
        }
        setLoadError(null);
      } catch (e) {
        setLoadError(e);
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
      setRefreshError(null);
    } catch (e) {
      setRefreshError(e);
    }
  }, [instanceId, merge]);

  return { data, error: loadError ?? refreshError, ensureChunks, refresh };
}
