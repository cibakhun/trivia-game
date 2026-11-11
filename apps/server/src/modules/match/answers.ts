import type { Db, Tx } from '@rdw/db';
import { effectiveAnswerTime, formatDecimal, scoreEstimate, scoreTrivia } from '@rdw/game-core';
import {
  parseNumberInput,
  type MatchAnswerRequest,
  type MatchAnswerResponse,
  type MatchPresentedQuestion,
  type MatchPresentResponse,
} from '@rdw/protocol';
import { readGameNow } from '../../infra/clock.ts';
import { ApiError } from '../../infra/errors.ts';
import { loadQuestionContent, recordExposure, type QuestionContent } from '../quiz/questions.ts';
import type { MatchContext } from './context.ts';
import { readPresentation, type MatchRun } from './engine.ts';
import { lockMatchFor } from './runs.ts';

/**
 * Fragen der Partie abholen und beantworten, je Sitz wie bei Herausforderungen (QUIZ_ENGINE §6–7):
 * Das erste Abholen hält `presented_at` fest und setzt die eigene Frist (Zeitlimit + Latenzpuffer,
 * höchstens bis `closes_at`); ein erneutes Abholen liefert dieselbe Frage mit derselben Frist und
 * zählt als Reload. Die Antwort nennt weder Lösung noch Richtigkeit; beides steht erst in der
 * Auflösung, die alle Sitze zugleich sehen.
 */

const INT32_MAX = 2_147_483_647;

interface QuestionRow {
  readonly seq: number;
  readonly kind: string;
  readonly version_id: string;
  readonly seats: number[];
  readonly presentation: unknown;
  readonly time_limit_ms: number;
  readonly closes_at: Date;
  readonly resolved_at: Date | null;
}

interface SeatAnswerRow {
  readonly status: string;
  readonly presented_at: Date | null;
  readonly answer_deadline_at: Date | null;
  readonly reloads: number;
  readonly answer_option_key: string | null;
  readonly answer_value: string | null;
  readonly idempotency_key: string | null;
}

async function loadQuestion(tx: Tx, matchId: string, seq: number): Promise<QuestionRow> {
  const row = await tx
    .selectFrom('match_questions')
    .select([
      'seq',
      'kind',
      'version_id',
      'seats',
      'presentation',
      'time_limit_ms',
      'closes_at',
      'resolved_at',
    ])
    .where('match_id', '=', matchId)
    .where('seq', '=', seq)
    .executeTakeFirst();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Frage nicht gefunden');
  return row;
}

async function loadSeatAnswer(
  tx: Tx,
  matchId: string,
  seq: number,
  seat: number,
): Promise<SeatAnswerRow | undefined> {
  return tx
    .selectFrom('match_answers')
    .select([
      'status',
      'presented_at',
      'answer_deadline_at',
      'reloads',
      'answer_option_key',
      'answer_value',
      'idempotency_key',
    ])
    .where('match_id', '=', matchId)
    .where('seq', '=', seq)
    .where('seat', '=', seat)
    .executeTakeFirst();
}

/** Sitz des Anfragenden an dieser Frage, sonst `STEP_NOT_AVAILABLE`. */
function seatAt(run: MatchRun, userId: string, question: QuestionRow): number {
  const seat = run.seatOf(userId);
  if (seat === null || !question.seats.includes(seat)) {
    throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Diese Frage geht an andere Sitze');
  }
  return seat;
}

function toQuestion(
  matchId: string,
  question: QuestionRow,
  answer: SeatAnswerRow,
  content: QuestionContent,
  now: Date,
): MatchPresentedQuestion {
  if (!answer.presented_at || !answer.answer_deadline_at)
    throw new Error('Frage ohne Präsentation');
  const base = {
    matchId,
    seq: question.seq,
    prompt: content.prompt,
    timeLimitMs: question.time_limit_ms,
    remainingMs: Math.max(0, answer.answer_deadline_at.getTime() - now.getTime()),
    presentedAt: answer.presented_at.toISOString(),
  };
  if (content.kind === 'TRIVIA') {
    const texts = new Map(content.options.map((o) => [o.key, o.text]));
    return {
      ...base,
      kind: 'TRIVIA',
      options: readPresentation(question.presentation).options.map((o) => ({
        token: o.token,
        text: texts.get(o.key) ?? '',
      })),
    };
  }
  return {
    ...base,
    kind: 'ESTIMATE',
    unitLabel: content.estimate?.unitLabel ?? null,
    answerPrecision: content.estimate?.answerPrecision ?? 0,
  };
}

