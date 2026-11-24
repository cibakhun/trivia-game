import { randomUUID } from 'node:crypto';
import {
  kingdomName,
  PLAYER_NAME_ADJECTIVES,
  PLAYER_NAME_NOUNS,
  playerDisplayName,
} from '@rdw/game-core';
import {
  errorBodySchema,
  joinResponseSchema,
  kingdomNameSuggestionsSchema,
  meResponseSchema,
  nameCheckSchema,
  playerNameSuggestionsSchema,
  profileResponseSchema,
  sessionResponseSchema,
} from '@rdw/protocol';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { TestClient, createTestWorld, startTestServer, type TestServer } from './helpers.ts';

/**
 * Gesicherte Konten über die HTTP-Schnittstelle (O-03, ADR-043/044/082): Gast sichern mit eigenem
 * Benutzernamen, Anmelden mit Sitzungsrotation, Anmeldebremse, Passwort und Namen ändern,
 * Namensprüfung, Namensvorschläge und Reichsname beim Beitritt.
 */

const PASSWORD = 'richtig-langes-passwort';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
  return () => server.close();
});

function errorOf(response: { statusCode: number; json(): unknown }) {
  const { error } = errorBodySchema.parse(response.json());
  return { status: response.statusCode, code: error.code, details: error.details };
}

let nameCounter = 0;

/** Ein Benutzername, den in dieser Datei noch niemand trägt (nur Buchstaben, Wortfilter-fest). */
function freshUsername(prefix = 'Spieler'): string {
  nameCounter += 1;
  let suffix = '';
  for (let n = nameCounter; n > 0; n = Math.floor(n / 26)) {
    suffix = String.fromCharCode(97 + (n % 26)) + suffix;
  }
  return `${prefix} ${suffix}${randomUUID()
    .replace(/[^a-f]/gu, '')
    .slice(0, 4)}`;
}

function register(client: TestClient, body: Record<string, unknown>, key: string = randomUUID()) {
  return client.post('/auth/register', { headers: { 'idempotency-key': key }, payload: body });
}

function login(client: TestClient, username: string, password: string) {
  return client.post('/auth/login', { payload: { username, password } });
}

async function me(client: TestClient) {
  const response = await client.get('/me');
  expect(response.statusCode, response.body).toBe(200);
  return meResponseSchema.parse(response.json());
}

interface Registered {
  readonly client: TestClient;
  readonly userId: string;
  readonly username: string;
}

/** Gast anlegen und sichern. */
async function registeredPlayer(srv: TestServer = server): Promise<Registered> {
  const client = new TestClient(srv.app);
  const userId = await client.signUpGuest();
  const username = freshUsername();
  const response = await register(client, { username, password: PASSWORD });
  expect(response.statusCode, response.body).toBe(201);
  return { client, userId, username };
}

function checkName(client: TestClient, name: string) {
  return client.get(`/names/check?name=${encodeURIComponent(name)}`);
}

async function nameStatus(client: TestClient, name: string) {
  const response = await checkName(client, name);
  expect(response.statusCode, response.body).toBe(200);
  return nameCheckSchema.parse(response.json());
}

