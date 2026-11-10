import { newId, type Db, type Tx } from '@rdw/db';
import {
  effectiveAnswerTime,
  formatDecimal,
  parseDecimal,
  scoreEstimate,
  scoreTrivia,
} from '@rdw/game-core';
import {
  parseNumberInput,
  type AnswerRequest,
  type AnswerResponse,
  type BattleSide,
  type ChallengeView,
  type Locale,
  type PresentResponse,
  type PresentedQuestion,
  type QuestionKind,
  type Resolution,
  type SiegeStatus,
} from '@rdw/protocol';
import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import { readGameNow } from '../../infra/clock.ts';
import { randomToken } from '../../infra/crypto.ts';
import { ApiError } from '../../infra/errors.ts';
import { appendBattleEvents } from '../../infra/events.ts';
import { settleSiege } from '../combat/settle.ts';
import { parseSnapshot, type SiegeRulesSnapshot } from '../combat/snapshot.ts';
import { loadKingdoms } from '../kingdom/queries.ts';
import { loadQuestionContent, recordExposure, type QuestionContent } from './questions.ts';

/**
 * Herausforderungsprotokoll (QUIZ_ENGINE §7): `present` stellt eine Frage und hält
 * `presented_at` fest (wiederholbar, dieselbe Frage), `answer` speichert die Antwort mit dem
 * Eingangszeitpunkt vor jeder Sperre und wertet nach dem letzten Schritt aus. Vor der Auflösung
 * verrät keine Antwort Lösung, Richtigkeit oder Gegnerleistung (§7.2).
 */

interface ChallengeHead {
  readonly challengeId: string;
  readonly siegeId: string;
  readonly instanceId: string;
  readonly mode: 'PVE' | 'PVP';
  readonly status: SiegeStatus;
  readonly targetRegionId: string;
  readonly participantId: string;
  readonly userId: string;
  readonly locale: Locale;
  readonly snapshot: SiegeRulesSnapshot;
}

interface StepRow {
  readonly step_index: number;
  readonly kind: string;
  readonly version_id: string;
  readonly time_limit_ms: number;
}

interface AnswerRow {
  readonly id: string;
  readonly step_index: number;
  readonly status: string;
  readonly presentation: unknown;
  readonly presented_at: Date | null;
  readonly answer_deadline_at: Date | null;
  readonly answer_option_key: string | null;
  readonly answer_value: string | null;
  readonly raw_input: string | null;
  readonly distance: string | null;
  readonly effective_ms: number | null;
  readonly is_correct: boolean | null;
  readonly idempotency_key: string | null;
}

const ANSWER_COLUMNS = [
  'id',
  'step_index',
  'status',
  'presentation',
  'presented_at',
  'answer_deadline_at',
  'answer_option_key',
  'answer_value',
  'raw_input',
  'distance',
  'effective_ms',
  'is_correct',
  'idempotency_key',
] as const;

/** Herausforderung des Spielers; fremde Herausforderungen sind „nicht gefunden“. */
async function loadHead(db: Db, challengeId: string, userId: string): Promise<ChallengeHead> {
  const row = await db
    .selectFrom('quiz_challenges as c')
    .innerJoin('sieges as s', 's.id', 'c.siege_id')
    .innerJoin('siege_participants as p', (join) =>
      join.onRef('p.siege_id', '=', 's.id').on('p.role', '=', 'ATTACKER'),
    )
    .select([
      'c.id',
      'c.siege_id',
      's.instance_id',
      's.mode',
      's.status',
      's.target_region_id',
      's.rules_snapshot',
      'p.id as participant_id',
      'p.user_id',
      'p.locale',
    ])
    .where('c.id', '=', challengeId)
    .where('p.user_id', '=', userId)
    .executeTakeFirst();
  if (!row?.user_id) throw new ApiError(404, 'NOT_FOUND', 'Herausforderung nicht gefunden');
  return {
    challengeId: row.id,
    siegeId: row.siege_id,
    instanceId: row.instance_id,
    mode: row.mode === 'PVP' ? 'PVP' : 'PVE',
    status: row.status as SiegeStatus,
    targetRegionId: row.target_region_id,
    participantId: row.participant_id,
    userId: row.user_id,
    locale: 'de',
    snapshot: parseSnapshot(row.rules_snapshot),
  };
}

async function loadSteps(db: Db, challengeId: string): Promise<StepRow[]> {
  return db
    .selectFrom('quiz_challenge_steps')
    .select(['step_index', 'kind', 'version_id', 'time_limit_ms'])
    .where('challenge_id', '=', challengeId)
    .orderBy('step_index')
    .execute();
}

