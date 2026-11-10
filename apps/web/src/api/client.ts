import {
  API_PREFIX,
  IDEMPOTENCY_KEY_HEADER,
  answerResponseSchema,
  attackResponseSchema,
  authStatusSchema,
  challengeViewSchema,
  defenseResponseSchema,
  errorBodySchema,
  guestResponseSchema,
  joinResponseSchema,
  kingdomNameSuggestionsSchema,
  mapStateResponseSchema,
  mapStaticResponseSchema,
  meResponseSchema,
  playerNameSuggestionsSchema,
  presentResponseSchema,
  profileResponseSchema,
  regionDetailResponseSchema,
  sessionResponseSchema,
  siegesResponseSchema,
  worldsResponseSchema,
  type AnswerRequest,
  type ChunkRef,
  type KingdomNamePartsDto,
  type LoginRequest,
  type PasswordChangeRequest,
  type PlayerNamePartsDto,
  type RegisterRequest,
} from '@rdw/protocol';
import { z } from 'zod';

/**
 * Zugriff auf die REST-Schnittstelle (API.md). Jede Antwort wird gegen das Schema aus `protocol`
 * geprüft; Fehler kommen als `ApiRequestError` mit stabilem Code. Kommandos tragen einen
 * `Idempotency-Key`; bei einem Netzwerkfehler wird mit demselben Schlüssel wiederholt, so wirkt
 * ein Kommando höchstens einmal. Den Schlüssel erzeugt der Aufrufer je Nutzeraktion
 * (`newActionKey`), damit auch ein erneuter Klick nach einem Fehler derselbe Versuch bleibt.
 */

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
    this.name = 'ApiRequestError';
  }
}

/** Kein Kontakt zum Server (offline, Abbruch). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('NETWORK', { cause });
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  readonly body?: unknown;
  /** Schlüssel des Kommandos (alle POST außer den Ausnahmen in API.md §1). */
  readonly idempotencyKey?: string;
}

/** Neuer Schlüssel für eine Nutzeraktion; Wiederholungen derselben Aktion verwenden ihn erneut. */
export function newActionKey(): string {
  return crypto.randomUUID();
}

const NETWORK_RETRIES = 2;

type Method = 'GET' | 'POST' | 'PATCH';

/** Antworten ohne Inhalt (204). */
const noContent = z.undefined();

