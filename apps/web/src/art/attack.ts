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
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Form des Pfeils zwischen zwei Regionsmitten; Beginn und Ende halten Abstand zu den Namen. */
export function attackArrow(art: MapArt, from: number, to: number): ArrowShape | null {
  const a = art.regions[from];
  const b = art.regions[to];
  if (!a || !b) return null;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const ux = dx / length;
  const uy = dy / length;
  // Biegung nach links in Laufrichtung, je nach Länge
  const bend = 0.32 * length;
  const start = { x: a.cx + ux * length * 0.3, y: a.cy + uy * length * 0.3 };
  const end = { x: a.cx + ux * length * 0.78, y: a.cy + uy * length * 0.78 };
  const control = {
    x: (start.x + end.x) / 2 + uy * bend,
    y: (start.y + end.y) / 2 - ux * bend,
  };
  // Punkt bei t = 0,5 auf der quadratischen Kurve und Richtung am Ende
  const mid = {
    x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
  };
  const tx = end.x - control.x;
  const ty = end.y - control.y;
  const tl = Math.hypot(tx, ty) || 1;
  const hx = tx / tl;
  const hy = ty / tl;
  const headLength = 0.2 * art.size;
  const headWidth = 0.15 * art.size;
  const tip = { x: end.x + hx * headLength * 0.6, y: end.y + hy * headLength * 0.6 };
  const base = { x: tip.x - hx * headLength, y: tip.y - hy * headLength };
  const left = { x: base.x - hy * headWidth, y: base.y + hx * headWidth };
  const right = { x: base.x + hy * headWidth, y: base.y - hx * headWidth };
  return {
    d: `M${round(start.x)} ${round(start.y)}Q${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}`,
    head: `M${round(tip.x)} ${round(tip.y)}L${round(left.x)} ${round(left.y)}L${round(right.x)} ${round(right.y)}Z`,
    mid: { x: round(mid.x), y: round(mid.y) },
  };
}
