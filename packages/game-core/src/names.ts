import type { Rng } from './rng.ts';

/**
 * Generierte Reichsnamen aus deutschen Bausteinen (GAME_RULES §3.7, O-10, ADR-023): Vorsilbe +
 * Endung, z. B. „Falkenstein“. Freie Namen gibt es im MVP nicht, damit keine nutzergenerierten
 * Inhalte moderiert werden müssen. Die Bausteine sind Eigennamen und werden nicht übersetzt.
 *
 * Jede Änderung an den Listen oder der Ziehung ändert die Namen künftiger Reiche (bestehende
 * behalten ihre gespeicherten `name_parts`).
 */
export const NAME_PREFIXES = Object.freeze([
  'Adler',
  'Bären',
  'Birken',
  'Buchen',
  'Dornen',
  'Eichen',
  'Eisen',
  'Erlen',
  'Falken',
  'Felsen',
  'Fichten',
  'Gold',
  'Grün',
  'Hasel',
  'Hirsch',
  'Kranich',
  'Lerchen',
  'Linden',
  'Löwen',
  'Mond',
  'Nebel',
  'Nord',
  'Raben',
  'Rosen',
  'Silber',
  'Sonnen',
  'Stern',
  'Sturm',
  'Tannen',
  'Weiden',
  'Wolfs',
  'Zedern',
] as const);

export const NAME_SUFFIXES = Object.freeze([
  'au',
  'bach',
  'berg',
  'brück',
  'burg',
  'dorf',
  'eck',
  'feld',
  'fels',
  'furt',
  'hain',
  'hall',
  'heim',
  'hof',
  'horst',
  'mark',
  'moor',
  'ried',
  'rode',
  'see',
  'stein',
  'tal',
  'wald',
  'wiesen',
] as const);

/** Gespeicherte Form (`kingdoms.name_parts`). */
export interface KingdomNameParts {
  readonly prefix: string;
  readonly suffix: string;
}

export function kingdomName(parts: KingdomNameParts): string {
  return `${parts.prefix}${parts.suffix}`;
}

/** Größte Zahl an Ziehungen, bevor ein bereits vergebener Name hingenommen wird. */
const MAX_NAME_ATTEMPTS = 8;

/**
 * Zieht einen Namen; vergebene Namen (`taken`, als Text) werden bis zu acht Mal neu gezogen und
 * danach hingenommen, damit die Zahl der Ziehungen begrenzt und die Folge reproduzierbar bleibt.
 * Eindeutigkeit ist kein Muss: Reiche werden über ihre ID unterschieden.
 */
export function generateKingdomName(
  rng: Rng,
  taken: ReadonlySet<string> = new Set(),
): KingdomNameParts {
  let parts: KingdomNameParts | null = null;
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
    parts = {
      prefix: NAME_PREFIXES[rng.nextUint32() % NAME_PREFIXES.length] as string,
      suffix: NAME_SUFFIXES[rng.nextUint32() % NAME_SUFFIXES.length] as string,
    };
    if (!taken.has(kingdomName(parts))) return parts;
  }
  return parts as KingdomNameParts;
}

/** Zahl der Reichsfarben; der Client bildet den Index auf seine Palette ab. */
export const KINGDOM_COLOR_COUNT = 16;

/**
 * Farbe eines neuen Reichs: eine der am seltensten benutzten Farben (`usage[i]` = Zahl der Reiche
 * mit Farbe i), unter mehreren per Zufallsstrom.
 */
export function pickKingdomColor(rng: Rng, usage: readonly number[] = []): number {
  const counts = Array.from({ length: KINGDOM_COLOR_COUNT }, (_, i) => usage[i] ?? 0);
  const fewest = Math.min(...counts);
  const options = counts.flatMap((count, i) => (count === fewest ? [i] : []));
  return options[rng.nextUint32() % options.length] as number;
}
