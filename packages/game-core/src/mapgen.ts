import {
  AXIAL_DIRECTIONS,
  CHUNK_SIZE,
  axialKey,
  axialToOddR,
  cellsOfChunk,
  chunkOf,
  hexDistance,
  oddRToAxial,
  type Axial,
  type ChunkCoord,
} from './hex.ts';
import { createRng, type Rng } from './rng.ts';

/**
 * Kartengenerator (docs/WORLD_SYSTEM.md §3.2). Deterministisch aus dem öffentlichen Welt-Seed
 * (`world_instances.map_seed`) und der Chunk-Koordinate: Jeder Chunk ist einzeln erzeugbar.
 *
 * Nur ganzzahlige Hash-Arithmetik (`Math.imul`) und die vier Grundrechenarten auf Gleitkomma-
 * zahlen, die IEEE 754 exakt festlegt; keine transzendenten Funktionen. Damit liefern Browser und
 * Server bitgleich dieselbe Karte.
 */

/**
 * Version des Generators. Eine Änderung, die für einen Seed eine andere Karte ergibt, erhöht sie;
 * Welten speichern die Version, mit der ihre Chunks erzeugt wurden (spätere Ringe, §4.1).
 */
export const MAPGEN_VERSION = 1;

/** Biome, im MVP rein kosmetisch (GAME_RULES §2). Index = `regions.biome`. */
export const BIOMES = [
  'PLAINS', // Ebene
  'FOREST', // Wald
  'HILLS', // Hügel
  'MOUNTAINS', // Gebirge
  'COAST', // Küste
  'DESERT', // Wüste
  'TUNDRA', // Tundra
  'FORD', // Furt oder Pass: Land, wo das Rauschen Wasser ergäbe (Zusammenhang)
] as const;
export type Biome = (typeof BIOMES)[number];

export function biomeCode(biome: Biome): number {
  return BIOMES.indexOf(biome);
}

/** Eine Landzelle der Karte, also eine Region. */
export interface MapCell extends Axial {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly biome: Biome;
  /** Regionsstufe 0–10 (GAME_RULES §2): Stärke neutraler Garnisonen, Fragenschwierigkeit. */
  readonly tier: number;
}

/** Form einer Welt: welche Zellen dazugehören und welche Stufe sie haben. */
export interface WorldShape {
  /** Chunks, die die Welt berührt, in fester Reihenfolge. */
  readonly chunks: readonly ChunkCoord[];
  contains(cell: Axial): boolean;
  /** Regionsstufe 0–10; wächst von den Startzonen (außen) zum Kern. */
  tier(cell: Axial): number;
}

export class MapGenerationError extends Error {
  override readonly name = 'MapGenerationError';
}

// ---------------------------------------------------------------------------------------------
// Hash und Rauschen
// ---------------------------------------------------------------------------------------------

/** Welt-Seed als zwei 32-Bit-Hälften (`map_seed` ist `bigint`). */
interface SeedWords {
  readonly lo: number;
  readonly hi: number;
}

function seedWords(seed: bigint): SeedWords {
  if (seed < -(2n ** 63n) || seed >= 2n ** 63n) {
    throw new RangeError('map_seed muss in einen 64-Bit-Integer passen');
  }
  const unsigned = BigInt.asUintN(64, seed);
  return { lo: Number(unsigned & 0xffffffffn), hi: Number(unsigned >> 32n) };
}

/** Finalisierer nach „lowbias32“ (Chris Wellons): gute Durchmischung, nur 32-Bit-Operationen. */
function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function hash4(seed: SeedWords, salt: number, x: number, y: number): number {
  let h = mix32(seed.lo ^ Math.imul(salt, 0x9e3779b9));
  h = mix32(h ^ seed.hi);
  h = mix32(h ^ Math.imul(x | 0, 0x85ebca6b));
  h = mix32(h ^ Math.imul(y | 0, 0xc2b2ae35));
  return h;
}

const TWO_POW_32 = 4_294_967_296;

