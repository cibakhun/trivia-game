import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { readSchemaTypes, renderSchemaTypes, SCHEMA_TYPES_FILE } from '../schema-file.ts';

/**
 * Aufruf: `pnpm db:types [--check]` gegen `DATABASE_URL` (eine migrierte Entwicklungsdatenbank).
 * Ohne Argument schreibt es `src/schema.generated.ts` neu; mit `--check` meldet es nur, ob die
 * Datei zum Schema passt (Exit-Code 1 bei Abweichung). Liest nur den Katalog, ändert nichts.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    console.error(`Unbekannte Argumente: ${unknown.join(' ')} (erlaubt: --check)`);
    process.exitCode = 2;
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL fehlt');
    process.exitCode = 2;
    return;
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const rendered = await renderSchemaTypes(client);
    if (args.includes('--check')) {
      if (rendered !== (await readSchemaTypes())) {
        console.error('Schema und schema.generated.ts weichen ab: pnpm db:types ausführen.');
        process.exitCode = 1;
      } else {
        console.log('schema.generated.ts passt zum Schema.');
      }
      return;
    }
    await writeFile(SCHEMA_TYPES_FILE, rendered);
    console.log(`geschrieben: ${SCHEMA_TYPES_FILE}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
