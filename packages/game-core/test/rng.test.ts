import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed, RNG_VERSION } from '../src/index.ts';

const SECRET = new Uint8Array(32).fill(0x2a);

describe('deriveSeed', () => {
  it('ist HMAC-SHA256(secret, "purpose:entity") – Abgleich mit Node-crypto und festem Vektor', async () => {
    const seed = await deriveSeed(SECRET, 'drop', 'test-1');
    const expected = createHmac('sha256', Buffer.from(SECRET)).update('drop:test-1').digest('hex');
    expect(Buffer.from(seed).toString('hex')).toBe(expected);
    expect(expected).toBe('530be240a84ff3f0216b55234593cdc79f5111906fa6831157601b49c936b4c6');
  });

  it('trennt Zwecke und Entitäten', async () => {
    const a = await deriveSeed(SECRET, 'drop', 'siege-1');
    const b = await deriveSeed(SECRET, 'npc-answer', 'siege-1');
    const c = await deriveSeed(SECRET, 'drop', 'siege-2');
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('lehnt zu kurze Geheimnisse und ungültige IDs ab', async () => {
    await expect(deriveSeed(new Uint8Array(31), 'drop', 'x')).rejects.toThrow(RangeError);
    await expect(deriveSeed(SECRET, 'drop', '')).rejects.toThrow(RangeError);
    await expect(deriveSeed(SECRET, 'drop', 'a:b')).rejects.toThrow(RangeError);
    await expect(deriveSeed(SECRET, 'drop', 'ä')).rejects.toThrow(RangeError);
  });
});

describe('createRng (sfc32)', () => {
  it('entspricht dem Referenzvektor (unabhängig in Python berechnet)', () => {
    const rng = createRng(Uint8Array.from({ length: 16 }, (_, i) => i));
    expect([1, 2, 3, 4, 5].map(() => rng.nextUint32())).toEqual([
      858807458, 1403912697, 1845977855, 1504073547, 2702540561,
    ]);
    expect(RNG_VERSION).toBe(1);
  });

  it('gleicher Seed ⇒ gleiche Folge (Wiederholung würfelt nicht neu)', async () => {
    const seed = await deriveSeed(SECRET, 'drop', 'siege-42');
    const a = createRng(seed);
    const b = createRng(seed);
    for (let i = 0; i < 1_000; i++) expect(a.nextFloat()).toBe(b.nextFloat());
  });

  it('nextFloat liegt in [0, 1) und ist annähernd gleichverteilt', () => {
    const rng = createRng(Uint8Array.from({ length: 16 }, (_, i) => i * 7));
    const buckets = new Array<number>(10).fill(0);
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const u = rng.nextFloat();
      expect(u >= 0 && u < 1).toBe(true);
      buckets[Math.floor(u * 10)]!++;
    }
    for (const count of buckets) expect(Math.abs(count / n - 0.1)).toBeLessThan(0.004);
  });

  it('nextNormal hat Mittelwert ≈ 0 und Standardabweichung ≈ 1', () => {
    const rng = createRng(Uint8Array.from({ length: 16 }, (_, i) => 255 - i));
    const n = 200_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const z = rng.nextNormal();
      expect(Number.isFinite(z)).toBe(true);
      sum += z;
      sumSq += z * z;
    }
    const mean = sum / n;
    expect(Math.abs(mean)).toBeLessThan(0.015);
    expect(Math.abs(Math.sqrt(sumSq / n - mean * mean) - 1)).toBeLessThan(0.015);
  });

  it('lehnt zu kurze Seeds ab', () => {
    expect(() => createRng(new Uint8Array(15))).toThrow(RangeError);
  });
});
