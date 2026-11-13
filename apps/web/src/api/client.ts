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
  matchActionResponseSchema,
  matchAnswerResponseSchema,
  matchListResponseSchema,
  matchPresentResponseSchema,
  matchWatchResponseSchema,
  matchViewSchema,
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
  type MatchAnswerRequest,
  type MatchBotStrengthCode,
  type MatchCreateRequest,
  type PasswordChangeRequest,
  type PlayerNamePartsDto,
  type QuestionCategory,
  type RealmOrderDto,
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

/**
 * Fehler, nach denen derselbe lesende Aufruf später gelingen kann: kein Netz, Überlast (429) oder
 * ein Fehler des Servers oder eines Zwischenrechners (5xx). Alles andere ist eine Antwort, die
 * bleibt.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  return error instanceof ApiRequestError && (error.status === 429 || error.status >= 500);
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
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    // Die Verbindung riss, während die Antwort kam: Ob sie gilt, weiß der Browser nicht
    throw new NetworkError(error);
  }
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
  // Partie (API.md §2.6)
  matches: () => request('GET', '/matches', matchListResponseSchema),
  createMatch: (body: MatchCreateRequest, idempotencyKey: string) =>
    request('POST', '/matches', matchActionResponseSchema, { body, idempotencyKey }),
  joinMatch: (inviteCode: string, idempotencyKey: string) =>
    request('POST', '/matches/join', matchActionResponseSchema, {
      body: { inviteCode },
      idempotencyKey,
    }),
  leaveMatch: (matchId: string, idempotencyKey: string) =>
    request('POST', `/matches/${matchId}/leave`, matchActionResponseSchema, { idempotencyKey }),
  startMatch: (matchId: string, idempotencyKey: string) =>
    request('POST', `/matches/${matchId}/start`, matchActionResponseSchema, { idempotencyKey }),
  /** Bot auf einen Platz der Aufstellung setzen oder ihn mit `null` wieder freigeben (ADR-052). */
  setSeatBot: (
    matchId: string,
    joinOrder: number,
    strength: MatchBotStrengthCode | null,
    idempotencyKey: string,
  ) =>
    request('POST', `/matches/${matchId}/seats/${joinOrder}/bot`, matchActionResponseSchema, {
      body: { strength },
      idempotencyKey,
    }),
  /** Lieblingskategorien des eigenen Platzes in der Aufstellung einer Partie mit Ausbau. */
  setMatchFavorites: (
    matchId: string,
    categories: readonly QuestionCategory[],
    idempotencyKey: string,
  ) =>
    request('POST', `/matches/${matchId}/favorites`, matchActionResponseSchema, {
      body: { categories },
      idempotencyKey,
    }),
  /** Befehle der Rüstzeit abgeben; eine weitere Abgabe ersetzt die vorige (API.md §2.6). */
  submitMatchOrders: (matchId: string, orders: readonly RealmOrderDto[], idempotencyKey: string) =>
    request('POST', `/matches/${matchId}/orders`, matchActionResponseSchema, {
      body: { orders },
      idempotencyKey,
    }),
  match: (matchId: string, after: number) =>
    request('GET', `/matches/${matchId}?after=${after}`, matchViewSchema),
  pickRegion: (matchId: string, region: number, idempotencyKey: string) =>
    request('POST', `/matches/${matchId}/pick`, matchActionResponseSchema, {
      body: { region },
      idempotencyKey,
    }),
  // Wie `present` der Herausforderung ohne Schlüssel: Eine Wiederholung liefert dieselbe Frage
  presentMatchQuestion: (matchId: string, seq: number) =>
    request('POST', `/matches/${matchId}/questions/${seq}/present`, matchPresentResponseSchema),
  // Mitlesen als Zuschauer (ADR-065): ändert nichts am Server
  watchMatchQuestion: (matchId: string, seq: number) =>
    request('GET', `/matches/${matchId}/questions/${seq}/watch`, matchWatchResponseSchema),
  answerMatchQuestion: (
    matchId: string,
    seq: number,
    body: MatchAnswerRequest,
    idempotencyKey: string,
  ) =>
    request('POST', `/matches/${matchId}/questions/${seq}/answer`, matchAnswerResponseSchema, {
      body,
      idempotencyKey,
    }),
};

/**
 * Schlüssel einer Nutzeraktion über Wiederholungen hinweg. Nach einer Antwort des Servers (Erfolg
 * oder Ablehnung) gibt es für den nächsten Versuch einen neuen Schlüssel: Eine Ablehnung speichert
 * nichts. Nach einem Netzfehler bleibt er, denn ob das Kommando wirkte, ist offen; nur eine
 * geänderte Eingabe (etwa ein anderer Reichsname) bekommt einen neuen, sonst antwortete der
 * Server mit `IDEMPOTENCY_KEY_REUSED`.
 */
export class ActionKey {
  private key: string | null = null;
  private payload: string | null = null;

  get current(): string {
    return this.for(undefined);
  }

  /** Schlüssel für diese Eingabe; dieselbe Eingabe behält ihn bis zur nächsten Antwort. */
  for(payload: unknown): string {
    const fingerprint = JSON.stringify(payload ?? null);
    if (this.key === null || this.payload !== fingerprint) {
      this.key = newActionKey();
      this.payload = fingerprint;
    }
    return this.key;
  }

  settle(error?: unknown): void {
    if (!(error instanceof NetworkError)) this.key = null;
  }
}
