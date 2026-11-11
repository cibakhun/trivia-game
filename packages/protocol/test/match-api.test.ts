import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_ECONOMY,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_PATTERN,
  inviteCodeSchema,
  MATCH_PHASES,
  MATCH_QUESTION_PURPOSES,
  MAX_REALM_ORDERS,
  matchBoardSchema,
  matchCreateRequestSchema,
  matchFavoritesRequestSchema,
  matchJoinRequestSchema,
  matchOrdersRequestSchema,
  matchRealmViewSchema,
  matchSeatBotRequestSchema,
  parseMatchEvent,
  QUESTION_CATEGORIES,
} from '../src/index.ts';

describe('Partie-Anfragen (API.md §2.6)', () => {
  it('Einladungscode: ohne verwechselbare Zeichen, Eingabe unabhängig von Groß- und Kleinschreibung', () => {
    expect(INVITE_CODE_ALPHABET).toHaveLength(32);
    expect(INVITE_CODE_ALPHABET).not.toMatch(/[01IO]/);
    for (const char of INVITE_CODE_ALPHABET)
      expect(`${char.repeat(6)}`).toMatch(INVITE_CODE_PATTERN);
    expect(inviteCodeSchema.parse(' abc2xy ')).toBe('ABC2XY');
    expect(inviteCodeSchema.safeParse('ABC1XY').success).toBe(false);
    expect(inviteCodeSchema.safeParse('ABCDE').success).toBe(false);
    expect(matchJoinRequestSchema.safeParse({ inviteCode: 'ABCDEF', extra: 1 }).success).toBe(
      false,
    );
  });

  it('Anlegen: normale Partie mit Standardregeln, Testpartie mit einer Stärke je freiem Platz', () => {
    expect(matchCreateRequestSchema.parse({ kind: 'STANDARD' })).toEqual({
      kind: 'STANDARD',
      rules: 'DEFAULT',
      mode: 'CLASSIC',
    });
    expect(
      matchCreateRequestSchema.parse({ kind: 'TEST', seats: 3, botStrengths: ['EASY', 'HARD'] }),
    ).toMatchObject({ seats: 3, rules: 'DEFAULT' });
    expect(
      matchCreateRequestSchema.safeParse({ kind: 'TEST', seats: 3, botStrengths: ['EASY'] })
        .success,
    ).toBe(false);
    expect(
      matchCreateRequestSchema.safeParse({ kind: 'TEST', seats: 4, botStrengths: ['EASY'] })
        .success,
    ).toBe(false);
    expect(matchCreateRequestSchema.safeParse({ kind: 'STANDARD', seats: 2 }).success).toBe(false);
  });

  it('Bot auf einen Platz: eine Stärke oder null zum Freigeben (ADR-052)', () => {
    expect(matchSeatBotRequestSchema.parse({ strength: 'HARD' })).toEqual({ strength: 'HARD' });
    expect(matchSeatBotRequestSchema.parse({ strength: null })).toEqual({ strength: null });
    expect(matchSeatBotRequestSchema.safeParse({}).success).toBe(false);
    expect(matchSeatBotRequestSchema.safeParse({ strength: 'GOTT' }).success).toBe(false);
    expect(matchSeatBotRequestSchema.safeParse({ strength: 'EASY', seat: 1 }).success).toBe(false);
    // Die Ereignisse der Aufstellung nennen die Stärke; ältere ohne das Feld bleiben lesbar
    const at = '2026-11-11T00:00:00.000Z';
    const joined = (payload: Record<string, unknown>) =>
      parseMatchEvent({ seq: 1, type: 'PLAYER_JOINED', payload, at })?.payload;
    expect(joined({ joinOrder: 1, bot: 'EASY' })).toEqual({ joinOrder: 1, bot: 'EASY' });
    expect(joined({ joinOrder: 1 })).toEqual({ joinOrder: 1 });
  });

  it('Brett: Zugfolge mit Sitz und Stand je Zug', () => {
    const board = {
      map: 'KERNMARK',
      regions: [],
      seats: [],
      step: {
        kind: 'LAND_PICK',
        round: 2,
        chooser: 1,
        attacker: null,
        defender: null,
        region: null,
        finishReason: null,
      },
      turns: [
        { seat: 1, status: 'DONE' },
        { seat: 1, status: 'NOW' },
        { seat: 0, status: 'NEXT' },
      ],
      questions: 2,
      duels: 0,
    };
    expect(matchBoardSchema.parse(board)).toEqual(board);
    expect(
      matchBoardSchema.safeParse({ ...board, turns: [{ seat: 1, status: 'SPÄTER' }] }).success,
    ).toBe(false);
    expect(matchBoardSchema.safeParse({ ...board, turns: undefined }).success).toBe(false);
  });
});

