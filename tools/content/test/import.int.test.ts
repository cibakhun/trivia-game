import { fileURLToPath } from 'node:url';
import { createDb, type Db } from '@rdw/db';
import { createTestDatabase, type TestDatabase } from '@rdw/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  importQuestions,
  ImportError,
  validateContentDir,
  validateQuestionText,
  type ValidatedQuestion,
} from '../src/index.ts';

/** Fragenimport gegen eine frisch migrierte Datenbank (QUIZ_ENGINE §9.1, Brief §5.6). */

const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
const today = '2026-11-09';

let testDb: TestDatabase;
let db: Db;

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
});
afterAll(async () => {
  // db.destroy() würde den Pool beenden; drop() übernimmt das.
  await testDb.drop();
});

function trivia(key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    key,
    kind: 'TRIVIA',
    category: 'SCIENCE',
    difficulty: 2,
    origin: 'AI_ASSISTED',
    license_note: null,
    status: 'DRAFT',
    tags: [],
    sources: [{ title: 'Gold', url: 'https://en.wikipedia.org/wiki/Gold', accessed: today }],
    reviews: [],
    trivia: { options: ['a', 'b', 'c', 'd'], correct: 'b' },
    translations: {
      de: {
        status: 'DRAFT',
        prompt: 'Welches chemische Symbol hat Gold?',
        options: { a: 'Ag', b: 'Au', c: 'Go', d: 'Gd' },
      },
    },
    ...overrides,
  };
}

function approved(q: Record<string, unknown>): Record<string, unknown> {
  const de = (q.translations as { de: Record<string, unknown> }).de;
  return {
    ...q,
    status: 'APPROVED',
    reviews: [
      { kind: 'FACT', reviewer: 'Redaktion A', date: today },
      { kind: 'LANGUAGE', locale: 'de', reviewer: 'Lektorat', date: today },
    ],
    translations: { de: { ...de, status: 'APPROVED' } },
  };
}

function withPrompt(q: Record<string, unknown>, prompt: string): Record<string, unknown> {
  const de = (q.translations as { de: Record<string, unknown> }).de;
  return { ...q, translations: { de: { ...de, prompt } } };
}

/** Wie aus einer Datei gelesen; `check: false` umgeht die Dateiprüfung (Datenbank prüft selbst). */
function file(q: Record<string, unknown>, { fixture = false, check = true } = {}): ValidatedQuestion {
  const key = String(q.key);
  const result = validateQuestionText(stringify(q), { file: `${key}.yaml`, fixture });
  if (!result.question) throw new Error(`ungültig: ${JSON.stringify(result.issues)}`);
  if (check) expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  return { file: `${key}.yaml`, question: result.question, fixture };
}

async function state(key: string) {
  const question = await db
    .selectFrom('questions')
    .select(['id', 'status', 'current_version_id', 'is_fixture', 'tags'])
    .where('key', '=', key)
    .executeTakeFirstOrThrow();
  const versions = await db
    .selectFrom('question_versions')
    .select(['id', 'version', 'status', 'approved_at'])
    .where('question_id', '=', question.id)
    .orderBy('version')
    .execute();
  const current = versions.find((v) => v.id === question.current_version_id);
  return {
    status: question.status,
    isFixture: question.is_fixture,
    tags: question.tags,
    current: current?.version ?? null,
    versions: versions.map((v) => `${v.version}:${v.status}`),
  };
}

const run = (items: ValidatedQuestion[], options: { dryRun?: boolean } = {}) =>
  importQuestions(db, items, { includeFixtures: false, ...options });

describe('Testfragen aus content/fixtures', () => {
  it('werden nur mit includeFixtures importiert, als Entwurf, und ein zweiter Lauf ändert nichts', async () => {
    const { questions, issues } = await validateContentDir(CONTENT_DIR);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    const fixtures = questions.filter((q) => q.fixture);
    expect(fixtures.length).toBeGreaterThanOrEqual(40);

    const skipped = await importQuestions(db, questions, { includeFixtures: false });
    expect(skipped.skippedFixtures).toBe(fixtures.length);
    expect(skipped.created).toEqual([]);

    const first = await importQuestions(db, questions, { includeFixtures: true });
    expect(first.created).toHaveLength(questions.length);

    const rows = await db
      .selectFrom('questions')
      .innerJoin('question_versions', 'question_versions.id', 'questions.current_version_id')
      .select(['questions.is_fixture', 'questions.status', 'question_versions.status as vstatus'])
      .where('questions.key', 'like', 'fx-%')
      .execute();
    expect(rows).toHaveLength(fixtures.length);
    for (const row of rows) {
      expect(row).toEqual({ is_fixture: true, status: 'DRAFT', vstatus: 'DRAFT' });
    }
    const options = await db
      .selectFrom('question_options')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(options.n)).toBeGreaterThanOrEqual(25 * 4);

    const second = await importQuestions(db, questions, { includeFixtures: true });
    expect(second.unchanged).toHaveLength(questions.length);
    expect(second.missingInFiles).toEqual([]);
  });
});

