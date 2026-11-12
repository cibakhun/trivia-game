import { buildRealmWheel } from '@rdw/game-core';
import { QUESTION_CATEGORIES, realmWheelSchema, type RealmOrderDto } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import { screenStateOf } from '../src/match/match-model.ts';
import { mapOfView } from '../src/match/match-text.ts';
import {
  fieldOptions,
  planOrders,
  plannedRegion,
  prepareTab,
  realmPlayOf,
  realmScreenStateOf,
  revealedOrders,
  settleOrders,
  tabsOf,
  tradeOptions,
  tradesFirst,
  wheelPreview,
  withBuild,
  withMove,
  withRecruit,
  withTrade,
  type RealmPlay,
} from '../src/match/realm-model.ts';
import {
  REALM_FAVORITES,
  event,
  realmViewOf,
  viewOf,
  type RealmViewOptions,
} from './match-fixtures.ts';

/**
 * Partie mit Ausbau im Browser: Rüstzeit planen, Vorschau des Glücksrads, Zustand des Bildschirms.
 * Grundbild (match-fixtures): Ich bin Sitz 2 mit 7 Brot und 10 Baustoff, Burg Graufurt (2) mit
 * 3 Armeen, Stadt Dornfeld (6) mit 2 Armeen, Dorf Birkental (5), 1 Armee auf Eisenhang (7).
 */

const ME = 2;

function playOf(options: RealmViewOptions = {}): RealmPlay {
  const play = realmPlayOf(realmViewOf(options));
  if (!play) throw new Error('Ansicht ohne Brett');
  return play;
}

describe('Brett der Partie mit Ausbau', () => {
  it('gibt es nur mit Ausbau und nach dem Start', () => {
    expect(realmPlayOf(null)).toBeNull();
    expect(realmPlayOf(viewOf())).toBeNull();
    const lobby = realmViewOf();
    expect(
      realmPlayOf({ ...lobby, realm: lobby.realm && { ...lobby.realm, board: null } }),
    ).toBeNull();
    expect(playOf().board.regions).toHaveLength(24);
  });

  it('nimmt die Karte aus dem Brett mit Ausbau', () => {
    expect(mapOfView(realmViewOf()).id).toBe('WENDELMARK');
    expect(mapOfView(realmViewOf({ map: 'KERNMARK' })).id).toBe('KERNMARK');
    expect(mapOfView(realmViewOf({ map: 'UNBEKANNT' })).id).toBe('WENDELMARK');
  });
});

