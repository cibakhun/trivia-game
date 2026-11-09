import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { effectiveAnswerTime } from '../src/index.ts';

const t = (serverMs: number, clientMs: unknown, reloaded = false) =>
  effectiveAnswerTime({ serverMs, clientMs, capMs: 500, reloaded });

describe('effectiveAnswerTime (QUIZ_ENGINE §6.2)', () => {
  it('ehrlicher Client, normale Verbindung: volle Kompensation', () => {
    expect(t(6_400, 6_100)).toEqual({ effectiveMs: 6_100, clientTimeUsed: true, signal: null });
  });

  it('sehr langsame Verbindung: Teilkompensation bis cap', () => {
    expect(t(7_000, 6_000).effectiveMs).toBe(6_500);
  });

  it('manipulierter Client (C = 0): Vorteil höchstens cap', () => {
    expect(t(5_000, 0).effectiveMs).toBe(4_500);
  });

  it('S < cap ergibt nie eine negative Zeit', () => {
    expect(t(300, 0).effectiveMs).toBe(0);
    expect(t(0, 0).effectiveMs).toBe(0);
  });

  it('C > S wird auf S begrenzt', () => {
    expect(t(5_000, 9_000).effectiveMs).toBe(5_000);
  });

  it('Reload: S ohne Ausgleich', () => {
    expect(t(6_400, 6_100, true)).toEqual({
      effectiveMs: 6_400,
      clientTimeUsed: false,
      signal: null,
    });
  });

  it('Reload unterdrückt das Signal nicht', () => {
    expect(t(6_400, -5, true).signal).toBe('NEGATIVE_CLIENT_TIME');
    expect(t(6_400, 6_100.5, true).signal).toBe('NON_INTEGER_CLIENT_TIME');
  });

  it.each([undefined, null, '6000', {}])('verwirft fehlenden Client-Wert %j ohne Signal', (c) => {
    expect(t(6_400, c)).toEqual({ effectiveMs: 6_400, clientTimeUsed: false, signal: null });
  });

  it.each([6_100.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'verwirft nicht ganzzahligen Client-Wert %d mit Signal',
    (c) => {
      expect(t(6_400, c)).toEqual({
        effectiveMs: 6_400,
        clientTimeUsed: false,
        signal: 'NON_INTEGER_CLIENT_TIME',
      });
    },
  );

  it.each([-1, -6_100, -0.5, Number.NEGATIVE_INFINITY])(
    'verwirft negativen Client-Wert %d mit Signal',
    (c) => {
      expect(t(6_400, c)).toEqual({
        effectiveMs: 6_400,
        clientTimeUsed: false,
        signal: 'NEGATIVE_CLIENT_TIME',
      });
    },
  );

  it('Eigenschaft: max(0, S − cap) ≤ effective ≤ S, ganzzahlig', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60_000 }),
        fc.oneof(fc.integer({ min: -100, max: 70_000 }), fc.double(), fc.constant(undefined)),
        fc.integer({ min: 0, max: 2_000 }),
        fc.boolean(),
        (serverMs, clientMs, capMs, reloaded) => {
          const { effectiveMs } = effectiveAnswerTime({ serverMs, clientMs, capMs, reloaded });
          expect(Number.isInteger(effectiveMs)).toBe(true);
          expect(effectiveMs).toBeGreaterThanOrEqual(Math.max(0, serverMs - capMs));
          expect(effectiveMs).toBeLessThanOrEqual(serverMs);
        },
      ),
    );
  });

  it('lehnt ungültige Serverwerte ab', () => {
    expect(() => t(-1, 0)).toThrow(RangeError);
    expect(() => t(1.5, 0)).toThrow(RangeError);
  });
});
