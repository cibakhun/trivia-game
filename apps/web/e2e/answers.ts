import { createDb, createPool, type Db } from '@rdw/db';

/**
 * Liest die richtigen Antworten einer Herausforderung direkt aus der Testdatenbank, damit E2E-01
 * deterministisch gewinnt. Nur für Tests: Die API verrät Lösungen erst in der Auflösung.
 */

let db: Db | null = null;

function testDb(): Db {
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
