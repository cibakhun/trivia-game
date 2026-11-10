import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AXIAL_DIRECTIONS,
  BIOMES,
  CHUNK_SIZE,
  MapGenerationError,
  TEST_WORLD_SEED,
  assertConnected,
  axialKey,
  axialToOddR,
  generateChunk,
  generateWorld,
  hexDistance,
  hexWorldShape,
  oddRToAxial,
  placeFactions,
  testWorldPreset,
  type Axial,
  type MapCell,
} from '../src/index.ts';

const seedArb = fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n });

function fingerprint(cells: readonly MapCell[]): string {
  const text = cells.map((c) => `${c.q},${c.r},${c.biome},${c.tier}`).join(';');
  return createHash('sha256').update(text).digest('hex');
}

describe('Kartengenerator', () => {
  const preset = testWorldPreset();

  it('ist deterministisch und hängt vom Seed ab', () => {
    const a = generateWorld(42n, preset.shape);
    expect(generateWorld(42n, preset.shape)).toEqual(a);
    expect(fingerprint(generateWorld(43n, preset.shape))).not.toBe(fingerprint(a));
  });

  it('bleibt für einen festen Seed stabil (sonst MAPGEN_VERSION erhöhen)', () => {
    const cells = generateWorld(TEST_WORLD_SEED, preset.shape);
    expect(cells.length).toBe(150);
    expect(fingerprint(cells)).toBe(
      '4e89b88e4c4c02f843bf1c0be7366fb8ff5eb8224d57c6fa5f3e29e72bee540b',
    );
  });

  it('erzeugt eine zusammenhängende Testwelt mit ≈ 150 Regionen (Eigenschaft über Seeds)', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const cells = generateWorld(seed, preset.shape);
        assertConnected(cells);
        expect(cells.length).toBeGreaterThanOrEqual(20); // mindestens das Kreuz
        expect(cells.length).toBeLessThanOrEqual(169);
      }),
      { numRuns: 200 },
    );
    let total = 0;
    for (let s = 1n; s <= 100n; s++) total += generateWorld(s * 7919n, preset.shape).length;
    expect(total / 100).toBeGreaterThan(140);
    expect(total / 100).toBeLessThan(160);
  });

  it('hat auf großen Karten ≈ 88 % Land (WORLD_SYSTEM §3.1)', () => {
    const shape = hexWorldShape({ q: 0, r: 0 }, 40);
    const cellsPerWorld = 1 + 3 * 40 * 41;
    let land = 0;
    for (let s = 1n; s <= 5n; s++) land += generateWorld(s * 104_729n, shape).length;
    const share = land / (5 * cellsPerWorld);
    expect(share).toBeGreaterThan(0.84);
    expect(share).toBeLessThan(0.92);
  });

  it('hält Mittelzeile und -spalte jedes Chunks als Land', () => {
    const shape = hexWorldShape({ q: 20, r: 20 }, 30);
    const cells = generateWorld(7n, shape);
    const keys = new Set(cells.map(axialKey));
    for (const chunk of shape.chunks) {
      for (let i = 0; i < CHUNK_SIZE; i++) {
        for (const [x, y] of [
          [CHUNK_SIZE / 2, i],
          [i, CHUNK_SIZE / 2],
        ] as const) {
          const cell = oddRToAxial(chunk.chunkX * CHUNK_SIZE + x, chunk.chunkY * CHUNK_SIZE + y);
          if (shape.contains(cell)) expect(keys.has(axialKey(cell))).toBe(true);
        }
      }
    }
  });

  it('erzeugt jeden Chunk unabhängig von der Reihenfolge', () => {
    const shape = hexWorldShape({ q: 10, r: 24 }, 22);
    const forward = shape.chunks.flatMap((chunk) => generateChunk(5n, chunk, shape));
    const backward = [...shape.chunks]
      .reverse()
      .flatMap((chunk) => generateChunk(5n, chunk, shape));
    const sort = (cells: MapCell[]) =>
      [...cells].sort((a, b) => a.r - b.r || a.q - b.q).map((c) => JSON.stringify(c));
    expect(sort(backward)).toEqual(sort(forward));
    expect(shape.chunks.length).toBeGreaterThan(4);
  });

  it('ordnet Zellen ihrem Chunk zu und vergibt gültige Biome und Stufen', () => {
    const cells = generateWorld(99n, preset.shape);
    for (const cell of cells) {
      const { col, row } = axialToOddR(cell);
      expect(cell.chunkX).toBe(Math.floor(col / CHUNK_SIZE));
      expect(cell.chunkY).toBe(Math.floor(row / CHUNK_SIZE));
      expect(BIOMES).toContain(cell.biome);
      expect(cell.tier).toBeGreaterThanOrEqual(0);
      expect(cell.tier).toBeLessThanOrEqual(10);
    }
  });

  it('steigt in der Stufe von außen (0) nach innen (10)', () => {
    const center = oddRToAxial(8, 8);
    const shape = hexWorldShape(center, 7);
    expect(shape.tier(center)).toBe(10);
    expect(shape.tier({ q: center.q + 7, r: center.r })).toBe(0);
    for (let d = 1; d <= 7; d++) {
      expect(shape.tier({ q: center.q + d, r: center.r })).toBeLessThanOrEqual(
        shape.tier({ q: center.q + d - 1, r: center.r }),
      );
    }
    expect(() => shape.tier({ q: center.q + 8, r: center.r })).toThrow(RangeError);
    expect(() => hexWorldShape(center, 0)).toThrow(RangeError);
  });

  it('erkennt getrennte Karten', () => {
    expect(() =>
      assertConnected([
        { q: 0, r: 0 },
        { q: 5, r: 5 },
      ]),
    ).toThrow(MapGenerationError);
    expect(() => assertConnected([])).toThrow(MapGenerationError);
  });

  it('lehnt einen Seed außerhalb von 64 Bit ab', () => {
    expect(() => generateWorld(2n ** 63n, preset.shape)).toThrow(RangeError);
  });
});

