import type { EstimateScaleType } from '@rdw/protocol';
import {
  compareDecimal,
  decimalFromNumber,
  decimalToNumber,
  maxDecimal,
  minDecimal,
  parseDecimal,
  type Decimal,
} from './decimal.ts';
import type { Rng } from './rng.ts';

/**
 * NPC-Antwortmodell (docs/NPC_SYSTEM.md §2–3, docs/QUIZ_ENGINE.md §10).
 * Gemeinsame logistische Skala: `P(richtig) = σ(θ − b)`.
 */

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Wahrscheinlichkeit einer richtigen Trivia-Antwort. */
export function triviaProbability(theta: number, b: number): number {
  return sigmoid(theta - b);
}

export type DifficultyClass = 'EASY' | 'MEDIUM' | 'HARD';

/**
 * Klasse der redaktionellen Schwierigkeit 1–5 [E]: 1–2 leicht, 3 mittel, 4–5 schwer.
 * Dieselben Klassen nutzt die Fragenauswahl nach Regionsstufe (QUIZ_ENGINE §5).
 */
export function difficultyClass(difficulty: number): DifficultyClass {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    throw new RangeError(`Schwierigkeit muss 1–5 sein: ${difficulty}`);
  }
  return difficulty <= 2 ? 'EASY' : difficulty === 3 ? 'MEDIUM' : 'HARD';
}

/** Startwerte `b` je Klasse (QUIZ_ENGINE §10: leicht −1,2 · mittel 0 · schwer +1,2). */
export const DIFFICULTY_CLASS_B: Readonly<Record<DifficultyClass, number>> = Object.freeze({
  EASY: -1.2,
  MEDIUM: 0,
  HARD: 1.2,
});

/** Start-`b` aus der redaktionellen Schwierigkeit; später ersetzt durch `calibrated_difficulty`. */
export function difficultyToB(difficulty: number): number {
  return DIFFICULTY_CLASS_B[difficultyClass(difficulty)];
}

export const NPC_ARCHETYPES = ['GARRISON_START', 'GARRISON', 'LIGHT', 'MEDIUM', 'HEAVY'] as const;
export type NpcArchetype = (typeof NPC_ARCHETYPES)[number];

export interface NpcProfile {
  /** Spielstärke θ auf der gemeinsamen Skala. */
  readonly theta: number;
  /** Median der Antwortzeit auf die Schätzfrage in ms. */
  readonly estimateMedianMs: number;
  /** Streuung der Log-Normalverteilung der Antwortzeit [E]. */
  readonly responseLogSigma: number;
}

/** Streuung der Antwortzeit (σ von ln t) [E]; Kalibrierung in Phase 5. */
export const DEFAULT_RESPONSE_LOG_SIGMA = 0.35;

/** Basisprofile aus NPC_SYSTEM §2 (Garnison außerhalb der Startzone: θ über `garrisonTheta`). */
export const NPC_BASE_PROFILES: Readonly<Record<Exclude<NpcArchetype, 'GARRISON'>, NpcProfile>> =
  Object.freeze({
    GARRISON_START: {
      theta: -2.5,
      estimateMedianMs: 14_000,
      responseLogSigma: DEFAULT_RESPONSE_LOG_SIGMA,
    },
    LIGHT: { theta: -0.4, estimateMedianMs: 12_000, responseLogSigma: DEFAULT_RESPONSE_LOG_SIGMA },
    MEDIUM: { theta: 0.6, estimateMedianMs: 9_000, responseLogSigma: DEFAULT_RESPONSE_LOG_SIGMA },
    HEAVY: { theta: 1.7, estimateMedianMs: 6_000, responseLogSigma: DEFAULT_RESPONSE_LOG_SIGMA },
  });

/**
 * Neutrale Garnison außerhalb der Startzone: θ von −1,4 (Stufe 0) bis +0,5 (Stufe 10),
 * linear über die Regionsstufe [E] (NPC_SYSTEM §2 nennt nur die Spanne).
 */
export function garrisonProfile(tier: number): NpcProfile {
  if (!Number.isInteger(tier) || tier < 0 || tier > 10) {
    throw new RangeError(`Regionsstufe muss 0–10 sein: ${tier}`);
  }
  return {
    theta: -1.4 + (1.9 * tier) / 10,
    estimateMedianMs: 12_000,
    responseLogSigma: DEFAULT_RESPONSE_LOG_SIGMA,
  };
}

/** Höchste Regionsstufe der Startzonen (WORLD_SYSTEM §3.2: Stufe 0–2). */
export const START_ZONE_MAX_TIER = 2;

