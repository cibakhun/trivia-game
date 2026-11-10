import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/infra/errors.ts';
import { LoginThrottle } from '../src/modules/identity/throttle.ts';

const MINUTE = 60_000;

function throttle(maxWindows: number, clock: { now: number }) {
  return new LoginThrottle({
    perName: { failures: 2, windowMs: 15 * MINUTE },
    perAddress: { failures: 1000, windowMs: 15 * MINUTE },
    maxWindows,
    now: () => clock.now,
  });
}

function blocked(t: LoginThrottle, name: string, address: string): boolean {
  try {
    t.assertAllowed(name, address);
    return false;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'RATE_LIMITED') return true;
    throw error;
  }
}

describe('Anmeldebremse im Speicher', () => {
  it('hält höchstens maxWindows Fenster und verdrängt die ältesten', () => {
    const clock = { now: 0 };
    const t = throttle(10, clock);
    t.recordFailure('erster', 'a0');
    t.recordFailure('erster', 'a0');
    expect(blocked(t, 'erster', 'a0')).toBe(true);

    // Viele Adressen mit immer neuen Namen, alle im selben Fenster
    for (let i = 1; i <= 50; i += 1) {
      clock.now += 1;
      t.recordFailure(`name-${i}`, `a${i}`);
      expect(t.size).toBeLessThanOrEqual(10);
    }
    // Die ältesten Fenster sind verdrängt, die jüngsten zählen weiter
    expect(blocked(t, 'erster', 'a0')).toBe(false);
    t.recordFailure('name-50', 'a50');
    expect(blocked(t, 'name-50', 'a50')).toBe(true);
  });

  it('entfernt abgelaufene Fenster zuerst', () => {
    const clock = { now: 0 };
    const t = throttle(4, clock);
    t.recordFailure('alt', 'x');
    clock.now += 16 * MINUTE;
    t.recordFailure('neu', 'y');
    t.recordFailure('neu', 'y');
    t.recordFailure('dritter', 'z');
    expect(t.size).toBeLessThanOrEqual(4);
    expect(blocked(t, 'neu', 'y')).toBe(true);
  });
});
