import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  DEFAULT_RULES,
  HOUR_MS,
  MINUTE_MS,
  parseRulesConfig,
  rulesConfigSchema,
  SECOND_MS,
  WORLD_MODES,
  type RulesConfig,
} from '../src/index.ts';

/** Tiefe, veränderbare Kopie für Negativtests. */
function clone(mode: keyof typeof DEFAULT_RULES): RulesConfig {
  return JSON.parse(JSON.stringify(DEFAULT_RULES[mode])) as RulesConfig;
}

describe('DEFAULT_RULES', () => {
  it.each(WORLD_MODES)('%s ist gültig und trägt seinen Modus', (mode) => {
    expect(parseRulesConfig(DEFAULT_RULES[mode])).toEqual(DEFAULT_RULES[mode]);
    expect(DEFAULT_RULES[mode].mode).toBe(mode);
  });

  it('entspricht der Parametertabelle in GAME_RULES §10', () => {
    const { ETERNAL: e, WEEKLY: w, DAILY: d } = DEFAULT_RULES;
    expect([e, w, d].map((r) => r.defense.baseDeadline)).toEqual([
      24 * HOUR_MS,
      4 * HOUR_MS,
      15 * MINUTE_MS,
    ]);
    expect([e, w, d].map((r) => r.defense.maxDeadline)).toEqual([
      48 * HOUR_MS,
      4 * HOUR_MS,
      15 * MINUTE_MS,
    ]);
    expect([e, w, d].map((r) => r.defense.startBuffer)).toEqual(
      [10, 10, 10].map((s) => s * SECOND_MS),
    );
    expect([e, w, d].map((r) => r.defense.settleGrace)).toEqual(
      [5, 5, 5].map((s) => s * SECOND_MS),
    );
    expect([e, w, d].map((r) => r.defense.pointsForDefending)).toEqual([5, 2, 2]);
    expect([e, w, d].map((r) => r.defense.pointsBonusCorrect)).toEqual([5, 3, 3]);
    expect([e, w, d].map((r) => r.defense.pointsPairLimitPerDay)).toEqual([2, 2, 2]);
    expect([e, w, d].map((r) => r.quiz.triviaTimeLimit)).toEqual(
      [20, 20, 15].map((s) => s * SECOND_MS),
    );
    expect([e, w, d].map((r) => r.quiz.estimateTimeLimit)).toEqual(
      [30, 30, 25].map((s) => s * SECOND_MS),
    );
    expect([e, w, d].map((r) => r.quiz.latencyAllowanceCapMs)).toEqual([500, 500, 500]);
    expect([e, w, d].map((r) => r.attack.maxNewPvpSiegesPerAttacker)).toEqual([
      { count: 3, windowMs: DAY_MS },
      { count: 6, windowMs: DAY_MS },
      { count: 4, windowMs: HOUR_MS },
    ]);
    expect([e, w, d].map((r) => r.attack.maxPvpAttemptsPerAttacker)).toEqual([
      { count: 6, windowMs: DAY_MS },
      { count: 12, windowMs: DAY_MS },
      { count: 8, windowMs: HOUR_MS },
    ]);
    expect([e, w, d].map((r) => r.attack.maxOpenSiegesPerDefender)).toEqual([4, 3, 2]);
    expect([e, w, d].map((r) => r.attack.maxPveAttemptsPerPlayer.count)).toEqual([50, 60, null]);
    expect([e, w, d].map((r) => r.protection.afterConquest)).toEqual([
      6 * HOUR_MS,
      HOUR_MS,
      5 * MINUTE_MS,
    ]);
    expect([e, w, d].map((r) => r.protection.newPlayer)).toEqual([
      { duration: 72 * HOUR_MS, untilRegions: 10 },
      { duration: 2 * HOUR_MS, untilRegions: null },
      { duration: 15 * MINUTE_MS, untilRegions: null },
    ]);
    expect([e, w, d].map((r) => r.protection.respawn)).toEqual([
      24 * HOUR_MS,
      HOUR_MS,
      10 * MINUTE_MS,
    ]);
    expect([e, w, d].map((r) => r.protection.rankGap)).toEqual([
      { factor: 4, maxTargetRegions: 15 },
      { factor: 4, maxTargetRegions: 10 },
      null,
    ]);
    expect([e, w, d].map((r) => r.items.enabled)).toEqual([true, false, false]);
    expect(e.items).toEqual({
      enabled: true,
      inventoryCap: 10,
      dropEligibleConquestsPerDay: 6,
      regionRewardCooldown: 24 * HOUR_MS,
      pairRewardLimitPerDay: 2,
      pendingRewardExpiry: 7 * DAY_MS,
      autoUse: { triggerBeforeDeadline: 6 * HOUR_MS },
    });
    expect([e, w, d].map((r) => r.npc.maxActionsPerFactionPerHour)).toEqual([2, 4, 12]);
    expect([e, w, d].map((r) => r.npc.maxOpenSiegesAgainstHumanKingdom)).toEqual([1, 1, 1]);
  });

  it('ist unveränderlich', () => {
    expect(Object.isFrozen(DEFAULT_RULES.ETERNAL.defense)).toBe(true);
    expect(() => {
      (DEFAULT_RULES.ETERNAL.defense as { baseDeadline: number }).baseDeadline = 1;
    }).toThrow(TypeError);
  });
});

