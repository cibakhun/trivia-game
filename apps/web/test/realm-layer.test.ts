import type { MatchEventOf, RealmOrderDto } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  layerRegions,
  outcomeMotion,
  outcomeSign,
  outcomeSignKey,
  planLayer,
  realmBoardState,
  revealLayer,
  revealMotion,
} from '../src/match/realm-layer.ts';
import { realmPlayOf, type RealmPlay } from '../src/match/realm-model.ts';
import { event, realmViewOf, type RealmViewOptions } from './match-fixtures.ts';

/**
 * Was die Karte von der Partie mit Ausbau zeigt: Brett, Pläne der Rüstzeit, das Aufgedeckte und
 * das Schild über einem entschiedenen Duell. Grundbild wie in `realm-model.test.ts`.
 */

const ME = 2;

function playOf(options: RealmViewOptions = {}): RealmPlay {
  const play = realmPlayOf(realmViewOf(options));
  if (!play) throw new Error('Ansicht ohne Brett');
  return play;
}

describe('Brett für die Karte', () => {
  const play = playOf();

  it('zeichnet jede Burg wie eine Hauptstadt ihres Besitzers', () => {
    const board = realmBoardState(play.board);
    expect(board.regions).toHaveLength(24);
    expect(board.regions[2]).toEqual({ owner: 2, value: 300, capitalOf: 2 });
    expect(board.regions[6]).toEqual({ owner: 2, value: 100, capitalOf: null });
    expect(board.regions.filter((r) => r.capitalOf !== null)).toHaveLength(3);
    // Eine zweite Burg desselben Reichs steht genauso da
    const two = realmBoardState(playOf({ buildings: { 6: 'CASTLE' } }).board);
    expect(two.regions[6]?.capitalOf).toBe(2);
  });

  it('gibt Gebäude, Armeen und Burgleben je Feld weiter', () => {
    const regions = layerRegions(play.board);
    expect(regions[2]).toEqual({ building: 'CASTLE', armies: 3, castleLives: 3, held: 0 });
    expect(regions[6]).toEqual({ building: 'TOWN', armies: 2, castleLives: 0, held: 0 });
    expect(regions[0]).toEqual({ building: 'NONE', armies: 0, castleLives: 0, held: 0 });
  });
});

describe('Pläne der Rüstzeit auf der Karte', () => {
  const play = playOf();

  it('ist leer ohne Befehle', () => {
    expect(planLayer(play, ME, [])).toEqual({ planned: {}, recruits: {}, moves: [] });
  });

  it('zeigt geplante Bauten mit der Stufe, die entsteht', () => {
    const orders: RealmOrderDto[] = [
      { kind: 'BUILD', region: 7 },
      { kind: 'BUILD', region: 5 },
    ];
    expect(planLayer(play, ME, orders).planned).toEqual({ 7: 'VILLAGE', 5: 'TOWN' });
  });

  it('zählt Käufe je Feld und fasst Züge mit demselben Weg zusammen', () => {
    const orders: RealmOrderDto[] = [
      { kind: 'RECRUIT', region: 2, count: 1 },
      { kind: 'RECRUIT', region: 2, count: 2 },
      { kind: 'MOVE', from: 2, to: 6, count: 1 },
      { kind: 'MOVE', from: 2, to: 6, count: 2 },
      { kind: 'MOVE', from: 6, to: 7, count: 1 },
    ];
    const layer = planLayer(play, ME, orders);
    expect(layer.recruits).toEqual({ 2: 3 });
    expect(layer.moves).toEqual([
      { from: 2, to: 6, count: 3, seat: ME },
      { from: 6, to: 7, count: 1, seat: ME },
    ]);
  });

  it('zeigt bei einem Entwurf, der nicht geht, keinen Bau als geplant', () => {
    // Eine Burg in Dornfeld kostet mehr, als ich habe
    const layer = planLayer(play, ME, [{ kind: 'BUILD', region: 6 }]);
    expect(layer.planned).toEqual({});
  });
});

describe('Aufgedecktes auf der Karte', () => {
  const revealed = (
    seat: number,
    seq: number,
    orders: RealmOrderDto[],
    built: { region: number; building: string }[] = [],
  ): MatchEventOf<'ORDERS_REVEALED'> => {
    const parsed = event(seq, 'ORDERS_REVEALED', {
      round: 2,
      seat,
      orders,
      summary: { built, recruited: 0, moved: 0, traded: 0 },
      bread: 3,
      material: 4,
    });
    if (parsed.type !== 'ORDERS_REVEALED') throw new Error('falsches Ereignis');
    return parsed;
  };

  it('ist leer, wenn niemand etwas tat', () => {
    expect(revealLayer([revealed(0, 41, [])])).toEqual({ moves: [], fresh: [] });
  });

  it('zeigt die Züge aller Reiche in ihrer Farbe und hebt geänderte Felder hervor', () => {
    const layer = revealLayer([
      revealed(
        2,
        41,
        [
          { kind: 'BUILD', region: 7 },
          { kind: 'RECRUIT', region: 2, count: 2 },
          { kind: 'TRADE', give: 'BREAD', count: 1 },
        ],
        [{ region: 7, building: 'VILLAGE' }],
      ),
      revealed(0, 42, [
        { kind: 'MOVE', from: 11, to: 15, count: 1 },
        { kind: 'MOVE', from: 11, to: 15, count: 1 },
      ]),
    ]);
    expect(layer.moves).toEqual([{ from: 11, to: 15, count: 2, seat: 0 }]);
    expect([...layer.fresh].sort((a, b) => a - b)).toEqual([2, 7, 15]);
  });

  it('nennt als Bewegung je Feld, was gebaut wurde und wie viele Armeen kamen und gingen (ADR-067)', () => {
    const motion = revealMotion([
      revealed(
        2,
        41,
        [
          { kind: 'BUILD', region: 7 },
          { kind: 'RECRUIT', region: 2, count: 2 },
          { kind: 'RECRUIT', region: 2, count: 1 },
          { kind: 'MOVE', from: 2, to: 6, count: 1 },
          { kind: 'TRADE', give: 'BREAD', count: 1 },
        ],
        [{ region: 7, building: 'VILLAGE' }],
      ),
      revealed(0, 42, [
        { kind: 'MOVE', from: 11, to: 15, count: 1 },
        { kind: 'MOVE', from: 11, to: 15, count: 1 },
      ]),
    ]);
    expect(motion.kind).toBe('orders');
    expect(motion.fields).toEqual({
      7: { built: true },
      2: { recruited: 3, left: 1 },
      6: { arrived: 1 },
      11: { left: 2 },
      15: { arrived: 2 },
    });
  });

  it('kennt keine Bewegung, wenn niemand etwas tat', () => {
    expect(revealMotion([revealed(0, 41, [])])).toEqual({ kind: 'orders', fields: {} });
  });
});

