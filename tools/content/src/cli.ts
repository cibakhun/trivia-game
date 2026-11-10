import path from 'node:path';
import { QUESTION_CATEGORIES } from '@rdw/protocol';
import { validateContentDir } from './validate.ts';

/** Aufruf: `pnpm content:validate` (prüft content/). Beendet sich mit 1 bei Fehlern. */
async function main(): Promise<void> {
  const contentDir = path.resolve(process.argv[2] ?? 'content');
  const { questions, issues } = await validateContentDir(contentDir);

  for (const issue of issues) {
    const label = issue.severity === 'error' ? 'FEHLER' : 'Warnung';
    console.log(`${label}  ${issue.file}: ${issue.message}`);
  }

  const count = (pred: (q: (typeof questions)[number]) => boolean) => questions.filter(pred).length;
  console.log(
    `\n${questions.length} Fragen geprüft (${count((q) => !q.fixture)} Bestand, ${count((q) => q.fixture)} Testdaten): ` +
      `${count((q) => q.question.kind === 'TRIVIA')} Trivia, ${count((q) => q.question.kind === 'ESTIMATE')} Schätzung`,
  );
  const perCategory = QUESTION_CATEGORIES.map((c) => `${c} ${count((q) => q.question.category === c)}`);
  console.log(`Kategorien: ${perCategory.join(' · ')}`);
  console.log(`Freigegeben: ${count((q) => q.question.status === 'APPROVED')}`);

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  console.log(`${errors} Fehler, ${warnings} Warnungen`);
  if (errors > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
