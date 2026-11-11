import { z } from 'zod';
import { entityIdSchema, timestampSchema } from './api.ts';
import { answerRequestSchema } from './combat.ts';
import {
  MAX_REALM_ORDERS,
  matchModeSchema,
  realmBuildingSchema,
  realmOrderSchema,
  realmStepKindSchema,
  realmWheelSchema,
} from './match-realm.ts';
import { matchEconomySchema } from './match-rules.ts';
import { QUESTION_CATEGORIES, questionCategorySchema, questionKindSchema } from './question.ts';

/**
 * Rundenbasierte Partie über HTTP (docs/API.md §2.6, docs/MATCH_RULES.md, ADR-049). Bis zur
 * Auflösung einer Frage enthält keine Antwort die Lösung, die Richtigkeit der eigenen Antwort oder
 * Antworten anderer Sitze (wie QUIZ_ENGINE §7.2).
 */

export const MATCH_KINDS = ['STANDARD', 'TEST'] as const;
export const matchKindSchema = z.enum(MATCH_KINDS);
export type MatchKind = z.infer<typeof matchKindSchema>;

export const MATCH_STATUSES = ['LOBBY', 'RUNNING', 'FINISHED', 'ABANDONED'] as const;
export const matchStatusSchema = z.enum(MATCH_STATUSES);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

/**
 * Worauf eine laufende Partie wartet: eine Wahl, Antworten auf eine Frage, das Ende der Auflösung
 * oder einer Ansage; in der Partie mit Ausbau auch auf die Befehle der Rüstzeit (`PREPARE`).
 */
export const MATCH_PHASES = ['PICK', 'QUESTION', 'REVEAL', 'ANNOUNCE', 'PREPARE'] as const;
export const matchPhaseSchema = z.enum(MATCH_PHASES);
export type MatchPhaseKind = z.infer<typeof matchPhaseSchema>;

/** Regeln: Standardzeiten oder verkürzte Spieltestzeiten (`PLAYTEST_MATCH_RULES`). */
export const MATCH_RULES_PRESETS = ['DEFAULT', 'PLAYTEST'] as const;
export const matchRulesPresetSchema = z.enum(MATCH_RULES_PRESETS);
export type MatchRulesPreset = z.infer<typeof matchRulesPresetSchema>;

/** Gleiche Liste wie `MATCH_BOT_STRENGTHS` in game-core; ein Test hält beide gleich. */
export const MATCH_BOT_STRENGTH_CODES = ['EASY', 'MEDIUM', 'HARD'] as const;
export const matchBotStrengthSchema = z.enum(MATCH_BOT_STRENGTH_CODES);
export type MatchBotStrengthCode = z.infer<typeof matchBotStrengthSchema>;

export const MATCH_STEP_KINDS = [
  'CAPITAL_PICK',
  'LAND_ESTIMATE',
  'LAND_PICK',
  'CAMPAIGN_TARGET',
  'DUEL_TRIVIA',
  'DUEL_ESTIMATE',
  'FINISHED',
] as const;
export const matchStepKindSchema = z.enum(MATCH_STEP_KINDS);

/** Einladungscode: 6 Zeichen ohne 0, O, 1, I; Eingabe ohne Rücksicht auf Groß- und Kleinschreibung. */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const inviteCodeSchema = z
  .string()
  .max(16)
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.string().regex(INVITE_CODE_PATTERN, 'Einladungscode hat 6 Zeichen'));

const seatSchema = z.number().int().min(0).max(2);
const durationSchema = z.number().int().min(0);
/** Index einer Region der Karte (Wendelmark: 0–23, Kernmark: 0–15). */
export const matchRegionIndexSchema = z.number().int().min(0).max(63);

// ---------------------------------------------------------------------------------------------
// Anfragen
// ---------------------------------------------------------------------------------------------

/**
 * `POST /matches`: normale Partie (Mitspieler über den Einladungscode, freie Plätze auf Wunsch
 * mit Bots, ADR-052) oder Testpartie, in der Bots die freien Plätze von selbst füllen (nicht in
 * Produktion, ADR-048). `botStrengths` nennt die Stärke je freiem Platz, wenn niemand beitritt
 * (Länge = Plätze − 1); treten Menschen bei, entfallen Bots von hinten. `mode: "REALM"` spielt die
 * Partie mit Ausbau (MATCH_RULES §11), solange der Server sie anbietet (`realmMatchesEnabled`).
 */
