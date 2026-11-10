import type { Db } from '@rdw/db';
import { RECENT_CATEGORY_COUNT, type QuestionCandidate } from '@rdw/game-core';
import { DEFAULT_LOCALE, type EstimateScaleType, type QuestionKind } from '@rdw/protocol';
import { sql } from 'kysely';

/**
 * Fragenbestand für Herausforderungen (Modul quiz, ARCHITECTURE §6). Gestellt werden nur
 * freigegebene Versionen aktiver Fragen; Testfragen nur in local und test (ADR-021, O-02). Die
 * Datenbank prüft dieselbe Regel noch einmal beim Anlegen der Schritte (Trigger aus 0006).
 */

export interface CandidateQuery {
  readonly kind: QuestionKind;
  /**
   * Menschliche Beteiligte: Gesehen ist eine Frage, wenn einer von ihnen sie gesehen hat (QUIZ_ENGINE
   * §5 Punkt 3). Im PvP sind das Angreifer und Verteidiger.
   */
  readonly userIds: readonly string[];
  readonly allowFixtures: boolean;
  /** Spielzeit der Auswahl. */
  readonly now: Date;
}

/** Belagerungen, deren Fragen noch nicht alle Beteiligten gesehen haben. */
const OPEN_SIEGE_STATUSES = ['PREPARING', 'AWAITING_DEFENSE', 'DEFENDING'] as const;

export async function loadCandidates(db: Db, query: CandidateQuery): Promise<QuestionCandidate[]> {
  const rows = await db
    .selectFrom('questions as q')
    .innerJoin('question_versions as v', 'v.id', 'q.current_version_id')
    .innerJoin('question_translations as t', (join) =>
      join.onRef('t.version_id', '=', 'v.id').on('t.locale', '=', DEFAULT_LOCALE),
    )
    .select(['v.id as version_id', 'q.id as question_id', 'q.category', 'v.difficulty'])
    .where('q.kind', '=', query.kind)
    .where((eb) =>
      eb.or([
        eb.and([eb('v.status', '=', 'APPROVED'), eb('q.status', '=', 'ACTIVE')]),
        ...(query.allowFixtures
          ? [eb.and([eb('q.is_fixture', '=', true), eb('v.status', '<>', 'RETIRED')])]
          : []),
      ]),
    )
    .execute();
  if (query.userIds.length === 0) throw new Error('Fragenauswahl ohne Beteiligte');
  const lastSeen = new Map<string, number>();
  const seen = await db
    .selectFrom('player_question_exposure')
    .select((eb) => ['question_id', eb.fn.max('last_seen_at').as('last_seen_at')])
    .where('user_id', 'in', query.userIds)
    .groupBy('question_id')
    .execute();
  for (const row of seen) lastSeen.set(row.question_id, new Date(row.last_seen_at).getTime());
  // Fragen offener Belagerungen eines Beteiligten gelten als gerade gesehen: Sonst könnte ein
  // Verteidiger die Frage seiner Belagerung vor der Verteidigung in einem eigenen Kampf samt
  // Lösung sehen (die Gesehen-Liste füllt sich erst beim Stellen).
  const pending = await db
    .selectFrom('quiz_challenge_steps as st')
    .innerJoin('quiz_challenges as c', 'c.id', 'st.challenge_id')
    .innerJoin('sieges as s', 's.id', 'c.siege_id')
    .innerJoin('siege_participants as p', 'p.siege_id', 's.id')
    .innerJoin('question_versions as v', 'v.id', 'st.version_id')
    .select('v.question_id')
    .distinct()
    .where('s.status', 'in', [...OPEN_SIEGE_STATUSES])
    .where('p.user_id', 'in', query.userIds)
    .where('st.kind', '=', query.kind)
    .execute();
  for (const row of pending) lastSeen.set(row.question_id, query.now.getTime());
  return rows.map((row) => ({
    versionId: row.version_id,
    questionId: row.question_id,
    category: row.category,
    difficulty: row.difficulty,
    lastSeenAt: lastSeen.get(row.question_id) ?? null,
  }));
}

/** Kategorien der zuletzt gesehenen Fragen des Spielers, neueste zuerst. */
export async function loadRecentCategories(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('player_question_exposure as e')
    .innerJoin('questions as q', 'q.id', 'e.question_id')
    .select('q.category')
    .where('e.user_id', '=', userId)
    .orderBy('e.last_seen_at', 'desc')
    .limit(RECENT_CATEGORY_COUNT)
    .execute();
  return rows.map((row) => row.category);
}