/**
 * Code des Antwortprofils einer neutralen Garnison (Referenzdaten aus Migration 0007): in der
 * Startzone `GARRISON_START`, sonst je Stufe `GARRISON_T00` … `GARRISON_T10`.
 */
export function garrisonProfileCode(tier: number): string {
  if (!Number.isInteger(tier) || tier < 0 || tier > 10) {
    throw new RangeError(`Regionsstufe muss 0–10 sein: ${tier}`);
  }
  return tier <= START_ZONE_MAX_TIER
    ? 'GARRISON_START'
    : `GARRISON_T${String(tier).padStart(2, '0')}`;
}

export interface EstimateSpreadParams {
  readonly s0: number;
  readonly thetaRef: number;
  readonly k: number;
  readonly sMin: number;
  readonly sMax: number;
}

/** Standardparameter von `s(θ)` (NPC_SYSTEM §3.2). */
export const DEFAULT_ESTIMATE_SPREAD: EstimateSpreadParams = Object.freeze({
  s0: 1.0,
  thetaRef: -0.4,
  k: 0.75,
  sMin: 0.1,
  sMax: 2.0,
});

/** `s(θ) = clamp(s₀ · exp(−k · (θ − θ_ref)), s_min, s_max)`. */
export function estimateSpread(
  theta: number,
  p: EstimateSpreadParams = DEFAULT_ESTIMATE_SPREAD,
): number {
  const raw = p.s0 * Math.exp(-p.k * (theta - p.thetaRef));
  return Math.min(Math.max(raw, p.sMin), p.sMax);
}

/** Was das Modell von einer Schätzfrage braucht. */
export interface NpcEstimateSpec {
  readonly answerValue: string;
  readonly answerPrecision: number;
  readonly inputMin: string;
  readonly inputMax: string;
  readonly scaleType: EstimateScaleType;
  readonly scale: number;
}

export interface NpcQuestionSpec {
  /** Schwierigkeit `b` der Trivia-Frage (redaktionell oder kalibriert). */
  readonly triviaB: number;
  /** Zahl der falschen Optionen der Trivia-Frage (≥ 1). */
  readonly wrongOptionCount: number;
  readonly estimate: NpcEstimateSpec;
  /** Zeitlimit der Schätzfrage in ms. */
  readonly estimateTimeLimitMs: number;
}

export interface NpcAnswer {
  readonly triviaCorrect: boolean;
  /** Index der gewählten falschen Option (0 … wrongOptionCount − 1), `null` wenn richtig. */
  readonly wrongOptionIndex: number | null;
  /** Gerundete und begrenzte Schätzung (kanonisch über `formatDecimal`). */
  readonly estimate: Decimal;
  /** Antwortzeit der Schätzfrage in ms; gilt als effektive Zeit ohne Latenzausgleich. */
  readonly estimateMs: number;
  /** Alles, was das Ereignisprotokoll zum Nachrechnen braucht (NPC_SYSTEM §3.4). */
  readonly audit: {
    readonly theta: number;
    readonly b: number;
    readonly pCorrect: number;
    readonly spread: number;
    readonly draws: { readonly trivia: number; readonly estimate: number; readonly time: number };
  };
}

export interface NpcTrivia {
  readonly correct: boolean;
  /** Index der gewählten falschen Option (0 … wrongOptionCount − 1), `null` wenn richtig. */
  readonly wrongOptionIndex: number | null;
  readonly pCorrect: number;
  readonly draw: number;
}

/**
 * Trivia-Antwort aus dem Strom (1 Wert). Die falsche Option ergibt sich ohne weitere Ziehung aus
 * demselben Wert. Allein genutzt für reine Wissensfragen (Duell der Partie), sonst als erster
 * Schritt von `generateNpcAnswer`.
 */
export function generateNpcTrivia(
  rng: Rng,
  profile: NpcProfile,
  triviaB: number,
  wrongOptionCount: number,
): NpcTrivia {
  if (!Number.isInteger(wrongOptionCount) || wrongOptionCount < 1) {
    throw new RangeError('wrongOptionCount muss ≥ 1 sein');
  }
  const pCorrect = triviaProbability(profile.theta, triviaB);
  const draw = rng.nextFloat();
  const correct = draw < pCorrect;
  const wrongOptionIndex = correct
    ? null
    : Math.min(
        wrongOptionCount - 1,
        Math.floor(((draw - pCorrect) / (1 - pCorrect)) * wrongOptionCount),
      );
  return { correct, wrongOptionIndex, pCorrect, draw };
}

