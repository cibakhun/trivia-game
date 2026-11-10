import type { RateBudget } from '@rdw/protocol';

/**
 * Angriffsberechtigung (docs/GAME_RULES.md §4): reine Prüfung in der dort festgelegten
 * Reihenfolge. Der Server sammelt die Eingaben unter Sperren (SIEGE_SYSTEM §5.1) und ruft diese
 * Funktion beim Angriff und, ohne Sperren, für die Anzeige in den Regionsdetails auf. Alle
 * Zeitpunkte sind Millisekunden in Spielzeit (`game_now()`).
 *
 * Noch nicht enthalten: der PvP-Angriffsschluss einer Saison (Daily/Weekly, Phase 6).
 */

export const ATTACK_REFUSALS = [
  'INSTANCE_NOT_ACTIVE',
  'NO_ACTIVE_KINGDOM',
  'OWN_REGION',
  'NOT_ADJACENT',
  'REGION_UNDER_SIEGE',
  'REGION_PROTECTED',
  'KINGDOM_PROTECTED',
  'RANK_GAP',
  'CAPITAL_HIT_COOLDOWN',
  'CHALLENGE_IN_PROGRESS',
  'ATTACKER_SIEGE_LIMIT',
  'ATTACKER_ATTEMPT_LIMIT',
  'DEFENDER_SIEGE_LIMIT',
] as const;
export type AttackRefusal = (typeof ATTACK_REFUSALS)[number];

export type AttackMode = 'PVE' | 'PVP';
export type DefenderKind = 'NEUTRAL' | 'NPC' | 'PLAYER';

export interface AttackEligibilityInput {
  readonly now: number;
  readonly instanceRunning: boolean;
  /** Aktives Reich des Anfragenden in dieser Instanz; `null` = keines (nicht beigetreten oder gefallen). */
  readonly attacker: {
    readonly id: string;
    readonly regionCount: number;
    /** Eigener Anfänger- oder Wiederaufbauschutz; fehlt = keiner. */
    readonly protectedUntil?: number | null;
  } | null;
  readonly target: {
    readonly ownerKingdomId: string | null;
    /** Schutz nach Eroberung; abgelaufene Werte sind erlaubt und zählen nicht. */
    readonly protectedUntil: number | null;
    readonly underSiege: boolean;
    /** Hauptstadt des Zielreichs; fehlt = nein. */
    readonly isCapital?: boolean;
  };
  /** Reich, dem die Zielregion gehört; `null` bei neutralen Regionen. */
  readonly defender: {
    readonly kind: 'PLAYER' | 'NPC';
    readonly regionCount: number;
    /** Anfänger-, Wiederaufbau- oder Urlaubsschutz des Reichs. */
    readonly protectedUntil: number | null;
  } | null;
  /** Die Zielregion grenzt an mindestens eine Region des Angreifers. */
  readonly adjacent: boolean;
  /** Der Anfragende bearbeitet bereits eine Herausforderung (GAME_RULES §7: höchstens eine). */
  readonly challengeInProgress: boolean;
  /** Zeitpunkte der PvE-Versuche (erste Frage angezeigt) des Spielers im laufenden Fenster. */
  readonly pveAttemptTimes: readonly number[];
  /** Zählungen für PvP (SIEGE_SYSTEM §7); nur relevant, wenn das Ziel einem Spielerreich gehört. */
  readonly pvp: PvpCounts;
  readonly rules: {
    readonly maxPveAttemptsPerPlayer: RateBudget;
    readonly rankGap: { readonly factor: number; readonly maxTargetRegions: number } | null;
    readonly maxNewPvpSiegesPerAttacker: RateBudget;
    readonly maxPvpAttemptsPerAttacker: RateBudget;
    readonly maxOpenSiegesPerDefender: number;
    /** `capital.hitCooldownPerAttacker` ([O-20] B). */
    readonly capitalHitCooldownPerAttacker: number;
  };
}

export interface PvpCounts {
  /** Eröffnungszeitpunkte (`opened_at`) der PvP-Belagerungen des Angreifers im Fenster. */
  readonly openedTimes: readonly number[];
  /** Versuchszeitpunkte (`attack_presented_at`) der PvP-Angriffe des Angreifers im Fenster. */
  readonly attemptTimes: readonly number[];
  /** Offene Belagerungen gegen das Zielreich, alle Angreifer, einschließlich `PREPARING`. */
  readonly openSiegesAgainstDefender: number;
  /** Letzter Treffer des Angreifers auf die Hauptstadt des Zielreichs (ms); `null` = keiner. */
  readonly lastCapitalHitAt: number | null;
}

/** Leere Zählungen, z. B. für Ziele ohne Spielerreich. */
export const NO_PVP_COUNTS: PvpCounts = Object.freeze({
  openedTimes: [],
  attemptTimes: [],
  openSiegesAgainstDefender: 0,
  lastCapitalHitAt: null,
});

