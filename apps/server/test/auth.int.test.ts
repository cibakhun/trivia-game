import { createHash } from 'node:crypto';
import { advanceGameClock } from '@rdw/db/testing';
import {
  authStatusSchema,
  errorBodySchema,
  guestResponseSchema,
  meResponseSchema,
} from '@rdw/protocol';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  TestClient,
  setCookieHeader,
  startTestServer,
  type TestServer,
} from './helpers.ts';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
  return () => server.close();
});

function sha256(base64url: string): Buffer {
  return createHash('sha256').update(Buffer.from(base64url, 'base64url')).digest();
}

function errorCode(response: { json(): unknown }): string {
  return errorBodySchema.parse(response.json()).error.code;
}

describe('Bootstrap und Gastkonto (API.md §1)', () => {
  it('setzt das Bootstrap-Cookie ohne Sitzung genau einmal', async () => {
    const client = new TestClient(server.app);
    const first = await client.get('/auth/bootstrap');
    expect(first.statusCode).toBe(200);
    expect(authStatusSchema.parse(first.json())).toMatchObject({
      authenticated: false,
      user: null,
    });
    const cookie = setCookieHeader(first, 'guest_bootstrap');
    expect(cookie).toMatch(/Max-Age=86400/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(client.cookies.get('guest_bootstrap')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const second = await client.get('/auth/bootstrap');
    expect(setCookieHeader(second, 'guest_bootstrap')).toBeUndefined();
    expect(second.headers['cache-control']).toBe('no-store');
    // Sicherheitsheader (SECURITY §2); HSTS nur mit https (hier COOKIE_SECURE=false)
    expect(second.headers['x-content-type-options']).toBe('nosniff');
    expect(second.headers['referrer-policy']).toBe('no-referrer');
    expect(second.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(second.headers['strict-transport-security']).toBeUndefined();
  });

  it('legt ein Gastkonto mit Einstellungen, Statistik und Sitzung an', async () => {
    const client = new TestClient(server.app);
    await client.get('/auth/bootstrap');
    const bootstrap = client.cookies.get('guest_bootstrap') as string;
    const response = await client.post('/auth/guest');
    expect(response.statusCode).toBe(201);
    const { user } = guestResponseSchema.parse(response.json());
    expect(user.isGuest).toBe(true);
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);

    const session = setCookieHeader(response, 'rdw_session');
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\/api\/v1;/);
    expect(session).toMatch(/Max-Age=2592000/);
    expect(client.cookies.has('guest_bootstrap')).toBe(false);
    const token = client.cookies.get('rdw_session') as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = await server.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(row.is_guest).toBe(true);
    expect(row.last_seen_at).toBeNull();
    expect(row.guest_bootstrap_hash?.equals(sha256(bootstrap))).toBe(true);
    const sessions = await server.db
      .selectFrom('sessions')
      .select(['token_hash', sql<number>`extract(epoch from expires_at - created_at)`.as('ttl')])
      .where('user_id', '=', user.id)
      .execute();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.token_hash.equals(sha256(token))).toBe(true);
    expect(Number(sessions[0]?.ttl)).toBeCloseTo(30 * 24 * 3600, 0);
    for (const table of ['player_settings', 'player_statistics'] as const) {
      const found = await server.db
        .selectFrom(table)
        .select('user_id')
        .where('user_id', '=', user.id)
        .execute();
      expect(found).toHaveLength(1);
    }
  });

  it('verlangt ein gültiges Bootstrap-Cookie', async () => {
    const client = new TestClient(server.app);
    const missing = await client.post('/auth/guest');
    expect(missing.statusCode).toBe(400);
    expect(errorCode(missing)).toBe('GUEST_BOOTSTRAP_REQUIRED');
    client.cookies.set('guest_bootstrap', 'kaputt');
    expect(errorCode(await client.post('/auth/guest'))).toBe('GUEST_BOOTSTRAP_REQUIRED');
  });

  it('liefert bei Wiederholung dasselbe Konto, bis es benutzt wurde', async () => {
    const client = new TestClient(server.app);
    await client.get('/auth/bootstrap');
    const bootstrap = client.cookies.get('guest_bootstrap') as string;
    const first = await client.post('/auth/guest');
    const userId = guestResponseSchema.parse(first.json()).user.id;

    // Antwort „verloren“: derselbe Browser schickt das Cookie noch einmal
    const retry = new TestClient(server.app);
    retry.cookies.set('guest_bootstrap', bootstrap);
    const second = await retry.post('/auth/guest');
    expect(second.statusCode).toBe(200);
    expect(guestResponseSchema.parse(second.json()).user.id).toBe(userId);

    // erste authentifizierte Anfrage → danach nicht mehr wiederholbar
    expect((await retry.get('/me')).statusCode).toBe(200);
    const late = new TestClient(server.app);
    late.cookies.set('guest_bootstrap', bootstrap);
    const third = await late.post('/auth/guest');
    expect(third.statusCode).toBe(409);
    expect(errorCode(third)).toBe('GUEST_BOOTSTRAP_USED');

    const accounts = await server.db
      .selectFrom('users')
      .select('id')
      .where('guest_bootstrap_hash', '=', sha256(bootstrap))
      .execute();
    expect(accounts).toEqual([{ id: userId }]);
    const sessions = await server.db
      .selectFrom('sessions')
      .select('user_id')
      .where('user_id', '=', userId)
      .execute();
    expect(sessions).toHaveLength(2);
  });

  it('legt bei gleichzeitigen Anfragen mit demselben Cookie nur ein Konto an', async () => {
    const client = new TestClient(server.app);
    await client.get('/auth/bootstrap');
    const bootstrap = client.cookies.get('guest_bootstrap') as string;
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => {
        const c = new TestClient(server.app);
        c.cookies.set('guest_bootstrap', bootstrap);
        return c.post('/auth/guest');
      }),
    );
    const ids = new Set(responses.map((r) => guestResponseSchema.parse(r.json()).user.id));
    expect(ids.size).toBe(1);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
  });
});

