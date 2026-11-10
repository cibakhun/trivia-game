import { BIOMES, KINGDOM_COLOR_COUNT, type Biome } from '@rdw/game-core';

/**
 * Platzhalterfarben der Karte (REPO_AUDIT: visuelle Identität ab Phase 1, Platzhalter genügen).
 * Reichsfarben sind ein Index 0–15 (GAME_RULES §3.7); Besitz wird zusätzlich über Rahmen und
 * Symbole unterschieden, nicht nur über Farbe (ARCHITECTURE §12).
 */

export const KINGDOM_COLORS: readonly number[] = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x46f0f0, 0xf032e6, 0xbcf60c,
  0xfabebe, 0x008080, 0xe6beff, 0x9a6324, 0xfffac8, 0x800000, 0xaaffc3,
];

if (KINGDOM_COLORS.length !== KINGDOM_COLOR_COUNT) {
  throw new Error('Palette passt nicht zur Zahl der Reichsfarben');
}

const BIOME_COLORS: Readonly<Record<Biome, number>> = {
  PLAINS: 0xc8d9a0,
  FOREST: 0x8fb57a,
  HILLS: 0xc9b88e,
  MOUNTAINS: 0xa6a19a,
  COAST: 0xbcdbe0,
  DESERT: 0xe8d7a5,
  TUNDRA: 0xdfe6e8,
  FORD: 0xb4c9b8,
};

export function biomeName(index: number): Biome | null {
  return BIOMES[index] ?? null;
}

export function biomeColor(index: number): number {
  const biome = biomeName(index);
  return biome ? BIOME_COLORS[biome] : 0xcccccc;
}

export function kingdomColor(index: number): number {
  // Ungültige Indizes (negativ, zu groß, gebrochen) fallen alle auf Grau zurück
  return KINGDOM_COLORS[index] ?? 0x888888;
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
