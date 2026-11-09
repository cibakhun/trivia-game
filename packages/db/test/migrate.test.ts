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
    'create function f() returns int language sql begin atomic select 1; end; commit;',
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
    'create function f() returns int language sql begin atomic select 1; end;',
    'create function f() returns int language sql\nbegin atomic\n  select case when true then 1 end;\nEND;',
    'create procedure p() language sql begin atomic end; select 1;',
  ])('lässt %j zu', (sql) => {
    expect(hasTransactionControl(sql)).toBe(false);
  });

  it('erhält Länge und Zeilen, damit Fehlermeldungen passende Positionen behalten', () => {
    // mehrzeilige Zeichenkette, Blockkommentar und Dollar-Rumpf: Umbrüche bleiben an ihrem Platz
    const sql = "select 'a\nb'; -- x\n/* y\n z */ select $$\nbegin\n$$;\nselect 1;";
    const stripped = stripSqlLiterals(sql);
    expect(stripped).toHaveLength(sql.length);
    expect(stripped.split('\n').map((line) => line.length)).toEqual(
      sql.split('\n').map((line) => line.length),
    );
    expect(stripped.indexOf('select 1')).toBe(sql.indexOf('select 1'));
    expect(stripped).not.toContain('begin');
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