describe('Herkunftsprüfung (CSRF)', () => {
  it('lehnt zustandsändernde Anfragen ohne oder mit fremdem Origin ab', async () => {
    const client = new TestClient(server.app);
    await client.get('/auth/bootstrap');
    for (const origin of [null, 'https://boese.example', `${ORIGIN}.boese.example`, 'null']) {
      const response = await client.post('/auth/guest', { origin });
      expect(response.statusCode).toBe(403);
      expect(errorCode(response)).toBe('CSRF_ORIGIN_MISMATCH');
    }
    const count = await server.db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('guest_bootstrap_hash', '=', sha256(client.cookies.get('guest_bootstrap') as string))
      .executeTakeFirstOrThrow();
    expect(count.n).toBe('0');
    // Lesende Anfragen brauchen keinen Origin-Header.
    expect((await client.get('/auth/bootstrap', { origin: null })).statusCode).toBe(200);
  });
});

describe('Sitzung', () => {
  it('verlangt eine Sitzung und löscht ungültige Cookies', async () => {
    const client = new TestClient(server.app);
    const anonymous = await client.get('/me');
    expect(anonymous.statusCode).toBe(401);
    expect(errorCode(anonymous)).toBe('UNAUTHENTICATED');
    client.cookies.set('rdw_session', 'A'.repeat(43));
    const unknown = await client.get('/me');
    expect(unknown.statusCode).toBe(401);
    expect(setCookieHeader(unknown, 'rdw_session')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(client.cookies.has('rdw_session')).toBe(false);
  });

  it('gleitet höchstens stündlich, setzt last_seen_at und läuft nach 30 Tagen ab', async () => {
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    const session = () =>
      server.db
        .selectFrom('sessions')
        .select(['last_used_at', 'expires_at'])
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
    expect((await session()).last_used_at).toBeNull();

    const first = await client.get('/me');
    expect(first.statusCode).toBe(200);
    expect(setCookieHeader(first, 'rdw_session')).toBeDefined();
    const touched = await session();
    expect(touched.last_used_at).not.toBeNull();
    const seen = await server.db
      .selectFrom('users')
      .select('last_seen_at')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(seen.last_seen_at).not.toBeNull();

    const second = await client.get('/me');
    expect(setCookieHeader(second, 'rdw_session')).toBeUndefined();
    expect((await session()).last_used_at).toEqual(touched.last_used_at);

    // Uhr danach immer zurückstellen, sonst liefe ein Fehlschlag in die folgenden Tests weiter
    let shifted = 0;
    const shift = async (ms: number) => {
      await advanceGameClock(server.database.pool, ms);
      shifted += ms;
    };
    try {
      await shift(2 * 3600_000);
      const later = await client.get('/me');
      expect(setCookieHeader(later, 'rdw_session')).toBeDefined();
      const renewed = await session();
      expect(renewed.expires_at.getTime() - touched.expires_at.getTime()).toBeGreaterThanOrEqual(
        2 * 3600_000 - 1000,
      );

      await shift(31 * 24 * 3600_000);
      expect((await client.get('/me')).statusCode).toBe(401);
    } finally {
      await advanceGameClock(server.database.pool, -shifted);
    }
  });

  it('meldet ab und beendet die Sitzung, auch wiederholt', async () => {
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    const token = client.cookies.get('rdw_session') as string;
    const response = await client.post('/auth/logout');
    expect(response.statusCode).toBe(204);
    expect(client.cookies.has('rdw_session')).toBe(false);
    const rows = await server.db
      .selectFrom('sessions')
      .select('user_id')
      .where('token_hash', '=', sha256(token))
      .execute();
    expect(rows).toEqual([]);
    expect((await client.get('/me')).statusCode).toBe(401);
    expect((await client.post('/auth/logout')).statusCode).toBe(204);
    expect(userId).toBeTruthy();
  });

  it('behandelt Konten mit Löschantrag als abgemeldet', async () => {
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    expect((await client.get('/me')).statusCode).toBe(200);
    await server.db
      .updateTable('users')
      .set({ deletion_requested_at: sql<Date>`game_now()` })
      .where('id', '=', userId)
      .execute();
    expect((await client.get('/me')).statusCode).toBe(401);
  });

  it('liefert das Profil mit Einstellungen und ohne Instanzen', async () => {
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    const status = authStatusSchema.parse((await client.get('/auth/bootstrap')).json());
    expect(status).toMatchObject({ authenticated: true, user: { id: userId, isGuest: true } });
    const me = meResponseSchema.parse((await client.get('/me')).json());
    expect(me.user.id).toBe(userId);
    expect(me.settings.locale).toBe('de');
    expect(me.instances).toEqual([]);
  });
});

describe('Fehlerformat', () => {
  it('antwortet auf unbekannte Pfade und kaputte Körper im API-Format', async () => {
    const client = new TestClient(server.app);
    const missing = await client.get('/gibt-es-nicht');
    expect(missing.statusCode).toBe(404);
    expect(errorCode(missing)).toBe('NOT_FOUND');
    await client.signUpGuest();
    const broken = await client.post('/auth/logout', {
      headers: { 'content-type': 'application/json' },
      payload: '{kaputt',
    });
    expect(broken.statusCode).toBe(400);
    expect(errorCode(broken)).toBe('VALIDATION_FAILED');
    const health = await client.get('/health');
    expect(health.json()).toEqual({ ok: true });
  });
});
