import {
  DEFAULT_REALM_RULES,
  matchRulesForSeats,
  QUESTION_CATEGORIES,
  type QuestionCategory,
  type RealmRules,
} from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  applyRealmInput,
  buildRealmWheel,
  castlesOf,
  checkRealmOrders,
  chooseRegionForRealmBot,
  createRealm,
  createRng,
  generateNpcAnswer,
  generateRealmBotAnswer,
  KERNMARK,
  MATCH_BOT_PROFILES,
  matchMap,
  parseDecimal,
  REALM_FAVORITE_THETA_BONUS,
  realmAttackOrder,
  realmFreeRegions,
  realmIncome,
  realmLegalRegions,
  realmStandings,
  realmTurnOrder,
  realmWheel,
  realmWheelShares,
  regionDistance,
  regionResource,
  spinRealmWheel,
  WENDELMARK,
  type MatchEstimateAnswer,
  type RealmEvent,
  type RealmInput,
  type RealmOrder,
  type RealmRegionState,
  type RealmResult,
  type RealmSeatState,
  type RealmState,
  type RealmStep,
} from '../src/index.ts';

const THREE: RealmRules = DEFAULT_REALM_RULES;
const TWO: RealmRules = matchRulesForSeats(DEFAULT_REALM_RULES, 2);
const CATEGORIES: QuestionCategory[] = [...QUESTION_CATEGORIES];
const FAV: QuestionCategory[][] = [
  ['HISTORY', 'GEOGRAPHY', 'SCIENCE', 'TECHNOLOGY'],
  ['SPORTS', 'LITERATURE', 'ARTS_CULTURE', 'MATHEMATICS'],
  ['NATURE_ANIMALS', 'GENERAL', 'POLITICS_SOCIETY', 'HISTORY'],
];

function setupFor(seats: number) {
  return { categories: CATEGORIES, favorites: FAV.slice(0, seats) };
}

function ok(result: RealmResult): { state: RealmState; events: readonly RealmEvent[] } {
  if (!result.ok) throw new Error(`Eingabe abgelehnt: ${result.error}`);
  return result;
}

function apply(state: RealmState, input: RealmInput): RealmState {
  return ok(applyRealmInput(state, input)).state;
}

function answer(distance: string | null, ms: number | null = 5000): MatchEstimateAnswer {
  return { distance: distance === null ? null : parseDecimal(distance), effectiveMs: ms };
}

// Kernmark: links Sitz 0 mit Burg in Hagelstein (6), rechts Sitz 1 mit Burg in Lindenhof (9).
// Grenze: 1–2, 7–2, 7–8, 13–8, 13–14. Kranichsee (8) grenzt an 7 und 13 (Sitz 0) und an 2, 3, 9, 14;
// wer Lindenhof (9) angreift, bekommt dafür 8 zugeschlagen.
const LEFT = new Set([0, 1, 5, 6, 7, 11, 12, 13]);

/** Feldzug zu zweit auf der Kernmark, alle Regionen vergeben, sonst leer. */
function campaign(
  patch: Record<number, Partial<RealmRegionState>> = {},
  step: RealmStep = {
    kind: 'CAMPAIGN_TARGET',
    round: 1,
    attacker: 0,
    attackers: [0, 1],
    queue: [1],
  },
  seats: Partial<RealmSeatState>[] = [],
): RealmState {
  const base = createRealm(TWO, setupFor(2));
  const regions = base.regions.map((r, id): RealmRegionState => {
    const owner = LEFT.has(id) ? 0 : 1;
    const castle = id === 6 || id === 9;
    return {
      ...r,
      owner,
      building: castle ? 'CASTLE' : 'NONE',
      startCastleOf: castle ? owner : null,
      value: castle ? 300 : 100,
      ...patch[id],
    };
  });
  return {
    ...base,
    order: [0, 1],
    regions,
    seats: base.seats.map((s, seat) => ({
      ...s,
      startCastle: seat === 0 ? 6 : 9,
      ...seats[seat],
    })),
    step,
  };
}

function prepare(state: RealmState, round = 1): RealmState {
  return { ...state, step: { kind: 'PREPARE', round, orders: state.seats.map(() => null) } };
}

function orders(state: RealmState, seat: number, list: RealmOrder[]) {
  return checkRealmOrders(state, seat, list);
}

/** Angriff von Sitz 0 auf `region` bis zur Wissensfrage, Kategorie vom Rad. */
function attack(state: RealmState, region: number, category?: QuestionCategory): RealmState {
  const picked = apply(state, { kind: 'PICK_TARGET', seat: 0, region });
  if (picked.step.kind !== 'DUEL_WHEEL') throw new Error('Kein Rad');
  const spun = category ?? picked.step.wheel.segments[0]?.category;
  if (!spun) throw new Error('Leeres Rad');
  return apply(picked, { kind: 'SPIN_WHEEL', category: spun });
}

