import { startStack } from './stack.ts';

/** Startet die Umgebung einmal für alle Tests; die Rückgabe ist das Aufräumen (Playwright). */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack();
  // Worker erben die Umgebung des Hauptprozesses
  process.env.E2E_DATABASE_URL = stack.databaseUrl;
  return () => stack.stop();
}