describe('Entwurf der Befehle', () => {
  it('setzt je Feld, Zug und Rohstoff genau einen Befehl an seiner Stelle', () => {
    let orders: RealmOrderDto[] = [];
    orders = withRecruit(orders, 2, 1);
    orders = withBuild(orders, 0, true);
    orders = withMove(orders, 2, 6, 1);
    orders = withTrade(orders, 'BREAD', 1);
    orders = withRecruit(orders, 2, 3);
    orders = withMove(orders, 2, 6, 2);
    orders = withBuild(orders, 0, true);
    expect(orders).toEqual([
      { kind: 'RECRUIT', region: 2, count: 3 },
      { kind: 'BUILD', region: 0 },
      { kind: 'MOVE', from: 2, to: 6, count: 2 },
      { kind: 'TRADE', give: 'BREAD', count: 1 },
    ]);
    orders = withRecruit(orders, 2, 0);
    orders = withBuild(orders, 0, false);
    orders = withMove(orders, 2, 6, 0);
    orders = withTrade(orders, 'BREAD', 0);
    expect(orders).toEqual([]);
  });

  it('lässt andere Felder und die Gegenrichtung eines Zugs stehen', () => {
    const orders = withMove(withMove(withBuild([], 0, true), 2, 6, 1), 6, 2, 1);
    expect(withBuild(orders, 1, true)).toHaveLength(4);
    expect(withMove(orders, 2, 6, 0)).toEqual([
      { kind: 'BUILD', region: 0 },
      { kind: 'MOVE', from: 6, to: 2, count: 1 },
    ]);
  });

  it('fasst doppelte Befehle beim Setzen zusammen', () => {
    const doubled: RealmOrderDto[] = [
      { kind: 'RECRUIT', region: 2, count: 1 },
      { kind: 'BUILD', region: 0 },
      { kind: 'RECRUIT', region: 2, count: 1 },
    ];
    expect(withRecruit(doubled, 2, 3)).toEqual([
      { kind: 'RECRUIT', region: 2, count: 3 },
      { kind: 'BUILD', region: 0 },
    ]);
  });

  it('rechnet Vorräte und Felder nach dem Entwurf', () => {
    const play = playOf();
    const orders = withMove(withBuild(withRecruit([], 2, 2), 0, true), 2, 7, 1);
    const plan = planOrders(play, ME, orders);
    expect(plan.ok && { bread: plan.bread, material: plan.material }).toEqual({
      bread: 2,
      material: 7,
    });
    expect(plannedRegion(play, plan, 0).building).toBe('VILLAGE');
    expect(plannedRegion(play, plan, 2).armies).toBe(4);
    expect(plannedRegion(play, plan, 7).armies).toBe(2);
    // Unberührte Felder bleiben, wie die Ansicht sie zeigt
    expect(plannedRegion(play, plan, 6)).toBe(play.board.regions[6]);
    expect(plan.ok && plan.summary).toEqual({
      built: [{ region: 0, building: 'VILLAGE' }],
      recruited: 2,
      moved: 1,
      traded: 0,
    });
  });

  it('plant eine neue Burg mit vollen Leben', () => {
    // Dornfeld (6) ist eine Stadt; die Vorräte reichen für die Burg (8 Brot, 16 Baustoff)
    const play = playOf({ stock: { [ME]: { bread: 9, material: 16 } } });
    expect(play.board.regions[6]).toMatchObject({ building: 'TOWN', castleLivesLeft: 0 });
    const plan = planOrders(play, ME, [
      { kind: 'BUILD', region: 6 },
      { kind: 'MOVE', from: 2, to: 6, count: 1 },
    ]);
    expect(plannedRegion(play, plan, 6)).toMatchObject({
      building: 'CASTLE',
      castleLivesLeft: 3,
      armies: 3,
    });
    // Die Burg, die schon steht, behält ihre Leben
    expect(plannedRegion(play, plan, 2).castleLivesLeft).toBe(3);
  });

  it('meldet den ersten Befehl, der nicht geht', () => {
    const play = playOf();
    expect(planOrders(play, ME, [{ kind: 'BUILD', region: 4 }])).toEqual({
      ok: false,
      error: 'NOT_OWN_REGION',
      index: 0,
    });
    expect(
      planOrders(play, ME, [
        { kind: 'BUILD', region: 0 },
        { kind: 'RECRUIT', region: 2, count: 4 },
      ]),
    ).toEqual({ ok: false, error: 'TOO_EXPENSIVE', index: 1 });
  });

  it('plant nicht für ein gefallenes oder fremdes Reich', () => {
    expect(planOrders(playOf({ eliminated: [ME] }), ME, [])).toEqual({
      ok: false,
      error: 'INVALID',
      index: 0,
    });
    expect(fieldOptions(playOf({ eliminated: [ME] }), ME, [], 2)).toBeNull();
    expect(tradeOptions(playOf({ eliminated: [ME] }), ME, [])).toEqual([]);
  });
});

