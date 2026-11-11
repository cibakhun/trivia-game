import { randomUUID } from 'node:crypto';
import { advanceGameClock } from '@rdw/db/testing';
import {
  errorBodySchema,
  matchActionResponseSchema,
  matchAnswerResponseSchema,
  matchListResponseSchema,
  matchPresentResponseSchema,
  matchViewSchema,
  parseMatchEvent,
  type MatchCreateRequest,
  type MatchView,
} from '@rdw/protocol';
import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, matchContextFrom, runMatchDriverOnce } from '../src/index.ts';
import { createLobby } from '../src/modules/match/lobby.ts';
import { ApiError } from '../src/infra/errors.ts';
import {
  TestClient,
  importFixtureQuestions,
  startTestServer,
  testConfig,
  type TestServer,
} from './helpers.ts';

/**
 * Partie über die HTTP-Schnittstelle (TEST_PLAN §7, ADR-049): Aufstellung, Start, ganze Partien
 * mit Spieltestzeiten, Zeitablauf, Wiederanlauf nach einem Neustart und Schutz vor Vorabwissen.
 * Richtige Antworten liest der Test wie ein Prüfer aus der Datenbank.
 */

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
  expect(await importFixtureQuestions(server.db)).toBe(40);
  return () => server.close();
});

function driverContext() {
  return matchContextFrom(testConfig(server.database.url));
}

interface Human {
  readonly client: TestClient;
  readonly userId: string;
}

async function newHuman(app: FastifyInstance = server.app): Promise<Human> {
  const client = new TestClient(app);
  return { client, userId: await client.signUpGuest() };
}

function errorOf(response: { statusCode: number; json(): unknown }) {
  const { error } = errorBodySchema.parse(response.json());
  return { status: response.statusCode, code: error.code, details: error.details };
}

function key() {
  return { 'idempotency-key': randomUUID() };
}

async function createMatch(human: Human, body: MatchCreateRequest): Promise<string> {
  const response = await human.client.post('/matches', { headers: key(), payload: body });
  expect(response.statusCode, response.body).toBe(201);
  return matchActionResponseSchema.parse(response.json()).matchId;
}

async function view(human: Human, matchId: string, after = 0): Promise<MatchView> {
  const response = await human.client.get(`/matches/${matchId}?after=${after}`);
  expect(response.statusCode, response.body).toBe(200);
  return matchViewSchema.parse(response.json());
}

function joinMatch(human: Human, inviteCode: string) {
  return human.client.post('/matches/join', { headers: key(), payload: { inviteCode } });
}

function setBot(human: Human, matchId: string, joinOrder: number, strength: string | null) {
  return human.client.post(`/matches/${matchId}/seats/${joinOrder}/bot`, {
    headers: key(),
    payload: { strength },
  });
}

function startMatch(human: Human, matchId: string) {
  return human.client.post(`/matches/${matchId}/start`, { headers: key() });
}

function pick(human: Human, matchId: string, region: number) {
  return human.client.post(`/matches/${matchId}/pick`, { headers: key(), payload: { region } });
}

function present(human: Human, matchId: string, seq: number) {
  return human.client.post(`/matches/${matchId}/questions/${seq}/present`);
}

function answer(human: Human, matchId: string, seq: number, payload: object, idem = randomUUID()) {
  return human.client.post(`/matches/${matchId}/questions/${seq}/answer`, {
    headers: { 'idempotency-key': idem },
    payload,
  });
}

const presentationSchema = z.object({
  options: z.array(z.object({ token: z.string(), key: z.string() })).optional(),
});

/** Richtige (oder falsche) Antwort auf eine Frage der Partie, wie sie der Client schicken würde. */
async function answerPayload(matchId: string, seq: number, correct = true): Promise<object> {
  const question = await server.db
    .selectFrom('match_questions as q')
    .innerJoin('question_versions as v', 'v.id', 'q.version_id')
    .select(['q.kind', 'q.presentation', 'q.version_id', 'v.answer_value', 'v.input_min'])
    .where('q.match_id', '=', matchId)
    .where('q.seq', '=', seq)
    .executeTakeFirstOrThrow();
  if (question.kind === 'ESTIMATE') {
    const value = correct ? question.answer_value : question.input_min;
    if (value === null) throw new Error('Schätzwert fehlt');
    return { rawInput: value.replace('.', ','), locale: 'de', clientElapsedMs: 1200 };
  }
  const keys = await server.db
    .selectFrom('question_options')
    .select(['option_key', 'is_correct'])
    .where('version_id', '=', question.version_id)
    .execute();
  const wanted = new Set(keys.filter((k) => k.is_correct === correct).map((k) => k.option_key));
  const option = presentationSchema
    .parse(question.presentation)
    .options?.find((o) => wanted.has(o.key));
  if (!option) throw new Error('Option fehlt');
  return { optionToken: option.token, clientElapsedMs: 900 };
}

