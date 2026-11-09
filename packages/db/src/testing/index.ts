import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../migrate.ts';

/**
 * Testhelfer (docs/TEST_PLAN.md §2): Jede Testdatei bekommt eine eigene, frisch migrierte
 * Datenbank mit erlaubtem Zeitversatz. `TEST_DATABASE_URL` zeigt auf einen Server, auf dem der
 * Benutzer Datenbanken anlegen darf und Superuser ist (für ALTER DATABASE … SET rdw.*).
 * Nie gegen Staging oder Produktion verwenden.
 */

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export interface TestDatabase {
  readonly name: string;
  readonly url: string;
  readonly pool: pg.Pool;
  /** Schließt den Pool und löscht die Datenbank. */
  drop(): Promise<void>;
}

export interface CreateTestDatabaseOptions {
  /** Migrationen anwenden (Standard: ja). */
  readonly migrate?: boolean;
  /** Zeitversatz erlauben (Standard: ja); `false` simuliert eine Produktionsdatenbank. */
  readonly allowClockOffset?: boolean;
}

export function testServerUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL fehlt: Integrationstests brauchen einen PostgreSQL-Server (siehe README, docker compose up -d db)',
    );
  }
  return url;
}

function withDatabase(serverUrl: string, database: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: testServerUrl() });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

export async function createTestDatabase(
  options: CreateTestDatabaseOptions = {},
): Promise<TestDatabase> {
  const name = `rdw_test_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  await withAdmin(async (admin) => {
    await admin.query(`create database ${name}`);
    if (options.allowClockOffset ?? true) {
      await admin.query(`alter database ${name} set rdw.allow_game_clock_offset = 'on'`);
    }
  });
  const url = withDatabase(testServerUrl(), name);
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  let poolEnded = false;
  const drop = async (): Promise<void> => {
    // wiederholbar: ein zweiter Aufruf nach fehlgeschlagenem DROP beendet den Pool nicht erneut
    if (!poolEnded) {
      poolEnded = true;
      await pool.end();
    }
    await withAdmin((admin) => admin.query(`drop database if exists ${name} with (force)`));
  };
  if (options.migrate ?? true) {
    try {
      const client = await pool.connect();
      try {
        await migrate(client);
      } finally {
        client.release();
      }
    } catch (error) {
      // sonst blieben Pool und Datenbank liegen, weil der Aufrufer drop() nie erhält. Scheitert
      // auch das Aufräumen, wird es protokolliert (Name zum Nachlöschen), der Migrationsfehler
      // bleibt der geworfene Fehler.
      await drop().catch((cleanupError: unknown) => {
        console.error(`Testdatenbank ${name} konnte nicht gelöscht werden:`, cleanupError);
      });
      throw error;
    }
  }
  return { name, url, pool, drop };
}

/** Stellt die Spielzeit relativ zur realen Zeit ein (nur Test/Staging). */
export async function setGameClockOffset(db: Queryable, offsetMs: number): Promise<void> {
  if (!Number.isSafeInteger(offsetMs)) throw new RangeError('offsetMs muss ganzzahlig sein');
  await db.query(
    `update game_clock set "offset" = make_interval(secs => $1::double precision / 1000) where id = 1`,
    [offsetMs],
  );
}

/** Verschiebt die Spielzeit um `ms` nach vorn. */
export async function advanceGameClock(db: Queryable, ms: number): Promise<void> {
  if (!Number.isSafeInteger(ms)) throw new RangeError('ms muss ganzzahlig sein');
  await db.query(
    `update game_clock set "offset" = "offset" + make_interval(secs => $1::double precision / 1000) where id = 1`,
    [ms],
  );
}

/** Aktuelle Spielzeit der Datenbank (Millisekundengenauigkeit). */
export async function gameNow(db: Queryable): Promise<Date> {
  const { rows } = await db.query<{ now: Date }>('select game_now() as now');
  const row = rows[0];
  if (!row) throw new Error('game_now() lieferte keine Zeile');
  return row.now;
}
