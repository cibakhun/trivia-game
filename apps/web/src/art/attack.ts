import { hexDistance, type MatchMap } from '@rdw/game-core';
import type { MapArt } from './map-art.ts';

/**
 * Aufstellung eines Duells auf der Karte (nur Darstellung, docs/ART_DIRECTION.md §4): Der
 * Angreifer steht in einer seiner Regionen, die an das Ziel grenzt, und zieht über die gemeinsame
 * Grenze. Die Regeln sagen nicht, von wo angegriffen wird; das Bild nimmt die angrenzende Region,
 * die der Hauptstadt des Angreifers am nächsten liegt („aus dem Kern des Reichs“), bei Gleichstand
 * die kleinere ID.
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

interface Pt {
  readonly x: number;
  readonly y: number;
}

/**
 * Aufstellung eines Duells: Die Wappen von Angreifer und Verteidiger stehen in der Mitte ihrer
 * Regionen (dort, wo sonst Name und Münze stehen), ein Blockpfeil läuft vom einen zum anderen über
 * die gemeinsame Grenze.
 */
export interface DuelLayout {
  /** Mittelpunkte der Region des Angreifers und der umkämpften Region: Plätze der Wappen. */
  readonly source: Pt;
  readonly target: Pt;
  /** Richtung des Angriffs als Einheitsvektor und Abstand der Mittelpunkte. */
  readonly dir: Pt;
  readonly distance: number;
  /** Radius eines Wappenplättchens. */
  readonly radius: number;
  /** Blockpfeil zwischen den Plättchen, zeigt auf den Verteidiger. */
  readonly arrow: string;
  /** Länge, auf die sich Stöße der Animation beziehen (Sechseckgröße mal Maßstab). */
  readonly unit: number;
}

/** Wappen und Pfeil relativ zur Sechseckgröße; auf schmalen Bildschirmen etwas größer. */
export function duelScale(narrow: boolean): number {
  return narrow ? 1.25 : 1;
}

/**
 * Steht eine der Regionen in der oberen Hälfte der Karte? Dann weicht ein Band über der Karte
 * („Runde 2 von 4“, „Ein Reich fällt!“) an den unteren Rand, damit es das Duell nicht verdeckt
 * (styles.css, `.turn-banner`). Gemessen an den Mittelpunkten der obersten und untersten Region.
 */
export function inUpperHalf(art: MapArt, regions: readonly (number | null)[]): boolean {
  const ys = art.regions.map((r) => r.cy);
  const top = Math.min(...ys);
  const span = Math.max(...ys) - top;
  if (!(span > 0)) return false;
  return regions.some((id) => {
    const region = id === null ? undefined : art.regions[id];
    return region !== undefined && (region.cy - top) / span < 0.45;
  });
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * `castle`: Das Ziel ist eine Hauptstadt. Dort steht kein Wappen, sondern die Burg; der Pfeil
 * endet schon kurz hinter der Grenze, damit er Burg und Leben nicht verdeckt.
 */
export function duelLayout(
  art: MapArt,
  from: number,
  to: number,
  { scale = 1, castle = false }: { readonly scale?: number; readonly castle?: boolean } = {},
): DuelLayout | null {
  const a = art.regions[from];
  const b = art.regions[to];
  if (!a || !b) return null;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return null;
  const unit = art.size * scale;
  const u = { x: dx / distance, y: dy / distance };
  const n = { x: -u.y, y: u.x };
  const radius = 0.32 * unit;
  // Der Pfeil beginnt knapp hinter dem Plättchen des Angreifers und endet vor dem des Verteidigers
  const start = radius + 0.06 * unit;
  const tip = distance - (castle ? 0.72 * art.size : radius + 0.08 * unit);
  const neck = tip - 0.26 * unit;
  const at = (along: number, side: number) =>
    `${round(a.cx + u.x * along + n.x * side)} ${round(a.cy + u.y * along + n.y * side)}`;
  const tail = 0.045 * unit;
  const shaft = 0.075 * unit;
  const wing = 0.19 * unit;
  const arrow =
    `M${at(start, tail)}L${at(neck, shaft)}L${at(neck, wing)}L${at(tip, 0)}` +
    `L${at(neck, -wing)}L${at(neck, -shaft)}L${at(start, -tail)}Z`;
  return {
    source: { x: a.cx, y: a.cy },
    target: { x: b.cx, y: b.cy },
    dir: u,
    distance: round(distance),
    radius: round(radius),
    arrow,
    unit,
  };
}
