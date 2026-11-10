import { createDb, createPool, parseDbEnv } from '@rdw/db';
import { TEST_WORLD_SEED, testWorldPreset } from '@rdw/game-core';
import { createWorld } from '../modules/world/create-world.ts';

/**
 * Aufruf: `pnpm world:create [--slug=test] [--seed=2175] [--capacity=20] [--production-approved]`
 *
 * Legt die Testwelt (≈ 150 Regionen, Phase 1) als Eternal-Welt mit einer laufenden Instanz an.
 * In Produktion verweigert das Werkzeug ohne `--production-approved`: Eine neue Welt ist eine
 * Änderung an Produktivdaten und braucht eine ausdrückliche Freigabe (Brief §20).
 */
const FLAGS = new Set(['--production-approved']);
const OPTIONS = new Set(['--slug', '--seed', '--capacity']);

function parseArgs(argv: readonly string[]): Map<string, string> | string {
  const result = new Map<string, string>();
  for (const arg of argv) {
    if (FLAGS.has(arg)) {
      result.set(arg, 'true');
      continue;
    }
    const [name, value] = arg.split('=', 2);
    if (!name || !OPTIONS.has(name) || value === undefined || value === '') return arg;
    result.set(name, value);
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(
      `Unbekanntes Argument: ${args} (erlaubt: --slug=…, --seed=…, --capacity=…, --production-approved)`,
    );
    process.exitCode = 2;
    return;
  }
  const env = parseDbEnv(process.env);
  if (env.APP_ENV === 'production' && !args.has('--production-approved')) {
    console.error('Abbruch: Welt in Produktion anlegen nur mit Freigabe (--production-approved).');
    process.exitCode = 2;
    return;
  }
  const slug = args.get('--slug') ?? 'test';
  const seedText = args.get('--seed') ?? TEST_WORLD_SEED.toString();
  if (!/^-?\d{1,19}$/.test(seedText)) {
    console.error(`Ungültiger Seed: ${seedText}`);
    process.exitCode = 2;
    return;
  }
  const capacity = Number(args.get('--capacity') ?? '20');

  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: 1,
    applicationName: 'rdw-world-create',
  });
  const db = createDb(pool);
  try {
    const world = await createWorld(db, {
      slug,
      nameKey: `world.${slug}`,
      mode: 'ETERNAL',
      seed: BigInt(seedText),
      preset: testWorldPreset(),
      capacity,
    });
    console.log(`Umgebung: ${env.APP_ENV}`);
    console.log(`Welt ${slug}: ${world.worldId}`);
    console.log(`Instanz: ${world.instanceId} (${world.regions} Regionen, Kapazität ${capacity})`);
    for (const faction of world.factions) {
      console.log(`  NPC ${faction.archetype}: ${faction.regions} Regionen`);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
