import type { MatchView, ParsedMatchEvent } from '@rdw/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnnouncePanel } from '../src/match/AnnouncePanel.tsx';
import { revealFor } from '../src/match/match-model.ts';
import { mapOfView, regionNames, seatNames } from '../src/match/match-text.ts';
import { OutcomePanel } from '../src/match/OutcomePanel.tsx';
import { RevealPanel } from '../src/match/RevealPanel.tsx';
import { AT, event, viewOf } from './match-fixtures.ts';

/**
 * Ansage und Auflösung der Partie als fertiges HTML (ADR-053): wer wen wo angreift und wer was
 * geantwortet hat. Geprüft wird, was ein Mitspieler liest und an welcher Antwort sein Wappen steht.
 */

const view = viewOf();
const name = seatNames(view);
const region = regionNames(mapOfView(view));

/** Sichtbarer Text ohne Auszeichnung. */
function textOf(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sitze, deren Plättchen in einem Stück HTML stehen, in Lesereihenfolge. */
function chipsIn(html: string): number[] {
  return [...html.matchAll(/class="seat-chip seat-(\d)"/g)].map((m) => Number(m[1]));
}

/** Sitze, deren Farbe ein Antwortfeld ausmalt, von links nach rechts (ADR-065). */
function fillOf(row: string): number[] {
  const fill =
    /<span class="reveal-fill" aria-hidden="true">([\s\S]*?)<\/span>/.exec(row)?.[1] ?? '';
  return [...fill.matchAll(/<i class="seat-(\d)"><\/i>/g)].map((m) => Number(m[1]));
}

/** Zeilen der Antworten (Optionen oder Rangfolge), jede als eigenes Stück HTML. */
function rowsOf(html: string): string[] {
  return html.match(/<li [\s\S]*?<\/li>/g) ?? [];
}

function answer(seat: number, partial: Record<string, unknown>) {
  return {
    seat,
    answered: true,
    correct: false,
    optionText: null,
    value: null,
    distance: null,
    effectiveMs: 3000,
    ...partial,
  };
}

function opened(seq: number, questionSeq: number, purpose: string, seats: number[]) {
  return event(seq, 'QUESTION_OPENED', {
    seq: questionSeq,
    kind: purpose === 'DUEL_TRIVIA' ? 'TRIVIA' : 'ESTIMATE',
    purpose,
    seats,
    timeLimitMs: 8000,
    closesAt: AT,
  });
}

function trivia(seq: number, questionSeq: number, answers: unknown[]): ParsedMatchEvent {
  return event(seq, 'QUESTION_RESOLVED', {
    seq: questionSeq,
    kind: 'TRIVIA',
    prompt: 'Welche Farbe hat der Himmel?',
    options: [
      { token: 'a', text: 'Grün' },
      { token: 'b', text: 'Blau' },
      { token: 'c', text: 'Rot' },
      { token: 'd', text: 'Gelb' },
    ],
    solution: { optionToken: 'b', text: 'Blau' },
    explanation: 'Das Licht wird gestreut.',
    answers,
  });
}

function estimate(seq: number, questionSeq: number, answers: unknown[]): ParsedMatchEvent {
  return event(seq, 'QUESTION_RESOLVED', {
    seq: questionSeq,
    kind: 'ESTIMATE',
    prompt: 'Wie hoch ist der Turm?',
    options: [],
    solution: { value: '125', unit: 'm' },
    explanation: null,
    answers,
  });
}

function duelResolved(seq: number, partial: Record<string, unknown>): ParsedMatchEvent {
  return event(seq, 'DUEL_RESOLVED', {
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
    ...partial,
  });
}

function reveal(events: ParsedMatchEvent[], seq: number): string {
  const found = revealFor(events, seq);
  if (!found) throw new Error('Auflösung fehlt');
  return renderToStaticMarkup(createElement(RevealPanel, { reveal: found, name, region }));
}

describe('Auflösung: wer was geantwortet hat', () => {
  it('Wissensfrage im Duell: Wappen an der gewählten Antwort, oben die Folge mit dem Sieger', () => {
    const html = reveal(
      [
        opened(20, 5, 'DUEL_TRIVIA', [2, 1]),
        trivia(21, 5, [
          answer(2, { optionText: 'Blau', correct: true }),
          answer(1, { optionText: 'Gelb' }),
        ]),
        duelResolved(22, {}),
      ],
      5,
    );
    const rows = rowsOf(html);
    expect(rows.map((row) => chipsIn(row))).toEqual([[], [2], [], [1]]);
    expect(rows.map((row) => /class="reveal-option([^"]*)"/.exec(row)?.[1]?.trim())).toEqual([
      '',
      'correct chosen',
      '',
      'wrong chosen',
    ]);
    expect(textOf(rows[1] ?? '')).toBe('✓ Blau (richtig) Bot (schwer)');
    expect(textOf(rows[3] ?? '')).toMatch(/^✗ Gelb Anna \(du\)/);
    // Jedes gewählte Feld trägt die Farbe dessen, der es wählte (ADR-065); die übrigen behalten
    // den Buchstaben aus der Frage und bleiben leer
    expect(rows.map(fillOf)).toEqual([[], [2], [], [1]]);
    expect(rows.map((row) => /data-chosen-by="([^"]*)"/.exec(row)?.[1])).toEqual([
      '',
      '2',
      '',
      '1',
    ]);
    expect(textOf(rows[0] ?? '')).toBe('A Grün');
    expect(textOf(rows[2] ?? '')).toBe('C Rot');
    // Oben steht groß die Wirkung, klein der Grund; das Wappen gehört dem Sieger
    expect(html).toContain('class="reveal-verdict seat-2"');
    const verdict = textOf(html.split('<p class="reveal-prompt"')[0] ?? '');
    expect(verdict).toBe(
      'Auflösung Bot (schwer) erobert Goldwiese von Anna (du). Nur einer lag bei der Wissensfrage richtig.',
    );
    expect(html).not.toContain('reveal-silent');
    expect(textOf(html)).toContain('Erklärung: Das Licht wird gestreut.');
  });

  it('gleiche Antwort: beide Wappen an einer Zeile; wer schwieg, steht darunter', () => {
    const both = reveal(
      [
        opened(20, 5, 'DUEL_TRIVIA', [2, 1]),
        trivia(21, 5, [
          answer(2, { optionText: 'Blau', correct: true }),
          answer(1, { optionText: 'Blau', correct: true }),
        ]),
      ],
      5,
    );
    expect(rowsOf(both).map((row) => chipsIn(row))).toEqual([[], [2, 1], [], []]);
    // Beide teilen sich das Feld zu gleichen Teilen, der Angreifer links wie im Kopf des Duells
    expect(rowsOf(both).map(fillOf)).toEqual([[], [2, 1], [], []]);
    expect(rowsOf(both)[1]).toContain('data-chosen-by="2 1"');
    // Noch kein Ausgang: Das Stechen folgt
    expect(textOf(both)).toContain('Beide lagen richtig: Eine Schätzfrage entscheidet das Duell.');
    expect(both).toContain('class="reveal-verdict"');

    const silent = reveal(
      [
        opened(20, 5, 'DUEL_TRIVIA', [2, 1]),
        trivia(21, 5, [
          answer(2, { optionText: 'Rot' }),
          answer(1, { answered: false, effectiveMs: null }),
        ]),
        duelResolved(22, { winner: 'DEFENDER', reason: 'BOTH_WRONG', effect: 'FORTIFIED' }),
      ],
      5,
    );
    expect(rowsOf(silent).map((row) => chipsIn(row))).toEqual([[], [], [2], []]);
    // Die richtige Antwort wählte niemand: Sie bleibt ohne Farbe, ist aber als richtig markiert
    expect(rowsOf(silent).map(fillOf)).toEqual([[], [], [2], []]);
    expect(rowsOf(silent)[1]).toContain('class="reveal-option correct"');
    expect(textOf(rowsOf(silent)[1] ?? '')).toBe('✓ Blau (richtig)');
    const tail = silent.split('<p class="reveal-silent">')[1] ?? '';
    expect(textOf(tail)).toMatch(/^Keine Antwort: Anna \(du\)/);
    expect(chipsIn(tail)).toEqual([1]);
    // Der Verteidiger gewinnt: sein Wappen steht oben
    expect(silent).toContain('class="reveal-verdict seat-1"');
  });

  it('Landnahme: Rangfolge von oben nach unten, daneben Schätzung, Abstand und Auswahl', () => {
    const html = reveal(
      [
        opened(10, 1, 'LAND', [0, 1, 2]),
        estimate(11, 1, [
          answer(0, { answered: false, effectiveMs: null }),
          answer(1, { value: '120', distance: '5', effectiveMs: 4200 }),
          answer(2, { value: '125', distance: '0', effectiveMs: 6100 }),
        ]),
        event(12, 'LAND_RANKED', {
          round: 3,
          ranking: [
            { seat: 2, place: 1, picks: 2, distance: '0', effectiveMs: 6100 },
            { seat: 1, place: 2, picks: 1, distance: '5', effectiveMs: 4200 },
            { seat: 0, place: 3, picks: 0, distance: null, effectiveMs: null },
          ],
        }),
      ],
      1,
    );
    const rows = rowsOf(html);
    expect(rows.map((row) => chipsIn(row))).toEqual([[2], [1], [0]]);
    expect(rows.map((row) => textOf(row))).toEqual([
      '1 Bot (schwer) 125 m genau · 6,1 s wählt 2 Regionen',
      '2 Anna (du) 120 m 5 daneben · 4,2 s wählt 1 Region',
      '3 Bot (leicht) keine Antwort wählt keine Region',
    ]);
    expect(rows[0]).toContain('reveal-rank best');
    expect(rows[2]).toContain('reveal-rank silent');
    expect(textOf(html)).toContain('Richtige Antwort: 125 m');
    expect(textOf(html)).toContain('Landnahme, Runde 3: Die genaueste Schätzung wählt zuerst.');
  });

  it('Stechen im Duell: der kleinere Abstand zuerst, bei Gleichstand die schnellere Antwort', () => {
    const html = reveal(
      [
        opened(30, 7, 'DUEL_ESTIMATE', [2, 1]),
        estimate(31, 7, [
          answer(2, { value: '130', distance: '5', effectiveMs: 5000 }),
          answer(1, { value: '120', distance: '5', effectiveMs: 2500 }),
        ]),
        duelResolved(32, {
          winner: 'DEFENDER',
          reason: 'SPEED',
          effect: 'FORTIFIED',
          regionValue: 150,
        }),
      ],
      7,
    );
    const rows = rowsOf(html);
    expect(rows.map((row) => chipsIn(row))).toEqual([[1], [2]]);
    expect(rows[0]).not.toContain('reveal-picks');
    expect(html).toContain('class="reveal-verdict seat-1"');
  });
});

