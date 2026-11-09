import {
  DEFAULT_RULES,
  HOUR_MS,
  MINUTE_MS,
  SECOND_MS,
  rulesConfigSchema,
  type RulesConfig,
  WORLD_MODES,
} from '@rdw/protocol';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  answerDeadlineAt,
  canStartDefense,
  extendDeadline,
  fitsBeforeSeasonEnd,
  isBeforeDeadline,
  isStepTimeoutDue,
  isTimeoutDue,
  maxChallengeDurationMs,
  openSiegeDeadlines,
  pvpAttackCutoffAt,
} from '../src/index.ts';

const ETERNAL = DEFAULT_RULES.ETERNAL;
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

describe('openSiegeDeadlines', () => {
  it('Eternal: 24 h Grundfrist, höchstens 48 h', () => {
    expect(openSiegeDeadlines(T0, ETERNAL.defense)).toEqual({
      openedAt: T0,
      baseDeadlineAt: T0 + 24 * HOUR_MS,
      deadlineAt: T0 + 24 * HOUR_MS,
      maxDeadlineAt: T0 + 48 * HOUR_MS,
    });
  });

  it('lehnt negative, gebrochene und vertauschte Dauern ab', () => {
    const open = (baseDeadline: number, maxDeadline: number) =>
      openSiegeDeadlines(T0, { baseDeadline, maxDeadline });
    expect(() => open(-HOUR_MS, HOUR_MS)).toThrow(/baseDeadline/);
    expect(() => open(-2 * HOUR_MS, -HOUR_MS)).toThrow(/baseDeadline/);
    expect(() => open(HOUR_MS, 1.5 * HOUR_MS + 0.5)).toThrow(/maxDeadline/);
    expect(() => open(2 * HOUR_MS, HOUR_MS)).toThrow(/maxDeadline < baseDeadline/);
  });
});

describe('Fristgrenze (SIEGE_SYSTEM §6.1)', () => {
  const deadlineAt = T0 + 24 * HOUR_MS;
  it('ist exklusiv', () => {
    expect(isBeforeDeadline(deadlineAt - 1, deadlineAt)).toBe(true);
    expect(isBeforeDeadline(deadlineAt, deadlineAt)).toBe(false);
  });

  it('Timeout wirkt erst ab deadline + settleGrace', () => {
    const siege = { deadlineAt, settleGrace: 5 * SECOND_MS };
    expect(isTimeoutDue(siege, deadlineAt)).toBe(false);
    expect(isTimeoutDue(siege, deadlineAt + 4_999)).toBe(false);
    expect(isTimeoutDue(siege, deadlineAt + 5_000)).toBe(true);
  });

  it('Schritt-Zeitlimit: P + Zeitlimit + cap, TIMED_OUT erst nach settleGrace', () => {
    const due = answerDeadlineAt(T0, 20_000, 500);
    expect(due).toBe(T0 + 20_500);
    expect(isBeforeDeadline(T0 + 20_499, due)).toBe(true);
    expect(isBeforeDeadline(T0 + 20_500, due)).toBe(false);
    expect(isStepTimeoutDue(due, due + 4_999, 5_000)).toBe(false);
    expect(isStepTimeoutDue(due, due + 5_000, 5_000)).toBe(true);
  });
});

describe('canStartDefense (SIEGE_SYSTEM §6.2)', () => {
  it('maximale Herausforderungsdauer Eternal = 20,5 s + 30,5 s = 51 s', () => {
    expect(maxChallengeDurationMs(ETERNAL.quiz)).toBe(51_000);
  });

  it('verlangt ≈ 61 s Restzeit (51 s + 10 s Puffer)', () => {
    const deadlineAt = T0 + HOUR_MS;
    expect(canStartDefense(deadlineAt, deadlineAt - 61_000, ETERNAL)).toEqual({ ok: true });
    expect(canStartDefense(deadlineAt, deadlineAt - 60_999, ETERNAL)).toEqual({
      ok: false,
      error: 'DEADLINE_TOO_CLOSE',
    });
    expect(canStartDefense(deadlineAt, deadlineAt, ETERNAL)).toEqual({
      ok: false,
      error: 'DEADLINE_PASSED',
    });
  });

  it('protocol prüft dieselbe Mindestdauer wie game-core', () => {
    for (const mode of WORLD_MODES) {
      const cfg = JSON.parse(JSON.stringify(DEFAULT_RULES[mode])) as RulesConfig; // veränderbare Kopie
      const min = maxChallengeDurationMs(cfg.quiz) + cfg.defense.startBuffer;
      cfg.defense.baseDeadline = min;
      cfg.defense.maxDeadline = cfg.items.enabled ? Math.max(min, cfg.defense.maxDeadline) : min;
      if (cfg.items.enabled) cfg.items.autoUse.triggerBeforeDeadline = 0;
      expect(rulesConfigSchema.safeParse(cfg).success).toBe(true);
      cfg.defense.baseDeadline = min - 1;
      if (!cfg.items.enabled) cfg.defense.maxDeadline = min - 1;
      expect(rulesConfigSchema.safeParse(cfg).success).toBe(false);
    }
  });
});

