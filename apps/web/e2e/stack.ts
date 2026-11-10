import { importQuestions, validateContentDir } from '@rdw/content-tools';
import { createDb } from '@rdw/db';
import { createTestDatabase } from '@rdw/db/testing';
import { TEST_WORLD_SEED, testWorldPreset } from '@rdw/game-core';
import { buildApp, createWorld, startChallengeSweeper } from '@rdw/server';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { E2E_API_ORIGIN, E2E_API_PORT, E2E_WEB_ORIGIN, E2E_WEB_PORT } from './env.ts';

/**
 * Startet die E2E-Umgebung (TEST_PLAN §2): eigene, frisch migrierte Testdatenbank mit den
 * 40 Testfragen und einer Testwelt, den api-Prozess im selben Node-Prozess und den gebauten
 * Client über `vite preview` mit Proxy auf `/api`. Braucht `TEST_DATABASE_URL`; nie gegen
 * Staging oder Produktion.
 */

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));

export interface E2eStack {
  readonly databaseUrl: string;
  stop(): Promise<void>;
}

export async function startStack(): Promise<E2eStack> {
  const database = await createTestDatabase();
  const db = createDb(database.pool);
  const stops: (() => Promise<void>)[] = [() => database.drop()];
  // Alle Schritte laufen, auch wenn einer scheitert (sonst bliebe die Testdatenbank liegen);
  // der erste Fehler wird danach geworfen. `splice` macht einen zweiten Aufruf wirkungslos.
  const stop = async () => {
    const failures: unknown[] = [];
    for (const step of stops.splice(0).reverse()) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  };
  try {
    const { questions, issues } = await validateContentDir(CONTENT_DIR);
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) throw new Error(`Fragen ungültig: ${JSON.stringify(errors)}`);
    await importQuestions(db, questions, { includeFixtures: true });
    await createWorld(db, {
      slug: 'e2e',
      nameKey: 'world.test',
      mode: 'ETERNAL',
      seed: TEST_WORLD_SEED,
      preset: testWorldPreset(),
      capacity: 50,
    });

    const app = await buildApp({
      db,
      logger: false,
      config: {
        appEnv: 'test',
        databaseUrl: database.url,
        host: '127.0.0.1',
        port: E2E_API_PORT,
        publicOrigin: E2E_WEB_ORIGIN,
        cookieSecure: false,
        rngSecret: new Uint8Array(randomBytes(32)),
        rngKeyId: 'e2e',
        logLevel: 'silent',
      },
    });
    stops.push(() => app.close());
    await app.listen({ host: '127.0.0.1', port: E2E_API_PORT });
    const stopSweeper = startChallengeSweeper(db, app.log);
    stops.push(() => Promise.resolve(stopSweeper()));

    // gebauter Client statt Dev-Server: keine Nachoptimierung von Abhängigkeiten mitten im Test
    process.env.API_ORIGIN = E2E_API_ORIGIN;
    await build({ root: WEB_ROOT, logLevel: 'warn' });
    const server = await preview({
      root: WEB_ROOT,
      logLevel: 'warn',
      preview: { host: '127.0.0.1', port: E2E_WEB_PORT, strictPort: true },
    });
    stops.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.httpServer.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    return { databaseUrl: database.url, stop };
  } catch (error) {
    // der Startfehler bleibt die eigentliche Ursache; ein Aufräumfehler wird nur gemeldet
    await stop().catch((teardownError: unknown) => {
      console.error('E2E: Aufräumen nach Startfehler fehlgeschlagen', teardownError);
    });
    throw error;
  }
}
