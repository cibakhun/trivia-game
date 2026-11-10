import { newId, type Tx } from '@rdw/db';
import {
  RNG_VERSION,
  absDecimal,
  createRng,
  deriveSeed,
  difficultyToB,
  difficultyWeights,
  formatDecimal,
  garrisonProfileCode,
  generateNpcAnswer,
  parseDecimal,
  pickQuestion,
  subtractDecimal,
  targetDifficulty,
  type NpcAnswer,
  type NpcProfile,
  type QuestionPick,
} from '@rdw/game-core';
import { DEFAULT_LOCALE, type AttackResponse, type QuestionKind } from '@rdw/protocol';
import { sql } from 'kysely';
import { z } from 'zod';
import { gameNow } from '../../infra/clock.ts';
import { canonicalJson, sha256Hex } from '../../infra/crypto.ts';
import { ApiError } from '../../infra/errors.ts';
import { appendBattleEvents, insertWorldEvents } from '../../infra/events.ts';
import { loadKingdoms } from '../kingdom/queries.ts';
import {
  loadCandidates,
  loadQuestionContent,
  loadRecentCategories,
  type QuestionContent,
} from '../quiz/questions.ts';
import { loadAttackSituation, refusalError, type DefenderKingdom } from './situation.ts';
import { makeSnapshot } from './snapshot.ts';

/**
 * Angriff starten (SIEGE_SYSTEM §2 Schritt 1, ARCHITECTURE §7): Berechtigung unter Sperren
 * prüfen, Belagerung `PREPARING` anlegen und die Region reservieren, Fragen wählen und die
 * NPC-Antworten erzeugen und versiegeln – alles in einer Transaktion, bevor der Spieler die
 * erste Frage sieht. Läuft in der Transaktion des Idempotenzspeichers.
 */

export interface CreateAttackContext {
  readonly userId: string;
  readonly instanceId: string;
  readonly targetRegionId: string;
  readonly idempotencyKey: string;
  readonly rngSecret: Uint8Array;
  readonly rngKeyId: string;
  /** Testfragen erlaubt (nur local und test). */
  readonly allowFixtures: boolean;
}

const spreadSchema = z.object({
  s0: z.number(),
  thetaRef: z.number(),
  k: z.number(),
  sMin: z.number(),
  sMax: z.number(),
});

interface LoadedProfile {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly profile: NpcProfile;
  readonly spread: z.infer<typeof spreadSchema>;
}

/** Antwortprofil des Verteidigers: Profil der NPC-Fraktion oder der Garnison nach Stufe. */
async function loadDefenderProfile(
  tx: Tx,
  defender: DefenderKingdom | null,
  tier: number,
): Promise<LoadedProfile> {
  const base = tx
    .selectFrom('npc_profiles as p')
    .select([
      'p.id',
      'p.code',
      'p.version',
      'p.skill_theta',
      'p.estimate_spread',
      'p.rt_log_mu',
      'p.rt_log_sigma',
    ]);
  const row = defender?.npcFactionId
    ? await base
        .innerJoin('npc_factions as f', 'f.profile_id', 'p.id')
        .where('f.id', '=', defender.npcFactionId)
        .executeTakeFirstOrThrow()
    : await base
        .where('p.code', '=', garrisonProfileCode(tier))
        .orderBy('p.version', 'desc')
        .limit(1)
        .executeTakeFirstOrThrow();
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    profile: {
      theta: Number(row.skill_theta),
      estimateMedianMs: Math.round(Math.exp(Number(row.rt_log_mu))),
      responseLogSigma: Number(row.rt_log_sigma),
    },
    spread: spreadSchema.parse(row.estimate_spread),
  };
}

function timeLimitFor(
  kind: QuestionKind,
  quiz: { triviaTimeLimit: number; estimateTimeLimit: number },
) {
  return kind === 'TRIVIA' ? quiz.triviaTimeLimit : quiz.estimateTimeLimit;
}

