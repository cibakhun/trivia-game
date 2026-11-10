import {
  API_PREFIX,
  IDEMPOTENCY_KEY_HEADER,
  answerResponseSchema,
  attackResponseSchema,
  authStatusSchema,
  challengeViewSchema,
  errorBodySchema,
  guestResponseSchema,
  joinResponseSchema,
  mapStateResponseSchema,
  mapStaticResponseSchema,
  meResponseSchema,
  presentResponseSchema,
  regionDetailResponseSchema,
  worldsResponseSchema,
  type AnswerRequest,
  type ChunkRef,
} from '@rdw/protocol';
import type { z } from 'zod';

/**
 * Zugriff auf die REST-Schnittstelle (API.md). Jede Antwort wird gegen das Schema aus `protocol`
 * geprüft; Fehler kommen als `ApiRequestError` mit stabilem Code. Kommandos tragen einen
 * `Idempotency-Key`; bei einem Netzwerkfehler wird mit demselben Schlüssel wiederholt, so wirkt
 * ein Kommando höchstens einmal.
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
  /** Kommando mit `Idempotency-Key` (alle POST außer den Ausnahmen in API.md §1). */
  readonly idempotent?: boolean;
}

const NETWORK_RETRIES = 2;

async function send(method: 'GET' | 'POST', path: string, options: RequestOptions) {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotent) headers[IDEMPOTENCY_KEY_HEADER] = crypto.randomUUID();
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
      const repeatable = method === 'GET' || options.idempotent === true;
      if (!repeatable || attempt >= NETWORK_RETRIES) throw new NetworkError(error);
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

async function request<S extends z.ZodType>(
  method: 'GET' | 'POST',
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  const response = await send(method, path, options);
  const text = await response.text();
  const json: unknown = text === '' ? undefined : JSON.parse(text);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(json);
    if (parsed.success) {
      throw new ApiRequestError(response.status, parsed.data.error.code, parsed.data.error.details);
    }
    throw new ApiRequestError(response.status, 'INTERNAL_ERROR');
  }
  return schema.parse(json);
}

function chunkParam(chunks: readonly ChunkRef[]): string {
  return chunks.map((c) => `${c.chunkX}:${c.chunkY}`).join(',');
}

export const api = {
  bootstrap: () => request('GET', '/auth/bootstrap', authStatusSchema),
  // Ohne Idempotency-Key: Schutz vor Doppelanlage über das Bootstrap-Cookie (API.md §1)
  guest: () => request('POST', '/auth/guest', guestResponseSchema),
  me: () => request('GET', '/me', meResponseSchema),
  worlds: () => request('GET', '/worlds', worldsResponseSchema),
  join: (worldId: string) =>
    request('POST', `/worlds/${worldId}/join`, joinResponseSchema, { idempotent: true }),
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
  attack: (instanceId: string, targetRegionId: string) =>
    request('POST', `/instances/${instanceId}/attacks`, attackResponseSchema, {
      body: { targetRegionId },
      idempotent: true,
    }),
  challenge: (challengeId: string) =>
    request('GET', `/challenges/${challengeId}`, challengeViewSchema),
  // `present` ist von Natur aus wiederholbar und braucht keinen Schlüssel (ADR-033)
  present: (challengeId: string, step: number) =>
    request('POST', `/challenges/${challengeId}/steps/${step}/present`, presentResponseSchema),
  answer: (challengeId: string, step: number, body: AnswerRequest) =>
    request('POST', `/challenges/${challengeId}/steps/${step}/answer`, answerResponseSchema, {
      body,
      idempotent: true,
    }),
};
