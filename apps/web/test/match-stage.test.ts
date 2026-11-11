import type { MatchPresentedQuestion, MatchView } from '@rdw/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LocalQuestion, MatchScreenState } from '../src/match/match-model.ts';
import { mapOfView, regionNames, seatNames } from '../src/match/match-text.ts';
import { RotateHint } from '../src/match/RotateHint.tsx';
import { SeatList } from '../src/match/SeatList.tsx';
import { StageBlatt } from '../src/match/StageBlatt.tsx';
import { StageQuestion } from '../src/match/StageQuestion.tsx';
import { TurnOrder } from '../src/match/TurnOrder.tsx';
import { AT, ID, viewOf } from './match-fixtures.ts';

/**
 * Die Bühne der Partie im Querformat als fertiges HTML (ADR-059): links der Spielstand, rechts das
 * Blatt der Phase, mitten auf der Karte die Frage. Geprüft wird, was ein Mitspieler liest und was
 * er antippen kann.
 */

/** Sichtbarer Text ohne Auszeichnung. */
function textOf(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

const noop = () => undefined;

const base = { matchId: ID, seq: 7, presentedAt: AT };
const TRIVIA: MatchPresentedQuestion = {
  ...base,
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
const ESTIMATE: MatchPresentedQuestion = {
  ...base,
  kind: 'ESTIMATE',
  prompt: 'Wie viele Kilometer ist der Rhein lang?',
  timeLimitMs: 10000,
  remainingMs: 8000,
  unitLabel: 'km',
  answerPrecision: 0,
};

function localOf(question: MatchPresentedQuestion): LocalQuestion {
  return { seq: 7, question, shownAt: 0, deadline: 8000, reloaded: false, status: 'OPEN' };
}

function blatt(view: MatchView, state: MatchScreenState, local: LocalQuestion | null = null) {
  return renderToStaticMarkup(
    createElement(StageBlatt, {
      view,
      state,
      local,
      phaseDeadline: 5000,
      estimate: '',
      busy: false,
      events: [],
      reveal: null,
      outcome: null,
      outcomeBeat: false,
      error: null,
      name: seatNames(view),
      region: regionNames(mapOfView(view)),
      onEstimate: noop,
      onAnswerEstimate: noop,
    }),
  );
}

describe('Spielstand links auf dem Meer', () => {
  const view = viewOf({}, { kind: 'CAMPAIGN_TARGET', round: 2, chooser: 1, attacker: 1 });
  const board = view.board;
  if (!board) throw new Error('Ansicht ohne Brett');
  const seats = board.seats.map((s) =>
    s.seat === 1 ? { ...s, capital: 4, points: 1050, regions: 8 } : s,
  );

  it('zeigt je Sitz Name, Punkte und Regionen und sagt, wer am Zug ist', () => {
    const html = renderToStaticMarkup(
      createElement(SeatList, {
        view: { ...view, board: { ...board, seats } },
        name: seatNames(view),
      }),
    );
    expect(count(html, '<li')).toBe(3);
    const mine = textOf(
      html.slice(
        html.indexOf('<li class="plaque seat-1'),
        html.indexOf('<li class="plaque seat-2'),
      ),
    );
    expect(mine).toContain('Anna (du)');
    expect(mine).toContain('1.050');
    expect(mine).toContain('8 Regionen');
    expect(mine).toContain('am Zug');
    // Nur wer wählt, trägt den goldenen Rand
    expect(count(html, 'plaque seat-1 turn me')).toBe(1);
    expect(count(html, 'am Zug')).toBe(1);
  });

  it('nennt ein gefallenes Reich ausgeschieden und zeigt keine Leben mehr', () => {
    const fallen = seats.map((s) => (s.seat === 2 ? { ...s, capital: 9, eliminated: true } : s));
    const html = renderToStaticMarkup(
      createElement(SeatList, {
        view: { ...view, board: { ...board, seats: fallen } },
        name: seatNames(view),
      }),
    );
    const theirs = html.slice(html.indexOf('<li class="plaque seat-2'));
    expect(theirs).toContain('plaque seat-2 eliminated');
    expect(textOf(theirs)).toContain('ausgeschieden');
    expect(theirs).not.toContain('seat-lives');
  });

  it('zeigt die Zugfolge als Wappenreihe mit dem Stand jedes Zuges', () => {
    const html = renderToStaticMarkup(createElement(TurnOrder, { view, name: seatNames(view) }));
    expect([...html.matchAll(/data-status="(\w+)"/g)].map((m) => m[1])).toEqual([
      'DONE',
      'NOW',
      'NEXT',
    ]);
    expect(count(html, 'turn-now seat-1 me')).toBe(1);
    // Die Überschrift bleibt für Screenreader und den Browser-Test stehen
    expect(textOf(html)).toContain('Angriffe');
  });
});

describe('Blatt der Phase rechts auf dem Meer', () => {
  it('sagt bei der eigenen Wahl, was zu wählen ist', () => {
    const capital = blatt(viewOf(), 'pick');
    expect(textOf(capital)).toContain('Wähle deine Hauptstadt');
    expect(capital).toContain('data-testid="match-pick"');
    const target = blatt(
      viewOf({}, { kind: 'CAMPAIGN_TARGET', round: 1, chooser: 1, attacker: 1 }),
      'pick',
    );
    expect(textOf(target)).toContain('Wähle dein Angriffsziel');
    expect(target).toContain('blatt turn');
  });

  it('nennt beim Warten, wer wählt', () => {
    const view = viewOf(
      { legalRegions: [] },
      { kind: 'CAMPAIGN_TARGET', round: 1, chooser: 2, attacker: 2 },
    );
    const html = blatt(view, 'waiting-pick');
    expect(textOf(html)).toContain('Feldzug');
    expect(textOf(html)).toContain('Bot (schwer)');
    expect(html).not.toContain('blatt turn');
  });

  const duel = viewOf(
    {
      phase: { kind: 'QUESTION', deadline: AT, remainingMs: 6000 },
      legalRegions: [],
      question: {
        seq: 7,
        kind: 'TRIVIA',
        purpose: 'DUEL_TRIVIA',
        seats: [1, 2],
        answered: [],
        closesAt: AT,
        resolved: false,
        myStatus: 'PRESENTED',
      },
    },
    { kind: 'DUEL_TRIVIA', round: 1, chooser: null, attacker: 1, defender: 2, region: 5 },
  );

  it('zeigt bei der Wissensfrage, wer gegen wen kämpft, und die Regel', () => {
    const html = blatt(duel, 'question', localOf(TRIVIA));
    expect(textOf(html)).toContain('Dein Angriff');
    expect(html).toContain('data-testid="match-duel"');
    expect(textOf(html)).toContain('Liegt nur einer richtig, gewinnt er.');
    expect(html).not.toContain('numkey');
  });

  it('bietet bei der Schätzfrage das Ziffernfeld mit zwölf Tasten und „Antwort abgeben“', () => {
    const tie = {
      ...duel,
      board: duel.board
        ? { ...duel.board, step: { ...duel.board.step, kind: 'DUEL_ESTIMATE' as const } }
        : null,
    };
    const html = blatt(tie, 'question', localOf(ESTIMATE));
    expect(textOf(html)).toContain('Stechen');
    expect(textOf(html)).toContain('Die genauere Schätzung gewinnt.');
    expect(count(html, 'button numkey')).toBe(12);
    // Ganze Zahl gefragt: Das Komma ist da, aber nicht bedienbar; ohne Eingabe gibt es nichts abzugeben
    expect(count(html, 'disabled=""')).toBe(2);
    expect(textOf(html)).toContain('Antwort abgeben');
  });

  it('sagt nach der eigenen Antwort, dass sie gespeichert ist', () => {
    const html = blatt(duel, 'answered', localOf(TRIVIA));
    expect(html).toContain('data-testid="match-waiting"');
    expect(textOf(html)).toContain('Deine Antwort ist gespeichert.');
  });
});

describe('Fragekarte mitten auf der Karte', () => {
  function card(
    question: MatchPresentedQuestion,
    props: { open?: boolean; estimate?: string; sent?: LocalQuestion['sent'] } = {},
  ) {
    return renderToStaticMarkup(
      createElement(StageQuestion, {
        question,
        deadline: 8000,
        reloaded: false,
        busy: false,
        open: props.open ?? true,
        estimate: props.estimate ?? '',
        sent: props.sent ?? null,
        onExpire: noop,
        onAnswerTrivia: noop,
      }),
    );
  }

  it('zeigt die Wissensfrage mit vier Antworten zum Antippen', () => {
    const html = card(TRIVIA);
    expect(html).toContain('data-kind="TRIVIA"');
    expect(textOf(html)).toContain('In welchem Jahr fiel die Berliner Mauer?');
    expect(count(html, '<button')).toBe(4);
    expect(html).not.toContain('disabled');
    expect(textOf(html)).toMatch(/A 1987 B 1989 C 1990 D 1991/);
  });

  it('lässt die Karte nach der Antwort stehen und markiert die gewählte Antwort', () => {
    const html = card(TRIVIA, { open: false, sent: { optionToken: 'b' } });
    expect(html).toContain('question-sheet closed');
    expect(count(html, 'disabled=""')).toBe(4);
    expect(count(html, 'option chosen')).toBe(1);
    expect(html.slice(html.indexOf('option chosen'))).toContain('1989');
  });

  it('zeigt bei der Schätzfrage die getippte Zahl mit Einheit und keine eigenen Knöpfe', () => {
    const html = card(ESTIMATE, { estimate: '12500' });
    expect(html).toContain('data-kind="ESTIMATE"');
    expect(html).toContain('data-testid="estimate-value"');
    expect(textOf(html)).toContain('12.500');
    expect(textOf(html)).toContain('km');
    expect(count(html, '<button')).toBe(0);
    expect(count(html, '<input')).toBe(0);
  });

  it('zeigt nach dem Abschicken die abgeschickte Zahl', () => {
    const html = card(ESTIMATE, { open: false, estimate: '', sent: { rawInput: '1230' } });
    expect(textOf(html)).toContain('1230');
    expect(html).toContain('estimate-entry sent');
  });
});

describe('Hinweis im Hochformat', () => {
  it('bittet darum, das Handy quer zu halten', () => {
    const html = renderToStaticMarkup(createElement(RotateHint));
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('Bitte dreh dein Handy quer');
  });
});