function resolved(events: readonly RealmEvent[]) {
  const e = events.find((x) => x.kind === 'DUEL_RESOLVED');
  if (!e || e.kind !== 'DUEL_RESOLVED') throw new Error('Kein Duell aufgelöst');
  return e;
}

describe('Partie mit Ausbau: Aufbau', () => {
  it('verlangt Ausbau-Regeln und je Sitz vier verschiedene Lieblingskategorien vom Rad', () => {
    const { economy, ...plain } = TWO;
    void economy;
    expect(() => createRealm(plain as RealmRules, setupFor(2))).toThrow(RangeError);
    expect(() => createRealm(TWO, { categories: CATEGORIES, favorites: FAV.slice(0, 1) })).toThrow(
      RangeError,
    );
    expect(() =>
      createRealm(TWO, { categories: CATEGORIES, favorites: [FAV[0]!.slice(0, 3), FAV[1]!] }),
    ).toThrow(RangeError);
    expect(() =>
      createRealm(TWO, {
        categories: CATEGORIES,
        favorites: [['HISTORY', 'HISTORY', 'SPORTS', 'GENERAL'], FAV[1]!],
      }),
    ).toThrow(RangeError);
    expect(() =>
      createRealm(TWO, { categories: ['HISTORY', 'SPORTS'], favorites: FAV.slice(0, 2) }),
    ).toThrow(RangeError);
    const crowded = { ...TWO, economy: { ...TWO.economy, startArmies: 7 } };
    expect(() => createRealm(crowded, setupFor(2))).toThrow(RangeError);
    const state = createRealm(TWO, setupFor(2));
    expect(state.step).toEqual({ kind: 'START_ESTIMATE' });
    expect(state.regions).toHaveLength(16);
    expect(state.seats.map((s) => [s.bread, s.material])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('Startfrage legt die Reihenfolge fest: Burgen in ihr, Startdörfer rückwärts', () => {
    let state = createRealm(THREE, setupFor(3));
    expect(realmTurnOrder(state).every((t) => t.status === 'NOW')).toBe(true);
    const started = ok(
      applyRealmInput(state, {
        kind: 'START_ESTIMATES',
        answers: [
          { seat: 0, ...answer('40') },
          { seat: 1, ...answer(null, null) },
          { seat: 2, ...answer('3') },
        ],
      }),
    );
    state = started.state;
    expect(state.order).toEqual([2, 0, 1]);
    expect(state.questions).toBe(1);
    expect(started.events[0]).toMatchObject({ kind: 'START_RANKED' });
    expect(state.step).toEqual({ kind: 'CASTLE_PICK', seat: 2 });

    const castles: number[] = [];
    for (const seat of [2, 0, 1]) {
      expect(state.step).toEqual({ kind: 'CASTLE_PICK', seat });
      const legal = realmLegalRegions(state);
      for (const id of legal) {
        for (const c of castles)
          expect(regionDistance(WENDELMARK, id, c)).toBeGreaterThanOrEqual(2);
      }
      const region = chooseRegionForRealmBot(state, createRng(new Uint8Array(16)));
      expect(legal).toContain(region);
      state = apply(state, { kind: 'PICK_CASTLE', seat, region });
      castles.push(region);
      expect(state.regions[region]).toMatchObject({
        owner: seat,
        building: 'CASTLE',
        value: 300,
        armies: 3,
        startCastleOf: seat,
      });
    }
    for (const seat of [1, 0, 2]) {
      expect(state.step).toEqual({ kind: 'VILLAGE_PICK', seat });
      const foreign = castles.filter((c) => state.regions[c]?.owner !== seat);
      const legal = realmLegalRegions(state);
      for (const id of legal) {
        for (const b of foreign)
          expect(regionDistance(WENDELMARK, id, b)).toBeGreaterThanOrEqual(2);
      }
      const region = legal[0] as number;
      state = apply(state, { kind: 'PICK_VILLAGE', seat, region });
      expect(state.regions[region]).toMatchObject({ owner: seat, building: 'VILLAGE', armies: 0 });
      castles.push(region);
    }
    expect(state.step).toEqual({ kind: 'LAND_ESTIMATE', round: 1 });
    expect(realmFreeRegions(state)).toHaveLength(18);
  });

  it('lehnt falsche Eingaben ab', () => {
    const state = createRealm(TWO, setupFor(2));
    expect(applyRealmInput(state, { kind: 'PICK_CASTLE', seat: 0, region: 0 })).toEqual({
      ok: false,
      error: 'WRONG_STEP',
    });
    expect(
      applyRealmInput(state, { kind: 'START_ESTIMATES', answers: [{ seat: 0, ...answer('1') }] }),
    ).toEqual({ ok: false, error: 'INVALID_ANSWERS' });
    const started = apply(state, {
      kind: 'START_ESTIMATES',
      answers: [
        { seat: 0, ...answer('1') },
        { seat: 1, ...answer('2') },
      ],
    });
    expect(applyRealmInput(started, { kind: 'PICK_CASTLE', seat: 1, region: 0 })).toEqual({
      ok: false,
      error: 'NOT_YOUR_TURN',
    });
    expect(applyRealmInput(started, { kind: 'PICK_CASTLE', seat: 0, region: 99 })).toEqual({
      ok: false,
      error: 'INVALID_REGION',
    });
  });

  it('nach der Landnahme: Einkommen, dann Rüstzeit', () => {
    let state = createRealm(TWO, setupFor(2));
    const rng = createRng(new Uint8Array(16).fill(7));
    const events: RealmEvent[] = [];
    let guard = 0;
    while (state.step.kind !== 'PREPARE') {
      if (++guard > 100) throw new Error('Landnahme endet nicht');
      const { step } = state;
      let input: RealmInput;
      if (step.kind === 'START_ESTIMATE' || step.kind === 'LAND_ESTIMATE') {
        const seats = step.kind === 'START_ESTIMATE' ? [0, 1] : [0, 1];
        input = {
          kind: step.kind === 'START_ESTIMATE' ? 'START_ESTIMATES' : 'LAND_ESTIMATES',
          answers: seats.map((seat) => ({ seat, ...answer(String(seat + 1)) })),
        };
      } else {
        const seat =
          step.kind === 'LAND_PICK' ? (step.queue[0] as number) : (step as { seat: number }).seat;
        const region = chooseRegionForRealmBot(state, rng);
        input =
          step.kind === 'CASTLE_PICK'
            ? { kind: 'PICK_CASTLE', seat, region }
            : step.kind === 'VILLAGE_PICK'
              ? { kind: 'PICK_VILLAGE', seat, region }
              : { kind: 'PICK_REGION', seat, region };
      }
      const r = ok(applyRealmInput(state, input));
      state = r.state;
      events.push(...r.events);
    }
    expect(events.filter((e) => e.kind === 'LAND_RANKED')).toHaveLength(4);
    expect(realmFreeRegions(state)).toHaveLength(0);
    const income = events.at(-1);
    expect(income?.kind).toBe('INCOME');
    for (const seat of [0, 1]) {
      const expected = realmIncome(state, seat);
      expect(state.seats[seat]).toMatchObject(expected);
      expect(expected.bread + expected.material).toBeGreaterThan(4);
    }
    expect(state.step).toEqual({ kind: 'PREPARE', round: 1, orders: [null, null] });
    expect(realmTurnOrder(state)).toEqual([
      { seat: 0, status: 'NOW' },
      { seat: 1, status: 'NOW' },
    ]);
  });
});

describe('Rohstoffe', () => {
  it('Wendelmark 11 Brot und 13 Baustoff, Kernmark 9 und 7', () => {
    const count = (map: typeof WENDELMARK, r: 'BREAD' | 'MATERIAL') =>
      map.regions.filter((x) => regionResource(map, x.id) === r).length;
    expect([count(WENDELMARK, 'BREAD'), count(WENDELMARK, 'MATERIAL')]).toEqual([11, 13]);
    expect([count(KERNMARK, 'BREAD'), count(KERNMARK, 'MATERIAL')]).toEqual([9, 7]);
    expect(matchMap('KERNMARK')).toBe(KERNMARK);
  });

  it('Ertrag: Feld 1, Dorf 2, Stadt 3 seines Rohstoffs, Burg 2 Brot und 2 Baustoff', () => {
    // Sitz 0: Burg 6, Felder 0 (Brot), 1 (Baustoff), 5 (Brot), 7 (Brot), 11, 12 (Baustoff), 13 (Brot)
    const plain = campaign();
    expect(realmIncome(plain, 0)).toEqual({ bread: 2 + 4, material: 2 + 3 });
    const built = campaign({ 0: { building: 'VILLAGE' }, 1: { building: 'TOWN' } });
    expect(realmIncome(built, 0)).toEqual({ bread: 2 + 4 + 1, material: 2 + 3 + 2 });
  });
});

describe('Rüstzeit', () => {
  const rich = (state: RealmState) => ({
    ...state,
    seats: state.seats.map((s) => ({ ...s, bread: 30, material: 40 })),
  });

  it('baut Dorf, Stadt und Burg zu ihren Preisen, eine Stufe je Feld und Runde', () => {
    const state = prepare(rich(campaign({ 1: { building: 'VILLAGE' }, 7: { building: 'TOWN' } })));
    const check = orders(state, 0, [
      { kind: 'BUILD', region: 0 },
      { kind: 'BUILD', region: 1 },
      { kind: 'BUILD', region: 7 },
    ]);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.bread).toBe(30 - 1 - 2 - 8);
    expect(check.material).toBe(40 - 3 - 6 - 16);
    expect(check.regions.get(0)?.building).toBe('VILLAGE');
    expect(check.regions.get(1)?.building).toBe('TOWN');
    expect(check.regions.get(7)?.building).toBe('CASTLE');
    expect(
      orders(state, 0, [
        { kind: 'BUILD', region: 0 },
        { kind: 'BUILD', region: 0 },
      ]),
    ).toEqual({ ok: false, error: 'ALREADY_BUILT', index: 1 });
    expect(orders(state, 0, [{ kind: 'BUILD', region: 6 }])).toEqual({
      ok: false,
      error: 'MAX_LEVEL',
      index: 0,
    });
    expect(orders(state, 0, [{ kind: 'BUILD', region: 8 }])).toEqual({
      ok: false,
      error: 'NOT_OWN_REGION',
      index: 0,
    });
  });

  it('höchstens zwei Burgen je Reich', () => {
    const state = prepare(rich(campaign({ 7: { building: 'CASTLE' }, 1: { building: 'TOWN' } })));
    expect(castlesOf(state, 0)).toEqual([6, 7]);
    expect(orders(state, 0, [{ kind: 'BUILD', region: 1 }])).toEqual({
      ok: false,
      error: 'CASTLE_LIMIT',
      index: 0,
    });
  });

  it('tauscht 3 zu 1 und rechnet die Reihenfolge der Befehle', () => {
    const state = prepare(campaign({}, undefined, [{ bread: 0, material: 6 }]));
    expect(orders(state, 0, [{ kind: 'BUILD', region: 0 }])).toEqual({
      ok: false,
      error: 'TOO_EXPENSIVE',
      index: 0,
    });
    const check = orders(state, 0, [
      { kind: 'TRADE', give: 'MATERIAL', count: 1 },
      { kind: 'BUILD', region: 0 },
    ]);
    expect(check).toMatchObject({ ok: true, bread: 0, material: 0 });
    expect(orders(state, 0, [{ kind: 'TRADE', give: 'BREAD', count: 1 }])).toMatchObject({
      ok: false,
      error: 'TOO_EXPENSIVE',
    });
    expect(orders(state, 0, [{ kind: 'TRADE', give: 'MATERIAL', count: 0 }])).toMatchObject({
      ok: false,
      error: 'INVALID',
    });
  });

  it('Armeen: kaufen nur in einer Burg, ziehen ein Feld durch eigenes Land, höchstens 6 je Feld', () => {
    const state = prepare(
      campaign({ 6: { armies: 3 }, 7: { armies: 5 } }, undefined, [{ bread: 10, material: 0 }]),
    );
    expect(orders(state, 0, [{ kind: 'RECRUIT', region: 7, count: 1 }])).toEqual({
      ok: false,
      error: 'NOT_A_CASTLE',
      index: 0,
    });
    const bought = orders(state, 0, [{ kind: 'RECRUIT', region: 6, count: 3 }]);
    expect(bought).toMatchObject({ ok: true, bread: 4 });
    // Neu gekaufte ziehen erst nächste Runde: nur die drei vom Rundenbeginn dürfen los
    expect(
      orders(state, 0, [
        { kind: 'RECRUIT', region: 6, count: 3 },
        { kind: 'MOVE', from: 6, to: 12, count: 4 },
      ]),
    ).toEqual({ ok: false, error: 'NOT_ENOUGH_ARMIES', index: 1 });
    // Wer schon gezogen ist, zieht nicht weiter
    expect(
      orders(state, 0, [
        { kind: 'MOVE', from: 6, to: 12, count: 3 },
        { kind: 'MOVE', from: 12, to: 13, count: 1 },
      ]),
    ).toEqual({ ok: false, error: 'NOT_ENOUGH_ARMIES', index: 1 });
    expect(orders(state, 0, [{ kind: 'MOVE', from: 6, to: 13, count: 1 }])).toEqual({
      ok: false,
      error: 'NOT_NEIGHBORS',
      index: 0,
    });
    expect(orders(state, 0, [{ kind: 'MOVE', from: 7, to: 8, count: 1 }])).toEqual({
      ok: false,
      error: 'NOT_OWN_REGION',
      index: 0,
    });
    expect(orders(state, 0, [{ kind: 'MOVE', from: 6, to: 7, count: 2 }])).toEqual({
      ok: false,
      error: 'ARMY_CAP',
      index: 0,
    });
    // Erst weg, dann hin: am Ende zählt das Feld
    expect(
      orders(state, 0, [
        { kind: 'MOVE', from: 6, to: 7, count: 2 },
        { kind: 'MOVE', from: 7, to: 13, count: 2 },
      ]),
    ).toMatchObject({ ok: true });
    expect(orders(state, 0, [{ kind: 'RECRUIT', region: 6, count: 1.5 }])).toMatchObject({
      ok: false,
      error: 'INVALID',
    });
  });

  it('verdeckt und gleichzeitig: Befehle wirken erst beim Aufdecken, spätere ersetzen frühere', () => {
    const state = prepare(
      campaign({ 6: { armies: 3 }, 9: { armies: 2 } }, undefined, [
        { bread: 4, material: 3 },
        { bread: 2, material: 0 },
      ]),
    );
    const first = apply(state, {
      kind: 'SUBMIT_ORDERS',
      seat: 0,
      orders: [{ kind: 'BUILD', region: 0 }],
    });
    expect(first.step.kind).toBe('PREPARE');
    expect(first.regions).toEqual(state.regions);
    expect(realmTurnOrder(first)).toEqual([
      { seat: 0, status: 'DONE' },
      { seat: 1, status: 'NOW' },
    ]);
    const replaced = apply(first, {
      kind: 'SUBMIT_ORDERS',
      seat: 0,
      orders: [{ kind: 'MOVE', from: 6, to: 7, count: 3 }],
    });
    const done = ok(
      applyRealmInput(replaced, {
        kind: 'SUBMIT_ORDERS',
        seat: 1,
        orders: [{ kind: 'RECRUIT', region: 9, count: 1 }],
      }),
    );
    expect(done.state.step).toMatchObject({ kind: 'CAMPAIGN_TARGET', round: 1, attacker: 0 });
    expect(done.state.regions[0]?.building).toBe('NONE');
    expect(done.state.regions[7]?.armies).toBe(3);
    expect(done.state.regions[9]?.armies).toBe(3);
    expect(done.state.seats[1]).toMatchObject({ bread: 0 });
    expect(done.events.filter((e) => e.kind === 'ORDERS_REVEALED').map((e) => e.seat)).toEqual([
      0, 1,
    ]);
  });

  it('Rüstzeit abgelaufen: Wer nichts abgab, tut nichts', () => {
    const state = prepare(campaign({}, undefined, [{ bread: 4, material: 3 }]));
    const first = apply(state, {
      kind: 'SUBMIT_ORDERS',
      seat: 0,
      orders: [{ kind: 'BUILD', region: 0 }],
    });
    const closed = ok(applyRealmInput(first, { kind: 'CLOSE_PREPARE' }));
    expect(closed.state.regions[0]?.building).toBe('VILLAGE');
    expect(closed.events.find((e) => e.kind === 'ORDERS_REVEALED' && e.seat === 1)).toMatchObject({
      orders: [],
    });
  });

  it('meldet ungültige Befehle mit Grund und Stelle', () => {
    const state = prepare(campaign());
    expect(
      applyRealmInput(state, {
        kind: 'SUBMIT_ORDERS',
        seat: 0,
        orders: [{ kind: 'BUILD', region: 0 }],
      }),
    ).toEqual({
      ok: false,
      error: 'INVALID_ORDERS',
      orderError: { error: 'TOO_EXPENSIVE', index: 0 },
    });
  });
});

describe('Glücksrad', () => {
  it('Beispiel aus dem Konzept: 3 Armeen gegen Dorf und eine Armee ergibt 37,5 / 37,5 / 25 %', () => {
    const state = campaign({ 7: { armies: 3 }, 8: { building: 'VILLAGE' }, 9: { armies: 1 } });
    const wheel = realmWheel(state, 0, 8);
    expect([wheel.attackerLots, wheel.defenderLots, wheel.freeLots]).toEqual([3, 3, 2]);
    expect(realmWheelShares(wheel)).toEqual({ attacker: 0.375, defender: 0.375, free: 0.25 });
    // Je Lieblingskategorie ein Viertel der Lose, freie gleich auf alle elf
    const history = wheel.segments.find((s) => s.category === 'HISTORY');
    const sports = wheel.segments.find((s) => s.category === 'SPORTS');
    const general = wheel.segments.find((s) => s.category === 'GENERAL');
    expect(history?.weight).toBe(sports?.weight);
    expect((history?.weight ?? 0) / wheel.total).toBeCloseTo(3 / 8 / 4 + 2 / 8 / 11, 10);
    expect((general?.weight ?? 0) / wheel.total).toBeCloseTo(2 / 8 / 11, 10);
  });

  it('zählt Armeen auf dem Feld und den Nachbarn, Gebäude nur für den Verteidiger', () => {
    // Sitz 0 auf 7 und 13 (Nachbarn von 8), nicht auf 12; Sitz 1 auf 8 und 14
    const state = campaign({
      7: { armies: 2 },
      13: { armies: 1 },
      12: { armies: 6 },
      8: { armies: 2, building: 'TOWN' },
      14: { armies: 1 },
    });
    const wheel = realmWheel(state, 0, 8);
    expect([wheel.attackerLots, wheel.defenderLots]).toEqual([3, 2 + 1 + 3]);
    const castle = realmWheel(campaign(), 0, 9);
    expect([castle.attackerLots, castle.defenderLots]).toEqual([0, 4]);
  });

  it('ohne Lose ist jede Kategorie gleich wahrscheinlich', () => {
    const wheel = buildRealmWheel(CATEGORIES, FAV[0]!, FAV[1]!, 0, 0, 0);
    expect(new Set(wheel.segments.map((s) => s.weight))).toEqual(new Set([1]));
    const free = realmWheel(campaign(), 0, 8);
    expect(new Set(free.segments.map((s) => s.weight)).size).toBe(1);
  });

  it('gemeinsame Lieblingskategorien zählen für beide', () => {
    const wheel = buildRealmWheel(CATEGORIES, FAV[0]!, FAV[2]!, 2, 2, 0);
    const shared = wheel.segments.find((s) => s.category === 'HISTORY');
    const only = wheel.segments.find((s) => s.category === 'GEOGRAPHY');
    expect(shared?.weight).toBe(2 * (only?.weight ?? 0));
    expect(wheel.segments.find((s) => s.category === 'SPORTS')?.weight).toBe(0);
  });

  it('dreht nach den Gewichten und nimmt nur Kategorien mit Chance', () => {
    const wheel = buildRealmWheel(CATEGORIES, FAV[0]!, FAV[1]!, 6, 2, 0);
    const rng = createRng(new Uint8Array(16).fill(3));
    const counts = new Map<QuestionCategory, number>();
    const spins = 40_000;
    for (let i = 0; i < spins; i++) {
      const c = spinRealmWheel(wheel, rng);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    for (const segment of wheel.segments) {
      const share = (counts.get(segment.category) ?? 0) / spins;
      expect(share).toBeCloseTo(segment.weight / wheel.total, 1);
      if (segment.weight === 0) expect(counts.has(segment.category)).toBe(false);
    }
  });

  it('lehnt eine Kategorie ohne Chance oder außerhalb des Rads ab', () => {
    const rules: RealmRules = {
      ...TWO,
      economy: { ...TWO.economy, lots: { ...TWO.economy.lots, free: 0 } },
    };
    const base = campaign({ 7: { armies: 1 } });
    const state = { ...base, rules };
    const picked = apply(state, { kind: 'PICK_TARGET', seat: 0, region: 8 });
    expect(applyRealmInput(picked, { kind: 'SPIN_WHEEL', category: 'GENERAL' })).toEqual({
      ok: false,
      error: 'INVALID_CATEGORY',
    });
    const next = ok(applyRealmInput(picked, { kind: 'SPIN_WHEEL', category: 'HISTORY' }));
    expect(next.state.step).toMatchObject({ kind: 'DUEL_TRIVIA', category: 'HISTORY' });
  });
});

describe('Duell und seine Folgen', () => {
  const lose = { kind: 'DUEL_TRIVIA', attackerCorrect: false, defenderCorrect: true } as const;
  const win = { kind: 'DUEL_TRIVIA', attackerCorrect: true, defenderCorrect: false } as const;

  it('Verteidiger hält: Region befestigt, Angreifer verliert eine Armee am stärksten Nachbarfeld', () => {
    const state = attack(campaign({ 7: { armies: 2 }, 13: { armies: 4 } }), 8);
    const r = ok(applyRealmInput(state, lose));
    const e = resolved(r.events);
    expect(e).toMatchObject({ effect: 'FORTIFIED', winner: 'DEFENDER', regionValue: 150 });
    expect(e.armyLost).toEqual({ seat: 0, region: 13 });
    expect(r.state.regions[13]?.armies).toBe(3);
    expect(r.state.regions[8]).toMatchObject({ owner: 1, fortifications: 1, value: 150 });
  });

  it('Feld ohne Gebäude wird erobert, Armeen darauf gehen verloren', () => {
    const state = attack(
      campaign({ 7: { armies: 1 }, 8: { armies: 3, fortifications: 1, value: 150 } }),
      8,
    );
    const r = ok(applyRealmInput(state, win));
    expect(resolved(r.events)).toMatchObject({
      effect: 'CONQUERED',
      armyLost: { seat: 1, region: 8 },
      regionValue: 150,
    });
    expect(r.state.regions[8]).toMatchObject({ owner: 0, armies: 0, value: 150 });
    expect(r.state.regions[7]?.armies).toBe(1);
  });

  it('Dorf verschwindet, Stadt wird Dorf; das Feld bleibt beim Verteidiger', () => {
    const village = ok(applyRealmInput(attack(campaign({ 8: { building: 'VILLAGE' } }), 8), win));
    expect(resolved(village.events)).toMatchObject({
      effect: 'BUILDING_DAMAGED',
      building: 'NONE',
      armyLost: null,
    });
    expect(village.state.regions[8]).toMatchObject({ owner: 1, building: 'NONE' });
    const town = ok(applyRealmInput(attack(campaign({ 8: { building: 'TOWN' } }), 8), win));
    expect(town.state.regions[8]).toMatchObject({ owner: 1, building: 'VILLAGE' });
  });

  it('Burg verliert Leben; zerstört geht sie bei zweiter Burg nur als Feld an den Angreifer', () => {
    const hit = ok(applyRealmInput(attack(campaign({ 8: { owner: 0 } }), 9), win));
    expect(resolved(hit.events)).toMatchObject({ effect: 'CASTLE_HIT', castleLivesLeft: 2 });
    expect(hit.state.regions[9]).toMatchObject({ owner: 1, castleHits: 1, building: 'CASTLE' });

    const second = campaign({
      8: { owner: 0 },
      9: { castleHits: 2, armies: 2 },
      3: { building: 'CASTLE' },
    });
    const destroyed = ok(applyRealmInput(attack(second, 9), win));
    expect(resolved(destroyed.events)).toMatchObject({
      effect: 'CASTLE_DESTROYED',
      castleLivesLeft: 0,
      building: 'NONE',
      regionValue: 300,
    });
    expect(destroyed.state.regions[9]).toMatchObject({
      owner: 0,
      building: 'NONE',
      armies: 0,
      startCastleOf: null,
      castleHits: 0,
    });
    expect(destroyed.state.seats[1]?.eliminatedInDuel).toBeNull();
    expect(castlesOf(destroyed.state, 1)).toEqual([3]);
  });

  it('fällt die letzte Burg, geht das ganze Reich mit Gebäuden und Vorräten an den Angreifer', () => {
    const state = campaign(
      { 8: { owner: 0 }, 9: { castleHits: 2, armies: 2 }, 14: { building: 'TOWN', armies: 3 } },
      undefined,
      [
        { bread: 1, material: 2 },
        { bread: 5, material: 7 },
      ],
    );
    const r = ok(applyRealmInput(attack(state, 9), win));
    expect(resolved(r.events)).toMatchObject({ effect: 'TAKEOVER', castleLivesLeft: 0 });
    expect(r.events.find((e) => e.kind === 'KINGDOM_ELIMINATED')).toMatchObject({
      seat: 1,
      by: 0,
      regions: 7,
      bread: 5,
      material: 7,
    });
    expect(r.state.regions.every((x) => x.owner === 0)).toBe(true);
    expect(r.state.regions[14]).toMatchObject({ building: 'TOWN', armies: 0 });
    expect(r.state.regions[9]).toMatchObject({ building: 'NONE', value: 300 });
    expect(r.state.seats[0]).toMatchObject({ bread: 6, material: 9 });
    expect(r.state.seats[1]).toMatchObject({
      bread: 0,
      material: 0,
      eliminatedInDuel: 1,
      eliminatedBy: 0,
    });
    expect(r.state.step).toEqual({ kind: 'FINISHED', reason: 'LAST_KINGDOM', round: 1 });
    const standings = realmStandings(r.state);
    expect(standings[0]).toMatchObject({ seat: 0, place: 1, regions: 16, castleLives: 3 });
    expect(standings[1]).toMatchObject({ seat: 1, place: 2, eliminated: true, points: 0 });
  });

  it('beide richtig: die Schätzfrage entscheidet, gleiche Kategorie bleibt im Ereignis', () => {
    const state = attack(campaign(), 8, 'SPORTS');
    const both = apply(state, {
      kind: 'DUEL_TRIVIA',
      attackerCorrect: true,
      defenderCorrect: true,
    });
    expect(both.step).toMatchObject({ kind: 'DUEL_ESTIMATE', category: 'SPORTS' });
    const r = ok(
      applyRealmInput(both, {
        kind: 'DUEL_ESTIMATES',
        attacker: answer('1'),
        defender: answer('2'),
      }),
    );
    expect(resolved(r.events)).toMatchObject({
      reason: 'ESTIMATE',
      category: 'SPORTS',
      winner: 'ATTACKER',
    });
    expect(r.state.questions).toBe(2);
  });
});

describe('Reihenfolge und Ende', () => {
  it('in der letzten Runde greift zuerst an, wer vorn liegt', () => {
    // Sitz 1 hat mehr Punkte (zwei Befestigungen mehr)
    const ahead = campaign({ 8: { value: 200, fortifications: 2 } });
    expect(realmAttackOrder(ahead, 1)).toEqual([0, 1]);
    expect(realmAttackOrder(ahead, 2)).toEqual([1, 0]);
    expect(realmAttackOrder(ahead, 5)).toEqual([1, 0]);
    expect(realmAttackOrder(campaign({ 7: { value: 200, fortifications: 2 } }), 5)).toEqual([0, 1]);
    const closed = ok(applyRealmInput(prepare(ahead, 5), { kind: 'CLOSE_PREPARE' }));
    expect(closed.state.step).toMatchObject({
      kind: 'CAMPAIGN_TARGET',
      attacker: 1,
      attackers: [1, 0],
    });
  });

  it('nach der fünften Runde wird abgerechnet, sonst folgt Einkommen und Rüstzeit', () => {
    const last = campaign(
      {},
      { kind: 'CAMPAIGN_TARGET', round: 5, attacker: 0, attackers: [1, 0], queue: [] },
    );
    const done = ok(
      applyRealmInput(attack(last, 8), {
        kind: 'DUEL_TRIVIA',
        attackerCorrect: false,
        defenderCorrect: false,
      }),
    );
    expect(done.state.step).toEqual({ kind: 'FINISHED', reason: 'ROUNDS_COMPLETE', round: 5 });
    expect(done.events.at(-1)).toMatchObject({ kind: 'MATCH_FINISHED', reason: 'ROUNDS_COMPLETE' });

    const early = campaign(
      {},
      { kind: 'CAMPAIGN_TARGET', round: 2, attacker: 0, attackers: [1, 0], queue: [] },
    );
    const next = ok(
      applyRealmInput(attack(early, 8), {
        kind: 'DUEL_TRIVIA',
        attackerCorrect: false,
        defenderCorrect: false,
      }),
    );
    expect(next.state.step).toMatchObject({ kind: 'PREPARE', round: 3 });
    expect(next.events.find((e) => e.kind === 'INCOME')).toMatchObject({ round: 3 });
  });

  it('Rangfolge: Punkte, dann Regionen, dann Burgleben', () => {
    const even = campaign();
    expect(realmStandings(even).map((s) => s.place)).toEqual([1, 1]);
    const hit = campaign({ 9: { castleHits: 1 } });
    expect(realmStandings(hit)).toMatchObject([
      { seat: 0, place: 1, castleLives: 3 },
      { seat: 1, place: 2, castleLives: 2 },
    ]);
  });

  it('Zustand und Ereignisse sind reines JSON', () => {
    const state = attack(campaign({ 7: { armies: 2 } }), 8);
    const r = ok(
      applyRealmInput(state, {
        kind: 'DUEL_TRIVIA',
        attackerCorrect: true,
        defenderCorrect: false,
      }),
    );
    expect(JSON.parse(JSON.stringify(r.state))).toEqual(r.state);
    expect(JSON.parse(JSON.stringify(r.events))).toEqual(r.events);
  });
});

describe('Bots im Duell', () => {
  const question = {
    triviaB: 0,
    wrongOptionCount: 3,
    estimate: {
      answerValue: '1000',
      answerPrecision: 0,
      inputMin: '0',
      inputMax: '100000',
      scaleType: 'LINEAR' as const,
      scale: 150,
    },
    estimateTimeLimitMs: 20_000,
  };

  it('Lieblingskategorie hilft bei der Wissensfrage, nicht im Stechen', () => {
    for (let seed = 0; seed < 20; seed++) {
      const rng = () => createRng(new Uint8Array(16).fill(seed));
      const fav = generateRealmBotAnswer(rng(), 'MEDIUM', ['HISTORY'], 'HISTORY', question);
      const other = generateRealmBotAnswer(rng(), 'MEDIUM', ['HISTORY'], 'SPORTS', question);
      expect(fav.audit.theta).toBeCloseTo(
        MATCH_BOT_PROFILES.MEDIUM.theta + REALM_FAVORITE_THETA_BONUS,
      );
      expect(fav.audit.pCorrect).toBeGreaterThan(other.audit.pCorrect);
      // Gleiche Ziehungen: die Schätzung hängt nicht an der Kategorie des Rads
      expect(fav.estimate).toEqual(other.estimate);
      expect(fav.estimateMs).toBe(other.estimateMs);
      expect(fav.audit.draws).toEqual(other.audit.draws);
      // Außerhalb der Lieblingskategorien genau wie das NPC-Modell der Partie
      expect(other).toEqual(generateNpcAnswer(rng(), MATCH_BOT_PROFILES.MEDIUM, question));
    }
  });
});
