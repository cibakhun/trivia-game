import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientBase } from 'pg';

/**
 * Migrationsläufer (docs/DATA_MODEL.md §6): nummerierte SQL-Dateien `NNNN_beschreibung.sql`,
 * nur vorwärts, jede Datei in einer eigenen Transaktion. Angewandte Migrationen werden über eine
 * Prüfsumme gegen nachträgliche Änderungen abgesichert. Eine Advisory-Sperre verhindert, dass
 * zwei Prozesse gleichzeitig migrieren.
 */

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

const FILE_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
/** Anweisungen, die die Transaktion des Läufers beenden oder verschachteln würden. */
const TRANSACTION_CONTROL =
  /^(begin|commit|rollback|abort|end|start\s+transaction|prepare\s+transaction)\b/i;
/** Verwaltungstabelle, schemaqualifiziert: eine temporäre Tabelle darf sie nicht überdecken. */
const LEDGER = 'public.schema_migrations';
/** Fester Schlüssel für pg_advisory_lock („rdw-migrations“). */
const LOCK_KEY = 7_268_469_001;

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly file: string;
  readonly sql: string;
  readonly checksum: string;
}

export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Kommentare, Zeichenketten (auch E'…'), Bezeichner in Anführungszeichen und Dollar-Quoting.
 * Die Alternativen werden von links nach rechts gesucht, daher zählt z. B. `--` in einer
 * Zeichenkette nicht als Kommentar. Verschachtelte Blockkommentare enden hier an der ersten
 * schließenden Marke; das kann nur zu einer unnötigen Ablehnung führen, nie zu einer übersehenen Anweisung.
 */
const SQL_NON_CODE =
  /--[^\n]*|\/\*[\s\S]*?\*\/|[eE]'(?:[^'\\]|\\[\s\S]|'')*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g;

/**
 * Ersetzt alles außer den Anweisungen selbst durch Leerzeichen, sodass z. B. ein `begin` im Rumpf
 * einer PL/pgSQL-Funktion nicht als Transaktionsbefehl gilt.
 */
export function stripSqlLiterals(sql: string): string {
  return sql.replace(SQL_NON_CODE, (match) => ' '.repeat(match.length));
}

/** Enthält die Datei eine eigene Transaktionssteuerung (auch mitten in einer Zeile)? */
export function hasTransactionControl(sql: string): boolean {
  return stripSqlLiterals(sql)
    .split(';')
    .some((statement) => TRANSACTION_CONTROL.test(statement.trim()));
}

/** Liest und prüft alle Migrationsdateien eines Verzeichnisses (lückenlos ab 0001). */
export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const [index, file] of files.entries()) {
    const match = FILE_PATTERN.exec(file);
    if (!match)
      throw new MigrationError(`Ungültiger Dateiname: ${file} (erwartet NNNN_beschreibung.sql)`);
    const [, version = '', name = ''] = match;
    const expected = String(index + 1).padStart(4, '0');
    if (version !== expected) {
      throw new MigrationError(
        `Lücke oder Doppelung in der Nummerierung: ${file}, erwartet ${expected}_…`,
      );
    }
    const sql = await readFile(path.join(dir, file), 'utf8');
    if (hasTransactionControl(sql)) {
      throw new MigrationError(
        `${file}: keine eigene Transaktionssteuerung, der Läufer kapselt jede Datei`,
      );
    }
    migrations.push({ version, name, file, sql, checksum: checksumOf(sql) });
  }
  return migrations;
}

export interface MigrationPlan {
  readonly applied: readonly string[];
  readonly pending: readonly Migration[];
}

async function ensureTable(client: ClientBase): Promise<void> {
  await client.query(`
    create table if not exists ${LEDGER} (
      version    text primary key,
      name       text not null,
      checksum   text not null,
      applied_at timestamptz not null default clock_timestamp()
    )`);
}

/** Vergleicht Datenbankstand und Dateien; wirft bei geänderten, fehlenden oder ungeordneten Migrationen. */
async function plan(client: ClientBase, migrations: readonly Migration[]): Promise<MigrationPlan> {
  const { rows } = await client.query<{ version: string; checksum: string }>(
    `select version, checksum from ${LEDGER} order by version`,
  );
  const byVersion = new Map(migrations.map((m) => [m.version, m]));
  for (const row of rows) {
    const migration = byVersion.get(row.version);
    if (!migration) {
      throw new MigrationError(`Migration ${row.version} ist angewandt, aber die Datei fehlt`);
    }
    if (migration.checksum !== row.checksum) {
      throw new MigrationError(
        `${migration.file} wurde nach dem Anwenden geändert (Prüfsumme weicht ab); Änderungen nur als neue Migration`,
      );
    }
  }
  const appliedVersions = new Set(rows.map((r) => r.version));
  const pending = migrations.filter((m) => !appliedVersions.has(m.version));
  const lastApplied = rows.at(-1)?.version;
  const outOfOrder = pending.find((m) => lastApplied !== undefined && m.version < lastApplied);
  if (outOfOrder) {
    throw new MigrationError(`${outOfOrder.file} liegt vor bereits angewandten Migrationen`);
  }
  return { applied: rows.map((r) => r.version), pending };
}

async function withLock<T>(client: ClientBase, fn: () => Promise<T>): Promise<T> {
  await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

/** Zeigt, was angewandt würde; schreibt nichts (auch nicht die Verwaltungstabelle). */
export async function migrationStatus(client: ClientBase, dir?: string): Promise<MigrationPlan> {
  const migrations = await loadMigrations(dir);
  const { rows } = await client.query<{ exists: boolean }>(
    `select to_regclass('${LEDGER}') is not null as exists`,
  );
  if (!rows[0]?.exists) return { applied: [], pending: migrations };
  return withLock(client, () => plan(client, migrations));
}

export interface MigrateOptions {
  readonly dir?: string;
  readonly log?: (message: string) => void;
}

/** Wendet alle ausstehenden Migrationen an und liefert ihre Versionen. */
export async function migrate(client: ClientBase, options: MigrateOptions = {}): Promise<string[]> {
  const migrations = await loadMigrations(options.dir);
  const log = options.log ?? (() => undefined);
  return withLock(client, async () => {
    await ensureTable(client);
    const { pending } = await plan(client, migrations);
    const done: string[] = [];
    for (const migration of pending) {
      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(`insert into ${LEDGER} (version, name, checksum) values ($1, $2, $3)`, [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
        await client.query('commit');
      } catch (error) {
        // Ein Fehler beim Zurückrollen (z. B. abgebrochene Verbindung) soll die eigentliche
        // Ursache und den Dateinamen nicht verdecken.
        await client.query('rollback').catch(() => undefined);
        throw new MigrationError(`${migration.file} fehlgeschlagen: ${(error as Error).message}`, {
          cause: error,
        });
      }
      log(`angewandt: ${migration.file}`);
      done.push(migration.version);
    }
    return done;
  });
}