/** Rauschkanäle; jede Zahl ergibt ein unabhängiges Feld. */
const SALT = { elevation: 1, moisture: 2, temperature: 3, factions: 4, factionNames: 5 } as const;

function latticeValue(seed: SeedWords, salt: number, ix: number, iy: number): number {
  return hash4(seed, salt, ix, iy) / TWO_POW_32;
}

/** Wertrauschen mit Gitterabstand `scale` (bilinear, geglättet), Ergebnis in [0, 1). */
function valueNoise(seed: SeedWords, salt: number, x: number, y: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const v00 = latticeValue(seed, salt, ix, iy);
  const v10 = latticeValue(seed, salt, ix + 1, iy);
  const v01 = latticeValue(seed, salt, ix, iy + 1);
  const v11 = latticeValue(seed, salt, ix + 1, iy + 1);
  const top = v00 + (v10 - v00) * sx;
  const bottom = v01 + (v11 - v01) * sx;
  return top + (bottom - top) * sy;
}

/** Drei Oktaven; Koordinaten sind Offset-Spalte und -Zeile, also chunkübergreifend stetig. */
function fractal(seed: SeedWords, salt: number, col: number, row: number): number {
  return (
    0.6 * valueNoise(seed, salt, col, row, 12) +
    0.3 * valueNoise(seed, salt + 100, col, row, 6) +
    0.1 * valueNoise(seed, salt + 200, col, row, 3)
  );
}

/** Höhenschwelle für Wasser; ergibt ≈ 88 % Land (gemessen im Test, WORLD_SYSTEM §3.1). */
export const WATER_LEVEL = 0.35;

interface Terrain {
  readonly elevation: number;
  readonly moisture: number;
  readonly temperature: number;
}

function terrainAt(seed: SeedWords, cell: Axial): Terrain {
  const { col, row } = axialToOddR(cell);
  return {
    elevation: fractal(seed, SALT.elevation, col, row),
    moisture: fractal(seed, SALT.moisture, col, row),
    temperature: fractal(seed, SALT.temperature, col, row),
  };
}

function landBiome(terrain: Terrain, coastal: boolean): Biome {
  if (terrain.elevation >= 0.74) return 'MOUNTAINS';
  if (terrain.elevation >= 0.64) return 'HILLS';
  if (coastal) return 'COAST';
  if (terrain.temperature < 0.3) return 'TUNDRA';
  if (terrain.temperature > 0.7 && terrain.moisture < 0.45) return 'DESERT';
  return terrain.moisture >= 0.52 ? 'FOREST' : 'PLAINS';
}

// ---------------------------------------------------------------------------------------------
// Chunk erzeugen
// ---------------------------------------------------------------------------------------------

/** Mittelzeile und -spalte jedes Chunks sind Land: So hängen alle Chunks zusammen (§3.2). */
const CROSS_INDEX = CHUNK_SIZE / 2;

function isCross(cell: Axial): boolean {
  const { col, row } = axialToOddR(cell);
  const x = col - Math.floor(col / CHUNK_SIZE) * CHUNK_SIZE;
  const y = row - Math.floor(row / CHUNK_SIZE) * CHUNK_SIZE;
  return x === CROSS_INDEX || y === CROSS_INDEX;
}

/**
 * Erzeugt die Landzellen eines Chunks. Landflächen ohne Verbindung zum Kreuz werden über den
 * kürzesten Pfad durch Wasserzellen des Chunks angebunden; der Pfad wird zur Furt.
 */
