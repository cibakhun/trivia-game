import { describe, expect, it } from 'vitest';
import {
  MAX_CHUNKS_PER_REQUEST,
  answerRequestSchema,
  chunkListSchema,
  presentedQuestionSchema,
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

describe('Kampf und Herausforderung', () => {
  it('nimmt Antworten als Optionstoken oder Rohtext mit Sprache an', () => {
    expect(
      answerRequestSchema.safeParse({ optionToken: 'k7Qp', clientElapsedMs: 4210 }).success,
    ).toBe(true);
    expect(
      answerRequestSchema.safeParse({ rawInput: '1.234,5', locale: 'de', clientElapsedMs: -3.5 })
        .success,
    ).toBe(true);
    expect(answerRequestSchema.safeParse({ rawInput: '12' }).success).toBe(false);
    expect(
      answerRequestSchema.safeParse({ optionToken: 'a', rawInput: '1', locale: 'de' }).success,
    ).toBe(false);
    expect(answerRequestSchema.safeParse({ rawInput: '1'.repeat(41), locale: 'de' }).success).toBe(
      false,
    );
  });

  it('beschreibt gestellte Fragen ohne Lösung', () => {
    const base = {
      challengeId: '01933b6e-0000-7000-8000-000000000001',
      step: 0,
      prompt: 'Frage?',
      timeLimitMs: 20000,
      remainingMs: 20500,
      presentedAt: '2026-11-10T06:00:00.000Z',
    };
    expect(
      presentedQuestionSchema.safeParse({
        ...base,
        kind: 'TRIVIA',
        options: [{ token: 't1', text: 'A' }],
      }).success,
    ).toBe(true);
    // ein Feld „correct“ wäre ein Leck und ist nicht erlaubt
    expect(
      presentedQuestionSchema.safeParse({
        ...base,
        kind: 'TRIVIA',
        options: [{ token: 't1', text: 'A', correct: true }],
      }).success,
    ).toBe(false);
    expect(
      presentedQuestionSchema.safeParse({
        ...base,
        step: 1,
        kind: 'ESTIMATE',
        unitLabel: 'Meter',
        answerPrecision: 0,
      }).success,
    ).toBe(true);
  });
});
