import { dbEnvSchema, localEnvProblem, type AppEnv } from '@rdw/db';
import { z } from 'zod';

/**
 * Serverkonfiguration aus der Umgebung (docs/ARCHITECTURE.md §12). Geheimnisse kommen nur aus
 * der Umgebung, nie aus dem Repository; `.env.example` nennt die Namen.
 */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const base64Secret = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'muss Base64 sein')
  .transform((value) => new Uint8Array(Buffer.from(value, 'base64')))
  .refine((bytes) => bytes.length >= 32, 'muss mindestens 32 Byte haben');

const serverEnvSchema = dbEnvSchema
  .extend({
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    /**
     * Herkunft des Clients (Schema, Host, Port); zustandsändernde Anfragen müssen sie tragen. Nur
     * http(s): Andere Schemata ergeben als Origin den Text „null“, den die Prüfung sonst annähme.
     */
    PUBLIC_ORIGIN: z
      .url({ protocol: /^https?$/, error: 'muss eine http(s)-Adresse sein' })
      .transform((value) => new URL(value).origin),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    RNG_SECRET: base64Secret,
    RNG_KEY_ID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, '1–64 Zeichen aus [A-Za-z0-9._-]'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /**
     * Wissensfragen, die eine Kategorie für das Glücksrad der Partie mit Ausbau braucht
     * (MATCH_RULES §11.6). Ohne Angabe 20, lokal und in Tests 1.
     */
    REALM_MIN_CATEGORY_QUESTIONS: z.coerce.number().int().min(1).max(1000).optional(),
    /** Nur für die Prüfung „lokale Datenbank“: Der Treiber nimmt PGHOST, wenn die URL keinen Host hat. */
    PGHOST: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const localProblem = localEnvProblem(env.APP_ENV, env.DATABASE_URL, env.PGHOST);
    if (localProblem)
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: localProblem });
    const deployed = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
    if (deployed && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: `muss in ${env.APP_ENV} true sein`,
      });
    }
    if (deployed && !env.PUBLIC_ORIGIN.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_ORIGIN'],
        message: `muss in ${env.APP_ENV} https sein`,
      });
    }
  });

export interface ServerConfig {
  readonly appEnv: AppEnv;
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly publicOrigin: string;
  readonly cookieSecure: boolean;
  readonly rngSecret: Uint8Array;
  readonly rngKeyId: string;
  readonly logLevel: (typeof LOG_LEVELS)[number];
  /** `null` = Vorgabe der Umgebung (`matchContextFrom`). */
  readonly realmMinCategoryQuestions: number | null;
}

/** Liest und prüft die Umgebung; nennt bei Fehlern nur Namen und Regeln, nie Werte. */
export function parseServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const result = serverEnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ungültige Umgebung: ${problems}`);
  }
  const e = result.data;
  return {
    appEnv: e.APP_ENV,
    databaseUrl: e.DATABASE_URL,
    host: e.HOST,
    port: e.PORT,
    publicOrigin: e.PUBLIC_ORIGIN,
    cookieSecure: e.COOKIE_SECURE,
    rngSecret: e.RNG_SECRET,
    rngKeyId: e.RNG_KEY_ID,
    logLevel: e.LOG_LEVEL,
    realmMinCategoryQuestions: e.REALM_MIN_CATEGORY_QUESTIONS ?? null,
  };
}
