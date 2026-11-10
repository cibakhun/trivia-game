import { createDb, type Db } from '@rdw/db';
import { createTestDatabase, type TestDatabase } from '@rdw/db/testing';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDEMPOTENCY_RETENTION_HOURS, pruneIdempotencyKeys } from '../src/infra/idempotency.ts';

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.pool);
});

afterAll(async () => {
  await database.drop();
});

async function guest(): Promise<string> {
  const id = randomUUID();
  await db.insertInto('users').values({ id, is_guest: true }).execute();
  return id;
}

/** Eintrag, der vor `ageHours` Stunden (Spielzeit) angelegt wurde. */
async function entry(userId: string, ageHours: number): Promise<string> {
  const key = randomUUID();
  await db
    .insertInto('idempotency_keys')
    .values({
      user_id: userId,
      key,
      endpoint: 'POST /test',
      request_hash: '0'.repeat(64),
      response_status: 200,
      response_body: JSON.stringify({ ok: true }),
      created_at: sql<Date>`game_now() - make_interval(mins => ${Math.round(ageHours * 60)})`,
    })
    .execute();
  return key;
}

describe('Aufräumen der Idempotenz-Einträge (API.md §1)', () => {
  it('löscht abgelaufene Einträge aller Konten in Stapeln und behält frische', async () => {
    const [alice, bob] = [await guest(), await guest()];
    const old = IDEMPOTENCY_RETENTION_HOURS + 1;
    await entry(alice, old);
    await entry(alice, old * 2);
    await entry(bob, old);
    await entry(bob, old * 3);
    const fresh = [await entry(alice, IDEMPOTENCY_RETENTION_HOURS - 0.5), await entry(bob, 0)];

    expect(await pruneIdempotencyKeys(db, 3)).toBe(3);
    expect(await pruneIdempotencyKeys(db, 3)).toBe(1);
    expect(await pruneIdempotencyKeys(db, 3)).toBe(0);

    const remaining = await db.selectFrom('idempotency_keys').select(['user_id', 'key']).execute();
    expect(remaining.map((row) => row.key).sort()).toEqual([...fresh].sort());
    expect(new Set(remaining.map((row) => row.user_id))).toEqual(new Set([alice, bob]));
  });
});
