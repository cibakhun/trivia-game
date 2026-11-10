import { DEFAULT_MATCH_RULES, matchRulesForSeats, PLAYTEST_MATCH_RULES } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  applyMatchInput,
  autoPickRegion,
  chooseRegionForBot,
  createMatch,
  createRng,
  currentChooser,
  drawSeatOrder,
  freeRegions,
  legalRegions,
  matchPhase,
  matchPoints,
  matchStandings,
  parseDecimal,
  pendingQuestion,
  regionDistance,
  regionNeighbors,
  stepTimeLimitMs,
  WENDELMARK,
  type MatchEstimateAnswer,
  type MatchEvent,
  type MatchInput,
  type MatchRegionState,
  type MatchState,
} from '../src/index.ts';

// Wendelmark-IDs, die die Tests benutzen (Reihen 4, 5, 6, 5, 4 von oben links)
const ESCHENHAIN = 0; // oben links, Hauptstadt von Sitz 0
const FALKENWACHT = 1;
const GRAUFURT = 2;
const FUCHSMOOR = 8;
const LINDENHOF = 13;
const MUEHLBACH = 14; // rechts in der Mitte, Hauptstadt von Sitz 1
const NEBELSENKE = 15;
const OTTERBRUCH = 16;
const SALZWEIDE = 19;
const TANNENRUH = 20; // unten links, Hauptstadt von Sitz 2
const UFERLAND = 21;

function seededRng(i: number) {
  const seed = new Uint8Array(16);
  new DataView(seed.buffer).setUint32(0, i);
  new DataView(seed.buffer).setUint32(8, 0x85ebca6b);
  return createRng(seed);
}

function play(state: MatchState, input: MatchInput): { state: MatchState; events: MatchEvent[] } {
  const result = applyMatchInput(state, input);
  if (!result.ok) throw new Error(`abgelehnt: ${result.error}`);
  return { state: result.state, events: [...result.events] };
}

function est(distance: string | null, effectiveMs: number | null): MatchEstimateAnswer {
  return { distance: distance === null ? null : parseDecimal(distance), effectiveMs };
}

function withCapitals(): MatchState {
  let state = createMatch(DEFAULT_MATCH_RULES);
  state = play(state, { kind: 'PICK_CAPITAL', seat: 0, region: ESCHENHAIN }).state;
  state = play(state, { kind: 'PICK_CAPITAL', seat: 1, region: MUEHLBACH }).state;
  return play(state, { kind: 'PICK_CAPITAL', seat: 2, region: TANNENRUH }).state;
}

