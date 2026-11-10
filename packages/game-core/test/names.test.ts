import { describe, expect, it } from 'vitest';
import {
  KINGDOM_COLOR_COUNT,
  NAME_PREFIXES,
  NAME_SUFFIXES,
  PLAYER_NAME_ADJECTIVES,
  PLAYER_NAME_NOUNS,
  createRng,
  factionNamingRng,
  generateKingdomName,
  isKingdomNameParts,
  isPlayerNameParts,
  kingdomName,
  pickKingdomColor,
  playerDisplayName,
  suggestKingdomNames,
  suggestPlayerNames,
  type Rng,
} from '../src/index.ts';

function rng(byte = 1): Rng {
  return createRng(new Uint8Array(16).fill(byte));
}

/** Liefert die angegebenen Werte der Reihe nach (danach 0). */
function fixed(values: number[]): Rng {
  let i = 0;
  const next = () => values[i++] ?? 0;
  return { nextUint32: next, nextFloat: () => next() / 2 ** 32, nextNormal: () => 0 };
}

describe('Reichsnamen', () => {
  it('setzt Vorsilbe und Endung zusammen und ist reproduzierbar', () => {
    const parts = generateKingdomName(rng(3));
    expect(NAME_PREFIXES).toContain(parts.prefix);
    expect(NAME_SUFFIXES).toContain(parts.suffix);
    expect(generateKingdomName(rng(3))).toEqual(parts);
    expect(kingdomName({ prefix: 'Falken', suffix: 'stein' })).toBe('Falkenstein');
  });

  it('zieht bei vergebenen Namen neu und gibt nach acht Versuchen nach', () => {
    const taken = new Set([kingdomName({ prefix: NAME_PREFIXES[0], suffix: NAME_SUFFIXES[0] })]);
    expect(generateKingdomName(fixed([0, 0, 1, 1]), taken)).toEqual({
      prefix: NAME_PREFIXES[1],
      suffix: NAME_SUFFIXES[1],
    });
    // nur vergebene Namen: nach acht Versuchen (16 Ziehungen) wird der letzte hingenommen. Ein
    // neunter Versuch fände mit 1/1 einen freien Namen, daher fiele eine höhere Grenze auf.
    const draws = fixed([...Array<number>(16).fill(0), 1, 1]);
    expect(generateKingdomName(draws, taken)).toEqual({
      prefix: NAME_PREFIXES[0],
      suffix: NAME_SUFFIXES[0],
    });
    // genau 16 Werte verbraucht: der nächste ist die erste 1
    expect(draws.nextUint32()).toBe(1);
  });

  it('hat keine doppelten Bausteine', () => {
    expect(new Set(NAME_PREFIXES).size).toBe(NAME_PREFIXES.length);
    expect(new Set(NAME_SUFFIXES).size).toBe(NAME_SUFFIXES.length);
  });

  it('hängt für NPC-Reiche nur vom Welt-Seed ab', () => {
    const a = generateKingdomName(factionNamingRng(7n));
    expect(generateKingdomName(factionNamingRng(7n))).toEqual(a);
    const names = new Set(
      Array.from({ length: 20 }, (_, i) =>
        kingdomName(generateKingdomName(factionNamingRng(BigInt(i)))),
      ),
    );
    expect(names.size).toBeGreaterThan(10);
  });
});

describe('Reichsfarben', () => {
  it('wählt eine der am seltensten benutzten Farben', () => {
    const usage = Array<number>(KINGDOM_COLOR_COUNT).fill(2);
    usage[5] = 1;
    expect(pickKingdomColor(rng(), usage)).toBe(5);
    usage[9] = 1;
    const picks = new Set(
      Array.from({ length: 20 }, (_, i) => pickKingdomColor(rng(i + 1), usage)),
    );
    expect([...picks].sort((a, b) => a - b)).toEqual([5, 9]);
    const color = pickKingdomColor(rng(4));
    expect(color).toBeGreaterThanOrEqual(0);
    expect(color).toBeLessThan(KINGDOM_COLOR_COUNT);
  });
});

