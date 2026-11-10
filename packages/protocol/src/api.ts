import { z } from 'zod';
import { localeSchema } from './locale.ts';
import { worldModeSchema } from './rules-config.ts';

/**
 * REST-Schnittstelle (docs/API.md): Fehlercodes, Anfrage- und Antwortformen. Der Server baut
 * seine Antworten nach diesen Typen; Client und Tests prüfen sie mit den Schemas.
 */

export const API_PREFIX = '/api/v1';

// ---------------------------------------------------------------------------------------------
// Fehler (API.md §1, §5)
// ---------------------------------------------------------------------------------------------

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'CSRF_ORIGIN_MISMATCH',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'UNSUPPORTED_MEDIA_TYPE',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  'CONCURRENT_UPDATE',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'GUEST_BOOTSTRAP_REQUIRED',
  'GUEST_BOOTSTRAP_USED',
  'ALREADY_JOINED',
  'INSTANCE_FULL',
  'INSTANCE_NOT_ACTIVE',
  'NO_START_REGION',
  // Angriff (GAME_RULES §4); dieselben Codes wie ATTACK_REFUSAL_CODES
  'NO_ACTIVE_KINGDOM',
  'OWN_REGION',
  'NOT_ADJACENT',
  'REGION_UNDER_SIEGE',
  'REGION_PROTECTED',
  'KINGDOM_PROTECTED',
  'RANK_GAP',
  'CHALLENGE_IN_PROGRESS',
  'ATTACKER_ATTEMPT_LIMIT',
  'PVP_NOT_AVAILABLE',
  'NO_QUESTION_AVAILABLE',
  // Herausforderung (QUIZ_ENGINE §7)
  'CHALLENGE_CLOSED',
  'STEP_NOT_AVAILABLE',
  'STEP_EXPIRED',
  'INVALID_OPTION_TOKEN',
  'INVALID_NUMBER_INPUT',
  'ANSWER_OUT_OF_RANGE',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** `{ "error": { "code", "message", "details" } }`; die Nachricht lokalisiert der Client. */
export const errorBodySchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string(),
        details: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();
export type ErrorBody = z.infer<typeof errorBodySchema>;

// ---------------------------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------------------------

/** IDs fachlicher Entitäten (UUID, in der Anwendung als UUIDv7 erzeugt). */
export const entityIdSchema = z.uuid();
/** Regions-IDs sind `bigint` in der Datenbank und werden als Dezimaltext übertragen. */
const REGION_ID_PATTERN = /^[1-9][0-9]{0,18}$/;
const BIGINT_MAX = 2n ** 63n - 1n;
export const regionIdSchema = z
  .string()
  .refine(
    (value) => REGION_ID_PATTERN.test(value) && BigInt(value) <= BIGINT_MAX,
    'Regions-ID muss eine positive Ganzzahl im bigint-Bereich sein',
  );
/** Zeitpunkte als ISO-8601 in UTC. */
export const timestampSchema = z.iso.datetime();

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const idempotencyKeySchema = z.uuid();

/** Höchstzahl an Chunks je Kartenabfrage. */
export const MAX_CHUNKS_PER_REQUEST = 64;

export interface ChunkRef {
  readonly chunkX: number;
  readonly chunkY: number;
}

const CHUNK_PATTERN = /^(-?\d{1,6}):(-?\d{1,6})$/;

/**
 * Chunk-Liste aus der Abfrage: `x:y,x:y,…` (API.md §2.2). Doppelte Einträge fallen weg, die
 * Reihenfolge ist danach fest (Zeile, dann Spalte), damit gleiche Mengen gleiche Antworten und
 * gleiche ETags ergeben.
 */
export const chunkListSchema = z
  .string()
  .min(1)
  .max(MAX_CHUNKS_PER_REQUEST * 16)
  .transform((value, ctx): ChunkRef[] => {
    const chunks = new Map<string, ChunkRef>();
    for (const part of value.split(',')) {
      const match = CHUNK_PATTERN.exec(part);
      if (!match) {
        ctx.addIssue({ code: 'custom', message: `Ungültiger Chunk: ${part.slice(0, 20)}` });
        return z.NEVER;
      }
      const chunkX = Number(match[1]);
      const chunkY = Number(match[2]);
      // „-0:0“ und „0:0“ sind derselbe Chunk; `+ 0` macht aus -0 eine 0
      chunks.set(`${chunkX}:${chunkY}`, { chunkX: chunkX + 0, chunkY: chunkY + 0 });
    }
    if (chunks.size > MAX_CHUNKS_PER_REQUEST) {
      ctx.addIssue({ code: 'custom', message: `Höchstens ${MAX_CHUNKS_PER_REQUEST} Chunks` });
      return z.NEVER;
    }
    return [...chunks.values()].sort((a, b) => a.chunkY - b.chunkY || a.chunkX - b.chunkX);
  });

// ---------------------------------------------------------------------------------------------
// Konto (API.md §2.1)
// ---------------------------------------------------------------------------------------------

export const userSummarySchema = z.object({ id: entityIdSchema, isGuest: z.boolean() }).strict();
export type UserSummary = z.infer<typeof userSummarySchema>;

