import type { ErrorBody, ErrorCode } from '@rdw/protocol';
import type { FastifyError, FastifyInstance } from 'fastify';

/** Fachlicher Fehler mit stabilem Code (API.md §5); der Client lokalisiert anhand des Codes. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function errorBody(
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): ErrorBody {
  return { error: { code, message, details } };
}

/** PostgreSQL: Serialisierungsfehler und Verklemmung – die Anfrage kann wiederholt werden. */
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

/** Einheitliches Fehlerformat für alle Antworten, auch für Fehler von Fastify selbst. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.status).send(errorBody(error.code, error.message, error.details));
    }
    const state = sqlState(error);
    if (state && RETRYABLE_SQLSTATES.has(state)) {
      request.log.warn({ sqlState: state }, 'Gleichzeitige Änderung, Anfrage wiederholbar');
      return reply
        .status(409)
        .send(errorBody('CONCURRENT_UPDATE', 'Gleichzeitige Änderung, bitte wiederholen'));
    }
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status === 413) {
      return reply.status(413).send(errorBody('PAYLOAD_TOO_LARGE', 'Anfrage zu groß'));
    }
    if (status === 415) {
      return reply.status(415).send(errorBody('UNSUPPORTED_MEDIA_TYPE', 'Nur application/json'));
    }
    if (status >= 400 && status < 500) {
      return reply.status(400).send(errorBody('VALIDATION_FAILED', 'Ungültige Anfrage'));
    }
    request.log.error({ err: error }, 'Unerwarteter Fehler');
    return reply.status(500).send(errorBody('INTERNAL_ERROR', 'Interner Fehler'));
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send(errorBody('NOT_FOUND', 'Unbekannter Pfad')),
  );
}