describe('Gast sichern (POST /auth/register)', () => {
  it('macht aus dem Gast ein gesichertes Konto und tauscht die Sitzung aus', async () => {
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    const guestToken = client.cookies.get('rdw_session') as string;
    // Eine zweite Sitzung desselben Gasts (anderes Gerät) endet mit dem Sichern ebenfalls
    const other = new TestClient(server.app);
    other.cookies.set('rdw_session', guestToken);

    // Selbst getippt: Leerraum außen fällt weg, innen bleibt ein Leerzeichen, Akzente gehen
    const username = 'Ödön Kőszegi';
    const response = await register(client, { username: '  Ödön   Kőszegi ', password: PASSWORD });
    expect(response.statusCode, response.body).toBe(201);
    expect(sessionResponseSchema.parse(response.json()).user).toEqual({
      id: userId,
      isGuest: false,
    });
    const newToken = client.cookies.get('rdw_session') as string;
    expect(newToken).not.toBe(guestToken);
    expect((await other.get('/me')).statusCode).toBe(401);

    const row = await server.db
      .selectFrom('users')
      .select(['is_guest', 'username', 'password_hash', 'guest_bootstrap_hash'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ is_guest: false, username, guest_bootstrap_hash: null });
    expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

    const body = await me(client);
    expect(body.user).toMatchObject({ id: userId, isGuest: false, username });
    // Ein Name für beides: Anmeldename und Spielername
    expect(body.profile).toEqual({ displayName: username });
    const device = new TestClient(server.app);
    expect((await login(device, 'ödön kőszegi', PASSWORD)).statusCode).toBe(200);
  });

  it('liefert bei Wiederholung dieselbe Antwort und eine neue Sitzung für dasselbe Konto', async () => {
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    const key = randomUUID();
    const body = { username: freshUsername(), password: PASSWORD };
    expect((await register(client, body, key)).statusCode).toBe(201);
    const first = client.cookies.get('rdw_session');
    const replay = await register(client, body, key);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(client.cookies.get('rdw_session')).not.toBe(first);
    expect((await me(client)).user.id).toBe(userId);
    // Das Passwort gehört nicht zum Anfrage-Hash: Ein anderes ergibt keinen Schlüsselkonflikt
    const changed = await register(client, { ...body, password: 'ein-ganz-anderes-pw' }, key);
    expect(changed.statusCode).toBe(201);
    // Neuer Schlüssel: Das Konto ist schon gesichert
    expect(errorOf(await register(client, body))).toMatchObject({
      status: 409,
      code: 'ALREADY_REGISTERED',
    });
  });

  it('lehnt vergebene Namen in jeder Schreibweise ab, der Gast bleibt Gast', async () => {
    const taken = await registeredPlayer();
    // Ein Konto von vor ADR-082: Anmeldename und Spielername aus Bausteinen sind verschieden
    const old = await registeredPlayer();
    await server.db
      .updateTable('player_profiles')
      .set({
        display_name: 'Flinkes Wiesel',
        name_parts: JSON.stringify({ adjective: 'Flink', noun: 'Wiesel', number: null }),
      })
      .where('user_id', '=', old.userId)
      .execute();
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    const variants = [
      taken.username.toUpperCase(),
      taken.username.replace(' ', '_'),
      taken.username.replace(' ', '.').replace('S', 'Š'),
      old.username,
      'flinkes-wiesel',
      'Flinkes Wiesel',
    ];
    for (const username of variants) {
      expect(
        errorOf(await register(client, { username, password: PASSWORD })),
        username,
      ).toMatchObject({ status: 409, code: 'USERNAME_TAKEN' });
    }
    const row = await server.db
      .selectFrom('users')
      .select(['is_guest', 'username', 'password_hash'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ is_guest: true, username: null, password_hash: null });
    const profiles = await server.db
      .selectFrom('player_profiles')
      .select('user_id')
      .where('user_id', '=', userId)
      .execute();
    expect(profiles).toEqual([]);
  });

  it('prüft Benutzername, Passwort, Wortfilter, Sitzung und Schlüssel', async () => {
    const client = new TestClient(server.app);
    await client.signUpGuest();
    // Passwort mit sieben Zeichen genügt (ADR-082)
    const valid = { username: freshUsername(), password: 'sieben7' };
    const cases: [Record<string, unknown>, number, string][] = [
      [{ ...valid, username: 'ab' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, username: '  a  ' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, username: 'x'.repeat(21) }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, username: '_Krisz' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, username: 'Kri__sz' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, username: 'Krisz!' }, 400, 'VALIDATION_FAILED'],
      // kyrillisches К: sieht aus wie K
      [{ ...valid, username: '\u041Arisz' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, username: '2024' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, password: 'kurz12' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, password: 'x'.repeat(129) }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, email: 'a@b.de' }, 400, 'VALIDATION_FAILED'],
      [
        { ...valid, playerName: { adjective: 'Kühn', noun: 'Falke', number: null } },
        400,
        'VALIDATION_FAILED',
      ],
      [{ ...valid, username: 'H1tler 88' }, 422, 'NAME_NOT_ALLOWED'],
      [{ ...valid, username: 'Admin Krisz' }, 422, 'NAME_NOT_ALLOWED'],
      [{ ...valid, username: 'Bot 2' }, 422, 'NAME_NOT_ALLOWED'],
    ];
    for (const [body, status, code] of cases) {
      expect(errorOf(await register(client, body)), JSON.stringify(body)).toMatchObject({
        status,
        code,
      });
    }
    const noKey = await client.post('/auth/register', { payload: valid });
    expect(errorOf(noKey)).toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
    const anonymous = new TestClient(server.app);
    expect(errorOf(await register(anonymous, valid))).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    // Erst die gültige Anfrage sichert das Konto
    expect((await register(client, valid)).statusCode).toBe(201);
  });
});

