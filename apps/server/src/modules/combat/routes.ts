import {
  answerRequestSchema,
  attackRequestSchema,
  entityIdSchema,
  type AnswerResponse,
  type ChallengeView,
  type DefenseResponse,
  type PresentResponse,
  type SiegesResponse,
} from '@rdw/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { idempotencyKey, runIdempotent } from '../../infra/idempotency.ts';
import { parseInput } from '../../infra/validation.ts';
import { requireAuth } from '../identity/auth-hook.ts';
import { answerStep, challengeView, presentStep } from '../quiz/challenge.ts';
import { createAttack } from './create-attack.ts';
import { listSieges, startDefense } from './defense.ts';
import { settleOpenSiegesOfUser } from './sweeper.ts';

/**
 * Angriff, Verteidigung und Herausforderung (API.md §2.3): Angriff anlegen, Belagerungen
 * auflisten, Verteidigung beginnen, Stand lesen, Frage zeigen, antworten. `present` und
 * `defense` brauchen keinen Idempotency-Key: Eine Wiederholung liefert dieselbe Frage mit der
 * ursprünglichen Frist (ADR-033).
 */

const instanceParams = z.object({ instanceId: entityIdSchema });
const challengeParams = z.object({ challengeId: entityIdSchema });
const siegeParams = z.object({ siegeId: entityIdSchema });
const stepParams = challengeParams.extend({
  step: z.enum(['0', '1']).transform(Number),
});

export function combatRoutes(app: FastifyInstance, ctx: AppContext): void {
  const allowFixtures = ctx.config.appEnv === 'local' || ctx.config.appEnv === 'test';

  app.post('/instances/:instanceId/attacks', async (request, reply) => {
    const auth = requireAuth(request);
    const { instanceId } = parseInput(instanceParams, request.params);
    const body = parseInput(attackRequestSchema, request.body);
    const key = idempotencyKey(request);
    // Fällige eigene Kämpfe zuerst auflösen, sonst blockiert ein abgelaufener den neuen Angriff.
    await settleOpenSiegesOfUser(ctx.db, auth.userId, request.log);
    const outcome = await runIdempotent(
      ctx.db,
      {
        userId: auth.userId,
        key,
        endpoint: 'POST /instances/:instanceId/attacks',
        input: { instanceId, ...body },
      },
      async (tx) => ({
        status: 201,
        body: await createAttack(tx, {
          userId: auth.userId,
          instanceId,
          targetRegionId: body.targetRegionId,
          idempotencyKey: key,
          rngSecret: ctx.config.rngSecret,
          rngKeyId: ctx.config.rngKeyId,
          allowFixtures,
        }),
      }),
    );
    if (outcome.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(outcome.status).send(outcome.body);
  });

  app.get('/instances/:instanceId/sieges', async (request): Promise<SiegesResponse> => {
    const auth = requireAuth(request);
    const { instanceId } = parseInput(instanceParams, request.params);
    await settleOpenSiegesOfUser(ctx.db, auth.userId, request.log);
    return listSieges(ctx.db, { userId: auth.userId, instanceId });
  });

  app.post('/sieges/:siegeId/defense', async (request): Promise<DefenseResponse> => {
    const auth = requireAuth(request);
    const { siegeId } = parseInput(siegeParams, request.params);
    return startDefense(ctx.db, { userId: auth.userId, siegeId });
  });

  app.get('/challenges/:challengeId', async (request): Promise<ChallengeView> => {
    const auth = requireAuth(request);
    const { challengeId } = parseInput(challengeParams, request.params);
    return challengeView(ctx.db, { userId: auth.userId, challengeId });
  });

  app.post(
    '/challenges/:challengeId/steps/:step/present',
    async (request): Promise<PresentResponse> => {
      const auth = requireAuth(request);
      const { challengeId, step } = parseInput(stepParams, request.params);
      return presentStep(ctx.db, { userId: auth.userId, challengeId, step });
    },
  );

  app.post(
    '/challenges/:challengeId/steps/:step/answer',
    async (request): Promise<AnswerResponse> => {
      const auth = requireAuth(request);
      const { challengeId, step } = parseInput(stepParams, request.params);
      const key = idempotencyKey(request);
      const body = parseInput(answerRequestSchema, request.body);
      return answerStep(ctx.db, {
        userId: auth.userId,
        challengeId,
        step,
        body,
        idempotencyKey: key,
      });
    },
  );
}
