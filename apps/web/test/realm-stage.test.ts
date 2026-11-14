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
import type { LocalQuestion, MatchScreenState, WatchedQuestion } from '../src/match/match-model.ts';
import { regionNames, seatNames } from '../src/match/match-text.ts';
import { PreparePanel } from '../src/match/PreparePanel.tsx';
import { RealmBlatt } from '../src/match/RealmBlatt.tsx';
import { RealmLobby, type RealmLobbyInitial } from '../src/match/RealmLobby.tsx';
import {
  favoriteChance,
  fieldOptions,
  moveRefusal,
  realmPlayOf,
  wheelPreview,
  type RealmPlay,
} from '../src/match/realm-model.ts';
import { RealmSeatList } from '../src/match/RealmSeatList.tsx';
import { RealmStage, type RealmStageInitial } from '../src/match/RealmStage.tsx';
import {
  AT,
  event,
  ID,
  REALM_FAVORITES,
  realmViewOf,
  type RealmViewOptions,
} from './match-fixtures.ts';

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
const accept = () => Promise.resolve(true);

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

/** Freies Feld Ackerbrunn (4) neben Eschenhain und Birkental; dort stehen zwei meiner Armeen. */
const FREE = 4;
const FREE_BOARD = { free: [FREE], armies: { 5: 2 } } as const;