async function loadAnswers(db: Db, participantId: string): Promise<AnswerRow[]> {
  return db
    .selectFrom('quiz_answers')
    .select([...ANSWER_COLUMNS])
    .where('participant_id', '=', participantId)
    .orderBy('step_index')
    .execute();
}

function stepOf(steps: readonly StepRow[], index: number): StepRow {
  const step = steps.find((s) => s.step_index === index);
  if (!step) throw new ApiError(404, 'NOT_FOUND', 'Schritt nicht gefunden');
  return step;
}

// ---------------------------------------------------------------------------------------------
// Präsentation
// ---------------------------------------------------------------------------------------------

interface Presentation {
  readonly options: readonly { readonly token: string; readonly key: string }[];
}

function readPresentation(value: unknown): Presentation {
  const options = (value as { options?: unknown } | null)?.options;
  if (!Array.isArray(options)) return { options: [] };
  return {
    options: options.flatMap((o: unknown) => {
      const entry = o as { token?: unknown; key?: unknown };
      return typeof entry.token === 'string' && typeof entry.key === 'string'
        ? [{ token: entry.token, key: entry.key }]
        : [];
    }),
  };
}

/** Neue Zufallstoken und -reihenfolge je Präsentation (QUIZ_ENGINE §2), aus dem Systemzufall. */
function newPresentation(content: QuestionContent): Record<string, unknown> {
  if (content.kind === 'ESTIMATE') return { kind: 'ESTIMATE' };
  const keys = content.options.map((o) => o.key);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [keys[i], keys[j]] = [keys[j] as string, keys[i] as string];
  }
  return { kind: 'TRIVIA', options: keys.map((key) => ({ token: randomToken(8), key })) };
}

