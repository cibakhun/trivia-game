import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.generated.ts';

/**
 * Typisierter Datenbankzugriff (ARCHITECTURE §2: Kysely). Die Typparser legen fest, was der
 * Generator in `codegen.ts` als Lesetyp annimmt: `date` bleibt eine Zeichenkette (JJJJ-MM-TT),
 * statt als Mitternacht in der lokalen Zeitzone des Servers gelesen zu werden. `int8` und
 * `numeric` bleiben Zeichenketten (Standard von pg), damit nichts gerundet wird.
 */

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;
export type { Database };

const DATE_OID = 1082;

function typeOverrides(): pg.TypeOverrides {
  const types = new pg.TypeOverrides();
  types.setTypeParser(DATE_OID, (value: string) => value);
  return types;
}

export interface CreatePoolOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly applicationName?: string;
}

export function createPool(options: CreatePoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'rdw',
    types: typeOverrides(),
  });
}

/**
 * Kysely über einem bestehenden Pool. Achtung: `db.destroy()` beendet auch den Pool; wer den Pool
 * weiterverwenden will, ruft `destroy()` nicht auf und beendet den Pool selbst.
 */
export function createDb(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
