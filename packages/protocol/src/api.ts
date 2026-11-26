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
  // Konto (API.md §2.1, ADR-043)
  'INVALID_CREDENTIALS',
  'RATE_LIMITED',
  'ALREADY_REGISTERED',
  'GUEST_ACCOUNT',
  'USERNAME_TAKEN',
  'PLAYER_NAME_TAKEN',
  'INVALID_NAME',
  'NAME_NOT_ALLOWED',
  // E-Mail, Löschantrag, Namen melden (ADR-086)
  'EMAIL_TAKEN',
  'EMAIL_LINK_INVALID',
  'EMAIL_MISSING',
  'MATCH_IN_PROGRESS',
  'NAME_BLOCKED',
  'NOT_REPORTABLE',
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
  'CAPITAL_HIT_COOLDOWN',
  'CHALLENGE_IN_PROGRESS',
  'ATTACKER_SIEGE_LIMIT',
  'ATTACKER_ATTEMPT_LIMIT',
  'DEFENDER_SIEGE_LIMIT',
  'NO_QUESTION_AVAILABLE',
  // Verteidigung (SIEGE_SYSTEM §6.2)
  'DEADLINE_PASSED',
  'DEADLINE_TOO_CLOSE',
  // Neues Reich nach Totalverlust (GAME_RULES §3 Punkt 6)
  'KINGDOM_ACTIVE',
  // Herausforderung (QUIZ_ENGINE §7)
  'CHALLENGE_CLOSED',
  'STEP_NOT_AVAILABLE',
  'STEP_EXPIRED',
  'INVALID_OPTION_TOKEN',
  'INVALID_NUMBER_INPUT',
  // Partie (API.md §2.6, MATCH_RULES)
  'INVITE_CODE_UNKNOWN',
  'MATCH_FULL',
  'MATCH_NOT_IN_LOBBY',
  'MATCH_NOT_RUNNING',
  'ALREADY_IN_MATCH',
  'NOT_HOST',
  'NOT_ENOUGH_PLAYERS',
  'SEAT_NOT_AVAILABLE',
  'TEST_MATCHES_DISABLED',
  'NOT_YOUR_TURN',
  'INVALID_REGION',
  // Partie mit Ausbau (MATCH_RULES §11, ADR-058)
  'REALM_MATCHES_DISABLED',
  'NOT_ENOUGH_CATEGORIES',
  'INVALID_FAVORITES',
  'INVALID_ORDERS',
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