function toQuestion(
  head: ChallengeHead,
  step: StepRow,
  row: AnswerRow,
  content: QuestionContent,
  now: Date,
): PresentedQuestion {
  if (!row.presented_at || !row.answer_deadline_at) throw new Error('Schritt ohne Präsentation');
  const base = {
    challengeId: head.challengeId,
    step: step.step_index,
    prompt: content.prompt,
    timeLimitMs: step.time_limit_ms,
    remainingMs: Math.max(0, row.answer_deadline_at.getTime() - now.getTime()),
    presentedAt: row.presented_at.toISOString(),
  };
  if (content.kind === 'TRIVIA') {
    const texts = new Map(content.options.map((o) => [o.key, o.text]));
    return {
      ...base,
      kind: 'TRIVIA',
      options: readPresentation(row.presentation).options.map((o) => ({
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

/** Legt die Präsentation eines Schritts an; `presented_at` ist die Spielzeit der Transaktion. */
async function insertPresented(
  tx: Tx,
  head: ChallengeHead,
  step: StepRow,
  content: QuestionContent,
  now: Date,
): Promise<void> {
  const deadline = now.getTime() + step.time_limit_ms + head.snapshot.quiz.latencyAllowanceCapMs;
  await tx
    .insertInto('quiz_answers')
    .values({
      id: newId(),
      challenge_id: head.challengeId,
      siege_id: head.siegeId,
      participant_id: head.participantId,
      step_index: step.step_index,
      locale: head.locale,
      presentation: JSON.stringify(newPresentation(content)),
      presented_at: now,
      answer_deadline_at: new Date(deadline),
      status: 'PRESENTED',
      created_at: now,
    })
    .execute();
  await recordExposure(tx, head.userId, content.questionId);
}

async function txNow(tx: Tx): Promise<Date> {
  const { rows } = await sql<{ now: Date }>`select game_now() as now`.execute(tx);
  const row = rows[0];
  if (!row) throw new Error('game_now() lieferte keine Zeile');
  return row.now;
}

export async function presentStep(
  db: Db,
  params: { readonly userId: string; readonly challengeId: string; readonly step: number },
): Promise<PresentResponse> {
  let head = await loadHead(db, params.challengeId, params.userId);
  if (head.status === 'PREPARING') {
    await settleSiege(db, head.siegeId); // abgelaufene Schritte zuerst abschließen
    head = await loadHead(db, params.challengeId, params.userId);
  }
  if (head.status !== 'PREPARING') {
    throw new ApiError(409, 'CHALLENGE_CLOSED', 'Herausforderung ist beendet', {
      status: head.status,
    });
  }
  const steps = await loadSteps(db, head.challengeId);
  const step = stepOf(steps, params.step);
  const content = await loadQuestionContent(db, step.version_id);

  return db.transaction().execute(async (tx) => {
    // Sperre auf die Belagerung: ordnet Präsentation, Versuchszählung und Protokolleinträge.
    const siege = await tx
      .selectFrom('sieges')
      .select(['status', 'attack_presented_at'])
      .where('id', '=', head.siegeId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (siege.status !== 'PREPARING') {
      throw new ApiError(409, 'CHALLENGE_CLOSED', 'Herausforderung ist beendet', {
        status: siege.status,
      });
    }
    const now = await txNow(tx);
    const answers = await loadAnswers(tx, head.participantId);
    const existing = answers.find((a) => a.step_index === step.step_index);
    if (existing) {
      if (existing.status !== 'PRESENTED') {
        throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Schritt ist schon abgeschlossen', {
          status: existing.status,
        });
      }
      // Reload: dieselbe Frage mit dem ursprünglichen P; der Client-Timer gilt nicht mehr (§6.2).
      await appendBattleEvents(tx, head.siegeId, [
        { type: 'STEP_RELOADED', payload: { step: step.step_index } },
      ]);
      return {
        question: toQuestion(head, step, existing, content, now),
        serverTime: now.toISOString(),
      };
    }
    if (step.step_index !== 0) {
      // Schritt 1 entsteht mit der Antwort auf Schritt 0 (§7.1 Punkt 4).
      throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Erst die vorige Frage beantworten');
    }
    await insertPresented(tx, head, step, content, now);
    if (siege.attack_presented_at === null) {
      // Ab jetzt zählt der Angriffsversuch (GAME_RULES §4).
      await tx
        .updateTable('sieges')
        .set({ attack_presented_at: now, version: sql<number>`version + 1` })
        .where('id', '=', head.siegeId)
        .execute();
      await appendBattleEvents(tx, head.siegeId, [{ type: 'ATTACK_PRESENTED', payload: {} }]);
    }
    const row = (await loadAnswers(tx, head.participantId)).find((a) => a.step_index === 0);
    if (!row) throw new Error('Präsentation fehlt');
    return { question: toQuestion(head, step, row, content, now), serverTime: now.toISOString() };
  });
}

// ---------------------------------------------------------------------------------------------
// Antwort
// ---------------------------------------------------------------------------------------------

const INT32_MAX = 2_147_483_647;

/** Prüft, ob eine gespeicherte Antwort zur wiederholten Anfrage passt. */
function sameAnswer(row: AnswerRow, body: AnswerRequest): boolean {
  if ('optionToken' in body) {
    const key = readPresentation(row.presentation).options.find(
      (o) => o.token === body.optionToken,
    )?.key;
    return key !== undefined && key === row.answer_option_key;
  }
  return body.rawInput === row.raw_input;
}

export async function answerStep(
  db: Db,
  params: {
    readonly userId: string;
    readonly challengeId: string;
    readonly step: number;
    readonly body: AnswerRequest;
    readonly idempotencyKey: string;
  },
): Promise<AnswerResponse> {
  // Eingangszeit als Erstes, vor jedem Warten auf Sperren (SIEGE_SYSTEM §6.1)
  const receivedAt = await readGameNow(db);
  const head = await loadHead(db, params.challengeId, params.userId);
  const steps = await loadSteps(db, head.challengeId);
  const step = stepOf(steps, params.step);
  const kind: QuestionKind = step.kind === 'ESTIMATE' ? 'ESTIMATE' : 'TRIVIA';
  if ('optionToken' in params.body !== (kind === 'TRIVIA')) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Antwortart passt nicht zur Frage', { kind });
  }
  const content = await loadQuestionContent(db, step.version_id);

  // 1. Antwort speichern – kurze Transaktion ohne Sperre auf die Belagerung
  await db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('quiz_answers')
      .select([...ANSWER_COLUMNS])
      .where('participant_id', '=', head.participantId)
      .where('step_index', '=', step.step_index)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Frage wurde noch nicht gestellt');
    if (row.status === 'ANSWERED') {
      // Wiederholung: gleicher Schlüssel und gleicher Inhalt → gespeicherter Stand; anderer
      // Inhalt mit demselben Schlüssel → Fehler; anderer Schlüssel → nichts ändern (§7.1).
      if (row.idempotency_key === params.idempotencyKey && !sameAnswer(row, params.body)) {
        throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key mit anderer Antwort');
      }
      return;
    }
    if (row.status === 'TIMED_OUT') throw new ApiError(409, 'STEP_EXPIRED', 'Zeitlimit abgelaufen');
    if (!row.presented_at || !row.answer_deadline_at) throw new Error('Präsentation fehlt');
    const siege = await tx
      .selectFrom('sieges')
      .select('status')
      .where('id', '=', head.siegeId)
      .executeTakeFirstOrThrow();
    if (siege.status !== 'PREPARING') {
      throw new ApiError(409, 'CHALLENGE_CLOSED', 'Herausforderung ist beendet', {
        status: siege.status,
      });
    }
    if (receivedAt.getTime() >= row.answer_deadline_at.getTime()) {
      throw new ApiError(409, 'STEP_EXPIRED', 'Zeitlimit abgelaufen', {
        deadline: row.answer_deadline_at.toISOString(),
      });
    }
    const keyUsed = await tx
      .selectFrom('quiz_answers')
      .select('step_index')
      .where('participant_id', '=', head.participantId)
      .where('idempotency_key', '=', params.idempotencyKey)
      .executeTakeFirst();
    if (keyUsed) {
      throw new ApiError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency-Key gehört zu einer anderen Antwort',
      );
    }

    // Bewertung
    let optionKey: string | null = null;
    let value: string | null = null;
    let rawInput: string | null = null;
    let distance: string | null = null;
    let correct: boolean;
    if ('optionToken' in params.body) {
      const presentation = new Map(
        readPresentation(row.presentation).options.map((o) => [o.token, o.key]),
      );
      const correctKey = content.options.find((o) => o.correct)?.key ?? '';
      const scored = scoreTrivia(presentation, params.body.optionToken, correctKey);
      if (!scored.ok) throw new ApiError(422, 'INVALID_OPTION_TOKEN', 'Unbekannte Antwortoption');
      optionKey = scored.optionKey;
      correct = scored.correct;
    } else {
      const spec = content.estimate;
      if (!spec) throw new Error('Schätzfrage ohne Daten');
      const parsed = parseNumberInput(params.body.rawInput, params.body.locale);
      if (!parsed.ok) {
        throw new ApiError(422, 'INVALID_NUMBER_INPUT', 'Zahl nicht lesbar', {
          reason: parsed.error,
        });
      }
      const scored = scoreEstimate(parsed.value, spec);
      if (!scored.ok)
        throw new ApiError(422, 'ANSWER_OUT_OF_RANGE', 'Zahl außerhalb des Eingabebereichs');
      rawInput = params.body.rawInput;
      value = formatDecimal(scored.rounded);
      distance = formatDecimal(scored.distance);
      correct = distance === '0';
    }

    // Zeit: effective = clamp(C, max(0, S − cap), S); nach Reload ohne Ausgleich (QUIZ_ENGINE §6.2)
    const reloaded = await tx
      .selectFrom('battle_events')
      .select('id')
      .where('siege_id', '=', head.siegeId)
      .where('type', '=', 'STEP_RELOADED')
      .where(sql<boolean>`(payload ->> 'step')::int = ${step.step_index}`)
      .executeTakeFirst();
    const serverMs = Math.max(0, receivedAt.getTime() - row.presented_at.getTime());
    const clientMs = params.body.clientElapsedMs;
    const timing = effectiveAnswerTime({
      serverMs,
      clientMs,
      capMs: head.snapshot.quiz.latencyAllowanceCapMs,
      reloaded: reloaded !== undefined,
    });
    const storableClientMs =
      typeof clientMs === 'number' &&
      Number.isSafeInteger(clientMs) &&
      Math.abs(clientMs) <= INT32_MAX
        ? clientMs
        : null;
    const saved = await tx
      .updateTable('quiz_answers')
      .set({
        status: 'ANSWERED',
        received_at: receivedAt,
        answer_option_key: optionKey,
        answer_value: value,
        raw_input: rawInput,
        client_elapsed_ms: storableClientMs,
        server_elapsed_ms: serverMs,
        effective_ms: timing.effectiveMs,
        is_correct: correct,
        distance,
        idempotency_key: params.idempotencyKey,
        audit: JSON.stringify({
          reloaded: reloaded !== undefined,
          clientTimeUsed: timing.clientTimeUsed,
          signal: timing.signal,
          clientElapsedRaw: clientMs ?? null,
        }),
      })
      .where('id', '=', row.id)
      .where('status', '=', 'PRESENTED')
      .executeTakeFirst();
    if (saved.numUpdatedRows !== 1n) throw new Error('Antwort konnte nicht gespeichert werden');

    // Nach Schritt 0 sofort die Schätzfrage stellen (§7.1 Punkt 4: kein Vorausladen, keine Lücke)
    const next = steps.find((s) => s.step_index === step.step_index + 1);
    if (next) {
      const nextContent = await loadQuestionContent(tx, next.version_id);
      await insertPresented(tx, head, next, nextContent, await txNow(tx));
    }
  });

  // 2. Auswerten (eigene Transaktion mit Sperren); idempotent, also auch bei Wiederholung
  const last = steps.every((s) => s.step_index <= step.step_index);
  if (last) await settleSiege(db, head.siegeId);

  const now = await readGameNow(db);
  let next: PresentedQuestion | null = null;
  let resolution: Resolution | null = null;
  if (!last) {
    const nextStep = stepOf(steps, step.step_index + 1);
    const row = (await loadAnswers(db, head.participantId)).find(
      (a) => a.step_index === nextStep.step_index && a.status === 'PRESENTED',
    );
    if (row) {
      next = toQuestion(
        head,
        nextStep,
        row,
        await loadQuestionContent(db, nextStep.version_id),
        now,
      );
    }
  } else {
    resolution = await loadResolution(db, head.siegeId);
  }
  return {
    challengeId: head.challengeId,
    step: step.step_index,
    status: 'ANSWERED',
    next,
    resolution,
    serverTime: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Ansicht und Auflösung
// ---------------------------------------------------------------------------------------------

export async function challengeView(
  db: Db,
  params: { readonly userId: string; readonly challengeId: string },
): Promise<ChallengeView> {
  let head = await loadHead(db, params.challengeId, params.userId);
  if (head.status === 'PREPARING') {
    await settleSiege(db, head.siegeId); // Auflösung beim Lesen
    head = await loadHead(db, params.challengeId, params.userId);
  }
  const steps = await loadSteps(db, head.challengeId);
  const answers = await loadAnswers(db, head.participantId);
  const now = await readGameNow(db);
  const open = head.status === 'PREPARING';
  const statusOf = (index: number) => {
    const status = answers.find((a) => a.step_index === index)?.status;
    return status === 'PRESENTED' || status === 'ANSWERED' || status === 'TIMED_OUT'
      ? status
      : 'PENDING';
  };
  const current = open
    ? (steps.find(
        (s) => statusOf(s.step_index) === 'PENDING' || statusOf(s.step_index) === 'PRESENTED',
      ) ?? null)
    : null;
  let question: PresentedQuestion | null = null;
  if (current && statusOf(current.step_index) === 'PRESENTED') {
    const row = answers.find((a) => a.step_index === current.step_index);
    if (row)
      question = toQuestion(
        head,
        current,
        row,
        await loadQuestionContent(db, current.version_id),
        now,
      );
  }
  return {
    challengeId: head.challengeId,
    siegeId: head.siegeId,
    instanceId: head.instanceId,
    mode: head.mode,
    targetRegionId: head.targetRegionId,
    status: head.status,
    steps: steps.map((s) => ({
      index: s.step_index,
      kind: s.kind === 'ESTIMATE' ? 'ESTIMATE' : 'TRIVIA',
      timeLimitMs: s.time_limit_ms,
      status: statusOf(s.step_index),
    })),
    currentStep: current?.step_index ?? null,
    question,
    resolution: open ? null : await loadResolution(db, head.siegeId),
    serverTime: now.toISOString(),
  };
}

function canonical(value: string | null): string | null {
  return value === null ? null : formatDecimal(parseDecimal(value));
}

/**
 * Vollständige Auflösung beider Seiten (QUIZ_ENGINE §7.2), sobald die Belagerung beendet ist.
 * Gezeigt werden nur Fragen, die der Spieler gesehen hat: Eine nie gestellte Frage bleibt im
 * Bestand und kann später gestellt werden.
 */
export async function loadResolution(db: Db, siegeId: string): Promise<Resolution | null> {
  const row = await db
    .selectFrom('sieges as s')
    .innerJoin('battle_results as b', 'b.siege_id', 's.id')
    .innerJoin('quiz_challenges as c', 'c.siege_id', 's.id')
    .innerJoin('region_state as rs', 'rs.region_id', 's.target_region_id')
    .select([
      's.id',
      's.instance_id',
      's.status',
      's.outcome',
      's.outcome_reason',
      's.resolved_at',
      's.target_region_id',
      's.attacker_kingdom_id',
      's.defender_kingdom_id',
      's.defender_kind',
      'c.id as challenge_id',
      'rs.owner_kingdom_id',
      sql<Date | null>`case when rs.protected_until > game_now() then rs.protected_until end`.as(
        'protected_until',
      ),
    ])
    .where('s.id', '=', siegeId)
    .executeTakeFirst();
  if (!row?.resolved_at || !row.outcome || !row.outcome_reason) return null;
  const steps = await loadSteps(db, row.challenge_id);
  const answers = await db
    .selectFrom('quiz_answers as a')
    .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
    .select(['p.role', ...ANSWER_COLUMNS.map((c) => `a.${c}` as const)])
    .where('a.siege_id', '=', siegeId)
    .execute();
  const attackerRows = answers.filter((a) => a.role === 'ATTACKER');
  const defenderRows = answers.filter((a) => a.role === 'DEFENDER');
  const shown = (index: number) => attackerRows.some((a) => a.step_index === index);

  const triviaStep = steps.find((s) => s.step_index === 0);
  const estimateStep = steps.find((s) => s.step_index === 1);
  const triviaContent =
    triviaStep && shown(0) ? await loadQuestionContent(db, triviaStep.version_id) : null;
  const estimateContent =
    estimateStep && shown(1) ? await loadQuestionContent(db, estimateStep.version_id) : null;
  const optionText = (key: string | null) =>
    key === null ? null : (triviaContent?.options.find((o) => o.key === key)?.text ?? null);

  const kingdoms = await loadKingdoms(
    db,
    row.instance_id,
    [row.attacker_kingdom_id, row.defender_kingdom_id].filter((id): id is string => id !== null),
  );
  const side = (
    rows: readonly (AnswerRow & { role: string })[],
    kind: BattleSide['kind'],
    kingdomId: string | null,
  ): BattleSide => {
    const trivia = rows.find((a) => a.step_index === 0);
    const estimate = rows.find((a) => a.step_index === 1);
    const triviaDone =
      triviaContent && trivia && (trivia.status === 'ANSWERED' || trivia.status === 'GENERATED');
    const estimateDone =
      estimateContent &&
      estimate &&
      (estimate.status === 'ANSWERED' || estimate.status === 'GENERATED');
    return {
      kind,
      kingdom: kingdomId ? (kingdoms.get(kingdomId) ?? null) : null,
      triviaAnswer: triviaDone ? optionText(trivia.answer_option_key) : null,
      triviaCorrect: triviaDone ? trivia.is_correct === true : false,
      estimate: estimateDone ? canonical(estimate.answer_value) : null,
      estimateDistance: estimateDone ? canonical(estimate.distance) : null,
      estimateEffectiveMs: estimateDone ? estimate.effective_ms : null,
    };
  };
  const attackerOrder = readPresentation(
    attackerRows.find((a) => a.step_index === 0)?.presentation,
  ).options.map((o) => o.key);
  const conquered = row.status === 'ATTACKER_WON' || row.status === 'ATTACKER_WON_BY_TIMEOUT';
  return {
    siegeId: row.id,
    status: row.status as SiegeStatus,
    winner: row.outcome as Resolution['winner'],
    reason: row.outcome_reason as Resolution['reason'],
    regionId: row.target_region_id,
    conquered,
    regionProtectedUntil:
      conquered && row.owner_kingdom_id === row.attacker_kingdom_id
        ? (row.protected_until?.toISOString() ?? null)
        : null,
    trivia: triviaContent
      ? {
          prompt: triviaContent.prompt,
          options: (attackerOrder.length > 0
            ? attackerOrder
            : triviaContent.options.map((o) => o.key)
          ).map((key) => ({
            text: optionText(key) ?? '',
            correct: triviaContent.options.find((o) => o.key === key)?.correct ?? false,
          })),
          explanation: triviaContent.explanation,
        }
      : null,
    estimate: estimateContent?.estimate
      ? {
          prompt: estimateContent.prompt,
          answerValue: formatDecimal(parseDecimal(estimateContent.estimate.answerValue)),
          unitLabel: estimateContent.estimate.unitLabel,
          explanation: estimateContent.explanation,
        }
      : null,
    attacker: side(attackerRows, 'PLAYER', row.attacker_kingdom_id),
    defender: side(
      defenderRows,
      row.defender_kind === 'NPC' ? 'NPC' : row.defender_kind === 'PLAYER' ? 'PLAYER' : 'NEUTRAL',
      row.defender_kingdom_id,
    ),
    resolvedAt: row.resolved_at.toISOString(),
  };
}
