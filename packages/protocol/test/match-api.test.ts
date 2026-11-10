import { describe, expect, it } from 'vitest';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_PATTERN,
  inviteCodeSchema,
  matchCreateRequestSchema,
  matchJoinRequestSchema,
} from '../src/index.ts';

describe('Partie-Anfragen (API.md §2.6)', () => {
  it('Einladungscode: ohne verwechselbare Zeichen, Eingabe unabhängig von Groß- und Kleinschreibung', () => {
    expect(INVITE_CODE_ALPHABET).toHaveLength(32);
    expect(INVITE_CODE_ALPHABET).not.toMatch(/[01IO]/);
    for (const char of INVITE_CODE_ALPHABET)
      expect(`${char.repeat(6)}`).toMatch(INVITE_CODE_PATTERN);
    expect(inviteCodeSchema.parse(' abc2xy ')).toBe('ABC2XY');
    expect(inviteCodeSchema.safeParse('ABC1XY').success).toBe(false);
    expect(inviteCodeSchema.safeParse('ABCDE').success).toBe(false);
    expect(matchJoinRequestSchema.safeParse({ inviteCode: 'ABCDEF', extra: 1 }).success).toBe(
      false,
    );
  });

  it('Anlegen: normale Partie mit Standardregeln, Testpartie mit einer Stärke je freiem Platz', () => {
    expect(matchCreateRequestSchema.parse({ kind: 'STANDARD' })).toEqual({
      kind: 'STANDARD',
      rules: 'DEFAULT',
    });
    expect(
      matchCreateRequestSchema.parse({ kind: 'TEST', seats: 3, botStrengths: ['EASY', 'HARD'] }),
    ).toMatchObject({ seats: 3, rules: 'DEFAULT' });
    expect(
      matchCreateRequestSchema.safeParse({ kind: 'TEST', seats: 3, botStrengths: ['EASY'] })
        .success,
    ).toBe(false);
    expect(
      matchCreateRequestSchema.safeParse({ kind: 'TEST', seats: 4, botStrengths: ['EASY'] })
        .success,
    ).toBe(false);
    expect(matchCreateRequestSchema.safeParse({ kind: 'STANDARD', seats: 2 }).success).toBe(false);
  });
});