describe('Namensprüfung (GET /names/check)', () => {
  it('meldet frei, eigen, vergeben, gesperrt und ungültig', async () => {
    const player = await registeredPlayer();
    const other = await registeredPlayer();
    const guest = new TestClient(server.app);
    await guest.signUpGuest();
    expect(await nameStatus(guest, '  Ganz   Neuer Name ')).toMatchObject({
      name: 'Ganz Neuer Name',
      status: 'FREE',
    });
    expect((await nameStatus(guest, player.username.toLowerCase())).status).toBe('TAKEN');
    expect((await nameStatus(player.client, player.username)).status).toBe('MINE');
    // Andere Schreibweise des eigenen Namens: frei (nur man selbst trägt ihn)
    expect((await nameStatus(player.client, player.username.toUpperCase())).status).toBe('FREE');
    expect((await nameStatus(player.client, other.username)).status).toBe('TAKEN');
    expect((await nameStatus(guest, 'Fuuuck')).status).toBe('BLOCKED');
    expect((await nameStatus(guest, 'a')).status).toBe('INVALID');
    expect(errorOf(await checkName(new TestClient(server.app), 'Krisz'))).toMatchObject({
      status: 401,
    });
  });

  it('hält die Namen aus Bausteinen auch im Namensschlüssel auseinander', async () => {
    // Migration 0016 legt einen eindeutigen Index auf player_name_key(display_name): Alte Namen
    // aus Bausteinen dürfen darin nicht zusammenfallen
    const names: string[] = [];
    for (const adjective of PLAYER_NAME_ADJECTIVES) {
      for (const noun of Object.keys(PLAYER_NAME_NOUNS)) {
        names.push(playerDisplayName({ adjective, noun, number: null }));
      }
    }
    const result = await sql<{ distinct: string; total: string }>`
      select count(distinct player_name_key(n))::text as distinct, count(*)::text as total
      from unnest(${names}::text[]) as n`.execute(server.db);
    expect(result.rows[0]).toEqual({ distinct: String(names.length), total: String(names.length) });
  });
});

describe('Anmelden und Abmelden (POST /auth/login, /auth/logout)', () => {
  it('meldet mit Benutzername und Passwort an, unabhängig von der Schreibweise', async () => {
    const player = await registeredPlayer();
    const device = new TestClient(server.app);
    const response = await login(device, player.username.toUpperCase(), PASSWORD);
    expect(response.statusCode, response.body).toBe(200);
    expect(sessionResponseSchema.parse(response.json()).user).toEqual({
      id: player.userId,
      isGuest: false,
    });
    expect((await me(device)).user.id).toBe(player.userId);
    // Die Sitzung auf dem ersten Gerät bleibt bestehen
    expect((await me(player.client)).user.id).toBe(player.userId);

    await device.post('/auth/logout');
    expect((await device.get('/me')).statusCode).toBe(401);
    expect((await me(player.client)).user.id).toBe(player.userId);
  });

  it('antwortet bei unbekanntem Namen und falschem Passwort gleich', async () => {
    const player = await registeredPlayer();
    const client = new TestClient(server.app);
    const wrong = errorOf(await login(client, player.username, 'falsches-passwort'));
    const unknown = errorOf(await login(client, freshUsername(), PASSWORD));
    expect(wrong).toEqual(unknown);
    expect(wrong).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(client.cookies.has('rdw_session')).toBe(false);
    expect(errorOf(await client.post('/auth/login', { payload: { username: 'x' } }))).toMatchObject(
      { status: 400, code: 'VALIDATION_FAILED' },
    );
  });

  it('beendet die bisherige Sitzung eines anderen Kontos auf dem Gerät', async () => {
    const player = await registeredPlayer();
    const client = new TestClient(server.app);
    const guestId = await client.signUpGuest();
    const guestToken = client.cookies.get('rdw_session') as string;
    const response = await login(client, player.username, PASSWORD);
    expect(response.statusCode).toBe(200);
    expect(client.cookies.get('rdw_session')).not.toBe(guestToken);
    expect((await me(client)).user.id).toBe(player.userId);
    const stale = new TestClient(server.app);
    stale.cookies.set('rdw_session', guestToken);
    expect((await stale.get('/me')).statusCode).toBe(401);
    // Das Gastkonto selbst bleibt (es wird erst nach 90 Tagen ohne Anmeldung gelöscht)
    const guest = await server.db
      .selectFrom('users')
      .select('id')
      .where('id', '=', guestId)
      .executeTakeFirst();
    expect(guest?.id).toBe(guestId);
  });

  it('meldet Konten mit Löschantrag nicht an', async () => {
    const player = await registeredPlayer();
    await server.db
      .updateTable('users')
      .set({ deletion_requested_at: new Date() })
      .where('id', '=', player.userId)
      .execute();
    const client = new TestClient(server.app);
    expect(errorOf(await login(client, player.username, PASSWORD))).toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });
});

