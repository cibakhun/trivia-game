import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/index.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';

const CLI = fileURLToPath(new URL('../src/cli/migrate.ts', import.meta.url));

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase({ migrate: false });
});
afterAll(async () => {
  await db.drop();
});

/** Startet `pnpm db:migrate` als eigenen Prozess, wie er auf einem Server liefe. */
function runCli(
  args: readonly string[],
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  for (const [key, value] of Object.entries(env)) if (value !== undefined) childEnv[key] = value;
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', CLI, ...args],
      { env: childEnv, cwd: fileURLToPath(new URL('..', import.meta.url)) },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

async function ledgerExists(): Promise<boolean> {
  const { rows } = await db.pool.query<{ exists: boolean }>(
    "select to_regclass('public.schema_migrations') is not null as exists",
  );
  return rows[0]?.exists ?? false;
}

describe('pnpm db:migrate (Kommandozeile)', () => {
  it('bricht in Produktion ohne --production-approved ab und ändert nichts', async () => {
    const result = await runCli([], { APP_ENV: 'production', DATABASE_URL: db.url });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/ohne Freigabe/);
    expect(await ledgerExists()).toBe(false);
  });

  it('--status zeigt in Produktion nur den Plan', async () => {
    const pending = (await loadMigrations()).length;
    const result = await runCli(['--status'], { APP_ENV: 'production', DATABASE_URL: db.url });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`ausstehend: ${pending}`);
    expect(await ledgerExists()).toBe(false);
  });

  it('lehnt unbekannte Argumente ab, statt zu migrieren', async () => {
    const result = await runCli(['--stauts'], { APP_ENV: 'local', DATABASE_URL: db.url });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Unbekannte Argumente: --stauts/);
    expect(await ledgerExists()).toBe(false);
  });

  it('verlangt APP_ENV', async () => {
    const result = await runCli([], { DATABASE_URL: db.url });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/APP_ENV/);
    expect(await ledgerExists()).toBe(false);
  });

  it('migriert in Produktion mit ausdrücklicher Freigabe', async () => {
    const result = await runCli(['--production-approved'], {
      APP_ENV: 'production',
      DATABASE_URL: db.url,
    });
    expect(result.code).toBe(0);
    const { rows } = await db.pool.query<{ n: number }>(
      'select count(*)::int as n from public.schema_migrations',
    );
    expect(rows[0]?.n).toBe((await loadMigrations()).length);
  });
});