export interface NpcEstimate {
  /** Gerundete und begrenzte Schätzung (kanonisch über `formatDecimal`). */
  readonly estimate: Decimal;
  /** Antwortzeit in ms; gilt als effektive Zeit ohne Latenzausgleich. */
  readonly estimateMs: number;
  readonly spread: number;
  readonly draws: { readonly estimate: number; readonly time: number };
}

/**
 * Schätzung und Antwortzeit aus dem Strom: Schätzung (Normalverteilung, 2 Werte), dann Zeit
 * (Normalverteilung, 2 Werte). Allein genutzt für reine Schätzfragen (Landnahme der Partie),
 * sonst nach der Trivia-Ziehung von `generateNpcAnswer`.
 */
export function generateNpcEstimate(
  rng: Rng,
  profile: NpcProfile,
  spec: NpcEstimateSpec,
  timeLimitMs: number,
  spreadParams: EstimateSpreadParams = DEFAULT_ESTIMATE_SPREAD,
): NpcEstimate {
  if (!(spec.scale > 0)) throw new RangeError('estimate_scale muss positiv sein');

  const spread = estimateSpread(profile.theta, spreadParams);
  const zEstimate = rng.nextNormal();
  const truth = decimalToNumber(parseDecimal(spec.answerValue));
  const sigma = spread * spec.scale;
  let raw: number;
  if (spec.scaleType === 'LINEAR') {
    raw = truth + zEstimate * sigma;
  } else {
    if (!(truth > 0)) throw new RangeError('LOG-Skala verlangt einen positiven Zielwert');
    raw = truth * Math.exp(zEstimate * sigma);
  }
  const min = parseDecimal(spec.inputMin);
  const max = parseDecimal(spec.inputMax);
  if (compareDecimal(min, max) > 0) throw new RangeError('input_min > input_max');
  // Erst als Gleitkommazahl begrenzen: Bei großer Streuung kann `raw` sonst ±Infinity werden
  // (NPC_SYSTEM §3.2: Schätzungen außerhalb des Bereichs werden gekappt).
  const bounded = Math.min(Math.max(raw, decimalToNumber(min)), decimalToNumber(max));
  const estimate = minDecimal(
    maxDecimal(decimalFromNumber(bounded, spec.answerPrecision), min),
    max,
  );

  // Antwortzeit: log-normal um den Median, höchstens 1 s unter dem Zeitlimit
  const zTime = rng.nextNormal();
  const upper = Math.max(0, timeLimitMs - 1_000);
  const lower = Math.min(1_000, upper);
  const sampled = Math.round(profile.estimateMedianMs * Math.exp(zTime * profile.responseLogSigma));
  const estimateMs = Math.min(Math.max(sampled, lower), upper);

  return { estimate, estimateMs, spread, draws: { estimate: zEstimate, time: zTime } };
}

/**
 * Erzeugt die NPC-Antworten einer Herausforderung aus dem Strom `npc-answer:{challenge_id}`.
 * Ziehungen in fester Reihenfolge: Trivia (1 Wert), Schätzung (Normalverteilung, 2 Werte),
 * Zeit (Normalverteilung, 2 Werte). Die falsche Option ergibt sich ohne weitere Ziehung aus dem
 * Trivia-Wert, damit die Reihenfolge stabil bleibt.
 */
export function generateNpcAnswer(
  rng: Rng,
  profile: NpcProfile,
  question: NpcQuestionSpec,
  spreadParams: EstimateSpreadParams = DEFAULT_ESTIMATE_SPREAD,
): NpcAnswer {
  if (!(question.estimate.scale > 0)) throw new RangeError('estimate_scale muss positiv sein');

  // 1. Trivia
  const trivia = generateNpcTrivia(rng, profile, question.triviaB, question.wrongOptionCount);

  // 2. Schätzung und 3. Antwortzeit
  const estimate = generateNpcEstimate(
    rng,
    profile,
    question.estimate,
    question.estimateTimeLimitMs,
    spreadParams,
  );

  return {
    triviaCorrect: trivia.correct,
    wrongOptionIndex: trivia.wrongOptionIndex,
    estimate: estimate.estimate,
    estimateMs: estimate.estimateMs,
    audit: {
      theta: profile.theta,
      b: question.triviaB,
      pCorrect: trivia.pCorrect,
      spread: estimate.spread,
      draws: { trivia: trivia.draw, estimate: estimate.draws.estimate, time: estimate.draws.time },
    },
  };
}
