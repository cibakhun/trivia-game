import { randomUUID } from 'node:crypto';
import { advanceGameClock } from '@rdw/db/testing';
import {
  matchAnswerResponseSchema,
  matchListResponseSchema,
  matchPresentResponseSchema,
  matchViewSchema,
  matchWatchResponseSchema,
  type MatchView,
} from '@rdw/protocol';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, runMatchDriverOnce } from '../src/index.ts';
import { createLobby } from '../src/modules/match/lobby.ts';
import { botThinkMs } from '../src/modules/match/bot-think.ts';
import { ApiError } from '../src/infra/errors.ts';
import {
  TestClient,
  importFixtureQuestions,
  startTestServer,
  testConfig,
  type TestServer,
} from './helpers.ts';
import { matchKit, type Human } from './match-kit.ts';

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

const {
  driverContext,
  newHuman,
  errorOf,
  key,
  createMatch,
  view,
  joinMatch,
  setBot,
  startMatch,
  pick,
  present,
  answer,
  answerPayload,
  unreadableEvents,
  eventTypes,
} = matchKit(() => server);

interface Seat {
  readonly human: Human;
  /** `ACTIVE` wählt die erste erlaubte Region und antwortet richtig; `IDLE` tut nichts. */
  readonly mode: 'ACTIVE' | 'IDLE';
}

/**
 * Spielt eine laufende Partie zu Ende: aktive Spieler wählen und antworten sofort; wartet die
 * Partie auf niemanden Aktiven, läuft die Spielzeit bis zur Frist und die Ablaufsteuerung weiter.
 */
async function playToEnd(
  matchId: string,
  seats: readonly Seat[],
  /** Hält früher an, sobald der erste Spieler diesen Stand sieht. */
  until: (current: MatchView) => boolean = () => false,
): Promise<MatchView> {
  const ctx = driverContext();
  const observer = seats[0]?.human;
  if (!observer) throw new Error('Keine Spieler');
  for (let i = 0; i < 1000; i++) {
    let acted = false;
    for (const { human, mode } of seats) {
      if (mode === 'IDLE') continue;
      const current = await view(human, matchId);
      if (current.match.status !== 'RUNNING' || until(current)) return current;
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
      if (current.match.status !== 'RUNNING' || until(current)) return current;
      await advanceGameClock(server.database.pool, (current.phase?.remainingMs ?? 0) + 1);
      await runMatchDriverOnce(server.db, ctx);
    }
  }
  throw new Error('Partie endet nicht');
}

/** Lässt Ansagen (ADR-053) ablaufen, bis wieder eine Wahl, eine Frage oder das Ende ansteht. */
async function pastAnnounce(human: Human, matchId: string): Promise<MatchView> {
  const ctx = driverContext();
  for (let i = 0; i < 50; i++) {
    const current = await view(human, matchId);
    if (current.phase?.kind !== 'ANNOUNCE') return current;
    await advanceGameClock(server.database.pool, current.phase.remainingMs + 1);
    await runMatchDriverOnce(server.db, ctx);
  }
  throw new Error('Ansage endet nicht');
}