/** Fällige Fristen zuerst abarbeiten, damit eine abgelaufene Frage nicht mehr angenommen wird. */
async function catchUp(run: MatchRun): Promise<void> {
  if (await run.advanceDue()) await run.commit();
}

export async function presentMatchQuestion(
  db: Db,
  ctx: MatchContext,
  params: { readonly userId: string; readonly matchId: string; readonly seq: number },
): Promise<MatchPresentResponse> {
  return db.transaction().execute(async (tx) => {
    const run = await lockMatchFor(tx, ctx, params.matchId, params.userId);
    await catchUp(run);
    const { now } = run;
    const question = await loadQuestion(tx, params.matchId, params.seq);
    const seat = seatAt(run, params.userId, question);
    const content = await loadQuestionContent(tx, question.version_id);
    const existing = await loadSeatAnswer(tx, params.matchId, params.seq, seat);
    if (existing) {
      if (existing.status === 'PRESENTED' && question.resolved_at === null) {
        // Reload: dieselbe Frage mit derselben Frist; die Zeit des Clients zählt nicht mehr (§6.2)
        await tx
          .updateTable('match_answers')
          .set((eb) => ({ reloads: eb('reloads', '+', 1) }))
          .where('match_id', '=', params.matchId)
          .where('seq', '=', params.seq)
          .where('seat', '=', seat)
          .execute();
        return {
          question: toQuestion(params.matchId, question, existing, content, now),
          serverTime: now.toISOString(),
        };
      }
      if (existing.status === 'ANSWERED') {
        throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Frage ist schon beantwortet');
      }
      throw new ApiError(409, 'STEP_EXPIRED', 'Die Frage ist geschlossen');
    }
    if (question.resolved_at !== null || now.getTime() >= question.closes_at.getTime()) {
      throw new ApiError(409, 'STEP_EXPIRED', 'Die Frage ist geschlossen', {
        closesAt: question.closes_at.toISOString(),
      });
    }
    const deadline = Math.min(
      now.getTime() + question.time_limit_ms + run.rules.timers.latencyAllowanceCapMs,
      question.closes_at.getTime(),
    );
    await tx
      .insertInto('match_answers')
      .values({
        match_id: params.matchId,
        seq: params.seq,
        seat,
        status: 'PRESENTED',
        presented_at: now,
        answer_deadline_at: new Date(deadline),
        created_at: now,
      })
      .execute();
    await recordExposure(tx, params.userId, content.questionId);
    const row = await loadSeatAnswer(tx, params.matchId, params.seq, seat);
    if (!row) throw new Error('Präsentation fehlt');
    return {
      question: toQuestion(params.matchId, question, row, content, now),
      serverTime: now.toISOString(),
    };
  });
}

interface Scored {
  readonly optionKey: string | null;
  readonly value: string | null;
  readonly distance: string | null;
  readonly correct: boolean;
}

function score(question: QuestionRow, content: QuestionContent, body: MatchAnswerRequest): Scored {
  if ('optionToken' in body) {
    const presentation = new Map(
      readPresentation(question.presentation).options.map((o) => [o.token, o.key]),
    );
    const correctKey = content.options.find((o) => o.correct)?.key ?? '';
    const scored = scoreTrivia(presentation, body.optionToken, correctKey);
    if (!scored.ok) throw new ApiError(422, 'INVALID_OPTION_TOKEN', 'Unbekannte Antwortoption');
    return { optionKey: scored.optionKey, value: null, distance: null, correct: scored.correct };
  }
  const spec = content.estimate;
  if (!spec) throw new Error('Schätzfrage ohne Daten');
  const parsed = parseNumberInput(body.rawInput, body.locale);
  if (!parsed.ok) {
    throw new ApiError(422, 'INVALID_NUMBER_INPUT', 'Zahl nicht lesbar', { reason: parsed.error });
  }
  const scored = scoreEstimate(parsed.value, spec);
  if (!scored.ok) {
    throw new ApiError(422, 'ANSWER_OUT_OF_RANGE', 'Zahl außerhalb des Eingabebereichs');
  }
  const distance = formatDecimal(scored.distance);
  return {
    optionKey: null,
    value: formatDecimal(scored.rounded),
    distance,
    correct: distance === '0',
  };
}

