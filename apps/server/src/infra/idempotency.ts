import type { Db, Tx } from '@rdw/db';
import { IDEMPOTENCY_KEY_HEADER, idempotencyKeySchema } from '@rdw/protocol';
import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { gameNow } from './clock.ts';
import { canonicalJson, sha256Hex } from './crypto.ts';
import { ApiError } from './errors.ts';

/**
 * Idempotenz zustandsändernder Anfragen (API.md §1): je Konto und Schlüssel höchstens eine
 * Wirkung. Ablauf in einer Transaktion: Beratungssperre auf (Konto, Schlüssel) → gespeicherte
 * Antwort suchen → sonst Wirkung ausführen und Antwort im selben Commit speichern. Eine
 * gleichzeitige Wiederholung wartet an der Sperre und liefert danach die gespeicherte Antwort.
 *
 * Fachliche Fehler (ApiError) rollen die Transaktion zurück und werden nicht gespeichert: Sie
 * hatten keine Wirkung, eine Wiederholung prüft neu.
 */

/** Aufbewahrung im Antwortspeicher; ältere Einträge gelten als nicht vorhanden. */
export const IDEMPOTENCY_RETENTION_HOURS = 24;

export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface IdempotentOutcome extends StoredResponse {
  /** `true`, wenn die Antwort aus dem Speicher kommt. */
  readonly replayed: boolean;
}

/** Liest den Header `Idempotency-Key` (UUID). */
export function idempotencyKey(request: FastifyRequest): string {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  if (raw === undefined || raw === '') {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Header Idempotency-Key fehlt');
  }
  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Idempotency-Key muss eine UUID sein');
  }
  return parsed.data.toLowerCase();
}

export interface IdempotentRequest {
  readonly userId: string;
  readonly key: string;
  /** Methode und Routenmuster, z. B. `POST /worlds/:worldId/join`. */
  readonly endpoint: string;
  /** Alles, was die Wirkung bestimmt (Pfadparameter, Körper); geht in den Anfrage-Hash ein. */
  readonly input: unknown;
}

export async function runIdempotent(
  db: Db,
  request: IdempotentRequest,
  work: (tx: Tx) => Promise<StoredResponse>,
): Promise<IdempotentOutcome> {
  const requestHash = sha256Hex(
    canonicalJson({ endpoint: request.endpoint, input: request.input }),
  );
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`idem:${request.userId}:${request.key}`}, 0))`.execute(
      tx,
    );
    await tx
      .deleteFrom('idempotency_keys')
      .where('user_id', '=', request.userId)
      .where('key', '=', request.key)
      .where(
        'created_at',
        '<',
        sql<Date>`game_now() - make_interval(hours => ${IDEMPOTENCY_RETENTION_HOURS})`,
      )
      .execute();
    const stored = await tx
      .selectFrom('idempotency_keys')
      .select(['endpoint', 'request_hash', 'response_status', 'response_body'])
      .where('user_id', '=', request.userId)
      .where('key', '=', request.key)
      .executeTakeFirst();
    if (stored) {
      if (stored.endpoint !== request.endpoint || stored.request_hash !== requestHash) {
        throw new ApiError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key wurde für eine andere Anfrage verwendet',
        );
      }
      return { status: stored.response_status, body: stored.response_body, replayed: true };
    }
    const response = await work(tx);
    await tx
      .insertInto('idempotency_keys')
      .values({
        user_id: request.userId,
        key: request.key,
        endpoint: request.endpoint,
        request_hash: requestHash,
        response_status: response.status,
        response_body: JSON.stringify(response.body),
        created_at: gameNow,
      })
      .execute();
    return { ...response, replayed: false };
  });
}

/**
 * Löscht abgelaufene Einträge aller Konten in Stapeln (Aufbewahrung wie oben); `runIdempotent`
 * räumt nur den eigenen Schlüssel auf. Liefert die Zahl der gelöschten Zeilen.
 */
export async function pruneIdempotencyKeys(db: Db, batchSize = 1000): Promise<number> {
  const result = await sql`
    delete from idempotency_keys
    where ctid in (
      select ctid from idempotency_keys
      where created_at < game_now() - make_interval(hours => ${IDEMPOTENCY_RETENTION_HOURS})
      limit ${batchSize}
    )`.execute(db);
  return Number(result.numAffectedRows ?? 0n);
}
