import { WENDELMARK } from '@rdw/game-core';
import {
  matchViewSchema,
  parseMatchEvent,
  type MatchView,
  type ParsedMatchEvent,
} from '@rdw/protocol';

/** Gemeinsame Vorlagen der Partie-Tests im Browser: eine Ansicht zu dritt und Ereignisse. */

export const ID = '0190c2a0-0000-7000-8000-000000000001';
export const AT = '2026-11-10T20:00:00.000Z';

export type Step = MatchView['board'] extends infer B
  ? B extends { step: infer S }
    ? S
    : never
  : never;

export function step(partial: Partial<Step>): Step {
  return {
    kind: 'CAPITAL_PICK',
    round: null,
    chooser: null,
    attacker: null,
    defender: null,
    region: null,
    finishReason: null,
    ...partial,
  };
}

/** Ansicht einer laufenden Testpartie zu dritt; geprüft gegen das Schema des Protokolls. */
export function viewOf(
  overrides: Partial<MatchView> = {},
  boardStep: Partial<Step> = {},
): MatchView {
  return matchViewSchema.parse({
    match: {
      id: ID,
      kind: 'TEST',
      mode: 'CLASSIC',
      status: 'RUNNING',
      inviteCode: null,
      rulesPreset: 'PLAYTEST',
      seats: 3,
      timers: {
        triviaMs: 8000,
        estimateMs: 10000,
        pickMs: 5000,
        revealMs: 2000,
        announceMs: 2500,
        pickShowMs: 1200,
      },
      createdAt: AT,
      startedAt: AT,
      finishedAt: null,
    },
    players: [
      {
        joinOrder: 0,
        seat: 1,
        name: 'Anna',
        isBot: false,
        botStrength: null,
        isHost: true,
        isMe: true,
        favorites: null,
      },
      {
        joinOrder: 1,
        seat: 0,
        name: 'Bot (leicht)',
        isBot: true,
        botStrength: 'EASY',
        isHost: false,
        isMe: false,
        favorites: null,
      },
      {
        joinOrder: 2,
        seat: 2,
        name: 'Bot (schwer)',
        isBot: true,
        botStrength: 'HARD',
        isHost: false,
        isMe: false,
        favorites: null,
      },
    ],
    mySeat: 1,
    isHost: true,
    board: {
      map: 'WENDELMARK',
      regions: WENDELMARK.regions.map(() => ({
        owner: null,
        value: 100,
        capitalOf: null,
        fortifications: 0,
      })),
      seats: [0, 1, 2].map((seat) => ({
        seat,
        capital: null,
        capitalLivesLeft: 3,
        eliminated: false,
        points: 0,
        regions: 0,
      })),
      step: step({ chooser: 1, ...boardStep }),
      turns: [
        { seat: 0, status: 'DONE' },
        { seat: 1, status: 'NOW' },
        { seat: 2, status: 'NEXT' },
      ],
      questions: 0,
      duels: 0,
    },
    realm: null,
    phase: { kind: 'PICK', deadline: AT, remainingMs: 5000 },
    legalRegions: [0, 5],
    question: null,
    events: [],
    lastEventSeq: 3,
    serverTime: AT,
    ...overrides,
  });
}

export function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): ParsedMatchEvent {
  const parsed = parseMatchEvent({ seq, type, payload, at: AT });
  if (!parsed) throw new Error(`Ereignis ${type} passt nicht zum Schema`);
  return parsed;
}