/** Schritt 0 Trivia, Schritt 1 Schätzung (GAME_RULES §5.1). */
const STEP_KINDS: readonly QuestionKind[] = ['TRIVIA', 'ESTIMATE'];

export async function createAttack(tx: Tx, ctx: CreateAttackContext): Promise<AttackResponse> {
  const params = { instanceId: ctx.instanceId, userId: ctx.userId, regionId: ctx.targetRegionId };
  // Vorab ohne Sperren lesen, um die Sperrreihenfolge zu kennen: Reiche → Region (§5.1).
  const pre = await loadAttackSituation(tx, params);
  const kingdomIds = [pre.attacker?.id, pre.target.ownerKingdomId]
    .filter((id): id is string => typeof id === 'string')
    .sort();
  if (kingdomIds.length > 0) {
    await tx
      .selectFrom('kingdoms')
      .select('id')
      .where('id', 'in', kingdomIds)
      .orderBy('id')
      .forUpdate()
      .execute();
  }
  await tx
    .selectFrom('region_state')
    .select('region_id')
    .where('region_id', '=', pre.target.id)
    .forUpdate()
    .execute();
  const situation = await loadAttackSituation(tx, params);
  if (
    situation.attacker?.id !== pre.attacker?.id ||
    situation.target.ownerKingdomId !== pre.target.ownerKingdomId
  ) {
    throw new ApiError(409, 'CONCURRENT_UPDATE', 'Die Lage hat sich geändert, bitte wiederholen');
  }
  const refusal = refusalError(situation.eligibility);
  if (refusal) throw refusal;
  const { attacker, target, defender, rules } = situation;
  if (!attacker || !situation.eligibility.ok) throw new Error('Berechtigung ohne Angreifer');
  const defenderKind = situation.eligibility.defenderKind;

  // Derselbe Schlüssel wurde schon einmal für einen Angriff dieses Reichs benutzt (Antwortspeicher
  // abgelaufen): unique(attacker_kingdom_id, idempotency_key) würde abweisen.
  const reused = await tx
    .selectFrom('sieges')
    .select('id')
    .where('attacker_kingdom_id', '=', attacker.id)
    .where('idempotency_key', '=', ctx.idempotencyKey)
    .executeTakeFirst();
  if (reused) {
    throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key wurde bereits verwendet');
  }

  const siegeId = newId();
  const challengeId = newId();
  const snapshot = makeSnapshot(rules, situation.rulesId, situation.configHash);
  await tx
    .insertInto('sieges')
    .values({
      id: siegeId,
      instance_id: ctx.instanceId,
      mode: 'PVE',
      target_region_id: target.id,
      attacker_kingdom_id: attacker.id,
      defender_kingdom_id: defender?.id ?? null,
      defender_kind: defenderKind,
      status: 'PREPARING',
      created_at: gameNow,
      rules_snapshot: JSON.stringify(snapshot),
      idempotency_key: ctx.idempotencyKey,
    })
    .execute();
  // Regionsreservierung (SIEGE_SYSTEM §3.1), bedingt auf „keine aktive Belagerung“
  const reserved = await tx
    .updateTable('region_state')
    .set({ active_siege_id: siegeId, version: sql<string>`version + 1`, updated_at: gameNow })
    .where('region_id', '=', target.id)
    .where('active_siege_id', 'is', null)
    .returning([
      'is_capital',
      sql<Date | null>`case when protected_until > game_now() then protected_until end`.as(
        'protected_until',
      ),
    ])
    .executeTakeFirst();
  if (!reserved) {
    throw new ApiError(409, 'REGION_UNDER_SIEGE', 'Die Region wird bereits angegriffen');
  }

  const profile = await loadDefenderProfile(tx, defender, target.tier);
  const attackerParticipantId = newId();
  const defenderParticipantId = newId();
  await tx
    .insertInto('siege_participants')
    .values([
      {
        id: attackerParticipantId,
        siege_id: siegeId,
        role: 'ATTACKER',
        user_id: ctx.userId,
        npc_profile_id: null,
        locale: DEFAULT_LOCALE,
      },
      {
        id: defenderParticipantId,
        siege_id: siegeId,
        role: 'DEFENDER',
        user_id: null,
        npc_profile_id: profile.id,
        locale: null,
      },
    ])
    .execute();

  // Fragenauswahl (QUIZ_ENGINE §5) aus dem Strom „question-pick“ der Belagerung
  const weights = difficultyWeights(target.tier, attacker.regionCount === 1);
  const recentCategories = await loadRecentCategories(tx, ctx.userId);
  const pickRng = createRng(await deriveSeed(ctx.rngSecret, 'question-pick', siegeId));
  const picks: QuestionPick[] = [];
  for (const kind of STEP_KINDS) {
    const candidates = await loadCandidates(tx, {
      kind,
      userId: ctx.userId,
      allowFixtures: ctx.allowFixtures,
    });
    const pick = pickQuestion(
      candidates,
      { now: situation.now.getTime(), weights, recentCategories },
      pickRng,
    );
    if (!pick) {
      throw new ApiError(409, 'NO_QUESTION_AVAILABLE', 'Keine Frage verfügbar', { kind });
    }
    picks.push(pick);
  }
  const [triviaPick, estimatePick] = picks as [QuestionPick, QuestionPick];
  await tx
    .insertInto('quiz_challenges')
    .values({
      id: challengeId,
      siege_id: siegeId,
      created_at: gameNow,
      target_difficulty: String(targetDifficulty(weights)),
      rng_key_id: ctx.rngKeyId,
      rng_version: RNG_VERSION,
    })
    .execute();
  await tx
    .insertInto('quiz_challenge_steps')
    .values(
      picks.map((pick, index) => ({
        challenge_id: challengeId,
        step_index: index,
        kind: STEP_KINDS[index] as QuestionKind,
        version_id: pick.candidate.versionId,
        time_limit_ms: timeLimitFor(STEP_KINDS[index] as QuestionKind, snapshot.quiz),
      })),
    )
    .execute();

  // NPC-Antworten erzeugen und speichern, bevor der Spieler eine Frage sieht (NPC_SYSTEM §3.4)
  const trivia = await loadQuestionContent(tx, triviaPick.candidate.versionId);
  const estimate = await loadQuestionContent(tx, estimatePick.candidate.versionId);
  const npc = await generateSealedAnswer(
    ctx,
    challengeId,
    profile,
    trivia,
    estimate,
    snapshot.quiz,
  );
  await tx
    .insertInto('quiz_answers')
    .values([
      {
        id: newId(),
        challenge_id: challengeId,
        siege_id: siegeId,
        participant_id: defenderParticipantId,
        step_index: 0,
        status: 'GENERATED',
        answer_option_key: npc.optionKey,
        is_correct: npc.answer.triviaCorrect,
        audit: JSON.stringify(npc.audit),
        created_at: gameNow,
      },
      {
        id: newId(),
        challenge_id: challengeId,
        siege_id: siegeId,
        participant_id: defenderParticipantId,
        step_index: 1,
        status: 'GENERATED',
        answer_value: npc.estimate,
        distance: npc.distance,
        effective_ms: npc.answer.estimateMs,
        is_correct: npc.distance === '0',
        audit: JSON.stringify(npc.audit),
        created_at: gameNow,
      },
    ])
    .execute();

  await appendBattleEvents(tx, siegeId, [
    {
      type: 'ATTACK_CREATED',
      payload: {
        mode: 'PVE',
        targetRegionId: target.id,
        defenderKind,
        defenderKingdomId: defender?.id ?? null,
        challengeId,
        questions: picks.map((pick, index) => ({
          step: index,
          versionId: pick.candidate.versionId,
          fallback: pick.fallback,
          poolSize: pick.poolSize,
        })),
        weights,
        rng: {
          purpose: 'question-pick',
          entityId: siegeId,
          keyId: ctx.rngKeyId,
          version: RNG_VERSION,
        },
      },
    },
    {
      // Beleg, dass die NPC-Leistung vor jeder Spielerantwort feststand (SIEGE_SYSTEM §2)
      type: 'NPC_ANSWERS_SEALED',
      payload: {
        profile: { id: profile.id, code: profile.code, version: profile.version },
        commitment: npc.commitment,
        rng: {
          purpose: 'npc-answer',
          entityId: challengeId,
          keyId: ctx.rngKeyId,
          version: RNG_VERSION,
        },
      },
    },
  ]);
  await insertWorldEvents(tx, ctx.instanceId, [
    {
      type: 'region.changed',
      chunk: { x: target.chunkX, y: target.chunkY },
      payload: {
        regionId: target.id,
        ownerKingdomId: target.ownerKingdomId,
        isCapital: reserved.is_capital,
        protectedUntil: reserved.protected_until?.toISOString() ?? null,
        underSiege: true,
      },
    },
  ]);

  const defenderSummary = defender
    ? ((await loadKingdoms(tx, ctx.instanceId, [defender.id])).get(defender.id) ?? null)
    : null;
  const { now } = await tx.selectNoFrom(gameNow.as('now')).executeTakeFirstOrThrow();
  return {
    instanceId: ctx.instanceId,
    siegeId,
    challengeId,
    mode: 'PVE',
    targetRegionId: target.id,
    defender: { kind: defenderKind, kingdom: defenderSummary },
    steps: STEP_KINDS.map((kind, index) => ({
      index,
      kind,
      timeLimitMs: timeLimitFor(kind, snapshot.quiz),
    })),
    serverTime: now.toISOString(),
  };
}