describe('Namen aus Vorschlägen (O-10, ADR-044)', () => {
  it('beugt die Eigenschaft nach dem Geschlecht des Nomens', () => {
    expect(playerDisplayName({ adjective: 'Kühn', noun: 'Falke', number: null })).toBe(
      'Kühner Falke',
    );
    expect(playerDisplayName({ adjective: 'Weis', noun: 'Eule', number: null })).toBe('Weise Eule');
    expect(playerDisplayName({ adjective: 'Flink', noun: 'Wiesel', number: 7 })).toBe(
      'Flinkes Wiesel 7',
    );
    expect(() => playerDisplayName({ adjective: 'Kühn', noun: 'Hund', number: null })).toThrow();
  });

  it('kennt nur Bausteine aus den Listen', () => {
    expect(isPlayerNameParts({ adjective: 'Kühn', noun: 'Falke', number: null })).toBe(true);
    expect(isPlayerNameParts({ adjective: 'Kühn', noun: 'Falke', number: 99 })).toBe(true);
    for (const bad of [
      { adjective: 'Böse', noun: 'Falke', number: null },
      { adjective: 'Kühn', noun: 'toString', number: null },
      { adjective: 'Kühn', noun: 'Falke', number: 1 },
      { adjective: 'Kühn', noun: 'Falke', number: 100 },
      { adjective: 'Kühn', noun: 'Falke', number: 2.5 },
      { adjective: 'Kühn', noun: 'Falke' },
      null,
      'Kühner Falke',
    ]) {
      expect(isPlayerNameParts(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isKingdomNameParts({ prefix: 'Falken', suffix: 'stein' })).toBe(true);
    expect(isKingdomNameParts({ prefix: 'Falken', suffix: 'hausen' })).toBe(false);
    expect(isKingdomNameParts({ prefix: 'Vergessenes Reich #', suffix: '1234' })).toBe(false);
  });

  it('hat keine doppelten Bausteine und nur beugbare Stämme', () => {
    expect(new Set(PLAYER_NAME_ADJECTIVES).size).toBe(PLAYER_NAME_ADJECTIVES.length);
    for (const adjective of PLAYER_NAME_ADJECTIVES) {
      // ein Stamm endet nicht auf -e oder -el (sonst „Weiseer“, „Edeler“)
      expect(adjective).not.toMatch(/(e|el)$/);
    }
    expect(Object.values(PLAYER_NAME_NOUNS).every((g) => ['M', 'F', 'N'].includes(g))).toBe(true);
  });

  it('schlägt verschiedene freie Spielernamen vor, bei Bedarf mit Zahl', () => {
    const names = suggestPlayerNames(rng(5), new Set(), 5);
    expect(names).toHaveLength(5);
    expect(new Set(names.map(playerDisplayName)).size).toBe(5);
    expect(names.every((parts) => isPlayerNameParts(parts) && parts.number === null)).toBe(true);
    // alle Namen ohne Zahl vergeben: Vorschläge tragen eine Zahl
    const taken = new Set<string>();
    for (const adjective of PLAYER_NAME_ADJECTIVES) {
      for (const noun of Object.keys(PLAYER_NAME_NOUNS)) {
        taken.add(playerDisplayName({ adjective, noun, number: null }));
      }
    }
    const numbered = suggestPlayerNames(rng(6), taken, 3);
    expect(numbered).toHaveLength(3);
    expect(new Set(numbered.map(playerDisplayName)).size).toBe(3);
    for (const parts of numbered) {
      // gültig heißt auch: Zahl 2–99
      expect(isPlayerNameParts(parts), JSON.stringify(parts)).toBe(true);
      expect(parts.number).not.toBeNull();
      expect(taken.has(playerDisplayName(parts))).toBe(false);
    }
  });

  it('schlägt Reichsnamen vor, die in der Welt noch nicht vorkommen', () => {
    const taken = new Set(['Falkenstein', 'Rosental']);
    const names = suggestKingdomNames(rng(8), taken, 5);
    expect(names).toHaveLength(5);
    const texts = names.map(kingdomName);
    expect(new Set(texts).size).toBe(5);
    expect(texts.some((name) => taken.has(name))).toBe(false);
    // sind fast alle vergeben, kommen eben weniger Vorschläge
    const all = new Set(NAME_PREFIXES.flatMap((p) => NAME_SUFFIXES.map((s) => `${p}${s}`)));
    all.delete('Adlerau');
    expect(suggestKingdomNames(fixed(Array<number>(200).fill(0)), all, 5)).toEqual([
      { prefix: 'Adler', suffix: 'au' },
    ]);
  });
});
