import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  areNeighbors,
  axialKey,
  axialToOddR,
  cellsOfChunk,
  chunkOf,
  hexDistance,
  neighbors,
  oddRToAxial,
} from '../src/index.ts';

const coord = fc.integer({ min: -100_000, max: 100_000 });
const axial = fc.record({ q: coord, r: coord });

describe('Nachbarschaft', () => {
  it('liefert die sechs Nachbarn in der Reihenfolge aus GAME_RULES §2', () => {
    expect(neighbors({ q: 2, r: -3 })).toEqual([
      { q: 3, r: -3 },
      { q: 1, r: -3 },
      { q: 2, r: -2 },
      { q: 2, r: -4 },
      { q: 3, r: -4 },
      { q: 1, r: -2 },
    ]);
  });

  it('hat genau 6 verschiedene Nachbarn, alle im Abstand 1', () => {
    fc.assert(
      fc.property(axial, (a) => {
        const n = neighbors(a);
        expect(new Set(n.map(axialKey)).size).toBe(6);
        for (const b of n) expect(hexDistance(a, b)).toBe(1);
      }),
    );
  });

  it('ist symmetrisch', () => {
    fc.assert(
      fc.property(axial, axial, (a, b) => {
        expect(areNeighbors(a, b)).toBe(areNeighbors(b, a));
        const n = neighbors(a)[0]!;
        expect(neighbors(n).map(axialKey)).toContain(axialKey(a));
      }),
    );
  });

  it('Distanz ist eine Metrik (Dreiecksungleichung, Identität, Symmetrie)', () => {
    fc.assert(
      fc.property(axial, axial, axial, (a, b, c) => {
        expect(hexDistance(a, a)).toBe(0);
        expect(hexDistance(a, b)).toBe(hexDistance(b, a));
        expect(hexDistance(a, c)).toBeLessThanOrEqual(hexDistance(a, b) + hexDistance(b, c));
        expect(Number.isInteger(hexDistance(a, b))).toBe(true);
      }),
    );
  });

  it('lehnt nicht ganzzahlige Koordinaten ab', () => {
    expect(() => neighbors({ q: 0.5, r: 0 })).toThrow(RangeError);
    expect(() => hexDistance({ q: 0, r: 0 }, { q: Number.NaN, r: 0 })).toThrow(RangeError);
  });
});

describe('Chunks (odd-r, 16 × 16)', () => {
  it.each([
    [
      { q: 0, r: 0 },
      { chunkX: 0, chunkY: 0 },
    ],
    [
      { q: 15, r: 0 },
      { chunkX: 0, chunkY: 0 },
    ],
    [
      { q: 16, r: 0 },
      { chunkX: 1, chunkY: 0 },
    ],
    [
      { q: -1, r: 0 },
      { chunkX: -1, chunkY: 0 },
    ],
    [
      { q: 0, r: 15 },
      { chunkX: 0, chunkY: 0 },
    ], // col = 0 + (15 − 1) / 2 = 7
    [
      { q: 0, r: 16 },
      { chunkX: 0, chunkY: 1 },
    ],
    [
      { q: 0, r: -1 },
      { chunkX: -1, chunkY: -1 },
    ], // col = 0 + (−1 − 1) / 2 = −1
    [
      { q: 1, r: -1 },
      { chunkX: 0, chunkY: -1 },
    ],
    [
      { q: -8, r: 31 },
      { chunkX: 0, chunkY: 1 },
    ], // col = −8 + 15 = 7
  ])('%j → %j', (cell, expected) => {
    expect(chunkOf(cell)).toEqual(expected);
  });

  it('odd-r-Umrechnung ist umkehrbar, auch für negative Zeilen', () => {
    fc.assert(
      fc.property(axial, (a) => {
        const { col, row } = axialToOddR(a);
        expect(oddRToAxial(col, row)).toEqual(a);
      }),
    );
  });

  it('ordnet jede Zelle genau dem Chunk zu, der sie enthält (stabil)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        (chunkX, chunkY) => {
          const cells = cellsOfChunk({ chunkX, chunkY });
          expect(cells).toHaveLength(256);
          expect(new Set(cells.map(axialKey)).size).toBe(256);
          for (const cell of cells) expect(chunkOf(cell)).toEqual({ chunkX, chunkY });
        },
      ),
      { numRuns: 30 },
    );
  });
});
