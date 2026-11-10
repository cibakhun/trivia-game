import {
  entityIdSchema,
  matchAnswerRequestSchema,
  matchCreateRequestSchema,
  matchJoinRequestSchema,
  matchPickRequestSchema,
  type MatchActionResponse,
  type MatchAnswerResponse,
  type MatchListResponse,
  type MatchPresentResponse,
  type MatchView,
} from '@rdw/protocol';
import type { Tx } from '@rdw/db';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { readGameNow } from '../../infra/clock.ts';
import { idempotencyKey, runIdempotent, type IdempotentOutcome } from '../../infra/idempotency.ts';
import { parseInput } from '../../infra/validation.ts';
import { requireAuth } from '../identity/auth-hook.ts';
import { answerMatchQuestion, presentMatchQuestion } from './answers.ts';
import { matchContextFrom } from './context.ts';
import { lockMatchFor } from './engine.ts';
import { createLobby, expireLobbies, joinLobby, leaveLobby, startLobby } from './lobby.ts';
import { listMatches, matchView } from './view.ts';

/**
 * Partie (API.md §2.6): anlegen, beitreten, verlassen, starten, lesen, wählen, Frage abholen,
 * antworten. Zustandsändernde Anfragen außer `present` brauchen einen Idempotency-Key; `present`
 * liefert bei Wiederholung dieselbe Frage mit derselben Frist.
 */

const matchParams = z.object({ matchId: entityIdSchema });
const questionParams = matchParams.extend({
  seq: z.coerce.number().int().min(1).max(10_000),
});
const viewQuery = z.object({ after: z.coerce.number().int().min(0).default(0) }).strict();

function send(reply: FastifyReply, outcome: IdempotentOutcome) {
  if (outcome.replayed) reply.header('idempotency-replayed', 'true');
  return reply.status(outcome.status).send(outcome.body);
}

export function matchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const match = matchContextFrom(ctx.config);

  async function action(tx: Tx, matchId: string): Promise<MatchActionResponse> {
    return { matchId, serverTime: (await readGameNow(tx)).toISOString() };
  }

  app.get('/matches', async (request): Promise<MatchListResponse> => {
    const auth = requireAuth(request);
    return listMatches(ctx.db, match, auth.userId);
  });

  app.post('/matches', async (request, reply) => {
    const auth = requireAuth(request);
    const body = parseInput(matchCreateRequestSchema, request.body);
    const key = idempotencyKey(request);
    await expireLobbies(ctx.db, { userId: auth.userId });
    const outcome = await runIdempotent(
      ctx.db,
      { userId: auth.userId, key, endpoint: 'POST /matches', input: body },
      async (tx) => {
        const { matchId } = await createLobby(tx, match, { userId: auth.userId, request: body });
        return { status: 201, body: await action(tx, matchId) };
      },
    );
    return send(reply, outcome);
  });

  app.post('/matches/join', async (request, reply) => {
    const auth = requireAuth(request);
    const body = parseInput(matchJoinRequestSchema, request.body);
    const key = idempotencyKey(request);
    await expireLobbies(ctx.db, { userId: auth.userId });
    const outcome = await runIdempotent(
      ctx.db,
      { userId: auth.userId, key, endpoint: 'POST /matches/join', input: body },
      async (tx) => {
        const { matchId } = await joinLobby(tx, {
          userId: auth.userId,
          inviteCode: body.inviteCode,
        });
        return { status: 200, body: await action(tx, matchId) };
      },
    );
    return send(reply, outcome);
  });

  app.post('/matches/:matchId/leave', async (request, reply) => {
    const auth = requireAuth(request);
    const { matchId } = parseInput(matchParams, request.params);
    const key = idempotencyKey(request);
    const outcome = await runIdempotent(
      ctx.db,
      { userId: auth.userId, key, endpoint: 'POST /matches/:matchId/leave', input: { matchId } },
      async (tx) => {
        await leaveLobby(tx, { userId: auth.userId, matchId });
        return { status: 200, body: await action(tx, matchId) };
      },
    );
    return send(reply, outcome);
  });

  app.post('/matches/:matchId/start', async (request, reply) => {
    const auth = requireAuth(request);
    const { matchId } = parseInput(matchParams, request.params);
    const key = idempotencyKey(request);
    const outcome = await runIdempotent(
      ctx.db,
      { userId: auth.userId, key, endpoint: 'POST /matches/:matchId/start', input: { matchId } },
      async (tx) => {
        await startLobby(tx, match, { userId: auth.userId, matchId });
        return { status: 200, body: await action(tx, matchId) };
      },
    );
    return send(reply, outcome);
  });

  app.get('/matches/:matchId', async (request): Promise<MatchView> => {
    const auth = requireAuth(request);
    const { matchId } = parseInput(matchParams, request.params);
    const { after } = parseInput(viewQuery, request.query);
    return matchView(ctx.db, match, { userId: auth.userId, matchId, after });
  });

  app.post('/matches/:matchId/pick', async (request, reply) => {
    const auth = requireAuth(request);
    const { matchId } = parseInput(matchParams, request.params);
    const body = parseInput(matchPickRequestSchema, request.body);
    const key = idempotencyKey(request);
    const outcome = await runIdempotent(
      ctx.db,
      {
        userId: auth.userId,
        key,
        endpoint: 'POST /matches/:matchId/pick',
        input: { matchId, ...body },
      },
      async (tx) => {
        const run = await lockMatchFor(tx, match, matchId, auth.userId);
        // Abgelaufene Wahl: Der Server hat schon gewählt, die Anfrage kommt zu spät
        await run.advanceDue();
        await run.humanPick(auth.userId, body.region);
        await run.commit();
        return {
          status: 200,
          body: { matchId, serverTime: run.now.toISOString() } satisfies MatchActionResponse,
        };
      },
    );
    return send(reply, outcome);
  });

  app.post(
    '/matches/:matchId/questions/:seq/present',
    async (request): Promise<MatchPresentResponse> => {
      const auth = requireAuth(request);
      const { matchId, seq } = parseInput(questionParams, request.params);
      return presentMatchQuestion(ctx.db, match, { userId: auth.userId, matchId, seq });
    },
  );

  app.post(
    '/matches/:matchId/questions/:seq/answer',
    async (request): Promise<MatchAnswerResponse> => {
      const auth = requireAuth(request);
      const { matchId, seq } = parseInput(questionParams, request.params);
      const key = idempotencyKey(request);
      const body = parseInput(matchAnswerRequestSchema, request.body);
      return answerMatchQuestion(ctx.db, match, {
        userId: auth.userId,
        matchId,
        seq,
        body,
        idempotencyKey: key,
      });
    },
  );
}
