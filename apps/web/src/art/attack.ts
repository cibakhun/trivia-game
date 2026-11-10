import { hexDistance, type MatchMap } from '@rdw/game-core';
import type { MapArt } from './map-art.ts';

/**
 * Angriffspfeil eines Duells (nur Darstellung, docs/ART_DIRECTION.md §4): Er läuft aus einer
 * Region des Angreifers, die an das Ziel grenzt, in die umkämpfte Region. Die Regeln sagen nicht,
 * von wo angegriffen wird; das Bild nimmt die angrenzende Region, die der Hauptstadt des
 * Angreifers am nächsten liegt („aus dem Kern des Reichs“), bei Gleichstand die kleinere ID.
 */

export interface AttackOwners {
  /** Besitzer je Region (Index = Region), `null` = frei. */
  readonly owner: readonly (number | null)[];
  /** Region der Hauptstadt des Angreifers, falls vorhanden. */
  readonly capital: number | null;
}

export function attackSource(
  map: MatchMap,
  { owner, capital }: AttackOwners,
  attacker: number,
  target: number,
): number | null {
  const neighbours = map.adjacency[target] ?? [];
  const own = neighbours.filter((n) => owner[n] === attacker);
  if (own.length === 0) return null;
  const home = capital === null ? null : map.regions[capital]?.cell;
  const score = (n: number) => {
    const cell = map.regions[n]?.cell;
    return home && cell ? hexDistance(home, cell) : 0;
  };
  return [...own].sort((a, b) => score(a) - score(b) || a - b)[0] ?? null;
}

export interface ArrowShape {
  /** Schaft als leicht gebogene Linie. */
  readonly d: string;
  /** Pfeilspitze als Dreieck. */
  readonly head: string;
  /** Mitte des Schafts, ungefähr auf der gemeinsamen Grenze: Platz für das Duellsiegel. */
  readonly mid: { readonly x: number; readonly y: number };
  /** Spitze des Pfeils (in der umkämpften Region). */
  readonly tip: { readonly x: number; readonly y: number };
  /** Beginn des Schafts (in der Region des Angreifers). */
  readonly tail: { readonly x: number; readonly y: number };
}

/** Rechteck, das der Pfeil nicht überdecken soll (Name, Münze, Wappen, Burg). */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Größen von Siegel und Pfeil relativ zur Sechseckgröße; schmal etwas kräftiger. */
export function arrowScale(narrow: boolean): number {
  return narrow ? 1.25 : 1;
}

/**
 * Was RegionArt (match/MatchBoard.tsx) in einer Region zeichnet, als grobe Rechtecke: Name,
 * Münze, Besitzerwappen, Burg und Leben. Muss zu den Maßen dort passen; die Breite des Namens
 * wird aus der Zeichenzahl geschätzt.
 */
export function regionMarks(
  region: { readonly name: string; readonly cx: number; readonly cy: number },
  size: number,
  { owned, capital, narrow }: { owned: boolean; capital: boolean; narrow: boolean },
): Box[] {
  const { cx, cy } = region;
  const s = size;
  const font = narrow ? 17 : 13;
  const nameY = (capital ? cy - 0.47 * s : cy - 0.06 * s) - (narrow ? 3 : 0);
  const half = (region.name.length * font * 0.56) / 2 + 2;
  const box = (x: number, y: number, hx: number, hy: number): Box => ({
    x0: x - hx,
    y0: y - hy,
    x1: x + hx,
    y1: y + hy,
  });
  const k = narrow ? 1.25 : 1;
  const coinX = owned ? cx + 0.13 * s : cx;
  const coinY = (capital ? cy + 0.08 * s : cy + 0.3 * s) + (narrow ? 2 : 0);
  const marks = [
    box(cx, nameY, half, font * 0.5 + 2),
    box(coinX, coinY, 0.2 * k * s + 1, 0.2 * k * s + 1),
  ];
  if (owned) marks.push(box(cx - 0.2 * s, coinY, 0.135 * k * s, 0.135 * k * s));
  if (capital) {
    marks.push(box(cx - 0.12 * s, cy + 0.02 * s, 0.25 * s, 0.27 * s));
    marks.push(box(cx, cy + 0.5 * s, 0.35 * s, 0.11 * s));
  }
  return marks;
}

const round = (n: number) => Math.round(n * 10) / 10;

