import { areNeighbors, WENDELMARK } from '@rdw/game-core';
import {
  matchViewSchema,
  parseMatchEvent,
  type MatchPresentedQuestion,
  type MatchView,
  type ParsedMatchEvent,
} from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import { BOARD_HEX_SIZE, boardLayout } from '../src/match/board-layout.ts';
import {
  lastOf,
  needsPresent,
  pollDelay,
  revealFor,
  screenStateOf,
  type LocalQuestion,
} from '../src/match/match-model.ts';
import {
  logText,
  mapOfView,
  outcomeTexts,
  pickText,
  questionContext,
  regionNames,
  seatNames,
  stepLabel,
} from '../src/match/match-text.ts';

/** Partie im Browser (M4): Kartengeometrie, Zustand des Bildschirms, Auflösung und Texte. */

const ID = '0190c2a0-0000-7000-8000-000000000001';
const AT = '2026-11-10T20:00:00.000Z';

type Step = MatchView['board'] extends infer B ? (B extends { step: infer S } ? S : never) : never;

function step(partial: Partial<Step>): Step {
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
function viewOf(overrides: Partial<MatchView> = {}, boardStep: Partial<Step> = {}): MatchView {
  return matchViewSchema.parse({
    match: {
      id: ID,
      kind: 'TEST',
      status: 'RUNNING',
      inviteCode: null,
      rulesPreset: 'PLAYTEST',
      seats: 3,
      timers: { triviaMs: 8000, estimateMs: 10000, pickMs: 5000, revealMs: 2000 },
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
      },
      {
        joinOrder: 1,
        seat: 0,
        name: 'Bot (leicht)',
        isBot: true,
        botStrength: 'EASY',
        isHost: false,
        isMe: false,
      },
      {
        joinOrder: 2,
        seat: 2,
        name: 'Bot (schwer)',
        isBot: true,
        botStrength: 'HARD',
        isHost: false,
        isMe: false,
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
      questions: 0,
      duels: 0,
    },
    phase: { kind: 'PICK', deadline: AT, remainingMs: 5000 },
    legalRegions: [0, 5],
    question: null,
    events: [],
    lastEventSeq: 3,
    serverTime: AT,
    ...overrides,
  });
}

function questionInfo(
  myStatus: NonNullable<MatchView['question']>['myStatus'],
  seq = 4,
): MatchView['question'] {
  return {
    seq,
    kind: 'ESTIMATE',
    purpose: 'LAND',
    seats: [0, 1, 2],
    closesAt: AT,
    resolved: false,
    myStatus,
  };
}

const presented: MatchPresentedQuestion = {
  matchId: ID,
  seq: 4,
  kind: 'ESTIMATE',
  prompt: 'Wie hoch ist der Turm?',
  timeLimitMs: 10000,
  remainingMs: 10500,
  presentedAt: AT,
  unitLabel: 'm',
  answerPrecision: 0,
};

function local(status: LocalQuestion['status'], seq = 4): LocalQuestion {
  return { seq, question: presented, shownAt: 0, deadline: 10500, reloaded: false, status };
}

function event(seq: number, type: string, payload: Record<string, unknown>): ParsedMatchEvent {
  const parsed = parseMatchEvent({ seq, type, payload, at: AT });
  if (!parsed) throw new Error(`Ereignis ${type} passt nicht zum Schema`);
  return parsed;
}

describe('Karte der Partie', () => {
  const layout = boardLayout(WENDELMARK);

  it('legt jede Region der Wendelmark als Sechseck an, Nachbarn berühren sich', () => {
    expect(layout.cells.map((c) => c.id)).toEqual(WENDELMARK.regions.map((r) => r.id));
    for (const a of layout.cells) {
      for (const b of layout.cells) {
        if (a.id >= b.id) continue;
        const distance = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        const ra = WENDELMARK.regions[a.id];
        const rb = WENDELMARK.regions[b.id];
        if (!ra || !rb) throw new Error('Region fehlt');
        if (areNeighbors(ra.cell, rb.cell))
          expect(distance).toBeCloseTo(Math.sqrt(3) * BOARD_HEX_SIZE, 1);
        else expect(distance).toBeGreaterThan(Math.sqrt(3) * BOARD_HEX_SIZE + 1);
      }
    }
  });

  it('passt mit allen Ecken in den viewBox', () => {
    const [, , width, height] = layout.viewBox.split(' ').map(Number);
    for (const cell of layout.cells) {
      for (const point of cell.points.split(' ')) {
        const [x, y] = point.split(',').map(Number);
        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThan(0);
        expect(x).toBeLessThan(width ?? 0);
        expect(y).toBeLessThan(height ?? 0);
      }
    }
  });
});

describe('Zustand des Bildschirms', () => {
  it('fragt in der Aufstellung langsamer, im Spiel schnell, danach nicht mehr', () => {
    const running = viewOf();
    expect(pollDelay(running)).toBe(750);
    expect(pollDelay(viewOf({ match: { ...running.match, status: 'LOBBY' } }))).toBe(1500);
    expect(pollDelay(viewOf({ match: { ...running.match, status: 'FINISHED' } }))).toBeNull();
    expect(pollDelay(viewOf({ match: { ...running.match, status: 'ABANDONED' } }))).toBeNull();
  });

  it('Wahl: eigene mit wählbaren Regionen, sonst Warten', () => {
    expect(screenStateOf(null, null)).toBe('loading');
    expect(screenStateOf(viewOf(), null)).toBe('pick');
    expect(screenStateOf(viewOf({ legalRegions: [] }), null)).toBe('waiting-pick');
  });

  it('Frage: sofort abholen, nach dem Abholen zeigen, nach der Antwort warten', () => {
    const phase = { kind: 'QUESTION' as const, deadline: AT, remainingMs: 12000 };
    const open = viewOf({ phase, legalRegions: [], question: questionInfo('NOT_PRESENTED') });
    expect(needsPresent(open, null)).toBe(true);
    expect(screenStateOf(open, null)).toBe('presenting');
    expect(needsPresent(open, local('OPEN'))).toBe(false);
    expect(screenStateOf(open, local('OPEN'))).toBe('question');
    // Reload: schon abgeholt, aber nicht in diesem Browser
    const reloaded = viewOf({ phase, legalRegions: [], question: questionInfo('PRESENTED') });
    expect(needsPresent(reloaded, null)).toBe(true);
    // Eine alte Frage im Browser zählt nicht für die neue
    expect(needsPresent(reloaded, local('ANSWERED', 3))).toBe(true);
    expect(screenStateOf(reloaded, local('ANSWERED'))).toBe('answered');
    expect(screenStateOf(reloaded, local('MISSED'))).toBe('missed');
    const answered = viewOf({ phase, legalRegions: [], question: questionInfo('ANSWERED') });
    expect(needsPresent(answered, null)).toBe(false);
    expect(screenStateOf(answered, null)).toBe('answered');
    const missed = viewOf({ phase, legalRegions: [], question: questionInfo('MISSED') });
    expect(screenStateOf(missed, local('OPEN'))).toBe('missed');
    const watching = viewOf({
      phase,
      legalRegions: [],
      question: questionInfo('NOT_PARTICIPATING'),
    });
    expect(needsPresent(watching, null)).toBe(false);
    expect(screenStateOf(watching, null)).toBe('spectating');
  });

  it('Auflösung, Ende, Aufstellung und Abbruch', () => {
    const base = viewOf();
    const reveal = viewOf({
      phase: { kind: 'REVEAL', deadline: AT, remainingMs: 2000 },
      legalRegions: [],
      question: { ...questionInfo('ANSWERED'), resolved: true } as MatchView['question'],
    });
    expect(screenStateOf(reveal, null)).toBe('reveal');
    expect(needsPresent(reveal, null)).toBe(false);
    expect(screenStateOf(viewOf({ match: { ...base.match, status: 'FINISHED' } }), null)).toBe(
      'finished',
    );
    expect(screenStateOf(viewOf({ match: { ...base.match, status: 'LOBBY' } }), null)).toBe(
      'lobby',
    );
    expect(screenStateOf(viewOf({ match: { ...base.match, status: 'ABANDONED' } }), null)).toBe(
      'abandoned',
    );
  });
});

describe('Auflösung aus den Ereignissen', () => {
  const answers = [0, 1, 2].map((seat) => ({
    seat,
    answered: seat !== 0,
    correct: false,
    optionText: null,
    value: seat === 0 ? null : '120',
    distance: seat === 0 ? null : '5',
    effectiveMs: seat === 0 ? null : 3200,
  }));
  const events = [
    event(10, 'QUESTION_OPENED', {
      seq: 1,
      kind: 'ESTIMATE',
      purpose: 'LAND',
      seats: [0, 1, 2],
      timeLimitMs: 10000,
      closesAt: AT,
    }),
    event(11, 'QUESTION_RESOLVED', {
      seq: 1,
      kind: 'ESTIMATE',
      prompt: 'Wie hoch ist der Turm?',
      options: [],
      solution: { value: '125', unit: 'm' },
      explanation: null,
      answers,
    }),
    event(12, 'LAND_RANKED', {
      round: 1,
      ranking: [
        { seat: 1, place: 1, picks: 2, distance: '5', effectiveMs: 3200 },
        { seat: 2, place: 2, picks: 1, distance: '5', effectiveMs: 4000 },
        { seat: 0, place: 3, picks: 0, distance: null, effectiveMs: null },
      ],
    }),
    event(13, 'REGION_CLAIMED', { round: 1, seat: 1, region: 3 }),
    event(14, 'QUESTION_OPENED', {
      seq: 2,
      kind: 'TRIVIA',
      purpose: 'DUEL_TRIVIA',
      seats: [2, 1],
      timeLimitMs: 8000,
      closesAt: AT,
    }),
    event(15, 'QUESTION_RESOLVED', {
      seq: 2,
      kind: 'TRIVIA',
      prompt: 'Welche Farbe hat der Himmel?',
      options: [
        { token: 'a', text: 'Blau' },
        { token: 'b', text: 'Grün' },
      ],
      solution: { optionToken: 'a', text: 'Blau' },
      explanation: null,
      answers: [
        { ...answers[2], value: null, distance: null, optionText: 'Blau', correct: true },
        { ...answers[1], value: null, distance: null, optionText: 'Blau', correct: true },
      ],
    }),
    event(16, 'MATCH_ABANDONED', { reason: 'INTERNAL_ERROR' }),
  ];

  it('gehört zur Frage mit ihren Folgen bis zur nächsten Frage', () => {
    const land = revealFor(events, 1);
    expect(land?.opened?.payload.purpose).toBe('LAND');
    expect(land?.outcome.map((e) => e.type)).toEqual(['LAND_RANKED']);
    const duel = revealFor(events, 2);
    expect(duel?.opened?.payload.purpose).toBe('DUEL_TRIVIA');
    expect(duel?.outcome).toEqual([]);
    expect(revealFor(events, 3)).toBeNull();
    expect(lastOf(events, 'MATCH_ABANDONED')?.payload.reason).toBe('INTERNAL_ERROR');
    expect(lastOf(events, 'MATCH_FINISHED')).toBeNull();
  });

  it('beschreibt die Rangfolge der Landnahme', () => {
    const view = viewOf();
    const name = seatNames(view);
    const region = regionNames(mapOfView(view));
    const land = revealFor(events, 1);
    const ranked = land?.outcome[0];
    if (!ranked) throw new Error('Rangfolge fehlt');
    expect(outcomeTexts(ranked, name, region)).toEqual([
      '1. Anna (du): wählt 2 Regionen',
      '2. Bot (schwer): wählt 1 Region',
      '3. Bot (leicht): wählt keine Region',
    ]);
  });
});

describe('Texte der Partie', () => {
  const view = viewOf();
  const name = seatNames(view);
  const region = regionNames(mapOfView(view));

  it('nennt Sitze, Regionen und Abschnitte', () => {
    expect(name(1)).toBe('Anna (du)');
    expect(name(2)).toBe('Bot (schwer)');
    expect(region(0)).toBe('Eschenhain');
    expect(stepLabel(view)).toBe('Hauptstadtwahl');
    expect(stepLabel(viewOf({}, { kind: 'LAND_PICK', round: 3, chooser: 1 }))).toBe(
      'Landnahme · Runde 3',
    );
    expect(
      stepLabel(viewOf({}, { kind: 'CAMPAIGN_TARGET', round: 2, chooser: 1, attacker: 1 })),
    ).toBe('Feldzug · Runde 2 von 4');
  });

  it('fordert zur Wahl auf oder nennt, wer wählt', () => {
    expect(pickText(view, name)).toMatch(/^Du bist dran: Wähle deine Hauptstadt/);
    expect(pickText(viewOf({ legalRegions: [] }, { chooser: 2 }), name)).toBe(
      'Bot (schwer) wählt eine Hauptstadt.',
    );
    const duel = viewOf(
      { legalRegions: [] },
      {
        kind: 'DUEL_TRIVIA',
        round: 1,
        chooser: null,
        attacker: 2,
        defender: 1,
        region: 9,
      },
    );
    expect(pickText(duel, name)).toBeNull();
    expect(questionContext(duel, name, region)).toBe(
      'Duell um Goldwiese: Bot (schwer) greift Anna (du) an.',
    );
  });

  it('schreibt den Verlauf', () => {
    const hit = event(20, 'DUEL_RESOLVED', {
      round: 1,
      duel: 1,
      attacker: 2,
      defender: 1,
      region: 9,
      winner: 'ATTACKER',
      reason: 'TRIVIA',
      effect: 'CAPITAL_HIT',
      capitalLivesLeft: 2,
      regionValue: 300,
    });
    expect(logText(hit, name, region)).toBe(
      'Bot (schwer) trifft die Hauptstadt von Anna (du), ihr bleiben noch 2 Leben.',
    );
    if (hit.type !== 'DUEL_RESOLVED') throw new Error('falscher Typ');
    expect(outcomeTexts(hit, name, region)[0]).toBe('Nur einer lag bei der Wissensfrage richtig.');
    expect(logText(event(21, 'AUTO_PICKED', { seat: 0, region: 0 }), name, region)).toBe(
      'Zeit abgelaufen: Der Server wählt Eschenhain für Bot (leicht).',
    );
    expect(logText(event(22, 'PLAYER_JOINED', { joinOrder: 1 }), name, region)).toBeNull();
  });
});
