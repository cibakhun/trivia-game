import { buildRealmWheel } from '@rdw/game-core';
import { QUESTION_CATEGORIES, realmWheelSchema, type RealmOrderDto } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import { screenStateOf } from '../src/match/match-model.ts';
import { mapOfView } from '../src/match/match-text.ts';
import {
  attackReach,
  favoriteChance,
  fieldOptions,
  fieldRows,
  moveRefusal,
  planOrders,
  plannedRegion,
  orderKeys,
  plannedTargets,
  realmPlayOf,
  realmScreenStateOf,
  revealedOrders,
  revealedRound,
  roundFlow,
  skippedAttackers,
  settleOrders,
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

  it('nennt jeden Befehl gleich, solange er derselbe bleibt (Plättchen der Rüstzeit)', () => {
    let orders: RealmOrderDto[] = [];
    orders = withRecruit(orders, 2, 1);
    orders = withBuild(orders, 0, true);
    orders = withMove(orders, 2, 6, 1);
    expect(orderKeys(orders)).toEqual(['RECRUIT:2', 'BUILD:0', 'MOVE:2>6']);
    // Mehr Armeen, ein zweiter Zug, die Gegenrichtung: Die alten Namen bleiben
    orders = withMove(withMove(withRecruit(orders, 2, 3), 2, 6, 2), 6, 2, 1);
    expect(orderKeys(orders)).toEqual(['RECRUIT:2', 'BUILD:0', 'MOVE:2>6', 'MOVE:6>2']);
    // Ein Tausch rückt nach vorn, die anderen behalten ihren Namen
    orders = tradesFirst(withTrade(orders, 'MATERIAL', 1));
    expect(orderKeys(orders)).toEqual([
      'TRADE:MATERIAL',
      'RECRUIT:2',
      'BUILD:0',
      'MOVE:2>6',
      'MOVE:6>2',
    ]);
    // Käme ein Befehl doch doppelt (Stand des Servers), bleiben die Namen verschieden
    expect(
      orderKeys([
        { kind: 'BUILD', region: 0 },
        { kind: 'BUILD', region: 0 },
      ]),
    ).toEqual(['BUILD:0', 'BUILD:0#1']);
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

describe('Die drei Zeilen des Blatts zu einem Feld', () => {
  const rows = (id: number, options: RealmViewOptions = {}, orders: RealmOrderDto[] = []) => {
    const play = playOf(options);
    const found = fieldOptions(play, ME, orders, id);
    if (!found) throw new Error('kein eigenes Feld');
    return fieldRows(play, ME, orders, found);
  };

  it('bietet an, was auf dem Feld geht, und nennt sonst den Grund', () => {
    // Burg: höchste Stufe, aber Kauf und Zug
    expect(rows(2)).toEqual({ build: { kind: 'MAX_LEVEL' }, buy: null, move: null });
    // Dorf ohne Armee: nur der Ausbau zur Stadt
    expect(rows(5)).toEqual({ build: null, buy: { kind: 'NO_CASTLE' }, move: { kind: 'NO_ARMY' } });
    // Feld ohne Gebäude mit einer Armee: Bau und Zug
    expect(rows(7)).toEqual({ build: null, buy: { kind: 'NO_CASTLE' }, move: null });
  });

  it('nennt, wie viel für den Ausbau fehlt, gemessen am Vorrat nach dem Entwurf', () => {
    // Stadt Dornfeld, die Burg kostet 8 Brot und 16 Baustoff
    const poor = { stock: { 2: { bread: 1, material: 3 } } };
    expect(rows(6, poor).build).toEqual({ kind: 'MISSING', bread: 7, material: 13 });
    // 7 Brot und 10 Baustoff; ein Dorf auf Eisenhang (1 + 3) ist schon befohlen
    expect(rows(6, {}, withBuild([], 7, true)).build).toEqual({
      kind: 'MISSING',
      bread: 2,
      material: 9,
    });
    // Ein schon befohlener Ausbau ist kein Hindernis, auch wenn danach nichts mehr übrig ist
    expect(rows(7, { stock: { 2: { bread: 1, material: 3 } } }, withBuild([], 7, true)).build).toBe(
      null,
    );
  });

  it('nennt die Grenze der Burgen', () => {
    const play = playOf({ buildings: { 5: 'CASTLE' }, stock: { 2: { bread: 30, material: 40 } } });
    const found = fieldOptions(play, ME, [], 6);
    if (!found) throw new Error('kein eigenes Feld');
    expect(fieldRows(play, ME, [], found).build).toEqual({
      kind: 'CASTLE_LIMIT',
      max: play.realm.economy.maxCastles,
    });
  });

  it('Armeen kaufen: volle Burg oder zu wenig Brot', () => {
    expect(rows(2, { armies: { 2: 6 } }).buy).toEqual({ kind: 'ARMY_CAP', cap: 6 });
    expect(rows(2, { stock: { 2: { bread: 1, material: 10 } } }).buy).toEqual({
      kind: 'MISSING',
      bread: 1,
      material: 0,
    });
    // 5 Brot, zwei Armeen sind schon gekauft: Für die dritte fehlt 1 Brot
    const bought = withRecruit([], 2, 2);
    expect(rows(2, { stock: { 2: { bread: 5, material: 10 } } }, bought).buy).toEqual({
      kind: 'MISSING',
      bread: 1,
      material: 0,
    });
    // Mit drei gekauften stehen sechs in der Burg: voll
    expect(rows(2, {}, withRecruit([], 2, 3)).buy).toEqual({ kind: 'ARMY_CAP', cap: 6 });
  });

  it('Armeen ziehen: angekommen, alle gezogen, kein Nachbar, kein Platz', () => {
    // Falkenwacht (1) hat erst nach dem Zug eine Armee: Sie zieht erst nächste Runde weiter
    expect(rows(1, {}, withMove([], 2, 1, 1)).move).toEqual({ kind: 'NEXT_ROUND' });
    // Die eine Armee auf Eisenhang ist schon unterwegs
    expect(rows(7, {}, withMove([], 7, 6, 1)).move).toEqual({ kind: 'ALL_MOVED' });
    // Alle Nachbarn von Eisenhang gehören niemandem
    expect(rows(7, { free: [2, 3, 6, 8] }).move).toEqual({ kind: 'NO_NEIGHBOR' });
    // Auf jedem eigenen Nachbarfeld stehen schon sechs Armeen
    expect(rows(7, { armies: { 2: 6, 3: 6, 6: 6, 8: 6 } }).move).toEqual({
      kind: 'TARGETS_FULL',
      cap: 6,
    });
  });
});

describe('Ziel eines Zugs', () => {
  const from = (id: number, options: RealmViewOptions = {}) => {
    const play = playOf(options);
    const found = fieldOptions(play, ME, [], id);
    if (!found) throw new Error('kein eigenes Feld');
    return { play, field: found };
  };

  it('ein eigenes Nachbarfeld mit Platz ist ein Ziel, das Startfeld selbst kein Fehler', () => {
    const { play, field } = from(2);
    expect(moveRefusal(play, ME, field, 6)).toBeNull();
    expect(moveRefusal(play, ME, field, 2)).toBeNull();
  });

  it('nennt den Grund für jedes andere Feld', () => {
    const { play, field } = from(2);
    // Kranichsee gehört Sitz 1
    expect(moveRefusal(play, ME, field, 12)).toEqual({ kind: 'FOREIGN', owner: 1 });
    // Birkental ist ein eigenes Feld, liegt aber nicht an Graufurt
    expect(moveRefusal(play, ME, field, 5)).toEqual({ kind: 'TOO_FAR' });
    const free = from(2, { free: [3] });
    expect(moveRefusal(free.play, ME, free.field, 3)).toEqual({ kind: 'FREE' });
    const full = from(2, { armies: { 6: 6 } });
    expect(moveRefusal(full.play, ME, full.field, 6)).toEqual({ kind: 'FULL', cap: 6 });
  });

  it('ein Ziel ist auch voll, wenn ein schon geplanter Zug den letzten Platz belegt', () => {
    // Dornfeld (6) hat 5 Armeen, aus der Burg Graufurt (2) mit 3 Armeen zieht schon eine hin
    const play = playOf({ armies: { 6: 5 } });
    const orders = withMove([], 2, 6, 1);
    const field = fieldOptions(play, ME, orders, 2);
    if (!field) throw new Error('kein eigenes Feld');
    expect(field.movable).toBe(2);
    expect(field.moves.find((move) => move.to === 6)).toMatchObject({ count: 1, max: 1 });
    expect(moveRefusal(play, ME, field, 6)).toEqual({ kind: 'FULL', cap: 6 });
    // Ein anderes Nachbarfeld mit Platz bleibt ein Ziel
    expect(moveRefusal(play, ME, field, 7)).toBeNull();
  });
});

describe('Angriff nur mit Armee (ADR-064)', () => {
  it('Ziel ist, was ans eigene Land grenzt und eine eigene Armee daneben hat', () => {
    const play = playOf();
    // Kranichsee (12) liegt an Dornfeld (2 Armeen) und Eisenhang (1 Armee)
    expect(attackReach(play, ME, 12)).toBe('TARGET');
    // Ackerbrunn (4) grenzt an Eschenhain und Birkental: Dort steht keine Armee
    expect(attackReach(play, ME, 4)).toBe('NO_ARMY');
    // Tannenruh (20) liegt weit weg, Dornfeld (6) gehört mir selbst
    expect(attackReach(play, ME, 20)).toBe('FAR');
    expect(attackReach(play, ME, 6)).toBe('OWN');
    // Aus der Sicht von Sitz 0 liegt mein Birkental (5) neben seiner Burg und Immenau mit Armeen
    expect(attackReach(play, 0, 5)).toBe('TARGET');
    // Ein freies Feld braucht die Armee genauso; Armeen auf dem Ziel selbst zählen nicht
    expect(attackReach(playOf({ free: [14] }), ME, 14)).toBe('NO_ARMY');
    expect(attackReach(playOf({ free: [13] }), ME, 13)).toBe('TARGET');
    // Ohne mein Land daneben ist auch ein freies Feld kein Ziel
    expect(attackReach(playOf({ free: [6, 7] }), ME, 12)).toBe('FAR');
  });

  it('nur gegen andere Reiche oder gar nicht: Die Regeln der Partie entscheiden', () => {
    const rivals = playOf({ attackNeedsArmy: 'RIVALS', free: [14] });
    expect(attackReach(rivals, ME, 14)).toBe('TARGET');
    expect(attackReach(rivals, ME, 4)).toBe('NO_ARMY');
    // Partie von vor ADR-064: Die Grenze genügt
    const old = playOf({ attackNeedsArmy: null });
    expect(attackReach(old, ME, 4)).toBe('TARGET');
    expect(attackReach(old, ME, 14)).toBe('TARGET');
    expect(attackReach(old, ME, 20)).toBe('FAR');
  });

  it('Ziele nach dem Entwurf: Eine herangezogene Armee zählt, eine weggezogene fehlt', () => {
    const play = playOf();
    expect(plannedTargets(play, ME, [])).toEqual([11, 12, 13]);
    // Eine Armee von Dornfeld (6) nach Birkental (5): Ackerbrunn (4) und Hagelstein (10) kommen dazu
    expect(plannedTargets(play, ME, withMove([], 6, 5, 1))).toEqual([4, 10, 11, 12, 13]);
    // Die einzige Armee aus Eisenhang (7) zurück in die Burg: Lindenhof (13) fällt weg
    expect(plannedTargets(play, ME, withMove([], 7, 2, 1))).toEqual([11, 12]);
    // Ein ungültiger Entwurf ändert nichts
    expect(plannedTargets(play, ME, withMove([], 6, 5, 9))).toEqual([11, 12, 13]);
  });

  it('ohne Armee an der Grenze gibt es kein Ziel, bis eine herangezogen ist', () => {
    // Nur die Burg Graufurt (2) hat Armeen, und sie liegt mitten im eigenen Land
    const play = playOf({ armies: { 6: 0, 7: 0 } });
    expect(plannedTargets(play, ME, [])).toEqual([]);
    expect(plannedTargets(play, ME, withMove([], 2, 6, 1))).toEqual([11, 12]);
    // Neu gekaufte Armeen stehen in der Burg und helfen in dieser Runde nicht
    expect(plannedTargets(play, ME, withRecruit([], 2, 2))).toEqual([]);
    // Ohne den Regelwert ist jedes Feld an der Grenze ein Ziel
    expect(
      plannedTargets(playOf({ armies: { 6: 0, 7: 0 }, attackNeedsArmy: null }), ME, []),
    ).toEqual([4, 10, 11, 12, 13, 14]);
  });

  it('ausgefallene Angriffe einer Runde stehen in den Ereignissen', () => {
    const events = [
      event(50, 'ATTACK_SKIPPED', { round: 2, attacker: 1 }),
      event(51, 'ATTACK_SKIPPED', { round: 3, attacker: 0 }),
      event(52, 'ATTACK_SKIPPED', { round: 3, attacker: 2 }),
    ];
    expect(skippedAttackers(events, 2)).toEqual([1]);
    expect(skippedAttackers(events, 3)).toEqual([0, 2]);
    expect(skippedAttackers(events, 4)).toEqual([]);
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

  it('gibt es nicht für eigene Felder', () => {
    const play = playOf();
    expect(wheelPreview(play, ME, 6)).toBeNull();
    expect(wheelPreview(play, ME, 99)).toBeNull();
  });

  it('freies Feld (O-37): nur meine Lose und die freien, niemand hält dagegen', () => {
    // Ackerbrunn (4) frei, daneben meine Felder Eschenhain (0) und Birkental (5) mit 2 Armeen;
    // die 2 Armeen in der Burg Hagelstein (10) des Nachbarn zählen nicht
    const play = playOf({ free: [4], armies: { 5: 2 } });
    const wheel = wheelPreview(play, ME, 4);
    expect(wheel).toEqual(buildRealmWheel(QUESTION_CATEGORIES, REALM_FAVORITES[2], [], 2, 0, 2));
    expect(wheel).toMatchObject({ attackerLots: 2, defenderLots: 0, freeLots: 2 });
    expect(wheel?.segments.every((s) => s.defender === 0)).toBe(true);
    expect(realmWheelSchema.parse(wheel)).toEqual(wheel);
  });

  it('Chance der Lieblingskategorien: ihr Anteil am ganzen Rad in ganzen Prozent', () => {
    const wheel = wheelPreview(playOf(), ME, 12);
    if (!wheel) throw new Error('kein Rad');
    const mine = wheel.segments
      .filter((s) => (REALM_FAVORITES[2] as readonly string[]).includes(s.category))
      .reduce((total, s) => total + s.weight, 0);
    const chance = favoriteChance(wheel, REALM_FAVORITES[2]);
    expect(chance).toBe(Math.round((mine / wheel.total) * 100));
    expect(chance).toBeGreaterThan(0);
    expect(chance).toBeLessThan(100);
    // Mehr eigene Armeen am Ziel, mehr eigene Lose: Die Chance steigt
    const more = wheelPreview(playOf({ armies: { 6: 6 } }), ME, 12);
    if (!more) throw new Error('kein Rad');
    expect(favoriteChance(more, REALM_FAVORITES[2])).toBeGreaterThan(chance);
    // Ohne Lieblingskategorie und ohne Lose: 0
    expect(favoriteChance(wheel, [])).toBe(0);
    expect(favoriteChance({ segments: [], total: 0 }, REALM_FAVORITES[2])).toBe(0);
    // Alle Kategorien zusammen sind das ganze Rad
    expect(favoriteChance(wheel, QUESTION_CATEGORIES)).toBe(100);
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
    expect(revealedRound(revealed)).toBe(2);
    expect(revealedRound(revealed.slice(0, 1))).toBeNull();
  });

  it('das Aufgedeckte steht auch, wenn gleich danach Angriffe ausfallen (ADR-064)', () => {
    const revealedAt = (seq: number) =>
      event(seq, 'ORDERS_REVEALED', {
        round: 2,
        seat: 2,
        orders: [],
        summary: { built: [], recruited: 0, moved: 0, traded: 0 },
        bread: 7,
        material: 10,
      });
    const skipped = (seq: number, attacker: number) =>
      event(seq, 'ATTACK_SKIPPED', { round: 2, attacker });
    const announce = {
      phase: { kind: 'ANNOUNCE', deadline: '2026-11-10T20:00:02.000Z', remainingMs: 2000 },
    } as const;
    // Der Erste setzt aus, der Zweite ist schon dran
    const first = realmViewOf(
      { step: { kind: 'CAMPAIGN_TARGET', round: 2, chooser: 0 } },
      announce,
    );
    const one = [revealedAt(41), skipped(42, 2)];
    expect(realmScreenStateOf(first, null, one)).toBe('orders');
    expect(revealedRound(one)).toBe(2);
    // Alle setzen aus: Der Schritt ist schon die Rüstzeit der nächsten Runde, das Einkommen ist da
    const next = realmViewOf({ step: { kind: 'PREPARE', round: 3 } }, announce);
    const all = [
      revealedAt(41),
      skipped(42, 2),
      skipped(43, 0),
      skipped(44, 1),
      event(45, 'INCOME', { round: 3, income: [{ seat: 2, bread: 4, material: 5 }] }),
    ];
    expect(realmScreenStateOf(next, null, all)).toBe('orders');
    expect(revealedRound(all)).toBe(2);
    expect(revealedOrders(all, revealedRound(all) ?? 0)).toHaveLength(1);
    // Sobald ein Ziel gewählt ist, steht nichts Aufgedecktes mehr
    const chosen = [
      ...one,
      event(46, 'TARGET_CHOSEN', { round: 2, attacker: 0, defender: 2, region: 5 }),
    ];
    expect(revealedRound(chosen)).toBeNull();
    expect(realmScreenStateOf(first, null, chosen)).toBe('announce');
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

describe('Ablaufzeile', () => {
  const flow = (kind: RealmPlay['board']['step']['kind'], state: Parameters<typeof roundFlow>[1]) =>
    roundFlow(playOf({ step: { kind } }), state);

  it('Eröffnung: Burg, Dorf, Landnahme; vor der ersten Wahl läuft noch nichts davon', () => {
    const steps = ['CASTLE', 'VILLAGE', 'LAND'];
    expect(flow('START_ESTIMATE', 'question')).toEqual({ steps, now: -1 });
    expect(flow('CASTLE_PICK', 'pick')).toEqual({ steps, now: 0 });
    expect(flow('VILLAGE_PICK', 'waiting-pick')).toEqual({ steps, now: 1 });
    expect(flow('LAND_ESTIMATE', 'question')).toEqual({ steps, now: 2 });
    expect(flow('LAND_PICK', 'pick')).toEqual({ steps, now: 2 });
  });

  it('Feldzug: Rüsten, Aufdecken, Angriffe', () => {
    const steps = ['PREPARE', 'ORDERS', 'ATTACK'];
    expect(flow('PREPARE', 'prepare')).toEqual({ steps, now: 0 });
    expect(flow('PREPARE', 'prepared')).toEqual({ steps, now: 0 });
    // Das Aufgedeckte steht noch, während der Server schon beim ersten Angriff ist
    expect(flow('CAMPAIGN_TARGET', 'orders')).toEqual({ steps, now: 1 });
    expect(flow('CAMPAIGN_TARGET', 'pick')).toEqual({ steps, now: 2 });
    expect(flow('DUEL_WHEEL', 'wheel')).toEqual({ steps, now: 2 });
    expect(flow('DUEL_TRIVIA', 'question')).toEqual({ steps, now: 2 });
    expect(flow('DUEL_ESTIMATE', 'reveal')).toEqual({ steps, now: 2 });
    // Fielen alle Angriffe aus (ADR-064), ist der Server schon in der nächsten Rüstzeit oder am Ende
    expect(flow('PREPARE', 'orders')).toEqual({ steps, now: 1 });
    expect(flow('FINISHED', 'orders')).toEqual({ steps, now: 1 });
  });

  it('steht nicht vor dem Start und nicht nach dem Ende', () => {
    expect(flow('PREPARE', 'lobby')).toBeNull();
    expect(flow('CAMPAIGN_TARGET', 'finished')).toBeNull();
    expect(flow('CAMPAIGN_TARGET', 'abandoned')).toBeNull();
    expect(flow('FINISHED', 'reveal')).toBeNull();
  });
});
