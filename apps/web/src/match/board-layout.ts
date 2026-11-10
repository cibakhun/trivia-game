import type { MatchMap } from '@rdw/game-core';
import { axialToPixel, hexCorners } from '../map/layout.ts';

/**
 * Bildschirmgeometrie der Partiekarte als SVG: ein Sechseck je Region (pointy-top, wie die
 * Eternal-Karte), Mittelpunkte und Eckpunkte in einem gemeinsamen `viewBox`.
 */

export const BOARD_HEX_SIZE = 52;
/** Rand um die Karte, damit Rahmen markierter Regionen nicht abgeschnitten werden. */
const MARGIN = 8;

export interface BoardCell {
  readonly id: number;
  readonly name: string;
  readonly cx: number;
  readonly cy: number;
  /** Eckpunkte für `<polygon points>`. */
  readonly points: string;
}

export interface BoardLayout {
  readonly cells: readonly BoardCell[];
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function boardLayout(map: MatchMap, size = BOARD_HEX_SIZE): BoardLayout {
  const raw = map.regions.map((region) => {
    const centre = axialToPixel(region.cell, size);
    return { region, centre, corners: hexCorners(centre, size) };
  });
  const xs = raw.flatMap((c) => c.corners.map((p) => p.x));
  const ys = raw.flatMap((c) => c.corners.map((p) => p.y));
  const minX = Math.min(...xs) - MARGIN;
  const minY = Math.min(...ys) - MARGIN;
  const width = Math.max(...xs) + MARGIN - minX;
  const height = Math.max(...ys) + MARGIN - minY;
  const cells = raw.map(({ region, centre, corners }) => ({
    id: region.id,
    name: region.name,
    cx: round(centre.x - minX),
    cy: round(centre.y - minY),
    points: corners.map((p) => `${round(p.x - minX)},${round(p.y - minY)}`).join(' '),
  }));
  return { cells, viewBox: `0 0 ${round(width)} ${round(height)}`, width, height };
}
