import { describe, expect, it } from 'vitest';
import {
  MAX_CHUNKS_PER_REQUEST,
  chunkListSchema,
  errorBodySchema,
  regionIdSchema,
} from '../src/index.ts';

describe('Chunk-Liste', () => {
  it('liest x:y-Paare, entfernt Doppelte und sortiert nach Zeile und Spalte', () => {
    expect(chunkListSchema.parse('1:0,0:0,-1:2,0:0,-0:0')).toEqual([
      { chunkX: 0, chunkY: 0 },
      { chunkX: 1, chunkY: 0 },
      { chunkX: -1, chunkY: 2 },
    ]);
    expect(Object.is(chunkListSchema.parse('-0:-0')[0]?.chunkX, 0)).toBe(true);
  });

  it('lehnt ungültige Einträge und zu viele Chunks ab', () => {
    for (const bad of ['', '1', '1:2:3', 'a:b', '1:2,', ' 1:2', '1.5:2', '1234567:0']) {
      expect(chunkListSchema.safeParse(bad).success).toBe(false);
    }
    const many = Array.from({ length: MAX_CHUNKS_PER_REQUEST + 1 }, (_, i) => `${i}:0`).join(',');
    expect(chunkListSchema.safeParse(many).success).toBe(false);
    const enough = Array.from({ length: MAX_CHUNKS_PER_REQUEST }, (_, i) => `${i}:0`).join(',');
    expect(chunkListSchema.parse(enough)).toHaveLength(MAX_CHUNKS_PER_REQUEST);
  });
});

describe('Fehlerformat und IDs', () => {
  it('kennt nur dokumentierte Codes', () => {
    const body = { error: { code: 'INSTANCE_FULL', message: 'voll', details: {} } };
    expect(errorBodySchema.parse(body)).toEqual(body);
    expect(
      errorBodySchema.safeParse({ error: { code: 'NOPE', message: '', details: {} } }).success,
    ).toBe(false);
  });

  it('akzeptiert Regions-IDs nur als positive Dezimalzahl', () => {
    expect(regionIdSchema.safeParse('42').success).toBe(true);
    expect(regionIdSchema.safeParse('9223372036854775807').success).toBe(true);
    for (const bad of ['0', '01', '-1', '1e3', '9223372036854775808', '12345678901234567890', '']) {
      expect(regionIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});