export const authStatusSchema = z
  .object({
    authenticated: z.boolean(),
    user: userSummarySchema.nullable(),
    serverTime: timestampSchema,
  })
  .strict();
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const guestResponseSchema = z
  .object({ user: userSummarySchema, serverTime: timestampSchema })
  .strict();
export type GuestResponse = z.infer<typeof guestResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Reiche
// ---------------------------------------------------------------------------------------------

/** Gleiche Liste wie `KINGDOM_RANKS` in game-core; ein Test hält beide gleich. */
export const KINGDOM_RANK_CODES = [
  'SETTLEMENT',
  'VILLAGE_LEAGUE',
  'PRINCIPALITY',
  'KINGDOM',
  'GREAT_KINGDOM',
  'EMPIRE',
] as const;

export const kingdomSummarySchema = z
  .object({
    id: entityIdSchema,
    kind: z.enum(['PLAYER', 'NPC']),
    /** Anzeigename aus `nameParts` (generiert, nicht frei gewählt; GAME_RULES §3.7). */
    name: z.string().min(1),
    nameParts: z.object({ prefix: z.string().min(1), suffix: z.string().min(1) }).strict(),
    color: z.number().int().min(0),
    status: z.enum(['ACTIVE', 'FALLEN', 'DISSOLVED']),
    regionCount: z.number().int().min(0),
    /** Kosmetischer Rang (GAME_RULES §3.6); `null` ohne Regionen. */
    rank: z.enum(KINGDOM_RANK_CODES).nullable(),
    /** Nur NPC-Reiche: Archetyp der Fraktion. */
    archetype: z.enum(['LIGHT', 'MEDIUM', 'HEAVY']).nullable(),
    capitalRegionId: regionIdSchema.nullable(),
    protectedUntil: timestampSchema.nullable(),
    protectionReason: z.enum(['NEWBIE', 'RESPAWN', 'VACATION']).nullable(),
  })
  .strict();
export type KingdomSummary = z.infer<typeof kingdomSummarySchema>;

export const kingdomProfileSchema = kingdomSummarySchema
  .extend({ foundedAt: timestampSchema, generation: z.number().int().min(1) })
  .strict();
export type KingdomProfile = z.infer<typeof kingdomProfileSchema>;

export const kingdomResponseSchema = z
  .object({ kingdom: kingdomProfileSchema, serverTime: timestampSchema })
  .strict();
export type KingdomResponse = z.infer<typeof kingdomResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Profil (GET /me)
// ---------------------------------------------------------------------------------------------

export const instanceStatusSchema = z.enum([
  'PROVISIONING',
  'RUNNING',
  'CLOSING',
  'CLOSED',
  'ARCHIVED',
]);

export const myInstanceSchema = z
  .object({
    instanceId: entityIdSchema,
    worldId: entityIdSchema,
    worldSlug: z.string(),
    mode: worldModeSchema,
    status: instanceStatusSchema,
    kingdom: kingdomSummarySchema.nullable(),
    /**
     * Ziel der Tutorial-Garnison (NPC_SYSTEM §4): nur solange das Reich genau eine Region hat
     * und ein freier neutraler Nachbar existiert.
     */
    tutorialTargetRegionId: regionIdSchema.nullable(),
    /** Laufende eigene Herausforderung (Wiederaufnahme nach Reload), sonst `null`. */
    openChallengeId: entityIdSchema.nullable(),
  })
  .strict();
export type MyInstance = z.infer<typeof myInstanceSchema>;

export const meResponseSchema = z
  .object({
    user: userSummarySchema.extend({ createdAt: timestampSchema }).strict(),
    settings: z.object({ locale: localeSchema }).strict(),
    instances: z.array(myInstanceSchema),
    serverTime: timestampSchema,
  })
  .strict();
export type MeResponse = z.infer<typeof meResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Welten (API.md §2.2)
// ---------------------------------------------------------------------------------------------

export const worldInstanceInfoSchema = z
  .object({
    id: entityIdSchema,
    status: instanceStatusSchema,
    capacity: z.number().int().min(1),
    participants: z.number().int().min(0),
    startsAt: timestampSchema,
    endsAt: timestampSchema.nullable(),
    /** Restlaufzeit; `null` ohne Ende (Eternal). */
    remainingMs: z.number().int().min(0).nullable(),
    joined: z.boolean(),
  })
  .strict();

export const worldsResponseSchema = z
  .object({
    worlds: z.array(
      z
        .object({
          id: entityIdSchema,
          slug: z.string(),
          mode: worldModeSchema,
          nameKey: z.string(),
          instances: z.array(worldInstanceInfoSchema),
        })
        .strict(),
    ),
    serverTime: timestampSchema,
  })
  .strict();
export type WorldsResponse = z.infer<typeof worldsResponseSchema>;

export const joinResponseSchema = z
  .object({
    instanceId: entityIdSchema,
    kingdom: kingdomSummarySchema,
    capitalRegionId: regionIdSchema,
    tutorialTargetRegionId: regionIdSchema.nullable(),
    serverTime: timestampSchema,
  })
  .strict();
