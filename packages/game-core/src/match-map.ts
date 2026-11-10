import type { MatchMapId } from '@rdw/protocol';
import { areNeighbors, hexDistance, type Axial } from './hex.ts';

/**
 * Feste Karten der rundenbasierten Partie (docs/MATCH_RULES.md §2). Jede Region ist ein Hexfeld
 * (axial, pointy-top wie in hex.ts); benachbart sind Regionen, deren Felder sich berühren. Namen
 * und Form sind eigene Erfindungen.
 */

export interface MatchMapRegion {
  /** Index in `regions`, zugleich die ID in Zustand und Protokoll. */
  readonly id: number;
  readonly name: string;
  readonly cell: Axial;
}

export interface MatchMap {
  readonly id: MatchMapId;
  readonly name: string;
  readonly regions: readonly MatchMapRegion[];
  /** Nachbarn je Region, aufsteigend sortiert. */
  readonly adjacency: readonly (readonly number[])[];
}

/**
 * Wendelmark: 24 Felder in fünf Reihen (4, 5, 6, 5, 4), symmetrisch zur Mitte. Drei Hauptstädte
 * plus 21 Regionen ergeben bei 2 + 1 Wahlen je Landnahmerunde genau sieben Runden.
 */
const WENDELMARK_ROWS: readonly {
  readonly r: number;
  readonly qFrom: number;
  readonly names: readonly string[];
}[] = [
  { r: -2, qFrom: -1, names: ['Eschenhain', 'Falkenwacht', 'Graufurt', 'Hirschgrund'] },
  { r: -1, qFrom: -2, names: ['Ackerbrunn', 'Birkental', 'Dornfeld', 'Eisenhang', 'Fuchsmoor'] },
  {
    r: 0,
    qFrom: -3,
    names: ['Goldwiese', 'Hagelstein', 'Immenau', 'Kranichsee', 'Lindenhof', 'Mühlbach'],
  },
  { r: 1, qFrom: -3, names: ['Nebelsenke', 'Otterbruch', 'Quellheim', 'Rabenfels', 'Salzweide'] },
  { r: 2, qFrom: -3, names: ['Tannenruh', 'Uferland', 'Wolfsklamm', 'Zinnberg'] },
];

function buildMap(
  id: MatchMapId,
  name: string,
  cells: readonly Omit<MatchMapRegion, 'id'>[],
): MatchMap {
  const regions = cells.map((cell, index) => Object.freeze({ id: index, ...cell }));
  const adjacency = regions.map((region) =>
    Object.freeze(
      regions.filter((other) => areNeighbors(region.cell, other.cell)).map((other) => other.id),
    ),
  );
  return Object.freeze({
    id,
    name,
    regions: Object.freeze(regions),
    adjacency: Object.freeze(adjacency),
  });
}

export const WENDELMARK: MatchMap = buildMap(
  'WENDELMARK',
  'Wendelmark',
  WENDELMARK_ROWS.flatMap(({ r, qFrom, names }) =>
    names.map((regionName, i) => ({ name: regionName, cell: { q: qFrom + i, r } })),
  ),
);

const MAPS: Readonly<Record<MatchMapId, MatchMap>> = Object.freeze({ WENDELMARK });

export function matchMap(id: MatchMapId): MatchMap {
  return MAPS[id];
}

/** Abstand zweier Regionen in Feldern. */
export function regionDistance(map: MatchMap, a: number, b: number): number {
  const ra = map.regions[a];
  const rb = map.regions[b];
  if (!ra || !rb) throw new RangeError(`Unbekannte Region ${ra ? b : a}`);
  return hexDistance(ra.cell, rb.cell);
}

export function regionNeighbors(map: MatchMap, region: number): readonly number[] {
  const list = map.adjacency[region];
  if (!list) throw new RangeError(`Unbekannte Region ${region}`);
  return list;
}