interface Seat {
  readonly human: Human;
  /** `ACTIVE` wählt die erste erlaubte Region und antwortet richtig; `IDLE` tut nichts. */
  readonly mode: 'ACTIVE' | 'IDLE';
}

/**
 * Spielt eine laufende Partie zu Ende: aktive Spieler wählen und antworten sofort; wartet die
 * Partie auf niemanden Aktiven, läuft die Spielzeit bis zur Frist und die Ablaufsteuerung weiter.
 */
async function playToEnd(matchId: string, seats: readonly Seat[]): Promise<MatchView> {
  const ctx = driverContext();
  const observer = seats[0]?.human;
  if (!observer) throw new Error('Keine Spieler');
  for (let i = 0; i < 1000; i++) {
    let acted = false;
    for (const { human, mode } of seats) {
      if (mode === 'IDLE') continue;
      const current = await view(human, matchId);
      if (current.match.status !== 'RUNNING') return current;
      if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) {
        const response = await pick(human, matchId, current.legalRegions[0] ?? -1);
        expect(response.statusCode, response.body).toBe(200);
        acted = true;
      } else if (
        current.phase?.kind === 'QUESTION' &&
        current.question?.myStatus === 'NOT_PRESENTED'
      ) {
        const { seq } = current.question;
        const presented = await present(human, matchId, seq);
        expect(presented.statusCode, presented.body).toBe(200);
        const answered = await answer(human, matchId, seq, await answerPayload(matchId, seq));
        expect(answered.statusCode, answered.body).toBe(200);
        acted = true;
      }
    }
    if (!acted) {
      const current = await view(observer, matchId);
      if (current.match.status !== 'RUNNING') return current;
      await advanceGameClock(server.database.pool, (current.phase?.remainingMs ?? 0) + 1);
      await runMatchDriverOnce(server.db, ctx);
    }
  }
  throw new Error('Partie endet nicht');
}

async function statistics(userId: string) {
  return server.db
    .selectFrom('player_statistics')
    .select(['matches_played', 'matches_won'])
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
}

/** Ereignisse, die nicht zum Schema des Clients passen (protocol `match-events.ts`). */
async function unreadableEvents(matchId: string): Promise<unknown[]> {
  const rows = await server.db
    .selectFrom('match_events')
    .select(['seq', 'type', 'payload', 'at'])
    .where('match_id', '=', matchId)
    .orderBy('seq')
    .execute();
  return rows.filter(
    (r) =>
      parseMatchEvent({
        seq: r.seq,
        type: r.type,
        payload: r.payload as Record<string, unknown>,
        at: r.at.toISOString(),
      }) === null,
  );
}

async function eventTypes(matchId: string): Promise<string[]> {
  const rows = await server.db
    .selectFrom('match_events')
    .select('type')
    .where('match_id', '=', matchId)
    .orderBy('seq')
    .execute();
  return rows.map((r) => r.type);
}

