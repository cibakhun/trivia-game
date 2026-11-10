import { z } from 'zod';

/** Umgebungen laut docs/ARCHITECTURE.md §12. */
export const APP_ENVS = ['local', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const postgresUrl = z
  .string()
  .url()
  .refine((value) => /^postgres(ql)?:\/\//.test(value), 'muss eine postgres://-URL sein');

// APP_ENV ohne Standardwert: Fehlt die Angabe auf einem Produktionsserver, darf der Läufer nicht
// stillschweigend „local“ annehmen und damit den Freigabeschutz umgehen.
export const dbEnvSchema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  DATABASE_URL: postgresUrl,
});
export type DbEnv = z.infer<typeof dbEnvSchema>;

const LOOPBACK_HOSTS = new Set(['localhost', '[::1]']);

/** Zeigt die URL auf diesen Rechner (Loopback-Adresse oder Unix-Socket)? */
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === '') return true; // Unix-Socket, z. B. postgres:///rdw?host=/var/run/postgresql
  return LOOPBACK_HOSTS.has(host) || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * `local` und `test` heben die Freigabeschutze auf. Seit die Befehle die `.env` im Hauptordner
 * selbst lesen, könnte eine liegengebliebene Entwickler-`.env` auf einem Server `APP_ENV=local`
 * liefern. Deshalb gelten diese beiden Umgebungen nur für eine Datenbank auf diesem Rechner;
 * entfernte Datenbanken brauchen `staging` oder `production` (und damit deren Schutz).
 */
export function localEnvProblem(appEnv: AppEnv, databaseUrl: string): string | null {
  if ((appEnv === 'local' || appEnv === 'test') && !isLocalDatabaseUrl(databaseUrl)) {
    return `muss bei APP_ENV=${appEnv} auf diesen Rechner zeigen (localhost, 127.0.0.1, ::1 oder Unix-Socket); für entfernte Datenbanken APP_ENV=staging oder production setzen`;
  }
  return null;
}

/** Liest und prüft die Datenbank-Umgebungsvariablen; bricht mit verständlicher Meldung ab. */
export function parseDbEnv(env: Record<string, string | undefined>): DbEnv {
  const result = dbEnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ungültige Umgebung: ${problems}`);
  }
  const problem = localEnvProblem(result.data.APP_ENV, result.data.DATABASE_URL);
  if (problem) throw new Error(`Ungültige Umgebung: DATABASE_URL: ${problem}`);
  return result.data;
}
