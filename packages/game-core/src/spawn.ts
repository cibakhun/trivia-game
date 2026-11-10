import { AXIAL_DIRECTIONS, axialKey, hexDistance, type Axial } from './hex.ts';
import type { FactionArchetype } from './mapgen.ts';
import type { Rng } from './rng.ts';

/**
 * Startregion für neue Spieler (docs/WORLD_SYSTEM.md §4.2) und Ziel der Tutorial-Garnison
 * (NPC_SYSTEM §4: erste Eroberung gegen eine Startgarnison). Reine Funktionen über einem
 * Schnappschuss der Karte; die Anwendung sperrt und schreibt.
 */

export interface SpawnRegion extends Axial {
  readonly id: string;
  readonly tier: number;
  /** `null` = neutral. */
  readonly ownerKingdomId: string | null;
  readonly underSiege: boolean;
}

export interface SpawnKingdom {
  readonly id: string;
  readonly kind: 'PLAYER' | 'NPC';
  /** Nur NPC-Reiche: Archetyp der Fraktion. */
  readonly archetype: FactionArchetype | null;
  readonly regionCount: number;
  readonly capital: Axial | null;
}

export interface SpawnRules {
  /** Startzone: höchste Regionsstufe. */
  readonly maxTier: number;
  /** Mindestzahl neutraler Regionen im Radius 2 (ohne die Startregion). */
  readonly minNeutralWithin2: number;
  /** Eine leichte NPC-Fraktion muss in diesem Radius liegen (Brief §10.1). */
  readonly lightFactionRadius: number;
  /** Spielerreiche ab dieser Größe halten Abstand `largeKingdomDistance`. */
  readonly largeKingdomRegions: number;
  readonly largeKingdomDistance: number;
  /** Mindestabstand zu jeder anderen Spielerhauptstadt. */
  readonly capitalDistance: number;
}

/** Werte aus WORLD_SYSTEM §4.2 [E]. */
export const DEFAULT_SPAWN_RULES: SpawnRules = Object.freeze({
  maxTier: 2,
  minNeutralWithin2: 4,
  lightFactionRadius: 8,
  largeKingdomRegions: 15,
  largeKingdomDistance: 6,
  capitalDistance: 3,
});

export interface SpawnCandidate {
  readonly region: SpawnRegion;
  readonly score: number;
}

/** Zellen im Abstand 1 bis `radius` um `center`. */
function ring(center: Axial, radius: number): Axial[] {
  const cells: Axial[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      if (dq !== 0 || dr !== 0) cells.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return cells;
}

function isFreeNeutral(region: SpawnRegion | undefined): region is SpawnRegion {
  return region !== undefined && region.ownerKingdomId === null && !region.underSiege;
}

/**
 * Bewertet alle Regionen, die die Kriterien erfüllen. Zusätzlich [E]: mindestens ein neutraler
 * direkter Nachbar, damit die Tutorial-Garnison angreifbar ist.
 *
 * Punktwert: freier Raum (neutrale Regionen im Radius 2, doppelt), Abstand zum nächsten großen
 * Spielerreich (bis 12), +3 für eine Neulingshauptstadt im Abstand ≤ 8 (spätere Interaktion).
 */
export function spawnCandidates(
  regions: readonly SpawnRegion[],
  kingdoms: readonly SpawnKingdom[],
  rules: SpawnRules = DEFAULT_SPAWN_RULES,
): SpawnCandidate[] {
  const byKey = new Map(regions.map((region) => [axialKey(region), region]));
  const kingdomById = new Map(kingdoms.map((kingdom) => [kingdom.id, kingdom]));
  const lightRegions: SpawnRegion[] = [];
  const largeRegions: SpawnRegion[] = [];
  for (const region of regions) {
    const owner = region.ownerKingdomId ? kingdomById.get(region.ownerKingdomId) : undefined;
    if (owner?.kind === 'NPC' && owner.archetype === 'LIGHT') lightRegions.push(region);
    if (owner?.kind === 'PLAYER' && owner.regionCount >= rules.largeKingdomRegions) {
      largeRegions.push(region);
    }
  }
  const playerCapitals = kingdoms.filter((k) => k.kind === 'PLAYER' && k.capital !== null);
  const newcomerCapitals = playerCapitals.filter((k) => k.regionCount < rules.largeKingdomRegions);

  const result: SpawnCandidate[] = [];
  for (const region of regions) {
    if (region.tier > rules.maxTier || !isFreeNeutral(region)) continue;
    const neighborsFree = AXIAL_DIRECTIONS.some((d) =>
      isFreeNeutral(byKey.get(axialKey({ q: region.q + d.q, r: region.r + d.r }))),
    );
    if (!neighborsFree) continue;
    const free = ring(region, 2).filter((cell) => isFreeNeutral(byKey.get(axialKey(cell)))).length;
    if (free < rules.minNeutralWithin2) continue;
    if (!lightRegions.some((other) => hexDistance(region, other) <= rules.lightFactionRadius)) {
      continue;
    }
    // ohne große Reiche: unendlich weit; die Kappung auf 12 gilt nur der Bewertung
    const nearestLarge = Math.min(...largeRegions.map((other) => hexDistance(region, other)));
    if (nearestLarge < rules.largeKingdomDistance) continue;
    const largeDistance = Math.min(12, nearestLarge);
    if (
      playerCapitals.some((k) => hexDistance(region, k.capital as Axial) < rules.capitalDistance)
    ) {
      continue;
    }
    const nearNewcomer = newcomerCapitals.some((k) => hexDistance(region, k.capital as Axial) <= 8);
    result.push({ region, score: 2 * free + largeDistance + (nearNewcomer ? 3 : 0) });
  }
  return result;
}

/** Beste Kandidatin; Gleichstand per Zufallsstrom (Zweck `spawn`). `null`, wenn keine passt. */
export function chooseStartRegion(
  candidates: readonly SpawnCandidate[],
  rng: Rng,
): SpawnRegion | null {
  if (candidates.length === 0) return null;
  const best = Math.max(...candidates.map((c) => c.score));
  // feste Reihenfolge vor der Ziehung, unabhängig von der Reihenfolge der Abfrage
  const top = candidates
    .filter((c) => c.score === best)
    .map((c) => c.region)
    .sort((a, b) => a.r - b.r || a.q - b.q);
  return top[rng.nextUint32() % top.length] ?? null;
}

/**
 * Ziel der Tutorial-Garnison: freier neutraler Nachbar der Startregion mit der niedrigsten
 * Stufe, bei Gleichstand der erste in der Richtungsreihenfolge (GAME_RULES §2).
 */
export function tutorialTarget(regions: readonly SpawnRegion[], start: Axial): SpawnRegion | null {
  const byKey = new Map(regions.map((region) => [axialKey(region), region]));
  let best: SpawnRegion | null = null;
  for (const d of AXIAL_DIRECTIONS) {
    const region = byKey.get(axialKey({ q: start.q + d.q, r: start.r + d.r }));
    if (isFreeNeutral(region) && (best === null || region.tier < best.tier)) best = region;
  }
  return best;
}