describe('Anmeldebremse', () => {
  let throttled: TestServer;
  let now = 1_000_000;

  beforeAll(async () => {
    throttled = await startTestServer({
      loginThrottle: {
        perName: { failures: 3, windowMs: 60_000 },
        perAddress: { failures: 5, windowMs: 60_000 },
        now: () => now,
      },
    });
    return () => throttled.close();
  });

  it('sperrt einen Namen nach drei Fehlversuchen bis zum Ende des Fensters', async () => {
    const player = await registeredPlayer(throttled);
    const client = new TestClient(throttled.app);
    for (let i = 0; i < 3; i++) {
      expect(errorOf(await login(client, player.username, 'falsches-passwort')).code).toBe(
        'INVALID_CREDENTIALS',
      );
      now += 1_000;
    }
    // Gesperrt, auch mit richtigem Passwort und in anderer Schreibweise
    const blocked = errorOf(await login(client, player.username.toUpperCase(), PASSWORD));
    expect(blocked).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      details: { retryAfterMs: 57_000 },
    });
    now += 57_000;
    expect((await login(client, player.username, PASSWORD)).statusCode).toBe(200);
    // Ein Erfolg setzt den Zähler des Namens zurück
    for (let i = 0; i < 2; i++) await login(client, player.username, 'falsches-passwort');
    expect((await login(client, player.username, PASSWORD)).statusCode).toBe(200);
    now += 60_000;
  });

  it('sperrt eine Adresse nach fünf Fehlversuchen mit beliebigen Namen', async () => {
    const player = await registeredPlayer(throttled);
    const client = new TestClient(throttled.app);
    for (let i = 0; i < 5; i++) await login(client, freshUsername(), PASSWORD);
    expect(errorOf(await login(client, player.username, PASSWORD))).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
    now += 60_000;
    expect((await login(client, player.username, PASSWORD)).statusCode).toBe(200);
  });

  it('bremst auch falsche bisherige Passwörter beim Ändern', async () => {
    const player = await registeredPlayer(throttled);
    const change = (currentPassword: string) =>
      player.client.post('/me/password', {
        headers: { 'idempotency-key': randomUUID() },
        payload: { currentPassword, newPassword: 'neues-langes-passwort' },
      });
    for (let i = 0; i < 3; i++) {
      expect(errorOf(await change('falsches-passwort')).code).toBe('INVALID_CREDENTIALS');
    }
    expect(errorOf(await change(PASSWORD))).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    now += 60_000;
    expect((await change(PASSWORD)).statusCode).toBe(204);
    now += 60_000;
  });
});

