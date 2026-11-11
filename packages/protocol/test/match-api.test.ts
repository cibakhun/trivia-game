import { describe, expect, it } from 'vitest';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_PATTERN,
  inviteCodeSchema,
  matchBoardSchema,
  matchCreateRequestSchema,
  matchJoinRequestSchema,
  matchSeatBotRequestSchema,
  parseMatchEvent,
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

  it('Bot auf einen Platz: eine Stärke oder null zum Freigeben (ADR-052)', () => {
    expect(matchSeatBotRequestSchema.parse({ strength: 'HARD' })).toEqual({ strength: 'HARD' });
    expect(matchSeatBotRequestSchema.parse({ strength: null })).toEqual({ strength: null });
    expect(matchSeatBotRequestSchema.safeParse({}).success).toBe(false);
    expect(matchSeatBotRequestSchema.safeParse({ strength: 'GOTT' }).success).toBe(false);
    expect(matchSeatBotRequestSchema.safeParse({ strength: 'EASY', seat: 1 }).success).toBe(false);
    // Die Ereignisse der Aufstellung nennen die Stärke; ältere ohne das Feld bleiben lesbar
    const at = '2026-11-11T00:00:00.000Z';
    const joined = (payload: Record<string, unknown>) =>
      parseMatchEvent({ seq: 1, type: 'PLAYER_JOINED', payload, at })?.payload;
    expect(joined({ joinOrder: 1, bot: 'EASY' })).toEqual({ joinOrder: 1, bot: 'EASY' });
    expect(joined({ joinOrder: 1 })).toEqual({ joinOrder: 1 });
  });

  it('Brett: Zugfolge mit Sitz und Stand je Zug', () => {
    const board = {
      map: 'KERNMARK',
      regions: [],
      seats: [],
      step: {
        kind: 'LAND_PICK',
        round: 2,
        chooser: 1,
        attacker: null,
        defender: null,
        region: null,
        finishReason: null,
      },
      turns: [
        { seat: 1, status: 'DONE' },
        { seat: 1, status: 'NOW' },
        { seat: 0, status: 'NEXT' },
      ],
      questions: 2,
      duels: 0,
    };
    expect(matchBoardSchema.parse(board)).toEqual(board);
    expect(
      matchBoardSchema.safeParse({ ...board, turns: [{ seat: 1, status: 'SPÄTER' }] }).success,
    ).toBe(false);
    expect(matchBoardSchema.safeParse({ ...board, turns: undefined }).success).toBe(false);
  });
});
