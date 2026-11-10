import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_LOCALE,
  entityIdSchema,
  localeSchema,
  loginRequestSchema,
  passwordChangeRequestSchema,
  profileSchema,
  profileUpdateRequestSchema,
  registerRequestSchema,
  type AuthStatus,
  type GuestResponse,
  type KingdomNameSuggestions,
  type MeResponse,
  type PlayerNameSuggestions,
  type ProfileResponse,
  type SessionResponse,
} from '@rdw/protocol';
import { kingdomName, playerDisplayName } from '@rdw/game-core';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { readGameNow } from '../../infra/clock.ts';
import { isToken, randomToken } from '../../infra/crypto.ts';
import { ApiError } from '../../infra/errors.ts';
import { idempotencyKey, runIdempotent } from '../../infra/idempotency.ts';
import { parseInput } from '../../infra/validation.ts';
import { settleOpenSiegesOfUser } from '../combat/sweeper.ts';
import { listMyInstances } from '../world/queries.ts';
import { changePassword, login, registerGuest } from './account.ts';
import { requireAuth } from './auth-hook.ts';
import {
  BOOTSTRAP_COOKIE,
  BOOTSTRAP_TOKEN_BYTES,
  bootstrapCookieOptions,
  sessionCookieOptions,
} from './cookies.ts';
import { createOrResumeGuest } from './guest.ts';
import { hashPassword } from './passwords.ts';
import {
  kingdomNameSuggestions,
  loadProfile,
  parsePlayerName,
  playerNameSuggestions,
  setPlayerName,
} from './profile.ts';
import { createSession, deleteSession, SESSION_COOKIE } from './sessions.ts';
import { LoginThrottle } from './throttle.ts';

const instanceParams = z.object({ instanceId: entityIdSchema });
const storedProfileSchema = z.object({ profile: profileSchema });

/**
 * Konto (API.md §2.1): Bootstrap, Gastkonto, Sichern, Anmelden, Abmelden, Profil, Passwort und
 * Namensvorschläge.
 */
