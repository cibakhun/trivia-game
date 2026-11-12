import { realmWheelSchema, type MatchEventOf, type RealmOrderDto } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  logText,
  outcomeTexts,
  questionContext,
  regionNames,
  seatNames,
  stepLabel,
} from '../src/match/match-text.ts';
import { realmPlayOf, wheelPreview, type RealmPlay } from '../src/match/realm-model.ts';
import {
  buildingMark,
  categoryName,
  fieldYield,
  orderChips,
  placeName,
  revealedParts,
  targetWinKey,
  terrainName,
  wheelFits,
} from '../src/match/realm-text.ts';
import { event, realmViewOf, type RealmViewOptions } from './match-fixtures.ts';

/**
 * Texte der Partie mit Ausbau: Namen, Befehle als Plättchen, das Aufgedeckte und was ein Sieg am
 * Ziel bewirkt. Grundbild (match-fixtures): Ich bin Anna auf Sitz 2 mit der Burg Graufurt (2), der
 * Stadt Dornfeld (6), dem Dorf Birkental (5) und dem freien Feld Eisenhang (7).
 */

function playOf(options: RealmViewOptions = {}): RealmPlay {
  const play = realmPlayOf(realmViewOf(options));
  if (!play) throw new Error('Ansicht ohne Brett');
  return play;
}

const view = realmViewOf();
const play = playOf();
const region = regionNames(play.map);
const name = seatNames(view);

describe('Namen', () => {
  it('nennt Kategorien auf Deutsch, lange mit einer weichen Trennstelle', () => {
    expect(categoryName('HISTORY')).toBe('Geschichte');
    expect(categoryName('ARTS_CULTURE')).toBe('Kunst und Kultur');
    expect(categoryName('SCIENCE')).toBe('Natur­wissenschaft');
    expect(categoryName('GENERAL').replace('­', '')).toBe('Allgemeinwissen');
  });

  it('nennt ein Feld mit seinem Gebäude', () => {
    expect(placeName('NONE', 'Eisenhang')).toBe('Eisenhang');
    expect(placeName('VILLAGE', 'Birkental')).toBe('Dorf Birkental');
    expect(placeName('TOWN', 'Dornfeld')).toBe('Stadt Dornfeld');
    expect(placeName('CASTLE', 'Graufurt')).toBe('Burg Graufurt');
    expect(buildingMark('TOWN')).toBe('town');
  });

  it('nennt die Landschaft eines Felds', () => {
    expect(terrainName(play, 7)).toBe('Bergland');
    expect(terrainName(play, 12)).toBe('Seeland');
  });
});

describe('Ertrag eines Felds', () => {
  it('folgt dem Rohstoff des Felds und der Stufe des Gebäudes', () => {
    // Eisenhang bringt Baustoff, Dornfeld Brot
    expect(fieldYield(play, 7, 'NONE')).toEqual({ bread: 0, material: 1 });
    expect(fieldYield(play, 7, 'VILLAGE')).toEqual({ bread: 0, material: 3 });
    expect(fieldYield(play, 6, 'TOWN')).toEqual({ bread: 4, material: 0 });
  });

  it('gibt bei einer Burg beides', () => {
    expect(fieldYield(play, 2, 'CASTLE')).toEqual({ bread: 2, material: 2 });
  });
});

