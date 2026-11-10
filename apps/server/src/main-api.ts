import { createDb, createPool } from '@rdw/db';
import type { FastifyBaseLogger } from 'fastify';
import { buildApp } from './app.ts';
import { parseServerConfig } from './infra/config.ts';
import { startChallengeSweeper } from './modules/combat/sweeper.ts';
import { startAccountCleanup } from './modules/identity/deletion.ts';
import { matchContextFrom } from './modules/match/context.ts';
import { startMatchDriver } from './modules/match/driver.ts';

/** Startpunkt der Rolle `api` (ARCHITECTURE §5): `pnpm --filter @rdw/server start`. */
async function main(): Promise<void> {
  const config = parseServerConfig(process.env);
  const pool = createPool({ connectionString: config.databaseUrl, applicationName: 'rdw-api' });
  // Fehler ungenutzter Verbindungen (z. B. Neustart der Datenbank) meldet pg als Ereignis am Pool;
  // ohne Listener beendet das den Prozess. Die Verbindung wird verworfen, der Pool baut neu auf.
  const logger: { current: FastifyBaseLogger | null } = { current: null };
  pool.on('error', (error) => {
    if (logger.current)
      logger.current.error({ err: error }, 'Datenbankverbindung im Leerlauf verloren');
    else console.error('Datenbankverbindung im Leerlauf verloren:', error.message);
  });
  const db = createDb(pool);
  const app = await buildApp({ db, config });
  logger.current = app.log;
  // Bis zum Worker-Prozess (Phase 3) räumt der api-Prozess liegen gebliebene Kämpfe auf (ADR-034).
  const stopSweeper = startChallengeSweeper(db, app.log);
  // Ebenso die Kontopflege: inaktive Gäste nach 90 Tagen, abgelaufene Sitzungen (ADR-045).
  const stopAccountCleanup = startAccountCleanup(db, app.log);
  // Ablaufsteuerung der Partien: Fristen, Auflösungen, verwaiste Aufstellungen (ADR-049).
  const stopMatchDriver = startMatchDriver(db, matchContextFrom(config), app.log);
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Beende');
    stopSweeper();
    stopAccountCleanup();
    stopMatchDriver();
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
