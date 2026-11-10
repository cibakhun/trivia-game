import { compareDecimal, type Decimal } from './decimal.ts';

/**
 * Duellauswertung (docs/QUIZ_ENGINE.md §8, docs/GAME_RULES.md §5.2) mit verdecktem
 * Angreifer-Gate (PO-Entscheidung O-01). Gleiche Funktion für PvE, PvP und NPC gegen NPC.
 */

export interface Performance {
  /** Trivia richtig beantwortet; ein verpasster Schritt (`TIMED_OUT`) zählt als falsch. */
  readonly triviaCorrect: boolean;
  /** Schätzabstand; `null` (Schritt verpasst) zählt als +∞. */
  readonly estimateDistance: Decimal | null;
  /** Effektive Antwortzeit der Schätzfrage in ms; `null` zählt als +∞. */
  readonly estimateEffectiveMs: number | null;
  /** Beide Fragen jeweils innerhalb ihres Zeitlimits beantwortet. */
  readonly answeredBoth: boolean;
}

/** Ergebnis eines Schritts aus den gespeicherten Antworten; `null` = nie gestellt oder verpasst. */
export interface TriviaStep {
  readonly correct: boolean;
}

export interface EstimateStep {
  readonly distance: Decimal;
  readonly effectiveMs: number;
}

/**
 * Leistung einer Seite aus ihren gespeicherten Antworten. Verpasste oder nie gestellte Schritte
 * zählen als falsch bzw. als unendlicher Abstand und unendliche Zeit (GAME_RULES §5.2).
 */
export function performanceFromSteps(
  trivia: TriviaStep | null,
  estimate: EstimateStep | null,
): Performance {
  return {
    triviaCorrect: trivia?.correct ?? false,
    estimateDistance: estimate?.distance ?? null,
    estimateEffectiveMs: estimate?.effectiveMs ?? null,
    answeredBoth: trivia !== null && estimate !== null,
  };
}

/**
 * Die Schätzfrage ist nur der Tiebreaker (PO 2026-11-10): Sie wird gestellt, wenn beide Seiten
 * die Trivia-Frage richtig beantwortet haben. Sonst steht der Ausgang schon nach der Trivia-Frage
 * fest (Angreifer falsch: verdecktes Gate; nur der Verteidiger falsch: Trivia-Sieg), und
 * `resolveDuel` wertet die Schätzung in diesen Fällen ohnehin nicht aus. Gilt im PvE, wo die
 * Verteidigung vorab feststeht; für PvP ist die Reihenfolge offen ([O-19]).
 */
export function estimateDecides(attackerTriviaCorrect: boolean, defenderTriviaCorrect: boolean) {
  return attackerTriviaCorrect && defenderTriviaCorrect;
}

/** Der Verteidiger hat bis zur Frist keine Verteidigung begonnen. */
export const NO_DEFENSE = 'NO_DEFENSE';
export type Defense = Performance | typeof NO_DEFENSE;

export type Outcome =
  | { readonly winner: 'ATTACKER'; readonly reason: 'TIMEOUT' | 'TRIVIA' | 'ESTIMATE' | 'SPEED' }
  | {
      readonly winner: 'DEFENDER';
      readonly reason: 'ATTACKER_GATE' | 'ESTIMATE' | 'SPEED' | 'FULL_TIE';
    }
  | { readonly winner: 'NONE'; readonly reason: 'ATTACKER_GATE' };

function compareNullableDecimal(a: Decimal | null, b: Decimal | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return compareDecimal(a, b);
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function resolveDuel(att: Performance, def: Defense): Outcome {
  // Verdecktes Gate: Liegt der Angreifer falsch, scheitert der Angriff immer. Einen Sieger gibt
  // es nur, wenn sich der Verteidiger verteidigt hat; sonst endet die Belagerung ohne Sieger.
  if (!att.triviaCorrect) {
    return def === NO_DEFENSE
      ? { winner: 'NONE', reason: 'ATTACKER_GATE' }
      : { winner: 'DEFENDER', reason: 'ATTACKER_GATE' };
  }
  if (def === NO_DEFENSE) return { winner: 'ATTACKER', reason: 'TIMEOUT' };
  if (!def.triviaCorrect) return { winner: 'ATTACKER', reason: 'TRIVIA' };

  const distance = compareNullableDecimal(att.estimateDistance, def.estimateDistance);
  if (distance !== 0) {
    return distance < 0
      ? { winner: 'ATTACKER', reason: 'ESTIMATE' }
      : { winner: 'DEFENDER', reason: 'ESTIMATE' };
  }
  const time = compareNullableNumber(att.estimateEffectiveMs, def.estimateEffectiveMs);
  if (time !== 0) {
    return time < 0
      ? { winner: 'ATTACKER', reason: 'SPEED' }
      : { winner: 'DEFENDER', reason: 'SPEED' };
  }
  return { winner: 'DEFENDER', reason: 'FULL_TIE' };
}

export interface DefensePointValues {
  /** Punkte für eine vollständige Verteidigung (beide Fragen beantwortet). */
  readonly forDefending: number;
  /** Zusatz, wenn die eigene Trivia-Antwort richtig war. */
  readonly bonusCorrect: number;
}

/**
 * Verteidigungspunkte (docs/GAME_RULES.md §5.5, PO 2026-11-09): hängen nur von der eigenen
 * Leistung des Verteidigers ab, nie vom Ausgang oder von der Angreiferleistung. Paarlimit und
 * verknüpfte Konten prüft die Auflösungstransaktion.
 */
export function defensePoints(def: Defense, values: DefensePointValues): number {
  if (def === NO_DEFENSE || !def.answeredBoth) return 0;
  return values.forDefending + (def.triviaCorrect ? values.bonusCorrect : 0);
}

/** Abbildung auf den Endzustand einer Belagerung (QUIZ_ENGINE §8, Tabelle). */
export type SiegeEndState =
  'ATTACKER_WON_BY_TIMEOUT' | 'ATTACKER_WON' | 'DEFENDER_WON' | 'ATTACK_FAILED';

export function siegeEndState(outcome: Outcome): SiegeEndState {
  switch (outcome.winner) {
    case 'ATTACKER':
      return outcome.reason === 'TIMEOUT' ? 'ATTACKER_WON_BY_TIMEOUT' : 'ATTACKER_WON';
    case 'DEFENDER':
      return 'DEFENDER_WON';
    case 'NONE':
      return 'ATTACK_FAILED';
  }
}
