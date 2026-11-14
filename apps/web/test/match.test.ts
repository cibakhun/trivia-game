import { KERNMARK, WENDELMARK } from '@rdw/game-core';
import type { MatchPresentedQuestion, MatchView } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  ANSWERS_BEAT_MS,
  OUTCOME_BEAT_MS,
  answersBeatMs,
  answersFeed,
  countedAnswer,
  decidedSeq,
  duelFocus,
  duelResolved,
  duelStage,
  lastOf,
  needsPresent,
  needsWatch,
  outcomeBeatMs,
  pollDelay,
  revealFor,
  revealPlan,
  screenStateOf,
  shownPick,
  watchedFor,
  type LocalQuestion,
  type WatchedQuestion,
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
import { AT, ID, event, realmViewOf, viewOf, type Step } from './match-fixtures.ts';

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
    answered: [],
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

  it('Zuschauer: Die Frage anderer wird zum Mitlesen geholt, einmal je Frage (ADR-065)', () => {
    const phase = { kind: 'QUESTION' as const, deadline: AT, remainingMs: 12000 };
    const at = (question: MatchView['question'], kind: 'QUESTION' | 'REVEAL' = 'QUESTION') =>
      viewOf({ phase: { ...phase, kind }, legalRegions: [], question });
    const watching = at(questionInfo('NOT_PARTICIPATING'));
    const got: WatchedQuestion = { seq: 4, question: presented, deadline: 9000 };
    expect(needsWatch(watching, null)).toBe(true);
    expect(needsWatch(watching, got)).toBe(false);
    // Auch ein gescheitertes Mitlesen wird nicht wiederholt, eine alte Frage zählt aber nicht
    expect(needsWatch(watching, { seq: 4, question: null, deadline: 0 })).toBe(false);
    expect(needsWatch(watching, { ...got, seq: 3 })).toBe(true);
    // Wer gefragt ist, holt die Frage mit `present`: Sonst läse er sie, ehe seine Zeit läuft
    for (const status of ['NOT_PRESENTED', 'PRESENTED', 'ANSWERED', 'MISSED'] as const) {
      expect(needsWatch(at(questionInfo(status)), null), status).toBe(false);
    }
    // Aufgelöst oder schon in der Auflösung: Frage und Antworten stehen dann im Ereignis
    const resolved = { ...questionInfo('NOT_PARTICIPATING'), resolved: true };
    expect(needsWatch(at(resolved as MatchView['question']), null)).toBe(false);
    expect(needsWatch(at(questionInfo('NOT_PARTICIPATING'), 'REVEAL'), null)).toBe(false);
    expect(needsWatch(at(null), null)).toBe(false);

    // Gezeigt wird sie nur, solange dieser Sitz genau dieser Frage zuschaut
    expect(watchedFor('spectating', 4, got)).toEqual({
      seq: 4,
      question: presented,
      deadline: 9000,
    });
    expect(watchedFor('spectating', 5, got)).toBeNull();
    expect(watchedFor('reveal', 4, got)).toBeNull();
    expect(watchedFor('answered', 4, got)).toBeNull();
    expect(watchedFor('spectating', 4, { seq: 4, question: null, deadline: 0 })).toBeNull();
    expect(watchedFor('spectating', 4, null)).toBeNull();
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
    expect(duelFocus(duel, null)).toEqual({ attacker: 2, defender: 1, region: 9 });
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
    expect(duelFocus(next, revealFor(events, 5))).toEqual({ attacker: 2, defender: 1, region: 9 });
    // Ohne Ausgang (beide richtig, das Stechen folgt) zeigt der Schritt weiter auf das Duell
    expect(duelFocus(viewOf(), revealFor(events.slice(0, 2), 5))).toBeNull();
    expect(duelResolved(revealFor(events, 5))?.payload.effect).toBe('CONQUERED');
    expect(duelResolved(revealFor(events.slice(0, 2), 5))).toBeNull();
    expect(duelResolved(null)).toBeNull();

    // Bühne auf der Karte: Aufmarsch in der Ansage, stehendes Bild, solange gefragt wird
    const fight = {
      attacker: 2,
      defender: 1,
      region: 9,
      winner: null,
      repelled: false,
      effect: null,
    };
    expect(duelStage(duel, 'announce', null, false)).toEqual({ ...fight, scene: 'announce' });
    for (const state of ['presenting', 'question', 'answered', 'missed', 'spectating'] as const) {
      expect(duelStage(duel, state, null, false)).toEqual({ ...fight, scene: 'duel' });
    }
    // Beide richtig: Die Auflösung entscheidet nichts, das Duell steht weiter
    expect(duelStage(duel, 'reveal', revealFor(events.slice(0, 2), 5), false)).toEqual({
      ...fight,
      scene: 'duel',
    });
    // Entschieden: erst der Ausgang auf der Karte, danach nur noch der Rand des Siegers
    const won = {
      attacker: 2,
      defender: 1,
      region: 9,
      winner: 2,
      repelled: false,
      effect: 'CONQUERED',
    };
    expect(duelStage(next, 'reveal', revealFor(events, 5), true)).toEqual({
      ...won,
      scene: 'outcome',
    });
    expect(duelStage(next, 'reveal', revealFor(events, 5), false)).toEqual({
      ...won,
      scene: 'settled',
    });
    const held = [
      ...events.slice(0, 2),
      event(22, 'DUEL_RESOLVED', {
        round: 1,
        duel: 1,
        attacker: 2,
        defender: 1,
        region: 9,
        winner: 'DEFENDER',
        reason: 'BOTH_WRONG',
        effect: 'FORTIFIED',
        capitalLivesLeft: null,
        regionValue: 150,
      }),
    ];
    expect(duelStage(next, 'reveal', revealFor(held, 5), true)).toMatchObject({
      winner: 1,
      repelled: true,
      effect: 'FORTIFIED',
      scene: 'outcome',
    });
    expect(duelStage(viewOf(), 'pick', null, false)).toBeNull();

    // Letztes Duell der Partie (ADR-055): Der Schritt ist schon „beendet“, die Auflösung steht
    // noch. Die Karte zeigt den Ausgang wie bei jedem anderen Duell.
    const closing = viewOf(
      {
        phase: { kind: 'REVEAL', deadline: AT, remainingMs: 2000 },
        legalRegions: [],
        question: { ...questionInfo('ANSWERED', 5), resolved: true } as MatchView['question'],
      },
      { kind: 'FINISHED', round: 4, chooser: null, finishReason: 'ROUNDS_COMPLETE' },
    );
    expect(screenStateOf(closing, null)).toBe('reveal');
    expect(pollDelay(closing)).toBe(750);
    expect(duelStage(closing, 'reveal', revealFor(events, 5), true)).toEqual({
      ...won,
      scene: 'outcome',
    });
    expect(duelStage(closing, 'reveal', revealFor(events, 5), false)).toEqual({
      ...won,
      scene: 'settled',
    });
  });

  it('Takt des Ausgangs: ein Viertel der Zeit, höchstens anderthalb Sekunden', () => {
    expect(outcomeBeatMs(6000)).toBe(OUTCOME_BEAT_MS);
    expect(outcomeBeatMs(8000)).toBe(1500);
    expect(outcomeBeatMs(2000)).toBe(500);
    expect(outcomeBeatMs(0)).toBe(0);
  });

  it('Takt der Antworten: die Hälfte der übrigen Zeit, höchstens vier Sekunden', () => {
    expect(answersBeatMs(6000)).toBe(3000);
    expect(answersBeatMs(5300)).toBe(2650);
    expect(answersBeatMs(12_000)).toBe(ANSWERS_BEAT_MS);
    expect(answersBeatMs(Number.POSITIVE_INFINITY)).toBe(4000);
    expect(answersBeatMs(2000)).toBe(1000);
    // Die Seite kam zu spät in die Auflösung: Für das Blatt allein bleibt keine Zeit mehr
    expect(answersBeatMs(700)).toBe(0);
    expect(answersBeatMs(-50)).toBe(0);
  });

  it('Zeitplan einer Auflösung mit Duell: Antworten, Ausgang, Ergebnis (ADR-069)', () => {
    // Normale Zeiten (6 s): 3 s Antworten, 1,5 s Ausgang auf der Karte, 1,5 s Ergebnis
    expect(revealPlan(1000, 7000, 6000)).toEqual({ outcomeAt: 4000, settledAt: 5500 });
    // Spieltestzeiten (2 s), die Seite erfuhr 0,4 s später davon
    expect(revealPlan(1000, 2600, 2000)).toEqual({ outcomeAt: 1800, settledAt: 2300 });
    // Ohne bekannte Frist gilt die längste Dauer
    expect(revealPlan(0, null, 6000)).toEqual({ outcomeAt: 4000, settledAt: 5500 });
    // Kaum noch Zeit: Die Karte steht gleich im Ergebnis
    expect(revealPlan(1000, 1500, 6000)).toBeNull();
    // Die Seite erfuhr erst 4 s später davon: Der Ausgang rückt zusammen, das Ergebnis steht
    // noch vor dem Ende der Auflösung
    expect(revealPlan(1000, 3000, 6000)).toEqual({ outcomeAt: 2000, settledAt: 2667 });
    for (const left of [800, 1200, 2000, 3000, 4400, 5900, 6000]) {
      const plan = revealPlan(0, left, 6000);
      expect(plan && plan.outcomeAt < plan.settledAt && plan.settledAt < left).toBe(true);
    }
  });

  it('Auflösung mit Duell: Im ersten Takt sieht die Bühne nur die Antworten (ADR-069)', () => {
    const asked = { ...questionInfo('ANSWERED', 5), purpose: 'DUEL_TRIVIA', seats: [2, 1] };
    const asking = viewOf(
      {
        phase: { kind: 'QUESTION', deadline: AT, remainingMs: 4000 },
        legalRegions: [],
        question: asked as MatchView['question'],
      },
      { kind: 'DUEL_TRIVIA', round: 1, chooser: null, attacker: 2, defender: 1, region: 9 },
    );
    // Der Server meldet mit der Auflösung schon den Stand danach: Das Feld gehört dem Angreifer,
    // und der Schritt steht beim nächsten Angreifer
    const after = viewOf(
      {
        phase: { kind: 'REVEAL', deadline: AT, remainingMs: 2000 },
        legalRegions: [3],
        question: { ...asked, resolved: true } as MatchView['question'],
      },
      { kind: 'CAMPAIGN_TARGET', round: 1, chooser: 0, attacker: 0 },
    );
    if (!after.board) throw new Error('Ansicht ohne Karte');
    const revealing: MatchView = {
      ...after,
      board: {
        ...after.board,
        regions: after.board.regions.map((r, id) => (id === 9 ? { ...r, owner: 2 } : r)),
      },
    };
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
      event(23, 'KINGDOM_ELIMINATED', { round: 1, seat: 1, by: 2, regions: 1 }),
    ];

    // Nur eine laufende Auflösung, die ein Duell entschieden hat, bekommt die drei Takte
    expect(decidedSeq(revealing, events)).toBe(5);
    expect(decidedSeq(revealing, events.slice(0, 2))).toBeNull();
    expect(decidedSeq(asking, events)).toBeNull();
    expect(decidedSeq(null, events)).toBeNull();
    expect(
      decidedSeq({ ...revealing, match: { ...revealing.match, status: 'FINISHED' } }, events),
    ).toBeNull();

    const feed = answersFeed(revealing, events, asking);
    // Phase und Frage sind die der Auflösung, Karte und Schritt die von vorher
    expect(feed.view.phase).toEqual(revealing.phase);
    expect(feed.view.question?.resolved).toBe(true);
    expect(feed.view.board).toBe(asking.board);
    expect(feed.view.board?.regions[9]?.owner).toBeNull();
    expect(feed.view.legalRegions).toEqual([]);
    // Die Ereignisse enden mit der Auflösung der Frage: kein Ausgang, kein gefallenes Reich
    expect(feed.events).toEqual(events.slice(0, 2));
    expect(screenStateOf(feed.view, null)).toBe('reveal');
    const reveal = revealFor(feed.events, 5);
    expect(reveal?.outcome).toEqual([]);
    expect(decidedSeq(feed.view, feed.events)).toBeNull();
    // Das Duell steht auf der Karte wie während der Frage
    expect(duelStage(feed.view, 'reveal', reveal, false)).toEqual({
      attacker: 2,
      defender: 1,
      region: 9,
      winner: null,
      repelled: false,
      effect: null,
      scene: 'duel',
    });
    // Danach der ganze Stand: Die Karte spielt den Ausgang
    expect(duelStage(revealing, 'reveal', revealFor(events, 5), true)).toMatchObject({
      winner: 2,
      effect: 'CONQUERED',
      scene: 'outcome',
    });

    // Mit Ausbau stehen Karte und Vorräte in `realm`: auch sie bleiben beim Stand von vorher
    const realmBefore = realmViewOf({}, { phase: asking.phase, question: asking.question });
    const realmAfter = realmViewOf(
      { stock: { 2: { bread: 9, material: 12 } } },
      { phase: revealing.phase, question: revealing.question },
    );
    const realmFeed = answersFeed(realmAfter, events, realmBefore);
    expect(realmFeed.view.realm).toBe(realmBefore.realm);
    expect(realmFeed.view.board).toBeNull();
    expect(realmFeed.view.phase?.kind).toBe('REVEAL');
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

  it('zeigt nach einer verlorenen Bestätigung die Antwort, die zählt', () => {
    const first = { optionToken: 'a' };
    const second = { optionToken: 'b' };
    // Die erste Antwort kam an, ihre Bestätigung nicht; der Server lehnt die zweite ab
    expect(countedAnswer([first], second)).toEqual(first);
    expect(countedAnswer([first, first], second)).toEqual(first);
    expect(countedAnswer([{ rawInput: '12' }], { rawInput: '15' })).toEqual({ rawInput: '12' });
    // Unklar, welche zählt: lieber keine zeigen als die falsche
    expect(countedAnswer([first, { optionToken: 'c' }], second)).toBeUndefined();
    expect(countedAnswer([], second)).toBeUndefined();
    expect(countedAnswer([second], second)).toBeUndefined();
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
    // Solange die letzte Auflösung steht, bleibt die Runde im Band; danach die Abrechnung
    const ended = { kind: 'FINISHED', round: 4, chooser: null, finishReason: 'ROUNDS_COMPLETE' };
    expect(stepLabel(viewOf({}, ended as Partial<Step>))).toBe('Feldzug · Runde 4 von 4');
    const finished = viewOf(
      { match: { ...view.match, status: 'FINISHED' } },
      ended as Partial<Step>,
    );
    expect(stepLabel(finished)).toBe('Abrechnung');
    // Partien von vor ADR-055 kennen die letzte Runde nicht
    expect(stepLabel(viewOf({}, { ...ended, round: null } as Partial<Step>))).toBe('Abrechnung');
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
