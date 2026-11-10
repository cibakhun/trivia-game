import { entityIdSchema, type WorldsResponse } from '@rdw/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { readGameNow } from '../../infra/clock.ts';
import { idempotencyKey, runIdempotent } from '../../infra/idempotency.ts';
import { parseInput } from '../../infra/validation.ts';
import { requireAuth } from '../identity/auth-hook.ts';
import { joinWorld } from './join.ts';
import { listWorlds } from './queries.ts';

const worldParams = z.object({ worldId: entityIdSchema });

/** Welten (API.md §2.2): Übersicht und Beitritt. */
export function worldRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/worlds', async (request): Promise<WorldsResponse> => {
    const auth = requireAuth(request);
    const worlds = await listWorlds(ctx.db, auth.userId);
    const now = await readGameNow(ctx.db);
    return { worlds, serverTime: now.toISOString() };
  });

  app.post('/worlds/:worldId/join', async (request, reply) => {
    const auth = requireAuth(request);
    const { worldId } = parseInput(worldParams, request.params);
    const outcome = await runIdempotent(
      ctx.db,
      {
        userId: auth.userId,
        key: idempotencyKey(request),
        endpoint: 'POST /worlds/:worldId/join',
        input: { worldId },
      },
      async (tx) => ({
        status: 201,
        body: await joinWorld(tx, {
          userId: auth.userId,
          worldId,
          rngSecret: ctx.config.rngSecret,
          rngKeyId: ctx.config.rngKeyId,
        }),
      }),
    );
    if (outcome.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(outcome.status).send(outcome.body);
  });
}