describe('NPC-Fraktionen', () => {
  const preset = testWorldPreset();

  function isContiguous(cells: readonly Axial[]): boolean {
    const keys = new Set(cells.map(axialKey));
    const first = cells[0];
    if (!first) return false;
    const seen = new Set([axialKey(first)]);
    const queue = [first];
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i] as Axial;
      for (const d of AXIAL_DIRECTIONS) {
        const n = { q: cell.q + d.q, r: cell.r + d.r };
        if (keys.has(axialKey(n)) && !seen.has(axialKey(n))) {
          seen.add(axialKey(n));
          queue.push(n);
        }
      }
    }
    return seen.size === keys.size;
  }

  it('platziert getrennte, zusammenhängende Gebiete mit Hauptstadt zuerst (Eigenschaft)', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const cells = generateWorld(seed, preset.shape);
        const factions = placeFactions(seed, cells, preset.factions);
        expect(factions.map((f) => f.archetype)).toEqual(preset.factions.map((f) => f.archetype));
        const land = new Set(cells.map(axialKey));
        const all = new Set<string>();
        for (const [i, faction] of factions.entries()) {
          expect(faction.cells[0]).toEqual(faction.capital);
          expect(faction.cells.length).toBeLessThanOrEqual(preset.factions[i]?.size ?? 0);
          expect(isContiguous(faction.cells)).toBe(true);
          for (const cell of faction.cells) {
            expect(land.has(axialKey(cell))).toBe(true);
            expect(all.has(axialKey(cell))).toBe(false);
            all.add(axialKey(cell));
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('erreicht auf der festen Testwelt alle Zielgrößen und Stufenbereiche', () => {
    const seed = TEST_WORLD_SEED;
    const cells = generateWorld(seed, preset.shape);
    const tierOf = new Map(cells.map((c) => [axialKey(c), c.tier]));
    const factions = placeFactions(seed, cells, preset.factions);
    expect(placeFactions(seed, cells, preset.factions)).toEqual(factions);
    for (const [i, faction] of factions.entries()) {
      const spec = preset.factions[i]!;
      expect(faction.cells).toHaveLength(spec.size);
      const tier = tierOf.get(axialKey(faction.capital)) ?? -1;
      expect(tier).toBeGreaterThanOrEqual(spec.minTier);
      expect(tier).toBeLessThanOrEqual(spec.maxTier);
    }
    // leichte Fraktionen liegen näher am Rand als die schwere
    const center = oddRToAxial(8, 8);
    const heavy = factions.find((f) => f.archetype === 'HEAVY')!;
    for (const light of factions.filter((f) => f.archetype === 'LIGHT')) {
      expect(hexDistance(light.capital, center)).toBeGreaterThan(
        hexDistance(heavy.capital, center),
      );
    }
  });

  it('lehnt eine ungültige Größe ab und meldet fehlenden Platz', () => {
    const cells = generateWorld(1n, preset.shape);
    expect(() =>
      placeFactions(1n, cells, [{ archetype: 'LIGHT', size: 0, minTier: 0, maxTier: 10 }]),
    ).toThrow(RangeError);
    const tiny = cells.slice(0, 2);
    expect(() =>
      placeFactions(1n, tiny, [
        { archetype: 'LIGHT', size: 2, minTier: 0, maxTier: 10 },
        { archetype: 'LIGHT', size: 1, minTier: 0, maxTier: 10 },
      ]),
    ).toThrow(MapGenerationError);
  });
});