export async function answerMatchQuestion(
  db: Db,
  ctx: MatchContext,
  params: {
    readonly userId: string;
    readonly matchId: string;
    readonly seq: number;
    readonly body: MatchAnswerRequest;
    readonly idempotencyKey: string;
  },
): Promise<MatchAnswerResponse> {
  // Eingangszeit als Erstes, vor jedem Warten auf Sperren (SIEGE_SYSTEM §6.1)
  const receivedAt = await readGameNow(db);
  return db.transaction().execute(async (tx) => {
    const run = await lockMatchFor(tx, ctx, params.matchId, params.userId);
    const question = await loadQuestion(tx, params.matchId, params.seq);
    const seat = seatAt(run, params.userId, question);
    const kind = question.kind === 'ESTIMATE' ? 'ESTIMATE' : 'TRIVIA';
    if ('optionToken' in params.body !== (kind === 'TRIVIA')) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Antwortart passt nicht zur Frage', { kind });
    }
    const content = await loadQuestionContent(tx, question.version_id);
    const answered = (): MatchAnswerResponse => ({
      matchId: params.matchId,
      seq: params.seq,
      status: 'ANSWERED',
      serverTime: run.now.toISOString(),
    });
    const row = await loadSeatAnswer(tx, params.matchId, params.seq, seat);
    if (!row) throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Frage wurde noch nicht abgeholt');
    if (row.status === 'ANSWERED') {
      // Wiederholung: gleicher Schlüssel und gleicher Inhalt → derselbe Stand; anderer Inhalt
      // mit demselben Schlüssel → Fehler; anderer Schlüssel → nichts ändern (QUIZ_ENGINE §7.1)
      if (row.idempotency_key === params.idempotencyKey) {
        const again = score(question, content, params.body);
        if (again.optionKey !== row.answer_option_key || again.value !== row.answer_value) {
          throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key mit anderer Antwort');
        }
      }
      return answered();
    }
    if (row.status !== 'PRESENTED' || question.resolved_at !== null) {
      throw new ApiError(409, 'STEP_EXPIRED', 'Zeitlimit abgelaufen');
    }
    if (!row.presented_at || !row.answer_deadline_at) throw new Error('Präsentation fehlt');
    if (receivedAt.getTime() >= row.answer_deadline_at.getTime()) {
      throw new ApiError(409, 'STEP_EXPIRED', 'Zeitlimit abgelaufen', {
        deadline: row.answer_deadline_at.toISOString(),
      });
    }
    const keyUsed = await tx
      .selectFrom('match_answers')
      .select('seq')
      .where('match_id', '=', params.matchId)
      .where('seat', '=', seat)
      .where('idempotency_key', '=', params.idempotencyKey)
      .executeTakeFirst();
    if (keyUsed) {
      throw new ApiError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency-Key gehört zu einer anderen Antwort',
      );
    }
    const scored = score(question, content, params.body);
    // effective = clamp(C, max(0, S − cap), S); nach einem Reload ohne Ausgleich (QUIZ_ENGINE §6.2)
    const serverMs = Math.max(0, receivedAt.getTime() - row.presented_at.getTime());
    const clientMs = params.body.clientElapsedMs;
    const timing = effectiveAnswerTime({
      serverMs,
      clientMs,
      capMs: run.rules.timers.latencyAllowanceCapMs,
      reloaded: row.reloads > 0,
    });
    const storableClientMs =
      typeof clientMs === 'number' &&
      Number.isSafeInteger(clientMs) &&
      Math.abs(clientMs) <= INT32_MAX
        ? clientMs
        : null;
    const saved = await tx
      .updateTable('match_answers')
      .set({
        status: 'ANSWERED',
        received_at: receivedAt,
        answer_option_key: scored.optionKey,
        answer_value: scored.value,
        client_elapsed_ms: storableClientMs,
        server_elapsed_ms: serverMs,
        effective_ms: timing.effectiveMs,
        is_correct: scored.correct,
        distance: scored.distance,
        idempotency_key: params.idempotencyKey,
        audit: JSON.stringify({
          reloads: row.reloads,
          clientTimeUsed: timing.clientTimeUsed,
          signal: timing.signal,
          clientElapsedRaw: clientMs ?? null,
        }),
      })
      .where('match_id', '=', params.matchId)
      .where('seq', '=', params.seq)
      .where('seat', '=', seat)
      .where('status', '=', 'PRESENTED')
      .executeTakeFirst();
    if (saved.numUpdatedRows !== 1n) throw new Error('Antwort konnte nicht gespeichert werden');
    // Haben alle Menschen geantwortet, wird sofort aufgelöst
    await run.resolveIfComplete();
    await run.advanceDue();
    await run.commit();
    return answered();
  });
}
