import type { ChunkCoord } from '@rdw/game-core';
import type {
  KingdomSummary,
  MapStateResponse,
  MapStaticResponse,
  RegionStateDto,
} from '@rdw/protocol';
import { chunkKey, MAX_CHUNKS_PER_REQUEST } from './layout.ts';

/**
 * Kartendaten je Instanz (WORLD_SYSTEM §3.3): statische Regionen werden je Chunk einmal geladen,
 * der dynamische Zustand beim Laden eines Chunks und danach bei jeder Auffrischung. Ohne React,
 * damit die Buchführung (geladene, leere und laufende Chunks, getrennte Fehler) testbar bleibt;
 * `useMapData` verbindet sie mit der Oberfläche.
 */

export type StaticRegion = MapStaticResponse['chunks'][number]['regions'][number];

export interface MapData {
  readonly statics: ReadonlyMap<string, StaticRegion>;
  readonly states: ReadonlyMap<string, RegionStateDto>;
  readonly kingdoms: ReadonlyMap<string, KingdomSummary>;
}

/** Die beiden Abrufe der Karte für eine Instanz (`api.mapStatic`/`api.mapState`). */
export interface MapSource {
  readonly mapStatic: (chunks: readonly ChunkCoord[]) => Promise<MapStaticResponse>;
  readonly mapState: (chunks: readonly ChunkCoord[]) => Promise<MapStateResponse>;
}

/** Leere Chunks (Rand, Meer) werden nicht dauerhaft gemerkt, sondern nach dieser Zeit neu gefragt. */
export const EMPTY_CHUNK_TTL_MS = 5 * 60_000;

const EMPTY: MapData = { statics: new Map(), states: new Map(), kingdoms: new Map() };

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export class MapLoader {
  #data: MapData = EMPTY;
  // Getrennte Fehler: Eine gelungene Auffrischung darf einen fehlgeschlagenen Chunk-Abruf nicht
  // verdecken, dessen Regionen weiterhin fehlen.
  #loadError: unknown = null;
  #refreshError: unknown = null;
  /** Chunks mit Regionen; nur sie werden aufgefrischt. */
  readonly #loaded = new Map<string, ChunkCoord>();
  /** Leere Chunks mit Ablaufzeitpunkt (ms seit Epoche). */
  readonly #emptyUntil = new Map<string, number>();
  readonly #pending = new Set<string>();

  constructor(
    private readonly source: MapSource,
    /** Wird nach jeder Änderung von `data` oder `error` gerufen. */
    private readonly onChange: () => void = () => {},
    private readonly clock: () => number = Date.now,
  ) {}

  /** Neues Objekt nach jeder Änderung (für React-Abhängigkeiten). */
  get data(): MapData {
    return this.#data;
  }

  /** Fehler des letzten Chunk-Abrufs, sonst der letzten Auffrischung; `null` ohne Fehler. */
  get error(): unknown {
    return this.#loadError ?? this.#refreshError;
  }

  /** Lädt fehlende Chunks (statisch und Zustand). */
  async ensureChunks(chunks: readonly ChunkCoord[]): Promise<void> {
    const now = this.clock();
    const missing = chunks.filter((chunk) => {
      const key = chunkKey(chunk);
      return (
        !this.#loaded.has(key) && !this.#pending.has(key) && (this.#emptyUntil.get(key) ?? 0) <= now
      );
    });
    if (missing.length === 0) return;
    for (const chunk of missing) this.#pending.add(chunkKey(chunk));
    try {
      for (const batch of batches(missing, MAX_CHUNKS_PER_REQUEST)) {
        const [statics, state] = await Promise.all([
          this.source.mapStatic(batch),
          this.source.mapState(batch),
        ]);
        this.#merge(
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
            this.#loaded.set(key, chunk);
            this.#emptyUntil.delete(key);
          } else {
            this.#emptyUntil.set(key, this.clock() + EMPTY_CHUNK_TTL_MS);
          }
        }
      }
      this.#setErrors(null, this.#refreshError);
    } catch (e) {
      this.#setErrors(e, this.#refreshError);
    } finally {
      for (const chunk of missing) this.#pending.delete(chunkKey(chunk));
    }
  }

  /** Liest den Zustand aller geladenen Chunks neu (nach einem Kampf, periodisch). */
  async refresh(): Promise<void> {
    try {
      for (const batch of batches([...this.#loaded.values()], MAX_CHUNKS_PER_REQUEST)) {
        const state = await this.source.mapState(batch);
        this.#merge(
          [],
          state.chunks.flatMap((c) => c.regions),
          state.kingdoms,
        );
      }
      this.#setErrors(this.#loadError, null);
    } catch (e) {
      this.#setErrors(this.#loadError, e);
    }
  }

  #merge(
    statics: readonly StaticRegion[],
    states: readonly RegionStateDto[],
    kingdoms: readonly KingdomSummary[],
  ): void {
    const nextStatics = new Map(this.#data.statics);
    for (const region of statics) nextStatics.set(region.id, region);
    const nextStates = new Map(this.#data.states);
    for (const state of states) nextStates.set(state.id, state);
    const nextKingdoms = new Map(this.#data.kingdoms);
    for (const kingdom of kingdoms) nextKingdoms.set(kingdom.id, kingdom);
    this.#data = { statics: nextStatics, states: nextStates, kingdoms: nextKingdoms };
    this.onChange();
  }

  #setErrors(loadError: unknown, refreshError: unknown): void {
    if (loadError === this.#loadError && refreshError === this.#refreshError) return;
    this.#loadError = loadError;
    this.#refreshError = refreshError;
    this.onChange();
  }
}