describe('Was auf einem Feld geht', () => {
  it('kennt fremde und freie Felder nicht', () => {
    const play = playOf();
    expect(fieldOptions(play, ME, [], 4)).toBeNull();
    expect(fieldOptions(play, ME, [], 99)).toBeNull();
  });

  it('bietet auf einem leeren Feld das Dorf an', () => {
    const options = fieldOptions(playOf(), ME, [], 0);
    expect(options).toEqual({
      region: 0,
      building: 'NONE',
      armies: 0,
      build: {
        building: 'VILLAGE',
        cost: { bread: 1, material: 3 },
        ordered: false,
        blocked: null,
      },
      recruit: null,
      movable: 0,
      // Eschenhain grenzt an Falkenwacht (1) und Birkental (5); Ackerbrunn (4) ist fremd
      moves: [
        { to: 1, count: 0, max: 0 },
        { to: 5, count: 0, max: 0 },
      ],
    });
  });

  it('nennt die nächste Stufe und warum sie gerade nicht geht', () => {
    const play = playOf();
    expect(fieldOptions(play, ME, [], 5)?.build).toMatchObject({ building: 'TOWN', blocked: null });
    // Die Burg kostet 8 Brot und 16 Baustoff
    expect(fieldOptions(play, ME, [], 6)?.build).toMatchObject({
      building: 'CASTLE',
      cost: { bread: 8, material: 16 },
      blocked: 'TOO_EXPENSIVE',
    });
    expect(fieldOptions(play, ME, [], 2)?.build).toBeNull();
    // Mit zwei Burgen ist Schluss, auch wenn das Geld reicht
    const rich = playOf({ stock: { 2: { bread: 20, material: 40 } }, buildings: { 3: 'CASTLE' } });
    expect(fieldOptions(rich, ME, [], 6)?.build?.blocked).toBe('CASTLE_LIMIT');
  });

  it('zeigt einen befohlenen Bau als befohlen und rechnet ihn ein', () => {
    const play = playOf();
    const orders = withBuild([], 5, true);
    const options = fieldOptions(play, ME, orders, 5);
    expect(options?.building).toBe('TOWN');
    expect(options?.build).toEqual({
      building: 'TOWN',
      cost: { bread: 2, material: 6 },
      ordered: true,
      blocked: null,
    });
    // Stadt 2 + 6 und Dorf 1 + 3 gehen, ein zweites Dorf nicht mehr (1 Baustoff übrig)
    expect(fieldOptions(play, ME, orders, 0)?.build?.blocked).toBeNull();
    expect(fieldOptions(play, ME, withBuild(orders, 0, true), 1)?.build?.blocked).toBe(
      'TOO_EXPENSIVE',
    );
  });

  it('kauft Armeen nur in der Burg, begrenzt durch Brot und die Obergrenze je Feld', () => {
    const play = playOf();
    expect(fieldOptions(play, ME, [], 6)?.recruit).toBeNull();
    // 7 Brot reichen für 3 Armeen zu je 2; mit den 3 vorhandenen sind es 6, die Obergrenze
    expect(fieldOptions(play, ME, [], 2)?.recruit).toEqual({
      count: 0,
      max: 3,
      cost: { bread: 2, material: 0 },
    });
    expect(fieldOptions(play, ME, withRecruit([], 2, 2), 2)).toMatchObject({
      armies: 5,
      recruit: { count: 2, max: 3 },
    });
    // Nach dem Bau einer Stadt (2 Brot) bleiben 5 Brot: 2 Armeen
    expect(fieldOptions(play, ME, withBuild([], 5, true), 2)?.recruit?.max).toBe(2);
    // Viel Brot: Die Obergrenze von 6 Armeen je Feld hält bei 3 neuen an
    const rich = playOf({ stock: { 2: { bread: 40, material: 0 } } });
    expect(fieldOptions(rich, ME, [], 2)?.recruit?.max).toBe(3);
  });

  it('kauft in einer Burg, die in derselben Rüstzeit entsteht', () => {
    const play = playOf({ stock: { 2: { bread: 12, material: 16 } } });
    const orders = withRecruit(withBuild([], 6, true), 6, 2);
    expect(fieldOptions(play, ME, orders, 6)).toMatchObject({
      building: 'CASTLE',
      armies: 4,
      build: { building: 'CASTLE', ordered: true, blocked: null },
      recruit: { count: 2, max: 2 },
    });
    // Ohne den Bau fällt der Kauf heraus
    const settled = settleOrders(play, ME, withBuild(orders, 6, false));
    expect(settled.orders).toEqual([]);
    expect(settled.dropped).toEqual([{ kind: 'RECRUIT', region: 6, count: 2 }]);
    expect(settled.plan.ok).toBe(true);
  });

  it('zieht nur Armeen vom Rundenbeginn in eigene Nachbarfelder', () => {
    const play = playOf();
    const castle = fieldOptions(play, ME, [], 2);
    expect(castle?.movable).toBe(3);
    // Graufurt grenzt an Falkenwacht (1), Hirschgrund (3), Dornfeld (6) und Eisenhang (7)
    expect(castle?.moves).toEqual([
      { to: 1, count: 0, max: 3 },
      { to: 3, count: 0, max: 3 },
      { to: 6, count: 0, max: 3 },
      { to: 7, count: 0, max: 3 },
    ]);
    // Neu gekaufte Armeen ziehen nicht mit, und was schon zieht, fehlt den anderen Zielen
    const orders = withMove(withRecruit([], 2, 3), 2, 6, 2);
    const after = fieldOptions(play, ME, orders, 2);
    expect(after?.movable).toBe(1);
    expect(after?.armies).toBe(4);
    expect(after?.moves).toEqual([
      { to: 1, count: 0, max: 1 },
      { to: 3, count: 0, max: 1 },
      { to: 6, count: 2, max: 3 },
      { to: 7, count: 0, max: 1 },
    ]);
    // Dornfeld (6) grenzt an fremde Felder (11, 12): Dorthin geht kein Zug
    expect(fieldOptions(play, ME, [], 6)?.moves.map((move) => move.to)).toEqual([1, 2, 5, 7]);
  });

  it('hält die Obergrenze je Feld auch über Kauf und Zug hinweg', () => {
    const play = playOf();
    // In der Burg stehen 3; mit 3 gekauften ist sie voll, mit 2 gekauften passt noch 1 hinein
    const into = (orders: RealmOrderDto[]) =>
      fieldOptions(play, ME, orders, 6)?.moves.find((move) => move.to === 2)?.max;
    expect(into([])).toBe(2);
    expect(into(withRecruit([], 2, 2))).toBe(1);
    expect(into(withRecruit([], 2, 3))).toBe(0);
    // Umgekehrt begrenzt ein Zug in die Burg den Kauf
    expect(fieldOptions(play, ME, withMove([], 6, 2, 2), 2)?.recruit?.max).toBe(1);
  });

  it('erlaubt mit einem ungültigen Entwurf nichts Weiteres', () => {
    const play = playOf();
    const broken: RealmOrderDto[] = [{ kind: 'RECRUIT', region: 2, count: 5 }];
    const options = fieldOptions(play, ME, broken, 2);
    expect(options?.recruit).toMatchObject({ count: 5, max: 5 });
    expect(options?.moves.every((move) => move.max === 0)).toBe(true);
    expect(fieldOptions(play, ME, broken, 0)?.build?.blocked).toBe('TOO_EXPENSIVE');
  });
});