describe('Aufstellung', () => {
  it('Einladungscode, Beitritt, volle Partie, Gastgeberrechte und Verlassen', async () => {
    const host = await newHuman();
    const matchId = await createMatch(host, { kind: 'STANDARD', rules: 'PLAYTEST' });
    const lobby = await view(host, matchId);
    expect(lobby.match.status).toBe('LOBBY');
    expect(lobby.match.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(lobby.isHost).toBe(true);
    expect(lobby.board).toBeNull();
    expect(lobby.players).toEqual([
      expect.objectContaining({ joinOrder: 0, seat: null, isBot: false, isHost: true, isMe: true }),
    ]);
    const code = lobby.match.inviteCode ?? '';

    // Wer nicht dabei ist, sieht die Partie nicht
    const stranger = await newHuman();
    const hidden = await stranger.client.get(`/matches/${matchId}`);
    expect(errorOf(hidden)).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(errorOf(await joinMatch(stranger, 'ZZZZZ2'))).toMatchObject({
      status: 404,
      code: 'INVITE_CODE_UNKNOWN',
    });

    // Nur der Gastgeber startet, und erst mit zwei Spielern
    expect(errorOf(await startMatch(host, matchId))).toMatchObject({
      status: 409,
      code: 'NOT_ENOUGH_PLAYERS',
    });
    const second = await newHuman();
    const joined = await joinMatch(second, ` ${code.toLowerCase()} `);
    expect(joined.statusCode, joined.body).toBe(200);
    expect((await joinMatch(second, code)).statusCode).toBe(200); // zweimal: keine Wirkung
    expect(errorOf(await startMatch(second, matchId))).toMatchObject({
      status: 403,
      code: 'NOT_HOST',
    });
    // Wer in einer offenen Partie ist, legt keine zweite an
    const again = await second.client.post('/matches', {
      headers: key(),
      payload: { kind: 'STANDARD' },
    });
    expect(errorOf(again)).toMatchObject({ status: 409, code: 'ALREADY_IN_MATCH' });

    const third = await newHuman();
    expect((await joinMatch(third, code)).statusCode).toBe(200);
    const fourth = await newHuman();
    expect(errorOf(await joinMatch(fourth, code))).toMatchObject({
      status: 409,
      code: 'MATCH_FULL',
    });
    // Verlassen gibt den Platz frei
    const left = await third.client.post(`/matches/${matchId}/leave`, { headers: key() });
    expect(left.statusCode, left.body).toBe(200);
    expect((await joinMatch(fourth, code)).statusCode).toBe(200);
    expect((await view(host, matchId)).players.map((p) => p.joinOrder)).toEqual([0, 1, 2]);

    const list = matchListResponseSchema.parse((await host.client.get('/matches')).json());
    expect(list.testMatchesEnabled).toBe(true);
    expect(list.matches[0]).toMatchObject({ id: matchId, status: 'LOBBY', players: 3 });

    // Verlässt der Gastgeber die Aufstellung, fällt sie aus; danach ist der Code frei
    const hostLeft = await host.client.post(`/matches/${matchId}/leave`, { headers: key() });
    expect(hostLeft.statusCode, hostLeft.body).toBe(200);
    const closed = await view(second, matchId);
    expect(closed.match).toMatchObject({ status: 'ABANDONED', inviteCode: null });
    expect(closed.events.at(-1)).toMatchObject({
      type: 'MATCH_ABANDONED',
      payload: { reason: 'HOST_LEFT' },
    });
    expect(errorOf(await joinMatch(stranger, code))).toMatchObject({
      code: 'INVITE_CODE_UNKNOWN',
    });
  });

  it('Testpartien gibt es in Produktion nicht', async () => {
    const human = await newHuman();
    const ctx = { ...driverContext(), testMatchesEnabled: false };
    const attempt = server.db.transaction().execute((tx) =>
      createLobby(tx, ctx, {
        userId: human.userId,
        request: { kind: 'TEST', seats: 2, botStrengths: ['EASY'] },
      }),
    );
    await expect(attempt).rejects.toSatisfy(
      (error) => error instanceof ApiError && error.code === 'TEST_MATCHES_DISABLED',
    );
  });

  it('prüft die Anfrage: Bots je freiem Platz', async () => {
    const human = await newHuman();
    const response = await human.client.post('/matches', {
      headers: key(),
      payload: { kind: 'TEST', seats: 3, botStrengths: ['EASY'] },
    });
    expect(errorOf(response)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });
});

describe('Testpartie mit Bots', () => {
  it('läuft mit Spieltestzeiten zu Ende, ohne Vorabwissen und ohne Statistik', async () => {
    const human = await newHuman();
    const matchId = await createMatch(human, {
      kind: 'TEST',
      rules: 'PLAYTEST',
      seats: 3,
      botStrengths: ['EASY', 'HARD'],
    });
    const started = await startMatch(human, matchId);
    expect(started.statusCode, started.body).toBe(200);
    // Wiederholung mit demselben Schlüssel: gespeicherte Antwort
    const startedView = await view(human, matchId);
    expect(startedView.match.status).toBe('RUNNING');
    expect(startedView.players.map((p) => p.seat).sort()).toEqual([0, 1, 2]);
    expect(startedView.players.filter((p) => p.isBot).map((p) => p.botStrength)).toEqual([
      'EASY',
      'HARD',
    ]);
    expect(startedView.players.find((p) => p.isBot)?.name).toMatch(/^Bot \(/);
    expect(startedView.board?.seats).toHaveLength(3);
    expect(startedView.match.timers).toMatchObject({ triviaMs: 8000, revealMs: 2000 });

    // Bis zur ersten Frage spielen (Hauptstädte)
    let current = startedView;
    for (let i = 0; i < 10 && current.phase?.kind === 'PICK'; i++) {
      if (current.legalRegions.length > 0) {
        expect(current.board?.step.chooser).toBe(current.mySeat);
        const picked = await pick(human, matchId, current.legalRegions[0] ?? -1);
        expect(picked.statusCode, picked.body).toBe(200);
      } else {
        // Ein anderer Sitz ist dran: das kann hier nur ein Bot sein, und der wählt sofort
        throw new Error('Mensch wartet auf einen Bot');
      }
      current = await view(human, matchId);
    }
    expect(current.phase?.kind).toBe('QUESTION');
    expect(current.question).toMatchObject({
      seq: 1,
      kind: 'ESTIMATE',
      purpose: 'LAND',
      myStatus: 'NOT_PRESENTED',
      resolved: false,
    });
    expect(current.question?.seats.sort()).toEqual([0, 1, 2]);
    // Bot-Antworten stehen fest, bevor ein Mensch die Frage sieht
    const sealed = await server.db
      .selectFrom('match_answers')
      .select(['seat', 'status'])
      .where('match_id', '=', matchId)
      .where('seq', '=', 1)
      .execute();
    expect(sealed.map((a) => a.status)).toEqual(['GENERATED', 'GENERATED']);

    // Frage abholen: Inhalt ohne Lösung; die Ansicht verrät nichts über Antworten
    const presented = await present(human, matchId, 1);
    expect(presented.statusCode, presented.body).toBe(200);
    expect(presented.body).not.toMatch(/correct|answerValue|answer_value|"key"/i);
    const question = matchPresentResponseSchema.parse(presented.json()).question;
    expect(question.kind).toBe('ESTIMATE');
    expect(question.remainingMs).toBeGreaterThan(9000);
    const waiting = await human.client.get(`/matches/${matchId}`);
    expect(waiting.body).not.toMatch(/QUESTION_RESOLVED|GENERATED|isCorrect|distance/);
    expect(matchViewSchema.parse(waiting.json()).question?.myStatus).toBe('PRESENTED');
    // Erneutes Abholen: dieselbe Frage, gleiche Frist
    const reloaded = matchPresentResponseSchema.parse(
      (await present(human, matchId, 1)).json(),
    ).question;
    expect(reloaded.presentedAt).toBe(question.presentedAt);

    // Antworten; Wiederholung mit demselben Schlüssel ist wirkungslos, anderer Inhalt ein Fehler
    const idem = randomUUID();
    const payload = await answerPayload(matchId, 1);
    const answered = await answer(human, matchId, 1, payload, idem);
    expect(answered.statusCode, answered.body).toBe(200);
    expect(answered.body).not.toMatch(/correct|distance/i);
    expect(matchAnswerResponseSchema.parse(answered.json()).status).toBe('ANSWERED');
    expect((await answer(human, matchId, 1, payload, idem)).statusCode).toBe(200);
    expect(
      errorOf(await answer(human, matchId, 1, await answerPayload(matchId, 1, false), idem)),
    ).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });

    // Alle Menschen haben geantwortet: sofort aufgelöst, für alle sichtbar
    const revealed = await view(human, matchId);
    expect(revealed.phase?.kind).toBe('REVEAL');
    expect(revealed.question).toMatchObject({ seq: 1, resolved: true, myStatus: 'ANSWERED' });
    const resolution = revealed.events.find((e) => e.type === 'QUESTION_RESOLVED');
    const resolved = z
      .object({
        seq: z.literal(1),
        kind: z.literal('ESTIMATE'),
        prompt: z.string().min(1),
        solution: z.object({ value: z.string() }),
      })
      .safeParse(resolution?.payload);
    expect(resolved.success, JSON.stringify(resolution?.payload)).toBe(true);
    expect(resolution?.payload.answers).toHaveLength(3);
    // Ereignisse lassen sich ab einer Nummer abholen
    const tail = await view(human, matchId, revealed.lastEventSeq - 1);
    expect(tail.events.map((e) => e.seq)).toEqual([revealed.lastEventSeq]);

    const final = await playToEnd(matchId, [{ human, mode: 'ACTIVE' }]);
    expect(final.match.status).toBe('FINISHED');
    expect(final.phase).toBeNull();
    expect(final.board?.step.kind).toBe('FINISHED');
    const types = await eventTypes(matchId);
    expect(types[0]).toBe('MATCH_CREATED');
    expect(types).toContain('MATCH_STARTED');
    expect(types.at(-1)).toBe('MATCH_FINISHED');
    expect(await unreadableEvents(matchId)).toEqual([]);

    // Jede Frage ist aufgelöst und hat je Sitz genau eine Antwortzeile
    const questions = await server.db
      .selectFrom('match_questions')
      .select(['seq', 'seats', 'resolved_at'])
      .where('match_id', '=', matchId)
      .execute();
    expect(questions.length).toBe(final.board?.questions);
    expect(questions.every((q) => q.resolved_at !== null)).toBe(true);
    const answers = await server.db
      .selectFrom('match_answers')
      .select(['seq', 'seat', 'status'])
      .where('match_id', '=', matchId)
      .execute();
    expect(answers.length).toBe(questions.reduce((n, q) => n + q.seats.length, 0));
    const humanSeat = final.mySeat;
    for (const a of answers) {
      expect(a.status).toBe(a.seat === humanSeat ? 'ANSWERED' : 'GENERATED');
    }
    // Testpartien zählen nicht
    expect(await statistics(human.userId)).toEqual({ matches_played: 0, matches_won: 0 });
    // Nach dem Ende ist das Konto frei für die nächste Partie
    await createMatch(human, { kind: 'STANDARD' });
  });
});

describe('Partie zu zweit', () => {
  it('Zeitablauf: der Server wählt und löst auf; Statistik zählt', async () => {
    const active = await newHuman();
    const idle = await newHuman();
    const matchId = await createMatch(active, { kind: 'STANDARD', rules: 'PLAYTEST' });
    const code = (await view(active, matchId)).match.inviteCode ?? '';
    expect((await joinMatch(idle, code)).statusCode).toBe(200);
    const started = await startMatch(active, matchId);
    expect(started.statusCode, started.body).toBe(200);
    const begun = await view(active, matchId);
    expect(begun.match.seats).toBe(2);
    // Zu zweit wird auf der Kernmark gespielt (ADR-052)
    expect(begun.board?.map).toBe('KERNMARK');
    expect(begun.board?.regions).toHaveLength(16);
    expect(begun.board?.turns).toEqual([
      { seat: 0, status: 'NOW' },
      { seat: 1, status: 'NEXT' },
    ]);

    // Nicht dran: keine Wahl möglich
    const first = await view(idle, matchId);
    const notMine = first.board?.step.chooser === first.mySeat ? active : idle;
    expect(errorOf(await pick(notMine, matchId, 0))).toMatchObject({ code: 'NOT_YOUR_TURN' });

    const final = await playToEnd(matchId, [
      { human: active, mode: 'ACTIVE' },
      { human: idle, mode: 'IDLE' },
    ]);
    expect(final.match.status).toBe('FINISHED');
    const types = await eventTypes(matchId);
    expect(types).toContain('AUTO_PICKED');
    expect(await unreadableEvents(matchId)).toEqual([]);
    // Wer nie abholt, bekommt bei der Auflösung eine verpasste Antwort ohne Präsentation
    const idleSeat = (await view(idle, matchId)).mySeat;
    const missed = await server.db
      .selectFrom('match_answers')
      .select(['status', 'presented_at'])
      .where('match_id', '=', matchId)
      .where('seat', '=', idleSeat ?? -1)
      .execute();
    expect(missed.length).toBeGreaterThan(0);
    expect(missed.every((a) => a.status === 'MISSED' && a.presented_at === null)).toBe(true);
    const standings = final.events.find((e) => e.type === 'MATCH_FINISHED')?.payload.standings as {
      seat: number;
      place: number;
    }[];
    const winner = standings.find((s) => s.place === 1)?.seat;
    expect(winner).toBe(final.mySeat);
    expect(await statistics(active.userId)).toEqual({ matches_played: 1, matches_won: 1 });
    expect(await statistics(idle.userId)).toEqual({ matches_played: 1, matches_won: 0 });
  });
});

describe('Bots in der normalen Partie (ADR-052)', () => {
  it('der Gastgeber setzt, ändert und entfernt Bots; nur auf freie Plätze, nur er, nur vor dem Start', async () => {
    const host = await newHuman();
    const matchId = await createMatch(host, { kind: 'STANDARD', rules: 'PLAYTEST' });
    const code = (await view(host, matchId)).match.inviteCode ?? '';

    const added = await setBot(host, matchId, 1, 'EASY');
    expect(added.statusCode, added.body).toBe(200);
    let lobby = await view(host, matchId);
    expect(lobby.players).toEqual([
      expect.objectContaining({ joinOrder: 0, isBot: false, isHost: true }),
      expect.objectContaining({
        joinOrder: 1,
        seat: null,
        isBot: true,
        botStrength: 'EASY',
        name: 'Bot (leicht)',
        isHost: false,
        isMe: false,
      }),
    ]);
    expect(lobby.events.at(-1)).toMatchObject({
      type: 'PLAYER_JOINED',
      payload: { joinOrder: 1, bot: 'EASY' },
    });

    // Stärke ändern; dieselbe Stärke noch einmal bleibt ohne Wirkung
    expect((await setBot(host, matchId, 1, 'HARD')).statusCode).toBe(200);
    const before = (await view(host, matchId)).lastEventSeq;
    expect((await setBot(host, matchId, 1, 'HARD')).statusCode).toBe(200);
    lobby = await view(host, matchId);
    expect(lobby.lastEventSeq).toBe(before);
    expect(lobby.players[1]).toMatchObject({ botStrength: 'HARD', name: 'Bot (schwer)' });

    // Zwei gleich starke Bots bekommen Nummern
    expect((await setBot(host, matchId, 2, 'HARD')).statusCode).toBe(200);
    lobby = await view(host, matchId);
    expect(lobby.players.map((p) => p.name).slice(1)).toEqual(['Bot 1 (schwer)', 'Bot 2 (schwer)']);
    const list = matchListResponseSchema.parse((await host.client.get('/matches')).json());
    expect(list.matches[0]).toMatchObject({ id: matchId, players: 3 });

    // Den eigenen Platz, unbekannte Plätze und unbekannte Stärken gibt es nicht
    expect(errorOf(await setBot(host, matchId, 0, 'EASY'))).toMatchObject({
      status: 409,
      code: 'SEAT_NOT_AVAILABLE',
    });
    expect(errorOf(await setBot(host, matchId, 3, 'EASY'))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(errorOf(await setBot(host, matchId, 1, 'GOTT'))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });

    // Menschen gehen vor: Ist kein Platz frei, macht der zuletzt gesetzte Bot Platz
    const friend = await newHuman();
    expect((await joinMatch(friend, code)).statusCode).toBe(200);
    lobby = await view(host, matchId);
    expect(lobby.players.map((p) => [p.joinOrder, p.isBot])).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
    expect(lobby.events.slice(-2).map((e) => [e.type, e.payload])).toEqual([
      ['PLAYER_LEFT', { joinOrder: 2, bot: 'HARD' }],
      ['PLAYER_JOINED', { joinOrder: 2 }],
    ]);
    // Mitspieler setzen keine Bots, und der Platz eines Menschen bleibt seiner
    expect(errorOf(await setBot(friend, matchId, 1, null))).toMatchObject({
      status: 403,
      code: 'NOT_HOST',
    });
    expect(errorOf(await setBot(host, matchId, 2, 'EASY'))).toMatchObject({
      status: 409,
      code: 'SEAT_NOT_AVAILABLE',
    });
    // Fremde sehen die Partie nicht
    const stranger = await newHuman();
    expect(errorOf(await setBot(stranger, matchId, 1, null))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });

    // Entfernen macht den Platz frei; ein freier Platz bleibt frei
    expect((await setBot(host, matchId, 1, null)).statusCode).toBe(200);
    expect((await setBot(host, matchId, 1, null)).statusCode).toBe(200);
    lobby = await view(host, matchId);
    expect(lobby.players.map((p) => p.joinOrder)).toEqual([0, 2]);
    expect(lobby.events.at(-1)).toMatchObject({
      type: 'PLAYER_LEFT',
      payload: { joinOrder: 1, bot: 'HARD' },
    });
    expect(await unreadableEvents(matchId)).toEqual([]);

    // Nach dem Start ist die Aufstellung zu
    expect((await startMatch(host, matchId)).statusCode).toBe(200);
    expect(errorOf(await setBot(host, matchId, 1, 'EASY'))).toMatchObject({
      status: 409,
      code: 'MATCH_NOT_IN_LOBBY',
    });
  });

  it('in einer Testpartie füllen Bots die Plätze von selbst, auch nach einem Abgang in der Mitte', async () => {
    const host = await newHuman();
    const matchId = await createMatch(host, {
      kind: 'TEST',
      rules: 'PLAYTEST',
      seats: 3,
      botStrengths: ['EASY', 'HARD'],
    });
    expect(errorOf(await setBot(host, matchId, 1, 'MEDIUM'))).toMatchObject({
      status: 409,
      code: 'SEAT_NOT_AVAILABLE',
    });
    // Zwei treten bei, der mittlere geht wieder: Platz 1 ist frei, Platz 2 belegt
    const code = (await view(host, matchId)).match.inviteCode ?? '';
    const middle = await newHuman();
    const last = await newHuman();
    expect((await joinMatch(middle, code)).statusCode).toBe(200);
    expect((await joinMatch(last, code)).statusCode).toBe(200);
    const left = await middle.client.post(`/matches/${matchId}/leave`, { headers: key() });
    expect(left.statusCode, left.body).toBe(200);
    const started = await startMatch(host, matchId);
    expect(started.statusCode, started.body).toBe(200);
    const running = await view(host, matchId);
    expect(running.players.map((p) => [p.joinOrder, p.botStrength])).toEqual([
      [0, null],
      [1, 'EASY'],
      [2, null],
    ]);
  });

  it('allein mit einem Bot: Partie zu zweit auf der Kernmark, zählt nicht in der Statistik', async () => {
    const human = await newHuman();
    const matchId = await createMatch(human, { kind: 'STANDARD', rules: 'PLAYTEST' });
    expect(errorOf(await startMatch(human, matchId))).toMatchObject({
      status: 409,
      code: 'NOT_ENOUGH_PLAYERS',
    });
    expect((await setBot(human, matchId, 2, 'MEDIUM')).statusCode).toBe(200);
    const started = await startMatch(human, matchId);
    expect(started.statusCode, started.body).toBe(200);

    const running = await view(human, matchId);
    expect(running.match).toMatchObject({ kind: 'STANDARD', status: 'RUNNING', seats: 2 });
    expect(running.players.map((p) => p.seat).sort()).toEqual([0, 1]);
    expect(running.board?.map).toBe('KERNMARK');
    expect(running.board?.regions).toHaveLength(16);
    expect(running.board?.seats).toHaveLength(2);

    // Die Zugfolge nennt jeden Schritt der Runde; wer wählt, ist als Einziger dran
    let current = running;
    for (let i = 0; i < 40 && current.match.status === 'RUNNING'; i++) {
      const turns = current.board?.turns ?? [];
      expect(turns.length).toBeGreaterThan(0);
      if (current.phase?.kind === 'PICK') {
        expect(turns.filter((turn) => turn.status === 'NOW').map((turn) => turn.seat)).toEqual([
          current.board?.step.chooser,
        ]);
      }
      if (current.board?.step.kind === 'LAND_ESTIMATE') {
        expect(turns.map((turn) => turn.status)).toEqual(['NOW', 'NOW']);
      }
      if (current.board?.step.kind !== 'CAPITAL_PICK' && current.phase?.kind === 'PICK') break;
      if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) {
        expect((await pick(human, matchId, current.legalRegions[0] ?? -1)).statusCode).toBe(200);
      } else if (
        current.phase?.kind === 'QUESTION' &&
        current.question?.myStatus === 'NOT_PRESENTED'
      ) {
        const { seq } = current.question;
        expect((await present(human, matchId, seq)).statusCode).toBe(200);
        const sent = await answer(human, matchId, seq, await answerPayload(matchId, seq));
        expect(sent.statusCode, sent.body).toBe(200);
      } else {
        await advanceGameClock(server.database.pool, (current.phase?.remainingMs ?? 0) + 1);
        await runMatchDriverOnce(server.db, driverContext());
      }
      current = await view(human, matchId);
    }
    // Erste Wahl der Landnahme: Der Bessere wählt zweimal, dann der andere einmal. Liegt der Bot
    // vorn, hat er schon gewählt, bevor der Mensch die Karte wieder sieht.
    expect(current.board?.step).toMatchObject({ kind: 'LAND_PICK', round: 1 });
    const me = current.mySeat ?? -1;
    if (current.board?.turns[0]?.seat === me) {
      expect(current.board.turns).toEqual([
        { seat: me, status: 'NOW' },
        { seat: me, status: 'NEXT' },
        { seat: 1 - me, status: 'NEXT' },
      ]);
      expect((await pick(human, matchId, current.legalRegions[0] ?? -1)).statusCode).toBe(200);
      current = await view(human, matchId);
      expect(current.board?.turns).toEqual([
        { seat: me, status: 'DONE' },
        { seat: me, status: 'NOW' },
        { seat: 1 - me, status: 'NEXT' },
      ]);
    } else {
      expect(current.board?.turns).toEqual([
        { seat: 1 - me, status: 'DONE' },
        { seat: 1 - me, status: 'DONE' },
        { seat: me, status: 'NOW' },
      ]);
    }

    const final = await playToEnd(matchId, [{ human, mode: 'ACTIVE' }]);
    expect(final.match.status).toBe('FINISHED');
    expect(final.board?.turns).toEqual([]);
    const types = await eventTypes(matchId);
    // 14 freie Regionen: vier volle Landnahmerunden und eine fünfte mit den letzten beiden
    expect(types.filter((t) => t === 'LAND_RANKED')).toHaveLength(5);
    expect(types.filter((t) => t === 'REGION_CLAIMED')).toHaveLength(14);
    expect(await unreadableEvents(matchId)).toEqual([]);
    // Mit Bots zählt die Partie nicht [E]
    expect(await statistics(human.userId)).toEqual({ matches_played: 0, matches_won: 0 });
  });

  it('zu dritt mit einem Menschen und zwei Bots: die ganze Wendelmark', async () => {
    const human = await newHuman();
    const matchId = await createMatch(human, { kind: 'STANDARD', rules: 'PLAYTEST' });
    expect((await setBot(human, matchId, 1, 'EASY')).statusCode).toBe(200);
    expect((await setBot(human, matchId, 2, 'HARD')).statusCode).toBe(200);
    expect((await startMatch(human, matchId)).statusCode).toBe(200);
    const running = await view(human, matchId);
    expect(running.match.seats).toBe(3);
    expect(running.board?.map).toBe('WENDELMARK');
    expect(running.board?.regions).toHaveLength(24);
    expect(running.board?.turns).toHaveLength(3);
  });
});

