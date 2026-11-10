import { ATTACK_REFUSAL_CODES, DAY_MS, HOUR_MS } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  ATTACK_REFUSALS,
  attemptResetAt,
  checkAttackEligibility,
  isAdjacentToAny,
  type AttackEligibilityInput,
} from '../src/index.ts';

const NOW = 1_800_000_000_000;

function input(overrides: Partial<AttackEligibilityInput> = {}): AttackEligibilityInput {
  return {
    now: NOW,
    instanceRunning: true,
    attacker: { id: 'a', regionCount: 3 },
    target: { ownerKingdomId: null, protectedUntil: null, underSiege: false },
    defender: null,
    adjacent: true,
    challengeInProgress: false,
    pveAttemptTimes: [],
    rules: {
      maxPveAttemptsPerPlayer: { count: 50, windowMs: DAY_MS },
      rankGap: { factor: 4, maxTargetRegions: 15 },
    },
    ...overrides,
  };
}

const npc = { kind: 'NPC' as const, regionCount: 10, protectedUntil: null };

describe('Angriffsberechtigung (GAME_RULES §4)', () => {
  it('erlaubt PvE gegen neutrale Garnisonen und NPC-Reiche', () => {
    expect(checkAttackEligibility(input())).toEqual({
      ok: true,
      mode: 'PVE',
      defenderKind: 'NEUTRAL',
    });
    expect(
      checkAttackEligibility(
        input({
          target: { ownerKingdomId: 'n', protectedUntil: null, underSiege: false },
          defender: npc,
        }),
      ),
    ).toEqual({ ok: true, mode: 'PVE', defenderKind: 'NPC' });
  });

  it('meldet PvP für Spielerreiche', () => {
    const result = checkAttackEligibility(
      input({
        target: { ownerKingdomId: 'p', protectedUntil: null, underSiege: false },
        defender: { kind: 'PLAYER', regionCount: 20, protectedUntil: null },
      }),
    );
    expect(result).toEqual({ ok: true, mode: 'PVP', defenderKind: 'PLAYER' });
  });

  it('prüft in der festgelegten Reihenfolge', () => {
    // alles falsch: die erste Prüfung gewinnt
    const all = input({
      instanceRunning: false,
      attacker: null,
      adjacent: false,
      challengeInProgress: true,
      target: { ownerKingdomId: null, protectedUntil: NOW + 1, underSiege: true },
    });
    expect(checkAttackEligibility(all)).toMatchObject({ refusal: 'INSTANCE_NOT_ACTIVE' });
    expect(checkAttackEligibility({ ...all, instanceRunning: true })).toMatchObject({
      refusal: 'NO_ACTIVE_KINGDOM',
    });
    const withAttacker = { ...all, instanceRunning: true, attacker: { id: 'a', regionCount: 1 } };
    expect(checkAttackEligibility(withAttacker)).toMatchObject({ refusal: 'NOT_ADJACENT' });
    expect(checkAttackEligibility({ ...withAttacker, adjacent: true })).toMatchObject({
      refusal: 'REGION_UNDER_SIEGE',
    });
    expect(
      checkAttackEligibility({
        ...withAttacker,
        adjacent: true,
        target: { ownerKingdomId: null, protectedUntil: NOW + 1, underSiege: false },
      }),
    ).toEqual({ ok: false, refusal: 'REGION_PROTECTED', details: { until: NOW + 1 } });
    expect(
      checkAttackEligibility({
        ...withAttacker,
        adjacent: true,
        target: { ownerKingdomId: null, protectedUntil: NOW, underSiege: false },
      }),
    ).toMatchObject({ refusal: 'CHALLENGE_IN_PROGRESS' });
  });

  it('lehnt eigene Regionen vor der Nachbarschaft ab', () => {
    const own = input({
      adjacent: false,
      target: { ownerKingdomId: 'a', protectedUntil: null, underSiege: false },
    });
    expect(checkAttackEligibility(own)).toMatchObject({ refusal: 'OWN_REGION' });
  });

  it('beachtet Reichsschutz und Rangabstand nur bei Spielerreichen', () => {
    const owned = { ownerKingdomId: 'p', protectedUntil: null, underSiege: false };
    expect(
      checkAttackEligibility(
        input({
          target: owned,
          defender: { kind: 'PLAYER', regionCount: 5, protectedUntil: NOW + HOUR_MS },
        }),
      ),
    ).toEqual({ ok: false, refusal: 'KINGDOM_PROTECTED', details: { until: NOW + HOUR_MS } });
    const big = { id: 'a', regionCount: 40 };
    expect(
      checkAttackEligibility(
        input({
          attacker: big,
          target: owned,
          defender: { kind: 'PLAYER', regionCount: 10, protectedUntil: null },
        }),
      ),
    ).toMatchObject({ refusal: 'RANK_GAP' });
    // ≥ 15 Regionen: kein Schutz mehr; NPC-Reiche nie
    expect(
      checkAttackEligibility(
        input({
          attacker: { id: 'a', regionCount: 100 },
          target: owned,
          defender: { kind: 'PLAYER', regionCount: 15, protectedUntil: null },
        }),
      ),
    ).toMatchObject({ ok: true, mode: 'PVP' });
    expect(
      checkAttackEligibility(input({ attacker: big, target: owned, defender: npc })),
    ).toMatchObject({ ok: true, mode: 'PVE' });
    expect(
      checkAttackEligibility(
        input({
          attacker: big,
          target: owned,
          defender: { kind: 'PLAYER', regionCount: 10, protectedUntil: null },
          rules: { maxPveAttemptsPerPlayer: { count: 1, windowMs: DAY_MS }, rankGap: null },
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it('begrenzt PvE-Versuche im gleitenden Fenster und nennt den Zeitpunkt der Freigabe', () => {
    const rules = { maxPveAttemptsPerPlayer: { count: 3, windowMs: DAY_MS }, rankGap: null };
    const times = [NOW - DAY_MS + 10, NOW - 1000, NOW - 500];
    expect(checkAttackEligibility(input({ rules, pveAttemptTimes: times }))).toEqual({
      ok: false,
      refusal: 'ATTACKER_ATTEMPT_LIMIT',
      details: { resetAt: NOW + 10 },
    });
    // ein Versuch ist aus dem Fenster gefallen
    expect(
      checkAttackEligibility(input({ rules, pveAttemptTimes: [NOW - DAY_MS, ...times.slice(1)] })),
    ).toMatchObject({ ok: true });
    // vier Versuche, zwei erlaubt: frei, sobald der dritte (t = 4) herausfällt
    expect(attemptResetAt([5, 1, 3, 4], { count: 2, windowMs: 100 }, 50)).toBe(104);
    expect(attemptResetAt([1, 2, 3], { count: null, windowMs: 100 }, 50)).toBeNull();
  });
});

describe('Nachbarschaft (GAME_RULES §4.4)', () => {
  it('prüft die Nachbarschaft zum eigenen Gebiet', () => {
    expect(isAdjacentToAny({ q: 0, r: 0 }, [{ q: 1, r: -1 }])).toBe(true);
    expect(isAdjacentToAny({ q: 0, r: 0 }, [{ q: 2, r: 0 }])).toBe(false);
    expect(isAdjacentToAny({ q: 0, r: 0 }, [])).toBe(false);
  });
});

describe('Ablehnungsgründe in der Schnittstelle', () => {
  it('entsprechen der Liste in protocol (plus PvP erst ab Phase 2)', () => {
    expect([...ATTACK_REFUSAL_CODES]).toEqual([...ATTACK_REFUSALS, 'PVP_NOT_AVAILABLE']);
  });
});
