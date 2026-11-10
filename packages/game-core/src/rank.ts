/** Königreichsränge (docs/GAME_RULES.md §3.7); rein kosmetisch, ohne Einfluss auf Spielwerte. */

export const KINGDOM_RANKS = [
  'SETTLEMENT', // Siedlung
  'VILLAGE_LEAGUE', // Dorfverbund
  'PRINCIPALITY', // Fürstentum
  'KINGDOM', // Königreich
  'GREAT_KINGDOM', // Großreich
  'EMPIRE', // Imperium
] as const;
export type KingdomRank = (typeof KINGDOM_RANKS)[number];

/** Mindestzahl an Regionen je Rang, aufsteigend. */
export const RANK_THRESHOLDS: readonly {
  readonly rank: KingdomRank;
  readonly minRegions: number;
}[] = Object.freeze([
  { rank: 'SETTLEMENT', minRegions: 1 },
  { rank: 'VILLAGE_LEAGUE', minRegions: 5 },
  { rank: 'PRINCIPALITY', minRegions: 15 },
  { rank: 'KINGDOM', minRegions: 40 },
  { rank: 'GREAT_KINGDOM', minRegions: 100 },
  { rank: 'EMPIRE', minRegions: 250 },
]);

/** Rang für eine Regionszahl; `null` für ein Reich ohne Regionen (gefallen). */
export function kingdomRank(regionCount: number): KingdomRank | null {
  if (!Number.isSafeInteger(regionCount) || regionCount < 0) {
    throw new RangeError(`Ungültige Regionszahl: ${regionCount}`);
  }
  let result: KingdomRank | null = null;
  for (const { rank, minRegions } of RANK_THRESHOLDS) {
    if (regionCount >= minRegions) result = rank;
  }
  return result;
}
