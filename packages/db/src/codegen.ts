import type { ClientBase } from 'pg';

/**
 * Erzeugt die Kysely-Tabellentypen aus dem Katalog einer migrierten Datenbank
 * (docs/DATA_MODEL.md §6.2: Drift-Prüfung „Schema gegen eingecheckten Typ-Stand“). Eigener,
 * kleiner Generator statt kysely-codegen: Die Typzuordnung folgt genau den Typparsern, die
 * `createPool` setzt, und die Ausgabe ist ohne weitere Abhängigkeit deterministisch.
 */

interface ColumnRow {
  readonly table_name: string;
  readonly column_name: string;
  readonly type_name: string;
  readonly not_null: boolean;
  readonly has_default: boolean;
  readonly identity: string; // '' | 'a' (always) | 'd' (by default)
}

/** Verwaltungstabelle des Migrationsläufers, nicht Teil des Spielschemas. */
const EXCLUDED_TABLES = new Set(['schema_migrations']);

interface MappedType {
  readonly select: string;
  readonly insert: string;
  readonly update: string;
}

const same = (type: string): MappedType => ({ select: type, insert: type, update: type });

/** Lese- und Schreibtyp je PostgreSQL-Typ (Typparser in `createPool`). */
const TYPE_MAP: Readonly<Record<string, MappedType>> = {
  uuid: same('string'),
  text: same('string'),
  citext: same('string'),
  int2: same('number'),
  int4: same('number'),
  // pg liefert int8 und numeric als Zeichenkette, damit nichts gerundet wird
  int8: {
    select: 'string',
    insert: 'string | number | bigint',
    update: 'string | number | bigint',
  },
  numeric: { select: 'string', insert: 'string | number', update: 'string | number' },
  bool: same('boolean'),
  timestamptz: { select: 'Date', insert: 'Date | string', update: 'Date | string' },
  date: same('string'),
  // jsonb wird als JSON-Text geschrieben: pg sendet JavaScript-Arrays sonst als PostgreSQL-Array
  jsonb: { select: 'JsonValue', insert: 'string', update: 'string' },
  bytea: same('Buffer'),
  interval: { select: 'object', insert: 'string', update: 'string' },
  _text: same('string[]'),
  _uuid: same('string[]'),
  _int2: same('number[]'),
};

function columnType(row: ColumnRow): string {
  const mapped = TYPE_MAP[row.type_name];
  if (!mapped) {
    throw new Error(
      `Typ ${row.type_name} (${row.table_name}.${row.column_name}) hat keine Zuordnung in codegen.ts`,
    );
  }
  const nullable = (type: string) => (row.not_null ? type : `${type} | null`);
  const select = nullable(mapped.select);
  let insert = nullable(mapped.insert);
  let update = nullable(mapped.update);
  if (row.identity === 'a') {
    insert = 'never';
    update = 'never';
  } else if (row.identity === 'd' || row.has_default) {
    insert = `${insert} | undefined`;
  }
  return select === insert && insert === update
    ? select
    : `ColumnType<${select}, ${insert}, ${update}>`;
}

function pascalCase(name: string): string {
  return name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

const HEADER = `// Automatisch erzeugt von \`pnpm db:types\` (packages/db/src/codegen.ts) – nicht von Hand ändern.
// Ein Integrationstest vergleicht diese Datei mit dem Schema einer frisch migrierten Datenbank.
// ColumnType<Lesen, Einfügen, Ändern>; „| undefined“ beim Einfügen: Die Spalte hat einen Standardwert.
import type { ColumnType } from 'kysely';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
`;

export async function generateSchemaTypes(client: ClientBase): Promise<string> {
  const { rows } = await client.query<ColumnRow>(`
    select c.relname as table_name,
           a.attname as column_name,
           t.typname as type_name,
           a.attnotnull as not_null,
           a.atthasdef as has_default,
           a.attidentity::text as identity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    join pg_catalog.pg_type t on t.oid = a.atttypid
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname, a.attnum`);

  const tables = new Map<string, ColumnRow[]>();
  for (const row of rows) {
    if (EXCLUDED_TABLES.has(row.table_name)) continue;
    const list = tables.get(row.table_name) ?? [];
    list.push(row);
    tables.set(row.table_name, list);
  }

  const parts: string[] = [HEADER];
  for (const [table, columns] of tables) {
    parts.push(`\nexport interface ${pascalCase(table)}Table {`);
    for (const column of columns) {
      const key = /^[a-z_][a-z0-9_]*$/.test(column.column_name)
        ? column.column_name
        : `'${column.column_name}'`;
      parts.push(`  ${key}: ${columnType(column)};`);
    }
    parts.push('}');
  }

  parts.push('\nexport interface Database {');
  for (const table of tables.keys()) parts.push(`  ${table}: ${pascalCase(table)}Table;`);
  parts.push('}\n');
  return parts.join('\n');
}
