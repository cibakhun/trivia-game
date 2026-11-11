import {
  buildingLevel,
  planRealmOrders,
  REALM_BUILDINGS,
  realmWheelOn,
  regionNeighbors,
  type MatchMap,
  type RealmOrderError,
  type RealmOrdersPlan,
  type RealmWheel,
} from '@rdw/game-core';
import type {
  MatchEventOf,
  MatchRealmView,
  MatchView,
  ParsedMatchEvent,
  QuestionCategory,
  RealmBoard,
  RealmBuildingCode,
  RealmOrderDto,
} from '@rdw/protocol';
import { screenStateOf, type LocalQuestion, type MatchScreenState } from './match-model.ts';
import { mapOfView } from './match-text.ts';

/**
 * Reine Ableitungen für die Partie mit Ausbau im Browser (MATCH_RULES §11): was in der Rüstzeit
 * auf einem Feld geht und was es kostet, der Entwurf der eigenen Befehle, die Vorschau des
 * Glücksrads und was der Bildschirm gerade zeigt. Gerechnet wird mit denselben Regeln wie auf dem
 * Server (`planRealmOrders`, `realmWheelOn` aus game-core); entschieden wird trotzdem nur dort.
 */

export type RealmRegionView = RealmBoard['regions'][number];
export type RealmSeatView = RealmBoard['seats'][number];
export type RealmResourceCode = Extract<RealmOrderDto, { kind: 'TRADE' }>['give'];

/** Laufende Partie mit Ausbau: Regelwerte, Brett und Karte. */
export interface RealmPlay {
  readonly realm: MatchRealmView;
  readonly board: RealmBoard;
  readonly map: MatchMap;
}

/** Brett der Partie mit Ausbau; `null` ohne Ausbau und vor dem Start. */
export function realmPlayOf(view: MatchView | null): RealmPlay | null {
  const board = view?.realm?.board;
  if (!view || !view.realm || !board) return null;
  return { realm: view.realm, board, map: mapOfView(view) };
}

