import { WENDELMARK } from '@rdw/game-core';
import {
  DEFAULT_MATCH_ECONOMY,
  matchViewSchema,
  parseMatchEvent,
  QUESTION_CATEGORIES,
  type MatchView,
  type ParsedMatchEvent,
} from '@rdw/protocol';

/** Gemeinsame Vorlagen der Partie-Tests im Browser: eine Ansicht zu dritt und Ereignisse. */

export const ID = '0190c2a0-0000-7000-8000-000000000001';
export const AT = '2026-11-10T20:00:00.000Z';

export type Step = MatchView['board'] extends infer B
  ? B extends { step: infer S }
    ? S
    : never
  : never;

export function step(partial: Partial<Step>): Step {
  return {
    kind: 'CAPITAL_PICK',
    round: null,
    chooser: null,
    attacker: null,
    defender: null,
    region: null,
    finishReason: null,
    ...partial,
  };
}

/** Ansicht einer laufenden Testpartie zu dritt; geprüft gegen das Schema des Protokolls. */
export function viewOf(
  overrides: Partial<MatchView> = {},
  boardStep: Partial<Step> = {},
): MatchView {
  return matchViewSchema.parse({
    match: {
      id: ID,
      kind: 'TEST',
      mode: 'CLASSIC',
      status: 'RUNNING',
      inviteCode: null,
      rulesPreset: 'PLAYTEST',
      seats: 3,
      timers: {
        triviaMs: 8000,
        estimateMs: 10000,
        pickMs: 5000,
        revealMs: 2000,
        announceMs: 2500,
        pickShowMs: 1200,
      },
      createdAt: AT,
      startedAt: AT,
      finishedAt: null,
    },
    players: [
      {
        joinOrder: 0,
        seat: 1,
        name: 'Anna',
        isBot: false,
        botStrength: null,
        isHost: true,
        isMe: true,
        favorites: null,
      },
      {
        joinOrder: 1,
        seat: 0,
        name: 'Bot (leicht)',
        isBot: true,
        botStrength: 'EASY',
        isHost: false,
        isMe: false,
        favorites: null,
      },
      {
        joinOrder: 2,
        seat: 2,
        name: 'Bot (schwer)',
        isBot: true,
        botStrength: 'HARD',
        isHost: false,
        isMe: false,
        favorites: null,
      },
    ],
    mySeat: 1,
    isHost: true,
    board: {
      map: 'WENDELMARK',
      regions: WENDELMARK.regions.map(() => ({
        owner: null,
        value: 100,
        capitalOf: null,
        fortifications: 0,
      })),
      seats: [0, 1, 2].map((seat) => ({
        seat,
        capital: null,
        capitalLivesLeft: 3,
        eliminated: false,
        points: 0,
        regions: 0,
      })),
      step: step({ chooser: 1, ...boardStep }),
      turns: [
        { seat: 0, status: 'DONE' },
        { seat: 1, status: 'NOW' },
        { seat: 2, status: 'NEXT' },
      ],
      questions: 0,
      duels: 0,
    },
    realm: null,
    phase: { kind: 'PICK', deadline: AT, remainingMs: 5000 },
    legalRegions: [0, 5],
    question: null,
    events: [],
    lastEventSeq: 3,
    serverTime: AT,
    ...overrides,
  });
}

export function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): ParsedMatchEvent {
  const parsed = parseMatchEvent({ seq, type, payload, at: AT });
  if (!parsed) throw new Error(`Ereignis ${type} passt nicht zum Schema`);
  return parsed;
}

// ---------------------------------------------------------------------------------------------
// Partie mit Ausbau (MATCH_RULES §11)
// ---------------------------------------------------------------------------------------------

export type RealmView = NonNullable<MatchView['realm']>;
export type RealmBoardView = NonNullable<RealmView['board']>;
export type RealmStepView = RealmBoardView['step'];
export type RealmBuildingCode = RealmBoardView['regions'][number]['building'];

/** Besitz auf der Wendelmark: Sitz 2 im Norden (ich), Sitz 0 im Westen, Sitz 1 im Südosten. */
export const REALM_OWNER: readonly number[] = [
  2, 2, 2, 2, 0, 2, 2, 2, 2, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1,
];
/** Startburgen: Graufurt (2) für Sitz 2, Hagelstein (10) für Sitz 0, Rabenfels (18) für Sitz 1. */
export const REALM_CASTLES: Readonly<Record<number, number>> = { 2: 2, 10: 0, 18: 1 };
export const REALM_BUILDINGS_AT: Readonly<Record<number, RealmBuildingCode>> = {
  5: 'VILLAGE',
  6: 'TOWN',
  11: 'VILLAGE',
  12: 'VILLAGE',
  13: 'TOWN',
  16: 'VILLAGE',
};
export const REALM_ARMIES_AT: Readonly<Record<number, number>> = {
  2: 3,
  6: 2,
  7: 1,
  10: 2,
  11: 3,
  12: 2,
  13: 1,
  18: 3,
};
export const REALM_FAVORITES = [
  ['HISTORY', 'GEOGRAPHY', 'SPORTS', 'GENERAL'],
  ['SCIENCE', 'TECHNOLOGY', 'MATHEMATICS', 'GENERAL'],
  ['HISTORY', 'LITERATURE', 'ARTS_CULTURE', 'NATURE_ANIMALS'],
] as const;