export function generateChunk(mapSeed: bigint, chunk: ChunkCoord, shape: WorldShape): MapCell[] {
  const seed = seedWords(mapSeed);
  const cells = cellsOfChunk(chunk).filter((cell) => shape.contains(cell));
  const inChunk = new Map(cells.map((cell) => [axialKey(cell), cell]));
  const terrain = new Map(cells.map((cell) => [axialKey(cell), terrainAt(seed, cell)]));

  const land = new Set<string>();
  const forced = new Set<string>();
  for (const cell of cells) {
    const key = axialKey(cell);
    const isLand = (terrain.get(key)?.elevation ?? 0) >= WATER_LEVEL;
    if (isLand) land.add(key);
    else if (isCross(cell)) {
      land.add(key);
      forced.add(key);
    }
  }

  const neighborsInChunk = (cell: Axial): Axial[] =>
    AXIAL_DIRECTIONS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r })).filter((n) =>
      inChunk.has(axialKey(n)),
    );

  // Hauptfläche: die Fläche des ersten Kreuzfeldes (oder die erste Fläche, falls die Form das
  // Kreuz nicht berührt); alle anderen werden der Reihe nach angebunden.
  const component = (start: Axial): Set<string> => {
    const seen = new Set([axialKey(start)]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      for (const n of neighborsInChunk(queue[i] as Axial)) {
        const key = axialKey(n);
        if (land.has(key) && !seen.has(key)) {
          seen.add(key);
          queue.push(n);
        }
      }
    }
    return seen;
  };
  const landCells = () => cells.filter((cell) => land.has(axialKey(cell)));
  const first = landCells().find(isCross) ?? landCells()[0];
  if (first) {
    let main = component(first);
    for (;;) {
      const loose = landCells().find((cell) => !main.has(axialKey(cell)));
      if (!loose) break;
      const island = component(loose);
      const path = shortestWaterPath(island, main, cells, neighborsInChunk);
      if (!path)
        throw new MapGenerationError(`Chunk ${chunk.chunkX}:${chunk.chunkY}: Fläche ohne Weg`);
      for (const key of path) {
        if (land.has(key)) continue; // andere Insel auf dem Weg: wird mit angebunden
        land.add(key);
        forced.add(key);
      }
      main = component(first);
    }
  }

  const isWaterOutside = (cell: Axial): boolean => {
    if (!shape.contains(cell)) return true; // Rand der Welt erscheint als Küste
    const key = axialKey(cell);
    if (inChunk.has(key)) return !land.has(key);
    // Nachbarchunk: nur das Rauschen (Furten dort zählen nicht), rein kosmetisch
    return terrainAt(seed, cell).elevation < WATER_LEVEL && !isCross(cell);
  };

  return landCells().map((cell) => {
    const key = axialKey(cell);
    const coastal = AXIAL_DIRECTIONS.some((d) =>
      isWaterOutside({ q: cell.q + d.q, r: cell.r + d.r }),
    );
    const biome = forced.has(key) ? 'FORD' : landBiome(terrain.get(key) as Terrain, coastal);
    const { chunkX, chunkY } = chunkOf(cell);
    return { q: cell.q, r: cell.r, chunkX, chunkY, biome, tier: shape.tier(cell) };
  });
}

