import type { MatchPresentedQuestion, MatchView, ParsedMatchEvent } from '@rdw/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/match/Answers.tsx';
import { revealFor, type Reveal } from '../src/match/match-model.ts';
import { mapOfView, regionNames, seatNames, shortNames } from '../src/match/match-text.ts';
import { StageBlatt } from '../src/match/StageBlatt.tsx';
import { WatchedQuestionCard, watchedSeats } from '../src/match/StageQuestion.tsx';
import { AT, ID, event, viewOf } from './match-fixtures.ts';

/**
 * Zuschauen eindeutiger (ADR-078): Wer zuschaut, sieht auf der Fragekarte, wer gegen wen antwortet
 * und wer schon abgegeben hat, und in der Auflösung steht im Blatt neben jedem Namen, was er gab.
 * Geprüft wird das fertige HTML, so wie es ein Zuschauer liest.
 */

/** Sichtbarer Text ohne Auszeichnung und ohne das, was nur ein Vorleser hört. */
function shownOf(html: string): string {
  return html
    .replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text, wie ihn ein Vorleser zusammensetzt. */
function spokenOf(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** Zeilen der Liste „Antworten“, jede als eigenes Stück HTML. */
function rowsOf(html: string): string[] {
  const list = /data-testid="match-answers"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? '';
  return list.match(/<li [\s\S]*?<\/li>/g) ?? [];
}

function attr(html: string, name: string): string | null {
  return new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? null;
}

/**
 * Ein Duell um Region 5, die Frage hat Nummer 7: Sitz 2 greift mich (Sitz 1) an, oder mit
 * `defender = 0` greift er Sitz 0 an, und ich schaue zu.
 */
function duelView(
  partial: Partial<NonNullable<MatchView['question']>> = {},
  defender = 1,
): MatchView {
  return viewOf(
    {
      phase: { kind: 'REVEAL', deadline: AT, remainingMs: 4000 },
      legalRegions: [],
      question: {
        seq: 7,
        kind: 'TRIVIA',
        purpose: 'DUEL_TRIVIA',
        seats: [2, defender],
        answered: [2, defender],
        closesAt: AT,
        resolved: true,
        myStatus: defender === 1 ? 'ANSWERED' : 'NOT_PARTICIPATING',
        ...partial,
      },
    },
    { kind: 'DUEL_TRIVIA', round: 1, chooser: null, attacker: 2, defender, region: 5 },
  );
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

function trivia(answers: unknown[], seq = 7): ParsedMatchEvent {
  return event(21, 'QUESTION_RESOLVED', {
    seq,
    kind: 'TRIVIA',
    prompt: 'Welche Farbe hat der Himmel?',
    options: [
      { token: 'a', text: 'Grün' },
      { token: 'b', text: 'Blau' },
      { token: 'c', text: 'Rot' },
      { token: 'd', text: 'Gelb' },
    ],
    solution: { optionToken: 'b', text: 'Blau' },
    explanation: null,
    answers,
  });
}

function estimate(answers: unknown[], purpose = 'DUEL_ESTIMATE'): ParsedMatchEvent[] {
  return [
    event(20, 'QUESTION_OPENED', {
      seq: 7,
      kind: 'ESTIMATE',
      purpose,
      seats: purpose === 'LAND' ? [0, 1, 2] : [2, 1],
      timeLimitMs: 10000,
      closesAt: AT,
    }),
    event(21, 'QUESTION_RESOLVED', {
      seq: 7,
      kind: 'ESTIMATE',
      prompt: 'Wie hoch ist der Turm?',
      options: [],
      solution: { value: '125', unit: 'm' },
      explanation: null,
      answers,
    }),
  ];
}

function revealOf(events: ParsedMatchEvent[], seq = 7): Reveal {
  const found = revealFor(events, seq);
  if (!found) throw new Error('Auflösung fehlt');
  return found;
}

function answers(view: MatchView, reveal: Reveal | null): string {
  return renderToStaticMarkup(
    createElement(Answers, { view, local: null, short: shortNames(view), reveal }),
  );
}

describe('Liste „Antworten“ im Blatt deckt in der Auflösung auf, wer was gab', () => {
  it('Wissensfrage: Buchstabe, Antwort und Stempel neben dem Namen, der Angreifer zuerst', () => {
    // Der Server nennt die Antworten in seiner Reihenfolge; die Liste folgt der Frage
    const view = duelView();
    const html = answers(
      view,
      revealOf([
        trivia([
          answer(1, { optionText: 'Gelb' }),
          answer(2, { optionText: 'Blau', correct: true }),
        ]),
      ]),
    );
    expect(html).toContain('class="answers revealed"');
    expect(attr(html, 'data-kind')).toBe('TRIVIA');
    const rows = rowsOf(html);
    expect(rows.map((row) => attr(row, 'data-seat'))).toEqual(['2', '1']);
    expect(rows.map(shownOf)).toEqual(['Bot (schwer) B Blau', 'Du D Gelb']);
    expect(rows.map((row) => attr(row, 'data-verdict'))).toEqual(['right', 'wrong']);
    // Die Zeile füllt sich in der Farbe des Sitzes, der Stempel sitzt auf der Münze
    expect(rows[0]).toContain('<i class="seat-2"></i>');
    expect(rows[1]).toContain('<i class="seat-1"></i>');
    expect(rows[0]).toContain('class="reveal-stamp right"');
    expect(rows[1]).toContain('class="reveal-stamp wrong"');
    // Haken und Kreuz sind Zeichnungen: Ein Vorleser hört „richtig“ oder „falsch“
    expect(spokenOf(rows[0] ?? '')).toContain('Blau (richtig)');
    expect(spokenOf(rows[1] ?? '')).toContain('Gelb (falsch)');
    expect(rows[0]).toContain('class="reveal-mark" aria-hidden="true"');
    // Während der Frage stand „hat geantwortet“, jetzt nicht mehr
    expect(html).not.toContain('answer-state');
    expect(shownOf(html)).not.toContain('hat geantwortet');
  });

  it('wer schwieg, bekommt keine Farbe und „keine Antwort“', () => {
    const html = answers(
      duelView({ answered: [2] }),
      revealOf([
        trivia([
          answer(2, { optionText: 'Rot' }),
          answer(1, { answered: false, effectiveMs: null }),
        ]),
      ]),
    );
    const rows = rowsOf(html);
    expect(rows.map(shownOf)).toEqual(['Bot (schwer) C Rot', 'Du keine Antwort']);
    expect(rows.map((row) => attr(row, 'data-verdict'))).toEqual(['wrong', 'silent']);
    expect(rows.map((row) => attr(row, 'data-answered'))).toEqual(['true', 'false']);
    expect(rows[1]).not.toContain('reveal-fill');
    expect(rows[1]).not.toContain('reveal-stamp');
  });

  it('Stechen mit Schätzfrage: die Zahl mit Einheit, ohne Stempel', () => {
    const view = duelView({ kind: 'ESTIMATE', purpose: 'DUEL_ESTIMATE' });
    const html = answers(
      view,
      revealOf(
        estimate([
          answer(2, { value: '130', distance: '5' }),
          answer(1, { value: '12000', distance: '11875' }),
        ]),
      ),
    );
    expect(attr(html, 'data-kind')).toBe('ESTIMATE');
    const rows = rowsOf(html);
    expect(rows.map(shownOf)).toEqual(['Bot (schwer) 130 m', 'Du 12.000 m']);
    expect(rows.map((row) => attr(row, 'data-verdict'))).toEqual(['estimate', 'estimate']);
    expect(html).not.toContain('reveal-stamp');
    expect(rows[0]).toContain('<i class="seat-2"></i>');
  });

  it('gehört die Auflösung zu einer anderen Frage, bleibt die Liste beim Stand der Frage', () => {
    const view = duelView({ seq: 8, resolved: false, answered: [2] });
    const html = answers(view, revealOf([trivia([answer(2, { optionText: 'Blau' })])]));
    expect(html).not.toContain('revealed');
    expect(rowsOf(html).map(shownOf)).toEqual(['Bot (schwer) ✓ hat geantwortet', 'Du ✓ abgegeben']);
  });

  it('nennt auch Sitze, die die Ansicht nicht kennt: am Ende, in der Folge des Servers', () => {
    // Ansicht schon ohne Frage (nächster Zug): Die Folge kommt aus der Auflösung
    const none = answers(
      { ...duelView(), question: null },
      revealOf([trivia([answer(1, { optionText: 'Gelb' }), answer(2, { optionText: 'Blau' })])]),
    );
    expect(rowsOf(none).map((row) => attr(row, 'data-seat'))).toEqual(['1', '2']);
    const partial = answers(
      duelView({ seats: [2] }),
      revealOf([
        trivia([
          answer(0, { optionText: 'Rot' }),
          answer(1, { optionText: 'Gelb' }),
          answer(2, { optionText: 'Blau' }),
        ]),
      ]),
    );
    expect(rowsOf(partial).map((row) => attr(row, 'data-seat'))).toEqual(['2', '0', '1']);
  });
});

describe('Blatt der Auflösung mit der Liste „Antworten“', () => {
  function blatt(view: MatchView, events: ParsedMatchEvent[]): string {
    return renderToStaticMarkup(
      createElement(StageBlatt, {
        view,
        state: 'reveal',
        local: null,
        watching: false,
        phaseDeadline: 5000,
        estimate: '',
        busy: false,
        events,
        reveal: revealOf(events),
        outcome: null,
        error: null,
        name: seatNames(view),
        region: regionNames(mapOfView(view)),
        onEstimate: noop,
        onAnswerEstimate: noop,
      }),
    );
  }
  const noop = () => undefined;

  it('steht im Duell unter dem Kopf des Duells, an derselben Stelle wie während der Frage', () => {
    // Ich (Sitz 1) schaue zu, wie Sitz 2 den Sitz 0 angreift
    const html = blatt(duelView({}, 0), [
      trivia([answer(0, { optionText: 'Gelb' }), answer(2, { optionText: 'Blau', correct: true })]),
    ]);
    expect(html).toContain('data-testid="match-revealing"');
    expect(html).toContain('class="answers revealed"');
    expect(rowsOf(html).map(shownOf)).toEqual(['Bot (schwer) B Blau', 'Bot (leicht) D Gelb']);
    // Unter dem Kopf des Duells, vor der Lunte der Auflösung
    expect(html.indexOf('data-testid="match-answers"')).toBeGreaterThan(
      html.indexOf('class="blatt-title"'),
    );
  });

  it('fehlt bei der Landnahme: Dort zeigt die Karte in der Mitte die Rangfolge', () => {
    const events = [
      ...estimate(
        [
          answer(0, { value: '120', distance: '5' }),
          answer(1, { value: '100', distance: '25' }),
          answer(2, { value: '200', distance: '75' }),
        ],
        'LAND',
      ),
      event(22, 'LAND_RANKED', {
        round: 1,
        ranking: [
          { seat: 0, place: 1, picks: 2, distance: '5', effectiveMs: 3000 },
          { seat: 1, place: 2, picks: 1, distance: '25', effectiveMs: 3000 },
          { seat: 2, place: 3, picks: 0, distance: '75', effectiveMs: 3000 },
        ],
      }),
    ];
    const view = duelView({ seats: [0, 1, 2], kind: 'ESTIMATE', purpose: 'LAND' });
    const html = blatt(view, events);
    expect(html).toContain('data-testid="match-revealing"');
    expect(html).not.toContain('data-testid="match-answers"');
  });
});

describe('Kopf der mitgelesenen Fragekarte: wer gegen wen, wer schon abgegeben hat', () => {
  const QUESTION: MatchPresentedQuestion = {
    matchId: ID,
    seq: 7,
    presentedAt: AT,
    kind: 'TRIVIA',
    prompt: 'In welchem Jahr fiel die Berliner Mauer?',
    timeLimitMs: 8000,
    remainingMs: 6000,
    options: [
      { token: 'a', text: '1987' },
      { token: 'b', text: '1989' },
      { token: 'c', text: '1990' },
      { token: 'd', text: '1991' },
    ],
  };
  const card = (who: ReturnType<typeof watchedSeats>) =>
    renderToStaticMarkup(
      createElement(WatchedQuestionCard, { question: QUESTION, deadline: 8000, who }),
    );
  const seatsOf = (html: string) =>
    [
      ...html.matchAll(/class="watch-seat seat-(\d)" data-seat="\d" data-answered="(true|false)"/g),
    ].map((m) => `${m[1]}:${m[2]}`);

  it('Duell: Angreifer vorn, gekreuzte Schwerter dazwischen, Haken bei dem, der abgegeben hat', () => {
    const html = card({ seats: [1, 2], answered: [1], attacker: 2 });
    expect(html).toContain('data-testid="watch-duel"');
    expect(seatsOf(html)).toEqual(['2:false', '1:true']);
    expect(count(html, 'class="swords-icon"')).toBe(1);
    // Die Schwerter stehen zwischen den beiden Wappen
    expect(html.indexOf('swords-icon')).toBeGreaterThan(html.indexOf('data-seat="2"'));
    expect(html.indexOf('swords-icon')).toBeLessThan(html.indexOf('data-seat="1"'));
    expect(count(html, 'class="watch-state done"')).toBe(1);
    expect(count(html, 'class="watch-state thinking"')).toBe(1);
    // Nie, was gewählt wurde (O-38): an der Karte bleibt nichts markiert
    expect(html).not.toContain('chosen');
    // Das Schild weicht den Wappen; ein Vorleser hört weiter, dass er zuschaut
    expect(html).not.toContain('class="sheet-tag"');
    expect(spokenOf(html)).toContain('Du schaust zu');
  });

  it('ohne Angreifer (Landnahme) alle Gefragten nebeneinander, ohne Schwerter', () => {
    const html = card({ seats: [0, 1, 2], answered: [0, 2], attacker: null });
    expect(seatsOf(html)).toEqual(['0:true', '1:false', '2:true']);
    expect(html).not.toContain('swords-icon');
  });

  it('ohne Angabe der Gefragten bleibt das Schild „Du schaust zu“', () => {
    const html = card(null);
    expect(html).toContain('class="sheet-tag"');
    expect(html).not.toContain('watch-duel');
  });

  it('liest die Gefragten aus der Ansicht', () => {
    const view = duelView({ answered: [2], resolved: false }, 0);
    expect(watchedSeats(view.question, 2)).toEqual({ seats: [2, 0], answered: [2], attacker: 2 });
    expect(watchedSeats(null, 2)).toBeNull();
    expect(watchedSeats(duelView({ seats: [] }).question, null)).toBeNull();
  });
});