describe('Ansage: wer wen wo angreift', () => {
  const phase = { kind: 'ANNOUNCE' as const, deadline: AT, remainingMs: 2500 };

  function announce(
    shown: MatchView,
    events: ParsedMatchEvent[] = [],
    fallback: string | null = null,
  ) {
    return renderToStaticMarkup(
      createElement(AnnouncePanel, {
        view: shown,
        events,
        name,
        region,
        fallback,
        timer: createElement('i', { className: 'zeit' }),
      }),
    );
  }

  function duel(attacker: number, defender: number, capital = false): MatchView {
    const base = viewOf(
      { phase, legalRegions: [] },
      { kind: 'DUEL_TRIVIA', round: 1, chooser: null, attacker, defender, region: 9 },
    );
    const board = base.board;
    if (!board) throw new Error('Brett fehlt');
    return {
      ...base,
      board: {
        ...board,
        regions: board.regions.map((r, i) =>
          i === 9 ? { ...r, owner: defender, capitalOf: capital ? defender : null } : r,
        ),
      },
    };
  }

  it('aus der eigenen Sicht: angegriffen, eigener Angriff oder Zuschauer', () => {
    const attacked = announce(duel(2, 1));
    expect(attacked).toContain('announce-attacked');
    expect(textOf(attacked)).toBe(
      'Du wirst in Goldwiese angegriffen! Duell um Goldwiese: Bot (schwer) greift Anna (du) an. Bot (schwer) greift Anna (du) an',
    );
    // Angreifer links, Verteidiger rechts
    expect(chipsIn(attacked)).toEqual([2, 1]);
    expect(attacked).toContain('class="zeit"');

    const attacking = announce(duel(1, 0));
    expect(attacking).toContain('announce-attacking');
    expect(textOf(attacking)).toMatch(/^Dein Angriff auf Goldwiese /);
    expect(chipsIn(attacking)).toEqual([1, 0]);

    const other = announce(duel(0, 2));
    expect(other).toContain('announce-other');
    expect(textOf(other)).toMatch(/^Angriff auf Goldwiese /);
    expect(chipsIn(other)).toEqual([0, 2]);
  });

  it('nennt die Hauptstadt, wenn sie das Ziel ist', () => {
    expect(textOf(announce(duel(2, 1, true)))).toMatch(
      /^Deine Hauptstadt Goldwiese wird angegriffen! /,
    );
    expect(textOf(announce(duel(1, 0, true)))).toMatch(
      /^Dein Angriff auf die Hauptstadt Goldwiese /,
    );
    expect(textOf(announce(duel(0, 2, true)))).toMatch(/^Angriff auf die Hauptstadt Goldwiese /);
  });

  it('zeigt sonst die letzte Wahl mit dem Wappen dessen, der gewählt hat', () => {
    const waiting = viewOf(
      { phase, legalRegions: [] },
      { kind: 'LAND_PICK', round: 2, chooser: 0 },
    );
    const claimed = event(13, 'REGION_CLAIMED', { round: 2, seat: 2, region: 3 });
    const html = announce(waiting, [event(4, 'CAPITAL_CHOSEN', { seat: 0, region: 7 }), claimed]);
    expect(textOf(html)).toBe('Bot (schwer) nimmt Hirschgrund.');
    expect(html).toContain('announce-line');
    expect(html).not.toContain('class="zeit"');
    expect(textOf(announce(waiting, [event(4, 'CAPITAL_CHOSEN', { seat: 1, region: 0 })]))).toBe(
      'Anna (du) wählt Eschenhain als Hauptstadt.',
    );
    // Nach einem Neuladen ohne Wahl als letztes Ereignis: der mitgegebene Satz, sonst ein Platzhalter
    expect(textOf(announce(waiting, [], 'Die Landnahme läuft.'))).toBe('Die Landnahme läuft.');
    expect(textOf(announce(waiting))).toBe('Gleich geht es weiter.');
  });
});

