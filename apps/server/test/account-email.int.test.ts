import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { advanceGameClock } from '@rdw/db/testing';
import {
  DAY_MS,
  accountDeleteResponseSchema,
  emailResponseSchema,
  emailVerifyResponseSchema,
  loginResponseSchema,
  meResponseSchema,
  nameCheckSchema,
  nameReportResponseSchema,
  type EmailState,
} from '@rdw/protocol';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { cleanupAccounts } from '../src/index.ts';
import { nameAllowed } from '../src/modules/identity/name-filter.ts';
import { decideName, listOpenNameReports } from '../src/modules/identity/name-reports.ts';
import { TestClient, startTestServer, type TestServer } from './helpers.ts';
import { matchKit, type Human } from './match-kit.ts';

/**
 * E-Mail-Adresse, Löschantrag und Namen melden (ADR-086, O-47, O-48) über die HTTP-Schnittstelle:
 * Bestätigungslink, Wechsel der Adresse, Bremse für Links, Frist von 30 Tagen in der Kontopflege,
 * Löschantrag mit 7 Tagen Bedenkzeit, Meldungen und die Entscheidung der Spielleitung.
 *
 * Die Spielzeit läuft hier insgesamt nur wenige Tage vor; jede Prüfung nach der Kontopflege fragt
 * nach ihren eigenen Konten.
 */

const PASSWORD = 'richtig-langes-passwort';
const MINUTE = 60_000;

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
  return () => server.close();
});

const { newHuman, createMatch, view, joinMatch, setBot, errorOf } = matchKit(() => server);

function key() {
  return { 'idempotency-key': randomUUID() };
}

function freshEmail(): string {
  return `spieler.${randomUUID().slice(0, 8)}@example.org`;
}

function freshUsername(): string {
  // Hexziffern können ein gesperrtes Wort bilden: dann neu ziehen
  let username: string;
  do username = `konto_${randomUUID().slice(0, 8)}`;
  while (!nameAllowed(username));
  return username;
}

interface Account extends Human {
  readonly username: string;
  readonly email: string;
}

