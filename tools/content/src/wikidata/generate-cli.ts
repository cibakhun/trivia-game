import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { answerOf, approve, readApprovalList, type ApprovalList } from '../freigabe.ts';
import type { QuestionFile } from '../schema.ts';
import { validateQuestionText } from '../validate.ts';
import { generateFromTemplate, type GeneratedQuestion, type SnapshotData } from './generate.ts';
import { TEMPLATES } from './templates.ts';

/**
 * Aufruf: `pnpm content:wikidata [--force] [--dry-run] [--report=DATEI] [--json=DATEI] [--freigabe=DATEI]`
 *
 * Liest die Datenstände unter `content/wikidata/*.json` (aus `pnpm content:wikidata:fetch`) und
 * schreibt je Frage eine YAML-Datei nach `content/questions/wikidata/`. Vorhandene Dateien
 * bleiben unberührt, damit sprachlich überarbeitete Entwürfe nicht überschrieben werden; mit
 * `--force` werden sie neu erzeugt. `--report` schreibt eine Übersicht zum Gegenlesen (Markdown).
 * Entwürfe, die die Prüfung nicht bestehen, werden nie geschrieben; Prüffehler und fehlende
 * Datenstände beenden den Lauf mit Code 1. `--freigabe` gibt die dort gelisteten, von Claude
 * geprüften Fragen frei (ADR-072, `src/freigabe.ts`); alle anderen bleiben Entwürfe. `--json`
 * schreibt alle Fragen mit Wikidata-Kennung als Liste für den Abgleich mit der Wikipedia
 * (`tools/content/wikidata/abgleich.py`).
 */

const HEADER = (accessed: string, approved: boolean) =>
  [
    `# Aus Wikidata-Fakten (CC0, abgerufen am ${accessed}); Text und falsche Antworten vom Generator.`,
    approved
      ? '# Von Claude gegen die deutsche Wikipedia geprüft und freigegeben (ADR-072); vor dem Start folgt eine Stichprobe.'
      : '# Fakten- und Sprachprüfung stehen aus (Brief §5.6), deshalb origin AI_ASSISTED und status DRAFT.',
    '',
  ].join('\n');

export function toYaml(question: QuestionFile): string {
  const accessed = question.sources[0]?.accessed ?? '';
  return HEADER(accessed, question.status === 'APPROVED') + stringify(question, { lineWidth: 0 });
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
  const jsonPath = args.find((a) => a.startsWith('--json='))?.slice('--json='.length);
  const approvalPath = args.find((a) => a.startsWith('--freigabe='))?.slice('--freigabe='.length);
  const approvals: ApprovalList = approvalPath ? await readApprovalList(path.resolve(approvalPath)) : {};

  const snapshotDir = path.join(contentDir, 'wikidata');
  const outDir = path.join(contentDir, 'questions', 'wikidata');
  const generated: GeneratedQuestion[] = [];
  let missing = 0;
  let errors = 0;

  for (const template of TEMPLATES) {
    const file = path.join(snapshotDir, `${template.snapshot}.json`);
    if (!(await exists(file))) {
      console.log(`fehlt  ${template.id}: kein Datenstand ${path.relative(contentDir, file)}`);
      missing++;
      continue;
    }
    const snapshot = JSON.parse(await readFile(file, 'utf8')) as SnapshotData;
    let support: SnapshotData | undefined;
    if (template.kind === 'TRIVIA' && template.support) {
      const supportFile = path.join(snapshotDir, `${template.support}.json`);
      if (!(await exists(supportFile))) {
        console.log(`fehlt  ${template.id}: kein Datenstand ${path.relative(contentDir, supportFile)}`);
        missing++;
        continue;
      }
      support = JSON.parse(await readFile(supportFile, 'utf8')) as SnapshotData;
    }
    const questions = generateFromTemplate(template, snapshot, support);
    console.log(`ok     ${template.id}: ${questions.length} von ${template.count} Fragen`);
    generated.push(...questions);
  }

  // dieselbe Frage aus zwei Vorlagen (Zugspitze in „Berge“ und „Berge in Deutschland“) nur einmal
  const prompts = new Set<string>();
  const unique = generated.filter(({ question }) => {
    const prompt = question.translations.de?.prompt ?? question.key;
    if (prompts.has(prompt)) return false;
    prompts.add(prompt);
    return true;
  });
  if (unique.length < generated.length) console.log(`doppelt ${generated.length - unique.length} Fragen ausgelassen`);
  generated.splice(0, generated.length, ...unique);

  if (!dryRun) await mkdir(outDir, { recursive: true });
  let written = 0;
  let kept = 0;
  let approved = 0;
  for (const generatedQuestion of generated) {
    const entry = approvals[generatedQuestion.question.key];
    let question = generatedQuestion.question;
    if (entry) {
      try {
        question = approve(question, entry);
        approved++;
      } catch (error) {
        console.log(`FEHLER Freigabe: ${(error as Error).message}`);
        errors++;
        continue;
      }
    }
    const file = path.join(outDir, `${question.key}.yaml`);
    const text = toYaml(question);
    const { issues } = validateQuestionText(text, { file, fixture: false });
    for (const issue of issues) console.log(`FEHLER ${question.key}: ${issue.message}`);
    // ungültige Entwürfe nie schreiben, auch nicht mit --force über eine gültige Datei
    if (issues.length > 0) {
      errors += issues.length;
      continue;
    }
    if (dryRun) continue;
    if (!force && (await exists(file))) {
      kept++;
      continue;
    }
    await writeFile(file, text, 'utf8');
    written++;
  }
  const unknown = Object.keys(approvals).filter((key) => !generated.some((g) => g.question.key === key));
  for (const key of unknown) console.log(`FEHLER Freigabe für ${key}: Frage wird nicht mehr erzeugt`);
  errors += unknown.length;
  if (reportPath) await writeFile(path.resolve(reportPath), report(generated), 'utf8');
  if (jsonPath) {
    const list = generated.map(({ template, question }) => ({
      template,
      key: question.key,
      qid: question.sources[0]?.url.split('/').pop() ?? '',
      prompt: question.translations.de?.prompt ?? '',
      answer: answerOf(question),
      unit: question.estimate?.answer_unit ?? null,
    }));
    await writeFile(path.resolve(jsonPath), JSON.stringify(list, null, 1) + '\n', 'utf8');
  }

  const estimates = generated.filter((g) => g.question.kind === 'ESTIMATE').length;
  console.log(
    `\n${generated.length} Entwürfe (${estimates} Schätzung, ${generated.length - estimates} Auswahl): ` +
      `${written} geschrieben, ${kept} vorhanden und unverändert, ${approved} freigegeben, ${errors} Prüffehler` +
      (missing > 0 ? `, ${missing} ${missing === 1 ? 'Datenstand fehlt' : 'Datenstände fehlen'}` : ''),
  );
  return errors > 0 || missing > 0 ? 1 : 0;
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