export const matchCreateRequestSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('STANDARD'),
        rules: matchRulesPresetSchema.default('DEFAULT'),
        mode: matchModeSchema.default('CLASSIC'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('TEST'),
        rules: matchRulesPresetSchema.default('DEFAULT'),
        mode: matchModeSchema.default('CLASSIC'),
        seats: z.union([z.literal(2), z.literal(3)]),
        botStrengths: z.array(matchBotStrengthSchema).min(1).max(2),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.kind === 'TEST' && value.botStrengths.length !== value.seats - 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['botStrengths'],
        message: 'Je freiem Platz genau eine Stärke',
      });
    }
  });
export type MatchCreateRequest = z.input<typeof matchCreateRequestSchema>;

/** `POST /matches/join`. */
export const matchJoinRequestSchema = z.object({ inviteCode: inviteCodeSchema }).strict();
export type MatchJoinRequest = z.input<typeof matchJoinRequestSchema>;

/**
 * `POST /matches/:matchId/seats/:joinOrder/bot`: Der Gastgeber setzt in der Aufstellung einer
 * normalen Partie einen Bot dieser Stärke auf den Platz (auch um die Stärke zu ändern) oder macht
 * den Platz mit `null` wieder frei (ADR-052).
 */
export const matchSeatBotRequestSchema = z
  .object({ strength: matchBotStrengthSchema.nullable() })
  .strict();
export type MatchSeatBotRequest = z.infer<typeof matchSeatBotRequestSchema>;

/**
 * `POST /matches/:matchId/favorites`: eigene Lieblingskategorien in der Aufstellung einer Partie
 * mit Ausbau (MATCH_RULES §11.1). Genau `realm.favoritesCount` verschiedene aus `realm.categories`;
 * das Konto merkt sie sich für die nächste Partie.
 */
export const matchFavoritesRequestSchema = z
  .object({
    categories: z.array(questionCategorySchema).min(1).max(QUESTION_CATEGORIES.length),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.categories).size !== value.categories.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['categories'],
        message: 'Jede Kategorie höchstens einmal',
      });
    }
  });
export type MatchFavoritesRequest = z.infer<typeof matchFavoritesRequestSchema>;

/**
 * `POST /matches/:matchId/orders`: Befehle der Rüstzeit abgeben und damit fertig sein (MATCH_RULES
 * §11.4). Eine leere Liste heißt: in dieser Runde nichts tun.
 */
export const matchOrdersRequestSchema = z
  .object({ orders: z.array(realmOrderSchema).max(MAX_REALM_ORDERS) })
  .strict();
export type MatchOrdersRequest = z.infer<typeof matchOrdersRequestSchema>;

/** `POST /matches/:matchId/pick`: Hauptstadt, Region der Landnahme oder Angriffsziel. */
export const matchPickRequestSchema = z.object({ region: matchRegionIndexSchema }).strict();
export type MatchPickRequest = z.infer<typeof matchPickRequestSchema>;

/** `POST /matches/:matchId/questions/:seq/answer`: wie bei Herausforderungen (QUIZ_ENGINE §6.2). */
export const matchAnswerRequestSchema = answerRequestSchema;
export type MatchAnswerRequest = z.infer<typeof matchAnswerRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Ansicht
// ---------------------------------------------------------------------------------------------

export const matchPlayerSchema = z
  .object({
    joinOrder: z.number().int().min(0).max(2),
    /** Sitz = Zugreihenfolge; vor dem Start `null`. */
    seat: seatSchema.nullable(),
    name: z.string().min(1),
    isBot: z.boolean(),
    botStrength: matchBotStrengthSchema.nullable(),
    isHost: z.boolean(),
    isMe: z.boolean(),
    /**
     * Lieblingskategorien in der Partie mit Ausbau; `null` ohne Ausbau und solange in der
     * Aufstellung nichts gewählt ist (beim Start bekommt dieser Platz dann zufällige).
     */
    favorites: z.array(questionCategorySchema).nullable(),
  })
  .strict();
export type MatchPlayer = z.infer<typeof matchPlayerSchema>;

export const matchRegionStateSchema = z
  .object({
    owner: seatSchema.nullable(),
    value: z.number().int().min(0),
    capitalOf: seatSchema.nullable(),
    fortifications: z.number().int().min(0),
  })
  .strict();