export type JoinResponse = z.infer<typeof joinResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Karte (API.md §2.2)
// ---------------------------------------------------------------------------------------------

/** Unveränderliche Daten einer Region; `biome` ist der Index in `BIOMES` (game-core). */
export const staticRegionSchema = z
  .object({
    id: regionIdSchema,
    q: z.number().int(),
    r: z.number().int(),
    biome: z.number().int().min(0),
    tier: z.number().int().min(0).max(10),
  })
  .strict();

export const mapStaticResponseSchema = z
  .object({
    instanceId: entityIdSchema,
    mapgenVersion: z.number().int().min(1),
    chunks: z.array(
      z
        .object({
          chunkX: z.number().int(),
          chunkY: z.number().int(),
          regions: z.array(staticRegionSchema),
        })
        .strict(),
    ),
  })
  .strict();
export type MapStaticResponse = z.infer<typeof mapStaticResponseSchema>;

export const regionStateSchema = z
  .object({
    id: regionIdSchema,
    ownerKingdomId: entityIdSchema.nullable(),
    isCapital: z.boolean(),
    protectedUntil: timestampSchema.nullable(),
    underSiege: z.boolean(),
  })
  .strict();
export type RegionStateDto = z.infer<typeof regionStateSchema>;

export const mapStateResponseSchema = z
  .object({
    instanceId: entityIdSchema,
    /** Stand der Ereignisfolge (`world_instances.event_seq`), passend zum gelieferten Zustand. */
    seq: z.string().regex(/^\d+$/),
    chunks: z.array(
      z
        .object({
          chunkX: z.number().int(),
          chunkY: z.number().int(),
          regions: z.array(regionStateSchema),
        })
        .strict(),
    ),
    /** Alle Reiche, denen eine gelieferte Region gehört. */
    kingdoms: z.array(kingdomSummarySchema),
    serverTime: timestampSchema,
  })
  .strict();
export type MapStateResponse = z.infer<typeof mapStateResponseSchema>;

/**
 * Gründe, aus denen ein Angriff nicht möglich ist, in der Prüfreihenfolge aus GAME_RULES §4.
 * Gleiche Liste wie `ATTACK_REFUSALS` in game-core plus `PVP_NOT_AVAILABLE` (PvP kommt mit
 * Phase 2); ein Test hält beide gleich.
 */
export const ATTACK_REFUSAL_CODES = [
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
  'PVP_NOT_AVAILABLE',
] as const satisfies readonly ErrorCode[];
export type AttackRefusalCode = (typeof ATTACK_REFUSAL_CODES)[number];

export const attackModeSchema = z.enum(['PVE', 'PVP']);
export const defenderKindSchema = z.enum(['NEUTRAL', 'NPC', 'PLAYER']);

/** Berechnete Angriffsberechtigung des Anfragenden für eine Region (API.md §2.2). */
export const attackEligibilitySchema = z
  .object({
    allowed: z.boolean(),
    mode: attackModeSchema.nullable(),
    defenderKind: defenderKindSchema.nullable(),
    reason: z.enum(ATTACK_REFUSAL_CODES).nullable(),
    /** Schutz bis (`REGION_PROTECTED`, `KINGDOM_PROTECTED`) bzw. nächster freier Versuch (`ATTACKER_ATTEMPT_LIMIT`). */
    until: timestampSchema.nullable(),
  })
  .strict();
export type AttackEligibilityDto = z.infer<typeof attackEligibilitySchema>;

/** Gründe für Regionsschutz: nach Eroberung, nach einem Treffer auf die Hauptstadt, Betrieb. */
export const REGION_PROTECTION_REASONS = ['CONQUEST', 'CAPITAL_HIT', 'ADMIN'] as const;

export const capitalLivesSchema = z
  .object({
    lives: z.number().int().min(0),
    maxLives: z.number().int().min(1),
    /** Nächstes zurückkehrendes Leben; `null` bei vollen Leben oder ohne Erholung. */
    nextLifeAt: timestampSchema.nullable(),
  })
  .strict();
export type CapitalLivesDto = z.infer<typeof capitalLivesSchema>;

export const regionDetailResponseSchema = z
  .object({
    region: staticRegionSchema
      .extend({
        chunkX: z.number().int(),
        chunkY: z.number().int(),
        ownerKingdomId: entityIdSchema.nullable(),
        isCapital: z.boolean(),
        ownedSince: timestampSchema.nullable(),
        protectedUntil: timestampSchema.nullable(),
        protectionReason: z.enum(REGION_PROTECTION_REASONS).nullable(),
        underSiege: z.boolean(),
      })
      .strict(),
    owner: kingdomSummarySchema.nullable(),
    /** Leben der Hauptstadt (GAME_RULES §3); nur wenn die Region eine Hauptstadt ist. */
    capital: capitalLivesSchema.nullable(),
    attack: attackEligibilitySchema,
    serverTime: timestampSchema,
  })
  .strict();
export type RegionDetailResponse = z.infer<typeof regionDetailResponseSchema>;
