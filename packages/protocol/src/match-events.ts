import { z } from 'zod';
import { timestampSchema } from './api.ts';
import {
  MATCH_QUESTION_PURPOSES,
  matchBotStrengthSchema,
  matchKindSchema,
  matchRegionIndexSchema,
  matchRulesPresetSchema,
  type MatchEventDto,
} from './match-api.ts';
import { questionKindSchema } from './question.ts';

/**
 * Inhalt der Ereignisse einer Partie (`GET /matches/:matchId`, Feld `events`; API.md §2.6). Der
 * Server schreibt sie unter der Sperre der Partie, der Client liest sie mit `parseMatchEvent`.
 * Unbekannte Typen und unpassende Inhalte ergeben `null`: Ein älterer Client überspringt sie,
 * statt die Partie abzubrechen. Zusätzliche Felder (etwa der Zufallsnachweis `rng`) fallen weg.
 */

const seat = z.number().int().min(0).max(2);
const count = z.number().int().min(0);
const round = z.number().int().min(1);
const region = matchRegionIndexSchema;
/** Dezimalzahl aus PostgreSQL-`numeric` oder `game-core` (Punkt als Trenner). */
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/, 'keine Dezimalzahl');
const joinOrder = z.number().int().min(0).max(2);

export const MATCH_DUEL_REASONS = [
  'TRIVIA',
  'BOTH_WRONG',
  'ESTIMATE',
  'SPEED',
  'FULL_TIE',
] as const;
export const MATCH_DUEL_EFFECTS = ['CONQUERED', 'CAPITAL_HIT', 'TAKEOVER', 'FORTIFIED'] as const;
export const MATCH_FINISH_REASONS = ['ROUNDS_COMPLETE', 'LAST_KINGDOM'] as const;
/** Gründe für den Abbruch einer Partie (Aufstellung oder laufend). */
export const MATCH_ABANDON_REASONS = [
  'HOST_LEFT',
  'LOBBY_EXPIRED',
  'NO_QUESTION_AVAILABLE',
  'INTERNAL_ERROR',
] as const;

const matchStandingSchema = z.object({
  seat,
  /** 1 = bester Platz; bei völligem Gleichstand geteilt. */
  place: z.number().int().min(1).max(3),
  points: count,
  regions: count,
  capitalLives: count,
  eliminated: z.boolean(),
});

/** Antwort eines Sitzes in der Auflösung; `answered = false` heißt verpasst. */
const resolvedAnswerSchema = z.object({
  seat,
  answered: z.boolean(),
  correct: z.boolean(),
  optionText: z.string().nullable(),
  value: decimal.nullable(),
  distance: decimal.nullable(),
  effectiveMs: z.number().int().min(0).nullable(),
});

export const matchEventPayloadSchemas = {
  MATCH_CREATED: z.object({
    kind: matchKindSchema,
    rulesPreset: matchRulesPresetSchema,
    seats: z.number().int().min(2).max(3).nullable(),
  }),
  /** `bot` nennt die Stärke, wenn der Gastgeber einen Bot auf den Platz setzt oder entfernt. */
  PLAYER_JOINED: z.object({ joinOrder, bot: matchBotStrengthSchema.nullable().optional() }),
  PLAYER_LEFT: z.object({ joinOrder, bot: matchBotStrengthSchema.nullable().optional() }),
  MATCH_STARTED: z.object({
    seats: z.number().int().min(2).max(3),
    players: z.array(z.object({ seat, joinOrder, bot: matchBotStrengthSchema.nullable() })),
  }),
  MATCH_ABANDONED: z.object({ reason: z.string().min(1) }),
  QUESTION_OPENED: z.object({
    seq: z.number().int().min(1),
    kind: questionKindSchema,
    purpose: z.enum(MATCH_QUESTION_PURPOSES),
    seats: z.array(seat),
    timeLimitMs: count,
    closesAt: timestampSchema,
  }),
  /** Lösung und Antworten aller Sitze, erst nach der Frage (QUIZ_ENGINE §7.2). */
  QUESTION_RESOLVED: z.object({
    seq: z.number().int().min(1),
    kind: questionKindSchema,
    prompt: z.string(),
    options: z.array(z.object({ token: z.string(), text: z.string().nullable() })),
    solution: z.union([
      z.object({ optionToken: z.string().nullable(), text: z.string().nullable() }),
      z.object({ value: decimal.nullable(), unit: z.string().nullable() }),
    ]),
    explanation: z.string().nullable(),
    answers: z.array(resolvedAnswerSchema),
  }),
  /** Der Server hat nach Ablauf der Wahlzeit gewählt (MATCH_RULES §5). */
  AUTO_PICKED: z.object({ seat, region }),
  CAPITAL_CHOSEN: z.object({ seat, region }),
  LAND_RANKED: z.object({
    round,
    ranking: z.array(
      z.object({
        seat,
        place: z.number().int().min(1).max(3),
        picks: count,
        distance: decimal.nullable(),
        effectiveMs: z.number().int().min(0).nullable(),
      }),
    ),
  }),
  REGION_CLAIMED: z.object({ round, seat, region }),
  TARGET_CHOSEN: z.object({ round, attacker: seat, defender: seat, region }),
  DUEL_RESOLVED: z.object({
    round,
    duel: z.number().int().min(1),
    attacker: seat,
    defender: seat,
    region,
    winner: z.enum(['ATTACKER', 'DEFENDER']),
    reason: z.enum(MATCH_DUEL_REASONS),
    effect: z.enum(MATCH_DUEL_EFFECTS),
    capitalLivesLeft: count.nullable(),
    regionValue: count,
  }),
  KINGDOM_ELIMINATED: z.object({ round, seat, by: seat, regions: count }),
  MATCH_FINISHED: z.object({
    reason: z.enum(MATCH_FINISH_REASONS),
    standings: z.array(matchStandingSchema),
  }),
} as const;

type PayloadSchemas = typeof matchEventPayloadSchemas;
export type MatchEventType = keyof PayloadSchemas;
export const MATCH_EVENT_TYPES = Object.keys(matchEventPayloadSchemas) as MatchEventType[];

/** Ein gelesenes Ereignis mit geprüftem Inhalt, unterscheidbar über `type`. */
export type MatchEventOf<T extends MatchEventType> = {
  readonly seq: number;
  readonly at: string;
  readonly type: T;
  readonly payload: z.output<PayloadSchemas[T]>;
};
export type ParsedMatchEvent = { [T in MatchEventType]: MatchEventOf<T> }[MatchEventType];

function isEventType(type: string): type is MatchEventType {
  return Object.hasOwn(matchEventPayloadSchemas, type);
}

/** Prüft ein Ereignis; `null` für unbekannte Typen oder unpassenden Inhalt. */
export function parseMatchEvent(event: MatchEventDto): ParsedMatchEvent | null {
  if (!isEventType(event.type)) return null;
  const schema: z.ZodType = matchEventPayloadSchemas[event.type];
  const parsed = schema.safeParse(event.payload);
  if (!parsed.success) return null;
  return {
    seq: event.seq,
    at: event.at,
    type: event.type,
    payload: parsed.data,
  } as ParsedMatchEvent;
}