export const matchSeatStateSchema = z
  .object({
    seat: seatSchema,
    capital: matchRegionIndexSchema.nullable(),
    capitalLivesLeft: z.number().int().min(0),
    eliminated: z.boolean(),
    points: z.number().int().min(0),
    regions: z.number().int().min(0),
  })
  .strict();

/** Aktueller Schritt der Zustandsmaschine (MATCH_RULES §3); Felder je nach Schritt, sonst `null`. */
export const matchStepSchema = z
  .object({
    kind: matchStepKindSchema,
    round: z.number().int().min(1).nullable(),
    /** Wer jetzt wählt (Hauptstadt, Landnahme, Angriffsziel). */
    chooser: seatSchema.nullable(),
    attacker: seatSchema.nullable(),
    defender: seatSchema.nullable(),
    /** Umkämpfte Region eines Duells. */
    region: matchRegionIndexSchema.nullable(),
    finishReason: z.enum(['ROUNDS_COMPLETE', 'LAST_KINGDOM']).nullable(),
  })
  .strict();
export type MatchStepView = z.infer<typeof matchStepSchema>;

/**
 * Zugfolge des laufenden Abschnitts (MATCH_RULES §3, Zugfolge): wer schon dran war, wer dran ist, wer
 * noch kommt. Bei einer Schätzfrage der Landnahme sind alle zugleich dran; in der Wahl der
 * Landnahme steht ein Sitz je Wahl in der Liste, also auch zweimal.
 */
export const MATCH_TURN_STATUSES = ['DONE', 'NOW', 'NEXT'] as const;
export const matchTurnSchema = z
  .object({ seat: seatSchema, status: z.enum(MATCH_TURN_STATUSES) })
  .strict();
export type MatchTurn = z.infer<typeof matchTurnSchema>;

export const matchBoardSchema = z
  .object({
    map: z.string().min(1),
    regions: z.array(matchRegionStateSchema),
    seats: z.array(matchSeatStateSchema),
    step: matchStepSchema,
    turns: z.array(matchTurnSchema),
    questions: z.number().int().min(0),
    duels: z.number().int().min(0),
  })
  .strict();
export type MatchBoard = z.infer<typeof matchBoardSchema>;

// ---------------------------------------------------------------------------------------------
// Ansicht der Partie mit Ausbau (MATCH_RULES §11)
// ---------------------------------------------------------------------------------------------

const amountSchema = z.number().int().min(0);

export const realmRegionStateSchema = z
  .object({
    owner: seatSchema.nullable(),
    value: amountSchema,
    fortifications: amountSchema,
    building: realmBuildingSchema,
    /** Verbliebene Leben der Burg auf diesem Feld; 0 ohne Burg. */
    castleLivesLeft: amountSchema,
    /** Sitz, dessen Startburg hier steht. */
    startCastleOf: seatSchema.nullable(),
    /** Armeen des Besitzers auf diesem Feld. */
    armies: amountSchema,
  })
  .strict();

export const realmSeatStateSchema = z
  .object({
    seat: seatSchema,
    favorites: z.array(questionCategorySchema),
    bread: amountSchema,
    material: amountSchema,
    /** Einkommen der nächsten Feldzugrunde nach heutigem Stand. */
    income: z.object({ bread: amountSchema, material: amountSchema }).strict(),
    startCastle: matchRegionIndexSchema.nullable(),
    castles: amountSchema,
    /** Verbliebene Leben aller eigenen Burgen. */
    castleLivesLeft: amountSchema,
    eliminated: z.boolean(),
    points: amountSchema,
    regions: amountSchema,
  })
  .strict();

/** Aktueller Schritt der Partie mit Ausbau; Felder je nach Schritt, sonst `null`. */
export const realmStepSchema = z
  .object({
    kind: realmStepKindSchema,
    round: z.number().int().min(1).nullable(),
    /** Wer jetzt wählt (Burg, Startdorf, Landnahme, Angriffsziel). */
    chooser: seatSchema.nullable(),
    attacker: seatSchema.nullable(),
    defender: seatSchema.nullable(),
    region: matchRegionIndexSchema.nullable(),
    /** Kategorie, auf der das Glücksrad des laufenden Duells stehen blieb. */
    category: questionCategorySchema.nullable(),
    wheel: realmWheelSchema.nullable(),
    finishReason: z.enum(['ROUNDS_COMPLETE', 'LAST_KINGDOM']).nullable(),
  })
  .strict();
