import { describe, expect, it } from 'vitest';
import { botThinkMs } from '../src/modules/match/view.ts';

/**
 * Bedenkzeit, nach der ein Bot bei einer Wissensfrage als fertig angezeigt wird (API.md §2.6,
 * `question.answered`). Sie entscheidet nichts: Die Antwort des Bots steht beim Öffnen fest.
 */

const MATCH = '0190c2a0-0000-7000-8000-000000000001';
const OTHER = '0190c2a0-0000-7000-8000-000000000002';

describe('Bedenkzeit eines Bots', () => {
  it('ist je Partie, Frage und Sitz immer dieselbe', () => {
    expect(botThinkMs(MATCH, 7, 1, 8000)).toBe(botThinkMs(MATCH, 7, 1, 8000));
  });

  it('liegt zwischen einem Fünftel und gut der Hälfte der Antwortzeit', () => {
    for (const limit of [8000, 15000, 20000]) {
      for (let seq = 1; seq <= 40; seq++) {
        for (let seat = 0; seat < 3; seat++) {
          const ms = botThinkMs(MATCH, seq, seat, limit);
          expect(Number.isInteger(ms)).toBe(true);
          expect(ms).toBeGreaterThanOrEqual(limit * 0.2);
          expect(ms).toBeLessThanOrEqual(limit * 0.55);
        }
      }
    }
  });

  it('wechselt von Frage zu Frage, von Sitz zu Sitz und von Partie zu Partie', () => {
    const bySeq = new Set(Array.from({ length: 40 }, (_, seq) => botThinkMs(MATCH, seq, 1, 8000)));
    expect(bySeq.size).toBeGreaterThan(30);
    const bySeat = new Set([0, 1, 2].map((seat) => botThinkMs(MATCH, 7, seat, 8000)));
    expect(bySeat.size).toBe(3);
    expect(botThinkMs(MATCH, 7, 1, 8000)).not.toBe(botThinkMs(OTHER, 7, 1, 8000));
  });

  it('wächst mit der Antwortzeit der Frage', () => {
    // Derselbe Anteil der Zeit, bis auf die Rundung auf ganze Millisekunden
    const double = botThinkMs(MATCH, 7, 1, 16000) - botThinkMs(MATCH, 7, 1, 8000) * 2;
    expect(Math.abs(double)).toBeLessThanOrEqual(1);
  });
});