export function realmSeat(play: RealmPlay, seat: number): RealmSeatView | null {
  return play.board.seats.find((s) => s.seat === seat) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Rüstzeit: Entwurf der eigenen Befehle
// ---------------------------------------------------------------------------------------------

export type OrdersPlan = RealmOrdersPlan<RealmRegionView>;

/**
 * Rechnet den Entwurf gegen den Stand der Ansicht. In der Rüstzeit ist das der Stand zu ihrem
 * Beginn, gegen den auch der Server prüft; Vorräte und Felder ändern sich erst beim Aufdecken.
 */
export function planOrders(
  play: RealmPlay,
  seat: number,
  orders: readonly RealmOrderDto[],
): OrdersPlan {
  const stock = realmSeat(play, seat);
  if (!stock || stock.eliminated) return { ok: false, error: 'INVALID', index: 0 };
  return planRealmOrders(
    {
      map: play.map,
      economy: play.realm.economy,
      regions: play.board.regions,
      bread: stock.bread,
      material: stock.material,
    },
    seat,
    orders,
  );
}

/** Feld, wie es nach dem Entwurf aussähe. */
export function plannedRegion(play: RealmPlay, plan: OrdersPlan, region: number): RealmRegionView {
  const now = play.board.regions[region];
  if (!now) throw new RangeError(`Unbekannte Region ${region}`);
  return (plan.ok ? plan.regions.get(region) : undefined) ?? now;
}

/**
 * Setzt den einen Befehl, auf den `hit` passt: ersetzt ihn an seiner Stelle, hängt ihn an oder
 * nimmt ihn heraus (`next === null`). Mehrere passende fallen zu einem zusammen.
 */
function setOrder(
  orders: readonly RealmOrderDto[],
  hit: (order: RealmOrderDto) => boolean,
  next: RealmOrderDto | null,
): RealmOrderDto[] {
  const at = orders.findIndex(hit);
  if (at < 0) return next ? [...orders, next] : [...orders];
  const out: RealmOrderDto[] = [];
  orders.forEach((order, index) => {
    if (!hit(order)) out.push(order);
    else if (index === at && next) out.push(next);
  });
  return out;
}

/** Bau der nächsten Stufe auf einem Feld an- oder abwählen. */
export function withBuild(
  orders: readonly RealmOrderDto[],
  region: number,
  on: boolean,
): RealmOrderDto[] {
  return setOrder(
    orders,
    (o) => o.kind === 'BUILD' && o.region === region,
    on ? { kind: 'BUILD', region } : null,
  );
}

/** So viele Armeen in dieser Burg kaufen; 0 nimmt den Kauf heraus. */
export function withRecruit(
  orders: readonly RealmOrderDto[],
  region: number,
  count: number,
): RealmOrderDto[] {
  return setOrder(
    orders,
    (o) => o.kind === 'RECRUIT' && o.region === region,
    count > 0 ? { kind: 'RECRUIT', region, count } : null,
  );
}

/** So viele Armeen von `from` ins Nachbarfeld `to` ziehen; 0 nimmt den Zug heraus. */
export function withMove(
  orders: readonly RealmOrderDto[],
  from: number,
  to: number,
  count: number,
): RealmOrderDto[] {
  return setOrder(
    orders,
    (o) => o.kind === 'MOVE' && o.from === from && o.to === to,
    count > 0 ? { kind: 'MOVE', from, to, count } : null,
  );
}

/** So oft `give` gegen den anderen Rohstoff tauschen; 0 nimmt den Tausch heraus. */
export function withTrade(
  orders: readonly RealmOrderDto[],
  give: RealmResourceCode,
  count: number,
): RealmOrderDto[] {
  return setOrder(
    orders,
    (o) => o.kind === 'TRADE' && o.give === give,
    count > 0 ? { kind: 'TRADE', give, count } : null,
  );
}

export interface SettledOrders {
  readonly orders: RealmOrderDto[];
  /** Befehle, die nicht mehr gingen und deshalb herausfielen (etwa ein Bau ohne den Tausch davor). */
  readonly dropped: RealmOrderDto[];
  readonly plan: OrdersPlan;
}

/**
 * Macht einen Entwurf wieder gültig, nachdem etwas herausgenommen wurde: Solange die Regeln einen
 * Befehl ablehnen, fällt genau dieser heraus. Kann das Reich gar nicht rüsten, bleibt nichts übrig.
 */
export function settleOrders(
  play: RealmPlay,
  seat: number,
  orders: readonly RealmOrderDto[],
): SettledOrders {
  const rest = [...orders];
  const dropped: RealmOrderDto[] = [];
  for (;;) {
    const plan = planOrders(play, seat, rest);
    if (plan.ok || rest.length === 0) return { orders: rest, dropped, plan };
    const index = Math.min(plan.index, rest.length - 1);
    dropped.push(...rest.splice(index, 1));
  }
}

function sum(orders: readonly RealmOrderDto[], pick: (order: RealmOrderDto) => number): number {
  return orders.reduce((total, order) => total + pick(order), 0);
}

/** Größte Anzahl ab `from`, mit der `build(count)` noch gültig ist; höchstens `limit`. */
function maxCount(
  play: RealmPlay,
  seat: number,
  from: number,
  limit: number,
  build: (count: number) => RealmOrderDto[],
): number {
  let max = from;
  while (max < limit && planOrders(play, seat, build(max + 1)).ok) max += 1;
  return max;
}

export interface Cost {
  readonly bread: number;
  readonly material: number;
}

export type BuildTarget = Exclude<RealmBuildingCode, 'NONE'>;

export interface BuildOption {
  /** Stufe, die auf dem Feld als nächste entsteht. */
  readonly building: BuildTarget;
  readonly cost: Cost;
  /** Im Entwurf schon befohlen. */
  readonly ordered: boolean;
  /** Grund, aus dem der Bau gerade nicht geht; `null` = möglich (oder schon befohlen). */
  readonly blocked: RealmOrderError | null;
}

export interface RecruitOption {
  /** Im Entwurf gekaufte Armeen dieser Burg. */
  readonly count: number;
  /** So viele gingen höchstens (Vorrat und Obergrenze je Feld). */
  readonly max: number;
  readonly cost: Cost;
}

export interface MoveOption {
  readonly to: number;
  readonly count: number;
  readonly max: number;
}

export interface FieldOptions {
  readonly region: number;
  /** Gebäude und Armeen, wie sie nach dem Entwurf dort stünden. */
  readonly building: RealmBuildingCode;
  readonly armies: number;
  /** `null`: höchste Stufe erreicht. */
  readonly build: BuildOption | null;
  /** `null`: keine Burg, auch nicht nach dem Entwurf. */
  readonly recruit: RecruitOption | null;
  /** Armeen, die von hier in dieser Runde noch ziehen dürfen (die vom Rundenbeginn). */
  readonly movable: number;
  /** Eigene Nachbarfelder als Ziel eines Zugs. */
  readonly moves: readonly MoveOption[];
}

const BUILD_COST_KEY = { VILLAGE: 'village', TOWN: 'town', CASTLE: 'castle' } as const;

/**
 * Was auf einem eigenen Feld in dieser Rüstzeit geht, gemessen am Entwurf; `null` für fremde und
 * freie Felder und wenn das Reich nicht rüstet. Ein ungültiger Entwurf erlaubt nichts Weiteres.
 */
export function fieldOptions(
  play: RealmPlay,
  seat: number,
  orders: readonly RealmOrderDto[],
  region: number,
): FieldOptions | null {
  const start = play.board.regions[region];
  const stock = realmSeat(play, seat);
  if (!start || start.owner !== seat || !stock || stock.eliminated) return null;
  const { economy } = play.realm;
  const plan = planOrders(play, seat, orders);
  const after = plannedRegion(play, plan, region);

  const next = REALM_BUILDINGS[buildingLevel(start.building) + 1];
  let build: BuildOption | null = null;
  if (next !== undefined && next !== 'NONE') {
    const ordered = orders.some((o) => o.kind === 'BUILD' && o.region === region);
    const attempt = ordered ? plan : planOrders(play, seat, withBuild(orders, region, true));
    build = {
      building: next,
      cost: economy.costs[BUILD_COST_KEY[next]],
      ordered,
      blocked: attempt.ok ? null : attempt.error,
    };
  }

  let recruit: RecruitOption | null = null;
  if (after.building === 'CASTLE') {
    const count = sum(orders, (o) => (o.kind === 'RECRUIT' && o.region === region ? o.count : 0));
    recruit = {
      count,
      max: plan.ok
        ? maxCount(play, seat, count, count + economy.armyCap, (n) =>
            withRecruit(orders, region, n),
          )
        : count,
      cost: economy.costs.army,
    };
  }

  const moved = sum(orders, (o) => (o.kind === 'MOVE' && o.from === region ? o.count : 0));
  const moves = regionNeighbors(play.map, region)
    .filter((to) => play.board.regions[to]?.owner === seat)
    .map((to): MoveOption => {
      const count = sum(orders, (o) =>
        o.kind === 'MOVE' && o.from === region && o.to === to ? o.count : 0,
      );
      return {
        to,
        count,
        max: plan.ok
          ? maxCount(play, seat, count, start.armies, (n) => withMove(orders, region, to, n))
          : count,
      };
    });

  return {
    region,
    building: after.building,
    armies: after.armies,
    build,
    recruit,
    movable: Math.max(0, start.armies - moved),
    moves,
  };
}

export interface TradeOption {
  readonly give: RealmResourceCode;
  /** So viel von `give` kostet 1 vom anderen Rohstoff. */
  readonly rate: number;
  readonly count: number;
  readonly max: number;
}

/** Tausch in beide Richtungen, gemessen am Entwurf. */
export function tradeOptions(
  play: RealmPlay,
  seat: number,
  orders: readonly RealmOrderDto[],
): readonly TradeOption[] {
  const stock = realmSeat(play, seat);
  if (!stock || stock.eliminated) return [];
  const rate = play.realm.economy.tradeRate;
  const valid = planOrders(play, seat, orders).ok;
  // Mehr Tausch, als beide Vorräte zusammen hergeben, geht nie
  const limit = Math.floor((stock.bread + stock.material) / rate);
  return (['BREAD', 'MATERIAL'] as const).map((give) => {
    const count = sum(orders, (o) => (o.kind === 'TRADE' && o.give === give ? o.count : 0));
    return {
      give,
      rate,
      count,
      max: valid ? maxCount(play, seat, count, limit, (n) => withTrade(orders, give, n)) : count,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Glücksrad
// ---------------------------------------------------------------------------------------------

/**
 * Rad, das ein Angriff von `attacker` auf `region` nach heutigem Stand bekäme: die Vorschau, bevor
 * das Ziel feststeht. `null`, wenn das Feld kein Ziel ist (eigenes oder freies Feld).
 */
export function wheelPreview(play: RealmPlay, attacker: number, region: number): RealmWheel | null {
  const target = play.board.regions[region];
  if (!target || target.owner === null || target.owner === attacker) return null;
  const favorites: QuestionCategory[][] = [];
  for (const seat of play.board.seats) favorites[seat.seat] = seat.favorites;
  return realmWheelOn(
    {
      map: play.map,
      economy: play.realm.economy,
      regions: play.board.regions,
      categories: play.realm.categories,
      favorites,
    },
    attacker,
    region,
  );
}

// ---------------------------------------------------------------------------------------------
// Bildschirm
// ---------------------------------------------------------------------------------------------

export type RealmScreenState =
  | MatchScreenState
  /** Rüstzeit: Die eigenen Befehle sind noch offen. */
  | 'prepare'
  /** Rüstzeit: Die eigenen Befehle sind abgegeben, andere rüsten noch. */
  | 'prepared'
  /** Rüstzeit anderer: das eigene Reich ist gefallen. */
  | 'watching-prepare'
  /** Aufdecken: Die Befehle aller Reiche stehen kurz auf der Karte. */
  | 'orders'
  /** Das Glücksrad eines Duells dreht und zeigt die Kategorie. */
  | 'wheel';

/**
 * Was der Bildschirm zeigt. Ohne Ausbau und in allen gemeinsamen Schritten gilt `screenStateOf`;
 * dazu kommen Rüstzeit, Aufdecken und Glücksrad. `editing`: Der Spieler hat seine abgegebenen
 * Befehle wieder geöffnet (eine neue Abgabe ersetzt die alte).
 */
export function realmScreenStateOf(
  view: MatchView | null,
  local: LocalQuestion | null,
  events: readonly ParsedMatchEvent[],
  editing = false,
): RealmScreenState {
  const base = screenStateOf(view, local);
  const play = realmPlayOf(view);
  if (!view || !play || view.match.status !== 'RUNNING') return base;
  if (view.phase?.kind === 'PREPARE') {
    const me = view.mySeat === null ? null : realmSeat(play, view.mySeat);
    if (!me || me.eliminated) return 'watching-prepare';
    return play.realm.myOrders === null || editing ? 'prepare' : 'prepared';
  }
  if (view.phase?.kind === 'ANNOUNCE') {
    // Das Rad steht nur in der Ansage vor der Wissensfrage im Schritt
    if (play.board.step.kind === 'DUEL_TRIVIA' && play.board.step.wheel) return 'wheel';
    if (events.at(-1)?.type === 'ORDERS_REVEALED') return 'orders';
  }
  return base;
}

/** Aufgedeckte Befehle einer Feldzugrunde, je Reich in der Reihenfolge des Aufdeckens. */
export function revealedOrders(
  events: readonly ParsedMatchEvent[],
  round: number,
): MatchEventOf<'ORDERS_REVEALED'>[] {
  return events.filter(
    (e): e is MatchEventOf<'ORDERS_REVEALED'> =>
      e.type === 'ORDERS_REVEALED' && e.payload.round === round,
  );
}