describe('Passwort ändern (POST /me/password)', () => {
  function change(client: TestClient, body: Record<string, unknown>, key = randomUUID()) {
    return client.post('/me/password', { headers: { 'idempotency-key': key }, payload: body });
  }

  it('setzt das neue Passwort und beendet alle anderen Sitzungen', async () => {
    const player = await registeredPlayer();
    const device = new TestClient(server.app);
    expect((await login(device, player.username, PASSWORD)).statusCode).toBe(200);
    const newPassword = 'ein-neues-passwort';

    expect(
      errorOf(await change(player.client, { currentPassword: 'falsch-falsch', newPassword })),
    ).toMatchObject({ status: 403, code: 'INVALID_CREDENTIALS' });
    // Die Sitzung bleibt nach einem Fehlversuch bestehen
    expect((await me(player.client)).user.id).toBe(player.userId);

    const key = randomUUID();
    const response = await change(player.client, { currentPassword: PASSWORD, newPassword }, key);
    expect(response.statusCode, response.body).toBe(204);
    expect((await me(player.client)).user.id).toBe(player.userId);
    expect((await device.get('/me')).statusCode).toBe(401);

    // Wiederholung nach Erfolg: gespeicherte Antwort statt Fehler am alten Passwort
    const replay = await change(player.client, { currentPassword: PASSWORD, newPassword }, key);
    expect(replay.statusCode).toBe(204);
    expect(replay.headers['idempotency-replayed']).toBe('true');

    const fresh = new TestClient(server.app);
    expect((await login(fresh, player.username, PASSWORD)).statusCode).toBe(401);
    expect((await login(fresh, player.username, newPassword)).statusCode).toBe(200);
  });

  it('gilt nur für gesicherte Konten und prüft das neue Passwort', async () => {
    const guest = new TestClient(server.app);
    await guest.signUpGuest();
    expect(
      errorOf(await change(guest, { currentPassword: PASSWORD, newPassword: PASSWORD })),
    ).toMatchObject({ status: 403, code: 'GUEST_ACCOUNT' });
    const player = await registeredPlayer();
    expect(
      errorOf(await change(player.client, { currentPassword: PASSWORD, newPassword: 'kurz' })),
    ).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });
});

describe('Namen ändern (PATCH /me/profile)', () => {
  function rename(client: TestClient, username: unknown, key = randomUUID()) {
    return client.patch('/me/profile', {
      headers: { 'idempotency-key': key },
      payload: { username },
    });
  }

  it('ändert Spieler- und Anmeldenamen eines gesicherten Kontos', async () => {
    const player = await registeredPlayer();
    const response = await rename(player.client, ' Listige  Elster ');
    expect(response.statusCode, response.body).toBe(200);
    expect(profileResponseSchema.parse(response.json()).profile).toEqual({
      displayName: 'Listige Elster',
    });
    const body = await me(player.client);
    expect(body.profile.displayName).toBe('Listige Elster');
    expect(body.user.username).toBe('Listige Elster');
    // Anmelden geht mit dem neuen Namen, nicht mehr mit dem alten
    expect((await login(new TestClient(server.app), 'listige elster', PASSWORD)).statusCode).toBe(
      200,
    );
    expect((await login(new TestClient(server.app), player.username, PASSWORD)).statusCode).toBe(
      401,
    );
    // Den eigenen Namen erneut oder anders geschrieben zu wählen ist kein Konflikt
    expect((await rename(player.client, 'Listige Elster')).statusCode).toBe(200);
    expect((await rename(player.client, 'listige_elster')).statusCode).toBe(200);
    expect((await me(player.client)).profile.displayName).toBe('listige_elster');
  });

  it('liefert bei Wiederholung die gespeicherte Antwort, auch nach einer späteren Änderung', async () => {
    const player = await registeredPlayer();
    const key = randomUUID();
    expect((await rename(player.client, 'Wacher Luchs', key)).statusCode).toBe(200);
    expect((await rename(player.client, 'Wacher Uhu')).statusCode).toBe(200);

    const replay = await rename(player.client, 'Wacher Luchs', key);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(profileResponseSchema.parse(replay.json()).profile.displayName).toBe('Wacher Luchs');
    // ohne erneute Wirkung
    expect((await me(player.client)).profile.displayName).toBe('Wacher Uhu');
  });

  it('lehnt vergebene und gesperrte Namen und Gastkonten ab', async () => {
    const first = await registeredPlayer();
    const second = await registeredPlayer();
    expect(errorOf(await rename(second.client, first.username.toLowerCase()))).toMatchObject({
      status: 409,
      code: 'USERNAME_TAKEN',
    });
    expect(errorOf(await rename(second.client, 'Kurva Anyad'))).toMatchObject({
      status: 422,
      code: 'NAME_NOT_ALLOWED',
    });
    expect((await me(second.client)).profile.displayName).toBe(second.username);
    const guest = new TestClient(server.app);
    await guest.signUpGuest();
    expect(errorOf(await rename(guest, freshUsername()))).toMatchObject({
      status: 403,
      code: 'GUEST_ACCOUNT',
    });
    expect((await me(guest)).profile).toEqual({ displayName: null });
  });
});

