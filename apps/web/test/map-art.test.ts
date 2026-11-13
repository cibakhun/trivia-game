import { areNeighbors, KERNMARK, WENDELMARK } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import { frontiers, mapArt, pointInPolygon } from '../src/art/map-art.ts';
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

  it('zeichnet je Landschaft eine Szene über dem Namen und Motive an Ecken und Spitzen', () => {
    for (const region of art.regions) {
      const slots = (slot: string) => region.decor.filter((d) => d.slot === slot);
      // Die Szene steht über der Mitte, gespiegelt oder nicht, aber als Ganzes
      const scene = slots('top');
      expect(scene.length).toBeGreaterThanOrEqual(3);
      expect(scene.every((d) => d.y < region.cy)).toBe(true);
      expect(new Set(scene.map((d) => d.flip)).size).toBe(1);
      // Je zwei Motive an den unteren Ecken und an den seitlichen Spitzen, links und rechts
      for (const slot of ['side', 'ground']) {
        const pair = slots(slot);
        expect(pair).toHaveLength(2);
        expect(pair.filter((d) => d.x < region.cx)).toHaveLength(1);
      }
      expect(slots('side').every((d) => d.y > region.cy)).toBe(true);
    }
    // Gleiche Landschaft, gleiche Motive: Wälder zeigen Bäume, Gebirge Gipfel
    const kinds = (terrain: string) =>
      new Set(
        art.regions
          .filter((r) => r.terrain === terrain)
          .flatMap((r) => r.decor.filter((d) => d.slot === 'top').map((d) => d.kind)),
      );
    expect([...kinds('forest')]).toEqual(['tree']);
    expect([...kinds('mountains')]).toEqual(['mountain']);
  });

  describe('Außengrenze eines Reichs', () => {
    const segments = (d: string) =>
      [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [
        { x: Number(m[1]), y: Number(m[2]) },
        { x: Number(m[3]), y: Number(m[4]) },
      ]);
    const edgeKeys = (id: number) => {
      const outline = art.regions[id]?.outline ?? [];
      return outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length] ?? a;
        return [key(a), key(b)].sort().join('|');
      });
    };
    const keysOf = (d: string) => segments(d).map(([a, b]) => [key(a!), key(b!)].sort().join('|'));
    const [first, second] = WENDELMARK.regions.filter((a) =>
      WENDELMARK.regions.some((b) => a.id < b.id && areNeighbors(a.cell, b.cell)),
    );
    if (!first || !second) throw new Error('Karte ohne Nachbarn');
    const neighbour = WENDELMARK.regions.find(
      (b) => b.id !== first.id && areNeighbors(first.cell, b.cell),
    );
    const far = WENDELMARK.regions.find(
      (b) => b.id !== first.id && !areNeighbors(first.cell, b.cell),
    );
    if (!neighbour || !far) throw new Error('Karte zu klein');
    const owners = (entries: Record<number, number>) =>
      WENDELMARK.regions.map((r) => entries[r.id] ?? null);

    it('umfasst bei einem einzelnen Feld den ganzen Umriss', () => {
      const [realm] = frontiers(art, owners({ [first.id]: 1 }));
      expect(realm?.seat).toBe(1);
      expect(realm?.regions).toEqual([first.id]);
      expect(new Set(keysOf(realm?.d ?? ''))).toEqual(new Set(edgeKeys(first.id)));
    });

    it('lässt die Grenze zwischen zwei Feldern desselben Reichs weg', () => {
      const [realm] = frontiers(art, owners({ [first.id]: 0, [neighbour.id]: 0 }));
      const a = new Set(edgeKeys(first.id));
      const b = new Set(edgeKeys(neighbour.id));
      const shared = [...a].filter((k) => b.has(k));
      expect(shared.length).toBeGreaterThan(0);
      const drawn = new Set(keysOf(realm?.d ?? ''));
      for (const k of shared) expect(drawn.has(k)).toBe(false);
      expect(drawn.size).toBe(a.size + b.size - 2 * shared.length);
    });

    it('zeichnet ein zerrissenes Reich als ein Reich mit beiden Umrissen', () => {
      const realms = frontiers(art, owners({ [first.id]: 2, [far.id]: 2, [neighbour.id]: 0 }));
      expect(realms.map((r) => r.seat)).toEqual([0, 2]);
      const torn = realms[1];
      expect(torn?.regions).toEqual([first.id, far.id].sort((x, y) => x - y));
      expect(new Set(keysOf(torn?.d ?? ''))).toEqual(
        new Set([...edgeKeys(first.id), ...edgeKeys(far.id)]),
      );
    });

    it('zeichnet nichts, solange niemandem ein Feld gehört', () => {
      expect(frontiers(art, owners({}))).toEqual([]);
    });
  });

  it('kennt für jede Region eine Landschaft, auch für neue Namen', () => {
    for (const region of WENDELMARK.regions) expect(TERRAINS).toContain(terrainOf(region.name));
    expect(terrainOf('Buchenwald')).toBe('forest');
    expect(terrainOf('Schwarzmoor')).toBe('marsh');
    expect(terrainOf('Irgendwo')).toBe('village');
  });
});
