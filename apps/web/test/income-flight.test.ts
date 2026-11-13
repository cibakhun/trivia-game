import { describe, expect, it } from 'vitest';
import {
  incomeHeld,
  incomeTiming,
  incomeWatch,
  type IncomeWatch,
} from '../src/match/income-flight.ts';

/**
 * Zeitplan des Einkommens als Bewegung (ADR-067): Die Zeichen fliegen nacheinander ab, die Vorräte
 * zählen mit den Ankünften mit, und auch ein großes Reich braucht nicht länger als ein kleines.
 */

describe('Zeitplan des Einkommens', () => {
  it('lässt ein einzelnes Zeichen ohne Abstand fliegen', () => {
    const one = incomeTiming(1);
    expect(one.staggerMs).toBe(0);
    expect(one.countAtMs).toBeLessThan(one.startMs + one.flightMs);
    expect(one.totalMs).toBeGreaterThan(one.startMs + one.flightMs);
    expect(incomeTiming(0).staggerMs).toBe(0);
  });

  it('staffelt wenige Zeichen mit festem Abstand', () => {
    expect(incomeTiming(4).staggerMs).toBe(80);
    expect(incomeTiming(9).staggerMs).toBe(80);
  });

  it('rückt viele Zeichen enger zusammen, damit es nicht länger dauert', () => {
    const many = incomeTiming(24);
    expect(many.staggerMs).toBeLessThan(80);
    expect(many.staggerMs * 23).toBeCloseTo(640, 6);
    expect(many.totalMs).toBe(incomeTiming(9).totalMs);
    expect(many.totalMs).toBeLessThanOrEqual(2100);
  });

  it('zählt die Vorräte vom ersten bis zum letzten Zeichen hoch', () => {
    for (const count of [1, 3, 9, 24]) {
      const time = incomeTiming(count);
      const first = time.startMs + time.flightMs;
      const last = first + (count - 1) * time.staggerMs;
      expect(time.countAtMs).toBeLessThanOrEqual(first);
      expect(time.countAtMs + time.countMs).toBeGreaterThanOrEqual(last);
      expect(time.totalMs).toBeGreaterThan(time.countAtMs + time.countMs);
    }
  });
});

/**
 * Der Server verbucht das Einkommen mit dem Ende des letzten Duells der Runde, die Rüstzeit beginnt
 * erst nach dessen Auflösung. Die Vorräte warten so lange, sonst stünde die neue Zahl schon da,
 * bevor ein Zeichen fliegt.
 */
describe('Einkommen zwischen Verbuchen und Rüstzeit', () => {
  const before: IncomeWatch = { seen: 40, playing: null };

  it('hält ein Einkommen zurück, das während der Auflösung kommt', () => {
    const during = incomeWatch(before, 57, false, false, true);
    expect(during).toBe(before);
    expect(incomeHeld(during, 57)).toBe(true);
  });

  it('lässt es fliegen, sobald die eigene Rüstzeit steht, und gibt die Vorräte frei', () => {
    const start = incomeWatch(before, 57, true, true, true);
    expect(start).toEqual({ seen: 57, playing: 57 });
    expect(incomeHeld(start, 57)).toBe(false);
    // Danach ändert sich nichts mehr, bis das nächste Einkommen kommt
    expect(incomeWatch(start, 57, true, true, true)).toBe(start);
  });

  it('zeigt nur die Zahl, wenn die Seite den Wechsel nicht miterlebt hat', () => {
    const start = incomeWatch(before, 57, true, true, false);
    expect(start).toEqual({ seen: 57, playing: null });
    expect(incomeHeld(start, 57)).toBe(false);
  });

  it('gibt die Vorräte frei, wenn die Partie ohne eigene Rüstzeit weitergeht', () => {
    // Zuschauer, gefallenes Reich, nur noch Bots: Es fliegt nichts, die Zahl steht
    const on = incomeWatch(before, 57, false, true, true);
    expect(on).toEqual({ seen: 57, playing: null });
    expect(incomeHeld(on, 57)).toBe(false);
  });

  it('hält nichts zurück, wenn die Seite mit diesem Stand geladen wurde', () => {
    const loaded: IncomeWatch = { seen: 57, playing: null };
    expect(incomeHeld(loaded, 57)).toBe(false);
    expect(incomeWatch(loaded, 57, false, false, false)).toBe(loaded);
  });
});