export type RealmStepView = z.infer<typeof realmStepSchema>;

/**
 * Karte der Partie mit Ausbau. Vorräte, Gebäude und Armeen sind für alle sichtbar; verdeckt sind
 * nur die Befehle der laufenden Rüstzeit. In der Rüstzeit zeigt `turns`, wer schon fertig ist.
 */
export const realmBoardSchema = z
  .object({
    map: z.string().min(1),
    regions: z.array(realmRegionStateSchema),
    seats: z.array(realmSeatStateSchema),
    /** Reihenfolge aus der Startfrage; leer, bis sie aufgelöst ist. */
    order: z.array(seatSchema),
    step: realmStepSchema,
    turns: z.array(matchTurnSchema),
    questions: amountSchema,
    duels: amountSchema,
  })
  .strict();
export type RealmBoard = z.infer<typeof realmBoardSchema>;

/** Alles zur Partie mit Ausbau; in der Ansicht `null`, wenn die Partie ohne Ausbau läuft. */
export const matchRealmViewSchema = z
  .object({
    /**
     * Kategorien des Glücksrads, nur aus ihnen wählt man Lieblingskategorien: in der Aufstellung
     * die, die gerade genug Wissensfragen haben, ab dem Start die der Partie.
     */
    categories: z.array(questionCategorySchema),
    /** So viele Lieblingskategorien wählt jeder (`economy.favorites`). */
    favoritesCount: z.number().int().min(1),
    campaignRounds: z.number().int().min(1),
    /** Preise, Erträge, Lose und Zeiten des Ausbaus (`rules.economy`). */
    economy: matchEconomySchema,
    /** Vor dem Start `null`. */
    board: realmBoardSchema.nullable(),
    /**
     * Eigene Befehle der laufenden Rüstzeit, sobald sie abgegeben sind; sonst `null`. Befehle
     * anderer stehen erst nach dem Aufdecken in `ORDERS_REVEALED`.
     */
    myOrders: z.array(realmOrderSchema).nullable(),
  })
  .strict();
export type MatchRealmView = z.infer<typeof matchRealmViewSchema>;

/** `START` ist die Startfrage der Partie mit Ausbau (MATCH_RULES §11.1). */
export const MATCH_QUESTION_PURPOSES = ['LAND', 'DUEL_TRIVIA', 'DUEL_ESTIMATE', 'START'] as const;
export const MATCH_ANSWER_STATUSES = [
  'NOT_PARTICIPATING',
  'NOT_PRESENTED',
  'PRESENTED',
  'ANSWERED',
  'MISSED',
] as const;

/** Laufende oder zuletzt aufgelöste Frage, ohne Inhalt (den liefert `present`). */
export const matchQuestionInfoSchema = z
  .object({
    seq: z.number().int().min(1),
    kind: questionKindSchema,
    purpose: z.enum(MATCH_QUESTION_PURPOSES),
    seats: z.array(seatSchema),
    closesAt: timestampSchema,
    resolved: z.boolean(),
    myStatus: z.enum(MATCH_ANSWER_STATUSES),
  })
  .strict();
export type MatchQuestionInfo = z.infer<typeof matchQuestionInfoSchema>;

export const matchEventSchema = z
  .object({
    seq: z.number().int().min(1),
    type: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
    at: timestampSchema,
  })
  .strict();
export type MatchEventDto = z.infer<typeof matchEventSchema>;

export const matchTimersSchema = z
  .object({
    triviaMs: durationSchema,
    estimateMs: durationSchema,
    pickMs: durationSchema,
    revealMs: durationSchema,
    /** Ansage eines Duells und Standzeit einer Bot-Wahl (ADR-053); 0 = keine. */
    announceMs: durationSchema,
    pickShowMs: durationSchema,
  })
  .strict();

