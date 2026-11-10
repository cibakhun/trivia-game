import { createDb, createPool, parseDbEnv } from '@rdw/db';
import { TEST_WORLD_SEED, testWorldPreset } from '@rdw/game-core';
import { PLAYTEST_RULES, type RulesConfig } from '@rdw/protocol';
import { createWorld } from '../modules/world/create-world.ts';
import { parseWorldCreateArgs, WORLD_CREATE_USAGE } from './world-create-args.ts';

/**
 * Aufruf: `pnpm world:create [--slug=test] [--seed=2175] [--capacity=20]
 * [--rules=default|playtest] [--production-approved]`
 *
 * Legt die Testwelt (≈ 150 Regionen, Phase 1) als Eternal-Welt mit einer laufenden Instanz an.
 * In Produktion verweigert das Werkzeug ohne `--production-approved`: Eine neue Welt ist eine
 * Änderung an Produktivdaten und braucht eine ausdrückliche Freigabe (Brief §20).
 *
 * `--rules=playtest` nimmt `PLAYTEST_RULES` (Minuten statt Tage für Fristen und Schutz), damit
 * zwei Spieler PvP lokal ausprobieren können. In Produktion ist das immer verboten, auch mit
 * Freigabe.
 */
async function main(): Promise<void> {
  const args = parseWorldCreateArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(`Unbekanntes oder doppeltes Argument: ${args} (${WORLD_CREATE_USAGE})`);
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
  const rulesName = args.get('--rules') ?? 'default';
  if (rulesName !== 'default' && rulesName !== 'playtest') {
    console.error(`Unbekannte Regeln: ${rulesName} (erlaubt: default, playtest)`);
    process.exitCode = 2;
    return;
  }
  if (rulesName === 'playtest' && env.APP_ENV === 'production') {
    console.error('Abbruch: Spieltest-Regeln sind in Produktion nicht erlaubt.');
    process.exitCode = 2;
    return;
  }
  const rules =
    rulesName === 'playtest'
      ? { config: PLAYTEST_RULES as RulesConfig, label: 'PLAYTEST_RULES (nur Spieltest)' }
      : undefined;

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
      ...(rules ? { rules } : {}),
    });
    console.log(`Umgebung: ${env.APP_ENV}`);
    console.log(`Welt ${slug}: ${world.worldId}`);
    console.log(`Instanz: ${world.instanceId} (${world.regions} Regionen, Kapazität ${capacity})`);
    console.log(`Regeln: ${rulesName === 'playtest' ? 'Spieltest (kurze Fristen)' : 'Standard'}`);
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
