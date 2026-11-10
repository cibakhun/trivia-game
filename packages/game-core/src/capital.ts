import { areNeighbors, axialKey, neighbors, type Axial } from './hex.ts';

/**
 * Neue Hauptstadt nach Verlust der alten (docs/GAME_RULES.md §3.3): die eigene Region mit den
 * meisten eigenen Nachbarn; bei Gleichstand die am längsten gehaltene; danach die kleinste ID.
 */

export interface OwnedRegion extends Axial {
  /** Regions-ID als Dezimaltext (bigint). */
  readonly id: string;
  /** Besitz seit (ms). */
  readonly ownedSince: number;
}

function compareRegionIds(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** `null`, wenn das Reich keine Region mehr hat. */
export function chooseNewCapital(regions: readonly OwnedRegion[]): OwnedRegion | null {
  const own = new Set(regions.map(axialKey));
  let best: { region: OwnedRegion; ownNeighbors: number } | null = null;
  for (const region of regions) {
    const ownNeighbors = neighbors(region).filter((n) => own.has(axialKey(n))).length;
    if (
      best === null ||
      ownNeighbors > best.ownNeighbors ||
      (ownNeighbors === best.ownNeighbors &&
        (region.ownedSince < best.region.ownedSince ||
          (region.ownedSince === best.region.ownedSince &&
            compareRegionIds(region.id, best.region.id) < 0)))
    ) {
      best = { region, ownNeighbors };
    }
  }
  return best?.region ?? null;
}

/** Grenzt `target` an mindestens eine der Regionen? (GAME_RULES §4.4) */
export function isAdjacentToAny(target: Axial, regions: readonly Axial[]): boolean {
  return regions.some((region) => areNeighbors(region, target));
}
