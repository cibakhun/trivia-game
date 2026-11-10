import { beforeAll, describe, expect, it } from 'vitest';
import { readSchemaTypes, renderSchemaTypes } from '../src/schema-file.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';

/** Drift-Prüfung (DATA_MODEL §6.2): eingecheckte Typen gegen eine frisch migrierte Datenbank. */

let db: TestDatabase;

// Aufräumen nur, wenn das Anlegen gelang: sonst überdeckt ein Folgefehler die Ursache.
beforeAll(async () => {
  db = await createTestDatabase();
  return () => db.drop();
});

describe('schema.generated.ts', () => {
  it('passt zum Schema nach allen Migrationen (sonst: pnpm db:types)', async () => {
    const client = await db.pool.connect();
    try {
      expect(await renderSchemaTypes(client)).toBe(await readSchemaTypes());
    } finally {
      client.release();
    }
  });
});
