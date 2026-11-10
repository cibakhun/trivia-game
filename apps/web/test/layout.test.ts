import { areNeighbors, chunkOf, type Axial } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import {
  axialToPixel,
  hexCorners,
  pixelToAxial,
  visibleChunks,
  MAX_CHUNKS_PER_REQUEST,
} from '../src/map/layout.ts';

describe('Hex-Geometrie der Karte', () => {
  const cells: Axial[] = [];
  for (let q = -20; q <= 20; q += 3) for (let r = -20; r <= 20; r += 3) cells.push({ q, r });

  it('findet jede Zelle über ihren Mittelpunkt und Punkte nahe den Ecken wieder', () => {
    for (const cell of cells) {
      const centre = axialToPixel(cell);
      expect(pixelToAxial(centre)).toEqual(cell);
      for (const corner of hexCorners(centre)) {
        // 90 % des Weges zur Ecke liegt noch in derselben Zelle
        const inside = {
          x: centre.x + 0.9 * (corner.x - centre.x),
          y: centre.y + 0.9 * (corner.y - centre.y),
        };
        expect(pixelToAxial(inside)).toEqual(cell);
      }
    }
  });

  it('legt Nachbarn im Abstand von √3 · Größe aneinander', () => {
    const a = axialToPixel({ q: 0, r: 0 });
    for (const n of [
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
    ]) {
      expect(areNeighbors({ q: 0, r: 0 }, n)).toBe(true);
      const b = axialToPixel(n);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(Math.sqrt(3) * 28, 6);
    }
  });

  it('liefert alle Chunks des sichtbaren Ausschnitts, auch über negative Koordinaten', () => {
    const cellsInView = cells.filter((cell) => {
      const p = axialToPixel(cell);
      return p.x >= -400 && p.x <= 400 && p.y >= -300 && p.y <= 300;
    });
    const chunks = visibleChunks({ minX: -400, minY: -300, maxX: 400, maxY: 300 });
    const keys = new Set(chunks.map((c) => `${c.chunkX}:${c.chunkY}`));
    for (const cell of cellsInView) {
      const { chunkX, chunkY } = chunkOf(cell);
      expect(keys.has(`${chunkX}:${chunkY}`)).toBe(true);
    }
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS_PER_REQUEST);
  });

  it('begrenzt die Zahl der Chunks und nimmt die mittleren zuerst', () => {
    const chunks = visibleChunks({ minX: -20_000, minY: -20_000, maxX: 20_000, maxY: 20_000 });
    expect(chunks).toHaveLength(MAX_CHUNKS_PER_REQUEST);
    // Mitte des Ausschnitts liegt zwischen den Chunks -1 und 0: diese vier kommen zuerst
    const firstFour = chunks.slice(0, 4).map((c) => `${c.chunkX}:${c.chunkY}`);
    expect(new Set(firstFour)).toEqual(new Set(['-1:-1', '0:-1', '-1:0', '0:0']));
    // und kein ausgelassener Chunk liegt näher an der Mitte als ein gelieferter
    const all = visibleChunks(
      { minX: -20_000, minY: -20_000, maxX: 20_000, maxY: 20_000 },
      undefined,
      Number.MAX_SAFE_INTEGER,
    );
    const distance = (c: { chunkX: number; chunkY: number }) =>
      Math.hypot(c.chunkX + 0.5, c.chunkY + 0.5);
    const keys = new Set(chunks.map((c) => `${c.chunkX}:${c.chunkY}`));
    const farthestTaken = Math.max(...chunks.map(distance));
    for (const c of all) {
      if (!keys.has(`${c.chunkX}:${c.chunkY}`)) {
        expect(distance(c)).toBeGreaterThanOrEqual(farthestTaken);
      }
    }
  });
});