describe('Tausch', () => {
  it('bietet beide Richtungen bis zum Vorrat an', () => {
    // 7 Brot und 10 Baustoff, 3 für 1
    expect(tradeOptions(playOf(), ME, [])).toEqual([
      { give: 'BREAD', rate: 3, count: 0, max: 2 },
      { give: 'MATERIAL', rate: 3, count: 0, max: 3 },
    ]);
  });

  it('rechnet mit, was der Entwurf schon ausgibt', () => {
    const play = playOf();
    // Das Dorf kostet 1 Brot und 3 Baustoff: Es bleiben 6 und 7
    expect(tradeOptions(play, ME, withBuild([], 0, true)).map((trade) => trade.max)).toEqual([
      2, 2,
    ]);
    // Befehle laufen der Reihe nach: Ein Tausch vor dem Bau darf ihm den Baustoff nicht nehmen
    const first = withBuild(withTrade([], 'MATERIAL', 2), 0, true);
    expect(tradeOptions(play, ME, first)).toEqual([
      { give: 'BREAD', rate: 3, count: 0, max: 2 },
      { give: 'MATERIAL', rate: 3, count: 2, max: 2 },
    ]);
  });

  it('wirft heraus, was ohne den Tausch nicht mehr geht', () => {
    const play = playOf({ stock: { 2: { bread: 3, material: 12 } } });
    const orders = withBuild(withRecruit(withTrade([], 'MATERIAL', 2), 2, 2), 0, true);
    expect(planOrders(play, ME, orders)).toMatchObject({ ok: true, bread: 0, material: 3 });
    const settled = settleOrders(play, ME, withTrade(orders, 'MATERIAL', 0));
    // Ohne die 2 getauschten Brote reicht es nicht für 2 Armeen; das Dorf bleibt
    expect(settled.dropped).toEqual([{ kind: 'RECRUIT', region: 2, count: 2 }]);
    expect(settled.orders).toEqual([{ kind: 'BUILD', region: 0 }]);
    expect(settled.plan).toMatchObject({ ok: true, bread: 2, material: 9 });
  });

  it('lässt einen gültigen Entwurf unverändert', () => {
    const play = playOf();
    const orders = withBuild(withRecruit([], 2, 1), 0, true);
    expect(settleOrders(play, ME, orders)).toMatchObject({ orders, dropped: [] });
  });
});

