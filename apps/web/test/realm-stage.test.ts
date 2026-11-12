import {
  matchViewSchema,
  realmWheelSchema,
  type MatchEventOf,
  type MatchPresentedQuestion,
  type MatchView,
  type ParsedMatchEvent,
  type QuestionCategory,
  type RealmOrderDto,
} from '@rdw/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LocalQuestion, MatchScreenState } from '../src/match/match-model.ts';
import { regionNames, seatNames } from '../src/match/match-text.ts';
import { PreparePanel } from '../src/match/PreparePanel.tsx';
import { RealmBlatt } from '../src/match/RealmBlatt.tsx';
import { RealmLobby } from '../src/match/RealmLobby.tsx';
import {
  realmPlayOf,
  wheelPreview,
  type PrepareTab,
  type RealmPlay,
} from '../src/match/realm-model.ts';
import { RealmSeatList } from '../src/match/RealmSeatList.tsx';
import { RealmStage, type RealmStageInitial } from '../src/match/RealmStage.tsx';
import { AT, event, ID, realmViewOf, type RealmViewOptions } from './match-fixtures.ts';

/**
 * Die Partie mit Ausbau als fertiges HTML (ADR-060): Spielstand mit Vorräten, das Blatt der
 * Rüstzeit, die Blätter der übrigen Phasen, die Lieblingskategorien vor dem Start und die ganze
 * Bühne. Geprüft wird, was ein Mitspieler liest und was er antippen kann. Grundbild
 * (match-fixtures): Ich bin Anna auf Sitz 2 mit 7 Brot und 10 Baustoff, Burg Graufurt (2), Stadt
 * Dornfeld (6), Dorf Birkental (5) und einer Armee auf Eisenhang (7).
 */

const ME = 2;
const CASTLE = 2;
const TOWN = 6;
const PLAIN = 7;
/** Dorf Kranichsee von Sitz 1, neben Dornfeld und Eisenhang. */
const TARGET = 12;

