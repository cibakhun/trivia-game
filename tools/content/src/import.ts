import { createHash, randomUUID } from 'node:crypto';
import type { Db, Tx } from '@rdw/db';
import { sql } from 'kysely';
import type { QuestionFile } from './schema.ts';
import type { ValidatedQuestion } from './validate.ts';

/**
 * Import der geprüften Fragendateien in die Datenbank (docs/QUIZ_ENGINE.md §9.1, ADR-021).
 *
 * - Die Dateien sind die Quelle; der Import gleicht die Datenbank in einer Transaktion an.
 * - Eine Version ist unveränderlich, sobald sie freigegeben ist (I12). Ändert sich der Inhalt
 *   einer freigegebenen Version, entsteht eine neue Version; Entwürfe werden ersetzt.
 * - Freigeben (`APPROVED`) heißt: Die Datenbank prüft dieselben Regeln noch einmal (Trigger
 *   `question_version_guard`). Fehlt eine dokumentierte Prüfung, scheitert der ganze Import.
 * - Testfragen (fixtures/) nur auf ausdrücklichen Wunsch; sie werden nie freigegeben oder aktiv.
 * - Fragen, die in der Datenbank, aber nicht mehr in den Dateien stehen, bleiben unverändert
 *   (Versionen können von Kämpfen referenziert sein) und werden gemeldet.
 */

export class ImportError extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(`${key}: ${message}`);
    this.name = 'ImportError';
  }
}

export interface ImportOptions {
  /** Testfragen aus fixtures/ mit importieren (nur local/test, prüft der Aufrufer). */
  readonly includeFixtures: boolean;
}

export interface ImportSummary {
  /** Neu angelegte Fragen. */
  readonly created: string[];
  /** Neue Version einer bestehenden Frage (Inhalt einer freigegebenen Version geändert). */
  readonly newVersions: string[];
  /** Entwurf in place ersetzt. */
  readonly updatedDrafts: string[];
  /** Nur Status der Version geändert (z. B. Freigabe). */
  readonly statusChanges: string[];
  /** Nur Kategorie, Tags, Herkunft oder Lizenzhinweis der Frage geändert. */
  readonly metadataUpdates: string[];
  readonly unchanged: string[];
  readonly skippedFixtures: number;
  /** In der Datenbank, aber nicht mehr in den Dateien. */
  readonly missingInFiles: string[];
}