export type AttackEligibility =
  | {
      readonly ok: true;
      readonly mode: AttackMode;
      readonly defenderKind: DefenderKind;
      /** Der Angriff beendet den eigenen Anfänger- oder Wiederaufbauschutz (PvP, GAME_RULES §7). */
      readonly endsOwnProtection: boolean;
    }
  | {
      readonly ok: false;
      readonly refusal: AttackRefusal;
      /** Zusatzangaben für die Oberfläche, z. B. `until` oder `resetAt` (ms). */
      readonly details: Readonly<Record<string, number>>;
    };

function refuse(refusal: AttackRefusal, details: Record<string, number> = {}): AttackEligibility {
  return { ok: false, refusal, details };
}

/**
 * Zeitpunkt, ab dem wieder ein Versuch frei ist: Der älteste Versuch, der das Kontingent noch
 * füllt, fällt aus dem gleitenden Fenster.
 */
export function attemptResetAt(
  times: readonly number[],
  budget: RateBudget,
  now: number,
): number | null {
  if (budget.count === null) return null;
  const inWindow = times.filter((t) => t > now - budget.windowMs).sort((a, b) => a - b);
  if (inWindow.length < budget.count) return null;
  // Erst wenn so viele herausgefallen sind, dass weniger als `count` übrig bleiben.
  const pivot = inWindow[inWindow.length - budget.count];
  return pivot === undefined ? null : pivot + budget.windowMs;
}

export function checkAttackEligibility(input: AttackEligibilityInput): AttackEligibility {
  const { now, attacker, target, defender } = input;
  // 1. Instanz aktiv
  if (!input.instanceRunning) return refuse('INSTANCE_NOT_ACTIVE');
  // 2. Angreiferreich aktiv
  if (!attacker) return refuse('NO_ACTIVE_KINGDOM');
  // 3. Ziel gehört nicht dem Angreifer
  if (target.ownerKingdomId === attacker.id) return refuse('OWN_REGION');
  // 4. Nachbarschaft
  if (!input.adjacent) return refuse('NOT_ADJACENT');
  // 5. keine aktive Belagerung
  if (target.underSiege) return refuse('REGION_UNDER_SIEGE');
  // 6. Schutz der Region, Schutz des Reichs, Rangabstand
  if (target.protectedUntil !== null && target.protectedUntil > now) {
    return refuse('REGION_PROTECTED', { until: target.protectedUntil });
  }
  if (defender !== null && defender.protectedUntil !== null && defender.protectedUntil > now) {
    return refuse('KINGDOM_PROTECTED', { until: defender.protectedUntil });
  }
  const gap = input.rules.rankGap;
  // Rangabstand schützt kleine Spielerreiche vor großen (GAME_RULES §7), nicht NPC-Fraktionen.
  if (
    gap &&
    defender?.kind === 'PLAYER' &&
    defender.regionCount < gap.maxTargetRegions &&
    attacker.regionCount >= gap.factor * defender.regionCount
  ) {
    return refuse('RANK_GAP');
  }
  const defenderKind: DefenderKind = defender ? defender.kind : 'NEUTRAL';
  const mode: AttackMode = defenderKind === 'PLAYER' ? 'PVP' : 'PVE';
  // Sperre je Angreifer auf eine Spielerhauptstadt ([O-20] B, GAME_RULES §3 Punkt 3)
  if (mode === 'PVP' && target.isCapital === true && input.pvp.lastCapitalHitAt !== null) {
    const until = input.pvp.lastCapitalHitAt + input.rules.capitalHitCooldownPerAttacker;
    if (until > now) return refuse('CAPITAL_HIT_COOLDOWN', { until });
  }
  // 7. höchstens eine Herausforderung gleichzeitig
  if (input.challengeInProgress) return refuse('CHALLENGE_IN_PROGRESS');

  // 8. Kontingente
  if (mode === 'PVE') {
    const resetAt = attemptResetAt(input.pveAttemptTimes, input.rules.maxPveAttemptsPerPlayer, now);
    if (resetAt !== null) return refuse('ATTACKER_ATTEMPT_LIMIT', { resetAt });
    return { ok: true, mode, defenderKind, endsOwnProtection: false };
  }
  const siegesReset = attemptResetAt(
    input.pvp.openedTimes,
    input.rules.maxNewPvpSiegesPerAttacker,
    now,
  );
  if (siegesReset !== null) return refuse('ATTACKER_SIEGE_LIMIT', { resetAt: siegesReset });
  const attemptsReset = attemptResetAt(
    input.pvp.attemptTimes,
    input.rules.maxPvpAttemptsPerAttacker,
    now,
  );
  if (attemptsReset !== null) return refuse('ATTACKER_ATTEMPT_LIMIT', { resetAt: attemptsReset });
  if (input.pvp.openSiegesAgainstDefender >= input.rules.maxOpenSiegesPerDefender) {
    return refuse('DEFENDER_SIEGE_LIMIT');
  }
  const ownProtection = attacker.protectedUntil ?? null;
  return {
    ok: true,
    mode,
    defenderKind,
    endsOwnProtection: ownProtection !== null && ownProtection > now,
  };
}
