import { describe, expect, it } from 'vitest';
import { parseDbEnv } from '../src/env.ts';
import { hasTransactionControl, stripSqlLiterals } from '../src/migrate.ts';

describe('hasTransactionControl', () => {
  it.each([
    'create table a (x int); commit;',
    'create table a (x int);\ncommit;',
    'begin;\nselect 1;',
    'select 1; COMMIT WORK;',
    'select 1; rollback;',
    'select 1; end;',
    'select 1; abort;',
    'select 1;   start   transaction;',
    "select 1; prepare transaction 'x';",
    'select $1::int; begin;',
  ])('erkennt %j', (sql) => {
    expect(hasTransactionControl(sql)).toBe(true);
  });

  it.each([
    'create function f() returns int language plpgsql as $$ declare x int; begin return 1; end $$;',
    'create function f() returns void language plpgsql as $body$ begin commit; end $body$;',
    'create function f() returns int language plpgsql as $$\nbegin\n  return 1;\nend\n$$;',
    "select 'x; commit;';",
    "select E'it\\'s; commit;';",
    "select 'it''s; commit;';",
    '-- begin;\nselect 1;',
    '/* commit; */ select 1;',
    'select "begin"; select 1 as "end";',
    'create table beginnings (x int); create table ending (x int);',
  ])('lässt %j zu', (sql) => {
    expect(hasTransactionControl(sql)).toBe(false);
  });

  it('erhält Länge und Zeilen, damit Fehlermeldungen passende Positionen behalten', () => {
    const sql = "select 'a'; -- x\n/* y */ select $$z$$;";
    const stripped = stripSqlLiterals(sql);
    expect(stripped).toHaveLength(sql.length);
    expect(stripped.split('\n')).toHaveLength(2);
  });
});

describe('parseDbEnv', () => {
  const url = 'postgres://rdw@127.0.0.1:5432/rdw';

  it('verlangt APP_ENV ausdrücklich: ohne Angabe greift sonst der Produktionsschutz nicht', () => {
    expect(() => parseDbEnv({ DATABASE_URL: url })).toThrow(/APP_ENV/);
  });

  it('akzeptiert eine gültige Umgebung', () => {
    expect(parseDbEnv({ APP_ENV: 'production', DATABASE_URL: url })).toEqual({
      APP_ENV: 'production',
      DATABASE_URL: url,
    });
  });

  it('lehnt unbekannte Umgebungen und andere URLs ab', () => {
    expect(() => parseDbEnv({ APP_ENV: 'prod', DATABASE_URL: url })).toThrow(/APP_ENV/);
    expect(() => parseDbEnv({ APP_ENV: 'local', DATABASE_URL: 'mysql://x/y' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
