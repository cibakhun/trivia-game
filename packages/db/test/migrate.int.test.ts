import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate, migrationStatus, MIGRATIONS_DIR } from '../src/index.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';

let db: TestDatabase;
let workDir: string;

beforeAll(async () => {
  db = await createTestDatabase({ migrate: false });
  workDir = await mkdtemp(path.join(tmpdir(), 'rdw-migrations-'));
});

afterAll(async () => {
  await db.drop();
  await rm(workDir, { recursive: true, force: true });
});

async function copyMigrations(name: string): Promise<string> {
  const dir = path.join(workDir, name);
  await cp(MIGRATIONS_DIR, dir, { recursive: true });
  return dir;
}

describe('Migrationsdateien', () => {
  it('sind lückenlos nummeriert und ohne eigene Transaktionssteuerung', async () => {
    const migrations = await loadMigrations();
    expect(migrations.map((m) => m.version)).toEqual(
      migrations.map((_, i) => String(i + 1).padStart(4, '0')),
    );
    expect(migrations.length).toBeGreaterThanOrEqual(4);
  });

  it('lehnt Lücken, falsche Namen und eigene Transaktionen ab', async () => {
    const gap = await copyMigrations('gap');
    await writeFile(path.join(gap, '0009_luecke.sql'), 'select 1;');
    await expect(loadMigrations(gap)).rejects.toThrow(/Lücke/);

    const badName = await copyMigrations('bad-name');
    await writeFile(path.join(badName, '0005-Falsch.sql'), 'select 1;');
    await expect(loadMigrations(badName)).rejects.toThrow(/Dateiname/);

    const tx = await copyMigrations('tx');
    await writeFile(path.join(tx, '0005_mit_transaktion.sql'), 'begin;\nselect 1;\ncommit;\n');
    await expect(loadMigrations(tx)).rejects.toThrow(/Transaktionssteuerung/);
  });
});

describe('migrate', () => {
  it('wendet alle Migrationen auf eine leere Datenbank an und ist danach ein No-op', async () => {
    const client = await db.pool.connect();
    try {
      const applied = await migrate(client);
      expect(applied).toEqual((await loadMigrations()).map((m) => m.version));
      expect(await migrate(client)).toEqual([]);
      const status = await migrationStatus(client);
      expect(status.pending).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('erkennt nachträglich geänderte Migrationen', async () => {
    const dir = await copyMigrations('changed');
    const file = path.join(dir, '0002_konten.sql');
    await writeFile(file, `${await readFile(file, 'utf8')}\n-- geändert\n`);
    const client = await db.pool.connect();
    try {
      await expect(migrate(client, { dir })).rejects.toThrow(/Prüfsumme/);
    } finally {
      client.release();
    }
  });

  it('erkennt angewandte Migrationen ohne Datei', async () => {
    const dir = await copyMigrations('missing');
    await rm(path.join(dir, '0004_karte_reiche.sql'));
    const client = await db.pool.connect();
    try {
      await expect(migrate(client, { dir })).rejects.toThrow(/Datei fehlt/);
    } finally {
      client.release();
    }
  });

  it('rollt eine fehlerhafte Migration vollständig zurück', async () => {
    const dir = await copyMigrations('broken');
    const next = String((await loadMigrations()).length + 1).padStart(4, '0');
    await writeFile(
      path.join(dir, `${next}_kaputt.sql`),
      'create table halb_angelegt (id int);\nselect * from gibt_es_nicht;\n',
    );
    const client = await db.pool.connect();
    try {
      await expect(migrate(client, { dir })).rejects.toThrow(/kaputt.*fehlgeschlagen/);
      const { rows } = await client.query(
        `select to_regclass('halb_angelegt') as t, (select count(*)::int from schema_migrations where version = $1) as n`,
        [next],
      );
      expect(rows[0]).toEqual({ t: null, n: 0 });
    } finally {
      client.release();
    }
  });

  it('serialisiert parallele Läufe über die Advisory-Sperre', async () => {
    const fresh = await createTestDatabase({ migrate: false });
    try {
      const clients = await Promise.all([
        fresh.pool.connect(),
        fresh.pool.connect(),
        fresh.pool.connect(),
      ]);
      try {
        const results = await Promise.all(clients.map((c) => migrate(c)));
        const total = results.reduce((sum, r) => sum + r.length, 0);
        expect(total).toBe((await loadMigrations()).length);
      } finally {
        for (const c of clients) c.release();
      }
    } finally {
      await fresh.drop();
    }
  });
});

describe('migrationStatus', () => {
  it('schreibt nichts in eine leere Datenbank', async () => {
    const fresh = await createTestDatabase({ migrate: false });
    try {
      const client = await fresh.pool.connect();
      try {
        const status = await migrationStatus(client);
        expect(status.applied).toEqual([]);
        expect(status.pending.length).toBe((await loadMigrations()).length);
        const { rows } = await client.query<{ t: string | null }>(
          "select to_regclass('schema_migrations')::text as t",
        );
        expect(rows[0]!.t).toBeNull();
      } finally {
        client.release();
      }
    } finally {
      await fresh.drop();
    }
  });
});
