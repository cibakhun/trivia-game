import type { DefenseRules, QuizRules } from '@rdw/protocol';

/**
 * Fristen und Verlängerungen (docs/SIEGE_SYSTEM.md §6, docs/QUIZ_ENGINE.md §7,
 * docs/WORLD_SYSTEM.md §6.2). Alle Zeitpunkte sind ganzzahlige Millisekunden seit Epoche in
 * Spielzeit (`game_now()`); alle Grenzen sind exklusiv wie in SIEGE_SYSTEM §6.1.
 */

export interface SiegeDeadlines {
  readonly openedAt: number;
  readonly baseDeadlineAt: number;
  readonly deadlineAt: number;
  readonly maxDeadlineAt: number;
}

function assertInstant(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} ist kein ganzzahliger Zeitpunkt`);
}

function assertDuration(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} ist keine nichtnegative ganzzahlige Dauer`);
  }
}

/** Fristen bei Eröffnung einer PvP-Belagerung; die Werte werden in die Belagerung kopiert. */
export function openSiegeDeadlines(
  openedAt: number,
  defense: Pick<DefenseRules, 'baseDeadline' | 'maxDeadline'>,
): SiegeDeadlines {
  assertInstant('openedAt', openedAt);
  assertDuration('baseDeadline', defense.baseDeadline);
  assertDuration('maxDeadline', defense.maxDeadline);
  if (defense.maxDeadline < defense.baseDeadline) {
    throw new RangeError('maxDeadline < baseDeadline');
  }
  const baseDeadlineAt = openedAt + defense.baseDeadline;
  return {
    openedAt,
    baseDeadlineAt,
    deadlineAt: baseDeadlineAt,
    maxDeadlineAt: openedAt + defense.maxDeadline,
  };
}

/** Exklusive Grenze: rechtzeitig genau dann, wenn `receivedAt < deadlineAt`. */
export function isBeforeDeadline(receivedAt: number, deadlineAt: number): boolean {
  return receivedAt < deadlineAt;
}

/**
 * Das eine Prädikat für Timeout-Job, Sweeper und Auflösung beim Lesen:
 * `now ≥ deadline_at + settleGrace`.
 */
export function isTimeoutDue(
  siege: { readonly deadlineAt: number; readonly settleGrace: number },
  now: number,
): boolean {
  assertDuration('settleGrace', siege.settleGrace);
  return now >= siege.deadlineAt + siege.settleGrace;
}

/** Längste mögliche Dauer einer Herausforderung: Σ (Zeitlimit + cap) beider Schritte. */
export function maxChallengeDurationMs(quiz: QuizRules): number {
  return quiz.triviaTimeLimit + quiz.estimateTimeLimit + 2 * quiz.latencyAllowanceCapMs;
}

export type StartDefenseResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'DEADLINE_PASSED' | 'DEADLINE_TOO_CLOSE' };

/**
 * Verteidigung beginnen (SIEGE_SYSTEM §6.2): nur vor der Frist und nur, wenn die Restzeit für
 * eine vollständige Herausforderung plus `startBuffer` reicht (Standard ≈ 61 s).
 */
export function canStartDefense(
  deadlineAt: number,
  now: number,
  rules: { readonly defense: Pick<DefenseRules, 'startBuffer'>; readonly quiz: QuizRules },
): StartDefenseResult {
  if (!isBeforeDeadline(now, deadlineAt)) return { ok: false, error: 'DEADLINE_PASSED' };
  const required = maxChallengeDurationMs(rules.quiz) + rules.defense.startBuffer;
  return deadlineAt - now >= required ? { ok: true } : { ok: false, error: 'DEADLINE_TOO_CLOSE' };
}

export type ExtensionResult =
  | {
      readonly ok: true;
      readonly newDeadlineAt: number;
      /** Tatsächlich gewonnene Zeit (≤ Item-Effekt). */
      readonly gainedMs: number;
      /** Durch die Obergrenze verfallender Rest des Item-Effekts (W-9). */
      readonly forfeitedMs: number;
    }
  | {
      readonly ok: false;
      readonly error: 'DEADLINE_PASSED' | 'EXTENSION_LIMIT_REACHED' | 'DEADLINE_CHANGED';
    };