/**
 * Benutzername (ADR-082, löst O-10 ab): Ein Name, den der Spieler selbst tippt, ist zugleich
 * Anmeldename und Spielername, den die anderen sehen. Vor der Prüfung wird er vereinheitlicht
 * (NFC, Leerraum außen weg, innen ein Leerzeichen). Regeln für neue Namen [E]: 3 bis 20 Zeichen
 * aus Buchstaben (auch mit Akzent, etwa ä, á, ő, ł), Ziffern, Leerzeichen, `_`, `.` und `-`;
 * Anfang und Ende Buchstabe oder Ziffer, keine zwei Trennzeichen hintereinander, mindestens ein
 * Buchstabe. Groß- und Kleinschreibung, Akzente und Trennzeichen zählen beim Vergleich mit
 * vergebenen Namen nicht (`player_name_key` in Migration 0016). Den Wortfilter prüft nur der
 * Server. Ältere Anmeldenamen (ADR-043) bleiben gültig; die Datenbank prüft nur Zeichen und
 * Länge (`users_username_format`).
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
const NAME_LETTER =
  'A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF\\u0100-\\u0137\\u0139-\\u0148\\u014A-\\u017E\\u0218-\\u021B';
const NAME_CHAR = new RegExp(`^[${NAME_LETTER}0-9 _.-]$`, 'u');
const NAME_WORD_CHAR = new RegExp(`^[${NAME_LETTER}0-9]$`, 'u');
const NAME_LETTER_CHAR = new RegExp(`^[${NAME_LETTER}]$`, 'u');

/** Vereinheitlicht einen getippten Namen: NFC, Leerraum außen weg, innen ein Leerzeichen. */
export function normalizeUsername(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

/** Was an einem (vereinheitlichten) Namen nicht passt; `null`, wenn er den Regeln folgt. */
export type UsernameProblem = 'SHORT' | 'LONG' | 'CHARS' | 'EDGE' | 'DOUBLE' | 'NO_LETTER';

export function usernameProblem(name: string): UsernameProblem | null {
  const chars = Array.from(name);
  if (chars.length < USERNAME_MIN_LENGTH) return 'SHORT';
  if (chars.length > USERNAME_MAX_LENGTH) return 'LONG';
  if (!chars.every((c) => NAME_CHAR.test(c))) return 'CHARS';
  if (!NAME_WORD_CHAR.test(chars[0] ?? '') || !NAME_WORD_CHAR.test(chars.at(-1) ?? '')) {
    return 'EDGE';
  }
  for (let i = 1; i < chars.length; i++) {
    if (!NAME_WORD_CHAR.test(chars[i] ?? '') && !NAME_WORD_CHAR.test(chars[i - 1] ?? '')) {
      return 'DOUBLE';
    }
  }
  if (!chars.some((c) => NAME_LETTER_CHAR.test(c))) return 'NO_LETTER';
  return null;
}

export const usernameSchema = z
  .string()
  .max(200)
  .transform(normalizeUsername)
  .refine((name) => usernameProblem(name) === null, { message: 'Name passt nicht zu den Regeln' });

/** Passwortlänge (ADR-043, Mindestlänge 7 seit ADR-082): keine Zeichenklassenregeln. */
export const PASSWORD_MIN_LENGTH = 7;
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/**
 * Spielername aus Bausteinen (ADR-044): nur noch für Vorschläge (`GET /names/player`) und für
 * Konten, die vor ADR-082 gesichert wurden.
 */
export const playerNamePartsSchema = z
  .object({
    adjective: z.string().min(1).max(32),
    noun: z.string().min(1).max(32),
    number: z.number().int().min(2).max(99).nullable(),
  })
  .strict();
export type PlayerNamePartsDto = z.infer<typeof playerNamePartsSchema>;

/** Reichsname aus Vorsilbe und Endung (GAME_RULES §3.8). */
export const kingdomNamePartsSchema = z
  .object({ prefix: z.string().min(1).max(32), suffix: z.string().min(1).max(32) })
  .strict();
export type KingdomNamePartsDto = z.infer<typeof kingdomNamePartsSchema>;

/**
 * E-Mail-Adresse (ADR-086): Leerraum außen fällt weg, dann gilt die übliche Form `name@domain`
 * mit höchstens 254 Zeichen. Groß- und Kleinschreibung zählen beim Vergleich nicht (citext).
 */
export const EMAIL_MAX_LENGTH = 254;
export const emailSchema = z
  .string()
  .max(400)
  .transform((value) => value.trim())
  .pipe(z.email().max(EMAIL_MAX_LENGTH));

/**
 * Frist für die Bestätigung der E-Mail (O-48, ADR-086): Ein registriertes Konto muss seine Adresse
 * innerhalb von 30 Tagen bestätigen, sonst wird es gelöscht. Bis dahin spielt es ohne Einschränkung.
 */
export const EMAIL_VERIFY_DAYS = 30;
/** Ein Bestätigungslink gilt so lange [E]. */
export const EMAIL_LINK_DAYS = 7;
/** Frist zwischen Löschantrag und Löschung eines registrierten Kontos (O-47 B, ADR-086). */
export const ACCOUNT_DELETION_GRACE_DAYS = 7;

/** `POST /auth/register`: Gastkonto sichern (O-03, ADR-082, ADR-086): Name, E-Mail, Passwort. */
export const registerRequestSchema = z
  .object({ username: usernameSchema, email: emailSchema, password: passwordSchema })
  .strict();
export type RegisterRequest = z.input<typeof registerRequestSchema>;

/** `POST /auth/login`. Beim Anmelden wird nur die Länge geprüft, nicht das Format. */
export const loginRequestSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Antwort auf Sichern und Anmelden: das Konto der neuen Sitzung. */
export const sessionResponseSchema = guestResponseSchema;
export type SessionResponse = GuestResponse;

/**
 * Antwort auf `POST /auth/login`: Hatte das Konto einen Löschantrag, hebt die Anmeldung ihn auf
 * (O-47 B, ADR-086); `deletionCancelled` sagt es dem Spieler.
 */
export const loginResponseSchema = guestResponseSchema
  .extend({ deletionCancelled: z.boolean() })
  .strict();
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** `POST /me/password`. */
export const passwordChangeRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .strict();
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;

/** `PATCH /me/profile`: neuer Name, zugleich zum Anmelden (ADR-082). */
export const profileUpdateRequestSchema = z.object({ username: usernameSchema }).strict();
export type ProfileUpdateRequest = z.infer<typeof profileUpdateRequestSchema>;

export const profileSchema = z
  .object({
    /** Öffentlicher Spielername; `null`, solange keiner gewählt ist (Gäste). */
    displayName: z.string().min(1).nullable(),
    /**
     * Die Spielleitung hat den Namen nach einer Meldung gesperrt (O-48, ADR-086): Bis der Spieler
     * einen neuen wählt, kann er keine Partie eröffnen und keiner beitreten.
     */
    nameBlocked: z.boolean(),
  })
  .strict();
export type ProfileDto = z.infer<typeof profileSchema>;

export const profileResponseSchema = z
  .object({ profile: profileSchema, serverTime: timestampSchema })
  .strict();
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/**
 * Stand der E-Mail eines registrierten Kontos (ADR-086). `pending` ist eine neue Adresse, die
 * auf ihre Bestätigung wartet; bis dahin gilt `address`. `dueAt` ist die Frist, nach der ein Konto
 * ohne bestätigte Adresse gelöscht wird; `null`, wenn bestätigt ist oder der Server keine Mails
 * zustellt (dann wird auch nicht gelöscht).
 */
export const emailStateSchema = z
  .object({
    address: z.string().nullable(),
    verified: z.boolean(),
    pending: z.string().nullable(),
    dueAt: timestampSchema.nullable(),
  })
  .strict();
export type EmailState = z.infer<typeof emailStateSchema>;

/** `PUT /me/email`: neue Adresse eintragen; der Server schickt einen Bestätigungslink. */
export const emailChangeRequestSchema = z.object({ email: emailSchema }).strict();
export type EmailChangeRequest = z.input<typeof emailChangeRequestSchema>;

/**
 * Antwort auf `PUT /me/email` und `POST /me/email/resend`. `mailSent`: Ein Link ist unterwegs
 * (`false`, wenn keiner nötig war oder der Versand scheiterte).
 */
export const emailResponseSchema = z
  .object({ email: emailStateSchema, mailSent: z.boolean(), serverTime: timestampSchema })
  .strict();
export type EmailResponse = z.infer<typeof emailResponseSchema>;

/** Zeichen des Tokens im Bestätigungslink: 32 Zufallsbytes in Base64url. */
export const EMAIL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** `POST /auth/email/verify`: Token aus dem Link; geht ohne Sitzung (anderer Browser, Mail-App). */
export const emailVerifyRequestSchema = z
  .object({ token: z.string().regex(EMAIL_TOKEN_PATTERN) })
  .strict();
export type EmailVerifyRequest = z.infer<typeof emailVerifyRequestSchema>;

export const emailVerifyResponseSchema = z
  .object({ email: z.string(), serverTime: timestampSchema })
  .strict();
export type EmailVerifyResponse = z.infer<typeof emailVerifyResponseSchema>;

/**
 * `DELETE /me` (O-47, ADR-086): Löschantrag. Registrierte Konten bestätigen mit dem Passwort, Gäste
 * ohne. Alle Sitzungen enden sofort.
 */
export const accountDeleteRequestSchema = z
  .object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH).optional() })
  .strict();