function inside(p: Pt, polygon: readonly Pt[]): boolean {
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

function hits(p: Pt, r: number, box: Box): boolean {
  const dx = Math.max(box.x0 - p.x, 0, p.x - box.x1);
  const dy = Math.max(box.y0 - p.y, 0, p.y - box.y1);
  return dx * dx + dy * dy < r * r;
}

/** Punkt auf der quadratischen Kurve. */
function at(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

/**
 * Form des Pfeils über die gemeinsame Grenze zweier Regionen. Probiert Lagen entlang und quer
 * zur Verbindung der Mittelpunkte (zuerst mittig, dann eher oberhalb) und nimmt die erste, bei der
 * Siegel, Schaft und Spitze nichts aus `marks` überdecken, der Schaft in der Region des
 * Angreifers beginnt und die Spitze in der umkämpften Region liegt. Passt keine, gewinnt die Lage
 * mit den wenigsten Überschneidungen.
 */
export function attackArrow(
  art: MapArt,
  from: number,
  to: number,
  marks: readonly Box[] = [],
  scale = 1,
): ArrowShape | null {
  const a = art.regions[from];
  const b = art.regions[to];
  if (!a || !b) return null;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const s = art.size;
  const u = { x: dx / length, y: dy / length };
  // Quer zur Verbindung, nach oben zeigend: Über den Namen ist meist Platz
  const n = -u.x <= 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
  const m = { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 };
  const bend = 0.08 * s;
  const sealR = 0.18 * s * scale + 2;
  const headLength = 0.2 * s * scale;
  const headWidth = 0.13 * s * scale;
  const ink = 4.5 * scale;

  let best: { cost: number; shape: ArrowShape } | null = null;
  // Zuerst volle Länge; ein kürzerer Pfeil nur, wenn der lange überall etwas verdeckt
  const lengths = [0.5 * s, 0.4 * s];
  for (const [index, half] of lengths.entries()) {
    for (const side of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6]) {
      for (const along of [0, 0.1, -0.1]) {
        const c = {
          x: m.x + u.x * along * s + n.x * side * s,
          y: m.y + u.y * along * s + n.y * side * s,
        };
        const p0 = { x: c.x - u.x * half, y: c.y - u.y * half };
        const p2 = { x: c.x + u.x * half, y: c.y + u.y * half };
        const p1 = { x: c.x + n.x * 2 * bend, y: c.y + n.y * 2 * bend };
        if (!inside(p0, a.outline) || !inside(p2, b.outline)) continue;
        const mid = at(p0, p1, p2, 0.5);
        const tx = p2.x - p1.x;
        const ty = p2.y - p1.y;
        const tl = Math.hypot(tx, ty) || 1;
        const h = { x: tx / tl, y: ty / tl };
        const base = { x: p2.x - h.x * headLength, y: p2.y - h.y * headLength };
        const left = { x: base.x - h.y * headWidth, y: base.y + h.x * headWidth };
        const right = { x: base.x + h.y * headWidth, y: base.y - h.x * headWidth };
        const probes: [Pt, number, number][] = [
          [mid, sealR, 3],
          [left, 1.5, 1],
          [right, 1.5, 1],
        ];
        for (let i = 0; i <= 10; i++) probes.push([at(p0, p1, p2, i / 10), ink, 1]);
        let cost = 0;
        for (const [p, r, weight] of probes) {
          if (!inside(p, a.outline) && !inside(p, b.outline)) cost += weight;
          for (const box of marks) if (hits(p, r, box)) cost += weight;
        }
        // Kleine Vorliebe für die Mitte, falls alles überdeckt
        cost += Math.abs(side) * 0.5 + Math.abs(along) + index * 0.5;
        if (best && best.cost <= cost) continue;
        // Schaft endet am Fuß der Spitze, damit die runde Kappe nicht hervorsteht
        const end = base;
        const control = { x: p1.x - h.x * headLength * 0.5, y: p1.y - h.y * headLength * 0.5 };
        best = {
          cost,
          shape: {
            d: `M${round(p0.x)} ${round(p0.y)}Q${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}`,
            head: `M${round(p2.x)} ${round(p2.y)}L${round(left.x)} ${round(left.y)}L${round(right.x)} ${round(right.y)}Z`,
            mid: { x: round(mid.x), y: round(mid.y) },
            tip: { x: round(p2.x), y: round(p2.y) },
            tail: { x: round(p0.x), y: round(p0.y) },
          },
        };
        if (cost < 0.01) return best.shape;
      }
    }
  }
  return best?.shape ?? null;
}
