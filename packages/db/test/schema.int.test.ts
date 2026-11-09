import { randomUUID } from 'node:crypto';
import { chunkOf } from '@rdw/game-core';
import { DEFAULT_RULES, parseRulesConfig } from '@rdw/protocol';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';

let db: TestDatabase;
const q = (text: string, values?: unknown[]) =>
  db.pool.query<Record<string, unknown>>(text, values);

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});

async function insertUser(overrides: Record<string, unknown> = {}): Promise<string> {
  const row = { id: randomUUID(), is_guest: true, ...overrides };
  const cols = Object.keys(row);
  await q(
    `insert into users (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row),
  );
  return row.id;
}

/** Legt Welt, Regelversion und Instanz an; liefert die Instanz-ID. */
async function insertInstance(): Promise<string> {
  const worldId = randomUUID();
  const rulesId = randomUUID();
  const instanceId = randomUUID();
  await q(
    `insert into worlds (id, slug, mode, name_key) values ($1, $2, 'ETERNAL', 'world.eternal')`,
    [worldId, `eternal-${worldId.slice(0, 8)}`],
  );
  await q(
    `insert into world_rules (id, world_id, version, config, config_hash) values ($1, $2, 1, $3, repeat('a', 64))`,
    [rulesId, worldId, JSON.stringify(DEFAULT_RULES.ETERNAL)],
  );
  await q(`update worlds set current_rules_id = $1 where id = $2`, [rulesId, worldId]);
  await q(
    `insert into world_instances (id, world_id, rules_id, map_seed, capacity, starts_at)
     values ($1, $2, $3, 42, 1000, game_now())`,
    [instanceId, worldId, rulesId],
  );
  return instanceId;
}

describe('Fremdschlüssel', () => {
  it('sind alle indiziert (führende Spalten eines vollständigen Index oder eindeutiger Teil)', async () => {
    const { rows } = await q(`
      select c.conname, c.conrelid::regclass::text as table_name
      from pg_constraint c
      where c.contype = 'f'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and i.indpred is null
            and (
              (select array_agg(x order by x)
                 from unnest((i.indkey::int2[])[0:array_length(c.conkey, 1) - 1]) x)
                = (select array_agg(x order by x) from unnest(c.conkey) x)
              or (i.indisunique and (i.indkey::int2[]) <@ c.conkey)
            )
        )
      order by 1`);
    expect(rows).toEqual([]);
  });
});

describe('Fremdschlüssel auf users (DATA_MODEL §1)', () => {
  it('sind alle ON DELETE RESTRICT und indiziert', async () => {
    const { rows } = await q(`
      select c.conrelid::regclass::text as table_name,
             c.confdeltype as on_delete,
             (select array_agg(a.attname order by k.ord)
                from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
             exists (
               select 1 from pg_index i
               where i.indrelid = c.conrelid
                 and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey
             ) as indexed
      from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'users'::regclass
      order by 1`);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) {
      expect(row).toMatchObject({ on_delete: 'r', indexed: true });
    }
  });

  it('verhindert das Löschen eines Kontos mit Verweisen', async () => {
    const userId = await insertUser();
    await q(
      `insert into sessions (token_hash, user_id, expires_at) values (sha256($1::bytea), $2, game_now() + interval '1 day')`,
      [Buffer.from('token'), userId],
    );
    await expect(q(`delete from users where id = $1`, [userId])).rejects.toThrow(/foreign key/);
  });
});

describe('users', () => {
  it('Gastkonten haben keine Anmeldedaten', async () => {
    await expect(insertUser({ email: 'gast@example.org' })).rejects.toThrow(
      /users_guest_without_credentials/,
    );
  });

  it('E-Mail ist ohne Groß-/Kleinschreibung eindeutig', async () => {
    await insertUser({ is_guest: false, email: 'Krisz@Example.org' });
    await expect(insertUser({ is_guest: false, email: 'krisz@example.org' })).rejects.toThrow(
      /users_email_unique/,
    );
  });

  it('Platzhalterkonten gelöschter Konten tragen keine personenbezogenen Daten', async () => {
    await expect(
      insertUser({ is_guest: false, email: 'weg@example.org', deleted_at: new Date() }),
    ).rejects.toThrow(/users_deleted_without_personal_data/);
    await expect(insertUser({ is_guest: false, deleted_at: new Date() })).resolves.toBeTypeOf(
      'string',
    );
  });

  it('Bootstrap-Hash ist ein eindeutiger SHA-256-Wert', async () => {
    const hash = Buffer.alloc(32, 1);
    await insertUser({ guest_bootstrap_hash: hash });
    await expect(insertUser({ guest_bootstrap_hash: hash })).rejects.toThrow(
      /users_guest_bootstrap_unique/,
    );
    await expect(insertUser({ guest_bootstrap_hash: Buffer.alloc(16) })).rejects.toThrow(
      /users_bootstrap_hash_sha256/,
    );
  });

  it('Spielstärke ist endlich (numeric kennt NaN und Infinity)', async () => {
    for (const [column, value] of [
      ['skill_rd', 'NaN'],
      ['skill_rd', 'Infinity'],
      ['skill_rating', 'NaN'],
      ['skill_rating', '-Infinity'],
    ] as const) {
      const userId = await insertUser();
      await expect(
        q(`insert into player_statistics (user_id, ${column}) values ($1, $2::numeric)`, [
          userId,
          value,
        ]),
      ).rejects.toThrow(/check/);
    }
  });

  it('Spracheinstellung ist Deutsch (ADR-023)', async () => {
    const userId = await insertUser();
    await q(`insert into player_settings (user_id) values ($1)`, [userId]);
    const { rows } = await q(`select locale from player_settings where user_id = $1`, [userId]);
    expect(rows[0]).toEqual({ locale: 'de' });
    await expect(
      q(`update player_settings set locale = 'hu' where user_id = $1`, [userId]),
    ).rejects.toThrow(/check/);
  });
});

describe('Welten', () => {
  it('Regelversionen sind unveränderlich und als RulesConfig lesbar', async () => {
    const instanceId = await insertInstance();
    const { rows } = await q(
      `select r.id, r.config from world_rules r join world_instances i on i.rules_id = r.id where i.id = $1`,
      [instanceId],
    );
    const rules = rows[0] as { id: string; config: unknown };
    expect(parseRulesConfig(rules.config)).toEqual(DEFAULT_RULES.ETERNAL);
    await expect(q(`update world_rules set notes = 'x' where id = $1`, [rules.id])).rejects.toThrow(
      /unveränderlich/,
    );
    await expect(q(`delete from world_rules where id = $1`, [rules.id])).rejects.toThrow(
      /unveränderlich/,
    );
  });

  it('Regelversionen lassen sich nicht per TRUNCATE leeren', async () => {
    await expect(q(`truncate world_rules cascade`)).rejects.toThrow(/unveränderlich/);
    await expect(q(`truncate npc_profiles cascade`)).rejects.toThrow(/unveränderlich/);
  });

  it('Instanz und aktuelle Regelversion gehören zur selben Welt', async () => {
    const instanceId = await insertInstance();
    const { rows } = await q(`select rules_id from world_instances where id = $1`, [instanceId]);
    const foreignRules = rows[0]!['rules_id'] as string;
    const worldId = randomUUID();
    await q(
      `insert into worlds (id, slug, mode, name_key) values ($1, $2, 'ETERNAL', 'world.eternal')`,
      [worldId, `other-${worldId.slice(0, 8)}`],
    );
    await expect(
      q(
        `insert into world_instances (id, world_id, rules_id, map_seed, capacity, starts_at)
         values ($1, $2, $3, 1, 10, game_now())`,
        [randomUUID(), worldId, foreignRules],
      ),
    ).rejects.toThrow(/world_instances_rules_fk/);
    await expect(
      q(`update worlds set current_rules_id = $1 where id = $2`, [foreignRules, worldId]),
    ).rejects.toThrow(/worlds_current_rules_fk/);
  });

  it('Saison: starts_at < pvp_cutoff_at ≤ ends_at', async () => {
    const worldId = randomUUID();
    await q(
      `insert into worlds (id, slug, mode, name_key) values ($1, $2, 'DAILY', 'world.daily')`,
      [worldId, `daily-${worldId.slice(0, 8)}`],
    );
    const insert = (cutoff: string) =>
      q(
        `insert into world_seasons (id, world_id, period_key, starts_at, ends_at, pvp_cutoff_at)
         values ($1, $2, $3, '2026-11-09T00:00Z', '2026-11-10T00:00Z', $4)`,
        [randomUUID(), worldId, cutoff, cutoff],
      );
    await expect(insert('2026-11-09T23:44Z')).resolves.toBeDefined();
    await expect(insert('2026-11-10T00:00Z')).resolves.toBeDefined();
    await expect(insert('2026-11-10T00:01Z')).rejects.toThrow(/check/);
    await expect(insert('2026-11-09T00:00Z')).rejects.toThrow(/check/);
  });
});

describe('Königreiche', () => {
  it('Spielerreich braucht Besitzer, NPC-Reich eine Fraktion', async () => {
    const instanceId = await insertInstance();
    await expect(
      q(
        `insert into kingdoms (id, instance_id, kind, name_parts, color) values ($1, $2, 'PLAYER', '{}', 1)`,
        [randomUUID(), instanceId],
      ),
    ).rejects.toThrow(/kingdoms_kind_owner/);
    await expect(
      q(
        `insert into kingdoms (id, instance_id, kind, name_parts, color) values ($1, $2, 'NPC', '{}', 1)`,
        [randomUUID(), instanceId],
      ),
    ).rejects.toThrow(/kingdoms_kind_owner/);
  });

  it('höchstens ein aktives Reich je Spieler und Instanz; gefallene Reiche zählen nicht', async () => {
    const instanceId = await insertInstance();
    const userId = await insertUser();
    let generation = 0;
    const insert = (status: string) =>
      q(
        `insert into kingdoms (id, instance_id, kind, owner_user_id, name_parts, color, status, fallen_at, generation)
         values ($1, $2, 'PLAYER', $3, '{}', 1, $4, case when $4 = 'FALLEN' then game_now() end, $5)`,
        [randomUUID(), instanceId, userId, status, ++generation],
      );
    await insert('FALLEN');
    await insert('ACTIVE');
    await expect(insert('ACTIVE')).rejects.toThrow(/kingdoms_one_active_per_player/);
    await expect(insert('FALLEN')).resolves.toBeDefined();
  });

  it('generation ist je Spieler und Instanz eindeutig', async () => {
    const instanceId = await insertInstance();
    const userId = await insertUser();
    const insert = () =>
      q(
        `insert into kingdoms (id, instance_id, kind, owner_user_id, name_parts, color, status, fallen_at)
         values ($1, $2, 'PLAYER', $3, '{}', 1, 'FALLEN', game_now())`,
        [randomUUID(), instanceId, userId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/kingdoms_generation_unique/);
  });

  it('Protokolle sind nur anhängbar', async () => {
    const instanceId = await insertInstance();
    const userId = await insertUser();
    const kingdomId = randomUUID();
    await q(
      `insert into kingdoms (id, instance_id, kind, owner_user_id, name_parts, color) values ($1, $2, 'PLAYER', $3, '{}', 1)`,
      [kingdomId, instanceId, userId],
    );
    await q(`insert into kingdom_history (kingdom_id, kind) values ($1, 'FOUNDED')`, [kingdomId]);
    await expect(
      q(`update kingdom_history set kind = 'FALLEN' where kingdom_id = $1`, [kingdomId]),
    ).rejects.toThrow(/unveränderlich/);
  });
});

describe('Karte', () => {
  it('Chunk-Spalten stimmen mit chunkOf aus game-core überein (Eigenschaft)', async () => {
    const instanceId = await insertInstance();
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -5_000, max: 5_000 }),
        fc.integer({ min: -5_000, max: 5_000 }),
        async (qq, r) => {
          const key = `${qq},${r}`;
          if (seen.has(key)) return;
          seen.add(key);
          const { chunkX, chunkY } = chunkOf({ q: qq, r });
          await q(
            `insert into regions (instance_id, q, r, chunk_x, chunk_y, biome, tier) values ($1, $2, $3, $4, $5, 0, 0)`,
            [instanceId, qq, r, chunkX, chunkY],
          );
          await expect(
            q(
              `insert into regions (instance_id, q, r, chunk_x, chunk_y, biome, tier) values ($1, $2, $3, $4, $5, 0, 0)`,
              [instanceId, qq + 100_000, r, chunkX, chunkY],
            ),
          ).rejects.toThrow(/regions_chunk_matches_coordinates/);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Regionen sind unveränderlich; Stufe 0–10', async () => {
    const instanceId = await insertInstance();
    const { rows } = await q(
      `insert into regions (instance_id, q, r, chunk_x, chunk_y, biome, tier) values ($1, 3, 4, 0, 0, 1, 2) returning id`,
      [instanceId],
    );
    await expect(q(`update regions set tier = 3 where id = $1`, [rows[0]!['id']])).rejects.toThrow(
      /unveränderlich/,
    );
    await expect(
      q(
        `insert into regions (instance_id, q, r, chunk_x, chunk_y, biome, tier) values ($1, 5, 0, 0, 0, 1, 11)`,
        [instanceId],
      ),
    ).rejects.toThrow(/check/);
  });

  it('höchstens eine Hauptstadt je Reich, Hauptstadt nur mit Besitzer', async () => {
    const instanceId = await insertInstance();
    const userId = await insertUser();
    const kingdomId = randomUUID();
    await q(
      `insert into kingdoms (id, instance_id, kind, owner_user_id, name_parts, color) values ($1, $2, 'PLAYER', $3, '{}', 1)`,
      [kingdomId, instanceId, userId],
    );
    const region = async (qq: number) => {
      const { chunkX, chunkY } = chunkOf({ q: qq, r: 0 });
      const { rows } = await q(
        `insert into regions (instance_id, q, r, chunk_x, chunk_y, biome, tier) values ($1, $2, 0, $3, $4, 0, 0) returning id`,
        [instanceId, qq, chunkX, chunkY],
      );
      return rows[0]!['id'] as string;
    };
    const state = (regionId: string, owner: string | null, capital: boolean) =>
      q(
        `insert into region_state (region_id, instance_id, chunk_x, chunk_y, owner_kingdom_id, is_capital)
         values ($1, $2, 0, 0, $3, $4)`,
        [regionId, instanceId, owner, capital],
      );
    const mismatched = await region(4);
    await expect(
      q(
        `insert into region_state (region_id, instance_id, chunk_x, chunk_y) values ($1, $2, 1, 0)`,
        [mismatched, instanceId],
      ),
    ).rejects.toThrow(/region_state_region_fk/);
    await state(await region(1), kingdomId, true);
    await expect(state(await region(2), kingdomId, true)).rejects.toThrow(
      /region_state_one_capital/,
    );
    await expect(state(await region(3), null, true)).rejects.toThrow(/check/);
  });
});
