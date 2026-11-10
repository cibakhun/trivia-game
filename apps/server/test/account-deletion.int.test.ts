import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { advanceGameClock } from '@rdw/db/testing';
import { defenseResponseSchema, mapStateResponseSchema } from '@rdw/protocol';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_REFERENCES, cleanupAccounts } from '../src/index.ts';
import {
  TestClient,
  createTestWorld,
  importFixtureQuestions,
  startTestServer,
  type TestServer,
} from './helpers.ts';
import { PLAYTEST, createPvpKit } from './pvp-kit.ts';

/**
 * Kontolöschung (SECURITY.md §5.2, ADR-045): Kontopflege für inaktive Gäste nach 90 Tagen, die
 * Kaskade über alle Verweise auf das Konto und der Passwort-Reset per Kommandozeile.
 */

const PASSWORD = 'richtig-langes-passwort';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
  expect(await importFixtureQuestions(server.db)).toBe(40);
  return () => server.close();
});

const { newPlayer, startAttack, playAttacker, startDefense, playDefender, pvpPair } = createPvpKit(
  () => server,
);

let nameCounter = 0;

/** Sichert das Konto des Clients mit frischem Benutzer- und Spielernamen. */
async function register(client: TestClient): Promise<string> {
  nameCounter += 1;
  const username = `konto_${randomUUID().slice(0, 8)}`;
  const response = await client.post('/auth/register', {
    headers: { 'idempotency-key': randomUUID() },
    payload: {
      username,
      password: PASSWORD,
      playerName: { adjective: 'Treu', noun: 'Dachs', number: nameCounter + 1 },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return username;
}

/** Letzte Anmeldung vor `days` Tagen (Spielzeit). */
async function lastSeenDaysAgo(userId: string, days: number): Promise<void> {
  await sql`update users set last_seen_at = game_now() - make_interval(days => ${days})
            where id = ${userId}`.execute(server.db);
}

async function userExists(userId: string): Promise<boolean> {
  const row = await server.db
    .selectFrom('users')
    .select('id')
    .where('id', '=', userId)
    .executeTakeFirst();
  return row !== undefined;
}

/** Tabellen, in denen die ID irgendwo im Zeilentext vorkommt, mit Anzahl der Zeilen. */
async function tablesMentioning(id: string): Promise<Record<string, number>> {
  const { rows: tables } = await sql<{ name: string }>`
    select tablename as name from pg_tables where schemaname = 'public' order by tablename
  `.execute(server.db);
  const hits: Record<string, number> = {};
  for (const { name } of tables) {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from ${sql.table(name)} as t where t::text like ${`%${id}%`}
    `.execute(server.db);
    const n = rows[0]?.n ?? 0;
    if (n > 0) hits[name] = n;
  }
  return hits;
}

describe('Kontopflege (cleanupAccounts)', () => {
  // Läuft zuerst: Die Zählungen setzen voraus, dass sonst nichts fällig ist.
  it('löscht inaktive Gäste nach 90 Tagen, abgelaufene Sitzungen und alte Bootstrap-Hashes', async () => {
    const recent = new TestClient(server.app);
    const recentId = await recent.signUpGuest();
    await recent.get('/me');
    await lastSeenDaysAgo(recentId, 89);

    // Nie benutzt: Es zählt der Zeitpunkt der Anlage
    const unused = new TestClient(server.app);
    const unusedId = await unused.signUpGuest();
    await sql`update users set last_seen_at = null, created_at = game_now() - interval '91 days'
              where id = ${unusedId}`.execute(server.db);

    // Gesicherte Konten bleiben, auch nach langer Pause
    const registered = new TestClient(server.app);
    const registeredId = await registered.signUpGuest();
    await register(registered);
    await lastSeenDaysAgo(registeredId, 400);

    // Gast von gestern: Bootstrap-Hash wird geleert, die Sitzung ist abgelaufen
    const yesterday = new TestClient(server.app);
    const yesterdayId = await yesterday.signUpGuest();
    await sql`update users set created_at = game_now() - interval '25 hours' where id = ${yesterdayId}`.execute(
      server.db,
    );
    await sql`update sessions set created_at = game_now() - interval '31 days',
                                  expires_at = game_now() - interval '1 day'
              where user_id = ${yesterdayId}`.execute(server.db);

    const result = await cleanupAccounts(server.db);
    expect(result).toEqual({ deletedGuests: 1, expiredSessions: 1, clearedBootstraps: 1 });
    expect(await userExists(recentId)).toBe(true);
    expect(await userExists(unusedId)).toBe(false);
    expect(await userExists(registeredId)).toBe(true);
    const row = await server.db
      .selectFrom('users')
      .select('guest_bootstrap_hash')
      .where('id', '=', yesterdayId)
      .executeTakeFirstOrThrow();
    expect(row.guest_bootstrap_hash).toBeNull();
    expect((await yesterday.get('/me')).statusCode).toBe(401);
    expect((await recent.get('/me')).statusCode).toBe(200);
    // Ein zweiter Lauf findet nichts mehr
    expect(await cleanupAccounts(server.db)).toEqual({
      deletedGuests: 0,
      expiredSessions: 0,
      clearedBootstraps: 0,
    });
  });
});

describe('Kaskade der Kontolöschung (SECURITY §5.2)', () => {
  it('kennt jede Spalte mit einer Konto-ID, und jede ist indiziert', async () => {
    const { rows } = await sql<{ ref: string; indexed: boolean; on_delete: string }>`
      select c.conrelid::regclass::text || '.' || a.attname as ref,
             exists (select 1 from pg_index i
                     where i.indrelid = c.conrelid and i.indkey[0] = a.attnum) as indexed,
             c.confdeltype::text as on_delete
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'users'::regclass
      order by 1
    `.execute(server.db);
    expect(rows.map((r) => r.ref)).toEqual(Object.keys(ACCOUNT_REFERENCES).sort());
    for (const row of rows) {
      expect(row, row.ref).toMatchObject({ indexed: true, on_delete: 'r' });
    }
  });

  it('anonymisiert einen Gast nach einem PvP-Kampf, ohne Spuren seiner ID', async () => {
    const pair = await pvpPair();
    const { attacker, defender, instanceId } = pair;
    await register(defender.client);
    const started = await startAttack(attacker, pair.target);
    await playAttacker(attacker, started.challengeId, { trivia: true, exactEstimate: false });
    const begun = defenseResponseSchema.parse(
      (await startDefense(defender, started.siegeId)).json(),
    );
    await playDefender(defender, begun.challengeId, { trivia: true, exactEstimate: true });

    const rawInputs = () =>
      server.db
        .selectFrom('quiz_answers as a')
        .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
        .select(['p.role', 'a.raw_input'])
        .where('a.challenge_id', '=', started.challengeId)
        .where('a.step_index', '=', 1)
        .orderBy('p.role')
        .execute();
    expect((await rawInputs()).every((r) => r.raw_input !== null)).toBe(true);
    const eventsBefore = await server.db
      .selectFrom('world_events')
      .select(['seq', 'type', 'user_id'])
      .where('instance_id', '=', instanceId)
      .orderBy('seq')
      .execute();
    const personal = eventsBefore.filter((e) => e.user_id === attacker.userId);
    expect(personal.length).toBeGreaterThan(0);

    await lastSeenDaysAgo(attacker.userId, 91);
    expect((await cleanupAccounts(server.db)).deletedGuests).toBe(1);
    expect(await userExists(attacker.userId)).toBe(false);
    expect((await attacker.client.get('/me')).statusCode).toBe(401);

    // Platzhalter übernimmt Reich, Teilnahme und Kampfteilnahme
    const kingdom = await server.db
      .selectFrom('kingdoms')
      .select(['owner_user_id', 'name_parts', 'region_count'])
      .where('id', '=', attacker.joined.kingdom.id)
      .executeTakeFirstOrThrow();
    const placeholder = await server.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', kingdom.owner_user_id)
      .executeTakeFirstOrThrow();
    expect(placeholder).toMatchObject({
      is_guest: false,
      username: null,
      email: null,
      password_hash: null,
      guest_bootstrap_hash: null,
      last_seen_at: null,
    });
    expect(placeholder.deleted_at).not.toBeNull();
    expect(kingdom.name_parts).toMatchObject({ prefix: 'Vergessenes Reich #' });
    expect((kingdom.name_parts as { suffix: string }).suffix).toMatch(/^\d{4}$/);
    expect(kingdom.region_count).toBeGreaterThan(0);
    const participants = await server.db
      .selectFrom('siege_participants')
      .select(['user_id', 'role'])
      .where('siege_id', '=', started.siegeId)
      .orderBy('role')
      .execute();
    expect(participants).toEqual([
      { user_id: placeholder.id, role: 'ATTACKER' },
      { user_id: defender.userId, role: 'DEFENDER' },
    ]);

    // Eigene Rohtexte geleert, die des Verteidigers bleiben
    const raw = await rawInputs();
    expect(raw.find((r) => r.role === 'ATTACKER')?.raw_input).toBeNull();
    expect(raw.find((r) => r.role === 'DEFENDER')?.raw_input).not.toBeNull();

    // Persönliche Ereignisse sind Platzhalter, die seq-Folge bleibt gleich
    const eventsAfter = await server.db
      .selectFrom('world_events')
      .select(['seq', 'type', 'user_id', 'payload'])
      .where('instance_id', '=', instanceId)
      .orderBy('seq')
      .execute();
    expect(eventsAfter.map((e) => e.seq)).toEqual(eventsBefore.map((e) => e.seq));
    for (const event of personal) {
      expect(eventsAfter.find((e) => e.seq === event.seq)).toMatchObject({
        type: 'REDACTED',
        user_id: null,
        payload: {},
      });
    }

    // Die alte ID steht nirgends mehr, auch nicht in JSON-Feldern
    expect(await tablesMentioning(attacker.userId)).toEqual({});

    // Der Verteidiger spielt weiter und sieht das vergessene Reich
    const sieges = await defender.client.get(`/instances/${instanceId}/sieges`);
    expect(sieges.statusCode, sieges.body).toBe(200);
    const chunk = await server.db
      .selectFrom('region_state')
      .select(['chunk_x', 'chunk_y'])
      .where('region_id', '=', attacker.joined.capitalRegionId)
      .executeTakeFirstOrThrow();
    const state = await defender.client.get(
      `/instances/${instanceId}/map/state?chunks=${chunk.chunk_x}:${chunk.chunk_y}`,
    );
    expect(state.statusCode, state.body).toBe(200);
    const forgotten = mapStateResponseSchema
      .parse(state.json())
      .kingdoms.find((k) => k.id === attacker.joined.kingdom.id);
    expect(forgotten?.name).toMatch(/^Vergessenes Reich #\d{4}$/);
  });

  it('wartet mit der Löschung, solange eine Belagerung des Gasts offen ist', async () => {
    const pair = await pvpPair();
    const started = await startAttack(pair.attacker, pair.target);
    await playAttacker(pair.attacker, started.challengeId, { trivia: true, exactEstimate: true });
    await lastSeenDaysAgo(pair.attacker.userId, 91);

    expect((await cleanupAccounts(server.db)).deletedGuests).toBe(0);
    expect(await userExists(pair.attacker.userId)).toBe(true);

    // Nach Fristablauf wertet die Pflege den Kampf aus und löscht danach
    await advanceGameClock(server.database.pool, 11 * 60_000);
    expect((await cleanupAccounts(server.db)).deletedGuests).toBe(1);
    expect(await userExists(pair.attacker.userId)).toBe(false);
    const siege = await server.db
      .selectFrom('sieges')
      .select('status')
      .where('id', '=', started.siegeId)
      .executeTakeFirstOrThrow();
    expect(siege.status).toBe('ATTACKER_WON_BY_TIMEOUT');
    expect(await tablesMentioning(pair.attacker.userId)).toEqual({});
  });

  it('löscht einen Gast mit Reich, aber ohne Kampf', async () => {
    const world = await createTestWorld(server.db, { rules: PLAYTEST });
    const player = await newPlayer(world);
    await lastSeenDaysAgo(player.userId, 120);
    expect((await cleanupAccounts(server.db)).deletedGuests).toBe(1);
    expect(await userExists(player.userId)).toBe(false);
    expect(await tablesMentioning(player.userId)).toEqual({});
    const region = await server.db
      .selectFrom('region_state')
      .select('owner_kingdom_id')
      .where('region_id', '=', player.joined.capitalRegionId)
      .executeTakeFirstOrThrow();
    expect(region.owner_kingdom_id).toBe(player.joined.kingdom.id);
  });
});

describe('Kontopflege bei Konten, die warten oder scheitern', () => {
  it('stellt Regelversionen des Kontos auf den Platzhalter um', async () => {
    // Gäste legen keine Regeln an; die Kaskade muss es trotzdem können (später DELETE /me)
    const world = await createTestWorld(server.db, { rules: PLAYTEST });
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    const rulesId = randomUUID();
    await sql`insert into world_rules (id, world_id, version, config, config_hash, created_by)
              select ${rulesId}, world_id, 2, config, config_hash, ${userId}
              from world_rules where id = ${world.rulesId}`.execute(server.db);
    await lastSeenDaysAgo(userId, 95);

    expect((await cleanupAccounts(server.db)).deletedGuests).toBe(1);
    expect(await userExists(userId)).toBe(false);
    const rules = await server.db
      .selectFrom('world_rules as r')
      .innerJoin('users as u', 'u.id', 'r.created_by')
      .select(['u.deleted_at'])
      .where('r.id', '=', rulesId)
      .executeTakeFirstOrThrow();
    expect(rules.deleted_at).not.toBeNull();
  });

  it('prüft nach wartenden Konten die späteren im selben Lauf', async () => {
    // Der älteste Gast wartet auf eine offene Belagerung, der jüngere wird trotzdem gelöscht
    const pair = await pvpPair();
    const started = await startAttack(pair.attacker, pair.target);
    await playAttacker(pair.attacker, started.challengeId, { trivia: true, exactEstimate: true });
    await lastSeenDaysAgo(pair.attacker.userId, 200);
    const later = new TestClient(server.app);
    const laterId = await later.signUpGuest();
    await lastSeenDaysAgo(laterId, 100);

    expect((await cleanupAccounts(server.db, undefined, 1)).deletedGuests).toBe(1);
    expect(await userExists(pair.attacker.userId)).toBe(true);
    expect(await userExists(laterId)).toBe(false);

    // Aufräumen für spätere Tests: Frist ablaufen lassen, dann ist auch der Älteste dran
    await advanceGameClock(server.database.pool, 11 * 60_000);
    expect((await cleanupAccounts(server.db)).deletedGuests).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------

const CLI = fileURLToPath(new URL('../src/cli/account-reset-password.ts', import.meta.url));

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Startet `pnpm account:reset-password` als eigenen Prozess, ohne die .env des Hauptordners. */
function runCli(args: readonly string[], appEnv = 'test'): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    APP_ENV: appEnv,
    DATABASE_URL: server.database.url,
  };
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', CLI, ...args],
      { env, cwd: fileURLToPath(new URL('..', import.meta.url)) },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

describe('pnpm account:reset-password (Kommandozeile)', () => {
  it('setzt ein neues Passwort, beendet alle Sitzungen und zeigt es einmal', async () => {
    const client = new TestClient(server.app);
    const userId = await client.signUpGuest();
    const username = await register(client);

    const result = await runCli([`--username=${username.toUpperCase()}`]);
    expect(result.code, result.stderr).toBe(0);
    const password = /Neues Passwort \(nur jetzt sichtbar\): (\S+)/.exec(result.stdout)?.[1];
    expect(password).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect((await client.get('/me')).statusCode).toBe(401);

    const login = (pw: string) =>
      new TestClient(server.app).post('/auth/login', { payload: { username, password: pw } });
    expect((await login(PASSWORD)).statusCode).toBe(401);
    const ok = await login(password as string);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<{ user: { id: string } }>().user.id).toBe(userId);
  });

  it('bricht in Produktion, bei Gästen, Löschanträgen und falschen Argumenten ab', async () => {
    const client = new TestClient(server.app);
    await client.signUpGuest();
    const username = await register(client);
    const hash = async () =>
      (
        await server.db
          .selectFrom('users')
          .select('password_hash')
          .where('username', '=', username)
          .executeTakeFirstOrThrow()
      ).password_hash;
    const before = await hash();

    // Gesperrt, bis es audit_events gibt
    const production = await runCli([`--username=${username}`], 'production');
    expect(production.code).toBe(2);
    expect(production.stderr).toMatch(/In Produktion gesperrt/);

    const unknown = await runCli(['--username=niemand_hier']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/Kein gesichertes Konto/);

    for (const args of [
      [],
      ['--user=x'],
      [`--username=${username}`, '--username=x'],
      ['--username='],
    ]) {
      const result = await runCli(args);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr).toMatch(/Ungültige Argumente/);
    }
    expect(await hash()).toBe(before);
    expect((await client.get('/me')).statusCode).toBe(200);

    // Mit Löschantrag meldet sich niemand an; neue Zugangsdaten gibt es dann auch nicht
    await server.db
      .updateTable('users')
      .set({ deletion_requested_at: new Date() })
      .where('username', '=', username)
      .execute();
    const requested = await runCli([`--username=${username}`]);
    expect(requested.code).toBe(1);
    expect(requested.stderr).toMatch(/ohne Löschantrag/);
    expect(await hash()).toBe(before);
  });
});