async function statistics(userId: string) {
  return server.db
    .selectFrom('player_statistics')
    .select(['matches_played', 'matches_won'])
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
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
    expect(startedView.match.timers).toMatchObject({
      triviaMs: 8000,
      revealMs: 2000,
      announceMs: 600,
      pickShowMs: 300,
    });

    // Bis zur ersten Frage spielen (Hauptstädte); die Wahl der Bots bleibt jeweils kurz stehen
    let current = await pastAnnounce(human, matchId);
    for (let i = 0; i < 10 && current.phase?.kind === 'PICK'; i++) {
      // Ein Bot wählt sofort: Steht eine Wahl an, dann die des Menschen
      expect(current.legalRegions.length).toBeGreaterThan(0);
      expect(current.board?.step.chooser).toBe(current.mySeat);
      const picked = await pick(human, matchId, current.legalRegions[0] ?? -1);
      expect(picked.statusCode, picked.body).toBe(200);
      current = await pastAnnounce(human, matchId);
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

describe('Wer schon geantwortet hat (API.md §2.6)', () => {
  const sealedBots = (matchId: string, seq: number) =>
    server.db
      .selectFrom('match_answers')
      .select(['seat', 'status', 'effective_ms'])
      .where('match_id', '=', matchId)
      .where('seq', '=', seq)
      .where('status', '=', 'GENERATED')
      .orderBy('seat')
      .execute();

  it('Schätzfrage: Bots erscheinen nach ihrer Schätzzeit, der Mensch mit seiner Antwort', async () => {
    const human = await newHuman();
    const matchId = await createMatch(human, {
      kind: 'TEST',
      rules: 'PLAYTEST',
      seats: 3,
      botStrengths: ['EASY', 'HARD'],
    });
    expect((await startMatch(human, matchId)).statusCode).toBe(200);
    const opened = await playToEnd(
      matchId,
      [{ human, mode: 'ACTIVE' }],
      (current) => current.phase?.kind === 'QUESTION',
    );
    const mySeat = opened.mySeat ?? -1;
    expect(opened.question).toMatchObject({ seq: 1, kind: 'ESTIMATE', resolved: false });
    // Eben geöffnet: Noch hat niemand geantwortet, obwohl die Antworten der Bots schon feststehen
    expect(opened.question?.answered).toEqual([]);
    const bots = await sealedBots(matchId, 1);
    expect(bots).toHaveLength(2);
    const times = bots.map((bot) => bot.effective_ms ?? 0);
    expect(Math.min(...times)).toBeGreaterThan(0);
    expect(Math.max(...times)).toBeLessThan(opened.phase?.remainingMs ?? 0);

    // Abholen allein zählt nicht als Antwort
    expect((await present(human, matchId, 1)).statusCode).toBe(200);
    expect((await view(human, matchId)).question?.answered).toEqual([]);

    // Die Spielzeit läuft bis zur Schätzzeit des schnelleren Bots, dann bis zu der des anderen
    const [first, second] = [...bots].sort((a, b) => (a.effective_ms ?? 0) - (b.effective_ms ?? 0));
    await advanceGameClock(server.database.pool, first?.effective_ms ?? 0);
    const early = (await view(human, matchId)).question?.answered ?? [];
    expect(early).toContain(first?.seat);
    expect(early).not.toContain(mySeat);
    await advanceGameClock(
      server.database.pool,
      (second?.effective_ms ?? 0) - (first?.effective_ms ?? 0),
    );
    const both = await view(human, matchId);
    expect(both.question?.answered).toEqual(bots.map((bot) => bot.seat));
    expect(both.question?.resolved).toBe(false);
    // Die Liste sagt nur, dass geantwortet wurde: kein Wert, keine Zeit, keine Wertung
    const raw = (await human.client.get(`/matches/${matchId}`)).body;
    expect(raw).not.toMatch(/GENERATED|effective|distance|isCorrect/);

    // Mit der eigenen Antwort ist die Frage aufgelöst, alle stehen in der Liste
    const sent = await answer(human, matchId, 1, await answerPayload(matchId, 1));
    expect(sent.statusCode, sent.body).toBe(200);
    const done = await view(human, matchId);
    expect(done.question).toMatchObject({ seq: 1, resolved: true, answered: [0, 1, 2] });
  });

  it('Wissensfrage: Ein Bot gilt erst nach seiner Bedenkzeit als fertig', async () => {
    const human = await newHuman();
    const matchId = await createMatch(human, {
      kind: 'TEST',
      rules: 'PLAYTEST',
      seats: 3,
      botStrengths: ['MEDIUM', 'MEDIUM'],
    });
    expect((await startMatch(human, matchId)).statusCode).toBe(200);
    // Eine Frage an den Menschen: Eine nur an Bots endet mit deren Bedenkzeit (O-43)
    const opened = await playToEnd(
      matchId,
      [{ human, mode: 'ACTIVE' }],
      (current) =>
        current.phase?.kind === 'QUESTION' &&
        current.question?.kind === 'TRIVIA' &&
        current.question.myStatus !== 'NOT_PARTICIPATING',
    );
    const question = opened.question;
    if (!question) throw new Error('Keine Wissensfrage erreicht');
    expect(question.purpose).toBe('DUEL_TRIVIA');
    expect(question.answered).toEqual([]);
    const bots = await sealedBots(matchId, question.seq);
    expect(bots.length).toBeGreaterThan(0);
    // Die Antwort eines Bots auf eine Wissensfrage trägt keine Zeit
    expect(bots.every((bot) => bot.effective_ms === null)).toBe(true);
    const limit = opened.match.timers.triviaMs;
    const think = bots.map((bot) => ({
      seat: bot.seat,
      ms: botThinkMs(matchId, question.seq, bot.seat, limit),
    }));
    const slowest = Math.max(...think.map((bot) => bot.ms));
    expect(slowest).toBeLessThan(opened.phase?.remainingMs ?? 0);

    // Nach der halben Bedenkzeit des schnellsten Bots steht noch niemand da
    const fastest = Math.min(...think.map((bot) => bot.ms));
    const half = Math.floor(fastest / 2);
    await advanceGameClock(server.database.pool, half);
    expect((await view(human, matchId)).question?.answered).toEqual([]);
    await advanceGameClock(server.database.pool, slowest - half);
    const later = await view(human, matchId);
    expect(later.question?.seq).toBe(question.seq);
    expect(later.question?.answered).toEqual(bots.map((bot) => bot.seat));
    expect(later.question?.answered).not.toContain(opened.mySeat);
  });
});

describe('Zuschauer lesen die laufende Frage mit (ADR-065)', () => {
  /**
   * Zwei Menschen und ein Bot: Greift der Bot einen Menschen an, schaut der andere zu. Spielt, bis
   * ein Mensch einer offenen Frage zuschaut, und sieht vor jedem Zug bei beiden nach: Antwortete
   * der Gefragte zuerst, wäre die Frage schon aufgelöst.
   */
  async function playUntilWatching(matchId: string, humans: readonly [Human, Human]) {
    const ctx = driverContext();
    for (let i = 0; i < 1000; i++) {
      const views = [await view(humans[0], matchId), await view(humans[1], matchId)] as const;
      const w = views.findIndex(
        (v) =>
          v.phase?.kind === 'QUESTION' &&
          v.question?.myStatus === 'NOT_PARTICIPATING' &&
          !v.question.resolved,
      );
      const watching = views[w]?.question;
      if (watching) {
        const watcher = humans[w];
        const asked = humans[1 - w];
        if (!watcher || !asked) throw new Error('Sitz fehlt');
        return {
          watcher,
          asked,
          seq: watching.seq,
          seats: watching.seats,
          mySeat: views[w]?.mySeat,
        };
      }
      if (views[0].match.status !== 'RUNNING') throw new Error('Partie endet ohne Zuschauer');
      let acted = false;
      for (const human of humans) {
        const current = await view(human, matchId);
        if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) {
          const response = await pick(human, matchId, current.legalRegions[0] ?? -1);
          expect(response.statusCode, response.body).toBe(200);
          acted = true;
        } else if (
          current.phase?.kind === 'QUESTION' &&
          current.question?.myStatus === 'NOT_PRESENTED'
        ) {
          const { seq } = current.question;
          expect((await present(human, matchId, seq)).statusCode).toBe(200);
          const answered = await answer(human, matchId, seq, await answerPayload(matchId, seq));
          expect(answered.statusCode, answered.body).toBe(200);
          acted = true;
        }
      }
      if (!acted) {
        const current = await view(humans[0], matchId);
        await advanceGameClock(server.database.pool, (current.phase?.remainingMs ?? 0) + 1);
        await runMatchDriverOnce(server.db, ctx);
      }
    }
    throw new Error('Niemand schaut zu');
  }

  it('Frage und Antworten für alle, die nicht gefragt sind; nie die Lösung, nie eine Wahl, keine Spur', async () => {
    const a = await newHuman();
    const b = await newHuman();
    const matchId = await createMatch(a, { kind: 'STANDARD', rules: 'PLAYTEST' });
    const code = (await view(a, matchId)).match.inviteCode ?? '';
    expect((await joinMatch(b, code)).statusCode).toBe(200);
    expect((await setBot(a, matchId, 2, 'MEDIUM')).statusCode).toBe(200);
    expect((await startMatch(a, matchId)).statusCode).toBe(200);
    // Die erste Frage geht an alle: Wer gefragt ist, liest nicht mit, und seine Zeit läuft nicht an
    const first = await pastAnnounceUntilQuestion(a, b, matchId);
    const early = await a.client.get(`/matches/${matchId}/questions/${first}/watch`);
    expect(errorOf(early)).toMatchObject({ status: 409, code: 'STEP_NOT_AVAILABLE' });
    expect((await view(a, matchId)).question?.myStatus).toBe('NOT_PRESENTED');

    const { watcher, asked, seq, seats, mySeat } = await playUntilWatching(matchId, [a, b]);
    const url = `/matches/${matchId}/questions/${seq}/watch`;
    expect(seats).toHaveLength(2);
    expect(seats).not.toContain(mySeat);

    const watched = await watcher.client.get(url);
    expect(watched.statusCode, watched.body).toBe(200);
    expect(watched.body).not.toMatch(/correct|answerValue|answer_value|"key"|optionKey|distance/i);
    const { question } = matchWatchResponseSchema.parse(watched.json());
    expect(question).toMatchObject({ matchId, seq, kind: 'TRIVIA' });
    // Kein eigener Zeitlauf: der Rest des Zeitlimits ab dem Öffnen der Frage
    expect(question.remainingMs).toBeGreaterThan(0);
    expect(question.remainingMs).toBeLessThanOrEqual(question.timeLimitMs);

    // Keine Spur: keine Zeile für den Zuschauer, die Ansicht bleibt, und es ist wiederholbar
    const rows = await server.db
      .selectFrom('match_answers')
      .select(['seat'])
      .where('match_id', '=', matchId)
      .where('seq', '=', seq)
      .execute();
    expect(rows.map((r) => r.seat)).not.toContain(mySeat);
    const still = await view(watcher, matchId);
    expect(still.question).toMatchObject({ seq, myStatus: 'NOT_PARTICIPATING', resolved: false });
    expect((await watcher.client.get(url)).statusCode).toBe(200);

    // Abholen bleibt den Gefragten, Mitlesen den anderen; der Gefragte sieht dieselbe Frage
    expect(errorOf(await present(watcher, matchId, seq))).toMatchObject({
      status: 409,
      code: 'STEP_NOT_AVAILABLE',
    });
    // Die mitgelesenen Token taugen dem Zuschauer zu nichts: Antworten darf nur, wer gefragt ist
    const token = 'options' in question ? question.options[0]?.token : undefined;
    expect(
      errorOf(await answer(watcher, matchId, seq, { optionToken: token, clientElapsedMs: 900 })),
    ).toMatchObject({ status: 409, code: 'STEP_NOT_AVAILABLE' });
    expect((await view(watcher, matchId)).question?.answered).not.toContain(mySeat);
    expect(errorOf(await asked.client.get(url))).toMatchObject({
      status: 409,
      code: 'STEP_NOT_AVAILABLE',
    });
    const mine = matchPresentResponseSchema.parse(
      (await present(asked, matchId, seq)).json(),
    ).question;
    expect(question.prompt).toBe(mine.prompt);
    expect('options' in question ? question.options : null).toEqual(
      'options' in mine ? mine.options : null,
    );

    // Wer nicht zur Partie gehört, und Fragen, die es nicht gibt
    const outsider = await newHuman();
    expect(errorOf(await outsider.client.get(url))).toMatchObject({ status: 404 });
    const unknown = await watcher.client.get(`/matches/${matchId}/questions/${seq + 50}/watch`);
    expect(errorOf(unknown)).toMatchObject({ status: 404 });

    // Nach der Auflösung steht alles im Ereignis: Mitlesen ist vorbei
    const answered = await answer(asked, matchId, seq, await answerPayload(matchId, seq));
    expect(answered.statusCode, answered.body).toBe(200);
    expect((await view(watcher, matchId)).phase?.kind).toBe('REVEAL');
    expect(errorOf(await watcher.client.get(url))).toMatchObject({
      status: 409,
      code: 'STEP_EXPIRED',
    });
  });

  /** Beide wählen ihre Hauptstadt, bis die erste Frage offen ist; liefert deren Nummer. */
  async function pastAnnounceUntilQuestion(a: Human, b: Human, matchId: string): Promise<number> {
    for (let i = 0; i < 12; i++) {
      for (const human of [a, b]) {
        const current = await pastAnnounce(human, matchId);
        if (current.phase?.kind === 'QUESTION' && current.question) return current.question.seq;
        if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) {
          expect((await pick(human, matchId, current.legalRegions[0] ?? -1)).statusCode).toBe(200);
        }
      }
    }
    throw new Error('Keine Frage');
  }
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

describe('Letzte Auflösung vor der Abrechnung (ADR-055)', () => {
  it('nach dem letzten Duell steht die Auflösung; erst danach endet die Partie und zählt', async () => {
    const active = await newHuman();
    const idle = await newHuman();
    const matchId = await createMatch(active, { kind: 'STANDARD', rules: 'PLAYTEST' });
    const code = (await view(active, matchId)).match.inviteCode ?? '';
    expect((await joinMatch(idle, code)).statusCode).toBe(200);
    expect((await startMatch(active, matchId)).statusCode).toBe(200);
    const seats: Seat[] = [
      { human: active, mode: 'ACTIVE' },
      { human: idle, mode: 'IDLE' },
    ];

    const closing = await playToEnd(matchId, seats, (v) => v.board?.step.kind === 'FINISHED');
    // Das letzte Duell ist entschieden, die Partie läuft noch: Alle sehen Ausgang und Antworten
    expect(closing.match.status).toBe('RUNNING');
    expect(closing.match.finishedAt).toBeNull();
    expect(closing.phase?.kind).toBe('REVEAL');
    expect(closing.phase?.remainingMs).toBeGreaterThan(0);
    expect(closing.phase?.remainingMs).toBeLessThanOrEqual(closing.match.timers.revealMs);
    expect(closing.question?.resolved).toBe(true);
    expect(closing.legalRegions).toEqual([]);
    const { step, turns, seats: kingdoms } = closing.board ?? { step: null, turns: [], seats: [] };
    expect(step?.finishReason).toMatch(/^(ROUNDS_COMPLETE|LAST_KINGDOM)$/);
    expect(step?.round).toBeGreaterThanOrEqual(1);
    // Die Zugfolge der letzten Runde bleibt stehen, alle erledigt: Die Karte springt nicht
    const alive = kingdoms.filter((k) => !k.eliminated).map((k) => k.seat);
    expect(turns.map((t) => t.seat).sort()).toEqual(alive);
    expect(turns.every((t) => t.status === 'DONE')).toBe(true);
    // Der Endstand steht schon im Verlauf, direkt nach dem Ausgang des Duells
    const types = await eventTypes(matchId);
    expect(types.at(-1)).toBe('MATCH_FINISHED');
    expect(types.lastIndexOf('DUEL_RESOLVED')).toBeGreaterThan(
      types.lastIndexOf('QUESTION_RESOLVED'),
    );
    // Abgerechnet ist noch nichts, und zu wählen gibt es nichts mehr
    expect(await statistics(active.userId)).toEqual({ matches_played: 0, matches_won: 0 });
    expect(errorOf(await pick(active, matchId, 0))).toMatchObject({
      status: 409,
      code: 'STEP_NOT_AVAILABLE',
    });
    // Vor Ablauf der Auflösung ändert die Ablaufsteuerung nichts
    const ctx = driverContext();
    await runMatchDriverOnce(server.db, ctx);
    const waiting = await view(active, matchId);
    expect(waiting.match.status).toBe('RUNNING');
    expect(waiting.lastEventSeq).toBe(closing.lastEventSeq);

    await advanceGameClock(server.database.pool, (waiting.phase?.remainingMs ?? 0) + 1);
    await runMatchDriverOnce(server.db, ctx);
    const final = await view(active, matchId);
    expect(final.match.status).toBe('FINISHED');
    expect(final.match.finishedAt).not.toBeNull();
    expect(final.phase).toBeNull();
    expect(final.board?.step).toMatchObject({ kind: 'FINISHED', round: step?.round });
    expect(final.board?.turns).toEqual([]);
    // Die Abrechnung bringt kein neues Ereignis; jetzt zählt die Partie
    expect(final.lastEventSeq).toBe(closing.lastEventSeq);
    expect(await statistics(active.userId)).toEqual({ matches_played: 1, matches_won: 1 });
    expect(await statistics(idle.userId)).toEqual({ matches_played: 1, matches_won: 0 });
  });

  it('auch ohne Ablaufsteuerung: Wer nach der Frist liest, bekommt die Abrechnung', async () => {
    const human = await newHuman();
    const matchId = await createMatch(human, {
      kind: 'TEST',
      rules: 'PLAYTEST',
      seats: 3,
      botStrengths: ['MEDIUM', 'MEDIUM'],
    });
    expect((await startMatch(human, matchId)).statusCode).toBe(200);
    const closing = await playToEnd(
      matchId,
      [{ human, mode: 'ACTIVE' }],
      (v) => v.board?.step.kind === 'FINISHED',
    );
    expect(closing.match.status).toBe('RUNNING');
    expect(closing.phase?.kind).toBe('REVEAL');
    await advanceGameClock(server.database.pool, (closing.phase?.remainingMs ?? 0) + 1);
    const final = await view(human, matchId);
    expect(final.match.status).toBe('FINISHED');
    expect(final.phase).toBeNull();
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
    // vorn, hat er beide Male gewählt (jede Wahl blieb kurz stehen), bevor der Mensch dran ist.
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
      // Derselbe Mensch wählt gleich noch einmal: keine Pause dazwischen (ADR-053)
      expect(current.phase?.kind).toBe('PICK');
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

describe('Ansage (ADR-053)', () => {
  /** Ein Schritt des Ablaufs, wie ihn ein Mitspieler sieht. */
  interface Beat {
    readonly phase: string;
    readonly step: string;
    readonly lastEvent: string | undefined;
  }

  it('jede Wahl bleibt stehen, vor jedem Duell steht die Ansage, Eingaben nimmt sie nicht an', async () => {
    const human = await newHuman();
    const matchId = await createMatch(human, {
      kind: 'TEST',
      rules: 'PLAYTEST',
      seats: 3,
      botStrengths: ['MEDIUM', 'MEDIUM'],
    });
    expect((await startMatch(human, matchId)).statusCode).toBe(200);
    const ctx = driverContext();
    const beats: Beat[] = [];
    let refused = 0;
    let current = await view(human, matchId);
    const { announceMs, pickShowMs } = current.match.timers;
    expect([announceMs, pickShowMs]).toEqual([600, 300]);
    for (let i = 0; i < 2000 && current.match.status === 'RUNNING'; i++) {
      const step = current.board?.step.kind ?? '';
      beats.push({
        phase: current.phase?.kind ?? '',
        step,
        lastEvent: current.events.at(-1)?.type,
      });
      if (current.phase?.kind === 'ANNOUNCE') {
        // Ein Duell wird länger angesagt als eine Wahl gezeigt
        expect(current.phase.remainingMs).toBeLessThanOrEqual(
          step === 'DUEL_TRIVIA' ? announceMs : pickShowMs,
        );
        expect(current.phase.remainingMs).toBeGreaterThan(0);
        expect(current.legalRegions).toEqual([]);
        if (step === 'DUEL_TRIVIA') {
          // Wer wen wo angreift, steht schon fest; die Frage gibt es noch nicht
          expect(current.board?.step.attacker).not.toBeNull();
          expect(current.board?.step.defender).not.toBeNull();
          expect(current.board?.step.region).not.toBeNull();
          expect(current.question?.resolved ?? true).toBe(true);
        }
        if (refused < 3) {
          refused += 1;
          expect(errorOf(await pick(human, matchId, 0))).toMatchObject({
            status: 409,
            code: 'STEP_NOT_AVAILABLE',
          });
        }
        await advanceGameClock(server.database.pool, current.phase.remainingMs + 1);
        await runMatchDriverOnce(server.db, ctx);
      } else if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) {
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
        await runMatchDriverOnce(server.db, ctx);
      }
      current = await view(human, matchId);
    }
    expect(current.match.status).toBe('FINISHED');
    expect(refused).toBe(3);

    const before = (i: number) => beats[i - 1];
    const opened = beats
      .map((beat, i) => ({ beat, i }))
      .filter(({ beat, i }) => beat.phase === 'QUESTION' && before(i)?.phase !== 'QUESTION');
    expect(opened.length).toBeGreaterThan(8);
    for (const { beat, i } of opened) {
      const prev = before(i);
      // Keine Frage folgt unmittelbar auf eine Wahl
      expect(prev?.phase, `${i}: ${JSON.stringify(prev)}`).not.toBe('PICK');
      if (beat.step === 'DUEL_TRIVIA') {
        expect(prev, String(i)).toMatchObject({ phase: 'ANNOUNCE', step: 'DUEL_TRIVIA' });
      }
      // Das Stechen folgt ohne weitere Ansage auf die Auflösung der Wissensfrage
      if (beat.step === 'DUEL_ESTIMATE') expect(prev?.phase, String(i)).toBe('REVEAL');
    }
    expect(opened.some(({ beat }) => beat.step === 'DUEL_TRIVIA')).toBe(true);
    // Eine Wahl wird gezeigt, solange sie das Letzte ist, was geschah
    const shown = beats.filter((beat) => beat.phase === 'ANNOUNCE' && beat.step !== 'DUEL_TRIVIA');
    expect(shown.length).toBeGreaterThan(10);
    for (const beat of shown) {
      expect(['CAPITAL_CHOSEN', 'REGION_CLAIMED']).toContain(beat.lastEvent);
    }
    const announced = beats.filter((b) => b.phase === 'ANNOUNCE' && b.step === 'DUEL_TRIVIA');
    expect(announced.every((beat) => beat.lastEvent === 'TARGET_CHOSEN')).toBe(true);
  });

  it('Partien mit Regeln von vor ADR-053 laufen ohne Ansage weiter', async () => {
    const a = await newHuman();
    const b = await newHuman();
    const matchId = await createMatch(a, { kind: 'STANDARD', rules: 'PLAYTEST' });
    const code = (await view(a, matchId)).match.inviteCode ?? '';
    expect((await joinMatch(b, code)).statusCode).toBe(200);
    expect((await startMatch(a, matchId)).statusCode).toBe(200);
    // Zwei Menschen: Die Partie wartet auf die erste Wahl. Regeln wie vor ADR-053 gespeichert,
    // in der Zeile und im Zustand der Partie.
    const stored = await sql<{ n: number }>`
      update matches
      set rules = rules #- '{timers,announceMs}' #- '{timers,pickShowMs}',
          state = state #- '{rules,timers,announceMs}' #- '{rules,timers,pickShowMs}'
      where id = ${matchId} and state #> '{rules,timers}' ? 'announceMs'
      returning 1 as n
    `.execute(server.db);
    expect(stored.rows).toHaveLength(1);
    expect((await view(a, matchId)).match.timers).toMatchObject({ announceMs: 0, pickShowMs: 0 });
    const phases: string[] = [];
    for (let i = 0; i < 4; i++) {
      for (const human of [a, b]) {
        const current = await view(human, matchId);
        phases.push(current.phase?.kind ?? '');
        if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) {
          expect((await pick(human, matchId, current.legalRegions[0] ?? -1)).statusCode).toBe(200);
        }
      }
    }
    const final = await view(a, matchId);
    phases.push(final.phase?.kind ?? '');
    expect(phases).not.toContain('ANNOUNCE');
    expect(final.phase?.kind).toBe('QUESTION');
    expect(final.question).toMatchObject({ seq: 1, purpose: 'LAND' });
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
    let current = await pastAnnounce(human, matchId);
    while (current.phase?.kind === 'PICK') {
      expect((await pick(human, matchId, current.legalRegions[0] ?? -1)).statusCode).toBe(200);
      current = await pastAnnounce(human, matchId);
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
    // Hauptstädte: wer dran ist, wählt; jede Wahl bleibt kurz stehen
    for (let i = 0; i < 4; i++) {
      for (const human of [a, b]) {
        const current = await pastAnnounce(human, matchId);
        if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) {
          expect((await pick(human, matchId, current.legalRegions[0] ?? -1)).statusCode).toBe(200);
        }
      }
    }
    expect((await pastAnnounce(a, matchId)).question).toMatchObject({
      seq: 1,
      myStatus: 'NOT_PRESENTED',
    });
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
