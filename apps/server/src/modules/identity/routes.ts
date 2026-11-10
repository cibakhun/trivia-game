import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_LOCALE,
  localeSchema,
  type AuthStatus,
  type GuestResponse,
  type MeResponse,
} from '@rdw/protocol';
import type { AppContext } from '../../context.ts';
import { readGameNow } from '../../infra/clock.ts';
import { isToken, randomToken } from '../../infra/crypto.ts';
import { ApiError } from '../../infra/errors.ts';
import { settleOpenSiegesOfUser } from '../combat/sweeper.ts';
import { listMyInstances } from '../world/queries.ts';
import { requireAuth } from './auth-hook.ts';
import {
  BOOTSTRAP_COOKIE,
  BOOTSTRAP_TOKEN_BYTES,
  bootstrapCookieOptions,
  sessionCookieOptions,
} from './cookies.ts';
import { createOrResumeGuest } from './guest.ts';
import { deleteSession, SESSION_COOKIE } from './sessions.ts';

/** Konto (API.md §2.1): Bootstrap, Gastkonto, Abmelden, Profil. */
export function identityRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/auth/bootstrap', async (request, reply): Promise<AuthStatus> => {
    const now = await readGameNow(ctx.db);
    const auth = request.auth;
    if (!auth && !isToken(request.cookies[BOOTSTRAP_COOKIE], BOOTSTRAP_TOKEN_BYTES)) {
      reply.setCookie(
        BOOTSTRAP_COOKIE,
        randomToken(BOOTSTRAP_TOKEN_BYTES),
        bootstrapCookieOptions(ctx.config),
      );
    }
    return {
      authenticated: auth !== null,
      user: auth ? { id: auth.userId, isGuest: auth.isGuest } : null,
      serverTime: now.toISOString(),
    };
  });

  app.post('/auth/guest', async (request, reply): Promise<GuestResponse> => {
    const bootstrap = request.cookies[BOOTSTRAP_COOKIE];
    if (!isToken(bootstrap, BOOTSTRAP_TOKEN_BYTES)) {
      throw new ApiError(
        400,
        'GUEST_BOOTSTRAP_REQUIRED',
        'Bootstrap-Cookie fehlt (GET /auth/bootstrap)',
      );
    }
    const guest = await createOrResumeGuest(ctx.db, bootstrap);
    // Eine laufende Sitzung eines anderen Kontos wird ersetzt und beendet.
    if (request.auth && request.auth.userId !== guest.userId) {
      await deleteSession(ctx.db, request.auth.tokenHash);
    }
    reply.setCookie(SESSION_COOKIE, guest.sessionToken, sessionCookieOptions(ctx.config));
    reply.clearCookie(BOOTSTRAP_COOKIE, bootstrapCookieOptions(ctx.config));
    reply.status(guest.created ? 201 : 200);
    const now = await readGameNow(ctx.db);
    return { user: { id: guest.userId, isGuest: true }, serverTime: now.toISOString() };
  });

  app.post('/auth/logout', async (request, reply) => {
    if (request.auth) await deleteSession(ctx.db, request.auth.tokenHash);
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(ctx.config));
    return reply.status(204).send();
  });

  app.get('/me', async (request): Promise<MeResponse> => {
    const auth = requireAuth(request);
    const user = await ctx.db
      .selectFrom('users as u')
      .leftJoin('player_settings as s', 's.user_id', 'u.id')
      .select(['u.id', 'u.is_guest', 'u.created_at', 's.locale'])
      .where('u.id', '=', auth.userId)
      .executeTakeFirstOrThrow();
    // Fällige eigene Kämpfe zuerst auflösen, sonst meldet das Profil sie noch als offen.
    await settleOpenSiegesOfUser(ctx.db, auth.userId);
    const instances = await listMyInstances(ctx.db, auth.userId);
    const now = await readGameNow(ctx.db);
    return {
      user: { id: user.id, isGuest: user.is_guest, createdAt: user.created_at.toISOString() },
      settings: { locale: localeSchema.parse(user.locale ?? DEFAULT_LOCALE) },
      instances,
      serverTime: now.toISOString(),
    };
  });
}