describe('Partie mit Ausbau (MATCH_RULES §11, ADR-058)', () => {
  const at = '2026-11-11T00:00:00.000Z';
  const payloadOf = (type: string, payload: Record<string, unknown>) =>
    parseMatchEvent({ seq: 1, type, payload, at })?.payload;
  const wheel = {
    attackerLots: 3,
    defenderLots: 3,
    freeLots: 2,
    segments: [
      { category: 'HISTORY', attacker: 3, defender: 0, free: 1, weight: 4 },
      { category: 'SPORTS', attacker: 0, defender: 3, free: 1, weight: 4 },
    ],
    total: 8,
  };

  it('Anlegen: die Spielart ist wählbar, ohne Angabe bleibt es die Partie wie bisher', () => {
    expect(matchCreateRequestSchema.parse({ kind: 'STANDARD', mode: 'REALM' })).toMatchObject({
      mode: 'REALM',
    });
    expect(
      matchCreateRequestSchema.parse({
        kind: 'TEST',
        mode: 'REALM',
        seats: 2,
        botStrengths: ['MEDIUM'],
      }),
    ).toMatchObject({ mode: 'REALM', rules: 'DEFAULT' });
    expect(matchCreateRequestSchema.safeParse({ kind: 'STANDARD', mode: 'ANDERS' }).success).toBe(
      false,
    );
    expect(MATCH_PHASES).toContain('PREPARE');
    expect(MATCH_QUESTION_PURPOSES).toContain('START');
  });

  it('Lieblingskategorien: bekannte Kategorien, jede höchstens einmal', () => {
    const categories = ['HISTORY', 'SPORTS', 'SCIENCE', 'GEOGRAPHY'];
    expect(matchFavoritesRequestSchema.parse({ categories })).toEqual({ categories });
    expect(
      matchFavoritesRequestSchema.safeParse({ categories: ['HISTORY', 'HISTORY'] }).success,
    ).toBe(false);
    expect(matchFavoritesRequestSchema.safeParse({ categories: [] }).success).toBe(false);
    expect(matchFavoritesRequestSchema.safeParse({ categories: ['KOCHEN'] }).success).toBe(false);
    expect(matchFavoritesRequestSchema.safeParse({ categories, seat: 1 }).success).toBe(false);
    expect(
      matchFavoritesRequestSchema.safeParse({ categories: [...QUESTION_CATEGORIES] }).success,
    ).toBe(true);
  });

  it('Befehle der Rüstzeit: vier Arten, keine fremden Felder, begrenzte Länge', () => {
    const orders = [
      { kind: 'TRADE', give: 'BREAD', count: 1 },
      { kind: 'BUILD', region: 4 },
      { kind: 'RECRUIT', region: 9, count: 2 },
      { kind: 'MOVE', from: 9, to: 4, count: 1 },
    ];
    expect(matchOrdersRequestSchema.parse({ orders })).toEqual({ orders });
    // Eine leere Liste heißt: fertig, ohne etwas zu tun
    expect(matchOrdersRequestSchema.parse({ orders: [] })).toEqual({ orders: [] });
    const refused = [
      { kind: 'BUILD', region: 4, building: 'CASTLE' },
      { kind: 'RECRUIT', region: 9, count: 0 },
      { kind: 'MOVE', from: 9, to: 4, count: 1.5 },
      { kind: 'TRADE', give: 'GOLD', count: 1 },
      { kind: 'ATTACK', region: 3 },
      { kind: 'BUILD', region: -1 },
    ];
    for (const order of refused) {
      expect(matchOrdersRequestSchema.safeParse({ orders: [order] }).success, order.kind).toBe(
        false,
      );
    }
    const many = Array.from({ length: MAX_REALM_ORDERS + 1 }, () => orders[1]);
    expect(matchOrdersRequestSchema.safeParse({ orders: many }).success).toBe(false);
    expect(matchOrdersRequestSchema.safeParse({ orders: many.slice(1) }).success).toBe(true);
  });

  it('Ansicht: vor dem Start ohne Karte, Befehle anderer stehen nirgends', () => {
    const lobby = {
      categories: ['HISTORY', 'SPORTS', 'SCIENCE', 'GEOGRAPHY'],
      favoritesCount: 4,
      campaignRounds: 5,
      economy: DEFAULT_MATCH_ECONOMY,
      board: null,
      myOrders: null,
    };
    expect(matchRealmViewSchema.parse(lobby)).toEqual(lobby);
    const board = {
      map: 'KERNMARK',
      regions: [
        {
          owner: 0,
          value: 300,
          fortifications: 0,
          building: 'CASTLE',
          castleLivesLeft: 3,
          startCastleOf: 0,
          armies: 3,
        },
      ],
      seats: [
        {
          seat: 0,
          favorites: ['HISTORY', 'SPORTS', 'SCIENCE', 'GEOGRAPHY'],
          bread: 2,
          material: 2,
          income: { bread: 2, material: 2 },
          startCastle: 0,
          castles: 1,
          castleLivesLeft: 3,
          eliminated: false,
          points: 300,
          regions: 1,
        },
      ],
      order: [0, 1],
      step: {
        kind: 'PREPARE',
        round: 1,
        chooser: null,
        attacker: null,
        defender: null,
        region: null,
        category: null,
        wheel: null,
        finishReason: null,
      },
      turns: [
        { seat: 0, status: 'DONE' },
        { seat: 1, status: 'NOW' },
      ],
      questions: 6,
      duels: 0,
    };
    const running = { ...lobby, board, myOrders: [{ kind: 'BUILD', region: 0 }] };
    expect(matchRealmViewSchema.parse(running)).toEqual(running);
    // Der Schritt kennt kein Feld für Befehle: Ein Server, der sie mitschickt, fällt auf
    const leaking = { ...board, step: { ...board.step, orders: [[], null] } };
    expect(matchRealmViewSchema.safeParse({ ...lobby, board: leaking }).success).toBe(false);
    const duel = {
      ...board.step,
      kind: 'DUEL_TRIVIA',
      attacker: 0,
      defender: 1,
      region: 5,
      category: 'SPORTS',
      wheel,
    };
    expect(matchRealmViewSchema.parse({ ...lobby, board: { ...board, step: duel } }).board).toEqual(
      { ...board, step: duel },
    );
  });

  it('Ereignisse: Startfrage, Burg, Dorf, Einkommen, Rüstzeit, Glücksrad, Duell, Abrechnung', () => {
    expect(
      payloadOf('START_RANKED', {
        ranking: [
          { seat: 1, place: 1, distance: '12.5', effectiveMs: 4000 },
          { seat: 0, place: 2, distance: null, effectiveMs: null },
        ],
      }),
    ).toMatchObject({ ranking: [{ seat: 1 }, { seat: 0, distance: null }] });
    expect(payloadOf('CASTLE_CHOSEN', { seat: 0, region: 9, armies: 3 })).toEqual({
      seat: 0,
      region: 9,
      armies: 3,
    });
    expect(payloadOf('VILLAGE_CHOSEN', { seat: 0, region: 4 })).toEqual({ seat: 0, region: 4 });
    expect(payloadOf('INCOME', { round: 1, income: [{ seat: 0, bread: 5, material: 4 }] })).toEqual(
      { round: 1, income: [{ seat: 0, bread: 5, material: 4 }] },
    );
    // Wer fertig ist, steht im Ereignis; was er befohlen hat, nicht
    expect(
      payloadOf('ORDERS_SUBMITTED', { round: 1, seat: 2, orders: [{ kind: 'BUILD', region: 1 }] }),
    ).toEqual({ round: 1, seat: 2 });
    expect(payloadOf('PREPARE_CLOSED', { round: 1, missing: [1] })).toEqual({
      round: 1,
      missing: [1],
    });
    const revealed = {
      round: 1,
      seat: 0,
      orders: [
        { kind: 'TRADE', give: 'MATERIAL', count: 1 },
        { kind: 'BUILD', region: 4 },
      ],
      summary: { built: [{ region: 4, building: 'TOWN' }], recruited: 0, moved: 0, traded: 1 },
      bread: 1,
      material: 0,
    };
    expect(payloadOf('ORDERS_REVEALED', revealed)).toEqual(revealed);
    expect(payloadOf('WHEEL_SPUN', { round: 1, region: 5, category: 'SPORTS' })).toEqual({
      round: 1,
      region: 5,
      category: 'SPORTS',
      exhausted: [],
    });
    expect(
      payloadOf('WHEEL_SPUN', {
        round: 1,
        region: 5,
        category: 'SPORTS',
        exhausted: ['HISTORY'],
        rng: { purpose: 'match' },
      }),
    ).toEqual({ round: 1, region: 5, category: 'SPORTS', exhausted: ['HISTORY'] });
    const duel = {
      round: 2,
      duel: 3,
      attacker: 0,
      defender: 1,
      region: 5,
      category: 'SPORTS',
      winner: 'ATTACKER',
      reason: 'TRIVIA',
      effect: 'BUILDING_DAMAGED',
      building: 'VILLAGE',
      castleLivesLeft: null,
      regionValue: 100,
      armyLost: { seat: 1, region: 5 },
    };
    expect(payloadOf('REALM_DUEL_RESOLVED', duel)).toEqual(duel);
    expect(payloadOf('REALM_DUEL_RESOLVED', { ...duel, armyLost: null })).toMatchObject({
      armyLost: null,
    });
    // Die Folgen der Partie ohne Ausbau kennt das Duell mit Ausbau nicht, und umgekehrt
    expect(payloadOf('REALM_DUEL_RESOLVED', { ...duel, effect: 'CAPITAL_HIT' })).toBeUndefined();
    expect(payloadOf('DUEL_RESOLVED', duel)).toBeUndefined();
    const finished = {
      reason: 'ROUNDS_COMPLETE',
      standings: [
        { seat: 0, place: 1, points: 900, regions: 7, castleLives: 5, eliminated: false },
      ],
    };
    expect(payloadOf('REALM_MATCH_FINISHED', finished)).toEqual(finished);
    expect(payloadOf('MATCH_FINISHED', finished)).toBeUndefined();
  });

  it('gemeinsame Ereignisse: Zusätze des Ausbaus sind optional, alte Inhalte bleiben lesbar', () => {
    const target = { round: 1, attacker: 0, defender: 1, region: 5 };
    expect(payloadOf('TARGET_CHOSEN', target)).toEqual(target);
    expect(payloadOf('TARGET_CHOSEN', { ...target, wheel })).toEqual({ ...target, wheel });
    const opened = {
      seq: 7,
      kind: 'TRIVIA',
      purpose: 'DUEL_TRIVIA',
      seats: [0, 1],
      timeLimitMs: 15000,
      closesAt: at,
    };
    expect(payloadOf('QUESTION_OPENED', opened)).toEqual(opened);
    expect(payloadOf('QUESTION_OPENED', { ...opened, category: 'SPORTS' })).toEqual({
      ...opened,
      category: 'SPORTS',
    });
    expect(
      payloadOf('QUESTION_OPENED', { ...opened, kind: 'ESTIMATE', purpose: 'START' }),
    ).toMatchObject({ purpose: 'START' });
    const eliminated = { round: 3, seat: 1, by: 0, regions: 6 };
    expect(payloadOf('KINGDOM_ELIMINATED', eliminated)).toEqual(eliminated);
    expect(payloadOf('KINGDOM_ELIMINATED', { ...eliminated, bread: 4, material: 2 })).toEqual({
      ...eliminated,
      bread: 4,
      material: 2,
    });
    const started = {
      seats: 2,
      players: [
        { seat: 0, joinOrder: 0, bot: null },
        { seat: 1, joinOrder: 1, bot: 'MEDIUM' },
      ],
    };
    expect(payloadOf('MATCH_STARTED', started)).toEqual(started);
    const realmStarted = {
      seats: 2,
      mode: 'REALM',
      categories: ['HISTORY', 'SPORTS'],
      players: started.players.map((p) => ({ ...p, favorites: ['HISTORY', 'SPORTS'] })),
    };
    expect(payloadOf('MATCH_STARTED', realmStarted)).toEqual(realmStarted);
    expect(
      payloadOf('MATCH_CREATED', { kind: 'STANDARD', rulesPreset: 'DEFAULT', seats: null }),
    ).toEqual({ kind: 'STANDARD', rulesPreset: 'DEFAULT', seats: null });
    expect(
      payloadOf('MATCH_CREATED', {
        kind: 'TEST',
        rulesPreset: 'PLAYTEST',
        seats: 2,
        mode: 'REALM',
      }),
    ).toMatchObject({ mode: 'REALM' });
  });
});
