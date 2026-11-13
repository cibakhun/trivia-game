import { describe, expect, it } from 'vitest';
import { incomeTiming } from '../src/match/income-flight.ts';

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