export type AccountDeleteRequest = z.infer<typeof accountDeleteRequestSchema>;

/**
 * Antwort auf den Löschantrag: `deletesAt` ist der Zeitpunkt, ab dem gelöscht wird (registrierte
 * Konten nach 7 Tagen; eine Anmeldung vorher hebt den Antrag auf). `null`: sofort gelöscht (Gäste).
 */
export const accountDeleteResponseSchema = z
  .object({ deletesAt: timestampSchema.nullable(), serverTime: timestampSchema })
  .strict();
export type AccountDeleteResponse = z.infer<typeof accountDeleteResponseSchema>;

/** `GET /names/player` und `GET /instances/:id/kingdom-names`. */
export const playerNameSuggestionsSchema = z
  .object({
    suggestions: z.array(
      z.object({ parts: playerNamePartsSchema, name: z.string().min(1) }).strict(),
    ),
    serverTime: timestampSchema,
  })
  .strict();
export type PlayerNameSuggestions = z.infer<typeof playerNameSuggestionsSchema>;

/**
 * `GET /names/check?name=…` (ADR-082): Ist der Name als Benutzername zu haben? `name` ist die
 * vereinheitlichte Form. `MINE`: der eigene Name (beim Umbenennen), `TAKEN`: vergeben (auch in
 * anderer Schreibweise), `BLOCKED`: vom Wortfilter abgelehnt, `INVALID`: passt nicht zu den Regeln.
 */
