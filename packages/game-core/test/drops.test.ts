import { describe, expect, it } from 'vitest';
import { classifyDrop, createRng, deriveSeed, drawDrop, type ItemId } from '../src/index.ts';

const SECRET = new Uint8Array(32).fill(7);

describe('classifyDrop – Intervalle (ITEM_SYSTEM §3)', () => {
  it.each<[number, ItemId | null]>([
    [0, null],
    [0.789_999, null],
    [0.79, 'hourglass_small'],
    [0.939_999, 'hourglass_small'],
    [0.94, 'chronos_seal'],
    [0.989_999, 'chronos_seal'],
    [0.99, 'time_crystal'],
    [0.999_999_999, 'time_crystal'],
  ])('u = %d → %s', (u, item) => {
    expect(classifyDrop(u, 1).item).toBe(item);
  });

  it('Grenzwerte als exakte 32-Bit-Brüche', () => {
    // kleinstes x mit x / 2^32 ≥ 0,79
    const x = Math.ceil(0.79 * 2 ** 32);
    expect(classifyDrop((x - 1) / 2 ** 32, 1).item).toBeNull();
    expect(classifyDrop(x / 2 ** 32, 1).item).toBe('hourglass_small');
  });

  it('skaliert Item-Gewichte mit f und erhöht „kein Item“: none = 1 − f · 0,21', () => {
    expect(classifyDrop(0.5, 1).nonePpm).toBe(790_000);
    expect(classifyDrop(0.5, 0.5).nonePpm).toBe(895_000);
    expect(classifyDrop(0.5, 0.25).nonePpm).toBe(947_500);
    expect(classifyDrop(0.5, 0).nonePpm).toBe(1_000_000);
    // f = 0,5: Sanduhr 7,5 %, Siegel 2,5 %, Kristall 0,5 %
    expect(classifyDrop(0.894_999, 0.5).item).toBeNull();
    expect(classifyDrop(0.895, 0.5).item).toBe('hourglass_small');
    expect(classifyDrop(0.97, 0.5).item).toBe('chronos_seal');
    expect(classifyDrop(0.995, 0.5).item).toBe('time_crystal');
    expect(classifyDrop(0.999_999, 0).item).toBeNull();
  });

  it('lehnt ungültige Eingaben ab', () => {
    expect(() => classifyDrop(1, 1)).toThrow(RangeError);
    expect(() => classifyDrop(-0.1, 1)).toThrow(RangeError);
    expect(() => classifyDrop(0.5, 1.1)).toThrow(RangeError);
    for (const weightPpm of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => classifyDrop(0.5, 1, [{ item: 'hourglass_small', weightPpm }])).toThrow(
        /Gewicht/,
      );
    }
  });

  it('lehnt eine Tabelle über 100 % auch bei kleinem Faktor ab', () => {
    const tooMuch = [
      { item: 'hourglass_small', weightPpm: 800_000 },
      { item: 'chronos_seal', weightPpm: 300_000 },
    ] as const;
    for (const factor of [1, 0.5, 0]) {
      expect(() => classifyDrop(0.5, factor, tooMuch)).toThrow(/über 100 %/);
    }
  });
});

/** Toleranz: 5 Standardabweichungen einer Binomialschätzung. */
const tolerance = (p: number, n: number) => 5 * Math.sqrt((p * (1 - p)) / n);

function distribution(draws: Iterable<ItemId | null>) {
  const counts = new Map<ItemId | null, number>();
  let n = 0;
  for (const item of draws) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
    n++;
  }
  return { n, share: (item: ItemId | null) => (counts.get(item) ?? 0) / n };
}

describe('Drop-Verteilung', () => {
  const expected: [ItemId | null, number][] = [
    [null, 0.79],
    ['hourglass_small', 0.15],
    ['chronos_seal', 0.05],
    ['time_crystal', 0.01],
  ];

  it('über 1 Mio. Seeds innerhalb der Toleranz', () => {
    const master = createRng(Uint8Array.from({ length: 16 }, (_, i) => i + 1));
    function* draws() {
      const seed = new Uint8Array(16);
      const view = new DataView(seed.buffer);
      for (let i = 0; i < 1_000_000; i++) {
        for (let w = 0; w < 4; w++) view.setUint32(w * 4, master.nextUint32());
        yield drawDrop(createRng(seed), 1).item;
      }
    }
    const { n, share } = distribution(draws());
    for (const [item, p] of expected)
      expect(Math.abs(share(item) - p)).toBeLessThan(tolerance(p, n));
  });

  it('über echte HMAC-Seeds (drop:{siege_id}) innerhalb der Toleranz', async () => {
    const items: (ItemId | null)[] = [];
    for (let i = 0; i < 20_000; i++) {
      items.push(drawDrop(createRng(await deriveSeed(SECRET, 'drop', `siege-${i}`)), 1).item);
    }
    const { n, share } = distribution(items);
    for (const [item, p] of expected)
      expect(Math.abs(share(item) - p)).toBeLessThan(tolerance(p, n));
  });

  it('gleiche Belagerung ⇒ gleicher Drop (E2E-11)', async () => {
    const a = drawDrop(createRng(await deriveSeed(SECRET, 'drop', 'siege-7')), 1);
    const b = drawDrop(createRng(await deriveSeed(SECRET, 'drop', 'siege-7')), 1);
    expect(a).toEqual(b);
  });
});