describe('Ausgang eines Duells in der Leiste (ADR-054)', () => {
  function outcome(partial: Record<string, unknown>, mySeat: number | null = 1): string {
    const resolved = duelResolved(40, partial);
    if (resolved.type !== 'DUEL_RESOLVED') throw new Error('Ereignis ungültig');
    return renderToStaticMarkup(
      createElement(OutcomePanel, { duel: resolved, mySeat, name, region }),
    );
  }

  it('aus der eigenen Sicht, in der Farbe des Siegers', () => {
    const lost = outcome({});
    expect(lost).toContain('outcome-lost seat-2');
    expect(lost).toContain('data-effect="CONQUERED"');
    expect(textOf(lost)).toBe(
      'Du verlierst Goldwiese. Bot (schwer) erobert Goldwiese von Anna (du). Nur einer lag bei der Wissensfrage richtig.',
    );

    const held = outcome({ winner: 'DEFENDER', effect: 'FORTIFIED', regionValue: 150 });
    expect(held).toContain('outcome-won seat-1');
    expect(textOf(held)).toMatch(/^Du hältst Goldwiese! /);

    const conquered = outcome({ attacker: 1, defender: 0 });
    expect(conquered).toContain('outcome-won seat-1');
    expect(textOf(conquered)).toMatch(/^Du eroberst Goldwiese! /);

    const repelled = outcome({ attacker: 1, defender: 0, winner: 'DEFENDER', effect: 'FORTIFIED' });
    expect(repelled).toContain('outcome-lost seat-0');
    expect(textOf(repelled)).toMatch(/^Dein Angriff auf Goldwiese scheitert\. /);
  });

  it('Zuschauer lesen, wer die Region hat', () => {
    const taken = outcome({ attacker: 0, defender: 2 });
    expect(taken).toContain('outcome-other seat-0');
    expect(textOf(taken)).toMatch(/^Bot \(leicht\) erobert Goldwiese\. /);
    const kept = outcome({ attacker: 0, defender: 2, winner: 'DEFENDER', effect: 'FORTIFIED' });
    expect(kept).toContain('outcome-other seat-2');
    expect(textOf(kept)).toMatch(/^Bot \(schwer\) hält Goldwiese\. /);
    // Ohne eigenen Sitz (Zuschauer) gilt dieselbe Sicht
    expect(textOf(outcome({}, null))).toMatch(/^Bot \(schwer\) erobert Goldwiese\. /);
  });

  it('Hauptstadt: Treffer und Fall', () => {
    const hit = outcome({ effect: 'CAPITAL_HIT', capitalLivesLeft: 2 });
    expect(hit).toContain('outcome-lost seat-2');
    expect(textOf(hit)).toMatch(/^Deine Hauptstadt Goldwiese wird getroffen! /);
    expect(textOf(outcome({ effect: 'TAKEOVER', capitalLivesLeft: 0 }))).toMatch(
      /^Deine Hauptstadt Goldwiese fällt\. /,
    );
    expect(
      textOf(outcome({ attacker: 1, defender: 2, effect: 'CAPITAL_HIT', capitalLivesLeft: 1 })),
    ).toMatch(/^Du triffst die Hauptstadt Goldwiese! /);
    expect(
      textOf(outcome({ attacker: 1, defender: 2, effect: 'TAKEOVER', capitalLivesLeft: 0 })),
    ).toMatch(/^Du nimmst die Hauptstadt Goldwiese ein! /);
  });

  it('der Satz in der Leiste ist Schmuck, Screenreader bekommen den ganzen Satz', () => {
    const html = outcome({});
    expect(html).toMatch(/<p class="outcome-title" aria-hidden="true">/);
    expect(html).toContain(
      '<p class="visually-hidden">Bot (schwer) erobert Goldwiese von Anna (du).</p>',
    );
    expect(html).toContain('aria-live="polite"');
  });
});