/** Landnahme mit festem Ausgang: Sitze der Runde in Reihenfolge, jeweils die erste Wahl. */
function finishLandGrab(start: MatchState): { state: MatchState; events: MatchEvent[] } {
  let state = start;
  const events: MatchEvent[] = [];
  while (matchPhase(state) === 'LAND_GRAB') {
    let result;
    if (state.step.kind === 'LAND_ESTIMATE') {
      const seats = pendingQuestion(state)?.seats ?? [];
      result = play(state, {
        kind: 'LAND_ESTIMATES',
        answers: seats.map((seat, i) => ({ seat, ...est(String(i), 1000) })),
      });
    } else {
      const seat = currentChooser(state) as number;
      result = play(state, { kind: 'PICK_REGION', seat, region: legalRegions(state)[0] as number });
    }
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

/**
 * Feldzug mit fester Karte: Sitz 1 hält Mühlbach (Hauptstadt), Fuchsmoor und Salzweide; Sitz 2
 * Tannenruh (Hauptstadt), Uferland und Nebelsenke; Sitz 0 alles andere mit Eschenhain als
 * Hauptstadt. Sitz 0 greift an.
 */
function campaignState(patch: Partial<MatchState> = {}): MatchState {
  const base = createMatch(DEFAULT_MATCH_RULES);
  const owners = new Map<number, number>([
    [MUEHLBACH, 1],
    [FUCHSMOOR, 1],
    [SALZWEIDE, 1],
    [TANNENRUH, 2],
    [UFERLAND, 2],
    [NEBELSENKE, 2],
  ]);
  const capitals = new Map([
    [ESCHENHAIN, 0],
    [MUEHLBACH, 1],
    [TANNENRUH, 2],
  ]);
  const regions: MatchRegionState[] = base.regions.map((r, id) => ({
    ...r,
    owner: owners.get(id) ?? 0,
    capitalOf: capitals.get(id) ?? null,
    value: capitals.has(id) ? 300 : 100,
  }));
  return {
    ...base,
    regions,
    seats: base.seats.map((s, seat) => ({
      ...s,
      capital: [ESCHENHAIN, MUEHLBACH, TANNENRUH][seat] as number,
    })),
    step: { kind: 'CAMPAIGN_TARGET', round: 1, attacker: 0, queue: [1, 2] },
    ...patch,
  };
}

function duel(
  state: MatchState,
  region: number,
  attackerCorrect: boolean,
  defenderCorrect: boolean,
): { state: MatchState; events: MatchEvent[] } {
  const attacker = currentChooser(state) as number;
  const target = play(state, { kind: 'PICK_TARGET', seat: attacker, region });
  return play(target.state, { kind: 'DUEL_TRIVIA', attackerCorrect, defenderCorrect });
}

describe('Wendelmark', () => {
  it('hat 24 Regionen mit eindeutigen Namen und zusammenhängender, symmetrischer Nachbarschaft', () => {
    expect(WENDELMARK.regions).toHaveLength(24);
    expect(new Set(WENDELMARK.regions.map((r) => r.name)).size).toBe(24);
    WENDELMARK.regions.forEach((region) => {
      const neighbors = regionNeighbors(WENDELMARK, region.id);
      expect(neighbors.length).toBeGreaterThanOrEqual(2);
      for (const n of neighbors) expect(regionNeighbors(WENDELMARK, n)).toContain(region.id);
    });
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length > 0) {
      for (const n of regionNeighbors(WENDELMARK, queue.shift() as number)) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(24);
  });

  it('kennt die Nachbarn und Abstände der Testregionen', () => {
    expect(regionNeighbors(WENDELMARK, TANNENRUH)).toEqual([NEBELSENKE, OTTERBRUCH, UFERLAND]);
    expect(regionNeighbors(WENDELMARK, MUEHLBACH)).toEqual([FUCHSMOOR, LINDENHOF, SALZWEIDE]);
    expect(regionDistance(WENDELMARK, ESCHENHAIN, FALKENWACHT)).toBe(1);
    expect(regionDistance(WENDELMARK, ESCHENHAIN, GRAUFURT)).toBe(2);
  });
});

describe('Aufbau und Abfragen', () => {
  it('beginnt mit freien Regionen und Sitz 0 bei der Hauptstadtwahl', () => {
    const state = createMatch(DEFAULT_MATCH_RULES);
    expect(matchPhase(state)).toBe('CAPITALS');
    expect(state.step).toEqual({ kind: 'CAPITAL_PICK', seat: 0 });
    expect(freeRegions(state)).toHaveLength(24);
    expect(state.regions.every((r) => r.value === 100)).toBe(true);
    expect(currentChooser(state)).toBe(0);
    expect(pendingQuestion(state)).toBeNull();
    expect(stepTimeLimitMs(state)).toBe(10_000);
    expect(stepTimeLimitMs(createMatch(PLAYTEST_MATCH_RULES))).toBe(5_000);
  });

  it('lehnt ungültige Regeln ab', () => {
    expect(() => createMatch({ ...DEFAULT_MATCH_RULES, campaign: { rounds: 0 } })).toThrow();
  });

  it('zieht eine gleichverteilte, reproduzierbare Zugreihenfolge', () => {
    expect(drawSeatOrder(seededRng(1), 3)).toEqual(drawSeatOrder(seededRng(1), 3));
    const counts = new Map<string, number>();
    const rng = seededRng(2);
    for (let i = 0; i < 6000; i++) {
      const order = drawSeatOrder(rng, 3);
      expect([...order].sort()).toEqual([0, 1, 2]);
      counts.set(order.join(), (counts.get(order.join()) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const count of counts.values()) expect(count).toBeGreaterThan(850);
  });

  it('ist reines JSON', () => {
    const { state, events } = finishLandGrab(withCapitals());
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
  });
});

describe('Hauptstadtwahl', () => {
  it('reihum, frei und mit mindestens einem Feld Abstand', () => {
    let state = createMatch(DEFAULT_MATCH_RULES);
    expect(applyMatchInput(state, { kind: 'PICK_CAPITAL', seat: 1, region: 5 })).toEqual({
      ok: false,
      error: 'NOT_YOUR_TURN',
    });
    const first = play(state, { kind: 'PICK_CAPITAL', seat: 0, region: ESCHENHAIN });
    expect(first.events).toEqual([{ kind: 'CAPITAL_CHOSEN', seat: 0, region: ESCHENHAIN }]);
    state = first.state;
    expect(state.regions[ESCHENHAIN]).toMatchObject({ owner: 0, capitalOf: 0, value: 300 });
    expect(state.seats[0]?.capital).toBe(ESCHENHAIN);

    for (const region of [ESCHENHAIN, FALKENWACHT, 99, -1, 1.5]) {
      expect(applyMatchInput(state, { kind: 'PICK_CAPITAL', seat: 1, region })).toEqual({
        ok: false,
        error: 'INVALID_REGION',
      });
    }
    expect(legalRegions(state)).not.toContain(FALKENWACHT);
    expect(legalRegions(state)).toContain(GRAUFURT);
  });

  it('führt nach der dritten Hauptstadt in die erste Landnahmerunde', () => {
    const state = withCapitals();
    expect(state.step).toEqual({ kind: 'LAND_ESTIMATE', round: 1 });
    expect(pendingQuestion(state)).toEqual({ type: 'ESTIMATE', seats: [0, 1, 2] });
    expect(stepTimeLimitMs(state)).toBe(20_000);
    expect(freeRegions(state)).toHaveLength(21);
  });
});

describe('Landnahme', () => {
  it('Abstand vor Zeit: der Erste wählt zwei Regionen, der Zweite eine, der Dritte keine', () => {
    const { state, events } = play(withCapitals(), {
      kind: 'LAND_ESTIMATES',
      answers: [
        { seat: 0, ...est('5', 3000) },
        { seat: 1, ...est('2', 9000) },
        { seat: 2, ...est('2', 4000) },
      ],
    });
    expect(events).toEqual([
      {
        kind: 'LAND_RANKED',
        round: 1,
        ranking: [
          { seat: 2, place: 1, picks: 2, distance: '2', effectiveMs: 4000 },
          { seat: 1, place: 2, picks: 1, distance: '2', effectiveMs: 9000 },
          { seat: 0, place: 3, picks: 0, distance: '5', effectiveMs: 3000 },
        ],
      },
    ]);
    expect(state.step).toEqual({ kind: 'LAND_PICK', round: 1, queue: [2, 2, 1] });
    expect(state.questions).toBe(1);
    expect(currentChooser(state)).toBe(2);
    expect(stepTimeLimitMs(state)).toBe(10_000);

    // Nur am eigenen Gebiet, solange es dort freie Regionen gibt
    expect(legalRegions(state)).toEqual([NEBELSENKE, OTTERBRUCH, UFERLAND]);
    expect(applyMatchInput(state, { kind: 'PICK_REGION', seat: 2, region: 5 })).toEqual({
      ok: false,
      error: 'INVALID_REGION',
    });
    expect(applyMatchInput(state, { kind: 'PICK_REGION', seat: 1, region: LINDENHOF })).toEqual({
      ok: false,
      error: 'NOT_YOUR_TURN',
    });
    const claimed = play(state, { kind: 'PICK_REGION', seat: 2, region: UFERLAND });
    expect(claimed.events).toEqual([
      { kind: 'REGION_CLAIMED', round: 1, seat: 2, region: UFERLAND },
    ]);
    expect(claimed.state.step).toEqual({ kind: 'LAND_PICK', round: 1, queue: [2, 1] });
  });

  it('verpasste Antworten zählen als unendlich, völliger Gleichstand folgt der Rundenreihenfolge', () => {
    const missed = play(withCapitals(), {
      kind: 'LAND_ESTIMATES',
      answers: [
        { seat: 0, ...est(null, null) },
        { seat: 1, ...est('900', 19_000) },
        { seat: 2, ...est('7', null) },
      ],
    });
    expect(missed.state.step).toMatchObject({ queue: [2, 2, 1] });

    // Runde 2 beginnt bei Sitz 1: bei völligem Gleichstand liegt er vorn
    let state = finishRound(withCapitals());
    expect(state.step).toEqual({ kind: 'LAND_ESTIMATE', round: 2 });
    expect(pendingQuestion(state)?.seats).toEqual([1, 2, 0]);
    state = play(state, {
      kind: 'LAND_ESTIMATES',
      answers: [0, 1, 2].map((seat) => ({ seat, ...est('3', 5000) })),
    }).state;
    expect(state.step).toMatchObject({ queue: [1, 1, 2] });
  });

  it('erlaubt jede freie Region, wenn am eigenen Gebiet keine frei ist', () => {
    const base = withCapitals();
    const regions = base.regions.map((r, id) =>
      [NEBELSENKE, OTTERBRUCH, UFERLAND].includes(id) ? { ...r, owner: 1 } : r,
    );
    const state: MatchState = {
      ...base,
      regions,
      step: { kind: 'LAND_PICK', round: 1, queue: [2] },
    };
    expect(legalRegions(state)).toEqual(freeRegions(state));
    expect(
      play(state, { kind: 'PICK_REGION', seat: 2, region: GRAUFURT }).state.regions[GRAUFURT]
        ?.owner,
    ).toBe(2);
  });

  it('lehnt unvollständige, doppelte oder ungültige Antworten ab', () => {
    const state = withCapitals();
    const invalid = [
      [
        { seat: 0, ...est('1', 1) },
        { seat: 1, ...est('1', 1) },
      ],
      [
        { seat: 0, ...est('1', 1) },
        { seat: 0, ...est('1', 1) },
        { seat: 1, ...est('1', 1) },
      ],
      [
        { seat: 0, ...est('1', -5) },
        { seat: 1, ...est('1', 1) },
        { seat: 2, ...est('1', 1) },
      ],
      [
        { seat: 0, ...est('-1', 1) },
        { seat: 1, ...est('1', 1) },
        { seat: 2, ...est('1', 1) },
      ],
    ];
    for (const answers of invalid) {
      expect(applyMatchInput(state, { kind: 'LAND_ESTIMATES', answers })).toEqual({
        ok: false,
        error: 'INVALID_ANSWERS',
      });
    }
    expect(applyMatchInput(state, { kind: 'PICK_REGION', seat: 0, region: 5 })).toEqual({
      ok: false,
      error: 'WRONG_STEP',
    });
  });

  it('vergibt in sieben Runden alle Regionen und beginnt dann den Feldzug', () => {
    const { state, events } = finishLandGrab(withCapitals());
    expect(events.filter((e) => e.kind === 'LAND_RANKED')).toHaveLength(7);
    expect(events.filter((e) => e.kind === 'REGION_CLAIMED')).toHaveLength(21);
    expect(freeRegions(state)).toEqual([]);
    expect(state.questions).toBe(7);
    expect(state.step).toEqual({ kind: 'CAMPAIGN_TARGET', round: 1, attacker: 0, queue: [1, 2] });
    expect(matchPhase(state)).toBe('CAMPAIGN');
  });
});

function finishRound(start: MatchState): MatchState {
  let state = play(start, {
    kind: 'LAND_ESTIMATES',
    answers: [0, 1, 2].map((seat) => ({ seat, ...est(String(seat), 1000) })),
  }).state;
  while (state.step.kind === 'LAND_PICK') {
    const seat = currentChooser(state) as number;
    state = play(state, {
      kind: 'PICK_REGION',
      seat,
      region: legalRegions(state)[0] as number,
    }).state;
  }
  return state;
}

describe('Feldzug', () => {
  it('greift nur gegnerische Nachbarregionen an', () => {
    const state = campaignState();
    expect(legalRegions(state)).toEqual([
      FUCHSMOOR,
      MUEHLBACH,
      NEBELSENKE,
      SALZWEIDE,
      TANNENRUH,
      UFERLAND,
    ]);
    expect(applyMatchInput(state, { kind: 'PICK_TARGET', seat: 0, region: LINDENHOF })).toEqual({
      ok: false,
      error: 'INVALID_REGION',
    });
    expect(applyMatchInput(state, { kind: 'PICK_TARGET', seat: 1, region: LINDENHOF })).toEqual({
      ok: false,
      error: 'NOT_YOUR_TURN',
    });
    const target = play(state, { kind: 'PICK_TARGET', seat: 0, region: SALZWEIDE });
    expect(target.events).toEqual([
      { kind: 'TARGET_CHOSEN', round: 1, attacker: 0, defender: 1, region: SALZWEIDE },
    ]);
    expect(target.state.step).toEqual({
      kind: 'DUEL_TRIVIA',
      round: 1,
      attacker: 0,
      defender: 1,
      region: SALZWEIDE,
      queue: [1, 2],
    });
    expect(pendingQuestion(target.state)).toEqual({ type: 'TRIVIA', seats: [0, 1] });
    expect(stepTimeLimitMs(target.state)).toBe(15_000);
  });

  it('nur der Angreifer richtig: er erobert die Region, dann greift der Nächste an', () => {
    const { state, events } = duel(campaignState(), SALZWEIDE, true, false);
    expect(state.regions[SALZWEIDE]?.owner).toBe(0);
    expect(events).toEqual([
      {
        kind: 'DUEL_RESOLVED',
        round: 1,
        duel: 1,
        attacker: 0,
        defender: 1,
        region: SALZWEIDE,
        winner: 'ATTACKER',
        reason: 'TRIVIA',
        effect: 'CONQUERED',
        capitalLivesLeft: null,
        regionValue: 100,
      },
    ]);
    expect(state.step).toEqual({ kind: 'CAMPAIGN_TARGET', round: 1, attacker: 1, queue: [2] });
    expect(state.duels).toBe(1);
    expect(state.questions).toBe(1);
  });

  it.each([
    [false, true, 'TRIVIA'],
    [false, false, 'BOTH_WRONG'],
  ] as const)(
    'Angreifer %s, Verteidiger %s: Region hält und wird befestigt (%s)',
    (a, d, reason) => {
      const { state, events } = duel(campaignState(), SALZWEIDE, a, d);
      expect(state.regions[SALZWEIDE]).toMatchObject({ owner: 1, value: 150, fortifications: 1 });
      expect(events[0]).toMatchObject({
        winner: 'DEFENDER',
        reason,
        effect: 'FORTIFIED',
        regionValue: 150,
      });
    },
  );

  it('beide richtig: die Schätzfrage entscheidet, erst Abstand, dann Zeit, sonst hält der Verteidiger', () => {
    const both = duel(campaignState(), SALZWEIDE, true, true);
    expect(both.events).toEqual([]);
    expect(both.state.step.kind).toBe('DUEL_ESTIMATE');
    expect(pendingQuestion(both.state)).toEqual({ type: 'ESTIMATE', seats: [0, 1] });
    expect(stepTimeLimitMs(both.state)).toBe(20_000);

    const cases = [
      [est('3', 9000), est('4', 1000), 'ATTACKER', 'ESTIMATE'],
      [est('4', 1000), est('3', 9000), 'DEFENDER', 'ESTIMATE'],
      [est('3', 2000), est('3', 2500), 'ATTACKER', 'SPEED'],
      [est('3', 2500), est('3', 2000), 'DEFENDER', 'SPEED'],
      [est('3', 2000), est('3', 2000), 'DEFENDER', 'FULL_TIE'],
      [est(null, null), est('900', 19_000), 'DEFENDER', 'ESTIMATE'],
      [est(null, null), est(null, null), 'DEFENDER', 'FULL_TIE'],
    ] as const;
    for (const [attacker, defender, winner, reason] of cases) {
      const result = play(both.state, { kind: 'DUEL_ESTIMATES', attacker, defender });
      expect(result.events[0]).toMatchObject({ winner, reason });
      expect(result.state.questions).toBe(2);
      expect(result.state.regions[SALZWEIDE]?.owner).toBe(winner === 'ATTACKER' ? 0 : 1);
    }
    expect(
      applyMatchInput(both.state, {
        kind: 'DUEL_ESTIMATES',
        attacker: est('1', 1.5),
        defender: est('1', 1),
      }),
    ).toEqual({ ok: false, error: 'INVALID_ANSWERS' });
    expect(
      applyMatchInput(both.state, {
        kind: 'DUEL_TRIVIA',
        attackerCorrect: true,
        defenderCorrect: true,
      }),
    ).toEqual({ ok: false, error: 'WRONG_STEP' });
  });

  it('eine Hauptstadt verliert ein Leben und bleibt beim Reich', () => {
    const { state, events } = duel(campaignState(), MUEHLBACH, true, false);
    expect(state.regions[MUEHLBACH]).toMatchObject({ owner: 1, capitalOf: 1, value: 300 });
    expect(state.seats[1]?.capitalHits).toBe(1);
    expect(events[0]).toMatchObject({ effect: 'CAPITAL_HIT', capitalLivesLeft: 2 });
  });

  it('das letzte Leben übernimmt das ganze Reich; der Verlierer scheidet aus und greift nicht mehr an', () => {
    const start = campaignState();
    const seats = start.seats.map((s, seat) => (seat === 1 ? { ...s, capitalHits: 2 } : s));
    const { state, events } = duel({ ...start, seats }, MUEHLBACH, true, false);
    for (const id of [MUEHLBACH, FUCHSMOOR, SALZWEIDE]) expect(state.regions[id]?.owner).toBe(0);
    expect(state.regions[MUEHLBACH]).toMatchObject({ capitalOf: null, value: 300 });
    expect(state.seats[1]).toMatchObject({ eliminatedInDuel: 1, eliminatedBy: 0, capitalHits: 3 });
    expect(events).toEqual([
      expect.objectContaining({ effect: 'TAKEOVER', capitalLivesLeft: 0 }),
      { kind: 'KINGDOM_ELIMINATED', round: 1, seat: 1, by: 0, regions: 3 },
    ]);
    // Sitz 1 ist raus: Sitz 2 greift als Nächster an
    expect(state.step).toEqual({ kind: 'CAMPAIGN_TARGET', round: 1, attacker: 2, queue: [] });
    expect(legalRegions(state).every((id) => state.regions[id]?.owner === 0)).toBe(true);
  });

  it('endet, sobald nur ein Reich übrig ist, mit Endstand', () => {
    const start = campaignState();
    const regions = start.regions.map((r) =>
      r.owner === 2 ? { ...r, owner: 0, capitalOf: r.capitalOf === 2 ? null : r.capitalOf } : r,
    );
    const seats = start.seats.map((s, seat) =>
      seat === 1
        ? { ...s, capitalHits: 2 }
        : seat === 2
          ? { ...s, capitalHits: 3, eliminatedInDuel: 1, eliminatedBy: 0 }
          : s,
    );
    const { state, events } = duel({ ...start, regions, seats, duels: 1 }, MUEHLBACH, true, false);
    expect(state.step).toEqual({ kind: 'FINISHED', reason: 'LAST_KINGDOM' });
    expect(matchPhase(state)).toBe('FINISHED');
    expect(stepTimeLimitMs(state)).toBeNull();
    const finished = events.at(-1);
    expect(finished).toMatchObject({ kind: 'MATCH_FINISHED', reason: 'LAST_KINGDOM' });
    expect(matchStandings(state).map((s) => [s.seat, s.place, s.eliminated])).toEqual([
      [0, 1, false],
      [1, 2, true], // später ausgeschieden
      [2, 3, true],
    ]);
    expect(matchPoints(state, 0)).toBe(state.regions.reduce((sum, r) => sum + r.value, 0));
  });

  it('wechselt mit jeder Runde, wer zuerst angreift', () => {
    const { state } = duel(
      campaignState({ step: { kind: 'CAMPAIGN_TARGET', round: 1, attacker: 2, queue: [] } }),
      OTTERBRUCH,
      false,
      false,
    );
    expect(state.step).toEqual({ kind: 'CAMPAIGN_TARGET', round: 2, attacker: 1, queue: [2, 0] });
  });

  it('endet nach der letzten Runde mit Punkten aus den Regionswerten', () => {
    const start = campaignState({
      step: { kind: 'CAMPAIGN_TARGET', round: 4, attacker: 2, queue: [] },
    });
    const { state, events } = duel(start, OTTERBRUCH, true, false);
    expect(state.step).toEqual({ kind: 'FINISHED', reason: 'ROUNDS_COMPLETE' });
    const standings = matchStandings(state);
    expect(events.at(-1)).toEqual({ kind: 'MATCH_FINISHED', reason: 'ROUNDS_COMPLETE', standings });
    // Sitz 0: Eschenhain 300 + 17 Regionen à 100 − Otterbruch; Sitz 2: 300 + 3 · 100; Sitz 1: 300 + 200
    expect(standings).toEqual([
      {
        seat: 0,
        place: 1,
        points: 300 + 16 * 100,
        regions: 17,
        capitalLives: 3,
        eliminated: false,
      },
      { seat: 2, place: 2, points: 600, regions: 4, capitalLives: 3, eliminated: false },
      { seat: 1, place: 3, points: 500, regions: 3, capitalLives: 3, eliminated: false },
    ]);
  });

  it('teilt den Platz bei völligem Gleichstand', () => {
    const start = campaignState();
    // Sitz 1 und Sitz 2 bekommen je eine Region von Sitz 0: beide 300 + 3 · 100 bei vier Regionen
    const regions = start.regions.map((r, id) =>
      id === LINDENHOF ? { ...r, owner: 2 } : id === OTTERBRUCH ? { ...r, owner: 1 } : r,
    );
    const standings = matchStandings({ ...start, regions });
    expect(standings.map((s) => [s.seat, s.place, s.points])).toEqual([
      [0, 1, 300 + 15 * 100],
      [1, 2, 600],
      [2, 2, 600],
    ]);
  });
});

describe('Bots und Zeitablauf', () => {
  it('wählen in jedem Schritt eine erlaubte Region', () => {
    let state = createMatch(DEFAULT_MATCH_RULES);
    const rng = seededRng(7);
    while (state.step.kind === 'CAPITAL_PICK') {
      const region = chooseRegionForBot(state, rng);
      expect(legalRegions(state)).toContain(region);
      state = play(state, { kind: 'PICK_CAPITAL', seat: state.step.seat, region }).state;
    }
    const capitals = state.seats.map((s) => s.capital as number);
    // Bots halten Abstand: mindestens drei Felder zwischen ihren Hauptstädten
    for (const a of capitals)
      for (const b of capitals)
        if (a !== b) expect(regionDistance(WENDELMARK, a, b)).toBeGreaterThanOrEqual(3);

    state = play(state, {
      kind: 'LAND_ESTIMATES',
      answers: [0, 1, 2].map((seat) => ({ seat, ...est(String(seat), 1000) })),
    }).state;
    const pick = chooseRegionForBot(state, rng);
    expect(legalRegions(state)).toContain(pick);
    expect(legalRegions(state)).toContain(autoPickRegion(state, rng));
  });

  it('greifen eine Hauptstadt mit letztem Leben vor jeder anderen Region an', () => {
    const start = campaignState();
    const seats = start.seats.map((s, seat) => (seat === 2 ? { ...s, capitalHits: 2 } : s));
    expect(chooseRegionForBot({ ...start, seats }, seededRng(1))).toBe(TANNENRUH);
    // Sonst die wertvollste Region; eine volle Hauptstadt zählt nur halb (150 > 100)
    const fortified = start.regions.map((r, id) => (id === UFERLAND ? { ...r, value: 200 } : r));
    expect(chooseRegionForBot({ ...start, regions: fortified }, seededRng(1))).toBe(UFERLAND);
  });

  it('haben im Duell nichts zu wählen', () => {
    const target = play(campaignState(), { kind: 'PICK_TARGET', seat: 0, region: SALZWEIDE });
    expect(() => chooseRegionForBot(target.state, seededRng(1))).toThrow();
  });
});

describe('Partie zu zweit', () => {
  const TWO = matchRulesForSeats(DEFAULT_MATCH_RULES, 2);

  function withTwoCapitals(): MatchState {
    const state = play(createMatch(TWO), { kind: 'PICK_CAPITAL', seat: 0, region: ESCHENHAIN });
    return play(state.state, { kind: 'PICK_CAPITAL', seat: 1, region: MUEHLBACH }).state;
  }

  it('beginnt nach der zweiten Hauptstadt die Landnahme mit 22 freien Regionen', () => {
    const state = withTwoCapitals();
    expect(state.seats).toHaveLength(2);
    expect(state.step).toEqual({ kind: 'LAND_ESTIMATE', round: 1 });
    expect(pendingQuestion(state)).toEqual({ type: 'ESTIMATE', seats: [0, 1] });
    expect(freeRegions(state)).toHaveLength(22);
  });

  it('der Erste wählt zwei Regionen, der Zweite eine; die achte Runde vergibt die letzte', () => {
    const first = play(withTwoCapitals(), {
      kind: 'LAND_ESTIMATES',
      answers: [
        { seat: 0, ...est('5', 1000) },
        { seat: 1, ...est('3', 2000) },
      ],
    });
    expect(first.events).toEqual([
      {
        kind: 'LAND_RANKED',
        round: 1,
        ranking: [
          { seat: 1, place: 1, picks: 2, distance: '3', effectiveMs: 2000 },
          { seat: 0, place: 2, picks: 1, distance: '5', effectiveMs: 1000 },
        ],
      },
    ]);
    expect(first.state.step).toEqual({ kind: 'LAND_PICK', round: 1, queue: [1, 1, 0] });

    const { state, events } = finishLandGrab(withTwoCapitals());
    expect(events.filter((e) => e.kind === 'LAND_RANKED')).toHaveLength(8);
    expect(events.filter((e) => e.kind === 'REGION_CLAIMED')).toHaveLength(22);
    // Runde 8 beginnt bei Sitz 1; er liegt vorn und bekommt die letzte Region
    expect(events.filter((e) => e.kind === 'REGION_CLAIMED' && e.round === 8)).toEqual([
      { kind: 'REGION_CLAIMED', round: 8, seat: 1, region: expect.any(Number) as number },
    ]);
    expect(freeRegions(state)).toEqual([]);
    expect(state.questions).toBe(8);
    expect(state.step).toEqual({ kind: 'CAMPAIGN_TARGET', round: 1, attacker: 0, queue: [1] });
  });

  it('im Feldzug greifen beide abwechselnd zuerst an, nach vier Runden ist Schluss', () => {
    let { state } = finishLandGrab(withTwoCapitals());
    const attackers: number[] = [];
    while (state.step.kind === 'CAMPAIGN_TARGET') {
      attackers.push(state.step.attacker);
      state = duel(state, legalRegions(state)[0] as number, false, false).state;
    }
    expect(attackers).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
    expect(state.step).toEqual({ kind: 'FINISHED', reason: 'ROUNDS_COMPLETE' });
    expect(state.duels).toBe(8);
    expect(state.questions).toBe(16);
    expect(matchStandings(state).map((s) => s.place)).toHaveLength(2);
  });

  it('nimmt der Angreifer das letzte Leben, endet die Partie sofort', () => {
    const base = createMatch(TWO);
    const seatOne = new Set([MUEHLBACH, FUCHSMOOR, SALZWEIDE]);
    const start: MatchState = {
      ...base,
      regions: base.regions.map((r, id) => ({
        ...r,
        owner: seatOne.has(id) ? 1 : 0,
        capitalOf: id === ESCHENHAIN ? 0 : id === MUEHLBACH ? 1 : null,
        value: id === ESCHENHAIN || id === MUEHLBACH ? 300 : 100,
      })),
      seats: [
        { ...(base.seats[0] as MatchState['seats'][number]), capital: ESCHENHAIN },
        { ...(base.seats[1] as MatchState['seats'][number]), capital: MUEHLBACH, capitalHits: 2 },
      ],
      step: { kind: 'CAMPAIGN_TARGET', round: 2, attacker: 0, queue: [] },
    };
    const { state, events } = duel(start, MUEHLBACH, true, false);
    expect(events.map((e) => e.kind)).toEqual([
      'DUEL_RESOLVED',
      'KINGDOM_ELIMINATED',
      'MATCH_FINISHED',
    ]);
    expect(state.step).toEqual({ kind: 'FINISHED', reason: 'LAST_KINGDOM' });
    expect(matchStandings(state)).toMatchObject([
      // Eschenhain und die eroberte Mühlbach je 300, dazu 22 gewöhnliche Regionen
      { seat: 0, place: 1, points: 2 * 300 + 22 * 100, eliminated: false },
      { seat: 1, place: 2, points: 0, eliminated: true },
    ]);
  });
});