export const NAME_CHECK_STATUSES = ['FREE', 'MINE', 'TAKEN', 'BLOCKED', 'INVALID'] as const;
export type NameCheckStatus = (typeof NAME_CHECK_STATUSES)[number];
export const nameCheckQuerySchema = z.object({ name: z.string().max(200) }).strict();
export const nameCheckSchema = z
  .object({ name: z.string(), status: z.enum(NAME_CHECK_STATUSES), serverTime: timestampSchema })
  .strict();
export type NameCheck = z.infer<typeof nameCheckSchema>;

export const kingdomNameSuggestionsSchema = z
  .object({
    suggestions: z.array(
      z.object({ parts: kingdomNamePartsSchema, name: z.string().min(1) }).strict(),
    ),
    serverTime: timestampSchema,
  })
  .strict();
export type KingdomNameSuggestions = z.infer<typeof kingdomNameSuggestionsSchema>;

/** Körper von Beitritt und Neugründung: optional ein gewählter Reichsname. */
export const foundKingdomRequestSchema = z
  .object({ kingdomName: kingdomNamePartsSchema.optional() })
  .strict();
export type FoundKingdomRequest = z.infer<typeof foundKingdomRequestSchema>;

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
    /** Anzeigename aus `nameParts` (generiert, nicht frei gewählt; GAME_RULES §3.8). */
    name: z.string().min(1),
    nameParts: kingdomNamePartsSchema,
    color: z.number().int().min(0),
    status: z.enum(['ACTIVE', 'FALLEN', 'DISSOLVED']),
    regionCount: z.number().int().min(0),
    /** Kosmetischer Rang (GAME_RULES §3.7); `null` ohne Regionen. */
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
    /**
     * Laufende eigene Herausforderung (Wiederaufnahme nach Reload): ein Angriff in Vorbereitung
     * oder eine begonnene Verteidigung, sonst `null`.
     */
    openChallengeId: entityIdSchema.nullable(),
    /** Eröffnete, noch offene Belagerungen gegen das eigene Reich (vor oder während der Verteidigung). */
    incomingSieges: z.number().int().min(0),
  })
  .strict();
export type MyInstance = z.infer<typeof myInstanceSchema>;

export const meResponseSchema = z
  .object({
    user: userSummarySchema
      .extend({
        createdAt: timestampSchema,
        /** Eigener Anmeldename; `null` bei Gästen. Nur in der eigenen Antwort. */
        username: z.string().nullable(),
        /** E-Mail des Kontos (ADR-086); `null` bei Gästen. Nur in der eigenen Antwort. */
        email: emailStateSchema.nullable(),
      })
      .strict(),
    profile: profileSchema,
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
 * Gleiche Liste wie `ATTACK_REFUSALS` in game-core; ein Test hält beide gleich.
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
  'CAPITAL_HIT_COOLDOWN',
  'CHALLENGE_IN_PROGRESS',
  'ATTACKER_SIEGE_LIMIT',
  'ATTACKER_ATTEMPT_LIMIT',
  'DEFENDER_SIEGE_LIMIT',
] as const satisfies readonly ErrorCode[];
export type AttackRefusalCode = (typeof ATTACK_REFUSAL_CODES)[number];

export const attackModeSchema = z.enum(['PVE', 'PVP']);
export type AttackMode = z.infer<typeof attackModeSchema>;
export const defenderKindSchema = z.enum(['NEUTRAL', 'NPC', 'PLAYER']);

/** Berechnete Angriffsberechtigung des Anfragenden für eine Region (API.md §2.2). */
export const attackEligibilitySchema = z
  .object({
    allowed: z.boolean(),
    mode: attackModeSchema.nullable(),
    defenderKind: defenderKindSchema.nullable(),
    reason: z.enum(ATTACK_REFUSAL_CODES).nullable(),
    /**
     * Schutz bis (`REGION_PROTECTED`, `KINGDOM_PROTECTED`), Ende der Sperre
     * (`CAPITAL_HIT_COOLDOWN`) bzw. nächster freier Versuch (`ATTACKER_SIEGE_LIMIT`,
     * `ATTACKER_ATTEMPT_LIMIT`).
     */
    until: timestampSchema.nullable(),
    /**
     * Ein Angriff auf ein Spielerreich beendet den eigenen Anfänger- oder Wiederaufbauschutz
     * (GAME_RULES §7); die Oberfläche warnt vorher.
     */
    endsOwnProtection: z.boolean(),
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