/** Angriff von `attacker` auf das freie Feld Ackerbrunn (O-37): ohne Verteidiger. */
function claimView(
  phase: Phase,
  attacker: number,
  category: QuestionCategory = 'HISTORY',
  overrides: Partial<MatchView> = {},
): MatchView {
  const wheel = realmWheelSchema.parse(
    wheelPreview(playOf(realmViewOf(FREE_BOARD)), attacker, FREE),
  );
  return realmViewOf(
    {
      ...FREE_BOARD,
      step: {
        kind: 'DUEL_TRIVIA',
        round: 2,
        attacker,
        defender: null,
        region: FREE,
        category,
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

  it('lässt den eigenen Vorrat erst hochzählen, wenn das Einkommen ankommt (ADR-067)', () => {
    const view = prepView();
    const html = renderToStaticMarkup(
      createElement(RealmSeatList, {
        view,
        play: playOf(view),
        name: seatNames(view),
        receiving: { delayMs: 990, durationMs: 760 },
      }),
    );
    const mine = tagOf(html, 'plaque realm seat-2 me');
    expect(mine).toContain('plaque realm seat-2 me receiving');
    expect(mine).toContain('--receive-at:990ms');
    expect(count(html, ' receiving')).toBe(1);
    // Ohne Einkommen unterwegs trägt keine Tafel die Marke
    expect(seats(view)).not.toContain('receiving');
  });

  it('zeigt den Stand vor dem Einkommen, solange dessen Rüstzeit nicht begonnen hat (ADR-067)', () => {
    const view = prepView();
    const html = renderToStaticMarkup(
      createElement(RealmSeatList, {
        view,
        play: playOf(view),
        name: seatNames(view),
        pending: [
          { seat: 0, bread: 2, material: 3 },
          { seat: ME, bread: 4, material: 5 },
        ],
      }),
    );
    // Verbucht sind 7 Brot und 10 Baustoff; das Einkommen der neuen Runde steht noch aus
    expect(textOf(plaque(html, ME))).toContain('3 Brot');
    expect(textOf(plaque(html, ME))).toContain('5 Baustoff');
    expect(textOf(plaque(seats(view), ME))).toContain('7 Brot');
    // Auch bei den anderen, und nie unter null
    const other = (markup: string) => /(\d+) Brot/.exec(textOf(plaque(markup, 0)))?.[1];
    expect(Number(other(html))).toBe(Math.max(0, Number(other(seats(view))) - 2));
    expect(textOf(plaque(html, 1))).toBe(textOf(plaque(seats(view), 1)));
  });

  it('sagt in der Rüstzeit, wer fertig ist und wer noch rüstet', () => {
    const html = seats(prepView());
    expect(plaque(html, 0)).toContain('data-status="ready"');
    expect(textOf(plaque(html, 0))).toContain('✓ fertig');
    expect(plaque(html, 1)).toContain('data-status="busy"');
    expect(textOf(plaque(html, 1))).toContain('rüstet');
    expect(html).not.toContain('am Zug');
  });

  it('nennt am eigenen Reich statt des Rüststands, was die nächste Runde bringt', () => {
    const html = seats(prepView());
    const mine = plaque(html, ME);
    expect(mine).toContain('data-status="busy"');
    expect(mine).not.toContain('plaque-state');
    expect(count(mine, 'class="plaque-plus"')).toBe(2);
    expect(textOf(mine)).toContain('+4');
    expect(textOf(mine)).toContain('+5');
    expect(textOf(mine)).toContain('Einkommen je Runde: 4 Brot, 5 Baustoff');
    expect(count(html, 'class="plaque-plus"')).toBe(2);
  });

  it('zeigt am eigenen Reich „am Zug“ an der Stelle des Einkommens', () => {
    const mine = plaque(seats(targetView(ME)), ME);
    expect(mine).toContain('plaque realm seat-2 turn me');
    expect(textOf(mine)).toContain('am Zug');
    expect(mine).not.toContain('plaque-plus');
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
    /** „Ziehen“ ist offen: Der nächste Tipp auf die Karte ist das Ziel. */
    readonly moving?: boolean;
    /** Feld, das bei offenem „Ziehen“ zuletzt angetippt wurde. */
    readonly tapped?: number;
    readonly trading?: boolean;
    readonly dropped?: boolean;
    readonly busy?: boolean;
  }

  function prepare(props: Prep = {}): string {
    const view = props.view ?? prepView();
    const play = playOf(view);
    const orders = props.orders ?? [];
    const selected = props.selected ?? null;
    const field = selected === null ? null : fieldOptions(play, ME, orders, selected);
    return renderToStaticMarkup(
      createElement(PreparePanel, {
        play,
        seat: ME,
        orders,
        done: props.done ?? false,
        selected,
        moving: props.moving ?? false,
        refused:
          field && props.tapped !== undefined ? moveRefusal(play, ME, field, props.tapped) : null,
        trading: props.trading ?? false,
        dropped: props.dropped ?? false,
        waiting: ['Bot (schwer)'],
        phaseDeadline: 5000,
        busy: props.busy ?? false,
        error: null,
        region: regionNames(play.map),
        name: seatNames(view),
        onOrders: noop,
        onMoving: noop,
        onTrading: noop,
        onSubmit: noop,
        onEdit: noop,
      }),
    );
  }
  const stock = (html: string) => textOf(part(html, 'data-testid="prepare-stock"', '</div>'));
  /** Eine der drei Zeilen: ihr Text und ihr öffnendes Tag (Zustand, Zahl). */
  const row = (html: string, act: 'build' | 'buy' | 'move') => {
    const acts = part(html, 'data-testid="prepare-acts"', '</ul>');
    const li = part(acts, `data-act="${act}"`, '</li>');
    return { html: li, text: textOf(li), tag: tagOf(li, `data-act="${act}"`) };
  };
  /**
   * Kopf des gewählten Felds: `long` ist Name und Zeile darunter, `short` die Kurzfassung neben dem
   * Namen. Zu sehen ist je nach Höhe des Bildschirms nur eine von beiden (realm.css).
   */
  const fieldOf = (html: string) => {
    const field = part(html, 'data-testid="prepare-field"', '</div>');
    const short = field.includes('data-testid="prepare-fact-short"')
      ? part(field, 'data-testid="prepare-fact-short"', '<span class="feld-fact"')
      : '';
    return { long: textOf(field.replace(short, '')), short };
  };

  it('zeigt zu Beginn Vorrat, Einkommen und wozu die drei Zeilen gut sind', () => {
    const html = prepare();
    expect(html).toContain('data-testid="match-prepare"');
    expect(html).not.toContain('data-done');
    expect(textOf(html)).toContain('Rüstzeit');
    expect(stock(html)).toContain('Vorrat 7 Brot 10 Baustoff');
    const idle = part(html, 'data-testid="prepare-idle"', '</div>');
    expect(textOf(idle)).toBe('Tippe ein Feld an Einkommen 4 Brot 5 Baustoff je Runde');
    // Dieselben drei Zeilen wie zu einem Feld, hier ohne Knopf: Sie sagen, was sie bringen
    expect(row(html, 'build').text).toBe('Ausbauen mehr Ertrag je Runde');
    expect(row(html, 'buy').text).toBe('Armeen kaufen mehr Lose am Glücksrad');
    expect(row(html, 'move').text).toBe('Armeen ziehen je Runde ein Feld weit');
    expect(count(part(html, 'data-testid="prepare-acts"', '</ul>'), 'class="act info"')).toBe(3);
    expect(part(html, 'data-testid="prepare-acts"', '</ul>')).not.toContain('<button');
    expect(textOf(html)).toContain('Noch keine Befehle');
    expect(buttonOf(html, 'Tauschen, 3 zu 1')).toContain('aria-pressed="false"');
    // Auch ohne Befehle darf man fertig sein
    expect(buttonOf(html, 'Fertig')).not.toContain('disabled');
  });

  it('zeigt zu jedem eigenen Feld dieselben drei Zeilen, mit Knopf oder mit dem Grund', () => {
    const html = prepare({ selected: PLAIN });
    expect(tagOf(html, 'data-testid="prepare-field"')).toContain('data-region="7"');
    expect(fieldOf(html).long).toBe('Eisenhang Bergland, bringt 1 Baustoff je Runde');
    // Ausbauen: was entsteht, was es mehr bringt, was es kostet
    expect(row(html, 'build').text).toBe('Dorf bringt mehr: + 2 Baustoff 1 Brot 3 Baustoff Bauen');
    expect(row(html, 'build').html).not.toContain('disabled');
    // Armeen entstehen nur in einer Burg: Die Zeile bleibt stehen und sagt das
    expect(row(html, 'buy').text).toBe('Armeen kaufen Nur in einer Burg');
    expect(row(html, 'buy').tag).toContain('class="act off"');
    expect(row(html, 'buy').html).not.toContain('<button');
    // Ziehen: eine Armee steht bereit
    expect(row(html, 'move').text).toBe('Ziehen 1 bereit Ziehen');
    expect(row(html, 'move').tag).toContain('data-movable="1"');
  });

  it('rechnet einen geplanten Bau in den Vorrat ein und lässt ihn streichen', () => {
    const html = prepare({ selected: PLAIN, orders: [{ kind: 'BUILD', region: PLAIN }] });
    expect(stock(html)).toContain('6 Brot 7 Baustoff');
    expect(row(html, 'build').text).toBe('Dorf Geplant Streichen');
    expect(row(html, 'build').tag).toContain('class="act set"');
    expect(row(html, 'build').tag).toContain('data-ordered="true"');
    const chips = part(html, 'data-testid="prepare-orders"', '</ul>');
    expect(count(chips, '<li')).toBe(1);
    expect(chips).toContain('aria-label="Dorf in Eisenhang zurücknehmen"');
    expect(textOf(chips)).toContain('Dorf ×');
  });

  it('sagt, was für die nächste Stufe fehlt, statt einen Knopf zu zeigen, der nichts tut', () => {
    const html = prepare({ selected: TOWN });
    expect(fieldOf(html).long).toContain('Stadt Dornfeld');
    const build = row(html, 'build');
    expect(build.tag).toContain('class="act off"');
    expect(build.html).not.toContain('<button');
    // Preis der Burg in der Titelzeile, darunter, was im Vorrat fehlt (7 Brot, 10 Baustoff da)
    // (sichtbar als Zeichen mit Zahl, vorgelesen als Satz)
    expect(build.text).toBe(
      'Burg + Hier lassen sich Armeen kaufen 8 Brot 16 Baustoff Es fehlen 1 Brot 6 Baustoff Es fehlen 1 Brot und 6 Baustoff.',
    );
  });

  it('nennt die Grenze der Burgen und die höchste Stufe', () => {
    const two = prepView({
      buildings: { 5: 'CASTLE' },
      stock: { [ME]: { bread: 30, material: 40 } },
    });
    expect(row(prepare({ view: two, selected: TOWN }), 'build').text).toContain(
      'Höchstens 2 Burgen je Reich',
    );
    const castle = row(prepare({ selected: CASTLE }), 'build');
    expect(castle.text).toBe('Ausbauen Höchste Stufe erreicht');
    expect(castle.tag).toContain('class="act off"');
  });

  it('kauft Armeen in der Burg erst mit einem Knopf, dann mit Minus und Plus', () => {
    const start = prepare({ selected: CASTLE });
    expect(fieldOf(start).long).toBe('Burg Graufurt 3 Armeen, Platz für 6');
    expect(row(start, 'buy').text).toBe('Armeen je 2 Brot Kaufen');
    expect(row(start, 'buy').html).not.toContain('class="stepper"');

    const one = prepare({
      selected: CASTLE,
      orders: [{ kind: 'RECRUIT', region: CASTLE, count: 1 }],
    });
    expect(row(one, 'buy').tag).toContain('class="act set"');
    expect(row(one, 'buy').tag).toContain('data-count="1"');
    expect(buttonOf(row(one, 'buy').html, 'weniger')).not.toContain('disabled');
    expect(buttonOf(row(one, 'buy').html, 'mehr')).not.toContain('disabled');
    expect(stock(one)).toContain('5 Brot 10 Baustoff');

    const full = prepare({
      selected: CASTLE,
      orders: [{ kind: 'RECRUIT', region: CASTLE, count: 3 }],
    });
    expect(stock(full)).toContain('1 Brot 10 Baustoff');
    expect(fieldOf(full).long).toBe('Burg Graufurt 6 Armeen, Platz für 6');
    expect(buttonOf(row(full, 'buy').html, 'mehr')).toContain('disabled');
    expect(textOf(part(full, 'data-testid="prepare-orders"', '</ul>'))).toContain('+3');
  });

  it('sagt, warum sich in der Burg keine Armee kaufen lässt', () => {
    const crowded = prepare({ view: prepView({ armies: { [CASTLE]: 6 } }), selected: CASTLE });
    expect(row(crowded, 'buy').tag).toContain('class="act off"');
    expect(row(crowded, 'buy').text).toContain('Armeen kaufen');
    expect(row(crowded, 'buy').text).toContain('6');
    const poor = prepare({
      view: prepView({ stock: { [ME]: { bread: 1, material: 10 } } }),
      selected: CASTLE,
    });
    expect(row(poor, 'buy').text).toContain('Es fehlen 1 Brot');
    expect(row(poor, 'buy').html).not.toContain('<button');
  });

  it('nennt Ertrag oder Besatzung auch kurz neben dem Namen, für niedrige Bildschirme', () => {
    // Feld ohne Gebäude: sichtbar „+ 1 Baustoff“, vorgelesen derselbe Satz wie in der Zeile darunter
    const plain = fieldOf(prepare({ selected: PLAIN })).short;
    expect(plain).toContain('<span aria-hidden="true">+</span>');
    expect(textOf(plain.replace(/<span aria-hidden="true">[^<]*<\/span>/g, ''))).toBe(
      'Bergland, bringt 1 Baustoff je Runde',
    );
    // Burg: sichtbar „3/6“, vorgelesen als Satz
    const castle = fieldOf(prepare({ selected: CASTLE })).short;
    expect(castle).toContain('<span aria-hidden="true">3/6</span>');
    expect(textOf(castle.replace(/<span aria-hidden="true">[^<]*<\/span>/g, ''))).toBe(
      '3 Armeen, Platz für 6',
    );
    // Geplante Käufe zählen gleich mit, wie in der Zeile darunter
    const bought = prepare({
      selected: CASTLE,
      orders: [{ kind: 'RECRUIT', region: CASTLE, count: 3 }],
    });
    expect(fieldOf(bought).short).toContain('<span aria-hidden="true">6/6</span>');
  });

  it('Ziehen: Die Zeile nennt, wie viele Armeen bereitstehen, oder warum keine zieht', () => {
    expect(row(prepare({ selected: CASTLE }), 'move').text).toBe('Ziehen 3 bereit Ziehen');
    // Dorf ohne Armee
    expect(row(prepare({ selected: 5 }), 'move').text).toBe('Armeen ziehen Keine Armee hier');
    // Die eine Armee auf Eisenhang ist schon unterwegs
    const gone = prepare({
      selected: PLAIN,
      orders: [{ kind: 'MOVE', from: PLAIN, to: TOWN, count: 1 }],
    });
    expect(row(gone, 'move').tag).toContain('class="act off"');
    expect(row(gone, 'move').html).not.toContain('<button');
    // Falkenwacht (1) hat erst durch den Zug eine Armee: Sie zieht erst nächste Runde weiter
    const arrived = prepare({
      selected: 1,
      orders: [{ kind: 'MOVE', from: CASTLE, to: 1, count: 1 }],
    });
    expect(row(arrived, 'move').text).toBe('Armeen ziehen Erst nächste Runde');
  });

  it('fragt bei offenem „Ziehen“ nach dem Ziel und lässt abbrechen', () => {
    const html = prepare({ selected: CASTLE, moving: true });
    // Die drei Zeilen machen so lange Platz
    expect(html).not.toContain('data-testid="prepare-acts"');
    const card = part(html, 'data-testid="prepare-moving"', '</div></div>');
    expect(tagOf(html, 'data-testid="prepare-moving"')).not.toContain('data-refused');
    expect(textOf(card)).toBe(
      'Wohin? Abbrechen Tippe ein leuchtendes Nachbarfeld an. Eine Armee zieht dorthin. 3 Armeen können noch ziehen.',
    );
    expect(buttonOf(html, 'Abbrechen')).not.toContain('disabled');
    // Der Kopf des Felds bleibt stehen: Man sieht, von wo gezogen wird
    expect(fieldOf(html).long).toBe('Burg Graufurt 3 Armeen, Platz für 6');
  });

  it('nennt bei offenem „Ziehen“ den Grund, wenn das angetippte Feld kein Ziel ist', () => {
    const foreign = prepare({ selected: CASTLE, moving: true, tapped: TARGET });
    expect(tagOf(foreign, 'data-testid="prepare-moving"')).toContain('data-refused="FOREIGN"');
    expect(textOf(foreign)).toContain(
      'Das Feld gehört Bot (schwer). Armeen ziehen nur auf eigene Felder.',
    );
    expect(textOf(foreign)).not.toContain('Tippe ein leuchtendes Nachbarfeld an.');
    const far = prepare({ selected: CASTLE, moving: true, tapped: 5 });
    expect(tagOf(far, 'data-testid="prepare-moving"')).toContain('data-refused="TOO_FAR"');
    const free = prepare({
      view: prepView({ free: [3] }),
      selected: CASTLE,
      moving: true,
      tapped: 3,
    });
    expect(tagOf(free, 'data-testid="prepare-moving"')).toContain('data-refused="FREE"');
    const full = prepare({
      view: prepView({ armies: { [TOWN]: 6 } }),
      selected: CASTLE,
      moving: true,
      tapped: TOWN,
    });
    expect(tagOf(full, 'data-testid="prepare-moving"')).toContain('data-refused="FULL"');
    // Ein Ziel ist kein Fehler
    const fine = prepare({ selected: CASTLE, moving: true, tapped: TOWN });
    expect(tagOf(fine, 'data-testid="prepare-moving"')).not.toContain('data-refused');
  });

  it('erklärt fremde und freie Felder, statt stumm zu bleiben', () => {
    const foreign = prepare({ selected: TARGET });
    expect(fieldOf(foreign).long).toBe('Dorf Kranichsee Reich von Bot (schwer)');
    expect(tagOf(foreign, 'data-testid="prepare-foreign"')).toContain('data-near="true"');
    expect(tagOf(foreign, 'data-testid="prepare-foreign"')).toContain('data-reach="TARGET"');
    expect(textOf(part(foreign, 'data-testid="prepare-foreign"', '</p>'))).toBe(
      'In der Rüstzeit geht hier nichts. Eine deiner Armeen steht daneben: Im Feldzug danach kannst du es angreifen.',
    );
    expect(foreign).not.toContain('data-testid="prepare-acts"');
    // Tannenruh (20) liegt nicht am eigenen Land
    const far = prepare({ selected: 20 });
    expect(tagOf(far, 'data-testid="prepare-foreign"')).toContain('data-near="false"');
    expect(textOf(part(far, 'data-testid="prepare-foreign"', '</p>'))).toBe(
      'In der Rüstzeit geht hier nichts. Es grenzt nicht an dein Land, angreifen kannst du es deshalb noch nicht.',
    );
    const free = prepare({ view: prepView({ free: [3] }), selected: 3 });
    expect(fieldOf(free).long).toBe('Hirschgrund Freies Feld');
    expect(tagOf(free, 'data-testid="prepare-foreign"')).toContain('data-near="true"');
  });

  it('sagt an einem Feld an der Grenze, ob eine Armee daneben steht (ADR-064)', () => {
    // Ackerbrunn (4) grenzt an Eschenhain und Birkental: Dort steht keine meiner Armeen
    const bare = prepare({ selected: 4 });
    expect(tagOf(bare, 'data-testid="prepare-foreign"')).toContain('data-reach="NO_ARMY"');
    expect(tagOf(bare, 'data-testid="prepare-foreign"')).toContain('data-near="false"');
    expect(textOf(part(bare, 'data-testid="prepare-foreign"', '</p>'))).toBe(
      'In der Rüstzeit geht hier nichts. Daneben steht keine deiner Armeen. Zieh eine auf ein Nachbarfeld, dann kannst du es angreifen.',
    );
    // Der Entwurf zählt schon: Eine Armee zieht von Dornfeld nach Birkental
    const moved = prepare({ selected: 4, orders: [{ kind: 'MOVE', from: TOWN, to: 5, count: 1 }] });
    expect(tagOf(moved, 'data-testid="prepare-foreign"')).toContain('data-reach="TARGET"');
    expect(textOf(part(moved, 'data-testid="prepare-foreign"', '</p>'))).toContain(
      'Eine deiner Armeen steht daneben',
    );
    // Partie von vor ADR-064: Die Grenze genügt
    const old = prepare({ view: prepView({ attackNeedsArmy: null }), selected: 4 });
    expect(textOf(part(old, 'data-testid="prepare-foreign"', '</p>'))).toBe(
      'In der Rüstzeit geht hier nichts. Das Feld grenzt an dein Land: Im Feldzug danach kannst du es angreifen.',
    );
    // Nur gegen andere Reiche: Ein freies Feld an der Grenze braucht keine Armee
    const rivals = prepView({ attackNeedsArmy: 'RIVALS', free: [4] });
    expect(
      textOf(part(prepare({ view: rivals, selected: 4 }), 'data-testid="prepare-foreign"', '</p>')),
    ).toContain('Das Feld grenzt an dein Land');
  });

  it('warnt, wenn nach dem Entwurf keine Armee neben einem Ziel stünde (ADR-064)', () => {
    const warning = 'Ohne Armee an der Grenze fällt dein Angriff aus.';
    const calm = prepare();
    expect(calm).not.toContain('data-testid="prepare-no-target"');
    expect(calm).toContain('<h3>Deine Befehle</h3>');
    expect(buttonOf(calm, 'Fertig')).not.toContain('data-no-attack');
    // Armeen nur in der Burg mitten im eigenen Land
    const inland = prepView({ armies: { [TOWN]: 0, [PLAIN]: 0 } });
    const bare = prepare({ view: inland });
    // Kurz in der Zeile der Überschrift, damit das Blatt nicht wächst; der ganze Satz für Screenreader
    const note = part(bare, 'data-testid="prepare-no-target"', '</p>');
    expect(tagOf(bare, 'data-testid="prepare-no-target"')).toContain('class="orders-note"');
    expect(tagOf(bare, 'data-testid="prepare-no-target"')).toContain('role="status"');
    expect(note).toContain('<span aria-hidden="true">Keine Armee an der Grenze</span>');
    expect(note).toContain(`<span class="visually-hidden">${warning}</span>`);
    expect(bare).not.toContain('<h3>Deine Befehle</h3>');
    expect(bare).toContain('class="orders noted" data-note="NO_TARGET"');
    // Der Knopf sagt, was die Abgabe so bedeutet
    expect(buttonOf(bare, 'Fertig ohne Angriff')).toContain('data-no-attack="true"');
    // Mit Befehlen bleibt der Hinweis über ihnen stehen
    const built = prepare({ view: inland, orders: [{ kind: 'BUILD', region: PLAIN }] });
    expect(built).toContain('class="orders noted filled" data-note="NO_TARGET"');
    expect(buttonOf(built, 'Fertig ohne Angriff')).toContain('data-no-attack="true"');
    // Eine Armee an die Grenze gezogen: Die Warnung ist weg
    const moved = prepare({
      view: inland,
      orders: [{ kind: 'MOVE', from: CASTLE, to: TOWN, count: 1 }],
    });
    expect(moved).not.toContain('data-testid="prepare-no-target"');
    expect(buttonOf(moved, 'Fertig')).not.toContain('data-no-attack');
    // Nach der Abgabe steht der ganze Satz, solange sich die Befehle noch ändern lassen
    const done = prepare({ view: inland, done: true });
    expect(textOf(part(done, 'data-testid="prepare-no-target"', '</p>'))).toBe(warning);
    expect(tagOf(done, 'data-testid="prepare-no-target"')).toContain('class="blatt-note warn"');
    // Ohne den Regelwert fällt kein Angriff aus
    const old = prepare({
      view: prepView({ armies: { [TOWN]: 0, [PLAIN]: 0 }, attackNeedsArmy: null }),
    });
    expect(old).not.toContain('data-testid="prepare-no-target"');
    expect(buttonOf(old, 'Fertig')).not.toContain('data-no-attack');
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

  it('rückt viele Befehle zusammen: eine Zeile, Bauten nur noch als Zeichen', () => {
    const three: RealmOrderDto[] = [
      { kind: 'BUILD', region: PLAIN },
      { kind: 'BUILD', region: 0 },
      { kind: 'RECRUIT', region: CASTLE, count: 1 },
    ];
    const view = prepView({ stock: { [ME]: { bread: 30, material: 40 } } });
    expect(prepare({ view, orders: three })).not.toContain('class="dense"');
    const four = prepare({
      view,
      orders: [...three, { kind: 'MOVE', from: CASTLE, to: TOWN, count: 1 }],
    });
    expect(four).toContain('class="dense"');
    expect(count(part(four, 'data-testid="prepare-orders"', '</ul>'), '<li')).toBe(4);
  });

  it('meldet, wenn mit einem Befehl ein späterer herausfiel', () => {
    expect(prepare()).not.toContain('orders-note');
    const html = prepare({ dropped: true });
    // Kurz in der Zeile der Überschrift; der ganze Satz für Screenreader
    const note = part(html, 'data-testid="prepare-dropped"', '</p>');
    expect(note).toContain('<span aria-hidden="true">Folgebefehl mit entfernt</span>');
    expect(textOf(note)).toContain('Ohne diesen Befehl ging ein späterer nicht mehr.');
    // Die Art des Hinweises steht am Block: Bei geringer Höhe teilt sich nur dieser die Zeile mit
    // den übrigen Befehlen (erst der Hinweis, dann die Befehle), die Warnung trägt dort der Knopf
    expect(html).toContain('class="orders noted" data-note="DROPPED"');
    expect(prepare({ dropped: true, orders: [{ kind: 'BUILD', region: PLAIN }] })).toContain(
      'class="orders noted filled" data-note="DROPPED"',
    );
    expect(prepare()).not.toContain('data-note=');
    // Dieser Hinweis geht vor: Die Warnung zum Angriff steht dann nur am Knopf
    const both = prepare({
      view: prepView({ armies: { [TOWN]: 0, [PLAIN]: 0 } }),
      dropped: true,
    });
    expect(both).toContain('data-testid="prepare-dropped"');
    expect(both).not.toContain('data-testid="prepare-no-target"');
    expect(buttonOf(both, 'Fertig ohne Angriff')).toContain('data-no-attack="true"');
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
    const moving = prepare({ selected: CASTLE, moving: true, busy: true });
    expect(count(moving, '<button')).toBe(count(moving, 'disabled=""'));
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
    readonly catching?: boolean;
    readonly target?: number | null;
    readonly refusedTarget?: number | null;
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
        catching: extra.catching ?? false,
        error: null,
        name: seatNames(view),
        region: regionNames(play.map),
        target: extra.target ?? null,
        refusedTarget: extra.refusedTarget ?? null,
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
    expect(textOf(html)).toContain(
      'Markiert ist, was neben einer deiner Armeen liegt, auch freie Felder.',
    );
    expect(html).not.toContain('data-testid="match-target"');
    expect(html).not.toContain('data-testid="match-target-refused"');
    expect(count(html, '<button')).toBe(0);
    // Die Regeln der Partie bestimmen den Satz
    const withNeed = (need: 'RIVALS' | null) => {
      const view = targetView(ME);
      const realm = view.realm;
      if (!realm) throw new Error('Ansicht ohne Ausbau');
      const { attackNeedsArmy, ...economy } = realm.economy;
      void attackNeedsArmy;
      return {
        ...view,
        realm: {
          ...realm,
          economy: need === null ? economy : { ...economy, attackNeedsArmy: need },
        },
      };
    };
    expect(textOf(blatt(withNeed(null), 'pick'))).toContain(
      'Tippe ein markiertes Feld an, auch ein freies.',
    );
    expect(textOf(blatt(withNeed('RIVALS'), 'pick'))).toContain(
      'Markiert sind freie Felder an deinem Land und fremde Felder neben einer deiner Armeen.',
    );
  });

  it('sagt zu einem angetippten Feld, das kein Ziel ist, warum nicht (ADR-064)', () => {
    const view = targetView(ME, [11, 12, 13]);
    const bare = blatt(view, 'pick', { refusedTarget: 4 });
    expect(tagOf(bare, 'data-testid="match-target-refused"')).toContain('data-reach="NO_ARMY"');
    expect(textOf(part(bare, 'data-testid="match-target-refused"', '</p>'))).toBe(
      'Kein Ziel: Neben Ackerbrunn steht keine deiner Armeen.',
    );
    expect(count(bare, '<button')).toBe(0);
    const far = blatt(view, 'pick', { refusedTarget: 20 });
    expect(textOf(part(far, 'data-testid="match-target-refused"', '</p>'))).toBe(
      'Kein Ziel: Tannenruh grenzt nicht an dein Land.',
    );
    // Ein gewähltes Ziel verdrängt den Satz
    expect(blatt(view, 'pick', { target: TARGET })).not.toContain(
      'data-testid="match-target-refused"',
    );
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

  it('zeigt ein freies Feld als Ziel: nur die eigenen und die freien Lose, niemand verteidigt', () => {
    const view = realmViewOf(
      {
        ...FREE_BOARD,
        step: { kind: 'CAMPAIGN_TARGET', round: 2, chooser: ME, attacker: ME },
        turns: MY_ATTACK,
      },
      { phase: phaseOf('PICK'), legalRegions: [FREE, 9, 12, 13, 18] },
    );
    const html = blatt(view, 'pick', { target: FREE });
    const target = part(html, 'data-testid="match-target"', '</div>');
    expect(target).toContain('data-region="4"');
    expect(target).toContain('data-free=""');
    expect(textOf(target)).toBe('Ackerbrunn Freies Feld, niemand verteidigt es');
    const lots = part(html, 'data-testid="match-lots"', '</ul>');
    expect(count(lots, '<li')).toBe(2);
    expect(textOf(lots)).toMatch(/Du 2 .*frei 2/);
    expect(textOf(html)).toContain(
      'Nur du wirst gefragt. Richtig: Das Feld gehört dir. Falsch: Es bleibt frei, und du verlierst nichts.',
    );
    expect(buttonOf(html, 'Angreifen')).not.toContain('disabled');
    // Ein Ziel mit Besitzer trägt die Markierung nicht
    expect(blatt(targetView(ME), 'pick', { target: TARGET })).not.toContain('data-free');
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
    expect(html).not.toContain('data-testid="orders-skipped"');
  });

  it('nennt beim Aufdecken, wessen Angriff ausfällt (ADR-064)', () => {
    const skipped = (seq: number, attacker: number) =>
      event(seq, 'ATTACK_SKIPPED', { round: 2, attacker });
    // Ich setze aus, der Nächste ist schon dran
    const view = realmViewOf(
      { step: { kind: 'CAMPAIGN_TARGET', round: 2, chooser: 0, attacker: 0 }, turns: THEIR_ATTACK },
      { phase: phaseOf('ANNOUNCE') },
    );
    const rows = [revealed(ME, 41, []), revealed(0, 42, []), revealed(1, 43, [])];
    const one = blatt(view, 'orders', { events: [...rows, skipped(44, ME)] });
    expect(textOf(one)).toContain(
      'Gleich greift ihr der Reihe nach an: Bot (leicht), Bot (schwer).',
    );
    expect(textOf(part(one, 'data-testid="orders-skipped"', '</p>'))).toBe(
      'Kein Angriff, weil keine Armee neben einem Ziel steht: Du.',
    );
    // Alle setzen aus: Der Schritt ist schon die Rüstzeit der nächsten Runde
    const next = realmViewOf(
      { step: { kind: 'PREPARE', round: 3 }, turns: PREP_TURNS },
      { phase: phaseOf('ANNOUNCE') },
    );
    const all = blatt(next, 'orders', {
      events: [
        ...rows,
        skipped(44, ME),
        skipped(45, 0),
        skipped(46, 1),
        event(47, 'INCOME', { round: 3, income: [{ seat: 2, bread: 4, material: 5 }] }),
      ],
    });
    expect(count(all, 'class="aufdeck-row')).toBe(3);
    expect(textOf(all)).toContain('In dieser Runde greift niemand an.');
    expect(textOf(all)).not.toContain('Gleich greift ihr');
    expect(textOf(part(all, 'data-testid="orders-skipped"', '</p>'))).toBe(
      'Kein Angriff, weil keine Armee neben einem Ziel steht: Du, Bot (leicht), Bot (schwer).',
    );
  });

  it('nennt im Aufmarsch vor dem Glücksrad, wer wen wo angreift (ADR-071)', () => {
    // Das Ziel steht, das Rad ist noch nicht gedreht: Schritt DUEL_WHEEL ohne Kategorie
    const march = (attacker: number, mySeat: number | null = ME) => {
      const view = duelView('ANNOUNCE', 'DUEL_TRIVIA', attacker);
      const step = { ...playOf(view).board.step, kind: 'DUEL_WHEEL' as const, category: null };
      return realmViewOf(
        { step, turns: attacker === ME ? MY_ATTACK : THEIR_ATTACK },
        { phase: phaseOf('ANNOUNCE'), mySeat },
      );
    };
    const mine = blatt(march(ME), 'announce');
    expect(mine).toContain('data-testid="match-announce"');
    expect(mine).toContain('class="blatt turn"');
    expect(textOf(mine)).toContain('Dein Angriff');
    expect(textOf(part(mine, 'data-testid="match-duel"', '</div>'))).toContain(
      'Angriff auf das Dorf Kranichsee',
    );
    expect(textOf(mine)).toContain('Gleich dreht sich das Glücksrad.');
    // Die Lose und das Rad kommen erst danach
    expect(textOf(mine)).not.toContain('Lose im Rad');
    expect(mine).not.toContain('data-testid="match-wheel"');
    // Wer angegriffen wird, liest es in seiner Farbe; wer zuschaut, ohne
    const attacked = blatt(march(0, 1), 'announce');
    expect(attacked).toContain('class="blatt attacked"');
    expect(textOf(attacked)).toContain('Du wirst angegriffen');
    const watching = blatt(march(0), 'announce');
    expect(watching).toContain('class="blatt"');
    expect(textOf(watching)).toContain('Duell');
    // Die Namen im Kasten sind nur Bild: Vorleseprogramme bekommen den ganzen Satz
    for (const html of [mine, attacked, watching]) {
      const box = part(html, 'data-testid="match-duel"', '</div>');
      expect(textOf(part(box, 'class="visually-hidden"', '</p>'))).toMatch(
        /^Duell um Kranichsee: .+ greift .+ an\.$/,
      );
    }
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
    // Ohne Flug vom Rad her steht das Zeichen der Kategorie sofort da
    expect(result).toContain('class="wheel-result"');
  });

  it('hält am Glücksrad das Zeichen der Kategorie zurück, bis es vom Rad her ankommt (ADR-067)', () => {
    const html = blatt(duelView('ANNOUNCE', 'DUEL_TRIVIA', ME), 'wheel', { catching: true });
    expect(tagOf(html, 'data-testid="wheel-result"')).toContain('class="wheel-result catching"');
  });

  it('färbt das Blatt am Glücksrad für den Angegriffenen', () => {
    const view = duelView('ANNOUNCE', 'DUEL_TRIVIA', 0);
    const attacked = { ...view, mySeat: 1 };
    expect(blatt(attacked, 'wheel')).toContain('class="blatt attacked"');
    // Als Zuschauer ohne Farbe
    expect(blatt(view, 'wheel')).toContain('class="blatt"');
  });

  describe('Angriff auf ein freies Feld (O-37)', () => {
    it('zeigt am Glücksrad nur den Angreifer und sagt, dass er allein gefragt wird', () => {
      const html = blatt(claimView('ANNOUNCE', ME), 'wheel');
      expect(html).toContain('class="blatt turn"');
      const box = part(html, 'data-testid="match-duel"', '</div>');
      expect(textOf(box)).toContain('Du freies Feld');
      expect(textOf(box)).toContain('Angriff auf das freie Feld Ackerbrunn');
      const lots = part(html, 'data-testid="match-lots"', '</ul>');
      expect(count(lots, '<li')).toBe(2);
      expect(textOf(lots)).toMatch(/Du 2 .*frei 2/);
      expect(textOf(html)).toContain('Freies Feld: Nur der Angreifer wird gefragt.');
      expect(textOf(part(html, 'data-testid="wheel-result"', '</p>'))).toBe('Geschichte liegt dir');
      expect(
        textOf(
          part(
            blatt(claimView('ANNOUNCE', ME, 'SPORTS'), 'wheel'),
            'data-testid="wheel-result"',
            '</p>',
          ),
        ),
      ).toBe('Sport keine deiner Lieblingskategorien');
    });

    it('färbt das Blatt für niemanden als angegriffen, auch nicht für Zuschauer ohne Sitz', () => {
      const view = claimView('ANNOUNCE', 0);
      expect(blatt(view, 'wheel')).toContain('class="blatt"');
      expect(blatt({ ...view, mySeat: null }, 'wheel')).toContain('class="blatt"');
      expect(textOf(part(blatt(view, 'wheel'), 'data-testid="wheel-result"', '</p>'))).toBe(
        'Geschichte liegt Bot (leicht)',
      );
    });

    it('fragt nur den Angreifer und sagt ihm die Regel', () => {
      const view = claimView('QUESTION', ME, 'HISTORY', {
        question: info('TRIVIA', 'DUEL_TRIVIA', 'PRESENTED', [ME], []),
      });
      const html = blatt(view, 'question', { local: localOf(TRIVIA) });
      expect(html).toContain('class="blatt turn"');
      expect(textOf(html)).toContain('Dein Angriff');
      expect(textOf(html)).toContain('um das freie Feld Ackerbrunn');
      const answers = part(html, 'data-testid="match-answers"', '</ul>');
      expect(count(answers, '<li')).toBe(1);
      expect(textOf(answers)).toContain('Du überlegst');
      expect(textOf(html)).toContain(
        'Richtig: Das Feld gehört dir. Falsch: Es bleibt frei, und du verlierst nichts.',
      );
      expect(textOf(html)).not.toContain('Verteidiger');
    });

    it('lässt den Angreifer nach der Antwort nicht auf andere warten', () => {
      const view = claimView('QUESTION', ME, 'HISTORY', {
        question: info('TRIVIA', 'DUEL_TRIVIA', 'ANSWERED', [ME], [ME]),
      });
      const html = blatt(view, 'answered', {
        local: localOf(TRIVIA, 'ANSWERED', { optionToken: 'b' }),
      });
      expect(textOf(html)).toContain(
        'Deine Antwort ist gespeichert. Gleich siehst du, ob das Feld dir gehört.',
      );
      expect(textOf(html)).not.toContain('Warte auf die anderen');
      // Im Duell gegen ein Reich bleibt es beim Warten auf den Gegner
      const duel = blatt(
        duelView('QUESTION', 'DUEL_TRIVIA', ME, {
          question: info('TRIVIA', 'DUEL_TRIVIA', 'ANSWERED', [ME, 1], [ME]),
        }),
        'answered',
        { local: localOf(TRIVIA, 'ANSWERED', { optionToken: 'b' }) },
      );
      expect(textOf(duel)).toContain('Warte auf die anderen');
    });

    it('zeigt den anderen, wer das freie Feld angreift', () => {
      const view = claimView('QUESTION', 0, 'HISTORY', {
        question: info('TRIVIA', 'DUEL_TRIVIA', 'NOT_PARTICIPATING', [0], []),
      });
      const html = blatt(view, 'spectating');
      expect(html).toContain('class="blatt"');
      expect(textOf(html)).toContain('Angriff auf ein freies Feld');
      expect(textOf(html)).toContain('Du schaust zu.');
      const answers = part(html, 'data-testid="match-answers"', '</ul>');
      expect(count(answers, '<li')).toBe(1);
      expect(textOf(answers)).toContain('Bot (leicht) überlegt');
    });

    const after = (mySeat: number | null = ME): MatchView => ({
      ...realmViewOf(
        {
          ...FREE_BOARD,
          step: { kind: 'CAMPAIGN_TARGET', round: 2, chooser: 0, attacker: 0 },
          turns: THEIR_ATTACK,
        },
        { phase: phaseOf('REVEAL') },
      ),
      mySeat,
    });
    const claimed = (partial: Record<string, unknown> = {}) =>
      realmDuel({
        defender: null,
        region: FREE,
        effect: 'CLAIMED',
        armyLost: null,
        ...partial,
      });

    it('sagt dem Angreifer, dass das Feld jetzt ihm gehört', () => {
      const html = blatt(after(), 'reveal', { outcome: claimed() });
      expect(html).toContain('data-effect="CLAIMED"');
      expect(html).toContain('class="blatt outcome seat-2"');
      expect(textOf(html)).toContain('Feld genommen');
      expect(textOf(html)).toContain('Richtig: Ackerbrunn gehört jetzt dir.');
      expect(textOf(part(html, 'class="outcome-list"', '</ul>'))).toBe(
        'Das Feld gehört jetzt dir Es ist 100 Punkte wert und bringt ab jetzt Ertrag',
      );
      expect(textOf(part(html, 'class="next"', '</div>'))).toBe(
        'Als Nächstes Bot (leicht) greift an',
      );
    });

    it('sagt nach einer falschen Antwort, dass das Feld frei bleibt und nichts verloren geht', () => {
      const html = blatt(after(), 'reveal', {
        outcome: claimed({ winner: 'NONE', effect: 'UNCLAIMED' }),
      });
      expect(html).toContain('data-effect="UNCLAIMED"');
      // Niemand gewinnt: Das Blatt trägt keine Farbe eines Reichs
      expect(html).toContain('class="blatt outcome outcome-none"');
      expect(textOf(html)).toContain('Das Feld bleibt frei');
      expect(textOf(html)).toContain('Deine Antwort war nicht richtig: Ackerbrunn bleibt frei.');
      expect(textOf(part(html, 'class="outcome-list"', '</ul>'))).toBe('Keine Armee geht verloren');
      expect(textOf(html)).not.toContain('verlierst');
    });

    it('erzählt den anderen den Ausgang mit Namen, auch Zuschauern ohne Sitz', () => {
      const other = claimed({ attacker: 0 });
      const html = blatt(after(), 'reveal', { outcome: other });
      expect(html).toContain('class="blatt outcome seat-0"');
      expect(textOf(html)).toContain('Bot (leicht) nimmt ein Feld');
      expect(textOf(html)).toContain('Bot (leicht) lag richtig und nimmt Ackerbrunn.');
      expect(textOf(part(html, 'class="outcome-list"', '</ul>'))).toContain(
        'Das Feld gehört jetzt Bot (leicht)',
      );
      const missed = blatt(after(null), 'reveal', {
        outcome: claimed({ attacker: 0, winner: 'NONE', effect: 'UNCLAIMED' }),
      });
      expect(missed).toContain('class="blatt outcome outcome-none"');
      expect(textOf(missed)).toContain('Bot (leicht) lag nicht richtig: Ackerbrunn bleibt frei.');
    });
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
  interface LobbyExtra {
    readonly busy?: boolean;
    readonly error?: unknown;
    /** Eigene Wahl im Browser, bevor der Server sie hat. */
    readonly initial?: RealmLobbyInitial;
  }
  function lobby(view: MatchView, extra: LobbyExtra = {}): string {
    return renderToStaticMarkup(
      createElement(RealmLobby, {
        view,
        busy: extra.busy ?? false,
        error: extra.error ?? null,
        onStart: noop,
        onLeave: noop,
        onSetBot: noop,
        onSetFavorites: accept,
        onHelp: noop,
        initial: extra.initial,
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

  describe('eigene Wahl, die der Server noch nicht hat', () => {
    const FOUR: readonly QuestionCategory[] = [
      'HISTORY',
      'LITERATURE',
      'ARTS_CULTURE',
      'NATURE_ANIMALS',
    ];
    const mine = (html: string) => textOf(html.split('data-testid="fav-seat"')[1] ?? '');

    it('steht als „wird gespeichert“ da, solange sie unterwegs ist', () => {
      const html = lobby(lobbyView(null), { initial: { chosen: FOUR }, busy: true });
      expect(mine(html)).toContain('Anna (du) wird gespeichert …');
      expect(textOf(html)).not.toContain('Anna (du) 4 gewählt');
      // Grün wird die Zahl erst mit der Bestätigung
      expect(tagOf(html, 'data-testid="fav-count"')).not.toContain('full');
      expect(html).not.toContain('data-testid="fav-retry"');
      // Auch nach der Antwort des Servers, bis die Ansicht die Wahl zeigt
      const sent = lobby(lobbyView(null), { initial: { chosen: FOUR } });
      expect(mine(sent)).toContain('Anna (du) wird gespeichert …');
    });

    it('sagt, wenn das Speichern scheiterte, und bietet an, es noch einmal zu versuchen', () => {
      const html = lobby(lobbyView(null), {
        initial: { chosen: FOUR, failed: true },
        error: new Error('Netz'),
      });
      expect(mine(html)).toContain('Anna (du) nicht gespeichert');
      expect(textOf(html)).not.toContain('Anna (du) 4 gewählt');
      const failed = part(html, 'data-testid="fav-failed"', '</div>');
      expect(failed).toContain('role="alert"');
      expect(textOf(failed)).toBe(
        'Deine Wahl ist noch nicht gespeichert. Etwas ist schiefgelaufen. Bitte versuche es erneut. Erneut speichern',
      );
      expect(buttonOf(html, 'Erneut speichern')).toContain('data-testid="fav-retry"');
      expect(buttonOf(html, 'Erneut speichern')).not.toContain('disabled');
      // Der Fehler steht einmal da, an der Stelle des Hinweises
      expect(count(html, 'role="alert"')).toBe(1);
      expect(html).not.toContain('class="fav-note"');
    });

    it('bleibt ungespeichert, auch wenn die Fehlermeldung inzwischen weg ist', () => {
      // Eine andere Aktion (etwa ein Bot auf dem zweiten Blatt) räumt die Meldung ab
      const html = lobby(lobbyView(null), { initial: { chosen: FOUR, failed: true } });
      expect(mine(html)).toContain('Anna (du) nicht gespeichert');
      expect(textOf(part(html, 'data-testid="fav-failed"', '</div>'))).toBe(
        'Deine Wahl ist noch nicht gespeichert. Erneut speichern',
      );
    });

    it('gilt auch als ungespeichert, wenn der Server noch eine ältere Wahl hat', () => {
      const older = lobbyView(['HISTORY', 'LITERATURE', 'ARTS_CULTURE', 'SPORTS']);
      const html = lobby(older, { initial: { chosen: FOUR, failed: true } });
      expect(mine(html)).toContain('nicht gespeichert');
      expect(html).toContain('data-testid="fav-retry"');
    });

    it('hält einen Fehler aus anderem Grund nicht für ein gescheitertes Speichern', () => {
      const saved = lobby(lobbyView(FOUR), { error: new Error('Start') });
      expect(mine(saved)).toContain('Anna (du) 4 gewählt');
      expect(saved).not.toContain('data-testid="fav-failed"');
      expect(count(saved, 'role="alert"')).toBe(1);
      expect(saved).toContain('class="fav-note"');
      // Auch nicht, solange die eigene Wahl unterwegs ist
      const underway = lobby(lobbyView(null), {
        initial: { chosen: FOUR },
        error: new Error('Start'),
      });
      expect(mine(underway)).toContain('wird gespeichert …');
      expect(underway).not.toContain('data-testid="fav-failed"');
      expect(count(underway, 'role="alert"')).toBe(1);
      // Unvollständig ist nichts zu speichern
      const partly = lobby(lobbyView(['HISTORY']), { error: new Error('Start') });
      expect(mine(partly)).toContain('noch 3 wählen');
      expect(partly).not.toContain('data-testid="fav-retry"');
    });
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

  it('nennt das Ziel in einem Satz und bietet „So geht’s“ an', () => {
    const html = lobby(lobbyView(null));
    const foot = part(html, 'class="fav-foot"', '</div>');
    expect(textOf(part(foot, '<strong', '</strong>'))).toBe(
      'Ziel: nach 5 Runden die meisten Punkte. Punkte bringt nur Land.',
    );
    expect(buttonOf(foot, 'So geht’s')).toContain('data-testid="lobby-help"');
    expect(buttonOf(foot, 'So geht’s')).not.toContain('disabled');
    // Scheitert das Speichern, steht an dieser Stelle die Meldung dazu
    const failed = lobby(lobbyView(null), {
      initial: { chosen: ['HISTORY', 'LITERATURE', 'ARTS_CULTURE', 'SPORTS'], failed: true },
    });
    expect(failed).not.toContain('data-testid="lobby-help"');
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
    readonly watched?: WatchedQuestion | null;
    readonly initial?: RealmStageInitial;
    readonly estimate?: string;
  }

  function stage(view: MatchView | null, extra: StageExtra = {}): string {
    return renderToStaticMarkup(
      createElement(RealmStage, {
        view,
        events: extra.events ?? [],
        local: extra.local ?? null,
        watched: extra.watched ?? null,
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
        onSetFavorites: accept,
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

  it('beim Angriff antwortet auch ein Feld, das kein Ziel ist (ADR-064)', () => {
    const view = targetView(ME, [11, 12, 13]);
    const html = stage(view, { initial: { target: 4 } });
    expect(html).not.toContain('data-testid="match-target"');
    expect(tagOf(html, 'data-testid="match-target-refused"')).toContain('data-reach="NO_ARMY"');
    expect(textOf(html)).toContain('Kein Ziel: Neben Ackerbrunn steht keine deiner Armeen.');
    // Fremde und freie Felder lassen sich antippen, eigene nicht; markiert sind nur die Ziele
    expect(tagOf(html, 'data-region="4"')).toContain('role="button"');
    expect(tagOf(html, 'data-region="4"')).not.toContain('legal');
    expect(tagOf(html, 'data-region="12"')).toContain('legal');
    expect(tagOf(html, 'data-region="6"')).toContain('role="img"');
    // Wer nicht dran ist, tippt nichts an
    expect(tagOf(stage(targetView(0)), 'data-region="4"')).toContain('role="img"');
  });

  it('zeigt in der Zugfolge, wessen Angriff ausfiel (ADR-064)', () => {
    const skipped = (round: number) => [event(44, 'ATTACK_SKIPPED', { round, attacker: ME })];
    const turnsOf = (html: string) => part(html, 'data-testid="match-turns"', '</section>');
    const turns = turnsOf(stage(targetView(0), { events: skipped(2) }));
    expect(tagOf(turns, 'data-seat="2"')).toContain('data-skipped="true"');
    expect(tagOf(turns, 'data-seat="2"')).toContain('turn-skipped');
    const mine = textOf(part(turns, 'data-seat="2"', '</li>'));
    expect(mine).toContain('–');
    expect(mine).toContain('Du, setzt aus');
    expect(turns).not.toContain('✓');
    expect(tagOf(turns, 'data-seat="0"')).not.toContain('data-skipped');
    // Ein Ausfall aus einer früheren Runde zählt nicht mehr: Ich war in dieser Runde dran
    const earlier = turnsOf(stage(targetView(0), { events: skipped(1) }));
    expect(earlier).not.toContain('data-skipped');
    expect(textOf(part(earlier, 'data-seat="2"', '</li>'))).toContain('✓');
  });

  it('fielen alle Angriffe aus, zeigt das Aufdecken noch die aufgedeckte Runde (ADR-064)', () => {
    // Der Server ist schon in der Rüstzeit der dritten Runde, die Ansage zeigt die zweite
    const view = realmViewOf(
      { step: { kind: 'PREPARE', round: 3 } },
      { phase: { kind: 'ANNOUNCE', deadline: AT, remainingMs: 2000 } },
    );
    const html = stage(view, {
      events: [
        event(40, 'ORDERS_REVEALED', {
          round: 2,
          seat: ME,
          orders: [],
          summary: { built: [], recruited: 0, moved: 0, traded: 0 },
          bread: 3,
          material: 4,
        }),
        event(41, 'ATTACK_SKIPPED', { round: 2, attacker: ME }),
        event(42, 'ATTACK_SKIPPED', { round: 2, attacker: 0 }),
        event(43, 'ATTACK_SKIPPED', { round: 2, attacker: 1 }),
        event(44, 'INCOME', { round: 3, income: [] }),
      ],
    });
    expect(main(html)).toContain('data-state="orders"');
    expect(textOf(part(html, 'data-testid="match-step"', '</p>'))).toBe('Runde 2 von 5');
    expect(part(html, 'data-testid="match-flow"', '</ol>')).toContain(
      '<li class="now" aria-current="step"><span>Aufdecken</span></li>',
    );
    expect(textOf(html)).toContain('In dieser Runde greift niemand an.');
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

  it('dreht das Glücksrad auch für ein freies Feld, ohne Anteile eines Verteidigers', () => {
    const html = stage(claimView('ANNOUNCE', ME), {
      events: [
        event(28, 'WHEEL_SPUN', { round: 2, region: FREE, category: 'HISTORY', exhausted: [] }),
      ],
    });
    expect(main(html)).toContain('data-state="wheel"');
    const disc = part(html, 'data-testid="match-wheel-disc"', '</svg>');
    expect(count(disc, 'class="wheel-seg"')).toBe(11);
    // Nur meine vier Lieblingskategorien tragen Farbe
    expect(count(disc, 'class="seg-side"')).toBe(4);
    expect(disc).not.toContain('var(--seat-null)');
    expect(html).not.toContain('var(--seat-null)');
    // Auf der Karte steht nur das Wappen des Angreifers
    expect(count(html, 'duel-token attacker')).toBe(1);
    expect(count(html, 'duel-token defender')).toBe(0);
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

  it('legt die Frage anderer zum Mitlesen auf die Karte, ohne etwas zum Antippen (ADR-065)', () => {
    const view = duelView('QUESTION', 'DUEL_TRIVIA', 0, {
      question: info('TRIVIA', 'DUEL_TRIVIA', 'NOT_PARTICIPATING', [0, 1], [0]),
    });
    const watched = { seq: 12, question: TRIVIA, deadline: 9000 };
    const html = stage(view, { watched });
    expect(main(html)).toContain('data-state="spectating"');
    const card = part(html, 'data-testid="match-question-watched"', '</section>');
    expect(textOf(card)).toContain('Geschichte');
    expect(textOf(card)).toContain('Du schaust zu');
    expect(textOf(card)).toContain('In welchem Jahr fiel die Berliner Mauer?');
    expect(count(card, 'class="option-read"')).toBe(4);
    expect(count(card, '<button')).toBe(0);
    expect(html).not.toContain('data-testid="match-question"');
    // Das Blatt rechts nennt weiter nur, wer schon geantwortet hat, nie was
    const waiting = part(html, 'data-testid="match-waiting"', '</section>');
    expect(textOf(waiting)).toContain('Bot (leicht) ✓ hat geantwortet');
    expect(textOf(waiting)).toContain('Wer was gewählt hat, zeigt die Auflösung.');

    // Ohne mitgelesene Frage, bei gescheitertem Mitlesen oder für eine andere Frage: nur das Blatt
    const plain = stage(view);
    expect(plain).not.toContain('match-question-watched');
    expect(textOf(plain)).toContain('Du schaust zu. Gleich geht es weiter.');
    expect(stage(view, { watched: { ...watched, question: null } })).not.toContain(
      'match-question-watched',
    );
    expect(stage(view, { watched: { ...watched, seq: 11 } })).not.toContain(
      'match-question-watched',
    );
    // Wer selbst gefragt ist, sieht seine eigene Karte, nie die zum Mitlesen
    const mine = duelView('QUESTION', 'DUEL_TRIVIA', ME, {
      question: info('TRIVIA', 'DUEL_TRIVIA', 'PRESENTED', [ME, 1], []),
    });
    const asked = stage(mine, { local: localOf(TRIVIA), watched });
    expect(asked).toContain('data-testid="match-question"');
    expect(asked).not.toContain('match-question-watched');
  });

  describe('Ablaufzeile unter dem Band', () => {
    const flow = (html: string) => part(html, 'data-testid="match-flow"', '</ol>');
    const steps = (html: string) =>
      flow(html)
        .split('<li')
        .slice(1)
        .map((li) => ({ text: textOf(`<li${li}`), tag: li.slice(0, li.indexOf('>')) }));

    it('nennt in der Rüstzeit die drei Schritte der Runde und hebt „Rüsten“ hervor', () => {
      const html = stage(prepView());
      expect(tagOf(html, 'data-testid="match-flow"')).toContain('aria-label="Ablauf"');
      expect(steps(html).map((s) => s.text)).toEqual(['Rüsten', 'Aufdecken', 'Angriffe']);
      expect(steps(html)[0]?.tag).toContain('class="now"');
      expect(steps(html)[0]?.tag).toContain('aria-current="step"');
      expect(count(flow(html), 'aria-current')).toBe(1);
      expect(flow(html)).not.toContain('class="done"');
    });

    it('rückt beim Angriff weiter: Was vorbei ist, gilt als erledigt', () => {
      const html = stage(targetView(ME));
      const tags = steps(html).map((s) => s.tag);
      expect(tags[0]).toContain('class="done"');
      expect(tags[1]).toContain('class="done"');
      expect(tags[2]).toContain('class="now"');
      expect(tags[2]).toContain('aria-current="step"');
      // Auch während der Frage eines Duells bleibt die Zeile stehen
      const asked = stage(
        duelView('QUESTION', 'DUEL_TRIVIA', ME, {
          question: info('TRIVIA', 'DUEL_TRIVIA', 'PRESENTED', [ME, 1], []),
        }),
        { local: localOf(TRIVIA) },
      );
      expect(steps(asked).map((s) => s.text)).toEqual(['Rüsten', 'Aufdecken', 'Angriffe']);
      expect(steps(asked)[2]?.tag).toContain('class="now"');
    });

    it('fehlt vor dem Start und in der Abrechnung', () => {
      expect(stage(lobbyView(null))).not.toContain('data-testid="match-flow"');
      const view = realmViewOf({ step: { kind: 'FINISHED', round: null } }, { phase: null });
      const done = stage({ ...view, match: { ...view.match, status: 'FINISHED' } });
      expect(done).not.toContain('data-testid="match-flow"');
    });
  });

  describe('„So geht’s“', () => {
    const asking = () =>
      duelView('QUESTION', 'DUEL_TRIVIA', ME, {
        question: info('TRIVIA', 'DUEL_TRIVIA', 'PRESENTED', [ME, 1], []),
      });

    it('liegt hinter „?“ neben Ton und Verlassen und ist zu, bis man es öffnet', () => {
      const html = stage(prepView());
      const tools = part(html, 'class="stage-tools three"', '</div>');
      expect(count(tools, '<button')).toBe(3);
      const open = tagOf(tools, 'data-testid="match-help-open"');
      expect(open).toContain('aria-label="So geht’s"');
      expect(open).not.toContain('disabled');
      expect(html).not.toContain('data-testid="match-help"');
    });

    it('erklärt Ziel, Rüsten, Angreifen und Duell mit den Zahlen der Partie', () => {
      const html = stage(prepView(), { initial: { help: true } });
      const sheet = part(html, 'data-testid="match-help"');
      expect(tagOf(html, 'data-testid="match-help"')).toContain('role="dialog"');
      expect(tagOf(html, 'data-testid="match-help"')).toContain('aria-modal="true"');
      expect(count(sheet, 'class="help-card"')).toBe(4);
      const titles = sheet
        .split('<h3>')
        .slice(1)
        .map((h) => textOf(h.slice(0, h.indexOf('</h3>'))));
      expect(titles).toEqual(['1 Das Ziel', '2 Rüsten', '3 Angreifen', '4 Das Duell']);
      const text = textOf(sheet);
      expect(text).toContain(
        'Wer nach 5 Runden die meisten Punkte hat, gewinnt. Punkte bringt nur Land: jedes Feld 100, deine erste Burg 300.',
      );
      expect(text).toContain('Alle planen zugleich und verdeckt.');
      expect(text).toContain(
        'Dann greift jedes Reich ein Feld neben einer eigenen Armee an; ohne Armee an der Grenze fällt sein Angriff aus.',
      );
      expect(text).toContain('Mehr Armeen am Ziel bringen eher eine deiner liebsten.');
      expect(text).toContain('eine Burg hat 3 Leben.');
      // Partie von vor ADR-064: Die Grenze genügt
      const old = textOf(
        part(
          stage(prepView({ attackNeedsArmy: null }), { initial: { help: true } }),
          'data-testid="match-help"',
        ),
      );
      expect(old).toContain('Dann greift jedes Reich ein Feld an seinem Land an.');
      expect(old).not.toContain('fällt sein Angriff aus');
      expect(buttonOf(sheet, 'Alles klar')).toContain('data-testid="match-help-close"');
      // Die Bühne darunter bleibt, wie sie ist
      expect(main(html)).toContain('data-state="prepare"');
      expect(html).toContain('data-testid="match-prepare"');
    });

    it('lässt sich auch vor dem Start öffnen', () => {
      const html = stage(lobbyView(null), { initial: { help: true } });
      expect(main(html)).toContain('data-state="lobby"');
      expect(count(part(html, 'data-testid="match-help"'), 'class="help-card"')).toBe(4);
    });

    it('bleibt während einer Frage zu, und „?“ ist gesperrt', () => {
      const html = stage(asking(), { local: localOf(TRIVIA), initial: { help: true } });
      expect(main(html)).toContain('data-state="question"');
      expect(html).not.toContain('data-testid="match-help"');
      expect(tagOf(html, 'data-testid="match-help-open"')).toContain('disabled');
      expect(html).toContain('data-testid="match-question"');
    });
  });

  describe('Rüstzeit auf der Karte', () => {
    const hints = (html: string) => count(html, 'class="plan-hint"');
    const targets = (html: string) => count(html, 'class="plan-target"');

    it('lässt zu Beginn die eigenen Felder aufleuchten, bis eines gewählt ist', () => {
      // Acht Felder gehören mir (0, 1, 2, 3, 5, 6, 7, 8)
      expect(hints(stage(prepView()))).toBe(8);
      expect(hints(stage(prepView(), { initial: { selected: PLAIN } }))).toBe(0);
      expect(hints(stage(prepView(), { initial: { trading: true } }))).toBe(0);
      // Nach der Abgabe und außerhalb der Rüstzeit leuchtet nichts
      expect(hints(stage(prepView({ myOrders: [] })))).toBe(0);
      expect(hints(stage(targetView(ME)))).toBe(0);
    });

    it('zeigt nach „Armeen ziehen“ die Nachbarfelder als Ziele und fragt „Wohin?“', () => {
      const html = stage(prepView(), { initial: { selected: CASTLE, moving: true } });
      const card = part(html, 'data-testid="prepare-moving"', '</div></div>');
      expect(textOf(card)).toContain('Wohin?');
      expect(textOf(card)).toContain('Tippe ein leuchtendes Nachbarfeld an.');
      expect(tagOf(html, 'data-testid="prepare-moving"')).not.toContain('data-refused');
      // Graufurt (2) grenzt an vier eigene Felder: 1, 3, 6 und 7
      expect(targets(html)).toBe(4);
      expect(hints(html)).toBe(0);
      // Ohne „Ziehen“ leuchtet kein Ziel
      expect(targets(stage(prepView(), { initial: { selected: CASTLE } }))).toBe(0);
    });

    it('sagt bei einem falschen Feld den Grund und lässt die Ziele stehen', () => {
      const html = stage(prepView(), {
        initial: { selected: CASTLE, moving: true, refused: TARGET },
      });
      expect(tagOf(html, 'data-testid="prepare-moving"')).toContain('data-refused="FOREIGN"');
      const text = part(html, 'class="act-move-text act-refused"', '</p>');
      expect(tagOf(text, 'act-move-text')).toContain('aria-live="polite"');
      expect(textOf(text)).toContain('Bot (schwer)');
      expect(targets(html)).toBe(4);
    });

    it('öffnet „Ziehen“ nicht, wenn von dem Feld keine Armee ziehen kann', () => {
      // Auf Birkental (5) steht keine Armee
      const html = stage(prepView(), { initial: { selected: 5, moving: true } });
      expect(html).not.toContain('data-testid="prepare-moving"');
      expect(html).toContain('data-testid="prepare-acts"');
      expect(targets(html)).toBe(0);
    });
  });

  it('nennt am Angriffsziel die Chance auf eine Lieblingskategorie', () => {
    const html = stage(targetView(ME), { initial: { target: TARGET } });
    const play = playOf(targetView(ME));
    const wheel = wheelPreview(play, ME, TARGET);
    if (!wheel) throw new Error('kein Rad');
    const percent = favoriteChance(wheel, REALM_FAVORITES[ME] ?? []);
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThan(100);
    expect(textOf(part(html, 'data-testid="match-lots-chance"', '</p>'))).toBe(
      `${percent} % für deine Lieblingskategorien. Jede Armee am Ziel bringt ein Los mehr.`,
    );
  });

  it('zeigt am Ende die Abrechnung', () => {
    const view = realmViewOf({ step: { kind: 'FINISHED', round: null } }, { phase: null });
    const html = stage({ ...view, match: { ...view.match, status: 'FINISHED' } });
    expect(main(html)).toContain('data-state="finished"');
    expect(html).toContain('data-testid="match-result"');
    expect(html).toContain('class="stage-centre wide"');
  });
});
