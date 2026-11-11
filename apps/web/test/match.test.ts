import { KERNMARK, WENDELMARK } from '@rdw/game-core';
import type { MatchPresentedQuestion, MatchView } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  duelFocus,
  lastOf,
  needsPresent,
  pollDelay,
  revealFor,
  screenStateOf,
  shownPick,
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
import { AT, ID, event, viewOf } from './match-fixtures.ts';

/** Partie im Browser (M4): Kartengeometrie, Zustand des Bildschirms, Auflösung und Texte. */

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

  it('Ansage: nichts zu tun, gezeigt wird die letzte Wahl', () => {
    const phase = { kind: 'ANNOUNCE' as const, deadline: AT, remainingMs: 1200 };
    const shown = viewOf({ phase, legalRegions: [] });
    expect(screenStateOf(shown, null)).toBe('announce');
    expect(needsPresent(shown, null)).toBe(false);
    expect(pollDelay(shown)).toBe(750);
    // Eine alte Frage bleibt in der Ansicht stehen und ändert daran nichts
    const after = viewOf({
      phase,
      legalRegions: [],
      question: { ...questionInfo('ANSWERED'), resolved: true } as MatchView['question'],
    });
    expect(screenStateOf(after, local('ANSWERED'))).toBe('announce');

    const capital = event(4, 'CAPITAL_CHOSEN', { seat: 0, region: 7 });
    const claimed = event(13, 'REGION_CLAIMED', { round: 1, seat: 2, region: 3 });
    const target = event(14, 'TARGET_CHOSEN', { round: 1, attacker: 2, defender: 1, region: 9 });
    expect(shownPick([capital, claimed])).toBe(claimed);
    expect(shownPick([claimed, capital])?.payload).toMatchObject({ seat: 0, region: 7 });
    // Ein Angriffsziel ist keine gezeigte Wahl: Dafür gibt es die Ansage des Duells
    expect(shownPick([claimed, target])).toBeNull();
    expect(shownPick([])).toBeNull();
  });

  it('Duell im Blick der Karte: aus dem Schritt, in der Auflösung aus dem Ausgang', () => {
    const duel = viewOf(
      { legalRegions: [] },
      { kind: 'DUEL_TRIVIA', round: 1, chooser: null, attacker: 2, defender: 1, region: 9 },
    );
    expect(duelFocus(duel, null)).toEqual({ attacker: 2, region: 9 });
    expect(duelFocus(viewOf(), null)).toBeNull();
    // Nach dem Duell steht der Schritt schon beim nächsten Angreifer ohne Ziel: Bis es weitergeht,
    // bleibt das eben entschiedene Duell auf der Karte
    const events = [
      event(20, 'QUESTION_OPENED', {
        seq: 5,
        kind: 'TRIVIA',
        purpose: 'DUEL_TRIVIA',
        seats: [2, 1],
        timeLimitMs: 8000,
        closesAt: AT,
      }),
      event(21, 'QUESTION_RESOLVED', {
        seq: 5,
        kind: 'TRIVIA',
        prompt: 'Welche Farbe hat der Himmel?',
        options: [{ token: 'a', text: 'Blau' }],
        solution: { optionToken: 'a', text: 'Blau' },
        explanation: null,
        answers: [],
      }),
      event(22, 'DUEL_RESOLVED', {
        round: 1,
        duel: 1,
        attacker: 2,
        defender: 1,
        region: 9,
        winner: 'ATTACKER',
        reason: 'TRIVIA',
        effect: 'CONQUERED',
        capitalLivesLeft: null,
        regionValue: 100,
      }),
    ];
    const next = viewOf(
      { legalRegions: [] },
      { kind: 'CAMPAIGN_TARGET', round: 1, chooser: 0, attacker: 0 },
    );
    expect(duelFocus(next, revealFor(events, 5))).toEqual({ attacker: 2, region: 9 });
    // Ohne Ausgang (beide richtig, das Stechen folgt) zeigt der Schritt weiter auf das Duell
    expect(duelFocus(viewOf(), revealFor(events.slice(0, 2), 5))).toBeNull();
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

  it('liest die Karte aus der Ansicht: zu zweit die Kernmark, Unbekanntes als Wendelmark', () => {
    expect(mapOfView(view)).toBe(WENDELMARK);
    const board = view.board;
    if (!board) throw new Error('Brett fehlt');
    const small = { ...board, map: 'KERNMARK', regions: board.regions.slice(0, 16) };
    expect(mapOfView({ ...view, board: small })).toBe(KERNMARK);
    expect(regionNames(mapOfView({ ...view, board: small }))(0)).toBe('Ackerbrunn');
    expect(mapOfView({ ...view, board: { ...board, map: 'ANDERSWO' } })).toBe(WENDELMARK);
  });

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
