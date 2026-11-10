import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { LOCALES } from '@rdw/protocol';
import { parse as parseYaml } from 'yaml';
import { questionFileSchema, type QuestionFile } from './schema.ts';

/**
 * Prüfwerkzeug für Fragendateien (docs/QUIZ_ENGINE.md §9.1, Schritt „CI-Validierung“):
 * Schema, ≥ 4 Optionen, genau eine richtige, Längen, Einheiten, Sprachen, Quellen und die
 * Freigaberegel für KI-gestützte Fragen (Brief §5.6).
 */

export type Severity = 'error' | 'warning';

export interface Issue {
  readonly file: string;
  readonly severity: Severity;
  readonly message: string;
}

export interface ValidatedQuestion {
  readonly file: string;
  readonly question: QuestionFile;
  /** Liegt unter `fixtures/`: nur für Tests, nie für den Spielbetrieb. */
  readonly fixture: boolean;
}

export interface ValidationReport {
  readonly questions: readonly ValidatedQuestion[];
  readonly issues: readonly Issue[];
}

function compareDecimalStrings(a: string, b: string): number {
  // kanonische Dezimalzahlen exakt vergleichen, ohne Float
  const [ai = '', af = ''] = a.replace('-', '').split('.');
  const [bi = '', bf = ''] = b.replace('-', '').split('.');
  const scale = Math.max(af.length, bf.length);
  const x = BigInt(ai + af.padEnd(scale, '0')) * (a.startsWith('-') ? -1n : 1n);
  const y = BigInt(bi + bf.padEnd(scale, '0')) * (b.startsWith('-') ? -1n : 1n);
  return x < y ? -1 : x > y ? 1 : 0;
}

function decimalPlaces(value: string): number {
  return value.split('.')[1]?.length ?? 0;
}

/** Fachliche Regeln, die über das Schema hinausgehen. */
export function checkQuestion(q: QuestionFile, context: { file: string; fixture: boolean }): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string) => issues.push({ file: context.file, severity: 'error', message });

  const baseName = path.basename(context.file, '.yaml');
  if (q.key !== baseName) error(`key „${q.key}“ muss dem Dateinamen „${baseName}“ entsprechen`);

  // Herkunft und Lizenz
  if ((q.origin === 'LICENSED') !== (q.license_note !== null)) {
    error('license_note ist genau bei origin LICENSED anzugeben');
  }

  // Testdaten bleiben Testdaten
  const isFixtureTagged = q.tags.includes('fixture');
  if (context.fixture && !isFixtureTagged) error('Dateien unter fixtures/ brauchen den Tag „fixture“');
  if (!context.fixture && isFixtureTagged) error('Der Tag „fixture“ ist nur unter fixtures/ erlaubt');
  if (context.fixture && q.status === 'APPROVED') error('Fixture-Fragen werden nie freigegeben');

  // Art-spezifische Felder
  if (q.kind === 'TRIVIA') {
    if (!q.trivia) error('Trivia-Frage ohne Abschnitt trivia');
    if (q.estimate) error('Trivia-Frage darf keinen Abschnitt estimate haben');
  } else {
    if (!q.estimate) error('Schätzfrage ohne Abschnitt estimate');
    if (q.trivia) error('Schätzfrage darf keinen Abschnitt trivia haben');
  }

  if (q.trivia) {
    const keys = q.trivia.options;
    if (new Set(keys).size !== keys.length) error('Optionsschlüssel sind nicht eindeutig');
    if (!keys.includes(q.trivia.correct)) error(`richtige Option „${q.trivia.correct}“ fehlt in options`);
  }

  if (q.estimate) {
    const e = q.estimate;
    if (decimalPlaces(e.answer_value) > e.answer_precision) {
      error('answer_value hat mehr Nachkommastellen als answer_precision');
    }
    if (compareDecimalStrings(e.input_min, e.input_max) >= 0) error('input_min muss kleiner als input_max sein');
    if (
      compareDecimalStrings(e.answer_value, e.input_min) < 0 ||
      compareDecimalStrings(e.answer_value, e.input_max) > 0
    ) {
      error('answer_value liegt außerhalb von [input_min, input_max]');
    }
    if (e.scale_type === 'LOG' && compareDecimalStrings(e.answer_value, '0') <= 0) {
      error('LOG-Skala verlangt einen positiven answer_value');
    }
    if (e.answer_unit === 'year' && compareDecimalStrings(e.input_min, '1') < 0) {
      error('Jahreszahlen vor Christus sind im MVP ausgeschlossen (input_min ≥ 1)');
    }
  }

  // Fragetexte je Sprache (gespielt wird nur auf Deutsch, ADR-023)
  for (const locale of LOCALES) {
    const t = q.translations[locale];
    if (!t) {
      error(`Übersetzung ${locale} fehlt`);
      continue;
    }
    if (q.kind === 'TRIVIA') {
      if (t.unit_label !== undefined) error(`${locale}: unit_label nur bei Schätzfragen`);
      const texts = t.options ?? {};
      const expected = [...(q.trivia?.options ?? [])].sort();
      const actual = Object.keys(texts).sort();
      if (expected.join() !== actual.join()) {
        error(`${locale}: Optionstexte müssen genau die Schlüssel ${expected.join(', ')} abdecken`);
      }
      const normalized = Object.values(texts).map((s) => s.toLocaleLowerCase(locale).trim());
      if (new Set(normalized).size !== normalized.length) error(`${locale}: Optionstexte doppelt`);
    } else {
      if (t.options !== undefined) error(`${locale}: Schätzfragen haben keine Optionen`);
      if (t.unit_label === undefined) error(`${locale}: unit_label fehlt (Einheit steht in der Frage)`);
    }

    const languageReviewed = q.reviews.some((r) => r.kind === 'LANGUAGE' && r.locale === locale);
    if (t.status !== 'DRAFT' && !languageReviewed) {
      error(`${locale}: Status ${t.status} ohne dokumentierte Sprachprüfung (reviews, kind LANGUAGE)`);
    }
  }

  // Freigabe: nur nach dokumentierter menschlicher Fakten- und Sprachprüfung (Brief §5.6)
  if (q.status === 'APPROVED') {
    if (!q.reviews.some((r) => r.kind === 'FACT')) error('APPROVED ohne dokumentierte Faktenprüfung');
    for (const locale of LOCALES) {
      if (q.translations[locale]?.status !== 'APPROVED') {
        error(`APPROVED, aber Übersetzung ${locale} ist nicht freigegeben`);
      }
    }
  }
  return issues;
}

