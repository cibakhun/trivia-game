import type { Rng } from './rng.ts';

/**
 * Generierte Reichsnamen aus deutschen Bausteinen (GAME_RULES §3.8, O-10, ADR-023): Vorsilbe +
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

/** Gilt für frei zusammengesetzte Teile: nur Bausteine aus den Listen (O-10, kein freier Text). */
export function isKingdomNameParts(value: unknown): value is KingdomNameParts {
  if (typeof value !== 'object' || value === null) return false;
  const { prefix, suffix } = value as Record<string, unknown>;
  return (
    typeof prefix === 'string' &&
    typeof suffix === 'string' &&
    (NAME_PREFIXES as readonly string[]).includes(prefix) &&
    (NAME_SUFFIXES as readonly string[]).includes(suffix)
  );
}

/**
 * Vorschläge für einen Reichsnamen: `count` verschiedene Namen, die in der Welt noch frei sind,
 * soweit es so viele gibt (sonst weniger). Bis zu 20 Ziehungen je Vorschlag.
 */
export function suggestKingdomNames(
  rng: Rng,
  taken: ReadonlySet<string>,
  count: number,
): KingdomNameParts[] {
  const result: KingdomNameParts[] = [];
  const seen = new Set(taken);
  for (let attempt = 0; attempt < count * 20 && result.length < count; attempt++) {
    const parts: KingdomNameParts = {
      prefix: NAME_PREFIXES[rng.nextUint32() % NAME_PREFIXES.length] as string,
      suffix: NAME_SUFFIXES[rng.nextUint32() % NAME_SUFFIXES.length] as string,
    };
    const name = kingdomName(parts);
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(parts);
  }
  return result;
}

/**
 * Spielernamen (O-10, ADR-044): Eigenschaft + Tier oder Figur, z. B. „Kühner Falke“, „Weise
 * Eule“, „Flinkes Wiesel“. Die Eigenschaft steht als Stamm in der Liste und wird nach dem
 * Geschlecht des Nomens stark gebeugt (ohne Artikel: -er, -e, -es). Nur Stämme, die regelmäßig
 * beugen. Ist ein Name vergeben, hängt der Vorschlag eine Zahl von 2 bis 99 an.
 *
 * Spielernamen sind eindeutig (`player_profiles.display_name`). Änderungen an den Listen ändern
 * nur künftige Vorschläge; gespeicherte Namen bleiben gültig, solange ihre Bausteine bleiben.
 */
export const PLAYER_NAME_ADJECTIVES = Object.freeze([
  'Flink',
  'Frei',
  'Fröhlich',
  'Golden',
  'Grau',
  'Hell',
  'Klug',
  'Kühn',
  'Leis',
  'Listig',
  'Mutig',
  'Rasch',
  'Rot',
  'Ruhig',
  'Sanft',
  'Schlau',
  'Schwarz',
  'Silbern',
  'Stark',
  'Still',
  'Stolz',
  'Tapfer',
  'Treu',
  'Wach',
  'Wachsam',
  'Weis',
  'Wendig',
  'Wild',
] as const);

export type NounGender = 'M' | 'F' | 'N';

/** Nomen mit Geschlecht für die Beugung der Eigenschaft. */
export const PLAYER_NAME_NOUNS: Readonly<Record<string, NounGender>> = Object.freeze({
  Adler: 'M',
  Bär: 'M',
  Barde: 'M',
  Biber: 'M',
  Bote: 'M',
  Dachs: 'M',
  Drache: 'M',
  Falke: 'M',
  Fuchs: 'M',
  Habicht: 'M',
  Hirsch: 'M',
  Hüter: 'M',
  Kranich: 'M',
  Luchs: 'M',
  Pilger: 'M',
  Rabe: 'M',
  Reiher: 'M',
  Ritter: 'M',
  Späher: 'M',
  Uhu: 'M',
  Wanderer: 'M',
  Wolf: 'M',
  Bardin: 'F',
  Bärin: 'F',
  Botin: 'F',
  Elster: 'F',
  Eule: 'F',
  Füchsin: 'F',
  Hüterin: 'F',
  Krähe: 'F',
  Lerche: 'F',
  Libelle: 'F',
  Möwe: 'F',
  Nachtigall: 'F',
  Pilgerin: 'F',
  Ritterin: 'F',
  Schwalbe: 'F',
  Späherin: 'F',
  Taube: 'F',
  Wölfin: 'F',
  Einhorn: 'N',
  Fohlen: 'N',
  Hermelin: 'N',
  Pferd: 'N',
  Reh: 'N',
  Rotkehlchen: 'N',
  Wiesel: 'N',
});

export const PLAYER_NAME_NUMBER_MIN = 2;
export const PLAYER_NAME_NUMBER_MAX = 99;

/** Gespeicherte Form (`player_profiles.name_parts`). */
export interface PlayerNameParts {
  readonly adjective: string;
  readonly noun: string;
  readonly number: number | null;
}

const ADJECTIVE_ENDINGS: Readonly<Record<NounGender, string>> = { M: 'er', F: 'e', N: 'es' };

export function isPlayerNameParts(value: unknown): value is PlayerNameParts {
  if (typeof value !== 'object' || value === null) return false;
  const { adjective, noun, number } = value as Record<string, unknown>;
  return (
    typeof adjective === 'string' &&
    (PLAYER_NAME_ADJECTIVES as readonly string[]).includes(adjective) &&
    typeof noun === 'string' &&
    Object.hasOwn(PLAYER_NAME_NOUNS, noun) &&
    (number === null ||
      (typeof number === 'number' &&
        Number.isInteger(number) &&
        number >= PLAYER_NAME_NUMBER_MIN &&
        number <= PLAYER_NAME_NUMBER_MAX))
  );
}

export function playerDisplayName(parts: PlayerNameParts): string {
  const gender = PLAYER_NAME_NOUNS[parts.noun];
  if (gender === undefined) throw new Error(`Unbekanntes Nomen: ${parts.noun}`);
  const base = `${parts.adjective}${ADJECTIVE_ENDINGS[gender]} ${parts.noun}`;
  return parts.number === null ? base : `${base} ${parts.number}`;
}

/**
 * Vorschläge für einen Spielernamen, die nicht in `taken` stehen (Anzeigenamen). Zuerst ohne
 * Zahl; findet sich so kein freier Name, mit Zahl. Höchstens 20 Ziehungen je Vorschlag.
 */
export function suggestPlayerNames(
  rng: Rng,
  taken: ReadonlySet<string>,
  count: number,
): PlayerNameParts[] {
  const nouns = Object.keys(PLAYER_NAME_NOUNS);
  const result: PlayerNameParts[] = [];
  const seen = new Set(taken);
  for (let attempt = 0; attempt < count * 20 && result.length < count; attempt++) {
    const adjective = PLAYER_NAME_ADJECTIVES[
      rng.nextUint32() % PLAYER_NAME_ADJECTIVES.length
    ] as string;
    const noun = nouns[rng.nextUint32() % nouns.length] as string;
    let parts: PlayerNameParts = { adjective, noun, number: null };
    if (seen.has(playerDisplayName(parts))) {
      const span = PLAYER_NAME_NUMBER_MAX - PLAYER_NAME_NUMBER_MIN + 1;
      parts = { adjective, noun, number: PLAYER_NAME_NUMBER_MIN + (rng.nextUint32() % span) };
      if (seen.has(playerDisplayName(parts))) continue;
    }
    seen.add(playerDisplayName(parts));
    result.push(parts);
  }
  return result;
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