async function send(method: Method, path: string, options: RequestOptions) {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey;
  const init: RequestInit = {
    method,
    headers,
    credentials: 'same-origin',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(`${API_PREFIX}${path}`, init);
    } catch (error) {
      // Nur Kommandos mit Schlüssel und Lesezugriffe dürfen gefahrlos wiederholt werden.
      const repeatable = method === 'GET' || options.idempotencyKey !== undefined;
      if (!repeatable || attempt >= NETWORK_RETRIES) throw new NetworkError(error);
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

async function request<S extends z.ZodType>(
  method: Method,
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  const response = await send(method, path, options);
  const text = await response.text();
  if (!response.ok) {
    // Fehlerseiten von Proxys sind kein JSON; dann zählt nur der Status
    let json: unknown;
    try {
      json = text === '' ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    const parsed = errorBodySchema.safeParse(json);
    if (parsed.success) {
      throw new ApiRequestError(response.status, parsed.data.error.code, parsed.data.error.details);
    }
    throw new ApiRequestError(response.status, 'INTERNAL_ERROR');
  }
  return schema.parse(text === '' ? undefined : JSON.parse(text));
}

function chunkParam(chunks: readonly ChunkRef[]): string {
  return chunks.map((c) => `${c.chunkX}:${c.chunkY}`).join(',');
}

export const api = {
  bootstrap: () => request('GET', '/auth/bootstrap', authStatusSchema),
  // Ohne Idempotency-Key: Schutz vor Doppelanlage über das Bootstrap-Cookie (API.md §1)
  guest: () => request('POST', '/auth/guest', guestResponseSchema),
  // Konto (API.md §2.1). Anmelden und Abmelden ohne Schlüssel: Beide sind ohne Nebenwirkung
  // wiederholbar, eine neue Sitzung ersetzt die alte.
  register: (body: RegisterRequest, idempotencyKey: string) =>
    request('POST', '/auth/register', sessionResponseSchema, { body, idempotencyKey }),
  login: (body: LoginRequest) => request('POST', '/auth/login', sessionResponseSchema, { body }),
  logout: () => request('POST', '/auth/logout', noContent),
  me: () => request('GET', '/me', meResponseSchema),
  updateProfile: (playerName: PlayerNamePartsDto, idempotencyKey: string) =>
    request('PATCH', '/me/profile', profileResponseSchema, {
      body: { playerName },
      idempotencyKey,
    }),
  changePassword: (body: PasswordChangeRequest, idempotencyKey: string) =>
    request('POST', '/me/password', noContent, { body, idempotencyKey }),
  playerNames: () => request('GET', '/names/player', playerNameSuggestionsSchema),
  kingdomNames: (instanceId: string) =>
    request('GET', `/instances/${instanceId}/kingdom-names`, kingdomNameSuggestionsSchema),
  worlds: () => request('GET', '/worlds', worldsResponseSchema),
  join: (worldId: string, idempotencyKey: string, kingdomName?: KingdomNamePartsDto) =>
    request('POST', `/worlds/${worldId}/join`, joinResponseSchema, {
      idempotencyKey,
      ...(kingdomName ? { body: { kingdomName } } : {}),
    }),
  mapStatic: (instanceId: string, chunks: readonly ChunkRef[]) =>
    request(
      'GET',
      `/instances/${instanceId}/map/static?chunks=${chunkParam(chunks)}`,
      mapStaticResponseSchema,
    ),
  mapState: (instanceId: string, chunks: readonly ChunkRef[]) =>
    request(
      'GET',
      `/instances/${instanceId}/map/state?chunks=${chunkParam(chunks)}`,
      mapStateResponseSchema,
    ),
  region: (instanceId: string, regionId: string) =>
    request('GET', `/instances/${instanceId}/regions/${regionId}`, regionDetailResponseSchema),
  attack: (instanceId: string, targetRegionId: string, idempotencyKey: string) =>
    request('POST', `/instances/${instanceId}/attacks`, attackResponseSchema, {
      body: { targetRegionId },
      idempotencyKey,
    }),
  challenge: (challengeId: string) =>
    request('GET', `/challenges/${challengeId}`, challengeViewSchema),
  // `present` ist von Natur aus wiederholbar und braucht keinen Schlüssel (ADR-033)
  present: (challengeId: string, step: number) =>
    request('POST', `/challenges/${challengeId}/steps/${step}/present`, presentResponseSchema),
  answer: (challengeId: string, step: number, body: AnswerRequest, idempotencyKey: string) =>
    request('POST', `/challenges/${challengeId}/steps/${step}/answer`, answerResponseSchema, {
      body,
      idempotencyKey,
    }),
  sieges: (instanceId: string) =>
    request('GET', `/instances/${instanceId}/sieges`, siegesResponseSchema),
  // Wie `present` ohne Schlüssel: Eine Wiederholung liefert dieselbe Frage (ADR-033)
  defend: (siegeId: string) => request('POST', `/sieges/${siegeId}/defense`, defenseResponseSchema),
  respawn: (instanceId: string, idempotencyKey: string, kingdomName?: KingdomNamePartsDto) =>
    request('POST', `/instances/${instanceId}/respawn`, joinResponseSchema, {
      idempotencyKey,
      ...(kingdomName ? { body: { kingdomName } } : {}),
    }),
};

/**
 * Schlüssel einer Nutzeraktion über Wiederholungen hinweg. Nach einer Antwort des Servers (Erfolg
 * oder Ablehnung) gibt es für den nächsten Versuch einen neuen Schlüssel: Eine Ablehnung speichert
 * nichts. Nach einem Netzfehler bleibt er, denn ob das Kommando wirkte, ist offen.
 */
export class ActionKey {
  private key: string | null = null;

  get current(): string {
    this.key ??= newActionKey();
    return this.key;
  }

  settle(error?: unknown): void {
    if (!(error instanceof NetworkError)) this.key = null;
  }
}
