import { createTestDatabase, type TestDatabase } from '@rdw/db/testing';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../src/cli/world-create.ts', import.meta.url));

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  return () => db.drop();
});

/** Startet `pnpm world:create` als eigenen Prozess, ohne die .env des Hauptordners. */
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

async function worldCount(): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>('select count(*)::int as n from worlds');
  return rows[0]?.n ?? -1;
}

describe('pnpm world:create (Kommandozeile)', () => {
  it('legt in Produktion ohne --production-approved keine Welt an', async () => {
    const result = await runCli(['--slug=prod'], { APP_ENV: 'production', DATABASE_URL: db.url });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/nur mit Freigabe/);
    expect(await worldCount()).toBe(0);
  });

  it('lehnt unbekannte und doppelte Argumente ab', async () => {
    for (const args of [['--slg=x'], ['--seed=1', '--seed=2'], ['--slug=']]) {
      const result = await runCli(args, { APP_ENV: 'test', DATABASE_URL: db.url });
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr).toMatch(/Unbekanntes oder doppeltes Argument/);
    }
    expect(await worldCount()).toBe(0);
  });

  it('verweigert Spieltest-Regeln in Produktion auch mit Freigabe', async () => {
    const result = await runCli(['--slug=prod-play', '--rules=playtest', '--production-approved'], {
      APP_ENV: 'production',
      DATABASE_URL: db.url,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Spieltest-Regeln sind in Produktion nicht erlaubt/);
    const unknown = await runCli(['--rules=schnell'], { APP_ENV: 'test', DATABASE_URL: db.url });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toMatch(/Unbekannte Regeln/);
    expect(await worldCount()).toBe(0);
  });

  it('legt lokal eine Welt an', async () => {
    const result = await runCli(['--slug=cli-test', '--capacity=3'], {
      APP_ENV: 'test',
      DATABASE_URL: db.url,
    });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Welt cli-test: /);
    expect(result.stdout).toMatch(/Kapazität 3/);
    expect(await worldCount()).toBe(1);
  });

  it('legt lokal eine Spieltest-Welt mit kurzen Fristen an', async () => {
    const result = await runCli(['--slug=spieltest', '--rules=playtest'], {
      APP_ENV: 'local',
      DATABASE_URL: db.url,
    });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Regeln: Spieltest/);
    const { rows } = await db.pool.query<{ base: string; notes: string }>(
      `select r.config -> 'defense' ->> 'baseDeadline' as base, r.notes
         from world_rules r join worlds w on w.id = r.world_id where w.slug = 'spieltest'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.base).toBe(String(10 * 60_000));
    expect(rows[0]?.notes).toMatch(/PLAYTEST/);
  });
});
