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
import {
  matchModeSchema,
  REALM_DUEL_EFFECTS,
  realmBuildingSchema,
  realmOrderSchema,
  realmOrdersSummarySchema,
  realmStandingSchema,
  realmWheelSchema,
} from './match-realm.ts';
import { questionCategorySchema, questionKindSchema } from './question.ts';

/**
 * Inhalt der Ereignisse einer Partie (`GET /matches/:matchId`, Feld `events`; API.md §2.6). Der
 * Server schreibt sie unter der Sperre der Partie, der Client liest sie mit `parseMatchEvent`.
 * Unbekannte Typen und unpassende Inhalte ergeben `null`: Ein älterer Client überspringt sie,
 * statt die Partie abzubrechen. Zusätzliche Felder (etwa der Zufallsnachweis `rng`) fallen weg.
 *
 * Die Partie mit Ausbau (MATCH_RULES §11, ADR-058) schreibt dieselben Ereignisse, wo der Inhalt
 * passt (mit zusätzlichen, hier optionalen Feldern), und eigene, wo er abweicht: Duell und
 * Abrechnung heißen dort `REALM_DUEL_RESOLVED` und `REALM_MATCH_FINISHED`.
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
    /** Fehlt in Partien von vor ADR-058; sie laufen ohne Ausbau. */
    mode: matchModeSchema.optional(),
  }),
  /** `bot` nennt die Stärke, wenn der Gastgeber einen Bot auf den Platz setzt oder entfernt. */
  PLAYER_JOINED: z.object({ joinOrder, bot: matchBotStrengthSchema.nullable().optional() }),
  PLAYER_LEFT: z.object({ joinOrder, bot: matchBotStrengthSchema.nullable().optional() }),
  MATCH_STARTED: z.object({
    seats: z.number().int().min(2).max(3),
    players: z.array(
      z.object({
        seat,
        joinOrder,
        bot: matchBotStrengthSchema.nullable(),
        /** Mit Ausbau: Lieblingskategorien dieses Sitzes. */
        favorites: z.array(questionCategorySchema).optional(),
      }),
    ),
    mode: matchModeSchema.optional(),
    /** Mit Ausbau: Kategorien des Glücksrads. */
    categories: z.array(questionCategorySchema).optional(),
  }),
  MATCH_ABANDONED: z.object({ reason: z.string().min(1) }),
  QUESTION_OPENED: z.object({
    seq: z.number().int().min(1),
    kind: questionKindSchema,
    purpose: z.enum(MATCH_QUESTION_PURPOSES),
    seats: z.array(seat),
    timeLimitMs: count,
    closesAt: timestampSchema,
    /** Mit Ausbau bei der Wissensfrage eines Duells: Kategorie vom Glücksrad. */
    category: questionCategorySchema.optional(),
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
  /** Mit Ausbau samt Glücksrad dieses Angriffs. */
  TARGET_CHOSEN: z.object({
    round,
    attacker: seat,
    defender: seat,
    region,
    wheel: realmWheelSchema.optional(),
  }),
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
  /** Mit Ausbau samt Vorräten, die an den Sieger gingen. */
  KINGDOM_ELIMINATED: z.object({
    round,
    seat,
    by: seat,
    regions: count,
    bread: count.optional(),
    material: count.optional(),
  }),
  MATCH_FINISHED: z.object({
    reason: z.enum(MATCH_FINISH_REASONS),
    standings: z.array(matchStandingSchema),
  }),

  // Partie mit Ausbau (MATCH_RULES §11)
  /** Rangfolge der Startfrage: Reihenfolge für Burgen, Startdörfer (rückwärts) und Runden. */
  START_RANKED: z.object({
    ranking: z.array(
      z.object({
        seat,
        place: z.number().int().min(1).max(3),
        distance: decimal.nullable(),
        effectiveMs: z.number().int().min(0).nullable(),
      }),
    ),
  }),
  CASTLE_CHOSEN: z.object({ seat, region, armies: count }),
  VILLAGE_CHOSEN: z.object({ seat, region }),
  /** Einkommen zu Beginn einer Feldzugrunde; danach beginnt die Rüstzeit. */
  INCOME: z.object({
    round,
    income: z.array(z.object({ seat, bread: count, material: count })),
  }),
  /** Ein Sitz hat seine Befehle abgegeben; was er befohlen hat, steht erst in `ORDERS_REVEALED`. */
  ORDERS_SUBMITTED: z.object({ round, seat }),
  /** Die Rüstzeit lief ab; `missing` hat nichts abgegeben und tut in dieser Runde nichts. */
  PREPARE_CLOSED: z.object({ round, missing: z.array(seat) }),
  /** Aufdecken: Befehle eines Reichs, ihre Wirkung und seine Vorräte danach. */
  ORDERS_REVEALED: z.object({
    round,
    seat,
    orders: z.array(realmOrderSchema),
    summary: realmOrdersSummarySchema,
    bread: count,
    material: count,
  }),
  /**
   * Das Glücksrad blieb stehen. `exhausted` nennt Kategorien des Rads, die keine ungestellte Frage
   * mehr hatten und deshalb nicht gezogen werden konnten (MATCH_RULES §11.6).
   */
  WHEEL_SPUN: z.object({
    round,
    region,
    category: questionCategorySchema,
    exhausted: z.array(questionCategorySchema).default([]),
  }),
  REALM_DUEL_RESOLVED: z.object({
    round,
    duel: z.number().int().min(1),
    attacker: seat,
    defender: seat,
    region,
    category: questionCategorySchema,
    winner: z.enum(['ATTACKER', 'DEFENDER']),
    reason: z.enum(MATCH_DUEL_REASONS),
    effect: z.enum(REALM_DUEL_EFFECTS),
    /** Gebäude auf dem Feld danach. */
    building: realmBuildingSchema,
    /** Leben der Burg danach; nur wenn eine Burg getroffen wurde. */
    castleLivesLeft: count.nullable(),
    regionValue: count,
    /** Armee, die der Verlierer verlor; `null` = er hatte keine in Reichweite. */
    armyLost: z.object({ seat, region }).nullable(),
  }),
  REALM_MATCH_FINISHED: z.object({
    reason: z.enum(MATCH_FINISH_REASONS),
    standings: z.array(realmStandingSchema),
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
