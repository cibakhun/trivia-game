import { describe, expect, it } from 'vitest';
import {
  KINGDOM_COLOR_COUNT,
  NAME_PREFIXES,
  NAME_SUFFIXES,
  createRng,
  factionNamingRng,
  generateKingdomName,
  kingdomName,
  pickKingdomColor,
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
