import { createDb, createPool, type Db } from '@rdw/db';

/**
 * Liest die richtigen Antworten einer Herausforderung direkt aus der Testdatenbank, damit E2E-01
 * deterministisch gewinnt. Nur für Tests: Die API verrät Lösungen erst in der Auflösung.
 */

let db: Db | null = null;

export function testDb(): Db {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error('E2E_DATABASE_URL fehlt (globalSetup nicht gelaufen?)');
  db ??= createDb(createPool({ connectionString: url, max: 2, applicationName: 'rdw-e2e' }));
  return db;
}

export async function closeAnswerDb(): Promise<void> {
  if (db) await db.destroy();
  db = null;
}

/** Text der richtigen Option der Wissensfrage (Schritt 0), wie ihn der Spieler sieht. */
export async function correctTriviaText(challengeId: string): Promise<string> {
  const row = await testDb()
    .selectFrom('quiz_challenge_steps as s')
    .innerJoin('question_options as o', 'o.version_id', 's.version_id')
    .innerJoin('question_translations as t', (join) =>
      join.onRef('t.version_id', '=', 's.version_id').on('t.locale', '=', 'de'),
    )
    .select(['o.option_key', 't.option_texts'])
    .where('s.challenge_id', '=', challengeId)
    .where('s.step_index', '=', 0)
    .where('o.is_correct', '=', true)
    .executeTakeFirstOrThrow();
  const texts = (row.option_texts ?? {}) as Record<string, unknown>;
  const text = texts[row.option_key];
  if (typeof text !== 'string') throw new Error(`Optionstext fehlt: ${row.option_key}`);
  return text;
}

/** Exakter Schätzwert (Schritt 1) als deutsche Eingabe. */
export async function exactEstimateInput(challengeId: string): Promise<string> {
  const row = await testDb()
    .selectFrom('quiz_challenge_steps as s')
    .innerJoin('question_versions as v', 'v.id', 's.version_id')
    .select(['v.answer_value'])
    .where('s.challenge_id', '=', challengeId)
    .where('s.step_index', '=', 1)
    .executeTakeFirstOrThrow();
  if (row.answer_value === null) throw new Error('Schätzwert fehlt');
  return row.answer_value.replace('.', ',');
}

/** Schätzung um eine Einheit neben dem Schätzwert (im erlaubten Bereich), deutsch geschrieben. */
export async function offEstimateInput(challengeId: string): Promise<string> {
  const row = await testDb()
    .selectFrom('quiz_challenge_steps as s')
    .innerJoin('question_versions as v', 'v.id', 's.version_id')
    .select(['v.answer_value', 'v.input_min', 'v.input_max'])
    .where('s.challenge_id', '=', challengeId)
    .where('s.step_index', '=', 1)
    .executeTakeFirstOrThrow();
  if (row.answer_value === null) throw new Error('Schätzwert fehlt');
  const value = Number(row.answer_value);
  const min = row.input_min === null ? Number.NEGATIVE_INFINITY : Number(row.input_min);
  const max = row.input_max === null ? Number.POSITIVE_INFINITY : Number(row.input_max);
  const off = [value + 1, value - 1].find((candidate) => candidate >= min && candidate <= max);
  if (off === undefined) throw new Error(`Kein Wert neben ${value} im Bereich ${min}…${max}`);
  return String(off).replace('.', ',');
}

/**
 * Hat die Verteidigung (Garnison) die Wissensfrage richtig? Nur dann folgt auf eine richtige
 * Antwort die Schätzfrage (GAME_RULES §5.2).
 */
export async function defenderTriviaCorrect(challengeId: string): Promise<boolean> {
  const row = await testDb()
    .selectFrom('quiz_answers as a')
    .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
    .select('a.is_correct')
    .where('a.challenge_id', '=', challengeId)
    .where('a.step_index', '=', 0)
    .where('p.role', '=', 'DEFENDER')
    .executeTakeFirstOrThrow();
  return row.is_correct === true;
}

/** Was ein Spieler für die richtige Antwort der Frage `seq` einer Partie anklickt oder eingibt. */
export type MatchSolution =
  | { readonly kind: 'TRIVIA'; readonly optionText: string }
  | { readonly kind: 'ESTIMATE'; readonly input: string };

export async function matchSolution(matchId: string, seq: number): Promise<MatchSolution> {
  const question = await testDb()
    .selectFrom('match_questions as q')
    .innerJoin('question_versions as v', 'v.id', 'q.version_id')
    .select(['q.kind', 'q.version_id', 'v.answer_value'])
    .where('q.match_id', '=', matchId)
    .where('q.seq', '=', seq)
    .executeTakeFirstOrThrow();
  if (question.kind === 'ESTIMATE') {
    if (question.answer_value === null) throw new Error('Schätzwert fehlt');
    return { kind: 'ESTIMATE', input: question.answer_value.replace('.', ',') };
  }
  const row = await testDb()
    .selectFrom('question_options as o')
    .innerJoin('question_translations as t', (join) =>
      join.onRef('t.version_id', '=', 'o.version_id').on('t.locale', '=', 'de'),
    )
    .select(['o.option_key', 't.option_texts'])
    .where('o.version_id', '=', question.version_id)
    .where('o.is_correct', '=', true)
    .executeTakeFirstOrThrow();
  const texts = (row.option_texts ?? {}) as Record<string, unknown>;
  const text = texts[row.option_key];
  if (typeof text !== 'string') throw new Error(`Optionstext fehlt: ${row.option_key}`);
  return { kind: 'TRIVIA', optionText: text };
}
