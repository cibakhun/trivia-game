import { describe, expect, it } from 'vitest';
import { botPrepareMs } from '../src/modules/match/bot-think.ts';
import {
  nextPrepareWakeMs,
  prepareEndMs,
  prepareStartMs,
  type PendingBot,
} from '../src/modules/match/prepare-clock.ts';

describe('Uhr der Rüstzeit (ADR-085)', () => {
  it('Bedenkzeit eines Bots: fest je Partie, Runde und Sitz, zwischen 30 und 70 % der Rüstzeit', () => {
    const prepareMs = 40_000;
    const all: number[] = [];
    for (let round = 1; round <= 10; round++) {
      for (let seat = 0; seat < 3; seat++) {
        const ms = botPrepareMs('6f1c0d2e-match', round, seat, prepareMs);
        expect(ms).toBe(botPrepareMs('6f1c0d2e-match', round, seat, prepareMs));
        expect(ms).toBeGreaterThanOrEqual(prepareMs * 0.3);
        expect(ms).toBeLessThanOrEqual(prepareMs * 0.7);
        all.push(ms);
      }
    }
    // Nicht jeder Bot braucht gleich lang
    expect(new Set(all).size).toBeGreaterThan(20);
  });

  it('Beginn und Ende lassen sich aus jedem Weckpunkt zurückrechnen', () => {
    const totalMs = 42_000;
    const startMs = 1_000_000;
    const bots: PendingBot[] = [
      { seat: 2, delayMs: 13_000 },
      { seat: 0, delayMs: 21_500 },
    ];
    // Erst weckt der schnellere Bot, dann der langsamere, dann das Ende der Frist
    for (const pending of [bots, bots.slice(1), []]) {
      const deadline = startMs + nextPrepareWakeMs(pending, totalMs);
      expect(prepareStartMs(deadline, pending, totalMs)).toBe(startMs);
      expect(prepareEndMs(deadline, pending, totalMs)).toBe(startMs + totalMs);
    }
    expect(nextPrepareWakeMs(bots, totalMs)).toBe(13_000);
    expect(nextPrepareWakeMs([], totalMs)).toBe(totalMs);
  });
});
