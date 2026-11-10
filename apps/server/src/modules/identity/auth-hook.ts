import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../../context.ts';
import { ApiError } from '../../infra/errors.ts';
import { sessionCookieOptions } from './cookies.ts';
import { authenticate, SESSION_COOKIE, type AuthContext } from './sessions.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Angemeldetes Konto; `null` ohne gültige Sitzung. */
    auth: AuthContext | null;
  }
}

/** Liest das Sitzungscookie jeder Anfrage; verlängert die Sitzung gleitend (Cookie neu). */
export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token === undefined) return;
    const auth = await authenticate(ctx.db, token);
    const options = sessionCookieOptions(ctx.config);
    if (!auth) {
      reply.clearCookie(SESSION_COOKIE, options);
      return;
    }
    request.auth = auth;
    if (auth.renewed) reply.setCookie(SESSION_COOKIE, token, options);
  });
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new ApiError(401, 'UNAUTHENTICATED', 'Anmeldung erforderlich');
  return request.auth;
}
