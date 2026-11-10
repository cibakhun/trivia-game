import { z } from 'zod';
import {
  attackModeSchema,
  defenderKindSchema,
  entityIdSchema,
  kingdomSummarySchema,
  regionIdSchema,
  timestampSchema,
} from './api.ts';
import { canonicalDecimalSchema } from './decimal-string.ts';
import { localeSchema } from './locale.ts';
import { MAX_NUMBER_INPUT_LENGTH } from './number-input.ts';
import { questionKindSchema } from './question.ts';

/**
 * Kampf und Herausforderung (docs/API.md §2.3, docs/QUIZ_ENGINE.md §7). Bis zur Auflösung
 * enthält keine Antwort die Lösung, die Richtigkeit der eigenen Antwort oder die Gegnerleistung
 * (QUIZ_ENGINE §7.2); der Client zeigt nur „Deine Antworten sind gespeichert“.
 */

export const SIEGE_STATUSES = [
  'PREPARING',
  'ATTACK_FAILED',
  'AWAITING_DEFENSE',
  'DEFENDING',
  'RESOLVING',
  'ATTACKER_WON',
  'DEFENDER_WON',
  'ATTACKER_WON_BY_TIMEOUT',
  'CANCELLED',
  'EXPIRED_INVALID',
] as const;
export const siegeStatusSchema = z.enum(SIEGE_STATUSES);
export type SiegeStatus = z.infer<typeof siegeStatusSchema>;

export const OUTCOME_REASONS = [
  'TIMEOUT',
  'ATTACKER_GATE',
  'TRIVIA',
  'ESTIMATE',
  'SPEED',
  'FULL_TIE',
  'ABANDONED',
  'NEVER_STARTED',
  'SEASON_CUTOFF',
  'CANCELLED',
  'INSTANCE_CLOSED',
] as const;
export const outcomeReasonSchema = z.enum(OUTCOME_REASONS);

const stepIndexSchema = z.number().int().min(0).max(1);
const durationSchema = z.number().int().min(0);

// ---------------------------------------------------------------------------------------------
// Angriff starten
// ---------------------------------------------------------------------------------------------

export const attackRequestSchema = z.object({ targetRegionId: regionIdSchema }).strict();
export type AttackRequest = z.infer<typeof attackRequestSchema>;

export const challengeStepInfoSchema = z
  .object({
    index: stepIndexSchema,
    kind: questionKindSchema,
    timeLimitMs: durationSchema,
  })
  .strict();

export const attackResponseSchema = z
  .object({
    instanceId: entityIdSchema,
    siegeId: entityIdSchema,
    challengeId: entityIdSchema,
    mode: attackModeSchema,
    targetRegionId: regionIdSchema,
    defender: z
      .object({ kind: defenderKindSchema, kingdom: kingdomSummarySchema.nullable() })
      .strict(),
    steps: z.array(challengeStepInfoSchema),
    serverTime: timestampSchema,
  })
  .strict();
export type AttackResponse = z.infer<typeof attackResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Fragen (present) und Antworten (answer)
// ---------------------------------------------------------------------------------------------

const questionBase = {
  challengeId: entityIdSchema,
  step: stepIndexSchema,
  prompt: z.string().min(1),
  timeLimitMs: durationSchema,
  /** Restzeit bis zur Antwortgrenze des Schritts (Zeitlimit + Latenzpuffer), nie negativ. */
  remainingMs: durationSchema,
  presentedAt: timestampSchema,
};

/** Eine gestellte Frage; Optionen als Präsentationstoken, ohne Hinweis auf die richtige. */
export const presentedQuestionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...questionBase,
      kind: z.literal('TRIVIA'),
      options: z.array(z.object({ token: z.string().min(1), text: z.string().min(1) }).strict()),
    })
    .strict(),
  z
    .object({
      ...questionBase,
      kind: z.literal('ESTIMATE'),
      unitLabel: z.string().nullable(),
      /** Gewertet wird auf so viele Nachkommastellen gerundet (ROUND_HALF_UP). */
      answerPrecision: z.number().int().min(0),
    })
    .strict(),
]);
export type PresentedQuestion = z.infer<typeof presentedQuestionSchema>;

export const presentResponseSchema = z
  .object({ question: presentedQuestionSchema, serverTime: timestampSchema })
  .strict();
export type PresentResponse = z.infer<typeof presentResponseSchema>;

/**
 * `clientElapsedMs`: vom Client gemessene Zeit in ganzen Millisekunden. Der Server nimmt jede Zahl
 * an und wertet unzulässige Werte (negativ, nicht ganzzahlig) als fehlend und als Signal
 * (QUIZ_ENGINE §6.2).
 */
export const answerRequestSchema = z.union([
  z
    .object({
      optionToken: z.string().min(1).max(64),
      clientElapsedMs: z.number().optional(),
    })
    .strict(),
  z
    .object({
      rawInput: z.string().min(1).max(MAX_NUMBER_INPUT_LENGTH),
      locale: localeSchema,
      clientElapsedMs: z.number().optional(),
    })
    .strict(),
]);
export type AnswerRequest = z.infer<typeof answerRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Auflösung (nach dem letzten Schritt, QUIZ_ENGINE §7.2)
// ---------------------------------------------------------------------------------------------

