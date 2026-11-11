import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import type { QuestionFile } from '../schema.ts';
import { validateQuestionText } from '../validate.ts';
import { generateFromTemplate, type GeneratedQuestion, type SnapshotData } from './generate.ts';
import { TEMPLATES } from './templates.ts';

/**
 * Aufruf: `pnpm content:wikidata [--force] [--dry-run] [--report=DATEI]`
 *
 * Liest die Datenstände unter `content/wikidata/*.json` (aus `pnpm content:wikidata:fetch`) und
 * schreibt je Frage eine YAML-Datei nach `content/questions/wikidata/`. Vorhandene Dateien
 * bleiben unberührt, damit sprachlich überarbeitete Entwürfe nicht überschrieben werden; mit
 * `--force` werden sie neu erzeugt. `--report` schreibt eine Übersicht zum Gegenlesen (Markdown).
 */

const HEADER = (accessed: string) =>
  [
    `# Entwurf aus Wikidata-Fakten (CC0, abgerufen am ${accessed}); Text und falsche Antworten vom Generator.`,
    '# Fakten- und Sprachprüfung stehen aus (Brief §5.6), deshalb origin AI_ASSISTED und status DRAFT.',
    '',
  ].join('\n');

export function toYaml(question: QuestionFile): string {
  const accessed = question.sources[0]?.accessed ?? '';
  return HEADER(accessed) + stringify(question, { lineWidth: 0 });
}

function reportLine(g: GeneratedQuestion): string {
  const q = g.question;
  const de = q.translations.de;
  if (!de) return '';
  if (q.kind === 'ESTIMATE' && q.estimate) {
    const value = Number(q.estimate.answer_value).toLocaleString('de-DE');
    return `| ${q.key} | ${q.difficulty} | ${de.prompt} | **${value}** ${de.unit_label ?? ''} | ${q.sources[0]?.url ?? ''} |`;
  }
  const options = q.trivia?.options.map((k) => (k === q.trivia?.correct ? `**${de.options?.[k]}**` : de.options?.[k]));
  return `| ${q.key} | ${q.difficulty} | ${de.prompt} | ${options?.join(' · ')} | ${q.sources[0]?.url ?? ''} |`;
}

function report(generated: readonly GeneratedQuestion[]): string {
  const lines = ['# Entwürfe aus Wikidata', ''];
  for (const kind of ['ESTIMATE', 'TRIVIA'] as const) {
    const part = generated.filter((g) => g.question.kind === kind);
    lines.push(`## ${kind === 'ESTIMATE' ? 'Schätzfragen' : 'Auswahlfragen'} (${part.length})`, '');
    lines.push('| Schlüssel | Stufe | Frage | Antwort | Quelle |', '|---|---|---|---|---|');
    lines.push(...part.map(reportLine), '');
  }
  return lines.join('\n');
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const contentDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'content');
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const reportPath = args.find((a) => a.startsWith('--report='))?.slice('--report='.length);

  const snapshotDir = path.join(contentDir, 'wikidata');
  const outDir = path.join(contentDir, 'questions', 'wikidata');
  const generated: GeneratedQuestion[] = [];
  let errors = 0;

  for (const template of TEMPLATES) {
    const file = path.join(snapshotDir, `${template.snapshot}.json`);
    if (!(await exists(file))) {
      console.log(`fehlt  ${template.id}: kein Datenstand ${path.relative(contentDir, file)}`);
      continue;
    }
    const snapshot = JSON.parse(await readFile(file, 'utf8')) as SnapshotData;
    const questions = generateFromTemplate(template, snapshot);
    console.log(`ok     ${template.id}: ${questions.length} von ${template.count} Fragen`);
    generated.push(...questions);
  }

  if (!dryRun) await mkdir(outDir, { recursive: true });
  let written = 0;
  let kept = 0;
  for (const { question } of generated) {
    const file = path.join(outDir, `${question.key}.yaml`);
    const text = toYaml(question);
    for (const issue of validateQuestionText(text, { file, fixture: false }).issues) {
      errors++;
      console.log(`FEHLER ${question.key}: ${issue.message}`);
    }
    if (dryRun) continue;
    if (!force && (await exists(file))) {
      kept++;
      continue;
    }
    await writeFile(file, text, 'utf8');
    written++;
  }
  if (reportPath) await writeFile(path.resolve(reportPath), report(generated), 'utf8');

  const estimates = generated.filter((g) => g.question.kind === 'ESTIMATE').length;
  console.log(
    `\n${generated.length} Entwürfe (${estimates} Schätzung, ${generated.length - estimates} Auswahl): ` +
      `${written} geschrieben, ${kept} vorhanden und unverändert, ${errors} Prüffehler`,
  );
  return errors > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