function realmEconomy(need: RealmViewOptions['attackNeedsArmy']): RealmView['economy'] {
  if (need === undefined) return DEFAULT_MATCH_ECONOMY;
  const { attackNeedsArmy, ...economy } = DEFAULT_MATCH_ECONOMY;
  void attackNeedsArmy;
  return need === null ? economy : { ...economy, attackNeedsArmy: need };
}

export function realmStep(partial: Partial<RealmStepView> = {}): RealmStepView {
  return {
    kind: 'PREPARE',
    round: 2,
    chooser: null,
    attacker: null,
    defender: null,
    region: null,
    category: null,
    wheel: null,
    finishReason: null,
    ...partial,
  };
}

export interface RealmViewOptions {
  /** Vorräte je Sitz; ohne Angabe 7 Brot und 10 Baustoff für mich (Sitz 2). */
  readonly stock?: Readonly<Record<number, { bread: number; material: number }>>;
  /** Gebäude und Armeen, die vom Grundbild abweichen. */
  readonly buildings?: Readonly<Record<number, RealmBuildingCode>>;
  readonly armies?: Readonly<Record<number, number>>;
  /** Felder, die niemandem gehören (ADR-062): ohne Gebäude und ohne Armeen. */
  readonly free?: readonly number[];
  readonly eliminated?: readonly number[];
  readonly step?: Partial<RealmStepView>;
  /** Zugfolge links; ohne Angabe sind Sitz 0 und 1 fertig und ich (Sitz 2) rüste noch. */
  readonly turns?: RealmBoardView['turns'];
  readonly myOrders?: RealmView['myOrders'];
  readonly map?: string;
  /**
   * Angriff nur mit Armee (ADR-064): ohne Angabe die Vorgabe der Regeln (`ALWAYS`), `null` für eine
   * Partie von vor ADR-064 ohne den Regelwert.
   */
  readonly attackNeedsArmy?: 'ALWAYS' | 'RIVALS' | null;
}

/**
 * Ansicht einer laufenden Partie mit Ausbau zu dritt in der Rüstzeit der zweiten Runde; ich bin
 * Anna auf Sitz 2, die Bots sitzen auf 0 (leicht) und 1 (schwer). Geprüft gegen das Schema des
 * Protokolls.
 */
export function realmViewOf(
  options: RealmViewOptions = {},
  overrides: Partial<MatchView> = {},
): MatchView {
  const base = viewOf();
  const stock: Record<number, { bread: number; material: number }> = {
    0: { bread: 6, material: 8 },
    1: { bread: 3, material: 11 },
    2: { bread: 7, material: 10 },
    ...options.stock,
  };
  const free = new Set(options.free ?? []);
  const buildingAt = (id: number): RealmBuildingCode =>
    free.has(id)
      ? 'NONE'
      : (options.buildings?.[id] ??
        (REALM_CASTLES[id] !== undefined ? 'CASTLE' : (REALM_BUILDINGS_AT[id] ?? 'NONE')));
  const board: RealmBoardView = {
    map: options.map ?? 'WENDELMARK',
    regions: REALM_OWNER.map((seat, id) => ({
      owner: free.has(id) ? null : seat,
      value: REALM_CASTLES[id] !== undefined ? 300 : 100,
      fortifications: 0,
      building: buildingAt(id),
      castleLivesLeft: buildingAt(id) === 'CASTLE' ? 3 : 0,
      startCastleOf: REALM_CASTLES[id] ?? null,
      armies: free.has(id) ? 0 : (options.armies?.[id] ?? REALM_ARMIES_AT[id] ?? 0),
    })),
    seats: [0, 1, 2].map((seat) => ({
      seat,
      favorites: [...(REALM_FAVORITES[seat] ?? [])],
      bread: stock[seat]?.bread ?? 0,
      material: stock[seat]?.material ?? 0,
      income: { bread: 4, material: 5 },
      startCastle: Number(
        Object.keys(REALM_CASTLES).find((id) => REALM_CASTLES[Number(id)] === seat),
      ),
      castles: REALM_OWNER.filter((owner, id) => owner === seat && buildingAt(id) === 'CASTLE')
        .length,
      castleLivesLeft: 3,
      eliminated: options.eliminated?.includes(seat) ?? false,
      points: 1000,
      regions: REALM_OWNER.filter((owner, id) => owner === seat && !free.has(id)).length,
    })),
    order: [2, 0, 1],
    step: realmStep(options.step),
    turns: options.turns ?? [
      { seat: 0, status: 'DONE' },
      { seat: 1, status: 'DONE' },
      { seat: 2, status: 'NOW' },
    ],
    questions: 6,
    duels: 3,
  };
  return matchViewSchema.parse({
    ...base,
    match: { ...base.match, mode: 'REALM' },
    // Ich bin der Mensch der Runde: Anna sitzt hier auf Sitz 2, der Bot von dort auf Sitz 1
    players: base.players.map((player) => {
      const seat = player.seat === 1 ? 2 : player.seat === 2 ? 1 : player.seat;
      return { ...player, seat, favorites: [...(REALM_FAVORITES[seat ?? 0] ?? [])] };
    }),
    mySeat: 2,
    board: null,
    realm: {
      categories: [...QUESTION_CATEGORIES],
      favoritesCount: DEFAULT_MATCH_ECONOMY.favorites,
      campaignRounds: 5,
      economy: realmEconomy(options.attackNeedsArmy),
      board,
      myOrders: options.myOrders ?? null,
    },
    phase: { kind: 'PREPARE', deadline: AT, remainingMs: 40_000 },
    legalRegions: [],
    ...overrides,
  });
}
