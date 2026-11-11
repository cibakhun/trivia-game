import { randomUUID } from 'node:crypto';
import {
  errorBodySchema,
  matchActionResponseSchema,
  matchViewSchema,
  parseMatchEvent,
  type MatchCreateRequest,
  type MatchView,
} from '@rdw/protocol';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { z } from 'zod';
import { matchContextFrom } from '../src/index.ts';
import { TestClient, testConfig, type TestServer } from './helpers.ts';

/**
 * Handgriffe für Tests der Partie über die HTTP-Schnittstelle, für beide Spielarten: anlegen,
 * beitreten, starten, wählen, Fragen abholen und beantworten. Richtige Antworten liest der Test wie
 * ein Prüfer aus der Datenbank.
 */

export interface Human {
  readonly client: TestClient;
  readonly userId: string;
}

const presentationSchema = z.object({
  options: z.array(z.object({ token: z.string(), key: z.string() })).optional(),
});

/** `server` liefert den Testserver der Datei; er entsteht erst in `beforeAll`. */
export function matchKit(server: () => TestServer) {
  function driverContext() {
    return matchContextFrom(testConfig(server().database.url));
  }

  async function newHuman(app: FastifyInstance = server().app): Promise<Human> {
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

  function answer(
    human: Human,
    matchId: string,
    seq: number,
    payload: object,
    idem = randomUUID(),
  ) {
    return human.client.post(`/matches/${matchId}/questions/${seq}/answer`, {
      headers: { 'idempotency-key': idem },
      payload,
    });
  }

  /** Richtige (oder falsche) Antwort auf eine Frage der Partie, wie sie der Client schicken würde. */
  async function answerPayload(matchId: string, seq: number, correct = true): Promise<object> {
    const question = await server()
      .db.selectFrom('match_questions as q')
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
    const keys = await server()
      .db.selectFrom('question_options')
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

  /** Ereignisse, die nicht zum Schema des Clients passen (protocol `match-events.ts`). */
  async function unreadableEvents(matchId: string): Promise<unknown[]> {
    const rows = await server()
      .db.selectFrom('match_events')
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
    const rows = await server()
      .db.selectFrom('match_events')
      .select('type')
      .where('match_id', '=', matchId)
      .orderBy('seq')
      .execute();
    return rows.map((r) => r.type);
  }

  return {
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
  };
}