/** Gast, der sich mit Benutzernamen und Adresse sichert. */
async function registered(email: string = freshEmail()): Promise<Account> {
  const human = await newHuman();
  const username = freshUsername();
  const response = await human.client.post('/auth/register', {
    headers: key(),
    payload: { username, email, password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(201);
  return { ...human, username, email };
}

/** Token aus der letzten Mail an die Adresse. */
function tokenFor(email: string): string {
  const mail = server.mailer.lastTo(email);
  const token = /\/email\/bestaetigen\/([A-Za-z0-9_-]{43})/.exec(mail?.text ?? '')?.[1];
  expect(token, mail?.text).toBeDefined();
  return token as string;
}

function verify(token: string, client = new TestClient(server.app)) {
  return client.post('/auth/email/verify', { payload: { token } });
}

async function emailOf(client: TestClient): Promise<{ email: EmailState | null; now: number }> {
  const response = await client.get('/me');
  expect(response.statusCode, response.body).toBe(200);
  const me = meResponseSchema.parse(response.json());
  return { email: me.user.email, now: Date.parse(me.serverTime) };
}

function changeEmail(client: TestClient, email: string, headers = key()) {
  return client.put('/me/email', { headers, payload: { email } });
}

function resend(client: TestClient) {
  return client.post('/me/email/resend', { headers: key() });
}

async function userRow(userId: string) {
  return server.db
    .selectFrom('users')
    .select(['email', 'email_verified_at', 'email_due_at', 'deletion_requested_at'])
    .where('id', '=', userId)
    .executeTakeFirst();
}

describe('E-Mail-Adresse (ADR-086)', () => {
  it('schickt beim Registrieren einen Link, der die Adresse auch ohne Sitzung bestätigt', async () => {
    const account = await registered();
    const mail = server.mailer.lastTo(account.email);
    expect(mail?.subject).toBe('Bitte bestätige deine E-Mail-Adresse');
    expect(mail?.text).toContain(account.username);
    expect(mail?.text).toMatch(/30 Tage|innerhalb von 30 Tagen|bis zum/);

    const before = await emailOf(account.client);
    expect(before.email).toMatchObject({ address: account.email, verified: false, pending: null });
    const due = Date.parse(before.email?.dueAt ?? '');
    expect(Math.abs(due - before.now - 30 * DAY_MS)).toBeLessThan(MINUTE);

    const token = tokenFor(account.email);
    const done = await verify(token);
    expect(done.statusCode, done.body).toBe(200);
    expect(emailVerifyResponseSchema.parse(done.json()).email).toBe(account.email);
    const after = await emailOf(account.client);
    expect(after.email).toEqual({
      address: account.email,
      verified: true,
      pending: null,
      dueAt: null,
    });

    // Zweimal tippen schadet nicht; ein fremdes oder kaputtes Token schon
    expect((await verify(token)).statusCode).toBe(200);
    const unknown = await verify('A'.repeat(43));
    expect(errorOf(unknown)).toMatchObject({ status: 410, code: 'EMAIL_LINK_INVALID' });
    const broken = await verify('kurz');
    expect(errorOf(broken)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('wechselt eine bestätigte Adresse erst, wenn die neue bestätigt ist', async () => {
    const account = await registered();
    expect((await verify(tokenFor(account.email))).statusCode).toBe(200);
    await advanceGameClock(server.database.pool, MINUTE + 1000);

    const next = freshEmail();
    const headers = key();
    const changed = await changeEmail(account.client, next, headers);
    expect(changed.statusCode, changed.body).toBe(200);
    expect(emailResponseSchema.parse(changed.json())).toMatchObject({
      email: { address: account.email, verified: true, pending: next, dueAt: null },
      mailSent: true,
    });
    const sent = server.mailer.sent.length;
    const replay = await changeEmail(account.client, next, headers);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(server.mailer.sent.length).toBe(sent);
    const firstLink = tokenFor(next);

    // Zurück zur alten Adresse: Der Wechsel entfällt, ohne neuen Link
    const back = await changeEmail(account.client, account.email.toUpperCase());
    expect(emailResponseSchema.parse(back.json())).toMatchObject({
      email: { address: account.email, verified: true, pending: null },
      mailSent: false,
    });
    expect(errorOf(await verify(firstLink))).toMatchObject({ code: 'EMAIL_LINK_INVALID' });

    await advanceGameClock(server.database.pool, MINUTE + 1000);
    expect((await changeEmail(account.client, next)).statusCode).toBe(200);
    expect((await verify(tokenFor(next))).statusCode).toBe(200);
    expect((await emailOf(account.client)).email).toMatchObject({
      address: next,
      verified: true,
      pending: null,
    });
  });

  it('ersetzt eine unbestätigte Adresse sofort; die Frist bleibt, der alte Link gilt nicht mehr', async () => {
    const account = await registered();
    const oldLink = tokenFor(account.email);
    const before = (await emailOf(account.client)).email;
    await advanceGameClock(server.database.pool, MINUTE + 1000);

    const next = freshEmail();
    const changed = await changeEmail(account.client, next);
    expect(emailResponseSchema.parse(changed.json())).toMatchObject({
      email: { address: next, verified: false, pending: null, dueAt: before?.dueAt },
      mailSent: true,
    });
    expect(errorOf(await verify(oldLink))).toMatchObject({ status: 410 });
    expect((await verify(tokenFor(next))).statusCode).toBe(200);
  });

  it('bremst neue Links: eine Minute Abstand, sechs am Tag', async () => {
    const account = await registered();
    const tooSoon = errorOf(await resend(account.client));
    expect(tooSoon).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect((tooSoon.details as { retryAfterMs: number }).retryAfterMs).toBeLessThanOrEqual(MINUTE);

    for (let n = 2; n <= 6; n += 1) {
      await advanceGameClock(server.database.pool, MINUTE + 1000);
      const again = await resend(account.client);
      expect(again.statusCode, `${n}. Link: ${again.body}`).toBe(200);
      expect(emailResponseSchema.parse(again.json()).mailSent).toBe(true);
    }
    await advanceGameClock(server.database.pool, MINUTE + 1000);
    const daily = errorOf(await resend(account.client));
    expect(daily).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect((daily.details as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(60 * MINUTE);
    // Nur der neueste Link gilt
    expect((await verify(tokenFor(account.email))).statusCode).toBe(200);
  });

  it('lässt eine bestätigte Adresse nur einem Konto', async () => {
    const first = await registered();
    expect((await verify(tokenFor(first.email))).statusCode).toBe(200);
    const human = await newHuman();
    const taken = await human.client.post('/auth/register', {
      headers: key(),
      payload: { username: freshUsername(), email: first.email.toUpperCase(), password: PASSWORD },
    });
    expect(errorOf(taken)).toMatchObject({ status: 409, code: 'EMAIL_TAKEN' });

    // Unbestätigt dürfen zwei dieselbe Adresse angeben; bestätigen kann sie nur einer
    const shared = freshEmail();
    const a = await registered(shared);
    const tokenA = tokenFor(shared);
    const b = await registered(shared);
    const tokenB = tokenFor(shared);
    expect((await verify(tokenB)).statusCode).toBe(200);
    expect(errorOf(await verify(tokenA))).toMatchObject({ status: 409, code: 'EMAIL_TAKEN' });
    await advanceGameClock(server.database.pool, MINUTE + 1000);
    expect(errorOf(await resend(a.client))).toMatchObject({ status: 409, code: 'EMAIL_TAKEN' });
    expect(errorOf(await changeEmail(a.client, shared))).toMatchObject({ code: 'EMAIL_TAKEN' });
    expect((await emailOf(b.client)).email?.verified).toBe(true);
  });

  it('gibt Gästen keine Adresse', async () => {
    const guest = await newHuman();
    expect((await emailOf(guest.client)).email).toBeNull();
    expect(errorOf(await changeEmail(guest.client, freshEmail()))).toMatchObject({
      status: 403,
      code: 'GUEST_ACCOUNT',
    });
    expect(errorOf(await resend(guest.client))).toMatchObject({ code: 'GUEST_ACCOUNT' });
  });

  it('lässt einen Link nach 7 Tagen verfallen', async () => {
    const account = await registered();
    const token = tokenFor(account.email);
    await advanceGameClock(server.database.pool, 7 * DAY_MS + MINUTE);
    expect(errorOf(await verify(token))).toMatchObject({ status: 410, code: 'EMAIL_LINK_INVALID' });
    const fresh = await resend(account.client);
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect((await verify(tokenFor(account.email))).statusCode).toBe(200);
  });
});

describe('Frist von 30 Tagen in der Kontopflege (ADR-086)', () => {
  /** Frist des Kontos abgelaufen, ohne die Spielzeit für alle anderen vorzustellen. */
  async function dueNow(userId: string) {
    await sql`update users set email_due_at = game_now() - interval '1 minute' where id = ${userId}`.execute(
      server.db,
    );
  }

  it('löscht unbestätigte Konten nur, wenn Mails wirklich zugestellt werden', async () => {
    const open = await registered();
    const confirmed = await registered();
    expect((await verify(tokenFor(confirmed.email))).statusCode).toBe(200);
    await dueNow(open.userId);
    await dueNow(confirmed.userId);

    // Ausgang statt Versand: Die Frist rückt mit, niemand wird gelöscht
    const held = await cleanupAccounts(server.db, undefined, undefined, { mailDelivers: false });
    expect(held.deletedUnverified).toBe(0);
    const floated = await userRow(open.userId);
    const { rows } = await sql<{ now: Date }>`select game_now() as now`.execute(server.db);
    const now = rows[0]?.now.getTime() ?? 0;
    expect((floated?.email_due_at?.getTime() ?? 0) - now).toBeGreaterThan(29 * DAY_MS);

    await dueNow(open.userId);
    const result = await cleanupAccounts(server.db, undefined, undefined, { mailDelivers: true });
    expect(result.deletedUnverified).toBeGreaterThanOrEqual(1);
    expect(await userRow(open.userId)).toBeUndefined();
    expect(await userRow(confirmed.userId)).toBeDefined();
    expect((await open.client.get('/me')).statusCode).toBe(401);
  });

  it('wartet mit der Löschung, solange das Konto in einer offenen Partie sitzt', async () => {
    const host = await registered();
    await createMatch(host, { kind: 'STANDARD', rules: 'PLAYTEST' });
    await dueNow(host.userId);
    await cleanupAccounts(server.db, undefined, undefined, { mailDelivers: true });
    expect(await userRow(host.userId)).toBeDefined();
  });
});

describe('Konto löschen (O-47, ADR-086)', () => {
  function deleteMe(client: TestClient, password?: string) {
    return client.delete('/me', password === undefined ? {} : { payload: { password } });
  }

  it('verlangt bei gesicherten Konten das Passwort und beendet alle Sitzungen', async () => {
    const account = await registered();
    const other = new TestClient(server.app);
    const signedIn = await other.post('/auth/login', {
      payload: { username: account.username, password: PASSWORD },
    });
    expect(signedIn.statusCode).toBe(200);

    expect(errorOf(await deleteMe(account.client))).toMatchObject({
      status: 403,
      code: 'INVALID_CREDENTIALS',
    });
    expect(errorOf(await deleteMe(account.client, 'falsches-passwort'))).toMatchObject({
      status: 403,
      code: 'INVALID_CREDENTIALS',
    });
    expect((await account.client.get('/me')).statusCode).toBe(200);

    const requested = await deleteMe(account.client, PASSWORD);
    expect(requested.statusCode, requested.body).toBe(202);
    const body = accountDeleteResponseSchema.parse(requested.json());
    const deletesAt = Date.parse(body.deletesAt ?? '');
    expect(Math.abs(deletesAt - Date.parse(body.serverTime) - 7 * DAY_MS)).toBeLessThan(MINUTE);
    expect((await account.client.get('/me')).statusCode).toBe(401);
    expect((await other.get('/me')).statusCode).toBe(401);
    expect((await userRow(account.userId))?.deletion_requested_at).not.toBeNull();
  });

  it('löscht nach 7 Tagen; wer sich vorher anmeldet, behält sein Konto', async () => {
    const leaving = await registered();
    const staying = await registered();
    expect((await deleteMe(leaving.client, PASSWORD)).statusCode).toBe(202);
    expect((await deleteMe(staying.client, PASSWORD)).statusCode).toBe(202);

    await advanceGameClock(server.database.pool, 3 * DAY_MS);
    const back = new TestClient(server.app);
    const login = await back.post('/auth/login', {
      payload: { username: staying.username, password: PASSWORD },
    });
    expect(login.statusCode, login.body).toBe(200);
    expect(loginResponseSchema.parse(login.json()).deletionCancelled).toBe(true);
    expect((await userRow(staying.userId))?.deletion_requested_at).toBeNull();

    await advanceGameClock(server.database.pool, 4 * DAY_MS + MINUTE);
    const result = await cleanupAccounts(server.db);
    expect(result.deletedOnRequest).toBeGreaterThanOrEqual(1);
    expect(await userRow(leaving.userId)).toBeUndefined();
    expect(await userRow(staying.userId)).toBeDefined();
    const again = await new TestClient(server.app).post('/auth/login', {
      payload: { username: leaving.username, password: PASSWORD },
    });
    expect(again.statusCode).toBe(401);
    // Eine normale Anmeldung meldet keinen aufgehobenen Antrag
    const plain = await new TestClient(server.app).post('/auth/login', {
      payload: { username: staying.username, password: PASSWORD },
    });
    expect(loginResponseSchema.parse(plain.json()).deletionCancelled).toBe(false);
  });

  it('löscht Gäste sofort und ohne Passwort', async () => {
    const guest = await newHuman();
    const response = await deleteMe(guest.client);
    expect(response.statusCode, response.body).toBe(202);
    expect(accountDeleteResponseSchema.parse(response.json()).deletesAt).toBeNull();
    expect(await userRow(guest.userId)).toBeUndefined();
    expect((await guest.client.get('/me')).statusCode).toBe(401);
  });

  it('nicht während einer offenen Partie', async () => {
    const host = await registered();
    await createMatch(host, { kind: 'STANDARD', rules: 'PLAYTEST' });
    expect(errorOf(await deleteMe(host.client, PASSWORD))).toMatchObject({
      status: 409,
      code: 'MATCH_IN_PROGRESS',
    });
    expect((await host.client.get('/me')).statusCode).toBe(200);
    expect((await userRow(host.userId))?.deletion_requested_at).toBeNull();
  });
});

describe('Namen melden (O-48, ADR-086)', () => {
  function report(human: Human, matchId: string, joinOrder: number) {
    return human.client.post(`/matches/${matchId}/players/${joinOrder}/report`, {
      headers: key(),
    });
  }

  /** Gastgeber, ein Mitspieler auf Platz 1 und ein Bot auf Platz 2. */
  async function lobbyOfThree() {
    const host = await registered();
    const guest = await registered();
    const matchId = await createMatch(host, { kind: 'STANDARD', rules: 'PLAYTEST' });
    const inviteCode = (await view(host, matchId)).match.inviteCode ?? '';
    expect((await joinMatch(guest, inviteCode)).statusCode).toBe(200);
    expect((await setBot(host, matchId, 2, 'EASY')).statusCode).toBe(200);
    return { host, guest, matchId };
  }

  async function nameStatus(human: Human, name: string) {
    const response = await human.client.get(`/names/check?name=${encodeURIComponent(name)}`);
    return nameCheckSchema.parse(response.json()).status;
  }

  async function profileOf(human: Human) {
    const response = await human.client.get('/me');
    return meResponseSchema.parse(response.json()).profile;
  }

  async function openReportsAgainst(userId: string): Promise<number> {
    const row = await server.db
      .selectFrom('name_reports')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('reported_user_id', '=', userId)
      .where('status', '=', 'OPEN')
      .executeTakeFirstOrThrow();
    return row.n;
  }

  it('meldet Mitspieler, nicht sich selbst, keine Bots und nur in der eigenen Partie', async () => {
    const { host, guest, matchId } = await lobbyOfThree();
    const players = (await view(host, matchId)).players;
    expect(players.map((p) => [p.joinOrder, p.reportable])).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
    expect((await view(guest, matchId)).players[0]?.reportable).toBe(true);

    const first = await report(host, matchId, 1);
    expect(first.statusCode, first.body).toBe(201);
    expect(nameReportResponseSchema.parse(first.json()).name).toBe(guest.username);
    expect((await report(host, matchId, 1)).statusCode).toBe(201);
    expect(await openReportsAgainst(guest.userId)).toBe(1);

    expect(errorOf(await report(host, matchId, 0))).toMatchObject({
      status: 422,
      code: 'NOT_REPORTABLE',
    });
    expect(errorOf(await report(host, matchId, 2))).toMatchObject({ code: 'NOT_REPORTABLE' });
    expect(errorOf(await report(host, matchId, 7))).toMatchObject({ status: 400 });
    const outsider = await registered();
    expect(errorOf(await report(outsider, matchId, 1))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(await openReportsAgainst(guest.userId)).toBe(1);
  });

  it('gesperrter Name: Der Spieler gibt sich selbst einen neuen, bevor er weiterspielt', async () => {
    const { host, guest, matchId } = await lobbyOfThree();
    expect((await report(host, matchId, 1)).statusCode).toBe(201);

    const listed = (await listOpenNameReports(server.db)).find((r) => r.userId === guest.userId);
    expect(listed).toMatchObject({
      currentName: guest.username,
      reportedNames: [guest.username],
      reporters: 1,
      blocked: false,
    });

    const decided = await decideName(server.db, guest.username.toUpperCase(), 'BLOCK');
    expect(decided).toEqual({ blockedNames: [guest.username], mustRename: true, resolved: 1 });
    expect(await decideName(server.db, guest.username, 'BLOCK')).toBeNull();
    expect(await profileOf(guest)).toEqual({ displayName: guest.username, nameBlocked: true });

    // Keine neue Partie und kein Beitritt, bis ein neuer Name da ist
    const created = await guest.client.post('/matches', {
      headers: key(),
      payload: { kind: 'STANDARD', rules: 'PLAYTEST' },
    });
    expect(errorOf(created)).toMatchObject({ status: 409, code: 'NAME_BLOCKED' });
    const other = await registered();
    const otherMatch = await createMatch(other, { kind: 'STANDARD', rules: 'PLAYTEST' });
    const inviteCode = (await view(other, otherMatch)).match.inviteCode ?? '';
    expect(errorOf(await joinMatch(guest, inviteCode))).toMatchObject({ code: 'NAME_BLOCKED' });

    // Der Name ist für alle gesperrt
    expect(await nameStatus(other, guest.username)).toBe('BLOCKED');
    const taken = await other.client.patch('/me/profile', {
      headers: key(),
      payload: { username: guest.username },
    });
    expect(errorOf(taken)).toMatchObject({ status: 422, code: 'NAME_NOT_ALLOWED' });

    const renamed = freshUsername();
    const response = await guest.client.patch('/me/profile', {
      headers: key(),
      payload: { username: renamed },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(await profileOf(guest)).toEqual({ displayName: renamed, nameBlocked: false });
    expect(await nameStatus(guest, guest.username)).toBe('BLOCKED');
  });

  it('gibt einen Namen frei und findet das Konto auch unter einem früheren Namen', async () => {
    const { host, guest, matchId } = await lobbyOfThree();
    expect((await report(host, matchId, 1)).statusCode).toBe(201);
    const renamed = freshUsername();
    expect(
      (
        await guest.client.patch('/me/profile', {
          headers: key(),
          payload: { username: renamed },
        })
      ).statusCode,
    ).toBe(200);

    const listed = (await listOpenNameReports(server.db)).find((r) => r.userId === guest.userId);
    expect(listed).toMatchObject({ currentName: renamed, reportedNames: [guest.username] });

    const decided = await decideName(server.db, guest.username, 'DISMISS');
    expect(decided).toEqual({ blockedNames: [], mustRename: false, resolved: 1 });
    expect(await openReportsAgainst(guest.userId)).toBe(0);
    expect(await profileOf(guest)).toEqual({ displayName: renamed, nameBlocked: false });
    expect(await nameStatus(host, guest.username)).toBe('FREE');
  });

  it('sperren mit einem früheren Namen verlangt keinen neuen, wenn der jetzige nicht gemeldet ist', async () => {
    const { host, guest, matchId } = await lobbyOfThree();
    expect((await report(host, matchId, 1)).statusCode).toBe(201);
    const renamed = freshUsername();
    await guest.client.patch('/me/profile', { headers: key(), payload: { username: renamed } });

    const decided = await decideName(server.db, guest.username, 'BLOCK');
    expect(decided).toEqual({ blockedNames: [guest.username], mustRename: false, resolved: 1 });
    expect(await profileOf(guest)).toEqual({ displayName: renamed, nameBlocked: false });
    expect(await nameStatus(host, guest.username)).toBe('BLOCKED');
  });

  it('löscht Meldungen gegen ein gelöschtes Konto und behält die eines gelöschten Melders', async () => {
    const { host, guest, matchId } = await lobbyOfThree();
    const third = await registered();
    const inviteCode = (await view(host, matchId)).match.inviteCode ?? '';
    expect((await setBot(host, matchId, 2, null)).statusCode).toBe(200);
    expect((await joinMatch(third, inviteCode)).statusCode).toBe(200);
    expect((await report(host, matchId, 1)).statusCode).toBe(201);
    expect((await report(guest, matchId, 2)).statusCode).toBe(201);

    // Beide verlassen die Partie, damit die Löschung nicht wartet
    for (const human of [guest, third]) {
      const left = await human.client.post(`/matches/${matchId}/leave`, { headers: key() });
      expect(left.statusCode, left.body).toBe(200);
    }
    expect((await guest.client.delete('/me', { payload: { password: PASSWORD } })).statusCode).toBe(
      202,
    );
    await sql`update users set deletion_requested_at = game_now() - interval '8 days'
              where id = ${guest.userId}`.execute(server.db);
    await cleanupAccounts(server.db);
    expect(await userRow(guest.userId)).toBeUndefined();

    expect(await openReportsAgainst(guest.userId)).toBe(0);
    const kept = await server.db
      .selectFrom('name_reports')
      .select(['reporter_user_id', 'reported_name'])
      .where('reported_user_id', '=', third.userId)
      .execute();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.reporter_user_id).not.toBe(guest.userId);
    expect(kept[0]?.reported_name).toBe(third.username);
  });
});

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const CLI = fileURLToPath(new URL('../src/cli/account-name-reports.ts', import.meta.url));

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

describe('pnpm account:name-reports (Kommandozeile)', () => {
  it('listet offene Meldungen und gibt einen Namen frei', async () => {
    const host = await registered();
    const guest = await registered();
    const matchId = await createMatch(host, { kind: 'STANDARD', rules: 'PLAYTEST' });
    const inviteCode = (await view(host, matchId)).match.inviteCode ?? '';
    expect((await joinMatch(guest, inviteCode)).statusCode).toBe(200);
    const reported = await host.client.post(`/matches/${matchId}/players/1/report`, {
      headers: key(),
    });
    expect(reported.statusCode).toBe(201);

    const list = await runCli([]);
    expect(list.code, list.stderr).toBe(0);
    expect(list.stdout).toContain(`${guest.username}: gemeldet als ${guest.username}, 1 Spieler`);

    const production = await runCli([`--block=${guest.username}`], 'production');
    expect(production.code).toBe(2);
    expect(production.stderr).toMatch(/In Produktion nur die Liste/);

    for (const args of [['--block='], ['--sperren=x'], ['--block=a', '--dismiss=b']]) {
      const result = await runCli(args);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr).toMatch(/Ungültige Argumente/);
    }

    const dismissed = await runCli([`--dismiss=${guest.username}`]);
    expect(dismissed.code, dismissed.stderr).toBe(0);
    expect(dismissed.stdout).toContain('Freigegeben, 1 Meldung erledigt.');
    const none = await runCli([`--dismiss=${guest.username}`]);
    expect(none.code).toBe(1);
    expect(none.stderr).toMatch(/keine offene Meldung/);
  });
});
