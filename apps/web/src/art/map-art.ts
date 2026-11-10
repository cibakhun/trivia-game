import type { MatchMap } from '@rdw/game-core';
import { axialToPixel, hexCorners, type Point } from '../map/layout.ts';
import { seeded } from './noise.ts';
import { terrainOf, type Terrain } from './terrain.ts';

/**
 * Gezeichnete Landkarte einer Partie (Stil „Alte Landkarte“, docs/ART_DIRECTION.md): Aus dem
 * Sechseckraster der Regeln werden natürlich wirkende Grenzen. Jede Ecke wird leicht verschoben,
 * jede Kante zur Zickzacklinie aufgebrochen; Nachbarn teilen sich exakt dieselbe Linie, deshalb
 * bleibt die Nachbarschaft genau die der Regeln (game-core). Die Küste wird stärker aufgebrochen
 * und nach außen gewölbt. Alles ist deterministisch: gleiche Karte, gleiches Bild.
 */

export const ART_HEX_SIZE = 60;

/** Kleine Motive auf der Karte (gezeichnet in art/ArtDefs.tsx). */
export type GlyphKind =
  | 'tree'
  | 'pine'
  | 'mountain'
  | 'hill'
  | 'wheat'
  | 'grass'
  | 'reeds'
  | 'lake'
  | 'house'
  | 'tower'
  | 'waves';

export interface Decor {
  readonly kind: GlyphKind;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly flip: boolean;
  /** `top` über dem Namen (entfällt bei Hauptstädten), `side` an den unteren Ecken. */
  readonly slot: 'top' | 'side';
}

export interface ArtRegion {
  readonly id: number;
  readonly name: string;
  /** Umriss als geschlossener SVG-Pfad. */
  readonly d: string;
  /** Derselbe Umriss als Punkte (für Treffertests wie beim Angriffspfeil). */
  readonly outline: readonly Point[];
  /** Mittelpunkt des Feldes, Anker für Name, Wert und Burg. */
  readonly cx: number;
  readonly cy: number;
  readonly terrain: Terrain;
  readonly decor: readonly Decor[];
}