export interface QuestionOption {
  readonly key: string;
  readonly correct: boolean;
  readonly text: string;
}

export interface QuestionContent {
  readonly versionId: string;
  readonly questionId: string;
  readonly kind: QuestionKind;
  readonly category: string;
  readonly difficulty: number;
  readonly calibratedDifficulty: number | null;
  readonly prompt: string;
  readonly explanation: string | null;
  /** Nur Trivia: Optionen nach Schlüssel sortiert. */
  readonly options: readonly QuestionOption[];
  /** Nur Schätzfragen. */
  readonly estimate: {
    readonly answerValue: string;
    readonly answerPrecision: number;
    readonly inputMin: string;
    readonly inputMax: string;
    readonly scaleType: EstimateScaleType;
    readonly scale: number;
    readonly unitLabel: string | null;
  } | null;
}

/** Inhalt einer Fragenversion in der Spielsprache; wirft, wenn Teile fehlen. */
export async function loadQuestionContent(db: Db, versionId: string): Promise<QuestionContent> {
  const row = await db
    .selectFrom('question_versions as v')
    .innerJoin('questions as q', 'q.id', 'v.question_id')
    .innerJoin('question_translations as t', (join) =>
      join.onRef('t.version_id', '=', 'v.id').on('t.locale', '=', DEFAULT_LOCALE),
    )
    .select([
      'v.id',
      'v.question_id',
      'v.kind',
      'q.category',
      'v.difficulty',
      'v.calibrated_difficulty',
      'v.answer_value',
      'v.answer_precision',
      'v.input_min',
      'v.input_max',
      'v.estimate_scale_type',
      'v.estimate_scale',
      't.prompt',
      't.option_texts',
      't.unit_label',
      't.explanation',
    ])
    .where('v.id', '=', versionId)
    .executeTakeFirstOrThrow();
  const kind: QuestionKind = row.kind === 'ESTIMATE' ? 'ESTIMATE' : 'TRIVIA';
  let options: QuestionOption[] = [];
  if (kind === 'TRIVIA') {
    const texts = (row.option_texts ?? {}) as Record<string, unknown>;
    const optionRows = await db
      .selectFrom('question_options')
      .select(['option_key', 'is_correct'])
      .where('version_id', '=', versionId)
      .orderBy('option_key')
      .execute();
    options = optionRows.map((o) => {
      const text = texts[o.option_key];
      if (typeof text !== 'string') {
        throw new Error(`Option ${o.option_key} der Version ${versionId} ohne Text`);
      }
      return { key: o.option_key, correct: o.is_correct, text };
    });
    if (options.filter((o) => o.correct).length !== 1 || options.length < 2) {
      throw new Error(`Version ${versionId}: Optionen unvollständig`);
    }
  }
  let estimate: QuestionContent['estimate'] = null;
  if (kind === 'ESTIMATE') {
    if (
      row.answer_value === null ||
      row.answer_precision === null ||
      row.input_min === null ||
      row.input_max === null ||
      row.estimate_scale === null ||
      (row.estimate_scale_type !== 'LINEAR' && row.estimate_scale_type !== 'LOG')
    ) {
      throw new Error(`Schätzfrage ${versionId} unvollständig`);
    }
    estimate = {
      answerValue: row.answer_value,
      answerPrecision: row.answer_precision,
      inputMin: row.input_min,
      inputMax: row.input_max,
      scaleType: row.estimate_scale_type,
      scale: Number(row.estimate_scale),
      unitLabel: row.unit_label,
    };
  }
  return {
    versionId: row.id,
    questionId: row.question_id,
    kind,
    category: row.category,
    difficulty: row.difficulty,
    calibratedDifficulty:
      row.calibrated_difficulty === null ? null : Number(row.calibrated_difficulty),
    prompt: row.prompt,
    explanation: row.explanation,
    options,
    estimate,
  };
}

/** Merkt, dass der Spieler die Frage gesehen hat (Ausschlussfenster, QUIZ_ENGINE §5.3). */
export async function recordExposure(db: Db, userId: string, questionId: string): Promise<void> {
  await db
    .insertInto('player_question_exposure')
    .values({ user_id: userId, question_id: questionId, last_seen_at: sql<Date>`game_now()` })
    .onConflict((oc) =>
      oc.columns(['user_id', 'question_id']).doUpdateSet({
        last_seen_at: sql<Date>`excluded.last_seen_at`,
        times: sql<number>`player_question_exposure.times + 1`,
      }),
    )
    .execute();
}
