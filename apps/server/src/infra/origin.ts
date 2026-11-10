import type { FastifyInstance } from 'fastify';
import { ApiError } from './errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF-Schutz (API.md §1, SECURITY.md §2): Zustandsändernde Anfragen müssen den Header `Origin`
 * mit genau der Herkunft des Clients tragen; fehlt er, wird abgelehnt. Zusammen mit
 * `SameSite=Lax` (Sitzung) und `SameSite=Strict` (Bootstrap) genügt das ohne Double-Submit-Token
 * (ADR-028).
 */
export function registerOriginCheck(app: FastifyInstance, publicOrigin: string): void {
  app.addHook('onRequest', (request, _reply, done) => {
    if (!SAFE_METHODS.has(request.method) && request.headers.origin !== publicOrigin) {
      done(new ApiError(403, 'CSRF_ORIGIN_MISMATCH', 'Anfrage von fremder Herkunft'));
      return;
    }
    done();
  });
}