describe('Reihenfolge im Entwurf', () => {
  it('stellt jeden Tausch nach vorn und lässt das Übrige, wie es war', () => {
    const orders: RealmOrderDto[] = [
      { kind: 'BUILD', region: 7 },
      { kind: 'TRADE', give: 'MATERIAL', count: 1 },
      { kind: 'RECRUIT', region: 2, count: 1 },
      { kind: 'TRADE', give: 'BREAD', count: 1 },
      { kind: 'MOVE', from: 2, to: 6, count: 1 },
    ];
    expect(tradesFirst(orders).map((o) => o.kind)).toEqual([
      'TRADE',
      'TRADE',
      'BUILD',
      'RECRUIT',
      'MOVE',
    ]);
    expect(tradesFirst(orders).slice(0, 2)).toEqual([orders[1], orders[3]]);
    expect(tradesFirst([])).toEqual([]);
  });

  it('macht einen Kauf möglich, für den erst der Tausch das Brot bringt', () => {
    // 1 Brot reicht für keine Armee; 3 Baustoff gegen 1 Brot getauscht, reicht es
    const play = playOf({ stock: { 2: { bread: 1, material: 10 } } });
    const late: RealmOrderDto[] = [
      { kind: 'RECRUIT', region: 2, count: 1 },
      { kind: 'TRADE', give: 'MATERIAL', count: 1 },
    ];
    expect(planOrders(play, ME, late).ok).toBe(false);
    expect(planOrders(play, ME, tradesFirst(late)).ok).toBe(true);
  });
});

describe('Reiter des Blatts zu einem Feld', () => {
  const field = (id: number, options: RealmViewOptions = {}) => {
    const found = fieldOptions(playOf(options), ME, [], id);
    if (!found) throw new Error('kein eigenes Feld');
    return found;
  };

  it('öffnet nur, was auf dem Feld geht', () => {
    // Burg: höchste Stufe, also kein Bau, aber Kauf und Zug
    expect(tabsOf(field(2))).toEqual({ build: false, buy: true, move: true });
    // Dorf ohne Armee: nur Bau
    expect(tabsOf(field(5))).toEqual({ build: true, buy: false, move: false });
    // Freies Feld mit einer Armee: Bau und Zug
    expect(tabsOf(field(7))).toEqual({ build: true, buy: false, move: true });
  });

  it('bleibt beim gewünschten Reiter, wenn er geht, sonst beim ersten, der geht', () => {
    expect(prepareTab(field(7), 'move')).toBe('move');
    expect(prepareTab(field(7), 'buy')).toBe('build');
    expect(prepareTab(field(2), 'build')).toBe('buy');
    expect(prepareTab(field(5), 'move')).toBe('build');
  });
});

describe('Vorschau des Glücksrads', () => {
  it('zählt Armeen in Reichweite und das Gebäude des Ziels', () => {
    const play = playOf();
    // Kranichsee (12, Dorf, Sitz 1): Ich habe 2 + 1 Armeen auf Dornfeld und Eisenhang daneben; der
    // Verteidiger 2 auf dem Feld, 1 auf Lindenhof, 3 in Rabenfels und 2 Lose für das Dorf
    const wheel = wheelPreview(play, ME, 12);
    expect(wheel).toEqual(
      buildRealmWheel(QUESTION_CATEGORIES, REALM_FAVORITES[2], REALM_FAVORITES[1], 3, 8, 2),
    );
    expect(wheel).toMatchObject({ attackerLots: 3, defenderLots: 8, freeLots: 2 });
    expect(wheel?.segments).toHaveLength(QUESTION_CATEGORIES.length);
  });

  it('folgt dem Brett: mehr Armeen daneben, mehr Lose', () => {
    const play = playOf({ armies: { 6: 4 } });
    expect(wheelPreview(play, ME, 12)?.attackerLots).toBe(5);
    // Immenau (11, Dorf, Sitz 0) mit 3 Armeen, daneben die Burg Hagelstein mit 2
    expect(wheelPreview(play, ME, 11)).toMatchObject({ attackerLots: 4, defenderLots: 7 });
  });

  it('gibt es nur für fremde Felder', () => {
    const play = playOf();
    expect(wheelPreview(play, ME, 6)).toBeNull();
    expect(wheelPreview(play, ME, 99)).toBeNull();
  });
});

