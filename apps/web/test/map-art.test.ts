import { areNeighbors, KERNMARK, WENDELMARK } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import { mapArt, pointInPolygon } from '../src/art/map-art.ts';
import { TERRAINS, terrainOf } from '../src/art/terrain.ts';

/** Gezeichnete Karte der Partie (docs/ART_DIRECTION.md): Form frei, Nachbarschaft wie die Regeln. */

type Pt = { x: number; y: number };

function pointsOf(d: string): Pt[] {
  return [...d.matchAll(/[ML](-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

const key = (p: Pt) => `${p.x}:${p.y}`;

describe('Karte der Partie (Landkarte)', () => {
  const art = mapArt(WENDELMARK);
  const outlines = art.regions.map((r) => pointsOf(r.d));

  it('zeichnet jede Region der Wendelmark als geschlossene Fläche um ihren Mittelpunkt', () => {
    expect(art.regions.map((r) => r.id)).toEqual(WENDELMARK.regions.map((r) => r.id));
    expect(art.regions.map((r) => r.name)).toEqual(WENDELMARK.regions.map((r) => r.name));
    art.regions.forEach((region, i) => {
      expect(region.d.endsWith('Z')).toBe(true);
      const outline = outlines[i] ?? [];
      expect(outline.length).toBeGreaterThan(30);
      expect(pointInPolygon({ x: region.cx, y: region.cy }, outline)).toBe(true);
    });
  });

  it('teilt Grenzen genau zwischen Nachbarn der Regeln, sonst berühren sich Regionen nicht', () => {
    for (const a of WENDELMARK.regions) {
      for (const b of WENDELMARK.regions) {
        if (a.id >= b.id) continue;
        const pa = new Set((outlines[a.id] ?? []).map(key));
        const shared = (outlines[b.id] ?? []).filter((p) => pa.has(key(p))).length;
        if (areNeighbors(a.cell, b.cell)) expect(shared).toBeGreaterThanOrEqual(5);
        else expect(shared).toBe(0);
      }
    }
  });

  it('liegt mit Küste, Fluss und Motiven im Bildausschnitt; der enge Ausschnitt umfasst die Insel', () => {
    const inside = (p: Pt) => p.x > 0 && p.y > 0 && p.x < art.width && p.y < art.height;
    for (const outline of outlines) expect(outline.every(inside)).toBe(true);
    expect(pointsOf(art.coast).every(inside)).toBe(true);
    for (const region of art.regions) expect(region.decor.every(inside)).toBe(true);
    const [tx = 0, ty = 0, tw = 0, th = 0] = art.tightViewBox.split(' ').map(Number);
    for (const p of pointsOf(art.coast)) {
      expect(p.x).toBeGreaterThanOrEqual(tx);
      expect(p.y).toBeGreaterThanOrEqual(ty);
      expect(p.x).toBeLessThanOrEqual(tx + tw);
      expect(p.y).toBeLessThanOrEqual(ty + th);
    }
  });

  it('führt den Fluss von Küste zu Küste entlang innerer Grenzen', () => {
    expect(art.river).not.toBeNull();
    const river = pointsOf(art.river ?? '');
    const coast = new Set(pointsOf(art.coast).map(key));
    const borders = new Set(outlines.flatMap((o) => o.map(key)));
    const [source, mouth] = [river[0], river.at(-1)];
    if (!source || !mouth) throw new Error('Fluss leer');
    expect(coast.has(key(source))).toBe(true);
    expect(coast.has(key(mouth))).toBe(true);
    expect(mouth.y).toBeGreaterThan(source.y);
    expect(river.every((p) => borders.has(key(p)))).toBe(true);
  });

  it('ist deterministisch: gleiche Karte, gleiches Bild', () => {
    expect(mapArt(WENDELMARK)).toEqual(art);
  });

  it('zeichnet auch die Kernmark für zwei Spieler: gleiche Regeln, flachere Insel', () => {
    const small = mapArt(KERNMARK);
    const shapes = small.regions.map((r) => pointsOf(r.d));
    expect(small.regions.map((r) => r.name)).toEqual(KERNMARK.regions.map((r) => r.name));
    for (const a of KERNMARK.regions) {
      for (const b of KERNMARK.regions) {
        if (a.id >= b.id) continue;
        const pa = new Set((shapes[a.id] ?? []).map(key));
        const shared = (shapes[b.id] ?? []).filter((p) => pa.has(key(p))).length;
        if (areNeighbors(a.cell, b.cell)) expect(shared).toBeGreaterThanOrEqual(5);
        else expect(shared).toBe(0);
      }
    }
    small.regions.forEach((region, i) => {
      expect(pointInPolygon({ x: region.cx, y: region.cy }, shapes[i] ?? [])).toBe(true);
    });
    // Drei statt fünf Reihen: gleich breit, deutlich niedriger
    expect(Math.abs(small.width - art.width)).toBeLessThan(art.size);
    expect(small.height).toBeLessThan(art.height * 0.75);
    // Dieselbe Region sieht auf beiden Karten gleich aus (gleiche Landschaft)
    const big = new Map(art.regions.map((r) => [r.name, r.terrain]));
    for (const region of small.regions) expect(big.get(region.name)).toBe(region.terrain);
  });

  it('kennt für jede Region eine Landschaft, auch für neue Namen', () => {
    for (const region of WENDELMARK.regions) expect(TERRAINS).toContain(terrainOf(region.name));
    expect(terrainOf('Buchenwald')).toBe('forest');
    expect(terrainOf('Schwarzmoor')).toBe('marsh');
    expect(terrainOf('Irgendwo')).toBe('village');
  });
});