/** Mehrquellen-Breitensuche vom Rand der Insel durch Wasser bis zur Hauptfläche. */
function shortestWaterPath(
  island: ReadonlySet<string>,
  main: ReadonlySet<string>,
  cells: readonly Axial[],
  neighborsOf: (cell: Axial) => Axial[],
): string[] | null {
  const previous = new Map<string, string | null>();
  const queue: Axial[] = [];
  for (const cell of cells) {
    const key = axialKey(cell);
    if (island.has(key)) {
      previous.set(key, null);
      queue.push(cell);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i] as Axial;
    const currentKey = axialKey(current);
    for (const n of neighborsOf(current)) {
      const key = axialKey(n);
      if (previous.has(key)) continue;
      previous.set(key, currentKey);
      if (main.has(key)) {
        const path: string[] = [];
        for (let k = currentKey; !island.has(k); k = previous.get(k) as string) path.push(k);
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/** Erzeugt alle Chunks der Form und prüft per Flutfüllung, dass die Karte zusammenhängt. */
export function generateWorld(mapSeed: bigint, shape: WorldShape): MapCell[] {
  const cells = shape.chunks.flatMap((chunk) => generateChunk(mapSeed, chunk, shape));
  assertConnected(cells);
  return cells;
}

export function assertConnected(cells: readonly Axial[]): void {
  const keys = new Set(cells.map(axialKey));
  const first = cells[0];
  if (!first) throw new MapGenerationError('Karte ohne Regionen');
  const seen = new Set([axialKey(first)]);
  const queue: Axial[] = [first];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i] as Axial;
    for (const d of AXIAL_DIRECTIONS) {
      const n = { q: cell.q + d.q, r: cell.r + d.r };
      const key = axialKey(n);
      if (keys.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(n);
      }
    }
  }
  if (seen.size !== keys.size) {
    throw new MapGenerationError(
      `Karte nicht zusammenhängend: ${keys.size - seen.size} von ${keys.size} Regionen getrennt`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Formen
// ---------------------------------------------------------------------------------------------

/**
 * Sechseckige Welt mit Radius `radius` um `center` (Testwelt, später Daily-Vorlagen). Stufe
 * linear von 0 am Rand (Startzone) bis 10 im Zentrum.
 */
export function hexWorldShape(center: Axial, radius: number): WorldShape {
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 200) {
    throw new RangeError(`Radius muss 1–200 sein: ${radius}`);
  }
  const chunkKeys = new Map<string, ChunkCoord>();
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      const chunk = chunkOf({ q: center.q + dq, r: center.r + dr });
      chunkKeys.set(`${chunk.chunkX}:${chunk.chunkY}`, chunk);
    }
  }
  const chunks = [...chunkKeys.values()].sort((a, b) => a.chunkY - b.chunkY || a.chunkX - b.chunkX);
  return {
    chunks,
    contains: (cell) => hexDistance(cell, center) <= radius,
    tier: (cell) => {
      const distance = hexDistance(cell, center);
      if (distance > radius) throw new RangeError('Zelle außerhalb der Welt');
      return Math.round((10 * (radius - distance)) / radius);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// NPC-Fraktionen (WORLD_SYSTEM §3.2 Schritt 3, NPC_SYSTEM §2)
// ---------------------------------------------------------------------------------------------

export const FACTION_ARCHETYPES = ['LIGHT', 'MEDIUM', 'HEAVY'] as const;
export type FactionArchetype = (typeof FACTION_ARCHETYPES)[number];

export interface FactionSpec {
  readonly archetype: FactionArchetype;
  /** Zielgröße in Regionen (weniger, wenn kein Platz ist). */
  readonly size: number;
  /** Stufenbereich der Hauptstadt. */
  readonly minTier: number;
  readonly maxTier: number;
}

export interface PlacedFaction {
  readonly archetype: FactionArchetype;
  readonly capital: Axial;
  /** Regionen der Fraktion, die Hauptstadt zuerst. */
  readonly cells: readonly Axial[];
}

/** Mindestabstand der Hauptstadt einer Fraktion zu bereits vergebenen Regionen (nicht benachbart). */
const FACTION_SPACING = 2;

function seededRng(mapSeed: bigint, salt: number): Rng {
  const seed = seedWords(mapSeed);
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i++) view.setUint32(i * 4, hash4(seed, salt, i, 0));
  return createRng(bytes);
}

/**
 * Platziert zusammenhängende Fraktionsgebiete der Reihe nach: Hauptstadt per Zufallsstrom aus
 * dem Welt-Seed unter den freien Regionen im Stufenbereich, dann Wachstum ringförmig um die
 * Hauptstadt (kompakte Gebiete), Gleichstand nach Hash. Deterministisch.
 */
export function placeFactions(
  mapSeed: bigint,
  cells: readonly MapCell[],
  specs: readonly FactionSpec[],
): PlacedFaction[] {
  const rng = seededRng(mapSeed, SALT.factions);
  const seed = seedWords(mapSeed);
  const byKey = new Map(cells.map((cell) => [axialKey(cell), cell]));
  const claimed = new Set<string>();
  const placed: PlacedFaction[] = [];

  for (const spec of specs) {
    if (!Number.isSafeInteger(spec.size) || spec.size < 1) {
      throw new RangeError(`Fraktionsgröße muss ≥ 1 sein: ${spec.size}`);
    }
    // Bevorzugt: Stufe im Bereich und nicht benachbart zu vergebenen Regionen. Gibt es das nicht
    // (kleine Karten), zählt jede Stufe Abstand zum Bereich doppelt, fehlender Abstand einfach.
    const claimedCells = [...claimed].map((key) => byKey.get(key) as MapCell);
    const penalty = (cell: MapCell): number => {
      const tierGap = Math.max(spec.minTier - cell.tier, 0, cell.tier - spec.maxTier);
      const spaced = claimedCells.every((other) => hexDistance(cell, other) >= FACTION_SPACING);
      return tierGap * 2 + (spaced ? 0 : 1);
    };
    const free = cells.filter((cell) => !claimed.has(axialKey(cell)));
    if (free.length === 0)
      throw new MapGenerationError(`Kein Platz für Fraktion ${spec.archetype}`);
    const penalties = free.map(penalty);
    const lowest = Math.min(...penalties);
    const candidates = free.filter((_, i) => penalties[i] === lowest);
    const capital = candidates[rng.nextUint32() % candidates.length] as MapCell;
    const territory: Axial[] = [{ q: capital.q, r: capital.r }];
    claimed.add(axialKey(capital));
    const frontier = new Map<string, Axial>();
    const addFrontier = (cell: Axial) => {
      for (const d of AXIAL_DIRECTIONS) {
        const n = { q: cell.q + d.q, r: cell.r + d.r };
        const key = axialKey(n);
        if (byKey.has(key) && !claimed.has(key)) frontier.set(key, n);
      }
    };
    addFrontier(capital);
    while (territory.length < spec.size && frontier.size > 0) {
      let best: Axial | null = null;
      let bestRank = Infinity;
      let bestTie = Infinity;
      for (const cell of frontier.values()) {
        const rank = hexDistance(cell, capital);
        const tie = hash4(seed, SALT.factions + placed.length + 1, cell.q, cell.r);
        if (rank < bestRank || (rank === bestRank && tie < bestTie)) {
          best = cell;
          bestRank = rank;
          bestTie = tie;
        }
      }
      const next = best as Axial;
      frontier.delete(axialKey(next));
      claimed.add(axialKey(next));
      territory.push({ q: next.q, r: next.r });
      addFrontier(next);
    }
    placed.push({
      archetype: spec.archetype,
      capital: { q: capital.q, r: capital.r },
      cells: territory,
    });
  }
  return placed;
}

/**
 * Zufallsstrom für Namen und Farben der NPC-Reiche einer Welt. Hängt nur vom öffentlichen
 * Welt-Seed ab (wie die Karte), damit die Erzeugung ohne RNG-Geheimnis nachvollziehbar ist; die
 * Namen sind ohnehin öffentlich.
 */
export function factionNamingRng(mapSeed: bigint): Rng {
  return seededRng(mapSeed, SALT.factionNames);
}

// ---------------------------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------------------------

export interface MapPreset {
  readonly shape: WorldShape;
  readonly factions: readonly FactionSpec[];
}

/** Seed der Testwelt: ergibt 150 Regionen und alle Fraktionen in voller Größe. */
export const TEST_WORLD_SEED = 2175n;

/**
 * Testwelt für Phase 1 (≈ 150 Regionen, DEVELOPMENT_ROADMAP): Sechseck mit Radius 7 in Chunk
 * 0:0, schwere Fraktion im Zentrum, mittlere dazwischen, leichte nahe der Startzone [E].
 */
export function testWorldPreset(): MapPreset {
  const center = oddRToAxial(CROSS_INDEX, CROSS_INDEX);
  return {
    shape: hexWorldShape(center, 7),
    factions: [
      { archetype: 'HEAVY', size: 10, minTier: 8, maxTier: 10 },
      { archetype: 'MEDIUM', size: 8, minTier: 5, maxTier: 7 },
      { archetype: 'MEDIUM', size: 8, minTier: 5, maxTier: 7 },
      { archetype: 'LIGHT', size: 5, minTier: 3, maxTier: 4 },
      { archetype: 'LIGHT', size: 5, minTier: 3, maxTier: 4 },
      { archetype: 'LIGHT', size: 5, minTier: 3, maxTier: 4 },
    ],
  };
}