describe('extendDeadline (SIEGE_SYSTEM §6.3)', () => {
  const opened = openSiegeDeadlines(T0, ETERNAL.defense);
  const now = T0 + HOUR_MS;

  it('verlängert um den Effekt', () => {
    expect(extendDeadline(opened, 6 * HOUR_MS, now)).toEqual({
      ok: true,
      newDeadlineAt: T0 + 30 * HOUR_MS,
      gainedMs: 6 * HOUR_MS,
      forfeitedMs: 0,
    });
  });

  it('kappt an max_deadline und meldet den verfallenden Rest („+12 h, davon 4 h wirksam“)', () => {
    const siege = { deadlineAt: T0 + 44 * HOUR_MS, maxDeadlineAt: opened.maxDeadlineAt };
    expect(extendDeadline(siege, 12 * HOUR_MS, now)).toEqual({
      ok: true,
      newDeadlineAt: T0 + 48 * HOUR_MS,
      gainedMs: 4 * HOUR_MS,
      forfeitedMs: 8 * HOUR_MS,
    });
  });

  it('lehnt bei erreichter Grenze ohne Verbrauch ab (E2E-07)', () => {
    const siege = { deadlineAt: opened.maxDeadlineAt, maxDeadlineAt: opened.maxDeadlineAt };
    expect(extendDeadline(siege, 6 * HOUR_MS, now)).toEqual({
      ok: false,
      error: 'EXTENSION_LIMIT_REACHED',
    });
  });

  it('lehnt nach Fristende ab', () => {
    expect(extendDeadline(opened, 6 * HOUR_MS, opened.deadlineAt)).toEqual({
      ok: false,
      error: 'DEADLINE_PASSED',
    });
  });

  it('lehnt ab, wenn sich die erwartete neue Frist geändert hat', () => {
    expect(extendDeadline(opened, 6 * HOUR_MS, now, T0 + 30 * HOUR_MS).ok).toBe(true);
    expect(extendDeadline(opened, 6 * HOUR_MS, now, T0 + 31 * HOUR_MS)).toEqual({
      ok: false,
      error: 'DEADLINE_CHANGED',
    });
  });

  it('Eigenschaft: deadline ≤ max_deadline für jede Folge von Verlängerungen', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(6 * HOUR_MS, 12 * HOUR_MS, 24 * HOUR_MS), { maxLength: 20 }),
        (effects) => {
          let siege = { deadlineAt: opened.deadlineAt, maxDeadlineAt: opened.maxDeadlineAt };
          let consumed = 0;
          for (const effect of effects) {
            const r = extendDeadline(siege, effect, now);
            if (r.ok) {
              consumed++;
              expect(r.newDeadlineAt).toBeGreaterThan(siege.deadlineAt);
              siege = { ...siege, deadlineAt: r.newDeadlineAt };
            } else {
              expect(r.error).toBe('EXTENSION_LIMIT_REACHED');
            }
            expect(siege.deadlineAt).toBeLessThanOrEqual(siege.maxDeadlineAt);
          }
          // Höchstens so viele Items werden verbraucht, wie bis zur Grenze nötig sind.
          expect(consumed).toBeLessThanOrEqual(4);
        },
      ),
    );
  });
});

describe('Saisonende (WORLD_SYSTEM §6.2)', () => {
  const endsAt = Date.UTC(2026, 10, 16, 0, 0, 0);

  it('Weekly: Angriffsschluss 4 h 1 min vor Saisonende', () => {
    expect(endsAt - pvpAttackCutoffAt(endsAt, DEFAULT_RULES.WEEKLY)).toBe(4 * HOUR_MS + MINUTE_MS);
  });

  it('Daily: Angriffsschluss 16 min vor Saisonende', () => {
    expect(endsAt - pvpAttackCutoffAt(endsAt, DEFAULT_RULES.DAILY)).toBe(16 * MINUTE_MS);
  });

  it('eine zum Angriffsschluss eröffnete Belagerung endet vor Saisonende', () => {
    for (const mode of ['WEEKLY', 'DAILY'] as const) {
      const rules = DEFAULT_RULES[mode];
      const cutoff = pvpAttackCutoffAt(endsAt, rules);
      // Angriff startet knapp vor dem Schluss, Eröffnung nach maximaler Angriffsdauer
      const openedAt = cutoff - 1 + maxChallengeDurationMs(rules.quiz);
      const { maxDeadlineAt } = openSiegeDeadlines(openedAt, rules.defense);
      expect(fitsBeforeSeasonEnd(maxDeadlineAt, rules.defense.settleGrace, endsAt)).toBe(true);
    }
  });

  it('fitsBeforeSeasonEnd ist an der Grenze inklusiv', () => {
    expect(fitsBeforeSeasonEnd(endsAt - 5_000, 5_000, endsAt)).toBe(true);
    expect(fitsBeforeSeasonEnd(endsAt - 4_999, 5_000, endsAt)).toBe(false);
  });
});