describe('Namensvorschläge', () => {
  it('schlägt fünf freie Namen vor, die als Benutzername passen', async () => {
    const player = await registeredPlayer();
    const response = await player.client.get('/names/player');
    expect(response.statusCode, response.body).toBe(200);
    const { suggestions } = playerNameSuggestionsSchema.parse(response.json());
    expect(suggestions).toHaveLength(5);
    const names = suggestions.map((s) => s.name);
    expect(new Set(names).size).toBe(5);
    for (const suggestion of suggestions) {
      expect(suggestion.name).toBe(playerDisplayName(suggestion.parts));
      expect((await nameStatus(player.client, suggestion.name)).status).toBe('FREE');
    }
    const taken = await server.db
      .selectFrom('player_profiles')
      .select('display_name')
      .where('display_name', 'in', names)
      .execute();
    expect(taken).toEqual([]);
    expect((await new TestClient(server.app).get('/names/player')).statusCode).toBe(401);
  });

  it('schlägt Reichsnamen je Instanz vor', async () => {
    const world = await createTestWorld(server.db);
    const client = new TestClient(server.app);
    await client.signUpGuest();
    const joined = joinResponseSchema.parse((await client.join(world.worldId)).json());
    const response = await client.get(`/instances/${joined.instanceId}/kingdom-names`);
    expect(response.statusCode, response.body).toBe(200);
    const { suggestions } = kingdomNameSuggestionsSchema.parse(response.json());
    expect(suggestions).toHaveLength(5);
    for (const suggestion of suggestions) {
      expect(suggestion.name).toBe(kingdomName(suggestion.parts));
      expect(suggestion.name).not.toBe(joined.kingdom.name);
    }
    expect(errorOf(await client.get(`/instances/${randomUUID()}/kingdom-names`))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('Reichsname beim Beitritt', () => {
  function join(client: TestClient, worldId: string, body: unknown, key = randomUUID()) {
    return client.post(`/worlds/${worldId}/join`, {
      headers: { 'idempotency-key': key },
      payload: body as Record<string, unknown>,
    });
  }

  it('gründet das Reich mit dem gewählten Namen', async () => {
    const world = await createTestWorld(server.db);
    const client = new TestClient(server.app);
    await client.signUpGuest();
    const listed = await client.get(`/instances/${world.instanceId}/kingdom-names`);
    const { suggestions } = kingdomNameSuggestionsSchema.parse(listed.json());
    const [choice, other] = [suggestions[2], suggestions[3]];
    if (!choice || !other) throw new Error('Vorschlag fehlt');
    const key = randomUUID();
    const response = await join(client, world.worldId, { kingdomName: choice.parts }, key);
    expect(response.statusCode, response.body).toBe(201);
    const joined = joinResponseSchema.parse(response.json());
    expect(joined.kingdom.nameParts).toEqual(choice.parts);
    expect(joined.kingdom.name).toBe(choice.name);
    // Derselbe Schlüssel mit anderem Namen ist eine andere Anfrage
    const reused = await join(client, world.worldId, { kingdomName: other.parts }, key);
    expect(errorOf(reused)).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
    const replay = await join(client, world.worldId, { kingdomName: choice.parts }, key);
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  it('lehnt Namen außerhalb der Bausteine ab', async () => {
    const world = await createTestWorld(server.db);
    const client = new TestClient(server.app);
    await client.signUpGuest();
    expect(
      errorOf(
        await join(client, world.worldId, { kingdomName: { prefix: 'Mein', suffix: 'Reich' } }),
      ),
    ).toMatchObject({ status: 422, code: 'INVALID_NAME' });
    expect(errorOf(await join(client, world.worldId, { name: 'frei' }))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    // Ohne Körper zieht der Server wie bisher einen Namen
    expect((await client.join(world.worldId)).statusCode).toBe(201);
  });
});
