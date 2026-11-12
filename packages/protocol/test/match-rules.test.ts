import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_ECONOMY,
  DEFAULT_MATCH_RULES,
  DEFAULT_REALM_RULES,
  isRealmRules,
  MATCH_MAP_BY_SEATS,
  matchRulesForSeats,
  matchRulesSchema,
  PLAYTEST_MATCH_RULES,
  PLAYTEST_REALM_RULES,
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

describe('Regeln der Partie mit Ausbau (MATCH_RULES §11, ADR-057)', () => {
  it('Standard- und Spieltestwerte sind gültig, die bisherige Partie hat keinen Ausbau', () => {
    expect(matchRulesSchema.parse(DEFAULT_REALM_RULES)).toEqual(DEFAULT_REALM_RULES);
    expect(matchRulesSchema.parse(PLAYTEST_REALM_RULES)).toEqual(PLAYTEST_REALM_RULES);
    expect(isRealmRules(DEFAULT_REALM_RULES)).toBe(true);
    expect(isRealmRules(DEFAULT_MATCH_RULES)).toBe(false);
    expect(DEFAULT_MATCH_RULES.economy).toBeUndefined();
  });

  it('entspricht dem freigegebenen Konzept (O-25 bis O-35), Landnahme und Erträge nach ADR-062', () => {
    const e = DEFAULT_MATCH_ECONOMY;
    expect(DEFAULT_REALM_RULES.campaign.rounds).toBe(5);
    expect(e.favorites).toBe(4);
    expect(e.startArmies).toBe(3);
    // Zwei Runden Landnahme; Dorf und Stadt bringen seitdem 3 und 4 statt 2 und 3 (O-41)
    expect(e.landGrabRounds).toBe(2);
    expect(e.yields).toEqual({ plain: 1, village: 3, town: 4, castleBread: 2, castleMaterial: 2 });
    expect(e.costs).toEqual({
      village: { bread: 1, material: 3 },
      town: { bread: 2, material: 6 },
      castle: { bread: 8, material: 16 },
      army: { bread: 2, material: 0 },
    });
    expect(e.tradeRate).toBe(3);
    expect(e.maxCastles).toBe(2);
    expect(e.armyCap).toBe(6);
    expect(e.lots).toEqual({ village: 2, town: 3, castle: 4, free: 2 });
    expect(e.timers).toEqual({
      prepareMs: 40 * SECOND_MS,
      ordersRevealMs: 2 * SECOND_MS,
      wheelMs: 3 * SECOND_MS,
    });
  });

  it('übernimmt sonst die Regeln der Partie; Spieltest ändert nur die Zeiten', () => {
    const { economy, campaign, ...rest } = DEFAULT_REALM_RULES;
    expect(economy).toBe(DEFAULT_MATCH_ECONOMY);
    expect(campaign).toEqual({ rounds: 5 });
    expect({ ...rest, campaign: DEFAULT_MATCH_RULES.campaign }).toEqual(DEFAULT_MATCH_RULES);
    expect({
      ...PLAYTEST_REALM_RULES,
      timers: DEFAULT_REALM_RULES.timers,
      economy: { ...PLAYTEST_REALM_RULES.economy, timers: DEFAULT_MATCH_ECONOMY.timers },
    }).toEqual(DEFAULT_REALM_RULES);
  });

  it('Runden der Landnahme: 1 bis 10; Partien von vor ADR-062 haben den Wert nicht', () => {
    const parse = (economy: unknown) =>
      matchRulesSchema.safeParse({ ...DEFAULT_REALM_RULES, economy }).success;
    const legacy = { ...DEFAULT_MATCH_ECONOMY };
    delete legacy.landGrabRounds;
    expect(parse(legacy)).toBe(true);
    expect(matchRulesSchema.parse({ ...DEFAULT_REALM_RULES, economy: legacy }).economy).toEqual(
      legacy,
    );
    expect(parse({ ...legacy, landGrabRounds: 1 })).toBe(true);
    expect(parse({ ...legacy, landGrabRounds: 10 })).toBe(true);
    expect(parse({ ...legacy, landGrabRounds: 0 })).toBe(false);
    expect(parse({ ...legacy, landGrabRounds: 11 })).toBe(false);
    expect(parse({ ...legacy, landGrabRounds: 1.5 })).toBe(false);
  });

  it('Angriff nur mit Armee: ALWAYS als Standard, RIVALS erlaubt; Partien von vor ADR-064 haben den Wert nicht', () => {
    const parse = (economy: unknown) =>
      matchRulesSchema.safeParse({ ...DEFAULT_REALM_RULES, economy }).success;
    expect(DEFAULT_MATCH_ECONOMY.attackNeedsArmy).toBe('ALWAYS');
    expect(PLAYTEST_REALM_RULES.economy?.attackNeedsArmy).toBe('ALWAYS');
    const legacy = { ...DEFAULT_MATCH_ECONOMY };
    delete legacy.attackNeedsArmy;
    expect(parse(legacy)).toBe(true);
    // Der Wert wird nicht nachgetragen: Eine laufende Partie spielt mit den Regeln ihres Beginns
    expect(matchRulesSchema.parse({ ...DEFAULT_REALM_RULES, economy: legacy }).economy).toEqual(
      legacy,
    );
    expect(parse({ ...legacy, attackNeedsArmy: 'ALWAYS' })).toBe(true);
    expect(parse({ ...legacy, attackNeedsArmy: 'RIVALS' })).toBe(true);
    expect(parse({ ...legacy, attackNeedsArmy: 'NEVER' })).toBe(false);
    expect(parse({ ...legacy, attackNeedsArmy: true })).toBe(false);
    expect(parse({ ...legacy, attackNeedsArmy: null })).toBe(false);
  });

  it('zu zweit bleibt der Ausbau erhalten', () => {
    const two = matchRulesForSeats(DEFAULT_REALM_RULES, 2);
    expect(matchRulesSchema.parse(two)).toEqual(two);
    expect(two.economy).toBe(DEFAULT_MATCH_ECONOMY);
    expect(two.map).toBe('KERNMARK');
  });

  it('lehnt Sekunden statt Millisekunden, negative Preise, zu viele Startarmeen und unbekannte Felder ab', () => {
    const parse = (economy: unknown) =>
      matchRulesSchema.safeParse({ ...DEFAULT_REALM_RULES, economy }).success;
    expect(
      parse({
        ...DEFAULT_MATCH_ECONOMY,
        timers: { ...DEFAULT_MATCH_ECONOMY.timers, prepareMs: 40 },
      }),
    ).toBe(false);
    expect(
      parse({
        ...DEFAULT_MATCH_ECONOMY,
        costs: { ...DEFAULT_MATCH_ECONOMY.costs, army: { bread: -1, material: 0 } },
      }),
    ).toBe(false);
    expect(parse({ ...DEFAULT_MATCH_ECONOMY, gold: 1 })).toBe(false);
    expect(parse({ ...DEFAULT_MATCH_ECONOMY, favorites: 0 })).toBe(false);
    expect(parse({ ...DEFAULT_MATCH_ECONOMY, armyCap: 0 })).toBe(false);
    // Die Startburg kann nicht über der Grenze je Feld beginnen
    expect(parse({ ...DEFAULT_MATCH_ECONOMY, startArmies: 6, armyCap: 6 })).toBe(true);
    expect(parse({ ...DEFAULT_MATCH_ECONOMY, startArmies: 7, armyCap: 6 })).toBe(false);
  });
});
