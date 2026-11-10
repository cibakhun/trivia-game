import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_RULES,
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
      revealMs: 5 * SECOND_MS,
    });
  });

  it('Spieltest ändert nur die Zeiten', () => {
    expect({ ...PLAYTEST_MATCH_RULES, timers: DEFAULT_MATCH_RULES.timers }).toEqual(
      DEFAULT_MATCH_RULES,
    );
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
