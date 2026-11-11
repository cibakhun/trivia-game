import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_RULES,
  MATCH_MAP_BY_SEATS,
  matchRulesForSeats,
  matchRulesSchema,
  PLAYTEST_MATCH_RULES,
  SECOND_MS,
  type MatchRules,
} from '../src/index.ts';

function clone(rules: MatchRules = DEFAULT_MATCH_RULES): MatchRules {
  return JSON.parse(JSON.stringify(rules)) as MatchRules;
}

describe('Regeln der Partie', () => {
  it('Standard- und Spieltestwerte sind gültig', () => {
    expect(matchRulesSchema.parse(DEFAULT_MATCH_RULES)).toEqual(DEFAULT_MATCH_RULES);
    expect(matchRulesSchema.parse(PLAYTEST_MATCH_RULES)).toEqual(PLAYTEST_MATCH_RULES);
  });

  it('entspricht dem Plan (MATCH_RULES §8)', () => {
    const r = DEFAULT_MATCH_RULES;
    expect(r.seats).toBe(3);
    expect(r.capital).toEqual({ lives: 3, minDistance: 2 });
    expect(r.landGrab.picksByPlace).toEqual([2, 1, 0]);
    expect(r.campaign.rounds).toBe(4);
    expect(r.values).toEqual({ region: 100, capital: 300, defenseBonus: 50 });
    expect(r.timers).toMatchObject({
      triviaMs: 15 * SECOND_MS,
      estimateMs: 20 * SECOND_MS,
      pickMs: 10 * SECOND_MS,
      revealMs: 6 * SECOND_MS,
      announceMs: 2500,
      pickShowMs: 1200,
    });
  });

  it('Ansage und gezeigte Wahl sind in alten Regeln nicht vorhanden und bleiben gültig', () => {
    const { announceMs, pickShowMs, ...oldTimers } = DEFAULT_MATCH_RULES.timers;
    expect(announceMs).toBeGreaterThan(0);
    expect(pickShowMs).toBeGreaterThan(0);
    const old = matchRulesSchema.parse({ ...DEFAULT_MATCH_RULES, timers: oldTimers });
    expect(old.timers.announceMs).toBeUndefined();
    expect(old.timers.pickShowMs).toBeUndefined();
    // Auch der Spieltest zeigt Wahl und Ansage, nur kürzer
    expect(PLAYTEST_MATCH_RULES.timers.announceMs).toBeLessThan(announceMs ?? 0);
    expect(PLAYTEST_MATCH_RULES.timers.pickShowMs).toBeLessThan(pickShowMs ?? 0);
    expect(
      matchRulesSchema.safeParse({
        ...DEFAULT_MATCH_RULES,
        timers: { ...DEFAULT_MATCH_RULES.timers, announceMs: 60 * SECOND_MS },
      }).success,
    ).toBe(false);
  });

  it('Spieltest ändert nur die Zeiten', () => {
    expect({ ...PLAYTEST_MATCH_RULES, timers: DEFAULT_MATCH_RULES.timers }).toEqual(
      DEFAULT_MATCH_RULES,
    );
  });

  it('passt Spielerzahl, Karte und Landnahme für zwei Spieler an', () => {
    const two = matchRulesForSeats(DEFAULT_MATCH_RULES, 2);
    expect(matchRulesSchema.parse(two)).toEqual(two);
    expect(two.seats).toBe(2);
    expect(two.map).toBe('KERNMARK');
    expect(two.landGrab.picksByPlace).toEqual([2, 1]);
    expect({
      ...two,
      seats: 3,
      map: 'WENDELMARK',
      landGrab: DEFAULT_MATCH_RULES.landGrab,
    }).toEqual(DEFAULT_MATCH_RULES);
    expect(MATCH_MAP_BY_SEATS).toEqual({ 2: 'KERNMARK', 3: 'WENDELMARK' });
    expect(matchRulesSchema.safeParse({ ...DEFAULT_MATCH_RULES, map: 'ANDERSWO' }).success).toBe(
      false,
    );
    expect(matchRulesForSeats(two, 3)).toEqual(DEFAULT_MATCH_RULES);
    expect(matchRulesSchema.safeParse({ ...DEFAULT_MATCH_RULES, seats: 4 }).success).toBe(false);
    expect(matchRulesSchema.safeParse({ ...DEFAULT_MATCH_RULES, seats: 1 }).success).toBe(false);
  });

  it('lehnt unstimmige Landnahme-Wahlen ab', () => {
    const wrongLength = clone();
    wrongLength.landGrab.picksByPlace = [2, 1];
    expect(matchRulesSchema.safeParse(wrongLength).success).toBe(false);

    const rising = clone();
    rising.landGrab.picksByPlace = [1, 2, 0];
    expect(matchRulesSchema.safeParse(rising).success).toBe(false);

    const nobody = clone();
    nobody.landGrab.picksByPlace = [0, 0, 0];
    expect(matchRulesSchema.safeParse(nobody).success).toBe(false);
  });

  it('lehnt Zeiten in Sekunden statt Millisekunden und unbekannte Felder ab', () => {
    const seconds = clone();
    seconds.timers.triviaMs = 15;
    expect(matchRulesSchema.safeParse(seconds).success).toBe(false);

    const extra = { ...clone(), bonus: 1 };
    expect(matchRulesSchema.safeParse(extra).success).toBe(false);
  });
});
