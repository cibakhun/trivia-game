import { ATTACK_REFUSAL_CODES, DAY_MS, HOUR_MS } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  ATTACK_REFUSALS,
  NO_PVP_COUNTS,
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
    pvp: NO_PVP_COUNTS,
    rules: RULES,
    ...overrides,
  };
}

const RULES: AttackEligibilityInput['rules'] = {
  maxPveAttemptsPerPlayer: { count: 50, windowMs: DAY_MS },
  rankGap: { factor: 4, maxTargetRegions: 15 },
  maxNewPvpSiegesPerAttacker: { count: 3, windowMs: DAY_MS },
  maxPvpAttemptsPerAttacker: { count: 6, windowMs: DAY_MS },
  maxOpenSiegesPerDefender: 4,
  capitalHitCooldownPerAttacker: 12 * HOUR_MS,
};

const npc = { kind: 'NPC' as const, regionCount: 10, protectedUntil: null };

describe('Angriffsberechtigung (GAME_RULES §4)', () => {
  it('erlaubt PvE gegen neutrale Garnisonen und NPC-Reiche', () => {
    expect(checkAttackEligibility(input())).toEqual({
      ok: true,
      mode: 'PVE',
      defenderKind: 'NEUTRAL',
      endsOwnProtection: false,
    });
    expect(
      checkAttackEligibility(
        input({
          target: { ownerKingdomId: 'n', protectedUntil: null, underSiege: false },
          defender: npc,
        }),
      ),
    ).toEqual({ ok: true, mode: 'PVE', defenderKind: 'NPC', endsOwnProtection: false });
  });

  it('meldet PvP für Spielerreiche', () => {
    const result = checkAttackEligibility(
      input({
        target: { ownerKingdomId: 'p', protectedUntil: null, underSiege: false },
        defender: { kind: 'PLAYER', regionCount: 20, protectedUntil: null },
      }),
    );
    expect(result).toEqual({
      ok: true,
      mode: 'PVP',
      defenderKind: 'PLAYER',
      endsOwnProtection: false,
    });
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
          rules: {
            ...RULES,
            maxPveAttemptsPerPlayer: { count: 1, windowMs: DAY_MS },
            rankGap: null,
          },
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it('begrenzt PvE-Versuche im gleitenden Fenster und nennt den Zeitpunkt der Freigabe', () => {
    const rules = {
      ...RULES,
      maxPveAttemptsPerPlayer: { count: 3, windowMs: DAY_MS },
      rankGap: null,
    };
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

describe('PvP-Angriffe (GAME_RULES §4 Punkt 8, SIEGE_SYSTEM §7)', () => {
  const owned = { ownerKingdomId: 'p', protectedUntil: null, underSiege: false };
  const player = { kind: 'PLAYER' as const, regionCount: 20, protectedUntil: null };
  const pvp = (overrides: Partial<AttackEligibilityInput> = {}) =>
    checkAttackEligibility(input({ target: owned, defender: player, ...overrides }));

  it('begrenzt eröffnete Belagerungen und Versuche des Angreifers im gleitenden Fenster', () => {
    const three = [NOW - DAY_MS + 10, NOW - 1000, NOW - 500];
    expect(pvp({ pvp: { ...NO_PVP_COUNTS, openedTimes: three } })).toEqual({
      ok: false,
      refusal: 'ATTACKER_SIEGE_LIMIT',
      details: { resetAt: NOW + 10 },
    });
    const six = [1, 2, 3, 4, 5, 6].map((i) => NOW - 7000 + i);
    expect(pvp({ pvp: { ...NO_PVP_COUNTS, attemptTimes: six } })).toEqual({
      ok: false,
      refusal: 'ATTACKER_ATTEMPT_LIMIT',
      details: { resetAt: NOW - 6999 + DAY_MS },
    });
    // Belagerungen vor Versuchen (GAME_RULES §4 Punkt 8)
    expect(pvp({ pvp: { ...NO_PVP_COUNTS, openedTimes: three, attemptTimes: six } })).toMatchObject(
      { refusal: 'ATTACKER_SIEGE_LIMIT' },
    );
    // PvE-Versuche zählen nicht gegen PvP und umgekehrt
    expect(pvp({ pveAttemptTimes: Array.from({ length: 60 }, () => NOW - 1) })).toMatchObject({
      ok: true,
    });
    expect(
      checkAttackEligibility(input({ pvp: { ...NO_PVP_COUNTS, openedTimes: three } })),
    ).toMatchObject({ ok: true, mode: 'PVE' });
  });

  it('begrenzt offene Belagerungen gegen ein Reich über alle Angreifer', () => {
    expect(pvp({ pvp: { ...NO_PVP_COUNTS, openSiegesAgainstDefender: 3 } })).toMatchObject({
      ok: true,
    });
    expect(pvp({ pvp: { ...NO_PVP_COUNTS, openSiegesAgainstDefender: 4 } })).toEqual({
      ok: false,
      refusal: 'DEFENDER_SIEGE_LIMIT',
      details: {},
    });
  });

  it('sperrt eine Spielerhauptstadt je Angreifer nach einem Treffer ([O-20] B)', () => {
    const capital = { ...owned, isCapital: true };
    const hit = { ...NO_PVP_COUNTS, lastCapitalHitAt: NOW - HOUR_MS };
    expect(pvp({ target: capital, pvp: hit })).toEqual({
      ok: false,
      refusal: 'CAPITAL_HIT_COOLDOWN',
      details: { until: NOW + 11 * HOUR_MS },
    });
    // nach Ablauf der Sperre, für andere Regionen und gegen NPC-Hauptstädte gilt sie nicht
    expect(
      pvp({ target: capital, pvp: { ...hit, lastCapitalHitAt: NOW - 12 * HOUR_MS } }),
    ).toMatchObject({ ok: true });
    expect(pvp({ pvp: hit })).toMatchObject({ ok: true });
    expect(
      checkAttackEligibility(input({ target: capital, defender: npc, pvp: hit })),
    ).toMatchObject({ ok: true, mode: 'PVE' });
    // Sperre vor laufender Herausforderung
    expect(pvp({ target: capital, pvp: hit, challengeInProgress: true })).toMatchObject({
      refusal: 'CAPITAL_HIT_COOLDOWN',
    });
  });

  it('meldet, dass ein PvP-Angriff den eigenen Schutz beendet', () => {
    const protectedAttacker = { id: 'a', regionCount: 3, protectedUntil: NOW + HOUR_MS };
    expect(pvp({ attacker: protectedAttacker })).toMatchObject({
      ok: true,
      endsOwnProtection: true,
    });
    expect(pvp({ attacker: { ...protectedAttacker, protectedUntil: NOW } })).toMatchObject({
      endsOwnProtection: false,
    });
    // PvE beendet den Schutz nicht
    expect(checkAttackEligibility(input({ attacker: protectedAttacker }))).toMatchObject({
      endsOwnProtection: false,
    });
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
  it('entsprechen der Liste in protocol', () => {
    expect([...ATTACK_REFUSAL_CODES]).toEqual([...ATTACK_REFUSALS]);
  });
});