describe('Befehle als Plättchen', () => {
  const orders: RealmOrderDto[] = [
    { kind: 'TRADE', give: 'MATERIAL', count: 2 },
    { kind: 'BUILD', region: 7 },
    { kind: 'BUILD', region: 5 },
    { kind: 'BUILD', region: 6 },
    { kind: 'RECRUIT', region: 2, count: 1 },
    { kind: 'MOVE', from: 2, to: 6, count: 2 },
  ];
  const chips = orderChips(play, orders, region);

  it('behält Reihenfolge und Stelle im Entwurf', () => {
    expect(chips.map((chip) => chip.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(chips.map((chip) => chip.kind)).toEqual([
      'TRADE',
      'BUILD',
      'BUILD',
      'BUILD',
      'RECRUIT',
      'MOVE',
    ]);
  });

  it('zeigt beim Bau die Stufe, die entsteht', () => {
    expect(chips.slice(1, 4).map((chip) => [chip.icon, chip.text, chip.label])).toEqual([
      ['village', 'Dorf', 'Dorf in Eisenhang'],
      ['town', 'Stadt', 'Stadt in Birkental'],
      ['castle', 'Burg', 'Burg in Dornfeld'],
    ]);
  });

  it('rechnet den Tausch mit dem Kurs der Partie', () => {
    const trade = chips[0];
    expect(trade).toMatchObject({ icon: 'material', tail: 'bread', text: '6 → 2' });
    expect(trade?.label).toBe('6 Baustoff gegen 2 Brot tauschen');
    const back = orderChips(play, [{ kind: 'TRADE', give: 'BREAD', count: 1 }], region)[0];
    expect(back).toMatchObject({ icon: 'bread', tail: 'material', text: '3 → 1' });
    expect(back?.label).toBe('3 Brot gegen 1 Baustoff tauschen');
  });

  it('sagt bei Kauf und Zug, wie viele Armeen wohin', () => {
    expect(chips[4]).toMatchObject({ icon: 'army', tail: null, text: '+1' });
    expect(chips[4]?.label).toBe('1 Armee in Graufurt kaufen');
    expect(chips[5]).toMatchObject({ icon: 'move', text: '2' });
    expect(chips[5]?.label).toBe('2 Armeen von Graufurt nach Dornfeld ziehen');
  });
});

describe('Aufgedeckte Befehle', () => {
  const revealed = (summary: Record<string, unknown>) => {
    const parsed = event(41, 'ORDERS_REVEALED', {
      round: 2,
      seat: 2,
      orders: [],
      summary: { built: [], recruited: 0, moved: 0, traded: 0, ...summary },
      bread: 3,
      material: 4,
    });
    if (parsed.type !== 'ORDERS_REVEALED') throw new Error('falsches Ereignis');
    return parsed;
  };

  it('ist leer, wenn ein Reich nicht gerüstet hat', () => {
    expect(revealedParts(revealed({}), region)).toEqual([]);
  });

  it('nennt Bauten einzeln, Armeen in einer Zeile und den Tausch', () => {
    const parts = revealedParts(
      revealed({
        built: [
          { region: 7, building: 'VILLAGE' },
          { region: 6, building: 'CASTLE' },
        ],
        recruited: 2,
        moved: 1,
        traded: 3,
      }),
      region,
    );
    expect(parts).toEqual([
      { icon: 'village', text: 'Dorf in Eisenhang' },
      { icon: 'castle', text: 'Burg in Dornfeld' },
      { icon: 'army', text: '2 gekauft, 1 gezogen' },
      { icon: 'trade', text: '3 mal getauscht' },
    ]);
  });

  it('lässt weg, was nicht vorkam', () => {
    expect(revealedParts(revealed({ moved: 2 }), region)).toEqual([
      { icon: 'army', text: '2 gezogen' },
    ]);
  });
});

describe('Was ein Sieg am Ziel bewirkt', () => {
  const target = (p: RealmPlay, id: number) => {
    const found = p.board.regions[id];
    if (!found) throw new Error('Feld fehlt');
    return found;
  };

  it('folgt dem Gebäude des Ziels', () => {
    expect(targetWinKey(play, target(play, 14))).toBe('NONE');
    expect(targetWinKey(play, target(play, 12))).toBe('VILLAGE');
    expect(targetWinKey(play, target(play, 13))).toBe('TOWN');
  });

  it('nennt ein freies Feld beim Namen: Dort wird nur der Angreifer gefragt', () => {
    const free = playOf({ free: [4] });
    expect(targetWinKey(free, target(free, 4))).toBe('FREE');
  });

  it('unterscheidet bei der Burg Treffer, Zerstörung und Übernahme', () => {
    expect(targetWinKey(play, target(play, 18))).toBe('CASTLE_HIT');
    const last = { ...target(play, 18), castleLivesLeft: 1 };
    expect(targetWinKey(play, last)).toBe('TAKEOVER');
    // Mit einer zweiten Burg fällt nur diese
    const two = playOf({ buildings: { 13: 'CASTLE' } });
    expect(targetWinKey(two, { ...target(two, 18), castleLivesLeft: 1 })).toBe('CASTLE_DESTROYED');
  });
});

describe('Wem die gezogene Kategorie liegt', () => {
  const favorites = (seat: number) =>
    play.board.seats.find((s) => s.seat === seat)?.favorites ?? [];

  it('spricht den Beteiligten an und nennt sonst den Namen', () => {
    // Geschichte liegt Sitz 2 und Sitz 0, Technik nur Sitz 1, Politik niemandem
    expect(wheelFits('LITERATURE', favorites, 2, 1, 2, name)).toBe('liegt dir');
    expect(wheelFits('TECHNOLOGY', favorites, 2, 1, 2, name)).toBe('liegt Bot (schwer)');
    expect(wheelFits('POLITICS_SOCIETY', favorites, 2, 1, 2, name)).toBe('liegt keinem von beiden');
    expect(wheelFits('HISTORY', favorites, 2, 0, 2, name)).toBe('liegt euch beiden');
  });

  it('spricht als Zuschauer von beiden', () => {
    expect(wheelFits('GENERAL', favorites, 0, 1, 2, name)).toBe('liegt beiden');
    expect(wheelFits('SPORTS', favorites, 0, 1, 2, name)).toBe('liegt Bot (leicht)');
    expect(wheelFits('SPORTS', favorites, 0, 1, null, name)).toBe('liegt Bot (leicht)');
  });

  it('kennt beim freien Feld nur den Angreifer', () => {
    expect(wheelFits('LITERATURE', favorites, 2, null, 2, name)).toBe('liegt dir');
    expect(wheelFits('TECHNOLOGY', favorites, 2, null, 2, name)).toBe(
      'keine deiner Lieblingskategorien',
    );
    expect(wheelFits('SPORTS', favorites, 0, null, 2, name)).toBe('liegt Bot (leicht)');
    expect(wheelFits('TECHNOLOGY', favorites, 0, null, null, name)).toBe(
      'keine Lieblingskategorie von Bot (leicht)',
    );
  });

  it('passt zur Vorschau des Rads: Meine Lieblingskategorien tragen meine Lose', () => {
    const wheel = realmWheelSchema.parse(wheelPreview(play, 2, 12));
    const mine = wheel.segments.filter((s) => s.attacker > 0).map((s) => s.category);
    expect(mine.sort()).toEqual([...favorites(2)].sort());
  });
});

describe('Angriff auf ein freies Feld in Worten (O-37)', () => {
  const claimView = realmViewOf({
    free: [4],
    step: { kind: 'DUEL_TRIVIA', round: 2, attacker: 0, defender: null, region: 4 },
  });
  const claim = (partial: Record<string, unknown> = {}): MatchEventOf<'REALM_DUEL_RESOLVED'> => {
    const parsed = event(60, 'REALM_DUEL_RESOLVED', {
      round: 2,
      duel: 3,
      attacker: 0,
      defender: null,
      region: 4,
      category: 'HISTORY',
      winner: 'ATTACKER',
      reason: 'TRIVIA',
      effect: 'CLAIMED',
      building: 'NONE',
      castleLivesLeft: null,
      regionValue: 100,
      armyLost: null,
      ...partial,
    });
    if (parsed.type !== 'REALM_DUEL_RESOLVED') throw new Error('falsches Ereignis');
    return parsed;
  };

  it('sagt zur Frage, wer das Feld angreift und was die richtige Antwort bringt', () => {
    expect(questionContext(claimView, name, region)).toBe(
      'Bot (leicht) greift das freie Feld Ackerbrunn an: Mit der richtigen Antwort gehört es ihm.',
    );
  });

  it('nennt im Verlauf die Ansage und den Ausgang ohne Verteidiger', () => {
    const chosen = event(58, 'TARGET_CHOSEN', {
      round: 2,
      attacker: 0,
      defender: null,
      region: 4,
      wheel: realmWheelSchema.parse(wheelPreview(playOf({ free: [4] }), 0, 4)),
    });
    expect(logText(chosen, name, region)).toBe('Bot (leicht) greift das freie Feld Ackerbrunn an.');
    expect(outcomeTexts(claim(), name, region)).toEqual([
      'Bot (leicht) lag bei der Wissensfrage richtig.',
      'Bot (leicht) nimmt das freie Feld Ackerbrunn.',
    ]);
    const missed = claim({ winner: 'NONE', effect: 'UNCLAIMED' });
    expect(outcomeTexts(missed, name, region)).toEqual([
      'Bot (leicht) lag bei der Wissensfrage nicht richtig.',
      'Ackerbrunn bleibt frei.',
    ]);
    expect(logText(missed, name, region)).toBe('Ackerbrunn bleibt frei.');
  });

  it('zählt im Band die Runden der Landnahme mit', () => {
    const land = realmViewOf({ step: { kind: 'LAND_ESTIMATE', round: 1 } });
    expect(stepLabel(land)).toBe('Landnahme · 1 von 2');
    // Partien von vor ADR-062 haben keine feste Zahl
    const realm = land.realm;
    if (!realm) throw new Error('Ansicht ohne Ausbau');
    const economy = { ...realm.economy };
    delete economy.landGrabRounds;
    expect(stepLabel({ ...land, realm: { ...realm, economy } })).toBe('Landnahme · Runde 1');
  });
});