interface SealedAnswer {
  readonly answer: NpcAnswer;
  readonly optionKey: string;
  readonly estimate: string;
  readonly distance: string;
  readonly audit: Record<string, unknown>;
  /** SHA-256 über die versiegelten Antworten; steht im Kampfprotokoll. */
  readonly commitment: string;
}

async function generateSealedAnswer(
  ctx: CreateAttackContext,
  challengeId: string,
  profile: LoadedProfile,
  trivia: QuestionContent,
  estimate: QuestionContent,
  quiz: { triviaTimeLimit: number; estimateTimeLimit: number },
): Promise<SealedAnswer> {
  const spec = estimate.estimate;
  if (!spec) throw new Error('Schritt 1 ist keine Schätzfrage');
  const correct = trivia.options.find((o) => o.correct);
  const wrong = trivia.options.filter((o) => !o.correct);
  if (!correct || wrong.length === 0) throw new Error('Trivia ohne richtige oder falsche Option');
  const rng = createRng(await deriveSeed(ctx.rngSecret, 'npc-answer', challengeId));
  const triviaB = trivia.calibratedDifficulty ?? difficultyToB(trivia.difficulty);
  const answer = generateNpcAnswer(
    rng,
    profile.profile,
    {
      triviaB,
      wrongOptionCount: wrong.length,
      estimate: {
        answerValue: spec.answerValue,
        answerPrecision: spec.answerPrecision,
        inputMin: spec.inputMin,
        inputMax: spec.inputMax,
        scaleType: spec.scaleType,
        scale: spec.scale,
      },
      estimateTimeLimitMs: quiz.estimateTimeLimit,
    },
    profile.spread,
  );
  const chosen =
    answer.wrongOptionIndex === null ? correct : (wrong[answer.wrongOptionIndex] ?? correct);
  const value = formatDecimal(answer.estimate);
  const distance = formatDecimal(
    absDecimal(subtractDecimal(answer.estimate, parseDecimal(spec.answerValue))),
  );
  const audit = {
    profileCode: profile.code,
    profileVersion: profile.version,
    ...answer.audit,
    estimateMedianMs: profile.profile.estimateMedianMs,
    rngVersion: RNG_VERSION,
    rngKeyId: ctx.rngKeyId,
  };
  const commitment = sha256Hex(
    canonicalJson({
      challengeId,
      optionKey: chosen.key,
      estimate: value,
      estimateMs: answer.estimateMs,
    }),
  );
  return { answer, optionKey: chosen.key, estimate: value, distance, audit, commitment };
}
