import { WENDELMARK } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import {
  INK_POINTS,
  INK_STOPS,
  inkBlob,
  inkBox,
  inkOrigin,
  inkReach,
  inkStyle,
  type InkPoint,
} from '../src/art/ink.ts';
import { mapArt } from '../src/art/map-art.ts';

/** Nasse Tinte (ART_DIRECTION §5): Klecks je Region als Schlüsselbilder für `clip-path`. */

const points = (list: string): InkPoint[] =>
  list.split(',').map((pair) => {
    const [x, y] = pair.trim().split(' ');
    return { x: Number.parseFloat(x!), y: Number.parseFloat(y!) };
  });

function inside(p: InkPoint, polygon: readonly InkPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

const art = mapArt(WENDELMARK);

describe('inkBlob', () => {
  const origin = { x: 20, y: 35 };
  const blob = inkBlob('WENDELMARK:12', origin, inkReach(origin));

  it('hat je Schlüsselbild gleich viele Punkte, geschlossen: So überblendet auch WebKit', () => {
    expect(blob.edge).toHaveLength(INK_STOPS.length);
    expect(blob.wet).toHaveLength(INK_STOPS.length);
    for (const list of [...blob.edge, ...blob.wet]) {
      const ps = points(list);
      expect(ps).toHaveLength(INK_POINTS + 1);
      expect(ps[0]).toEqual(ps[ps.length - 1]);
      expect(list).toMatch(/^(-?\d+(\.\d)?% -?\d+(\.\d)?%,)+-?\d+(\.\d)?% -?\d+(\.\d)?%$/);
    }
  });

  it('würfelt aus dem Schlüssel: gleiche Region, gleiche Form', () => {
    expect(inkBlob('WENDELMARK:12', origin, 90)).toEqual(inkBlob('WENDELMARK:12', origin, 90));
    expect(inkBlob('WENDELMARK:12', origin, 90).edge[2]).not.toEqual(
      inkBlob('WENDELMARK:13', origin, 90).edge[2],
    );
  });

  it('wächst auf jedem Strahl nur nach außen, die nasse Kante liegt innen', () => {
    const dist = (p: InkPoint) => Math.hypot(p.x - origin.x, p.y - origin.y);
    const edges = blob.edge.map(points);
    const wets = blob.wet.map(points);
    for (let k = 1; k < edges.length; k++) {
      for (let i = 0; i < INK_POINTS; i++) {
        // Auf eine Stelle gerundet: kleine Rundungsfehler zulassen
        expect(dist(edges[k]![i]!)).toBeGreaterThanOrEqual(dist(edges[k - 1]![i]!) - 0.15);
        expect(dist(wets[k]![i]!)).toBeLessThanOrEqual(dist(edges[k]![i]!) + 0.15);
      }
    }
    // Der erste Klecks ist klein, der Rand franst aus
    expect(Math.max(...edges[0]!.map(dist))).toBeLessThan(0.15 * inkReach(origin));
    const spread = edges[2]!.map(dist);
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(3);
  });

  it('deckt im letzten Bild den ganzen Rahmen, von jedem Ursprung aus', () => {
    for (const from of [
      { x: 50, y: 50 },
      { x: 0, y: 0 },
      { x: 100, y: 40 },
      { x: 12.5, y: 97 },
    ]) {
      for (const seed of ['a', 'b', 'WENDELMARK:7', 'KERNMARK:3']) {
        const last = points(inkBlob(seed, from, inkReach(from)).edge[INK_STOPS.length - 1]!);
        for (let x = 0; x <= 100; x += 5) {
          for (let y = 0; y <= 100; y += 5) {
            expect(inside({ x, y }, last), `${seed} ${from.x}/${from.y}: ${x}/${y}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('inkOrigin', () => {
  const region = art.regions[12]!;
  const box = inkBox(region.outline);
  const centre = { x: region.cx, y: region.cy };

  it('ohne Herkunft in der Mitte, in Prozent des Rahmens', () => {
    const at = inkOrigin(region.outline, box, centre);
    expect(at.x).toBeCloseTo(((region.cx - box.x) / box.width) * 100, 0);
    expect(at.y).toBeCloseTo(((region.cy - box.y) / box.height) * 100, 0);
  });

  it('mit Herkunft an der Grenze, über die der Sieger kommt', () => {
    for (const from of WENDELMARK.adjacency[12]!) {
      const source = art.regions[from]!;
      const at = inkOrigin(region.outline, box, centre, { x: source.cx, y: source.cy });
      const point = { x: box.x + (at.x / 100) * box.width, y: box.y + (at.y / 100) * box.height };
      // Auf dem Umriss: nah an einer seiner Kanten
      const near = Math.min(
        ...region.outline.map((a, i) => {
          const b = region.outline[(i + 1) % region.outline.length]!;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) /
                ((b.x - a.x) ** 2 + (b.y - a.y) ** 2),
            ),
          );
          return Math.hypot(point.x - a.x - t * (b.x - a.x), point.y - a.y - t * (b.y - a.y));
        }),
      );
      expect(near).toBeLessThan(1);
      // … und auf der Seite des Angreifers
      expect(Math.hypot(point.x - source.cx, point.y - source.cy)).toBeLessThan(
        Math.hypot(region.cx - source.cx, region.cy - source.cy),
      );
    }
  });
});

describe('inkReach und inkStyle', () => {
  it('reicht bis zur weitesten Ecke', () => {
    expect(inkReach({ x: 50, y: 50 })).toBeCloseTo(Math.hypot(50, 50));
    expect(inkReach({ x: 0, y: 0 })).toBeCloseTo(Math.hypot(100, 100));
  });

  it('legt je Schlüsselbild Rand und Innenrand als Variablen ab', () => {
    const style = inkStyle(inkBlob('x', { x: 50, y: 50 }, 71)) as Record<string, string>;
    expect(Object.keys(style).sort()).toEqual(
      INK_STOPS.flatMap((_, k) => [`--ink-${k}`, `--wet-${k}`]).sort(),
    );
  });
});