describe('Lebenszyklus einer Bestandsfrage', () => {
  const key = 'gold-symbol';

  it('Entwurf → Freigabe → neue Version → Rückzug', async () => {
    const draft = trivia(key);
    expect((await run([file(draft)])).created).toEqual([key]);
    expect(await state(key)).toMatchObject({
      status: 'DRAFT',
      current: 1,
      versions: ['1:DRAFT'],
      isFixture: false,
    });

    // Prüfungen eingetragen und freigegeben: Inhalt des Entwurfs ändert sich, dann Freigabe
    const v1 = approved(draft);
    expect((await run([file(v1)])).updatedDrafts).toEqual([key]);
    expect(await state(key)).toMatchObject({ status: 'ACTIVE', current: 1, versions: ['1:APPROVED'] });

    // derselbe Stand noch einmal: nichts zu tun
    expect((await run([file(v1)])).unchanged).toEqual([key]);

    // nur Tags geändert: keine neue Version
    expect((await run([file({ ...v1, tags: ['region:HU'] })])).metadataUpdates).toEqual([key]);
    expect(await state(key)).toMatchObject({ tags: ['region:HU'], versions: ['1:APPROVED'] });

    // neuer Text, wieder freigegeben: Version 2 wird aktuell, Version 1 zurückgezogen
    const v2 = withPrompt({ ...v1, tags: ['region:HU'] }, 'Welches Elementsymbol hat Gold?');
    expect((await run([file(v2)])).newVersions).toEqual([key]);
    expect(await state(key)).toMatchObject({
      status: 'ACTIVE',
      current: 2,
      versions: ['1:RETIRED', '2:APPROVED'],
    });

    // neuer Entwurf: die freigegebene Version bleibt aktuell und aktiv
    const v3 = withPrompt({ ...v2, status: 'DRAFT', reviews: [] }, 'Wofür steht das Symbol Au?');
    const v3File = { ...v3, translations: { de: { ...(v3.translations as { de: object }).de, status: 'DRAFT' } } };
    expect((await run([file(v3File)])).newVersions).toEqual([key]);
    expect(await state(key)).toMatchObject({
      status: 'ACTIVE',
      current: 2,
      versions: ['1:RETIRED', '2:APPROVED', '3:DRAFT'],
    });

    // Entwurf überarbeitet: ersetzt, keine vierte Version
    const v3b = withPrompt(v3File, 'Welches Metall hat das Symbol Au?');
    expect((await run([file(v3b)])).updatedDrafts).toEqual([key]);
    expect((await state(key)).versions).toEqual(['1:RETIRED', '2:APPROVED', '3:DRAFT']);
  });

  it('zieht eine aktive Frage zurück, wenn die Datei RETIRED sagt', async () => {
    const retireKey = 'retire-me';
    const v1 = approved(trivia(retireKey));
    await run([file(v1)]);
    expect(await state(retireKey)).toMatchObject({ status: 'ACTIVE', versions: ['1:APPROVED'] });
    expect((await run([file({ ...v1, status: 'RETIRED' })])).statusChanges).toEqual([retireKey]);
    expect(await state(retireKey)).toMatchObject({ status: 'RETIRED', versions: ['1:RETIRED'] });
  });
});

describe('Schutzregeln', () => {
  it('lässt die Datenbank eine Freigabe ohne Prüfungen ablehnen und übernimmt dann nichts', async () => {
    const good = trivia('wird-zurueckgerollt');
    const bad = { ...trivia('ohne-pruefung'), status: 'APPROVED' };
    const error = await run([file(good), file(bad, { check: false })]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(String(error)).toMatch(/ohne-pruefung: .*Faktenprüfung/);
    const keys = await db
      .selectFrom('questions')
      .select('key')
      .where('key', 'in', ['wird-zurueckgerollt', 'ohne-pruefung'])
      .execute();
    expect(keys).toEqual([]);
  });

  it('gibt Testfragen nie frei, auch wenn die Datei es verlangt', async () => {
    const fx = approved(trivia('fx-gold', { tags: ['fixture'] }));
    const error = await importQuestions(db, [file(fx, { fixture: true, check: false })], {
      includeFixtures: true,
    }).catch((e: unknown) => e);
    expect(String(error)).toMatch(/Testfragen werden nie freigegeben/);
  });

  it('stuft eine freigegebene Version nicht zurück und ändert die Art nicht', async () => {
    const key = 'fest';
    const v1 = approved(trivia(key));
    await run([file(v1)]);
    await expect(run([file({ ...v1, status: 'DRAFT' }, { check: false })])).rejects.toThrow(
      /kann nicht zurück nach DRAFT/,
    );
    const asEstimate = {
      ...trivia(key),
      kind: 'ESTIMATE',
      trivia: undefined,
      estimate: {
        answer_value: '79',
        answer_precision: 0,
        answer_unit: 'count',
        input_min: '1',
        input_max: '120',
        scale_type: 'LINEAR',
        scale: 10,
      },
      translations: {
        de: { status: 'DRAFT', prompt: 'Welche Ordnungszahl hat Gold?', unit_label: 'Ordnungszahl' },
      },
    };
    await expect(run([file(asEstimate)])).rejects.toThrow(/neuen key verwenden/);
  });

  it('trennt Testfragen und Bestand auch über den key', async () => {
    const key = 'doppelt';
    await run([file(trivia(key))]);
    await expect(
      importQuestions(db, [file(trivia(key, { tags: ['fixture'] }), { fixture: true })], {
        includeFixtures: true,
      }),
    ).rejects.toThrow(/teilen sich einen key/);
  });

  it('übernimmt im Probelauf nichts', async () => {
    const summary = await run([file(trivia('nur-probe'))], { dryRun: true });
    expect(summary.created).toEqual(['nur-probe']);
    const row = await db
      .selectFrom('questions')
      .select('key')
      .where('key', '=', 'nur-probe')
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });
});