/** Sichtbarer Text ohne Auszeichnung; weiche Trennstellen zählen nicht. */
function textOf(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/­/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** Öffnendes Tag, in dem `marker` steht, mit allen Attributen. */
function tagOf(html: string, marker: string): string {
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`„${marker}“ fehlt`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

/** Ausschnitt ab dem Tag, in dem `from` steht, bis vor `to` (oder bis zum Ende). */
function part(html: string, from: string, to?: string): string {
  const at = html.indexOf(from);
  if (at < 0) throw new Error(`„${from}“ fehlt`);
  const start = from.startsWith('<') ? at : html.lastIndexOf('<', at);
  const end = to === undefined ? -1 : html.indexOf(to, at + from.length);
  return end < 0 ? html.slice(start) : html.slice(start, end);
}

/** Öffnendes Tag des ersten Knopfs mit dieser Beschriftung. */
function buttonOf(html: string, label: string): string {
  const all = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const found = all.find((button) => textOf(button) === label || button.includes(`"${label}"`));
  if (!found) throw new Error(`Knopf „${label}“ fehlt`);
  return found.slice(0, found.indexOf('>') + 1);
}

const noop = () => undefined;

function playOf(view: MatchView): RealmPlay {
  const play = realmPlayOf(view);
  if (!play) throw new Error('Ansicht ohne Brett');
  return play;
}

type Phase = NonNullable<MatchView['phase']>['kind'];

function phaseOf(kind: Phase): MatchView['phase'] {
  return { kind, deadline: AT, remainingMs: 5000 };
}

const PREP_TURNS = [
  { seat: 0, status: 'DONE' as const },
  { seat: 1, status: 'NOW' as const },
  { seat: 2, status: 'NOW' as const },
];
const MY_ATTACK = [
  { seat: 2, status: 'NOW' as const },
  { seat: 0, status: 'NEXT' as const },
  { seat: 1, status: 'NEXT' as const },
];
const THEIR_ATTACK = [
  { seat: 2, status: 'DONE' as const },
  { seat: 0, status: 'NOW' as const },
  { seat: 1, status: 'NEXT' as const },
];

function prepView(options: RealmViewOptions = {}): MatchView {
  return realmViewOf({ turns: PREP_TURNS, ...options });
}

function targetView(chooser: number, legal: number[] = [4, 9, 12, 13, 18]): MatchView {
  return realmViewOf(
    {
      step: { kind: 'CAMPAIGN_TARGET', round: 2, chooser, attacker: chooser },
      turns: chooser === ME ? MY_ATTACK : THEIR_ATTACK,
    },
    { phase: phaseOf('PICK'), legalRegions: chooser === ME ? legal : [] },
  );
}

/** Duell um Kranichsee mit dem Rad aus den Regeln; `attacker` greift Sitz 1 an. */
function duelView(
  phase: Phase,
  kind: 'DUEL_TRIVIA' | 'DUEL_ESTIMATE',
  attacker: number,
  overrides: Partial<MatchView> = {},
): MatchView {
  const wheel = realmWheelSchema.parse(wheelPreview(playOf(realmViewOf()), attacker, TARGET));
  return realmViewOf(
    {
      step: {
        kind,
        round: 2,
        attacker,
        defender: 1,
        region: TARGET,
        category: 'HISTORY',
        wheel,
      },
      turns: attacker === ME ? MY_ATTACK : THEIR_ATTACK,
    },
    { phase: phaseOf(phase), ...overrides },
  );
}

const base = { matchId: ID, seq: 12, presentedAt: AT };
const TRIVIA: MatchPresentedQuestion = {
  ...base,
  kind: 'TRIVIA',
  prompt: 'In welchem Jahr fiel die Berliner Mauer?',
  timeLimitMs: 15000,
  remainingMs: 11000,
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
  timeLimitMs: 20000,
  remainingMs: 8000,
  unitLabel: 'km',
  answerPrecision: 0,
};

function localOf(
  question: MatchPresentedQuestion,
  status: LocalQuestion['status'] = 'OPEN',
  sent?: LocalQuestion['sent'],
): LocalQuestion {
  return { seq: 12, question, shownAt: 0, deadline: 8000, reloaded: false, status, sent };
}

type QuestionInfo = NonNullable<MatchView['question']>;

function info(
  kind: 'TRIVIA' | 'ESTIMATE',
  purpose: QuestionInfo['purpose'],
  myStatus: QuestionInfo['myStatus'],
  seats: number[],
  answered: number[] = [],
): QuestionInfo {
  return { seq: 12, kind, purpose, seats, closesAt: AT, resolved: false, myStatus, answered };
}

function realmDuel(partial: Record<string, unknown> = {}): MatchEventOf<'REALM_DUEL_RESOLVED'> {
  const parsed = event(32, 'REALM_DUEL_RESOLVED', {
    round: 2,
    duel: 3,
    attacker: ME,
    defender: 1,
    region: TARGET,
    category: 'HISTORY',
    winner: 'ATTACKER',
    reason: 'TRIVIA',
    effect: 'BUILDING_DAMAGED',
    building: 'NONE',
    castleLivesLeft: null,
    regionValue: 100,
    armyLost: { seat: 1, region: TARGET },
    ...partial,
  });
  if (parsed.type !== 'REALM_DUEL_RESOLVED') throw new Error('falsches Ereignis');
  return parsed;
}

function revealed(
  seat: number,
  seq: number,
  orders: RealmOrderDto[],
  summary: Record<string, unknown> = {},
): ParsedMatchEvent {
  return event(seq, 'ORDERS_REVEALED', {
    round: 2,
    seat,
    orders,
    summary: { built: [], recruited: 0, moved: 0, traded: 0, ...summary },
    bread: 3,
    material: 4,
  });
}

// ---------------------------------------------------------------------------------------------
// Spielstand links
// ---------------------------------------------------------------------------------------------

describe('Spielstand der Partie mit Ausbau', () => {
  function seats(view: MatchView): string {
    return renderToStaticMarkup(
      createElement(RealmSeatList, { view, play: playOf(view), name: seatNames(view) }),
    );
  }
  const plaque = (html: string, seat: number) =>
    part(html, `<li class="plaque realm seat-${seat}`, '</li>');

  it('zeigt je Reich Name, Punkte, Burgleben und die Vorräte', () => {
    const html = seats(prepView());
    expect(count(html, '<li')).toBe(3);
    const mine = plaque(html, ME);
    expect(mine).toContain('plaque realm seat-2 me');
    expect(textOf(mine)).toContain('Anna (du)');
    expect(textOf(mine)).toContain('1.000 Punkte');
    expect(textOf(mine)).toContain('7 Brot');
    expect(textOf(mine)).toContain('10 Baustoff');
    expect(mine).toContain('aria-label="3 Burgleben"');
    expect(count(mine, 'life-on')).toBe(3);
  });

  it('sagt in der Rüstzeit, wer fertig ist und wer noch rüstet', () => {
    const html = seats(prepView());
    expect(plaque(html, 0)).toContain('data-status="ready"');
    expect(textOf(plaque(html, 0))).toContain('✓ fertig');
    expect(plaque(html, 1)).toContain('data-status="busy"');
    expect(textOf(plaque(html, ME))).toContain('rüstet');
    expect(html).not.toContain('am Zug');
  });

  it('hebt hervor, wer gerade sein Ziel wählt, und zeigt dann keinen Rüststand', () => {
    const html = seats(targetView(0));
    expect(plaque(html, 0)).toContain('plaque realm seat-0 turn');
    expect(textOf(plaque(html, 0))).toContain('am Zug');
    expect(count(html, 'am Zug')).toBe(1);
    expect(html).not.toContain('✓ fertig');
    expect(html).not.toContain('rüstet');
  });

  it('nennt ein gefallenes Reich ausgeschieden, ohne Leben und Vorräte', () => {
    const html = seats(prepView({ eliminated: [1] }));
    const theirs = plaque(html, 1);
    expect(theirs).toContain('eliminated');
    expect(textOf(theirs)).toContain('ausgeschieden');
    expect(theirs).not.toContain('seat-lives');
    expect(textOf(theirs)).not.toContain('Brot');
  });

  it('schreibt die Leben von zwei Burgen als Zahl', () => {
    const html = seats(prepView({ buildings: { [TOWN]: 'CASTLE' } }));
    expect(plaque(html, ME)).toContain('plaque-lives many');
    expect(plaque(html, 0)).not.toContain('plaque-lives many');
  });
});

// ---------------------------------------------------------------------------------------------
// Blatt der Rüstzeit
// ---------------------------------------------------------------------------------------------

describe('Blatt der Rüstzeit', () => {
  interface Prep {
    readonly view?: MatchView;
    readonly orders?: readonly RealmOrderDto[];
    readonly done?: boolean;
    readonly selected?: number | null;
    readonly tab?: PrepareTab;
    readonly moveTo?: number | null;
    readonly trading?: boolean;
    readonly dropped?: boolean;
    readonly busy?: boolean;
  }

  function prepare(props: Prep = {}): string {
    const view = props.view ?? prepView();
    const play = playOf(view);
    return renderToStaticMarkup(
      createElement(PreparePanel, {
        play,
        seat: ME,
        orders: props.orders ?? [],
        done: props.done ?? false,
        selected: props.selected ?? null,
        tab: props.tab ?? 'build',
        moveTo: props.moveTo ?? null,
        trading: props.trading ?? false,
        dropped: props.dropped ?? false,
        waiting: ['Bot (schwer)'],
        phaseDeadline: 5000,
        busy: props.busy ?? false,
        error: null,
        region: regionNames(play.map),
        onOrders: noop,
        onTab: noop,
        onTrading: noop,
        onSubmit: noop,
        onEdit: noop,
      }),
    );
  }
  const stock = (html: string) => textOf(part(html, 'data-testid="prepare-stock"', '</div>'));

  it('zeigt zu Beginn Vorrat, Einkommen und den Hinweis, ein Feld anzutippen', () => {
    const html = prepare();
    expect(html).toContain('data-testid="match-prepare"');
    expect(html).not.toContain('data-done');
    expect(textOf(html)).toContain('Rüstzeit');
    expect(stock(html)).toContain('Vorrat 7 Brot 10 Baustoff');
    expect(textOf(html)).toContain('Einkommen + 4 Brot + 5 Baustoff');
    expect(textOf(html)).toContain('Tippe ein eigenes Feld an.');
    expect(textOf(html)).toContain('Noch keine Befehle');
    expect(buttonOf(html, 'Tauschen, 3 zu 1')).toContain('aria-pressed="false"');
    // Auch ohne Befehle darf man fertig sein
    expect(buttonOf(html, 'Fertig')).not.toContain('disabled');
  });

  it('bietet auf einem freien Feld das Dorf mit seinen Kosten an', () => {
    const html = prepare({ selected: PLAIN });
    const field = part(html, 'data-testid="prepare-field"', '<div class="segs"');
    expect(field).toContain('data-region="7"');
    expect(textOf(field)).toBe('Eisenhang Bergland, bringt 1 Baustoff je Runde');
    expect(buttonOf(html, 'Bauen')).toContain('aria-pressed="true"');
    // Armeen entstehen nur in einer Burg
    expect(tagOf(html, 'data-tab="buy"')).toContain('disabled');
    expect(tagOf(html, 'data-tab="move"')).not.toContain('disabled');
    const detail = part(html, '<div class="detail"', '</div>');
    expect(textOf(detail)).toBe('Dorf 1 Brot 3 Baustoff Bauen');
    expect(detail).not.toContain('disabled');
  });

  it('rechnet einen geplanten Bau in den Vorrat ein und lässt ihn streichen', () => {
    const html = prepare({ selected: PLAIN, orders: [{ kind: 'BUILD', region: PLAIN }] });
    expect(stock(html)).toContain('6 Brot 7 Baustoff');
    expect(textOf(part(html, '<div class="detail"', '</div>'))).toBe('Dorf Geplant Streichen');
    const chips = part(html, 'data-testid="prepare-orders"', '</ul>');
    expect(count(chips, '<li')).toBe(1);
    expect(chips).toContain('aria-label="Dorf in Eisenhang zurücknehmen"');
    expect(textOf(chips)).toContain('Dorf ×');
  });

  it('sagt, warum die nächste Stufe gerade nicht geht', () => {
    const html = prepare({ selected: TOWN });
    expect(textOf(part(html, 'data-testid="prepare-field"', '<div class="segs"'))).toContain(
      'Stadt Dornfeld',
    );
    const detail = part(html, '<div class="detail"', '</div>');
    expect(textOf(detail)).toBe('Burg 8 Brot 16 Baustoff Bauen');
    expect(detail).toContain('disabled');
    expect(textOf(html)).toContain('Dafür reicht der Vorrat nicht.');
  });

  it('kauft Armeen in der Burg bis zur Obergrenze des Felds', () => {
    const start = prepare({ selected: CASTLE, tab: 'buy' });
    expect(textOf(part(start, 'data-testid="prepare-field"', '<div class="segs"'))).toBe(
      'Burg Graufurt 3 Armeen, Platz für 6',
    );
    expect(textOf(part(start, '<div class="detail"', '</div>'))).toContain('Armeen je 2 Brot');
    expect(buttonOf(start, 'weniger')).toContain('disabled');
    expect(buttonOf(start, 'mehr')).not.toContain('disabled');
    expect(start).not.toContain('detail-note');

    const full = prepare({
      selected: CASTLE,
      tab: 'buy',
      orders: [{ kind: 'RECRUIT', region: CASTLE, count: 3 }],
    });
    expect(stock(full)).toContain('1 Brot 10 Baustoff');
    expect(buttonOf(full, 'mehr')).toContain('disabled');
    expect(textOf(full)).toContain('Mehr als 6 Armeen passen nicht auf ein Feld.');
    expect(textOf(part(full, 'data-testid="prepare-orders"', '</ul>'))).toContain('+3');
  });

  it('bittet beim Ziehen erst um ein Nachbarfeld und stellt dann die Zahl ein', () => {
    const ask = prepare({ selected: CASTLE, tab: 'move' });
    expect(textOf(ask)).toContain('Tippe ein markiertes Nachbarfeld an.');

    const html = prepare({
      selected: CASTLE,
      tab: 'move',
      moveTo: TOWN,
      orders: [{ kind: 'MOVE', from: CASTLE, to: TOWN, count: 2 }],
    });
    expect(textOf(part(html, 'data-testid="prepare-field"', '<div class="segs"'))).toBe(
      'Graufurt nach Dornfeld Armeen ziehen ein Feld weit',
    );
    const detail = part(html, '<div class="detail"', '</div>');
    expect(textOf(detail)).toContain('Armeen 3 bereit');
    expect(part(detail, 'class="step-value"', '</strong>')).toContain('>2');
    expect(part(html, 'data-testid="prepare-orders"', '</ul>')).toContain(
      'aria-label="2 Armeen von Graufurt nach Dornfeld ziehen zurücknehmen"',
    );
  });

  it('tauscht in beide Richtungen und zeigt gleich den neuen Vorrat', () => {
    const html = prepare({
      trading: true,
      selected: PLAIN,
      orders: [{ kind: 'TRADE', give: 'MATERIAL', count: 1 }],
    });
    expect(buttonOf(html, 'Tauschen, 3 zu 1')).toContain('aria-pressed="true"');
    expect(textOf(html)).toContain('Tauschen 3 geben, 1 bekommen');
    expect(count(html, 'data-trade=')).toBe(2);
    expect(html).toContain('aria-label="Baustoff gegen Brot"');
    expect(stock(html)).toContain('8 Brot 7 Baustoff');
    // Das Feld tritt zurück, solange getauscht wird
    expect(html).not.toContain('data-testid="prepare-field"');
    expect(textOf(part(html, 'data-testid="prepare-orders"', '</ul>'))).toContain('3 → 1');
  });

  it('zeigt nach der Abgabe die Befehle ohne Knöpfe und wer noch rüstet', () => {
    const orders: RealmOrderDto[] = [
      { kind: 'BUILD', region: PLAIN },
      { kind: 'RECRUIT', region: CASTLE, count: 2 },
    ];
    const html = prepare({ done: true, orders, selected: PLAIN });
    expect(html).toContain('data-done="true"');
    expect(textOf(html)).toContain(
      'Abgegeben. Bot (schwer) rüstet noch. Die anderen sehen deine Befehle erst beim Aufdecken.',
    );
    expect(html).not.toContain('data-testid="prepare-field"');
    expect(html).not.toContain('zurücknehmen');
    expect(html).not.toContain('Tauschen, 3 zu 1');
    expect(count(html, '<button')).toBe(1);
    expect(buttonOf(html, 'Befehle ändern')).not.toContain('disabled');
    expect(part(html, 'data-testid="prepare-orders"', '</ul>')).toContain(
      'aria-label="Dorf in Eisenhang"',
    );
  });

  it('rückt viele Befehle zusammen', () => {
    const four: RealmOrderDto[] = [
      { kind: 'BUILD', region: PLAIN },
      { kind: 'BUILD', region: 0 },
      { kind: 'RECRUIT', region: CASTLE, count: 1 },
      { kind: 'MOVE', from: CASTLE, to: TOWN, count: 1 },
    ];
    const view = prepView({ stock: { [ME]: { bread: 30, material: 40 } } });
    expect(prepare({ view, orders: four })).not.toContain('class="dense"');
    const five = prepare({ view, orders: [...four, { kind: 'BUILD', region: 1 }] });
    expect(five).toContain('class="dense"');
    expect(count(part(five, 'data-testid="prepare-orders"', '</ul>'), '<li')).toBe(5);
  });

  it('meldet, wenn mit einem Befehl ein späterer herausfiel', () => {
    expect(prepare()).not.toContain('blatt-note');
    expect(textOf(prepare({ dropped: true }))).toContain(
      'Ohne diesen Befehl ging ein späterer nicht mehr.',
    );
  });

  it('gibt einen Entwurf, der nicht geht, nicht ab', () => {
    const html = prepare({ orders: [{ kind: 'BUILD', region: TOWN }] });
    expect(buttonOf(html, 'Fertig')).toContain('disabled');
    // Der Vorrat bleibt dann der vom Rundenbeginn
    expect(stock(html)).toContain('7 Brot 10 Baustoff');
  });

  it('sperrt alles, solange eine Aktion läuft', () => {
    const html = prepare({ selected: PLAIN, busy: true, orders: [{ kind: 'BUILD', region: 0 }] });
    expect(count(html, '<button')).toBe(count(html, 'disabled=""'));
  });

  it('sperrt die Knöpfe, die auf dem Feld nicht gehen', () => {
    const open = (id: number) => {
      const html = prepare({ selected: id });
      return (['build', 'buy', 'move'] as const).map(
        (name) => !tagOf(html, `data-tab="${name}"`).includes('disabled'),
      );
    };
    // Burg: höchste Stufe, also kein Bau, aber Kauf und Zug
    expect(open(CASTLE)).toEqual([false, true, true]);
    // Dorf ohne Armee: nur Bau
    expect(open(5)).toEqual([true, false, false]);
  });
});

// ---------------------------------------------------------------------------------------------
// Blatt der übrigen Phasen
// ---------------------------------------------------------------------------------------------

describe('Blatt der Phase in der Partie mit Ausbau', () => {
  interface Extra {
    readonly local?: LocalQuestion | null;
    readonly events?: readonly ParsedMatchEvent[];
    readonly outcome?: MatchEventOf<'REALM_DUEL_RESOLVED'> | null;
    readonly outcomeBeat?: boolean;
    readonly target?: number | null;
    readonly estimate?: string;
  }

  function blatt(view: MatchView, state: MatchScreenState, extra: Extra = {}): string {
    const play = playOf(view);
    return renderToStaticMarkup(
      createElement(RealmBlatt, {
        view,
        play,
        state,
        local: extra.local ?? null,
        phaseDeadline: 5000,
        estimate: extra.estimate ?? '',
        busy: false,
        events: extra.events ?? [],
        reveal: null,
        outcome: extra.outcome ?? null,
        outcomeBeat: extra.outcomeBeat ?? false,
        error: null,
        name: seatNames(view),
        region: regionNames(play.map),
        target: extra.target ?? null,
        onEstimate: noop,
        onAnswerEstimate: noop,
        onAttack: noop,
      }),
    );
  }

  it('erklärt beim Setzen der Burg, was sie mitbringt', () => {
    const view = realmViewOf(
      { step: { kind: 'CASTLE_PICK', round: null, chooser: ME }, turns: MY_ATTACK },
      { phase: phaseOf('PICK'), legalRegions: [0, 1, 3] },
    );
    const html = blatt(view, 'pick');
    expect(html).toContain('data-testid="match-pick"');
    expect(textOf(html)).toContain('Setze deine Burg');
    expect(textOf(html)).toContain('Deine Burg hat 3 Leben und beginnt mit 3 Armeen.');
    expect(count(html, '<button')).toBe(0);
  });

  it('bittet beim Angriff erst um ein Ziel', () => {
    const html = blatt(targetView(ME), 'pick');
    expect(textOf(html)).toContain('Dein Angriff');
    expect(textOf(html)).toContain('Tippe ein markiertes Feld an.');
    expect(html).not.toContain('data-testid="match-target"');
    expect(count(html, '<button')).toBe(0);
  });

  it('zeigt zum angetippten Ziel die Lose, die Folge eines Siegs und „Angreifen“', () => {
    const html = blatt(targetView(ME), 'pick', { target: TARGET });
    const target = part(html, 'data-testid="match-target"', '</div>');
    expect(target).toContain('data-region="12"');
    expect(textOf(target)).toBe('Kranichsee Dorf von Bot (schwer), 2 Armeen');
    const lots = part(html, 'data-testid="match-lots"', '</ul>');
    expect(count(lots, '<li')).toBe(3);
    expect(textOf(lots)).toMatch(/Du 3 .*Bot \(schwer\) 8 .*frei 2/);
    expect(textOf(html)).toContain(
      'Ein Sieg zerstört das Dorf, das Feld bleibt noch bei Bot (schwer).',
    );
    expect(buttonOf(html, 'Angreifen')).not.toContain('disabled');
  });

  it('sagt bei einer Burg als Ziel, dass ein Sieg ein Leben kostet', () => {
    const html = blatt(targetView(ME), 'pick', { target: 18 });
    expect(textOf(part(html, 'data-testid="match-target"', '</div>'))).toBe(
      'Rabenfels Burg von Bot (schwer), 3 Armeen',
    );
    expect(textOf(html)).toContain('Ein Sieg kostet die Burg ein Leben.');
  });

  it('nennt, wer gerade sein Ziel wählt', () => {
    const html = blatt(targetView(0), 'waiting-pick');
    expect(textOf(html)).toContain('Feldzug');
    expect(textOf(html)).toContain('Bot (leicht)');
    expect(count(html, '<button')).toBe(0);
  });

  it('deckt die Befehle aller Reiche auf, auch wer nicht gerüstet hat', () => {
    const view = realmViewOf(
      {
        step: { kind: 'CAMPAIGN_TARGET', round: 2, chooser: ME, attacker: ME },
        turns: MY_ATTACK,
      },
      { phase: phaseOf('ANNOUNCE') },
    );
    const html = blatt(view, 'orders', {
      events: [
        revealed(
          ME,
          41,
          [
            { kind: 'BUILD', region: PLAIN },
            { kind: 'RECRUIT', region: CASTLE, count: 2 },
          ],
          { built: [{ region: PLAIN, building: 'VILLAGE' }], recruited: 2 },
        ),
        revealed(0, 42, [{ kind: 'MOVE', from: 11, to: 15, count: 2 }], { moved: 2, traded: 1 }),
        revealed(1, 43, []),
      ],
    });
    expect(html).toContain('data-testid="match-orders"');
    expect(count(html, 'class="aufdeck-row')).toBe(3);
    expect(textOf(part(html, 'data-seat="2"', '</li>'))).toContain(
      'Du Dorf in Eisenhang 2 gekauft',
    );
    expect(textOf(part(html, 'data-seat="0"', '</li>'))).toContain(
      'Bot (leicht) 2 gezogen 1 mal getauscht',
    );
    expect(textOf(part(html, 'data-seat="1"', '</li>'))).toContain('Bot (schwer) rüstet nicht');
    expect(textOf(html)).toContain(
      'Gleich greift ihr der Reihe nach an: Du, Bot (leicht), Bot (schwer).',
    );
  });

  it('zeigt am Glücksrad die Lose und wem die gezogene Kategorie liegt', () => {
    const html = blatt(duelView('ANNOUNCE', 'DUEL_TRIVIA', ME), 'wheel');
    expect(html).toContain('data-testid="match-wheel"');
    expect(html).toContain('class="blatt turn"');
    expect(textOf(html)).toContain('Glücksrad');
    expect(textOf(part(html, 'data-testid="match-duel"', '</div>'))).toContain(
      'Angriff auf das Dorf Kranichsee',
    );
    const result = part(html, 'data-testid="wheel-result"', '</p>');
    expect(result).toContain('data-category="HISTORY"');
    expect(textOf(result)).toBe('Geschichte liegt dir');
  });

  it('färbt das Blatt am Glücksrad für den Angegriffenen', () => {
    const view = duelView('ANNOUNCE', 'DUEL_TRIVIA', 0);
    const attacked = { ...view, mySeat: 1 };
    expect(blatt(attacked, 'wheel')).toContain('class="blatt attacked"');
    // Als Zuschauer ohne Farbe
    expect(blatt(view, 'wheel')).toContain('class="blatt"');
  });

  it('zeigt während der Wissensfrage, wer schon geantwortet hat', () => {
    const view = duelView('QUESTION', 'DUEL_TRIVIA', ME, {
      question: info('TRIVIA', 'DUEL_TRIVIA', 'PRESENTED', [ME, 1], [1]),
    });
    const html = blatt(view, 'question', { local: localOf(TRIVIA) });
    expect(html).toContain('data-testid="match-answering"');
    expect(textOf(html)).toContain('Dein Angriff');
    const answers = part(html, 'data-testid="match-answers"', '</ul>');
    expect(count(answers, '<li')).toBe(2);
    expect(part(answers, 'data-seat="2"', '</li>')).toContain('data-answered="false"');
    expect(textOf(part(answers, 'data-seat="2"', '</li>'))).toContain('Du überlegst');
    expect(part(answers, 'data-seat="1"', '</li>')).toContain('data-answered="true"');
    expect(textOf(part(answers, 'data-seat="1"', '</li>'))).toContain(
      'Bot (schwer) ✓ hat geantwortet',
    );
    // Die Antworten selbst tippt man auf der Fragekarte in der Mitte
    expect(count(html, '<button')).toBe(0);
  });

  it('zählt die eigene Antwort sofort, auch ehe der Server sie bestätigt', () => {
    const view = duelView('QUESTION', 'DUEL_TRIVIA', ME, {
      question: info('TRIVIA', 'DUEL_TRIVIA', 'PRESENTED', [ME, 1], []),
    });
    const html = blatt(view, 'question', {
      local: localOf(TRIVIA, 'OPEN', { optionToken: 'b' }),
    });
    expect(textOf(part(html, 'data-seat="2"', '</li>'))).toContain('Du ✓ abgegeben');
    expect(textOf(part(html, 'data-seat="1"', '</li>'))).toContain('Bot (schwer) überlegt');
  });

  it('gibt bei der Schätzfrage dem Ziffernfeld den Platz', () => {
    const view = duelView('QUESTION', 'DUEL_ESTIMATE', ME, {
      question: info('ESTIMATE', 'DUEL_ESTIMATE', 'PRESENTED', [ME, 1], []),
    });
    const html = blatt(view, 'question', { local: localOf(ESTIMATE), estimate: '1230' });
    expect(textOf(html)).toContain('Stechen');
    expect(textOf(html)).toContain('Um Dorf Kranichsee: Die genauere Schätzung gewinnt.');
    expect(count(html, '<button')).toBe(13);
    expect(html).not.toContain('data-testid="match-answers"');
  });

  it('wartet nach der eigenen Antwort mit dem Stand der anderen', () => {
    const view = duelView('QUESTION', 'DUEL_TRIVIA', ME, {
      question: info('TRIVIA', 'DUEL_TRIVIA', 'ANSWERED', [ME, 1], [ME]),
    });
    const html = blatt(view, 'answered', {
      local: localOf(TRIVIA, 'ANSWERED', { optionToken: 'b' }),
    });
    expect(html).toContain('data-testid="match-waiting"');
    expect(textOf(html)).toContain('Deine Antwort ist gespeichert.');
    expect(textOf(part(html, 'data-seat="2"', '</li>'))).toContain('Du ✓ abgegeben');
    expect(textOf(part(html, 'data-seat="1"', '</li>'))).toContain('Bot (schwer) überlegt');
  });

  it('zeigt Zuschauern das Duell der anderen', () => {
    const view = duelView('QUESTION', 'DUEL_TRIVIA', 0, {
      question: info('TRIVIA', 'DUEL_TRIVIA', 'NOT_PARTICIPATING', [0, 1], [0]),
    });
    const html = blatt(view, 'spectating');
    expect(textOf(html)).toContain('Duell');
    expect(textOf(html)).toContain('Du schaust zu.');
    const answers = part(html, 'data-testid="match-answers"', '</ul>');
    expect(textOf(answers)).toContain('Bot (leicht) ✓ hat geantwortet');
    expect(textOf(answers)).toContain('Bot (schwer) überlegt');
    expect(answers).not.toContain('data-seat="2"');
  });

  describe('Ausgang eines Duells', () => {
    const after = (step: NonNullable<RealmViewOptions['step']>, mySeat = ME): MatchView => {
      const view = realmViewOf({ step, turns: THEIR_ATTACK }, { phase: phaseOf('REVEAL') });
      return { ...view, mySeat };
    };
    const nextAttack = { kind: 'CAMPAIGN_TARGET', round: 2, chooser: 0, attacker: 0 } as const;

    it('sagt dem Angreifer, was sein Sieg am Dorf bewirkt und wer als Nächstes angreift', () => {
      const html = blatt(after(nextAttack), 'reveal', { outcome: realmDuel() });
      expect(html).toContain('data-testid="match-outcome"');
      expect(html).toContain('data-effect="BUILDING_DAMAGED"');
      expect(html).toContain('class="blatt outcome seat-2"');
      expect(textOf(html)).toContain('Du gewinnst');
      expect(textOf(html)).toContain('Dein Angriff auf Kranichsee gelingt.');
      expect(textOf(part(html, 'class="outcome-list"', '</ul>'))).toBe(
        'Das Dorf ist zerstört Bot (schwer) verliert eine Armee',
      );
      expect(textOf(html)).toContain(
        'Das Feld bleibt bei Bot (schwer). Ein weiterer Sieg erobert es.',
      );
      expect(textOf(part(html, 'class="next"', '</div>'))).toBe(
        'Als Nächstes Bot (leicht) greift an',
      );
    });

    it('sagt dem Verteidiger, dass er hält und was das Feld jetzt wert ist', () => {
      const duel = realmDuel({
        attacker: 0,
        defender: ME,
        region: PLAIN,
        winner: 'DEFENDER',
        effect: 'FORTIFIED',
        regionValue: 200,
        armyLost: { seat: 0, region: 11 },
      });
      const html = blatt(after({ kind: 'PREPARE', round: 3 }), 'reveal', { outcome: duel });
      expect(html).toContain('class="blatt outcome seat-2"');
      expect(textOf(html)).toContain('Du gewinnst');
      expect(textOf(html)).toContain('Du hältst Eisenhang!');
      expect(textOf(part(html, 'class="outcome-list"', '</ul>'))).toBe(
        'Das Feld ist jetzt 200 Punkte wert Bot (leicht) verliert eine Armee',
      );
      expect(textOf(part(html, 'class="next"', '</div>'))).toBe(
        'Als Nächstes Die nächste Runde beginnt',
      );
    });

    it('sagt dem Verlierer, was er verliert', () => {
      const duel = realmDuel({
        attacker: 0,
        defender: ME,
        region: PLAIN,
        effect: 'CONQUERED',
        armyLost: { seat: ME, region: PLAIN },
      });
      const html = blatt(after(nextAttack), 'reveal', { outcome: duel });
      expect(html).toContain('class="blatt outcome seat-0"');
      expect(textOf(html)).toContain('Du verlierst');
      expect(textOf(html)).toContain('Du verlierst Eisenhang.');
      expect(textOf(part(html, 'class="outcome-list"', '</ul>'))).toBe(
        'Das Feld gehört jetzt Bot (leicht) Du verlierst eine Armee',
      );
    });

    it('erzählt Zuschauern den Ausgang mit Namen', () => {
      const duel = realmDuel({
        attacker: 0,
        defender: 1,
        effect: 'CASTLE_HIT',
        building: 'CASTLE',
        region: 18,
        castleLivesLeft: 2,
        armyLost: null,
      });
      const html = blatt(after({ kind: 'FINISHED', round: null }), 'reveal', { outcome: duel });
      expect(textOf(html)).toContain('Bot (leicht) gewinnt');
      expect(textOf(html)).toContain('Bot (leicht) trifft die Burg Rabenfels.');
      expect(textOf(part(html, 'class="outcome-list"', '</ul>'))).toBe('Die Burg hat noch 2 Leben');
      expect(textOf(part(html, 'class="next"', '</div>'))).toBe('Als Nächstes Die Abrechnung');
    });

    it('nennt die Übernahme eines ganzen Reichs', () => {
      const duel = realmDuel({
        effect: 'TAKEOVER',
        building: 'CASTLE',
        region: 18,
        castleLivesLeft: 0,
        armyLost: null,
      });
      const html = blatt(after(nextAttack), 'reveal', { outcome: duel });
      expect(textOf(html)).toContain('Du nimmst die letzte Burg von Bot (schwer) ein!');
      expect(textOf(html)).toContain('Das ganze Reich geht an dich');
    });
  });

  it('lässt Zuschauer der Rüstzeit wissen, was gleich kommt', () => {
    const view = realmViewOf({ eliminated: [ME] });
    const html = blatt(view, 'watching-prepare');
    expect(html).toContain('data-testid="match-prepare-watching"');
    expect(textOf(html)).toContain('Die anderen Reiche rüsten.');
  });
});

// ---------------------------------------------------------------------------------------------
// Vor dem Start
// ---------------------------------------------------------------------------------------------

/** Aufstellung vor dem Start: noch ohne Sitze und Brett; geprüft gegen das Schema des Protokolls. */
function lobbyView(
  favorites: readonly QuestionCategory[] | null,
  overrides: Partial<MatchView> = {},
): MatchView {
  const view = realmViewOf();
  return matchViewSchema.parse({
    ...view,
    match: {
      ...view.match,
      kind: 'STANDARD',
      status: 'LOBBY',
      startedAt: null,
      inviteCode: 'KRANICH',
    },
    players: view.players.map((p) => ({
      ...p,
      seat: null,
      favorites: p.isMe && favorites ? [...favorites] : null,
    })),
    mySeat: null,
    realm: view.realm && { ...view.realm, board: null, myOrders: null },
    phase: null,
    ...overrides,
  });
}

describe('Lieblingskategorien vor dem Start', () => {
  function lobby(view: MatchView): string {
    return renderToStaticMarkup(
      createElement(RealmLobby, {
        view,
        busy: false,
        error: null,
        onStart: noop,
        onLeave: noop,
        onSetBot: noop,
        onSetFavorites: noop,
      }),
    );
  }
  const fav = (html: string, category: string) =>
    part(html, `data-category="${category}"`, '</button>');
  const favTag = (html: string, category: string) => tagOf(html, `data-category="${category}"`);

  it('zeigt alle Kategorien und zählt die gewählten', () => {
    const html = lobby(lobbyView(['HISTORY', 'LITERATURE', 'ARTS_CULTURE']));
    expect(html).toContain('data-testid="match-favorites"');
    expect(count(html, 'data-category=')).toBe(11);
    expect(textOf(part(html, 'data-testid="fav-count"', '</span>'))).toContain('3 von 4 gewählt');
    expect(favTag(html, 'HISTORY')).toContain('aria-pressed="true"');
    expect(fav(html, 'HISTORY')).toContain('fav-check');
    expect(favTag(html, 'SPORTS')).toContain('aria-pressed="false"');
    expect(favTag(html, 'SPORTS')).not.toContain('disabled');
    expect(textOf(fav(html, 'SCIENCE'))).toContain('Naturwissenschaft');
  });

  it('sperrt weitere Kategorien, sobald alle gewählt sind', () => {
    const html = lobby(lobbyView(['HISTORY', 'LITERATURE', 'ARTS_CULTURE', 'NATURE_ANIMALS']));
    expect(tagOf(html, 'data-testid="fav-count"')).toContain('fav-count full');
    expect(favTag(html, 'SPORTS')).toContain('disabled');
    // Eine gewählte lässt sich wieder abwählen
    expect(favTag(html, 'HISTORY')).not.toContain('disabled');
  });

  it('sperrt Kategorien mit zu wenigen Fragen und sagt warum', () => {
    const view = lobbyView(null);
    const few = {
      ...view,
      realm: view.realm && {
        ...view.realm,
        categories: view.realm.categories.filter((c) => c !== 'SPORTS'),
      },
    };
    const html = lobby(few);
    expect(favTag(html, 'SPORTS')).toContain('disabled');
    expect(favTag(html, 'SPORTS')).toContain('data-available="false"');
    expect(favTag(html, 'SPORTS')).toContain('aria-label="Sport: noch zu wenige Fragen"');
    expect(favTag(html, 'HISTORY')).toContain('data-available="true"');
  });

  it('sagt je Mitspieler, wie weit die Wahl ist', () => {
    const html = lobby(lobbyView(['HISTORY']));
    const rows = html.split('data-testid="fav-seat"').slice(1).map(textOf);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Anna (du) noch 3 wählen');
    expect(rows[1]).toContain('Bot (leicht) wählt zufällig');
    const full = lobby(lobbyView(['HISTORY', 'LITERATURE', 'ARTS_CULTURE', 'NATURE_ANIMALS']));
    expect(textOf(full)).toContain('Anna (du) 4 gewählt');
  });

  it('unterscheidet bei anderen Menschen gewählt und wählt noch', () => {
    const view = lobbyView(['HISTORY']);
    const people: MatchView = {
      ...view,
      players: view.players.map((p, i) =>
        p.isMe
          ? p
          : { ...p, isBot: false, botStrength: null, favorites: i === 1 ? ['SPORTS'] : null },
      ),
    };
    const rows = lobby(people).split('data-testid="fav-seat"').slice(1).map(textOf);
    expect(rows[1]).toContain('hat gewählt');
    expect(rows[2]).toContain('wählt noch');
  });

  it('lässt den Gastgeber starten und die anderen auf ihn warten', () => {
    const host = lobby(lobbyView(null));
    expect(buttonOf(host, 'Partie starten')).not.toContain('disabled');
    expect(buttonOf(host, 'Mitspieler einladen')).toContain('data-testid="lobby-to-seats"');
    const guest = lobby(lobbyView(null, { isHost: false }));
    expect(guest).not.toContain('Partie starten');
    expect(textOf(guest)).toContain('Anna');
  });
});

// ---------------------------------------------------------------------------------------------
// Ganze Bühne
// ---------------------------------------------------------------------------------------------

describe('Bühne der Partie mit Ausbau', () => {
  interface StageExtra {
    readonly events?: readonly ParsedMatchEvent[];
    readonly local?: LocalQuestion | null;
    readonly initial?: RealmStageInitial;
    readonly estimate?: string;
  }

  function stage(view: MatchView | null, extra: StageExtra = {}): string {
    return renderToStaticMarkup(
      createElement(RealmStage, {
        view,
        events: extra.events ?? [],
        local: extra.local ?? null,
        phaseDeadline: null,
        feedError: null,
        actionError: null,
        busy: false,
        estimate: extra.estimate ?? '',
        onRetry: noop,
        onEstimate: noop,
        onPick: noop,
        onAnswer: noop,
        onExpire: noop,
        onStart: noop,
        onLeave: noop,
        onSetBot: noop,
        onSetFavorites: noop,
        onSubmitOrders: () => Promise.resolve(true),
        ...(extra.initial ? { initial: extra.initial } : {}),
      }),
    );
  }
  const main = (html: string) => html.slice(0, html.indexOf('>') + 1);

  it('zeigt ohne Ansicht nur, dass geladen wird', () => {
    const html = stage(null);
    expect(main(html)).toContain('data-state="loading"');
    expect(main(html)).toContain('data-mode="REALM"');
    expect(html).not.toContain('data-testid="match-seats"');
  });

  it('beginnt vor dem Start mit den Lieblingskategorien', () => {
    const html = stage(lobbyView(['HISTORY']));
    expect(main(html)).toContain('data-state="lobby"');
    expect(html).toContain('data-testid="match-favorites"');
    expect(html).not.toContain('data-testid="match-seats"');
  });

  it('stellt in der Rüstzeit Spielstand, Zugfolge und das Blatt um die Karte', () => {
    const html = stage(prepView());
    expect(main(html)).toContain('data-state="prepare"');
    expect(main(html)).toContain('data-step="PREPARE"');
    expect(main(html)).toContain('class="stage stage-realm"');
    expect(html).toContain('data-testid="match-seats"');
    expect(html).toContain('data-testid="match-turns"');
    expect(html).toContain('data-testid="match-prepare"');
    expect(textOf(part(html, 'data-testid="match-step"', '</p>'))).toContain('Runde 2 von 5');
    // Nichts liegt mitten auf der Karte
    expect(html).not.toContain('stage-centre');
    expect(html).not.toContain('stage-veil');
  });

  it('zeigt das gewählte Feld im Blatt und den Entwurf auf der Karte', () => {
    const html = stage(prepView(), {
      initial: {
        selected: PLAIN,
        orders: [
          { kind: 'BUILD', region: PLAIN },
          { kind: 'RECRUIT', region: CASTLE, count: 2 },
        ],
      },
    });
    expect(tagOf(html, 'data-testid="prepare-field"')).toContain('data-region="7"');
    expect(count(part(html, 'data-testid="prepare-orders"', '</ul>'), '<li')).toBe(2);
    expect(html).toContain('building ghost');
    expect(html).toContain('army-plus');
  });

  it('zeigt nach der Abgabe die abgegebenen Befehle', () => {
    const html = stage(prepView({ myOrders: [{ kind: 'BUILD', region: PLAIN }] }));
    expect(main(html)).toContain('data-state="prepared"');
    expect(tagOf(html, 'data-testid="match-prepare"')).toContain('data-done="true"');
    expect(textOf(html)).toContain('Abgegeben.');
  });

  it('zeigt beim Angriff das angetippte Ziel, ehe angegriffen wird', () => {
    const html = stage(targetView(ME), { initial: { target: TARGET } });
    expect(main(html)).toContain('data-state="pick"');
    expect(main(html)).toContain('data-step="CAMPAIGN_TARGET"');
    expect(tagOf(html, 'data-testid="match-target"')).toContain('data-region="12"');
    expect(textOf(html)).toContain('Angreifen');
    // Ein Ziel, das nicht erlaubt ist, zählt nicht
    expect(stage(targetView(ME), { initial: { target: 20 } })).not.toContain(
      'data-testid="match-target"',
    );
  });

  it('legt das Glücksrad mitten auf die Karte und das Ergebnis ins Blatt', () => {
    const html = stage(duelView('ANNOUNCE', 'DUEL_TRIVIA', ME), {
      events: [
        event(28, 'WHEEL_SPUN', {
          round: 2,
          region: TARGET,
          category: 'HISTORY',
          exhausted: ['SPORTS'],
        }),
      ],
    });
    expect(main(html)).toContain('data-state="wheel"');
    // 65 % der Ansage dreht das Rad
    expect(main(html)).toContain('--wheel-spin:1950ms');
    expect(html).toContain('class="stage-centre disc"');
    const disc = part(html, 'data-testid="match-wheel-disc"', '</svg>');
    expect(disc).toContain('class="wheel spinning"');
    expect(count(disc, 'class="wheel-seg"')).toBe(10);
    expect(tagOf(html, 'data-testid="wheel-result"')).toContain('data-category="HISTORY"');
  });

  it('legt die Fragekarte mit der Kategorie auf die Karte', () => {
    const view = duelView('QUESTION', 'DUEL_TRIVIA', ME, {
      question: info('TRIVIA', 'DUEL_TRIVIA', 'PRESENTED', [ME, 1], []),
    });
    const html = stage(view, { local: localOf(TRIVIA) });
    expect(main(html)).toContain('data-state="question"');
    expect(main(html)).toContain('data-seq="12"');
    const card = part(html, 'data-testid="match-question"', '</section>');
    expect(textOf(card)).toContain('Geschichte');
    expect(textOf(card)).toContain('In welchem Jahr fiel die Berliner Mauer?');
    expect(count(card, '<button')).toBe(4);
    expect(html).toContain('data-testid="match-answers"');
  });

  it('zeigt am Ende die Abrechnung', () => {
    const view = realmViewOf({ step: { kind: 'FINISHED', round: null } }, { phase: null });
    const html = stage({ ...view, match: { ...view.match, status: 'FINISHED' } });
    expect(main(html)).toContain('data-state="finished"');
    expect(html).toContain('data-testid="match-result"');
    expect(html).toContain('class="stage-centre wide"');
  });
});
