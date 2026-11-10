import { randomUUID } from 'node:crypto';
import { kingdomName, playerDisplayName, type PlayerNameParts } from '@rdw/game-core';
import {
  errorBodySchema,
  joinResponseSchema,
  kingdomNameSuggestionsSchema,
  meResponseSchema,
  playerNameSuggestionsSchema,
  profileResponseSchema,
  sessionResponseSchema,
} from '@rdw/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { TestClient, createTestWorld, startTestServer, type TestServer } from './helpers.ts';

/**
 * Gesicherte Konten über die HTTP-Schnittstelle (O-03, O-10, ADR-043/044): Gast sichern,
 * Anmelden mit Sitzungsrotation, Anmeldebremse, Passwort und Spielername ändern,
 * Namensvorschläge und Reichsname beim Beitritt.
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

/** Ein Spielername, den in dieser Datei noch niemand trägt. */
function freshPlayerName(): PlayerNameParts {
  nameCounter += 1;
  return { adjective: 'Kühn', noun: 'Falke', number: nameCounter + 1 };
}

function freshUsername(prefix = 'spieler'): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
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
  readonly playerName: PlayerNameParts;
}

/** Gast anlegen und sichern. */
async function registeredPlayer(srv: TestServer = server): Promise<Registered> {
  const client = new TestClient(srv.app);
  const userId = await client.signUpGuest();
  const username = freshUsername();
  const playerName = freshPlayerName();
  const response = await register(client, { username, password: PASSWORD, playerName });
  expect(response.statusCode, response.body).toBe(201);
  return { client, userId, username, playerName };
}

describe('Gast sichern (POST /auth/register)', () => {
  it('macht aus dem Gast ein gesichertes Konto und tauscht die Sitzung aus', async () => {
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    const guestToken = client.cookies.get('rdw_session') as string;
    // Eine zweite Sitzung desselben Gasts (anderes Gerät) endet mit dem Sichern ebenfalls
    const other = new TestClient(server.app);
    other.cookies.set('rdw_session', guestToken);

    const username = freshUsername('Ärger');
    const playerName: PlayerNameParts = { adjective: 'Flink', noun: 'Wiesel', number: null };
    const response = await register(client, { username, password: PASSWORD, playerName });
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
    expect(body.profile).toEqual({ displayName: 'Flinkes Wiesel', playerName });
  });

  it('liefert bei Wiederholung dieselbe Antwort und eine neue Sitzung für dasselbe Konto', async () => {
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    const key = randomUUID();
    const body = { username: freshUsername(), password: PASSWORD, playerName: freshPlayerName() };
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

  it('lehnt vergebene Benutzer- und Spielernamen ab, der Gast bleibt Gast', async () => {
    const taken = await registeredPlayer();
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    // Benutzernamen sind ohne Rücksicht auf Groß- und Kleinschreibung eindeutig
    const sameName = await register(client, {
      username: taken.username.toUpperCase(),
      password: PASSWORD,
      playerName: freshPlayerName(),
    });
    expect(errorOf(sameName)).toMatchObject({ status: 409, code: 'USERNAME_TAKEN' });
    const sameDisplay = await register(client, {
      username: freshUsername(),
      password: PASSWORD,
      playerName: taken.playerName,
    });
    expect(errorOf(sameDisplay)).toMatchObject({
      status: 409,
      code: 'PLAYER_NAME_TAKEN',
      details: { displayName: playerDisplayName(taken.playerName) },
    });
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

  it('prüft Benutzername, Passwort, Spielername, Sitzung und Schlüssel', async () => {
    const client = new TestClient(server.app);
    await client.signUpGuest();
    const valid = { username: freshUsername(), password: PASSWORD, playerName: freshPlayerName() };
    const cases: [Record<string, unknown>, number, string][] = [
      [{ ...valid, username: 'ab' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, username: 'mit leerzeichen' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, username: 'x'.repeat(25) }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, password: 'kurz' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, password: 'x'.repeat(129) }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, email: 'a@b.de' }, 400, 'VALIDATION_FAILED'],
      [
        { ...valid, playerName: { adjective: 'Böse', noun: 'Falke', number: null } },
        422,
        'INVALID_NAME',
      ],
      [
        { ...valid, playerName: { adjective: 'Kühn', noun: 'Admin', number: null } },
        422,
        'INVALID_NAME',
      ],
      [
        { ...valid, playerName: { adjective: 'Kühn', noun: 'Falke', number: 1 } },
        400,
        'VALIDATION_FAILED',
      ],
      [
        { ...valid, playerName: { adjective: 'Kühn', noun: 'toString', number: null } },
        422,
        'INVALID_NAME',
      ],
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

describe('Spielername ändern (PATCH /me/profile)', () => {
  function rename(client: TestClient, playerName: unknown, key = randomUUID()) {
    return client.patch('/me/profile', {
      headers: { 'idempotency-key': key },
      payload: { playerName },
    });
  }

  it('ändert den Namen eines gesicherten Kontos', async () => {
    const player = await registeredPlayer();
    const playerName: PlayerNameParts = { adjective: 'Listig', noun: 'Elster', number: 42 };
    const response = await rename(player.client, playerName);
    expect(response.statusCode, response.body).toBe(200);
    expect(profileResponseSchema.parse(response.json()).profile).toEqual({
      displayName: 'Listige Elster 42',
      playerName,
    });
    expect((await me(player.client)).profile.displayName).toBe('Listige Elster 42');
    // Den eigenen Namen erneut zu wählen ist kein Konflikt
    expect((await rename(player.client, playerName)).statusCode).toBe(200);
  });

  it('lehnt vergebene Namen und Gastkonten ab', async () => {
    const first = await registeredPlayer();
    const second = await registeredPlayer();
    expect(errorOf(await rename(second.client, first.playerName))).toMatchObject({
      status: 409,
      code: 'PLAYER_NAME_TAKEN',
    });
    expect((await me(second.client)).profile.playerName).toEqual(second.playerName);
    const guest = new TestClient(server.app);
    await guest.signUpGuest();
    expect(errorOf(await rename(guest, freshPlayerName()))).toMatchObject({
      status: 403,
      code: 'GUEST_ACCOUNT',
    });
    expect((await me(guest)).profile).toEqual({ displayName: null, playerName: null });
  });
});

describe('Namensvorschläge', () => {
  it('schlägt fünf freie Spielernamen vor', async () => {
    const player = await registeredPlayer();
    const response = await player.client.get('/names/player');
    expect(response.statusCode, response.body).toBe(200);
    const { suggestions } = playerNameSuggestionsSchema.parse(response.json());
    expect(suggestions).toHaveLength(5);
    const names = suggestions.map((s) => s.name);
    expect(new Set(names).size).toBe(5);
    for (const suggestion of suggestions) {
      expect(suggestion.name).toBe(playerDisplayName(suggestion.parts));
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