/** Inhalt einer Version: alles außer Status und Feldern, die zur Frage gehören. */
function versionContent(q: QuestionFile): unknown {
  return {
    kind: q.kind,
    difficulty: q.difficulty,
    sources: q.sources,
    reviews: q.reviews,
    trivia: q.trivia ?? null,
    estimate: q.estimate ?? null,
    translations: q.translations,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 über den kanonischen Inhalt der Version (Formatierung und Kommentare zählen nicht). */
export function contentHash(q: QuestionFile): string {
  return createHash('sha256')
    .update(`rdw-question-version-1\n${canonicalJson(versionContent(q))}`)
    .digest('hex');
}

type VersionStatus = QuestionFile['status'];

interface VersionRow {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly content_hash: string;
}

const EDITABLE = new Set(['DRAFT', 'IN_REVIEW']);

async function insertVersionParts(tx: Tx, versionId: string, q: QuestionFile): Promise<void> {
  if (q.trivia) {
    const correct = q.trivia.correct;
    await tx
      .insertInto('question_options')
      .values(
        q.trivia.options.map((key) => ({
          version_id: versionId,
          option_key: key,
          is_correct: key === correct,
        })),
      )
      .execute();
  }
  for (const [locale, t] of Object.entries(q.translations)) {
    await tx
      .insertInto('question_translations')
      .values({
        version_id: versionId,
        locale,
        prompt: t.prompt,
        option_texts: t.options ? JSON.stringify(t.options) : null,
        unit_label: t.unit_label ?? null,
        explanation: t.explanation ?? null,
        status: t.status,
      })
      .execute();
  }
  if (q.reviews.length > 0) {
    await tx
      .insertInto('question_reviews')
      .values(
        q.reviews.map((r) => ({
          id: randomUUID(),
          version_id: versionId,
          kind: r.kind,
          locale: r.kind === 'LANGUAGE' ? r.locale : null,
          reviewer_name: r.reviewer,
          reviewed_on: r.date,
          notes: r.note ?? null,
        })),
      )
      .execute();
  }
}

async function deleteVersionParts(tx: Tx, versionId: string): Promise<void> {
  await tx.deleteFrom('question_options').where('version_id', '=', versionId).execute();
  await tx.deleteFrom('question_translations').where('version_id', '=', versionId).execute();
  await tx.deleteFrom('question_reviews').where('version_id', '=', versionId).execute();
}

function versionFields(q: QuestionFile, hash: string) {
  const e = q.estimate;
  return {
    difficulty: q.difficulty,
    answer_value: e?.answer_value ?? null,
    answer_precision: e?.answer_precision ?? null,
    answer_unit: e?.answer_unit ?? null,
    input_min: e?.input_min ?? null,
    input_max: e?.input_max ?? null,
    estimate_scale_type: e?.scale_type ?? null,
    estimate_scale: e?.scale ?? null,
    sources: JSON.stringify(q.sources),
    content_hash: hash,
  };
}

/** Neue Version als Entwurf; den Zielstatus setzt danach `applyStatus` (Freigabe per Trigger). */
async function insertVersion(
  tx: Tx,
  questionId: string,
  version: number,
  q: QuestionFile,
  hash: string,
): Promise<VersionRow> {
  const id = randomUUID();
  await tx
    .insertInto('question_versions')
    .values({ id, question_id: questionId, version, kind: q.kind, ...versionFields(q, hash) })
    .execute();
  await insertVersionParts(tx, id, q);
  return { id, version, status: 'DRAFT', content_hash: hash };
}

/**
 * Bringt die Version auf den Status der Datei. Der Rückzug einer freigegebenen Version wird nur
 * vorgemerkt: Er folgt nach dem Umstellen der Frage, weil eine aktive Frage ihre aktuelle Version
 * nicht verlieren darf. Liefert, ob sich etwas geändert hat.
 */
async function applyStatus(
  tx: Tx,
  key: string,
  row: VersionRow,
  target: VersionStatus,
  retire: Set<string>,
): Promise<boolean> {
  if (row.status === target) return false;
  if (row.status === 'RETIRED') {
    throw new ImportError(
      key,
      `Version ${row.version} ist zurückgezogen; für neuen Inhalt die Datei ändern (neue Version)`,
    );
  }
  if (row.status === 'APPROVED') {
    if (target !== 'RETIRED') {
      throw new ImportError(
        key,
        `Version ${row.version} ist freigegeben und kann nicht zurück nach ${target}`,
      );
    }
    retire.add(row.id);
    return true;
  }
  await tx
    .updateTable('question_versions')
    .set({ status: target })
    .where('id', '=', row.id)
    .execute();
  return true;
}

/**
 * Stellt Status und aktuelle Version der Frage ein und zieht überholte Freigaben zurück: Es gibt
 * höchstens eine freigegebene Version je Frage, und sie ist die aktuelle.
 */
async function syncQuestion(
  tx: Tx,
  questionId: string,
  previousStatus: string,
  retire: Set<string>,
): Promise<void> {
  const versions = await tx
    .selectFrom('question_versions')
    .select(['id', 'version', 'status'])
    .where('question_id', '=', questionId)
    .orderBy('version', 'desc')
    .execute();
  const latest = versions[0];
  if (!latest) return;
  const approved = versions.filter((v) => v.status === 'APPROVED' && !retire.has(v.id));
  const current = approved[0];
  for (const older of approved.slice(1)) retire.add(older.id);

  // SUSPENDED setzt der Betrieb (z. B. nach Meldungen); der Import hebt das nicht auf.
  let status: string;
  if (current) status = previousStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
  else if (previousStatus === 'SUSPENDED') status = 'SUSPENDED';
  else if (latest.status === 'RETIRED' || retire.has(latest.id)) status = 'RETIRED';
  else status = latest.status === 'IN_REVIEW' ? 'IN_REVIEW' : 'DRAFT';

  await tx
    .updateTable('questions')
    .set({ status, current_version_id: (current ?? latest).id })
    .where('id', '=', questionId)
    .execute();
  for (const id of retire) {
    await tx
      .updateTable('question_versions')
      .set({ status: 'RETIRED' })
      .where('id', '=', id)
      .where('status', '=', 'APPROVED')
      .execute();
  }
}

type Outcome =
  | 'created'
  | 'newVersion'
  | 'updatedDraft'
  | 'statusChange'
  | 'metadata'
  | 'unchanged';

async function importOne(tx: Tx, item: ValidatedQuestion): Promise<Outcome> {
  const q = item.question;
  const hash = contentHash(q);
  const existing = await tx
    .selectFrom('questions')
    .select(['id', 'kind', 'status', 'is_fixture', 'category', 'origin', 'license_note', 'tags'])
    .where('key', '=', q.key)
    .forUpdate()
    .executeTakeFirst();

  const retire = new Set<string>();
  if (!existing) {
    const questionId = randomUUID();
    await tx
      .insertInto('questions')
      .values({
        id: questionId,
        key: q.key,
        kind: q.kind,
        category: q.category,
        tags: q.tags,
        origin: q.origin,
        license_note: q.license_note,
        is_fixture: item.fixture,
      })
      .execute();
    const row = await insertVersion(tx, questionId, 1, q, hash);
    await applyStatus(tx, q.key, row, q.status, retire);
    await syncQuestion(tx, questionId, 'DRAFT', retire);
    return 'created';
  }

  if (existing.kind !== q.kind) {
    throw new ImportError(q.key, `Art ${existing.kind} → ${q.kind} geht nicht; neuen key verwenden`);
  }
  if (existing.is_fixture !== item.fixture) {
    throw new ImportError(q.key, 'Testfrage und Bestandsfrage teilen sich einen key');
  }
  const metadataChanged =
    existing.category !== q.category ||
    existing.origin !== q.origin ||
    existing.license_note !== q.license_note ||
    existing.tags.join('\n') !== q.tags.join('\n');
  if (metadataChanged) {
    await tx
      .updateTable('questions')
      .set({
        category: q.category,
        origin: q.origin,
        license_note: q.license_note,
        tags: q.tags,
      })
      .where('id', '=', existing.id)
      .execute();
  }

  const latest = await tx
    .selectFrom('question_versions')
    .select(['id', 'version', 'status', 'content_hash'])
    .where('question_id', '=', existing.id)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();

  let outcome: Outcome;
  if (latest.content_hash === hash) {
    const changed = await applyStatus(tx, q.key, latest, q.status, retire);
    if (!changed) return metadataChanged ? 'metadata' : 'unchanged';
    outcome = 'statusChange';
  } else if (EDITABLE.has(latest.status)) {
    const earlier = await tx
      .selectFrom('question_versions')
      .select('version')
      .where('question_id', '=', existing.id)
      .where('content_hash', '=', hash)
      .executeTakeFirst();
    if (earlier) {
      throw new ImportError(
        q.key,
        `Inhalt entspricht der früheren Version ${earlier.version}; Entwurf bitte anpassen`,
      );
    }
    // Entwürfe sind veränderlich: Status zurück auf DRAFT, Teile ersetzen, dann Zielstatus
    await tx
      .updateTable('question_versions')
      .set({ ...versionFields(q, hash), status: 'DRAFT' })
      .where('id', '=', latest.id)
      .execute();
    await deleteVersionParts(tx, latest.id);
    await insertVersionParts(tx, latest.id, q);
    await applyStatus(tx, q.key, { ...latest, status: 'DRAFT' }, q.status, retire);
    outcome = 'updatedDraft';
  } else {
    const row = await insertVersion(tx, existing.id, latest.version + 1, q, hash);
    await applyStatus(tx, q.key, row, q.status, retire);
    outcome = 'newVersion';
  }
  await syncQuestion(tx, existing.id, existing.status, retire);
  return outcome;
}

/** Wandelt einen Datenbankfehler der Freigabeprüfung in eine Meldung mit Fragenschlüssel. */
function wrapError(key: string, error: unknown): Error {
  if (error instanceof ImportError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ImportError(key, message);
}

/**
 * Importiert die Fragen in einer Transaktion. Bei einem Fehler wird nichts übernommen.
 * `dryRun` rollt am Ende zurück und liefert nur die Zusammenfassung.
 */
export async function importQuestions(
  db: Db,
  questions: readonly ValidatedQuestion[],
  options: ImportOptions & { readonly dryRun?: boolean },
): Promise<ImportSummary> {
  const selected = questions.filter((item) => options.includeFixtures || !item.fixture);
  const summary: ImportSummary = {
    created: [],
    newVersions: [],
    updatedDrafts: [],
    statusChanges: [],
    metadataUpdates: [],
    unchanged: [],
    skippedFixtures: questions.length - selected.length,
    missingInFiles: [],
  };

  const rollback = new Error('Probelauf: zurückgerollt');
  try {
    await db.transaction().execute(async (tx) => {
      // Ein Import zur Zeit; parallele Läufe würden sich bei neuen Versionen gegenseitig stören.
      await sql`select pg_advisory_xact_lock(hashtext('rdw:content-import'))`.execute(tx);
      for (const item of selected) {
        let outcome: Outcome;
        try {
          outcome = await importOne(tx, item);
        } catch (error) {
          throw wrapError(item.question.key, error);
        }
        const key = item.question.key;
        if (outcome === 'created') summary.created.push(key);
        else if (outcome === 'newVersion') summary.newVersions.push(key);
        else if (outcome === 'updatedDraft') summary.updatedDrafts.push(key);
        else if (outcome === 'statusChange') summary.statusChanges.push(key);
        else if (outcome === 'metadata') summary.metadataUpdates.push(key);
        else summary.unchanged.push(key);
      }
      const keys = new Set(questions.map((item) => item.question.key));
      let query = tx.selectFrom('questions').select('key').orderBy('key');
      if (!options.includeFixtures) query = query.where('is_fixture', '=', false);
      for (const row of await query.execute()) {
        if (!keys.has(row.key)) summary.missingInFiles.push(row.key);
      }
      if (options.dryRun) throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  return summary;
}