/** `GET /matches/:matchId?after=n`: alles, was ein Teilnehmer sehen darf. */
export const matchViewSchema = z
  .object({
    match: z
      .object({
        id: entityIdSchema,
        kind: matchKindSchema,
        mode: matchModeSchema,
        status: matchStatusSchema,
        /** Nur in der Aufstellung. */
        inviteCode: z.string().nullable(),
        rulesPreset: matchRulesPresetSchema,
        /** Plätze: beim Start festgelegt; Testpartien kennen sie vorher. */
        seats: z.number().int().min(2).max(3).nullable(),
        timers: matchTimersSchema,
        createdAt: timestampSchema,
        startedAt: timestampSchema.nullable(),
        finishedAt: timestampSchema.nullable(),
      })
      .strict(),
    players: z.array(matchPlayerSchema),
    mySeat: seatSchema.nullable(),
    isHost: z.boolean(),
    /** Karte der Partie ohne Ausbau; mit Ausbau `null`, die Karte steht dann in `realm.board`. */
    board: matchBoardSchema.nullable(),
    realm: matchRealmViewSchema.nullable(),
    phase: z
      .object({
        kind: matchPhaseSchema,
        deadline: timestampSchema,
        remainingMs: durationSchema,
      })
      .strict()
      .nullable(),
    /** Wählbare Regionen, nur wenn der Anfragende gerade wählt. */
    legalRegions: z.array(matchRegionIndexSchema),
    question: matchQuestionInfoSchema.nullable(),
    /** Ereignisse nach `after` (höchstens 200); `lastEventSeq` ist das neueste überhaupt. */
    events: z.array(matchEventSchema),
    lastEventSeq: z.number().int().min(0),
    serverTime: timestampSchema,
  })
  .strict();
export type MatchView = z.infer<typeof matchViewSchema>;

export const matchSummarySchema = z
  .object({
    id: entityIdSchema,
    kind: matchKindSchema,
    mode: matchModeSchema,
    status: matchStatusSchema,
    inviteCode: z.string().nullable(),
    players: z.number().int().min(1).max(3),
    isHost: z.boolean(),
    createdAt: timestampSchema,
  })
  .strict();
export type MatchSummary = z.infer<typeof matchSummarySchema>;

/** `GET /matches`: offene Partien des Kontos und die letzten beendeten. */
export const matchListResponseSchema = z
  .object({
    matches: z.array(matchSummarySchema),
    testMatchesEnabled: z.boolean(),
    /** Ob dieser Server Partien mit Ausbau anlegt (`mode: "REALM"`). */
    realmMatchesEnabled: z.boolean(),
  })
  .strict();
export type MatchListResponse = z.infer<typeof matchListResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Frage und Antwort
// ---------------------------------------------------------------------------------------------

const matchQuestionBase = {
  matchId: entityIdSchema,
  seq: z.number().int().min(1),
  prompt: z.string().min(1),
  timeLimitMs: durationSchema,
  /** Restzeit bis zur Antwortgrenze dieses Sitzes (Zeitlimit + Latenzpuffer), nie negativ. */
  remainingMs: durationSchema,
  presentedAt: timestampSchema,
};

export const matchPresentedQuestionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...matchQuestionBase,
      kind: z.literal('TRIVIA'),
      options: z.array(z.object({ token: z.string().min(1), text: z.string().min(1) }).strict()),
    })
    .strict(),
  z
    .object({
      ...matchQuestionBase,
      kind: z.literal('ESTIMATE'),
      unitLabel: z.string().nullable(),
      answerPrecision: z.number().int().min(0),
    })
    .strict(),
]);
export type MatchPresentedQuestion = z.infer<typeof matchPresentedQuestionSchema>;

/** `POST /matches/:matchId/questions/:seq/present`: erstes Abholen startet die eigene Zeit. */
export const matchPresentResponseSchema = z
  .object({ question: matchPresentedQuestionSchema, serverTime: timestampSchema })
  .strict();
export type MatchPresentResponse = z.infer<typeof matchPresentResponseSchema>;

export const matchAnswerResponseSchema = z
  .object({
    matchId: entityIdSchema,
    seq: z.number().int().min(1),
    status: z.literal('ANSWERED'),
    serverTime: timestampSchema,
  })
  .strict();
export type MatchAnswerResponse = z.infer<typeof matchAnswerResponseSchema>;

/** Antwort auf Anlegen, Beitreten, Starten, Wählen und Befehle: die ID; den Stand liefert `GET`. */
export const matchActionResponseSchema = z
  .object({ matchId: entityIdSchema, serverTime: timestampSchema })
  .strict();
export type MatchActionResponse = z.infer<typeof matchActionResponseSchema>;