export const battleSideSchema = z
  .object({
    /** Der Spieler selbst, ein NPC-Reich oder eine neutrale Garnison. */
    kind: z.enum(['PLAYER', 'NPC', 'NEUTRAL']),
    kingdom: kingdomSummarySchema.nullable(),
    /** Text der gewählten Option; `null` = keine Antwort. */
    triviaAnswer: z.string().nullable(),
    triviaCorrect: z.boolean(),
    /** Schätzung (kanonische Dezimalzahl, gerundet auf die Genauigkeit); `null` = keine Antwort. */
    estimate: canonicalDecimalSchema.nullable(),
    estimateDistance: canonicalDecimalSchema.nullable(),
    estimateEffectiveMs: durationSchema.nullable(),
  })
  .strict();
export type BattleSide = z.infer<typeof battleSideSchema>;

/**
 * Wirkung eines Siegs über eine Hauptstadt (GAME_RULES §3, ADR-037): Sie verliert ein Leben;
 * nimmt der Sieg das letzte, übernimmt der Angreifer das ganze Reich. Die beiden Fälle sind
 * getrennt, damit kein Zwischenzustand gültig ist (wie `battle_results_capital_effect`).
 */
export const capitalEffectSchema = z.discriminatedUnion('takenOver', [
  z
    .object({
      takenOver: z.literal(false),
      /** Verbleibende Leben, mindestens eines. */
      livesLeft: z.number().int().min(1),
      maxLives: z.number().int().min(1),
      regionsTaken: z.null(),
      /** Schutz, den dieser Treffer der Hauptstadt gab; `null` ohne Schutz. */
      protectedUntil: timestampSchema.nullable(),
    })
    .strict()
    .refine((effect) => effect.livesLeft < effect.maxLives, {
      message: 'nach einem Treffer fehlt mindestens ein Leben',
      path: ['livesLeft'],
    }),
  z
    .object({
      takenOver: z.literal(true),
      livesLeft: z.literal(0),
      maxLives: z.number().int().min(1),
      /** Übernommene Regionen samt Hauptstadt. */
      regionsTaken: z.number().int().min(1),
      protectedUntil: z.null(),
    })
    .strict(),
]);
export type CapitalEffect = z.infer<typeof capitalEffectSchema>;

export const resolutionSchema = z
  .object({
    siegeId: entityIdSchema,
    status: siegeStatusSchema,
    winner: z.enum(['ATTACKER', 'DEFENDER', 'NONE']),
    reason: outcomeReasonSchema,
    regionId: regionIdSchema,
    /** Die Zielregion gehört jetzt dem Angreifer (eine Hauptstadt erst mit dem letzten Leben). */
    conquered: z.boolean(),
    /** Schutz nach Eroberung (nur wenn erobert und noch aktiv). */
    regionProtectedUntil: timestampSchema.nullable(),
    /** Nur bei einem Sieg über eine Hauptstadt. */
    capital: capitalEffectSchema.nullable(),
    trivia: z
      .object({
        prompt: z.string(),
        options: z.array(z.object({ text: z.string(), correct: z.boolean() }).strict()),
        explanation: z.string().nullable(),
      })
      .strict()
      .nullable(),
    estimate: z
      .object({
        prompt: z.string(),
        answerValue: canonicalDecimalSchema,
        unitLabel: z.string().nullable(),
        explanation: z.string().nullable(),
      })
      .strict()
      .nullable(),
    attacker: battleSideSchema,
    defender: battleSideSchema,
    resolvedAt: timestampSchema,
  })
  .strict();
export type Resolution = z.infer<typeof resolutionSchema>;

/**
 * `SKIPPED`: Die Herausforderung ist beendet, ohne dass der Schritt gestellt wurde (Schätzfrage
 * ohne Gleichstand nach der Trivia-Frage, verpasste Trivia-Frage, nie begonnen).
 */
export const STEP_STATUSES = ['PENDING', 'PRESENTED', 'ANSWERED', 'TIMED_OUT', 'SKIPPED'] as const;

export const challengeViewSchema = z
  .object({
    challengeId: entityIdSchema,
    siegeId: entityIdSchema,
    instanceId: entityIdSchema,
    mode: attackModeSchema,
    targetRegionId: regionIdSchema,
    status: siegeStatusSchema,
    steps: z.array(challengeStepInfoSchema.extend({ status: z.enum(STEP_STATUSES) }).strict()),
    /** Nächster offener Schritt; `null`, wenn alle Schritte erledigt sind. */
    currentStep: stepIndexSchema.nullable(),
    /** Die gerade gestellte, noch offene Frage (Wiederaufnahme nach Reload). */
    question: presentedQuestionSchema.nullable(),
    resolution: resolutionSchema.nullable(),
    serverTime: timestampSchema,
  })
  .strict();
export type ChallengeView = z.infer<typeof challengeViewSchema>;

export const answerResponseSchema = z
  .object({
    challengeId: entityIdSchema,
    step: stepIndexSchema,
    /** Bestätigung „gespeichert“, ohne Richtigkeit. */
    status: z.literal('ANSWERED'),
    /**
     * Nach Schritt 0 direkt die Schätzfrage (QUIZ_ENGINE §7.1 Punkt 4), aber nur, wenn beide Seiten
     * die Trivia-Frage richtig beantwortet haben (GAME_RULES §5.2); sonst `null`.
     */
    next: presentedQuestionSchema.nullable(),
    /** Im PvE die vollständige Auflösung, sobald kein Schritt mehr folgt (auch nach Schritt 0). */
    resolution: resolutionSchema.nullable(),
    serverTime: timestampSchema,
  })
  .strict();
export type AnswerResponse = z.infer<typeof answerResponseSchema>;