describe('Bildschirm der Partie mit Ausbau', () => {
  const none = [] as const;

  it('gilt ohne Ausbau wie bisher', () => {
    const view = viewOf();
    expect(realmScreenStateOf(view, null, none)).toBe(screenStateOf(view, null));
    expect(realmScreenStateOf(null, null, none)).toBe('loading');
  });

  it('unterscheidet in der Rüstzeit offen, abgegeben und zuschauend', () => {
    expect(realmScreenStateOf(realmViewOf(), null, none)).toBe('prepare');
    const done = realmViewOf({ myOrders: [] });
    expect(realmScreenStateOf(done, null, none)).toBe('prepared');
    // „Befehle ändern“ öffnet den Entwurf wieder
    expect(realmScreenStateOf(done, null, none, true)).toBe('prepare');
    expect(realmScreenStateOf(realmViewOf({ eliminated: [2] }), null, none)).toBe(
      'watching-prepare',
    );
    expect(realmScreenStateOf(realmViewOf({}, { mySeat: null }), null, none)).toBe(
      'watching-prepare',
    );
  });

  it('zeigt das Aufgedeckte, solange es das Jüngste ist', () => {
    const view = realmViewOf(
      { step: { kind: 'CAMPAIGN_TARGET', chooser: 2 } },
      { phase: { kind: 'ANNOUNCE', deadline: '2026-11-10T20:00:02.000Z', remainingMs: 2000 } },
    );
    const revealed = [
      event(40, 'INCOME', { round: 2, income: [{ seat: 2, bread: 4, material: 5 }] }),
      event(41, 'ORDERS_REVEALED', {
        round: 2,
        seat: 2,
        orders: [{ kind: 'BUILD', region: 0 }],
        summary: { built: [{ region: 0, building: 'VILLAGE' }], recruited: 0, moved: 0, traded: 0 },
        bread: 6,
        material: 7,
      }),
    ];
    expect(realmScreenStateOf(view, null, revealed)).toBe('orders');
    expect(revealedOrders(revealed, 2).map((e) => e.payload.seat)).toEqual([2]);
    expect(revealedOrders(revealed, 3)).toEqual([]);
    // Eine andere Ansage (etwa die Wahl eines Bots) bleibt eine Ansage
    expect(realmScreenStateOf(view, null, revealed.slice(0, 1))).toBe('announce');
  });

  it('zeigt das Glücksrad in der Ansage vor der Wissensfrage', () => {
    const play = playOf();
    const wheel = realmWheelSchema.parse(wheelPreview(play, ME, 12));
    const view = realmViewOf(
      {
        step: {
          kind: 'DUEL_TRIVIA',
          attacker: 2,
          defender: 1,
          region: 12,
          category: 'HISTORY',
          wheel,
        },
      },
      { phase: { kind: 'ANNOUNCE', deadline: '2026-11-10T20:00:03.000Z', remainingMs: 3000 } },
    );
    expect(realmScreenStateOf(view, null, none)).toBe('wheel');
  });

  it('übernimmt Wahl, Frage und Ende von der Partie ohne Ausbau', () => {
    const pick = realmViewOf(
      { step: { kind: 'CAMPAIGN_TARGET', chooser: 2 } },
      {
        phase: { kind: 'PICK', deadline: '2026-11-10T20:00:10.000Z', remainingMs: 10000 },
        legalRegions: [11, 12],
      },
    );
    expect(realmScreenStateOf(pick, null, none)).toBe('pick');
    const finished = realmViewOf({ step: { kind: 'FINISHED', round: null } }, { phase: null });
    expect(
      realmScreenStateOf(
        { ...finished, match: { ...finished.match, status: 'FINISHED' } },
        null,
        none,
      ),
    ).toBe('finished');
  });
});