function formatZodPath(pathParts: readonly PropertyKey[]): string {
  return pathParts.length ? pathParts.map(String).join('.') : '(Wurzel)';
}

/** Prüft eine einzelne Datei (Inhalt bereits gelesen). */
export function validateQuestionText(
  text: string,
  context: { file: string; fixture: boolean },
): { question: QuestionFile | null; issues: Issue[] } {
  let raw: unknown;
  try {
    raw = parseYaml(text, { strict: true, uniqueKeys: true });
  } catch (err) {
    return { question: null, issues: [{ file: context.file, severity: 'error', message: `YAML: ${(err as Error).message}` }] };
  }
  const parsed = questionFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      question: null,
      issues: parsed.error.issues.map((i) => ({
        file: context.file,
        severity: 'error' as const,
        message: `${formatZodPath(i.path)}: ${i.message}`,
      })),
    };
  }
  return { question: parsed.data, issues: checkQuestion(parsed.data, context) };
}

async function listYamlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}

/**
 * Prüft alle Fragen unter `<contentDir>/questions` und `<contentDir>/fixtures/questions`,
 * einschließlich eindeutiger Schlüssel über alle Dateien.
 */
export async function validateContentDir(contentDir: string): Promise<ValidationReport> {
  // Ein falsch geschriebener Pfad darf nicht als „nichts zu prüfen“ durchgehen; die
  // Unterordner questions/ und fixtures/questions/ bleiben optional.
  const root = await stat(contentDir).catch(() => null);
  if (!root?.isDirectory()) throw new Error(`Inhaltsverzeichnis nicht gefunden: ${contentDir}`);
  const sets = [
    { dir: path.join(contentDir, 'questions'), fixture: false },
    { dir: path.join(contentDir, 'fixtures', 'questions'), fixture: true },
  ];
  const questions: ValidatedQuestion[] = [];
  const issues: Issue[] = [];
  const seen = new Map<string, string>();

  for (const { dir, fixture } of sets) {
    for (const absolute of await listYamlFiles(dir)) {
      const file = path.relative(contentDir, absolute);
      if (absolute.endsWith('.yml')) {
        issues.push({ file, severity: 'error', message: 'Endung .yaml verwenden' });
        continue;
      }
      const result = validateQuestionText(await readFile(absolute, 'utf8'), { file, fixture });
      issues.push(...result.issues);
      if (!result.question) continue;
      const previous = seen.get(result.question.key);
      if (previous) {
        issues.push({ file, severity: 'error', message: `key „${result.question.key}“ bereits in ${previous}` });
      } else {
        seen.set(result.question.key, file);
      }
      questions.push({ file, question: result.question, fixture });
    }
  }
  return { questions, issues };
}
