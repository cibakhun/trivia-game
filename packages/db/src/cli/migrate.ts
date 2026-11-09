import pg from 'pg';
import { parseDbEnv } from '../env.ts';
import { migrate, migrationStatus } from '../migrate.ts';

/**
 * Aufruf: `pnpm db:migrate [--status] [--production-approved]`
 *
 * In Produktion (APP_ENV=production) verweigert der Läufer ohne `--production-approved`: Jede
 * Produktionsmigration braucht eine ausdrückliche Freigabe, ein aktuelles Backup und einen
 * vorherigen Lauf gegen eine Kopie (docs/DATA_MODEL.md §6.5, Brief §20).
 */
async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const env = parseDbEnv(process.env);
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const status = await migrationStatus(client);
    console.log(
      `Umgebung: ${env.APP_ENV}; angewandt: ${status.applied.length}; ausstehend: ${status.pending.length}`,
    );
    for (const m of status.pending) console.log(`  ausstehend: ${m.file}`);
    if (args.has('--status') || status.pending.length === 0) return;

    if (env.APP_ENV === 'production' && !args.has('--production-approved')) {
      console.error(
        'Abbruch: Produktionsmigration ohne Freigabe. Erst Freigabe, Backup und Probelauf gegen eine Kopie, dann mit --production-approved.',
      );
      process.exitCode = 2;
      return;
    }
    await migrate(client, { log: (message) => console.log(message) });
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
