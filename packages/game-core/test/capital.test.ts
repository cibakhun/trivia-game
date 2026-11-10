import { DAY_MS, HOUR_MS } from '@rdw/protocol';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { capitalLives, hitCapital, type CapitalDamage, type CapitalRules } from '../src/index.ts';

const RULES: CapitalRules = { lives: 3, lifeRegen: DAY_MS, protectionAfterHit: HOUR_MS };
const T0 = 1_800_000_000_000;
const UNHARMED: CapitalDamage = { hits: 0, lastHitAt: null };

describe('Hauptstadt-Leben (GAME_RULES §3)', () => {
  it('nimmt das Reich erst mit dem dritten Sieg ein', () => {
    expect(capitalLives(UNHARMED, RULES, T0)).toEqual({ lives: 3, maxLives: 3, nextLifeAt: null });

    const first = hitCapital(UNHARMED, RULES, T0);
    expect(first).toEqual({ kind: 'HIT', damage: { hits: 1, lastHitAt: T0 }, livesLeft: 2 });
    if (first.kind !== 'HIT') throw new Error('unerwartet');
    expect(capitalLives(first.damage, RULES, T0)).toEqual({
      lives: 2,
      maxLives: 3,
      nextLifeAt: T0 + DAY_MS,
    });

    const t1 = T0 + 2 * HOUR_MS;
    const second = hitCapital(first.damage, RULES, t1);
    expect(second).toEqual({ kind: 'HIT', damage: { hits: 2, lastHitAt: t1 }, livesLeft: 1 });
    if (second.kind !== 'HIT') throw new Error('unerwartet');
    expect(hitCapital(second.damage, RULES, t1 + 2 * HOUR_MS)).toEqual({ kind: 'TAKEOVER' });
  });

  it('gibt je 24 h ohne Treffer ein Leben zurück, der Takt beginnt mit jedem Treffer neu', () => {
    const damage: CapitalDamage = { hits: 2, lastHitAt: T0 };
    expect(capitalLives(damage, RULES, T0 + DAY_MS - 1)).toMatchObject({
      lives: 1,
      nextLifeAt: T0 + DAY_MS,
    });
    expect(capitalLives(damage, RULES, T0 + DAY_MS)).toMatchObject({
      lives: 2,
      nextLifeAt: T0 + 2 * DAY_MS,
    });
    expect(capitalLives(damage, RULES, T0 + 5 * DAY_MS)).toEqual({
      lives: 3,
      maxLives: 3,
      nextLifeAt: null,
    });
    // Nach einem Tag ist ein Leben zurück: der nächste Treffer lässt wieder eines übrig
    const t = T0 + DAY_MS + HOUR_MS;
    expect(hitCapital(damage, RULES, t)).toEqual({
      kind: 'HIT',
      damage: { hits: 2, lastHitAt: t },
      livesLeft: 1,
    });
  });

  it('erholt sich ohne Erholungszeit nie und nimmt mit einem Leben sofort ein', () => {
    const noRegen = { ...RULES, lifeRegen: null };
    expect(capitalLives({ hits: 1, lastHitAt: T0 }, noRegen, T0 + 100 * DAY_MS)).toEqual({
      lives: 2,
      maxLives: 3,
      nextLifeAt: null,
    });
    expect(hitCapital(UNHARMED, { ...RULES, lives: 1 }, T0)).toEqual({ kind: 'TAKEOVER' });
  });

  it('bleibt in den Grenzen, auch wenn die Regeln später weniger Leben geben', () => {
    expect(capitalLives({ hits: 4, lastHitAt: T0 }, RULES, T0)).toMatchObject({ lives: 0 });
    expect(hitCapital({ hits: 4, lastHitAt: T0 }, RULES, T0)).toEqual({ kind: 'TAKEOVER' });
    expect(() => capitalLives(UNHARMED, { ...RULES, lives: 0 }, T0)).toThrow(RangeError);
    expect(() => hitCapital(UNHARMED, { ...RULES, lifeRegen: 0 }, T0)).toThrow(RangeError);
  });

  it('braucht von jedem Stand aus höchstens so viele Siege, wie Leben übrig sind', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 10 * DAY_MS }),
        fc.array(fc.integer({ min: 0, max: 3 * DAY_MS }), { minLength: 1, maxLength: 8 }),
        (lives, hits, sinceHit, gaps) => {
          const rules = { ...RULES, lives };
          let damage: CapitalDamage = hits > 0 ? { hits, lastHitAt: T0 } : UNHARMED;
          let now = T0 + sinceHit;
          for (const gap of gaps) {
            const before = capitalLives(damage, rules, now);
            expect(before.lives).toBeGreaterThanOrEqual(0);
            expect(before.lives).toBeLessThanOrEqual(lives);
            const hit = hitCapital(damage, rules, now);
            if (before.lives <= 1) {
              expect(hit.kind).toBe('TAKEOVER');
              return;
            }
            expect(hit).toMatchObject({ kind: 'HIT', livesLeft: before.lives - 1 });
            if (hit.kind !== 'HIT') return;
            expect(capitalLives(hit.damage, rules, now).lives).toBe(before.lives - 1);
            damage = hit.damage;
            now += gap;
          }
        },
      ),
    );
  });
});
