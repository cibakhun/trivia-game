import { createDb, createPool } from '@rdw/db';
import { buildApp } from './app.ts';
import { parseServerConfig } from './infra/config.ts';

/** Startpunkt der Rolle `api` (ARCHITECTURE §5): `pnpm --filter @rdw/server start`. */
async function main(): Promise<void> {
  const config = parseServerConfig(process.env);
  const pool = createPool({ connectionString: config.databaseUrl, applicationName: 'rdw-api' });
  const db = createDb(pool);
  const app = await buildApp({ db, config });
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Beende');
    await app.close();
    await db.destroy();
  };
  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));
  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
