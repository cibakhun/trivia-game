import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  advanceGameClock,
  createTestDatabase,
  gameNow,
  setGameClockOffset,
  type TestDatabase,
} from '../src/testing/index.ts';

const HOUR = 3_600_000;

describe('game_now() in Test/Staging (Versatz erlaubt)', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db.drop();
  });

  it('folgt ohne Versatz der Datenbankuhr', async () => {
    const { rows } = await db.pool.query<{ diff: number }>(
      `select extract(epoch from (game_now() - clock_timestamp())) * 1000 as diff`,
    );
    expect(Math.abs(Number(rows[0]!.diff))).toBeLessThan(50);
  });

  it('nutzt clock_timestamp(): innerhalb einer Transaktion läuft die Zeit weiter', async () => {
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      const a = await gameNow(client);
      await client.query('select pg_sleep(0.05)');
      const b = await gameNow(client);
      await client.query('commit');
      expect(b.getTime() - a.getTime()).toBeGreaterThanOrEqual(40);
    } finally {
      client.release();
    }
  });

  it('lässt 24-h-Fristen in Sekunden durchspielen', async () => {
    const before = await gameNow(db.pool);
    await advanceGameClock(db.pool, 24 * HOUR);
    const after = await gameNow(db.pool);
    expect(after.getTime() - before.getTime()).toBeGreaterThanOrEqual(24 * HOUR);
    expect(after.getTime() - before.getTime()).toBeLessThan(24 * HOUR + 1_000);
    await setGameClockOffset(db.pool, 0);
    expect(Math.abs((await gameNow(db.pool)).getTime() - Date.now())).toBeLessThan(5_000);
  });

  it('erlaubt weder Einfügen noch Löschen oder Leeren', async () => {
    await expect(db.pool.query(`insert into game_clock (id) values (1)`)).rejects.toThrow();
    await expect(db.pool.query(`delete from game_clock`)).rejects.toThrow(/nur die eine Zeile/);
    await expect(db.pool.query(`truncate game_clock`)).rejects.toThrow(/nicht geleert/);
  });
});

describe('game_clock in Produktion (Versatz gesperrt)', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase({ allowClockOffset: false });
  });
  afterAll(async () => {
    await db.drop();
  });

  it('lehnt jeden Versatz ab', async () => {
    await expect(setGameClockOffset(db.pool, HOUR)).rejects.toThrow(/schreibgeschützt/);
  });

  it('lässt sich nicht durch eine Sitzungseinstellung umgehen', async () => {
    const client = await db.pool.connect();
    try {
      await client.query(`set rdw.allow_game_clock_offset = 'on'`);
      await expect(setGameClockOffset(client, HOUR)).rejects.toThrow(/schreibgeschützt/);
    } finally {
      client.release();
    }
  });

  it('Versatz 0 bleibt erlaubt (No-op)', async () => {
    await expect(setGameClockOffset(db.pool, 0)).resolves.toBeUndefined();
  });

  it('erkennt auch Kalenderversätze, die als Gesamtdauer 0 ergeben', async () => {
    // Intervalle vergleichen sonst nur die Gesamtdauer: 1 Monat − 30 Tage = 0, verschiebt aber Zeit
    await expect(
      db.pool.query(`update game_clock set "offset" = interval '1 month -30 days' where id = 1`),
    ).rejects.toThrow(/schreibgeschützt/);
  });

  it('lässt sich nicht durch temporäre Tabellen täuschen', async () => {
    const client = await db.pool.connect();
    try {
      // temporäre Tabellen würden sonst vor public und sogar vor pg_catalog gefunden
      await client.query(
        `create temp table pg_db_role_setting as
           select 0::oid as setrole, oid as setdatabase,
                  array['rdw.allow_game_clock_offset=on'] as setconfig
           from pg_catalog.pg_database where datname = current_database()`,
      );
      await expect(setGameClockOffset(client, HOUR)).rejects.toThrow(/schreibgeschützt/);
      await client.query(
        `create temp table game_clock as select 1 as id, interval '1 day' as "offset"`,
      );
      const { rows } = await client.query<{ diff: number }>(
        `select extract(epoch from (game_now() - clock_timestamp())) * 1000 as diff`,
      );
      expect(Math.abs(Number(rows[0]!.diff))).toBeLessThan(50);
    } finally {
      await client.query('discard temp');
      client.release();
    }
  });
});