describe('Wiederanlauf', () => {
  it('eine neue Serverinstanz macht mitten in der Frage weiter', async () => {
    const human = await newHuman();
    const matchId = await createMatch(human, {
      kind: 'TEST',
      rules: 'PLAYTEST',
      seats: 2,
      botStrengths: ['MEDIUM'],
    });
    expect((await startMatch(human, matchId)).statusCode).toBe(200);
    let current = await view(human, matchId);
    while (current.phase?.kind === 'PICK') {
      expect((await pick(human, matchId, current.legalRegions[0] ?? -1)).statusCode).toBe(200);
      current = await view(human, matchId);
    }
    expect(current.question).toMatchObject({ seq: 1, myStatus: 'NOT_PRESENTED' });
    expect((await present(human, matchId, 1)).statusCode).toBe(200);

    // „Neustart“: neue Anwendung auf derselben Datenbank, ohne Zustand im Speicher
    const restarted = await buildApp({
      db: server.db,
      config: testConfig(server.database.url),
      logger: false,
    });
    try {
      const again: Human = { client: new TestClient(restarted), userId: human.userId };
      for (const [name, value] of human.client.cookies) again.client.cookies.set(name, value);
      const answered = await answer(again, matchId, 1, await answerPayload(matchId, 1));
      expect(answered.statusCode, answered.body).toBe(200);
      current = await view(again, matchId);
      expect(current.question).toMatchObject({ seq: 1, resolved: true });

      // Nächste Frage dieses Menschen abholen, dann die eigene Frist verstreichen lassen
      for (let i = 0; i < 50; i++) {
        if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) {
          await pick(again, matchId, current.legalRegions[0] ?? -1);
        } else if (
          current.phase?.kind === 'QUESTION' &&
          current.question?.myStatus === 'NOT_PRESENTED'
        ) {
          break;
        } else {
          await advanceGameClock(server.database.pool, (current.phase?.remainingMs ?? 0) + 1);
          await runMatchDriverOnce(server.db, driverContext());
        }
        current = await view(again, matchId);
      }
      const seq = current.question?.seq ?? 0;
      expect(seq).toBeGreaterThan(1);
      const presented = matchPresentResponseSchema.parse(
        (await present(again, matchId, seq)).json(),
      ).question;
      await advanceGameClock(server.database.pool, presented.remainingMs + 10);
      // Zu spät: die eigene Frist ist um, aufgelöst ist noch nicht
      expect(
        errorOf(await answer(again, matchId, seq, await answerPayload(matchId, seq))),
      ).toMatchObject({ status: 409, code: 'STEP_EXPIRED' });
      // Die Ablaufsteuerung (hier ein Lauf ohne laufende Anwendung) löst nach `closes_at` auf
      await advanceGameClock(server.database.pool, 5_000);
      const { advanced } = await runMatchDriverOnce(server.db, driverContext());
      expect(advanced).toBeGreaterThanOrEqual(1);
      const row = await server.db
        .selectFrom('match_answers')
        .select(['status', 'presented_at'])
        .where('match_id', '=', matchId)
        .where('seq', '=', seq)
        .where('seat', '=', current.mySeat ?? -1)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('MISSED');
      expect(row.presented_at).not.toBeNull();
      const after = await view(again, matchId);
      expect(after.question).toMatchObject({ seq, resolved: true, myStatus: 'MISSED' });
      expect(after.match.status).toBe('RUNNING');
    } finally {
      await restarted.close();
    }
  });
});