describe('rulesConfigSchema', () => {
  const issues = (cfg: unknown) => {
    const result = rulesConfigSchema.safeParse(cfg);
    return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
  };

  it('lehnt unbekannte Schlüssel ab (Tippfehler fallen auf)', () => {
    const cfg = { ...clone('ETERNAL'), defence: {} };
    expect(issues(cfg)).toContain('');
  });

  it('lehnt nicht ganzzahlige oder negative Dauern ab', () => {
    const a = clone('ETERNAL');
    a.defense.settleGrace = 1.5;
    expect(issues(a)).toContain('defense.settleGrace');
    const b = clone('ETERNAL');
    b.defense.startBuffer = -1;
    expect(issues(b)).toContain('defense.startBuffer');
  });

  it('verlangt maxDeadline ≥ baseDeadline', () => {
    const cfg = clone('ETERNAL');
    cfg.defense.maxDeadline = cfg.defense.baseDeadline - 1;
    expect(issues(cfg)).toContain('defense.maxDeadline');
  });

  it('verlangt maxDeadline = baseDeadline, wenn Items aus sind', () => {
    const cfg = clone('WEEKLY');
    cfg.defense.maxDeadline = cfg.defense.baseDeadline + HOUR_MS;
    expect(issues(cfg)).toContain('defense.maxDeadline');
  });

  it('verlangt eine Grundfrist, in die eine vollständige Verteidigung passt', () => {
    const cfg = clone('DAILY');
    // 15 s + 25 s + 2 × 0,5 s + 10 s = 51 s
    cfg.defense.baseDeadline = 50_999;
    cfg.defense.maxDeadline = 50_999;
    expect(issues(cfg)).toContain('defense.baseDeadline');
    cfg.defense.baseDeadline = 51_000;
    cfg.defense.maxDeadline = 51_000;
    expect(issues(cfg)).toEqual([]);
  });

  it('verlangt mindestens so viele Versuche wie Belagerungen', () => {
    const cfg = clone('ETERNAL');
    cfg.attack.maxPvpAttemptsPerAttacker = { count: 2, windowMs: DAY_MS };
    expect(issues(cfg)).toContain('attack.maxPvpAttemptsPerAttacker.count');
  });

  it('verlangt die Item-Felder nur, wenn Items aktiv sind', () => {
    const cfg = clone('ETERNAL') as unknown as { items: Record<string, unknown> };
    delete cfg.items.inventoryCap;
    expect(issues(cfg)).toContain('items.inventoryCap');
    const weekly = clone('WEEKLY') as unknown as { items: Record<string, unknown> };
    weekly.items.inventoryCap = 10;
    expect(issues(weekly)).toContain('items');
  });

  it('lehnt Auto-Verwendung außerhalb der Grundfrist ab', () => {
    const cfg = clone('ETERNAL');
    if (!cfg.items.enabled) throw new Error('Eternal hat Items');
    cfg.items.autoUse.triggerBeforeDeadline = cfg.defense.baseDeadline;
    expect(issues(cfg)).toContain('items.autoUse.triggerBeforeDeadline');
  });
});