export interface SeaMark {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export interface MapArt {
  readonly width: number;
  readonly height: number;
  readonly viewBox: string;
  /** Enger Ausschnitt nur um die Insel, für schmale Bildschirme (ohne Titel und Kompass). */
  readonly tightViewBox: string;
  /** Sechseckgröße, auf die sich Schriften und Motive beziehen. */
  readonly size: number;
  readonly regions: readonly ArtRegion[];
  /** Küstenlinie als geschlossener Pfad um alle Regionen. */
  readonly coast: string;
  /** Fluss entlang innerer Grenzen, von Küste zu Küste; `null`, wenn keiner passt. */
  readonly river: string | null;
  readonly waves: readonly SeaMark[];
  readonly compass: { readonly x: number; readonly y: number; readonly r: number };
  readonly title: { readonly x: number; readonly y: number; readonly width: number };
}

interface Vertex {
  readonly key: string;
  readonly base: Point;
  /** Anzahl Regionen an dieser Ecke (1–3). */
  regions: number;
  coast: boolean;
  pos: Point;
}

interface Edge {
  readonly key: string;
  readonly a: string;
  readonly b: string;
  readonly regions: number[];
  points: Point[];
}

const r2 = (value: number) => Math.round(value * 100) / 100;
const keyOf = (p: Point) => `${Math.round(p.x)}:${Math.round(p.y)}`;

/** Zickzacklinie von `a` nach `b` (Mittelpunktverschiebung), mit beiden Endpunkten. */
function wobble(a: Point, b: Point, rand: () => number, roughness: number, depth: number): Point[] {
  if (depth === 0) return [a, b];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const offset = (rand() - 0.5) * 2 * roughness * length;
  const mid = {
    x: (a.x + b.x) / 2 - (dy / length) * offset,
    y: (a.y + b.y) / 2 + (dx / length) * offset,
  };
  const left = wobble(a, mid, rand, roughness, depth - 1);
  const right = wobble(mid, b, rand, roughness, depth - 1);
  return [...left, ...right.slice(1)];
}

function pathOf(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r2(p.x)} ${r2(p.y)}`).join('') + 'Z';
}

/** Weiche Küstenwölbung je Richtung: große Buchten und Landzungen statt Sägezahn. */
function coastSwell(angle: number, rand: () => number): number {
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const p3 = rand() * Math.PI * 2;
  return (
    0.5 +
    0.28 * Math.sin(2 * angle + p1) +
    0.16 * Math.sin(3 * angle + p2) +
    0.08 * Math.sin(7 * angle + p3)
  );
}

const DECOR: Readonly<Record<Terrain, { top: readonly GlyphKind[]; side: readonly GlyphKind[] }>> =
  {
    forest: { top: ['tree', 'tree', 'tree'], side: ['tree', 'tree'] },
    pines: { top: ['pine', 'pine', 'pine'], side: ['pine', 'pine'] },
    mountains: { top: ['mountain', 'mountain'], side: ['mountain'] },
    hills: { top: ['hill', 'tower', 'hill'], side: ['hill'] },
    fields: { top: ['wheat', 'house', 'wheat'], side: ['wheat', 'grass'] },
    meadow: { top: ['grass', 'tree', 'grass'], side: ['grass', 'grass'] },
    marsh: { top: ['reeds', 'reeds', 'reeds'], side: ['reeds', 'grass'] },
    lake: { top: ['lake'], side: ['reeds', 'reeds'] },
    river: { top: ['house', 'waves', 'house'], side: ['grass', 'tree'] },
    village: { top: ['house', 'tower', 'house'], side: ['tree', 'grass'] },
  };

/** Grundgröße je Motiv relativ zur Sechseckgröße. */
const GLYPH_SCALE: Readonly<Record<GlyphKind, number>> = {
  tree: 0.3,
  pine: 0.32,
  mountain: 0.42,
  hill: 0.36,
  wheat: 0.3,
  grass: 0.22,
  reeds: 0.26,
  lake: 0.62,
  house: 0.24,
  tower: 0.3,
  waves: 0.3,
};

function decorFor(name: string, terrain: Terrain, cx: number, cy: number, size: number): Decor[] {
  const rand = seeded(`decor:${name}`);
  const plan = DECOR[terrain];
  const out: Decor[] = [];
  const jitter = () => (rand() - 0.5) * 0.08 * size;
  const topY = cy - 0.5 * size;
  const spread = 0.3 * size;
  plan.top.forEach((kind, i) => {
    const offset = (i - (plan.top.length - 1) / 2) * spread;
    // die mittlere Figur etwas größer und höher, das wirkt wie eine kleine Szene
    const middle = plan.top.length === 3 && i === 1;
    const scale = GLYPH_SCALE[kind] * (middle ? 1.15 : 0.95 + rand() * 0.1);
    out.push({
      kind,
      x: cx + offset + jitter(),
      y: topY + (middle ? -0.04 * size : 0.02 * size) + jitter(),
      size: scale * size,
      flip: rand() < 0.5,
      slot: 'top',
    });
  });
  const sides = [-1, 1] as const;
  plan.side.forEach((kind, i) => {
    const side = sides[i % 2] ?? 1;
    out.push({
      kind,
      x: cx + side * 0.5 * size + jitter(),
      y: cy + 0.4 * size + jitter(),
      size: GLYPH_SCALE[kind] * size * (0.8 + rand() * 0.15),
      flip: rand() < 0.5,
      slot: 'side',
    });
  });
  return out;
}

/** Kürzester Weg durch innere Ecken (Breitensuche), nur entlang innerer Grenzen. */
function riverPath(
  vertices: ReadonlyMap<string, Vertex>,
  edges: readonly Edge[],
  centre: Point,
): Point[] | null {
  const inner = edges.filter((e) => e.regions.length === 2);
  const next = new Map<string, Edge[]>();
  for (const edge of inner) {
    for (const end of [edge.a, edge.b]) next.set(end, [...(next.get(end) ?? []), edge]);
  }
  // Quelle: Küstenecke mit innerer Grenze ganz oben, Mündung: ganz unten
  const mouths = [...vertices.values()].filter((v) => v.coast && next.has(v.key));
  if (mouths.length < 2) return null;
  // nahe der Mittelachse: der Fluss schlängelt sich entlang der Grenzen nach unten
  const score = (v: Vertex, sign: number) => sign * v.base.y + 0.6 * Math.abs(v.base.x - centre.x);
  const top = mouths.reduce((best, v) => (score(v, 1) < score(best, 1) ? v : best));
  const bottom = mouths.reduce((best, v) => (score(v, -1) < score(best, -1) ? v : best));
  // Breitensuche, bei gleicher Länge der Weg näher an der Mitte (sieht nach Tal aus)
  const previous = new Map<string, { from: string; edge: Edge }>();
  const seen = new Set([top.key]);
  let frontier = [top.key];
  while (frontier.length > 0 && !seen.has(bottom.key)) {
    const following: string[] = [];
    for (const key of frontier) {
      const options = [...(next.get(key) ?? [])].sort((e1, e2) => {
        const o1 = vertices.get(e1.a === key ? e1.b : e1.a);
        const o2 = vertices.get(e2.a === key ? e2.b : e2.a);
        const d1 = o1 ? Math.abs(o1.base.x - centre.x) : 0;
        const d2 = o2 ? Math.abs(o2.base.x - centre.x) : 0;
        return d1 - d2;
      });
      for (const edge of options) {
        const other = edge.a === key ? edge.b : edge.a;
        const vertex = vertices.get(other);
        if (seen.has(other) || !vertex) continue;
        // keine Abkürzung über die Küste: nur der Endpunkt darf an der Küste liegen
        if (vertex.coast && other !== bottom.key) continue;
        seen.add(other);
        previous.set(other, { from: key, edge });
        following.push(other);
      }
    }
    frontier = following;
  }
  if (!seen.has(bottom.key)) return null;
  const chain: Point[] = [];
  let at = bottom.key;
  while (at !== top.key) {
    const step = previous.get(at);
    if (!step) return null;
    const points = step.edge.a === step.from ? step.edge.points : [...step.edge.points].reverse();
    chain.unshift(...(chain.length === 0 ? points : points.slice(0, -1)));
    at = step.from;
  }
  return chain;
}

export function mapArt(map: MatchMap, size = ART_HEX_SIZE): MapArt {
  const centres = map.regions.map((region) => axialToPixel(region.cell, size));
  const islandCentre = {
    x: centres.reduce((s, c) => s + c.x, 0) / centres.length,
    y: centres.reduce((s, c) => s + c.y, 0) / centres.length,
  };

  // Ecken und Kanten des Rasters sammeln
  const vertices = new Map<string, Vertex>();
  const edgeMap = new Map<string, Edge>();
  const cornerKeys = centres.map((centre, regionId) => {
    const corners = hexCorners(centre, size);
    const keys = corners.map((corner) => {
      const key = keyOf(corner);
      const vertex = vertices.get(key);
      if (vertex) vertex.regions += 1;
      else vertices.set(key, { key, base: corner, regions: 1, coast: false, pos: corner });
      return key;
    });
    keys.forEach((a, i) => {
      const b = keys[(i + 1) % 6] ?? a;
      const [k1, k2] = a < b ? [a, b] : [b, a];
      const key = `${k1}|${k2}`;
      const edge = edgeMap.get(key);
      if (edge) edge.regions.push(regionId);
      else edgeMap.set(key, { key, a: k1, b: k2, regions: [regionId], points: [] });
    });
    return keys;
  });
  const edges = [...edgeMap.values()];
  for (const edge of edges) {
    if (edge.regions.length !== 1) continue;
    for (const end of [edge.a, edge.b]) {
      const vertex = vertices.get(end);
      if (vertex) vertex.coast = true;
    }
  }

  // Ecken verschieben: innen leicht, an der Küste nach außen gewölbt
  const swellRand = seeded(`coast:${map.id}`);
  const swellPhases = [swellRand(), swellRand(), swellRand()];
  const swellAt = (angle: number) => {
    let i = 0;
    return coastSwell(angle, () => swellPhases[i++ % 3] ?? 0);
  };
  for (const vertex of vertices.values()) {
    const rand = seeded(`v:${map.id}:${vertex.key}`);
    const jitter = (vertex.coast ? 0.1 : 0.16) * size;
    let x = vertex.base.x + (rand() - 0.5) * 2 * jitter;
    let y = vertex.base.y + (rand() - 0.5) * 2 * jitter;
    if (vertex.coast) {
      const dx = vertex.base.x - islandCentre.x;
      const dy = vertex.base.y - islandCentre.y;
      const length = Math.hypot(dx, dy) || 1;
      // eingebuchtete Ecken (zwei Regionen) weiter hinaus, das glättet den Sägezahn
      const push =
        size * (0.12 + 0.42 * swellAt(Math.atan2(dy, dx)) + (vertex.regions >= 2 ? 0.38 : 0));
      x += (dx / length) * push;
      y += (dy / length) * push;
    }
    vertex.pos = { x, y };
  }

  // Kanten aufbrechen, je Kante einmal; beide Nachbarn lesen dieselben Punkte
  for (const edge of edges) {
    const a = vertices.get(edge.a)?.pos;
    const b = vertices.get(edge.b)?.pos;
    if (!a || !b) continue;
    const coast = edge.regions.length === 1;
    edge.points = wobble(
      a,
      b,
      seeded(`e:${map.id}:${edge.key}`),
      coast ? 0.22 : 0.15,
      coast ? 4 : 3,
    );
  }

  const regions = map.regions.map((region, id) => {
    const keys = cornerKeys[id] ?? [];
    const outline: Point[] = [];
    keys.forEach((a, i) => {
      const b = keys[(i + 1) % 6] ?? a;
      const edge = edgeMap.get(a < b ? `${a}|${b}` : `${b}|${a}`);
      if (!edge) return;
      const points = edge.a === a ? edge.points : [...edge.points].reverse();
      outline.push(...points.slice(0, -1));
    });
    const centre = centres[id] ?? { x: 0, y: 0 };
    const terrain = terrainOf(region.name);
    return {
      id,
      name: region.name,
      outline,
      cx: centre.x,
      cy: centre.y,
      terrain,
      decor: decorFor(region.name, terrain, centre.x, centre.y, size),
    };
  });

  // Küste als ein Ring: Küstenkanten aneinanderhängen
  const coastEdges = edges.filter((e) => e.regions.length === 1);
  const byEnd = new Map<string, Edge[]>();
  for (const edge of coastEdges) {
    for (const end of [edge.a, edge.b]) byEnd.set(end, [...(byEnd.get(end) ?? []), edge]);
  }
  const coastPoints: Point[] = [];
  const first = coastEdges[0];
  if (first) {
    const used = new Set<string>();
    let edge: Edge | undefined = first;
    let at = first.a;
    while (edge && !used.has(edge.key)) {
      used.add(edge.key);
      const points: Point[] = edge.a === at ? edge.points : [...edge.points].reverse();
      coastPoints.push(...points.slice(0, -1));
      at = edge.a === at ? edge.b : edge.a;
      edge = (byEnd.get(at) ?? []).find((e) => !used.has(e.key));
    }
  }

  const river = riverPath(vertices, edges, islandCentre);

  // Bildausschnitt: Land plus Meeresrand, Platz für Titel und Kompass
  const all = coastPoints.length > 0 ? coastPoints : [...vertices.values()].map((v) => v.pos);
  const margin = 0.75 * size;
  const minX = Math.min(...all.map((p) => p.x)) - margin;
  const maxX = Math.max(...all.map((p) => p.x)) + margin;
  const minY = Math.min(...all.map((p) => p.y)) - margin - 0.35 * size;
  const maxY = Math.max(...all.map((p) => p.y)) + margin;
  const width = maxX - minX;
  const height = maxY - minY;
  const shift = (p: Point): Point => ({ x: p.x - minX, y: p.y - minY });

  const shiftPath = (points: readonly Point[]) => pathOf(points.map(shift));
  const shifted: ArtRegion[] = regions.map(({ outline, ...region }) => {
    const centre = shift({ x: region.cx, y: region.cy });
    const points = outline.map((p) => {
      const q = shift(p);
      return { x: r2(q.x), y: r2(q.y) };
    });
    return {
      ...region,
      d: pathOf(points),
      outline: points,
      cx: r2(centre.x),
      cy: r2(centre.y),
      decor: region.decor.map((decor) => {
        const p = shift(decor);
        return { ...decor, x: r2(p.x), y: r2(p.y), size: r2(decor.size) };
      }),
    };
  });

  const titleWidth = 2.9 * size;
  const title = { x: r2(0.22 * size), y: r2(0.2 * size), width: r2(titleWidth) };
  const compass = { x: r2(width - 0.85 * size), y: r2(height - 0.85 * size), r: r2(0.55 * size) };

  // Wellen im freien Meer, nicht unter Titel und Kompass
  const waveRand = seeded(`waves:${map.id}`);
  const landPoints = all.map(shift);
  const waves: SeaMark[] = [];
  const step = 0.85 * size;
  for (let y = step / 2; y < height; y += step) {
    for (let x = step / 2; x < width; x += step) {
      const px = x + (waveRand() - 0.5) * step * 0.7;
      const py = y + (waveRand() - 0.5) * step * 0.5;
      const nearLand = landPoints.some((p) => Math.hypot(p.x - px, p.y - py) < 0.42 * size);
      const inTitle = px < title.x + titleWidth + 0.2 * size && py < title.y + 0.9 * size;
      const inCompass = Math.hypot(px - compass.x, py - compass.y) < compass.r * 1.5;
      const insideLand = pointInPolygon({ x: px, y: py }, landPoints);
      if (nearLand || inTitle || inCompass || insideLand || waveRand() < 0.35) continue;
      waves.push({ x: r2(px), y: r2(py), size: r2(size * (0.22 + waveRand() * 0.1)) });
    }
  }

  const tight = 0.12 * size;
  const tx = Math.min(...landPoints.map((p) => p.x)) - tight;
  const ty = Math.min(...landPoints.map((p) => p.y)) - tight;
  const tw = Math.max(...landPoints.map((p) => p.x)) + tight - tx;
  const th = Math.max(...landPoints.map((p) => p.y)) + tight - ty;

  return {
    width: r2(width),
    height: r2(height),
    viewBox: `0 0 ${r2(width)} ${r2(height)}`,
    tightViewBox: `${r2(tx)} ${r2(ty)} ${r2(tw)} ${r2(th)}`,
    size,
    regions: shifted,
    coast: shiftPath(coastPoints),
    river: river
      ? river
          .map(shift)
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${r2(p.x)} ${r2(p.y)}`)
          .join('')
      : null,
    waves,
    compass,
    title,
  };
}

/** Punkt im Polygon (gerade Anzahl Schnitte = außen). */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) continue;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}