export function identityRoutes(app: FastifyInstance, ctx: AppContext): void {
  const throttle = new LoginThrottle(ctx.loginThrottle);

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

  /**
   * Gast sichern (O-03): Der Antwortspeicher hält nur die Konto-ID, das Passwort geht nicht in den
   * Anfrage-Hash. Eine Wiederholung, die noch mit der alten Sitzung durchkam, erhält für dasselbe
   * Konto eine neue Sitzung (API.md §1).
   */
  app.post('/auth/register', async (request, reply): Promise<SessionResponse> => {
    const auth = requireAuth(request);
    const body = parseInput(registerRequestSchema, request.body);
    const playerName = parsePlayerName(body.playerName);
    const key = idempotencyKey(request);
    const passwordHash = await hashPassword(body.password);
    let sessionToken: string | null = null;
    const outcome = await runIdempotent(
      ctx.db,
      {
        userId: auth.userId,
        key,
        endpoint: 'POST /auth/register',
        input: { username: body.username.toLowerCase(), playerName },
      },
      async (tx) => {
        sessionToken = await registerGuest(tx, {
          userId: auth.userId,
          username: body.username,
          passwordHash,
          playerName,
        });
        return { status: 201, body: { userId: auth.userId } };
      },
    );
    sessionToken ??= await createSession(ctx.db, auth.userId);
    if (outcome.replayed) reply.header('idempotency-replayed', 'true');
    reply.setCookie(SESSION_COOKIE, sessionToken, sessionCookieOptions(ctx.config));
    reply.status(outcome.status);
    const now = await readGameNow(ctx.db);
    return { user: { id: auth.userId, isGuest: false }, serverTime: now.toISOString() };
  });

  app.post('/auth/login', async (request, reply): Promise<SessionResponse> => {
    const body = parseInput(loginRequestSchema, request.body);
    const result = await login(ctx.db, throttle, {
      username: body.username,
      password: body.password,
      address: request.ip,
      currentTokenHash: request.auth?.tokenHash ?? null,
    });
    reply.setCookie(SESSION_COOKIE, result.sessionToken, sessionCookieOptions(ctx.config));
    const now = await readGameNow(ctx.db);
    return { user: { id: result.userId, isGuest: false }, serverTime: now.toISOString() };
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
      .select(['u.id', 'u.is_guest', 'u.username', 'u.created_at', 's.locale'])
      .where('u.id', '=', auth.userId)
      .executeTakeFirstOrThrow();
    // Fällige eigene Kämpfe zuerst auflösen, sonst meldet das Profil sie noch als offen.
    await settleOpenSiegesOfUser(ctx.db, auth.userId, request.log);
    const instances = await listMyInstances(ctx.db, auth.userId);
    const profile = await loadProfile(ctx.db, auth.userId);
    const now = await readGameNow(ctx.db);
    return {
      user: {
        id: user.id,
        isGuest: user.is_guest,
        createdAt: user.created_at.toISOString(),
        username: user.username,
      },
      profile,
      settings: { locale: localeSchema.parse(user.locale ?? DEFAULT_LOCALE) },
      instances,
      serverTime: now.toISOString(),
    };
  });

  /** Spielername ändern (nur gesicherte Konten; Gäste wählen ihn beim Sichern). */
  app.patch('/me/profile', async (request, reply): Promise<ProfileResponse> => {
    const auth = requireAuth(request);
    const body = parseInput(profileUpdateRequestSchema, request.body);
    const playerName = parsePlayerName(body.playerName);
    if (auth.isGuest) throw new ApiError(403, 'GUEST_ACCOUNT', 'Nur für gesicherte Konten');
    const outcome = await runIdempotent(
      ctx.db,
      {
        userId: auth.userId,
        key: idempotencyKey(request),
        endpoint: 'PATCH /me/profile',
        input: { playerName },
      },
      async (tx) => {
        await setPlayerName(tx, auth.userId, playerName);
        return { status: 200, body: { profile: await loadProfile(tx, auth.userId) } };
      },
    );
    if (outcome.replayed) reply.header('idempotency-replayed', 'true');
    // Eine Wiederholung liefert das gespeicherte Profil dieser Änderung (API.md §1)
    const stored = storedProfileSchema.parse(outcome.body);
    const now = await readGameNow(ctx.db);
    return { profile: stored.profile, serverTime: now.toISOString() };
  });

  app.post('/me/password', async (request, reply) => {
    const auth = requireAuth(request);
    const body = parseInput(passwordChangeRequestSchema, request.body);
    // Argon2 vor der Transaktion, damit Kontosperre und Verbindung nicht darauf warten
    const newPasswordHash = await hashPassword(body.newPassword);
    const outcome = await runIdempotent(
      ctx.db,
      {
        userId: auth.userId,
        key: idempotencyKey(request),
        endpoint: 'POST /me/password',
        // Passwörter gehen nicht in den Anfrage-Hash
        input: {},
      },
      async (tx) => {
        await changePassword(tx, throttle, {
          userId: auth.userId,
          currentPassword: body.currentPassword,
          newPasswordHash,
          address: request.ip,
          keepTokenHash: auth.tokenHash,
        });
        return { status: 204, body: null };
      },
    );
    if (outcome.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(204).send();
  });

  app.get('/names/player', async (request): Promise<PlayerNameSuggestions> => {
    requireAuth(request);
    const suggestions = await playerNameSuggestions(ctx.db);
    const now = await readGameNow(ctx.db);
    return {
      suggestions: suggestions.map((parts) => ({ parts, name: playerDisplayName(parts) })),
      serverTime: now.toISOString(),
    };
  });

  app.get(
    '/instances/:instanceId/kingdom-names',
    async (request): Promise<KingdomNameSuggestions> => {
      requireAuth(request);
      const { instanceId } = parseInput(instanceParams, request.params);
      const instance = await ctx.db
        .selectFrom('world_instances')
        .select('id')
        .where('id', '=', instanceId)
        .executeTakeFirst();
      if (!instance) throw new ApiError(404, 'NOT_FOUND', 'Unbekannte Instanz', { instanceId });
      const suggestions = await kingdomNameSuggestions(ctx.db, instanceId);
      const now = await readGameNow(ctx.db);
      return {
        suggestions: suggestions.map((parts) => ({ parts, name: kingdomName(parts) })),
        serverTime: now.toISOString(),
      };
    },
  );
}