describe('Gleichzeitigkeit und Verfall', () => {
  it('gleichzeitige Antworten beider Menschen lösen die Frage genau einmal auf', async () => {
    const a = await newHuman();
    const b = await newHuman();
    const matchId = await createMatch(a, { kind: 'STANDARD', rules: 'PLAYTEST' });
    const code = (await view(a, matchId)).match.inviteCode ?? '';
    expect((await joinMatch(b, code)).statusCode).toBe(200);
    expect((await startMatch(a, matchId)).statusCode).toBe(200);
    // Hauptstädte: wer dran ist, wählt
    for (let i = 0; i < 4; i++) {
      for (const human of [a, b]) {
        const current = await view(human, matchId);
        if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) {
          expect((await pick(human, matchId, current.legalRegions[0] ?? -1)).statusCode).toBe(200);
        }
      }
    }
    expect((await view(a, matchId)).question).toMatchObject({ seq: 1, myStatus: 'NOT_PRESENTED' });
    await Promise.all([present(a, matchId, 1), present(b, matchId, 1)]);
    const payload = await answerPayload(matchId, 1);
    const [first, second] = await Promise.all([
      answer(a, matchId, 1, payload),
      answer(b, matchId, 1, payload),
    ]);
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    const types = await eventTypes(matchId);
    expect(types.filter((t) => t === 'QUESTION_RESOLVED')).toHaveLength(1);
    expect((await view(b, matchId)).phase?.kind).toBe('REVEAL');
    // Abgegebene Antworten und Ereignisse lassen sich nicht ändern (DATA_MODEL I11)
    await expect(
      server.db
        .updateTable('match_answers')
        .set({ is_correct: false })
        .where('match_id', '=', matchId)
        .execute(),
    ).rejects.toThrow(/unveränderlich/);
    await expect(
      server.db.deleteFrom('match_events').where('match_id', '=', matchId).execute(),
    ).rejects.toThrow();
  });

  it('eine nicht gestartete Aufstellung verfällt nach zwei Stunden', async () => {
    const host = await newHuman();
    const matchId = await createMatch(host, { kind: 'STANDARD' });
    await advanceGameClock(server.database.pool, 2 * 60 * 60 * 1000 + 1000);
    const { expiredLobbies } = await runMatchDriverOnce(server.db, driverContext());
    expect(expiredLobbies).toBeGreaterThanOrEqual(1);
    const expired = await view(host, matchId);
    expect(expired.match.status).toBe('ABANDONED');
    expect(expired.events.at(-1)?.payload).toEqual({ reason: 'LOBBY_EXPIRED' });
    // Danach ist das Konto frei
    await createMatch(host, { kind: 'STANDARD' });
  });
});