describe('Schild über einem entschiedenen Duell', () => {
  const duel = (partial: Record<string, unknown>): MatchEventOf<'REALM_DUEL_RESOLVED'> => {
    const parsed = event(50, 'REALM_DUEL_RESOLVED', {
      round: 2,
      duel: 3,
      attacker: 2,
      defender: 1,
      region: 12,
      category: 'HISTORY',
      winner: 'ATTACKER',
      reason: 'TRIVIA',
      effect: 'CONQUERED',
      building: 'NONE',
      castleLivesLeft: null,
      regionValue: 100,
      armyLost: null,
      ...partial,
    });
    if (parsed.type !== 'REALM_DUEL_RESOLVED') throw new Error('falsches Ereignis');
    return parsed;
  };

  it('unterscheidet beim beschädigten Gebäude Dorf und Stadt', () => {
    expect(outcomeSignKey(duel({ effect: 'BUILDING_DAMAGED', building: 'NONE' }))).toBe(
      'VILLAGE_GONE',
    );
    expect(outcomeSignKey(duel({ effect: 'BUILDING_DAMAGED', building: 'VILLAGE' }))).toBe(
      'TOWN_DOWN',
    );
    expect(outcomeSignKey(duel({ effect: 'CASTLE_HIT', building: 'CASTLE' }))).toBe('CASTLE_HIT');
  });

  it('steht in der Farbe des Siegers über dem umkämpften Feld', () => {
    expect(outcomeSign(duel({}))).toEqual({ region: 12, text: 'erobert', seat: 2 });
    expect(
      outcomeSign(duel({ winner: 'DEFENDER', effect: 'FORTIFIED', regionValue: 200 })),
    ).toEqual({ region: 12, text: 'gehalten', seat: 1 });
    expect(outcomeSign(duel({ effect: 'TAKEOVER', building: 'CASTLE' })).text).toBe('Reich fällt');
    expect(outcomeSign(duel({ effect: 'BUILDING_DAMAGED', building: 'VILLAGE' })).text).toBe(
      'Stadt wird Dorf',
    );
  });

  it('lässt als Bewegung ein beschädigtes Gebäude fallen: was vorher stand (ADR-067)', () => {
    expect(outcomeMotion(duel({ effect: 'BUILDING_DAMAGED', building: 'VILLAGE' })).fields).toEqual(
      { 12: { fell: 'TOWN' } },
    );
    expect(outcomeMotion(duel({ effect: 'BUILDING_DAMAGED', building: 'NONE' })).fields).toEqual({
      12: { fell: 'VILLAGE' },
    });
  });

  it('lässt eine genommene Burg in der Farbe dessen einstürzen, der sie verlor', () => {
    for (const effect of ['CASTLE_DESTROYED', 'TAKEOVER']) {
      const motion = outcomeMotion(
        duel({ effect, castleLivesLeft: 0, armyLost: { seat: 1, region: 12 } }),
      );
      expect(motion.kind).toBe('outcome');
      expect(motion.fields).toEqual({ 12: { fell: 'CASTLE', fellOf: 1, lost: 1 } });
    }
  });

  it('zeigt die verlorene Armee dort, wo sie stand, auch neben dem umkämpften Feld', () => {
    const held = outcomeMotion(
      duel({ winner: 'DEFENDER', effect: 'FORTIFIED', armyLost: { seat: 2, region: 7 } }),
    );
    expect(held.fields).toEqual({ 7: { lost: 2 } });
    // Eine Burg, die nur getroffen wird, bleibt stehen; ohne Verlust bewegt sich nichts
    expect(outcomeMotion(duel({ effect: 'CASTLE_HIT', castleLivesLeft: 2 })).fields).toEqual({});
    expect(outcomeMotion(duel({})).fields).toEqual({});
  });

  it('freies Feld (O-37): genommen in der Farbe des Angreifers, sonst ohne Farbe', () => {
    const claimed = duel({ defender: null, effect: 'CLAIMED' });
    expect(outcomeSignKey(claimed)).toBe('CLAIMED');
    expect(outcomeSign(claimed)).toEqual({ region: 12, text: 'genommen', seat: 2 });
    expect(outcomeSign(duel({ defender: null, winner: 'NONE', effect: 'UNCLAIMED' }))).toEqual({
      region: 12,
      text: 'bleibt frei',
      seat: null,
    });
  });
});
