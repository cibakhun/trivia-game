import { describe, expect, it } from 'vitest';
import { newId } from '../src/ids.ts';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId (UUIDv7)', () => {
  it('hat Version 7, Variante 10 und den Zeitpunkt in den ersten 48 Bit', () => {
    const at = Date.UTC(2026, 10, 10, 12, 0, 0, 123);
    const id = newId(at);
    expect(id).toMatch(UUID_V7);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(at);
  });

  it('ist über Millisekunden hinweg sortierbar und sonst zufällig', () => {
    const ids = [0, 1, 2, 1_000, 2 ** 40].map((ms) => newId(1_700_000_000_000 + ms));
    expect([...ids].sort()).toEqual(ids);
    expect(newId(5)).not.toBe(newId(5));
  });

  it('lehnt Zeitpunkte außerhalb von 48 Bit ab', () => {
    expect(() => newId(-1)).toThrow(RangeError);
    expect(() => newId(2 ** 48)).toThrow(RangeError);
    expect(() => newId(1.5)).toThrow(RangeError);
  });
});
