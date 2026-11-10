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

/** Liest und prüft die Datenbank-Umgebungsvariablen; bricht mit verständlicher Meldung ab. */
export function parseDbEnv(env: Record<string, string | undefined>): DbEnv {
  const result = dbEnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ungültige Umgebung: ${problems}`);
  }
  return result.data;
}