/**
 * Verlängerung (SIEGE_SYSTEM §6.3): `neu = min(deadline_at + effect, max_deadline_at)`.
 * Ist die Obergrenze erreicht, wird ohne Itemverbrauch abgelehnt. Weicht `expectedNewDeadlineAt`
 * (dem Spieler vor der Bestätigung gezeigt) ab, wird ebenfalls ohne Verbrauch abgelehnt.
 */
export function extendDeadline(
  siege: { readonly deadlineAt: number; readonly maxDeadlineAt: number },
  effectMs: number,
  now: number,
  expectedNewDeadlineAt?: number,
): ExtensionResult {
  if (!Number.isSafeInteger(effectMs) || effectMs <= 0) {
    throw new RangeError('Item-Effekt muss eine positive ganze Zahl sein');
  }
  if (!isBeforeDeadline(now, siege.deadlineAt)) return { ok: false, error: 'DEADLINE_PASSED' };
  const newDeadlineAt = Math.min(siege.deadlineAt + effectMs, siege.maxDeadlineAt);
  if (newDeadlineAt <= siege.deadlineAt) return { ok: false, error: 'EXTENSION_LIMIT_REACHED' };
  if (expectedNewDeadlineAt !== undefined && expectedNewDeadlineAt !== newDeadlineAt) {
    return { ok: false, error: 'DEADLINE_CHANGED' };
  }
  const gainedMs = newDeadlineAt - siege.deadlineAt;
  return { ok: true, newDeadlineAt, gainedMs, forfeitedMs: effectMs - gainedMs };
}

/** Zeitlimit eines Schritts: `answer_deadline_at = P + time_limit + cap` (exklusiv). */
export function answerDeadlineAt(presentedAt: number, timeLimitMs: number, capMs: number): number {
  assertInstant('presentedAt', presentedAt);
  assertDuration('timeLimitMs', timeLimitMs);
  assertDuration('capMs', capMs);
  return presentedAt + timeLimitMs + capMs;
}

/** Ein verpasster Schritt wird erst ab `answer_deadline_at + settleGrace` zu `TIMED_OUT`. */
export function isStepTimeoutDue(
  answerDeadline: number,
  now: number,
  settleGrace: number,
): boolean {
  assertDuration('settleGrace', settleGrace);
  return now >= answerDeadline + settleGrace;
}

const MINUTE_MS = 60_000;

/**
 * PvP-Angriffsschluss einer Saison (WORLD_SYSTEM §6.2):
 * `ends_at − (maxDeadline + settleGrace + maximale Angriffsdauer)`, Abstand auf volle Minuten
 * aufgerundet. Weekly ≈ 4 h 1 min, Daily ≈ 16 min vor Saisonende.
 */
export function pvpAttackCutoffAt(
  endsAt: number,
  rules: {
    readonly defense: Pick<DefenseRules, 'maxDeadline' | 'settleGrace'>;
    readonly quiz: QuizRules;
  },
): number {
  assertInstant('endsAt', endsAt);
  const lead =
    rules.defense.maxDeadline + rules.defense.settleGrace + maxChallengeDurationMs(rules.quiz);
  return endsAt - Math.ceil(lead / MINUTE_MS) * MINUTE_MS;
}

/**
 * Zweite Prüfung bei Eröffnung (WORLD_SYSTEM §6.2): Die Belagerung muss samt Abwicklungspuffer
 * spätestens zum Saisonende auflösbar sein (`max_deadline_at + settleGrace ≤ ends_at`).
 */
export function fitsBeforeSeasonEnd(
  maxDeadlineAt: number,
  settleGrace: number,
  endsAt: number,
): boolean {
  return maxDeadlineAt + settleGrace <= endsAt;
}
