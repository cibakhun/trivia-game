import path from 'node:path';
import { createDb, createPool, parseDbEnv, type AppEnv } from '@rdw/db';
import { importQuestions, type ImportSummary } from './import.ts';
import { validateContentDir } from './validate.ts';

/**
 * Aufruf: `pnpm content:import [--fixtures] [--dry-run] [--production-approved]`
 *
 * Prüft content/ wie `content:validate` und importiert nur, wenn es keine Fehler gibt.
 * - `--fixtures`: Testfragen mit importieren; nur in local und test (ADR-021), nie in Staging
 *   oder Produktion.
 * - `--dry-run`: alles in einer Transaktion ausführen und zurückrollen.
 * - Produktion (APP_ENV=production) verweigert ohne `--production-approved`: Änderungen an
 *   Produktivdaten brauchen eine ausdrückliche Freigabe (Brief §20).
 */
const KNOWN_ARGS = new Set(['--fixtures', '--dry-run', '--production-approved']);
const FIXTURE_ENVS: ReadonlySet<AppEnv> = new Set(['local', 'test']);

function printSummary(summary: ImportSummary, dryRun: boolean): void {
  const line = (label: string, keys: readonly string[]) => {
    console.log(`${label}: ${keys.length}`);
    for (const key of keys) console.log(`  ${key}`);
  };
  if (dryRun) console.log('Probelauf: nichts übernommen.');
  line('Neu', summary.created);
  line('Neue Version', summary.newVersions);
  line('Entwurf ersetzt', summary.updatedDrafts);
  line('Status geändert', summary.statusChanges);
  line('Nur Metadaten', summary.metadataUpdates);
  console.log(`Unverändert: ${summary.unchanged.length}`);
  if (summary.skippedFixtures > 0) {
    console.log(`Testfragen übersprungen: ${summary.skippedFixtures} (mit --fixtures importieren)`);
  }
  if (summary.missingInFiles.length > 0) {
    line('Warnung: in der Datenbank, aber nicht mehr in den Dateien', summary.missingInFiles);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const unknown = [...flags].filter((arg) => !KNOWN_ARGS.has(arg));
  if (unknown.length > 0 || positional.length > 1) {
    console.error(
      `Unbekannte Argumente: ${[...unknown, ...positional.slice(1)].join(' ')} (erlaubt: ${[...KNOWN_ARGS].join(', ')})`,
    );
    process.exitCode = 2;
    return;
  }
  const env = parseDbEnv(process.env);
  const includeFixtures = flags.has('--fixtures');
  const dryRun = flags.has('--dry-run');
  if (includeFixtures && !FIXTURE_ENVS.has(env.APP_ENV)) {
    console.error(`Abbruch: Testfragen werden nur in local und test importiert (APP_ENV=${env.APP_ENV}).`);
    process.exitCode = 2;
    return;
  }
  if (env.APP_ENV === 'production' && !dryRun && !flags.has('--production-approved')) {
    console.error(
      'Abbruch: Import in Produktion ohne Freigabe. Erst Freigabe und Probelauf (--dry-run), dann mit --production-approved.',
    );
    process.exitCode = 2;
    return;
  }

  const contentDir = path.resolve(positional[0] ?? 'content');
  const { questions, issues } = await validateContentDir(contentDir);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    for (const issue of errors) console.error(`FEHLER  ${issue.file}: ${issue.message}`);
    console.error(`Abbruch: ${errors.length} Fehler in den Fragendateien (pnpm content:validate).`);
    process.exitCode = 1;
    return;
  }

  const pool = createPool({ connectionString: env.DATABASE_URL, max: 1, applicationName: 'rdw-import' });
  const db = createDb(pool);
  try {
    console.log(`Umgebung: ${env.APP_ENV}; ${questions.length} Dateien geprüft`);
    const summary = await importQuestions(db, questions, { includeFixtures, dryRun });
    printSummary(summary, dryRun);
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
