import type { QuestionCategory } from '@rdw/protocol';
import { armiesInRange, type RealmState, type RealmWheel } from './realm-state.ts';
import type { Rng } from './rng.ts';

/**
 * Glücksrad der Partie mit Ausbau (docs/MATCH_RULES.md §11.5, ADR-057): Vor der Wissensfrage eines
 * Duells bestimmt es die Kategorie. Jede Seite bringt Lose mit, die sich gleich auf ihre
 * Lieblingskategorien verteilen; freie Lose verteilen sich auf alle Kategorien des Rads.
 *
 * - Angreifer: 1 Los je eigene Armee in Reichweite des angegriffenen Felds (auf seinen Nachbarn).
 * - Verteidiger: 1 Los je eigene Armee auf dem Feld und seinen Nachbarn, dazu das Gebäude auf dem
 *   Feld (Dorf 2, Stadt 3, Burg 4).
 * - Frei: 2 Lose.
 *
 * Gewichte sind ganze Zahlen, damit Server und Browser ohne Rundung dasselbe Rad zeigen.
 */

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Rad aus Losen und Lieblingskategorien. Lieblingskategorien außerhalb des Rads zählen nicht; hat
 * eine Seite keine im Rad, werden ihre Lose frei. Gibt es gar keine Lose, sind alle Kategorien
 * gleich wahrscheinlich.
 */
export function buildRealmWheel(
  categories: readonly QuestionCategory[],
  attackerFavorites: readonly QuestionCategory[],
  defenderFavorites: readonly QuestionCategory[],
  attackerLots: number,
  defenderLots: number,
  freeLots: number,
): RealmWheel {
  if (categories.length === 0) throw new RangeError('Ein Glücksrad braucht Kategorien');
  const onWheel = (favorites: readonly QuestionCategory[]) =>
    [...new Set(favorites)].filter((c) => categories.includes(c));
  const fa = onWheel(attackerFavorites);
  const fd = onWheel(defenderFavorites);
  const a = fa.length > 0 ? attackerLots : 0;
  const d = fd.length > 0 ? defenderLots : 0;
  const free = freeLots + (attackerLots - a) + (defenderLots - d);
  const c = categories.length;
  // Ein Los = c · |fa| · |fd| Teile: je Lieblingskategorie und je Kategorie ganzzahlig teilbar
  const perFa = Math.max(1, fd.length) * c;
  const perFd = Math.max(1, fa.length) * c;
  const perFree = Math.max(1, fa.length) * Math.max(1, fd.length);
  const uniform = a + d + free === 0;
  let segments = categories.map((category) => {
    const attacker = fa.includes(category) ? a * perFa : 0;
    const defender = fd.includes(category) ? d * perFd : 0;
    const freePart = uniform ? 1 : free * perFree;
    return { category, attacker, defender, free: freePart, weight: attacker + defender + freePart };
  });
  const divisor = segments.reduce((g, s) => gcd(gcd(gcd(g, s.attacker), s.defender), s.free), 0);
  if (divisor > 1) {
    segments = segments.map((s) => ({
      ...s,
      attacker: s.attacker / divisor,
      defender: s.defender / divisor,
      free: s.free / divisor,
      weight: s.weight / divisor,
    }));
  }
  return {
    attackerLots: a,
    defenderLots: d,
    freeLots: uniform ? 0 : free,
    segments,
    total: segments.reduce((sum, s) => sum + s.weight, 0),
  };
}

/** Lose des Verteidigers für das Gebäude auf dem Feld. */
export function buildingLots(state: RealmState, region: number): number {
  const { lots } = state.rules.economy;
  switch (state.regions[region]?.building ?? 'NONE') {
    case 'VILLAGE':
      return lots.village;
    case 'TOWN':
      return lots.town;
    case 'CASTLE':
      return lots.castle;
    case 'NONE':
      return 0;
  }
}

/** Rad eines Angriffs von `attacker` auf `region` im aktuellen Zustand. */
export function realmWheel(state: RealmState, attacker: number, region: number): RealmWheel {
  const target = state.regions[region];
  if (!target || target.owner === null || target.owner === attacker) {
    throw new RangeError(`Region ${region} ist kein Ziel für Sitz ${attacker}`);
  }
  const defender = target.owner;
  return buildRealmWheel(
    state.categories,
    state.seats[attacker]?.favorites ?? [],
    state.seats[defender]?.favorites ?? [],
    armiesInRange(state, attacker, region),
    armiesInRange(state, defender, region) + buildingLots(state, region),
    state.rules.economy.lots.free,
  );
}

/** Chance je Herkunft: aus den Lieblingskategorien des Angreifers, des Verteidigers, frei. */
export function realmWheelShares(wheel: RealmWheel): {
  readonly attacker: number;
  readonly defender: number;
  readonly free: number;
} {
  const sum = (key: 'attacker' | 'defender' | 'free') =>
    wheel.segments.reduce((total, s) => total + s[key], 0) / wheel.total;
  return { attacker: sum('attacker'), defender: sum('defender'), free: sum('free') };
}

/** Kategorie, auf der das Rad stehen bleibt (Strom `match`, ohne Verzerrung durch Modulo). */
export function spinRealmWheel(wheel: RealmWheel, rng: Rng): QuestionCategory {
  const { total } = wheel;
  if (!(total > 0)) throw new RangeError('Leeres Glücksrad');
  const limit = Math.floor(0x1_0000_0000 / total) * total;
  let draw = rng.nextUint32();
  while (draw >= limit) draw = rng.nextUint32();
  let point = draw % total;
  for (const segment of wheel.segments) {
    if (point < segment.weight) return segment.category;
    point -= segment.weight;
  }
  throw new Error('Glücksrad ohne Treffer');
}
