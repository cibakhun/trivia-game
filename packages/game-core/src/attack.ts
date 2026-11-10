import type { RateBudget } from '@rdw/protocol';

/**
 * Angriffsberechtigung (docs/GAME_RULES.md §4): reine Prüfung in der dort festgelegten
 * Reihenfolge. Der Server sammelt die Eingaben unter Sperren (SIEGE_SYSTEM §5.1) und ruft diese
 * Funktion beim Angriff und, ohne Sperren, für die Anzeige in den Regionsdetails auf. Alle
 * Zeitpunkte sind Millisekunden in Spielzeit (`game_now()`).
 *
 * Noch nicht enthalten (Phase 2/3): PvP-Kontingente des Angreifers und offene Belagerungen gegen
 * das Zielreich sowie der Angriffsschluss in Daily/Weekly. Bis dahin lehnt der Server PvP ab.
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
  'CHALLENGE_IN_PROGRESS',
  'ATTACKER_ATTEMPT_LIMIT',
] as const;
export type AttackRefusal = (typeof ATTACK_REFUSALS)[number];

export type AttackMode = 'PVE' | 'PVP';
export type DefenderKind = 'NEUTRAL' | 'NPC' | 'PLAYER';

export interface AttackEligibilityInput {
  readonly now: number;
  readonly instanceRunning: boolean;
  /** Aktives Reich des Anfragenden in dieser Instanz; `null` = keines (nicht beigetreten oder gefallen). */
  readonly attacker: { readonly id: string; readonly regionCount: number } | null;
  readonly target: {
    readonly ownerKingdomId: string | null;
    /** Schutz nach Eroberung; abgelaufene Werte sind erlaubt und zählen nicht. */
    readonly protectedUntil: number | null;
    readonly underSiege: boolean;
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
  readonly rules: {
    readonly maxPveAttemptsPerPlayer: RateBudget;
    readonly rankGap: { readonly factor: number; readonly maxTargetRegions: number } | null;
  };
}

export type AttackEligibility =
  | { readonly ok: true; readonly mode: AttackMode; readonly defenderKind: DefenderKind }
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
  // 7. höchstens eine Herausforderung gleichzeitig
  if (input.challengeInProgress) return refuse('CHALLENGE_IN_PROGRESS');

  const defenderKind: DefenderKind = defender ? defender.kind : 'NEUTRAL';
  const mode: AttackMode = defenderKind === 'PLAYER' ? 'PVP' : 'PVE';
  // 8. Kontingente (PvP-Kontingente folgen mit Phase 2)
  if (mode === 'PVE') {
    const resetAt = attemptResetAt(input.pveAttemptTimes, input.rules.maxPveAttemptsPerPlayer, now);
    if (resetAt !== null) return refuse('ATTACKER_ATTEMPT_LIMIT', { resetAt });
  }
  return { ok: true, mode, defenderKind };
}
