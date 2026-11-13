import {
  armiesInRangeOn,
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
import {
  rulesOf,
  screenStateOf,
  type LocalQuestion,
  type MatchScreenState,
} from './match-model.ts';
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
  /** Leben einer neuen Burg (MATCH_RULES §11.2). */
  readonly castleLives: number;
}

/** Brett der Partie mit Ausbau; `null` ohne Ausbau und vor dem Start. */
export function realmPlayOf(view: MatchView | null): RealmPlay | null {
  const board = view?.realm?.board;
  if (!view || !view.realm || !board) return null;
  return {
    realm: view.realm,
    board,
    map: mapOfView(view),
    castleLives: rulesOf(view.match.rulesPreset).capital.lives,
  };
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
  const plan = planRealmOrders(
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
  if (!plan.ok) return plan;
  // Die Regeln kennen nur das Gebäude; eine neue Burg steht in der Ansicht mit vollen Leben
  const regions = new Map(plan.regions);
  for (const { region, building } of plan.summary.built) {
    const planned = regions.get(region);
    if (building === 'CASTLE' && planned) {
      regions.set(region, { ...planned, castleLivesLeft: play.castleLives });
    }
  }
  return { ...plan, regions };
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

/**
 * Tausch steht im Entwurf vorn: So zählt er für alles, was danach gebaut oder gekauft wird, auch
 * wenn der Spieler erst später tauscht. Die übrige Reihenfolge bleibt. Ein gültiger Entwurf bleibt
 * dabei gültig, weil alle anderen Befehle nur verbrauchen.
 */
export function tradesFirst(orders: readonly RealmOrderDto[]): RealmOrderDto[] {
  return [...orders.filter((o) => o.kind === 'TRADE'), ...orders.filter((o) => o.kind !== 'TRADE')];
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

/**
 * Grund, aus dem eine der drei Zeilen eines Felds (Bauen, Armeen kaufen, Ziehen) gerade nichts
 * anbietet. Das Blatt nennt ihn in Worten, statt die Zeile nur auszugrauen.
 */
export type FieldBlock =
  /** So viel fehlt im Vorrat, der nach dem Entwurf bliebe. */
  | { readonly kind: 'MISSING'; readonly bread: number; readonly material: number }
  | { readonly kind: 'MAX_LEVEL' }
  | { readonly kind: 'CASTLE_LIMIT'; readonly max: number }
  | { readonly kind: 'NO_CASTLE' }
  | { readonly kind: 'ARMY_CAP'; readonly cap: number }
  | { readonly kind: 'NO_ARMY' }
  /** Die Armeen hier sind in dieser Rüstzeit angekommen oder gekauft: Sie ziehen erst nächste Runde. */
  | { readonly kind: 'NEXT_ROUND' }
  | { readonly kind: 'ALL_MOVED' }
  | { readonly kind: 'NO_NEIGHBOR' }
  /** Auf keinem eigenen Nachbarfeld ist noch Platz. */
  | { readonly kind: 'TARGETS_FULL'; readonly cap: number }
  | { readonly kind: 'OTHER' };

export interface FieldRows {
  /** `null`: Der Ausbau geht oder ist schon befohlen. */
  readonly build: FieldBlock | null;
  /** `null`: Eine weitere Armee lässt sich kaufen. */
  readonly buy: FieldBlock | null;
  /** `null`: Von hier kann noch eine Armee auf ein eigenes Nachbarfeld ziehen. */
  readonly move: FieldBlock | null;
}

function missing(cost: Cost, left: Cost): FieldBlock {
  const bread = Math.max(0, cost.bread - left.bread);
  const material = Math.max(0, cost.material - left.material);
  return bread + material > 0 ? { kind: 'MISSING', bread, material } : { kind: 'OTHER' };
}

/** Was die drei Zeilen des Felds gerade anbieten und, wenn nicht, warum nicht. */
export function fieldRows(
  play: RealmPlay,
  seat: number,
  orders: readonly RealmOrderDto[],
  field: FieldOptions,
): FieldRows {
  const { economy } = play.realm;
  const stock = realmSeat(play, seat);
  const plan = planOrders(play, seat, orders);
  const left: Cost = plan.ok
    ? { bread: plan.bread, material: plan.material }
    : { bread: stock?.bread ?? 0, material: stock?.material ?? 0 };

  let build: FieldBlock | null = null;
  if (!field.build) build = { kind: 'MAX_LEVEL' };
  else if (!field.build.ordered && field.build.blocked !== null) {
    build =
      field.build.blocked === 'TOO_EXPENSIVE'
        ? missing(field.build.cost, left)
        : field.build.blocked === 'CASTLE_LIMIT'
          ? { kind: 'CASTLE_LIMIT', max: economy.maxCastles }
          : { kind: 'OTHER' };
  }

  let buy: FieldBlock | null = null;
  if (!field.recruit) buy = { kind: 'NO_CASTLE' };
  else if (field.recruit.max <= field.recruit.count) {
    buy =
      field.armies >= economy.armyCap
        ? { kind: 'ARMY_CAP', cap: economy.armyCap }
        : missing(field.recruit.cost, left);
  }

  let move: FieldBlock | null = null;
  const atStart = play.board.regions[field.region]?.armies ?? 0;
  if (atStart === 0) move = field.armies > 0 ? { kind: 'NEXT_ROUND' } : { kind: 'NO_ARMY' };
  else if (field.moves.length === 0) move = { kind: 'NO_NEIGHBOR' };
  else if (field.movable === 0) move = { kind: 'ALL_MOVED' };
  else if (!field.moves.some((option) => option.max > option.count)) {
    move = { kind: 'TARGETS_FULL', cap: economy.armyCap };
  }
  return { build, buy, move };
}

/**
 * Ob ein Reich ein Feld im Feldzug angreifen kann (MATCH_RULES §11.1, ADR-064): Das Ziel grenzt ans
 * eigene Land, und wo die Regeln es verlangen (`economy.attackNeedsArmy`), steht eine eigene Armee
 * daneben.
 */
export type AttackReach =
  /** Das Feld gehört dem Reich selbst. */
  | 'OWN'
  /** Es grenzt nicht ans eigene Land. */
  | 'FAR'
  /** Es grenzt ans eigene Land, aber auf keinem eigenen Nachbarfeld steht eine Armee. */
  | 'NO_ARMY'
  | 'TARGET';

/** Wie `attackReach`, gemessen an einem beliebigen Stand der Felder (etwa nach dem Entwurf). */
export function attackReachOn(
  play: RealmPlay,
  regions: readonly RealmRegionView[],
  seat: number,
  region: number,
): AttackReach {
  const target = regions[region];
  if (!target || target.owner === seat) return 'OWN';
  if (!regionNeighbors(play.map, region).some((id) => regions[id]?.owner === seat)) return 'FAR';
  const need = play.realm.economy.attackNeedsArmy;
  if (need === undefined || (need === 'RIVALS' && target.owner === null)) return 'TARGET';
  return armiesInRangeOn(play.map, regions, seat, region) > 0 ? 'TARGET' : 'NO_ARMY';
}

/** Ob `seat` das Feld nach heutigem Stand angreifen kann. */
export function attackReach(play: RealmPlay, seat: number, region: number): AttackReach {
  return attackReachOn(play, play.board.regions, seat, region);
}

/** Alle Felder, wie sie nach dem Entwurf stünden. */
export function plannedRegions(play: RealmPlay, plan: OrdersPlan): readonly RealmRegionView[] {
  if (!plan.ok) return play.board.regions;
  return play.board.regions.map((now, id) => plan.regions.get(id) ?? now);
}

/**
 * Felder, die `seat` nach seinem Entwurf im Feldzug dieser Runde angreifen könnte. Leer heißt: So
 * fiele sein Angriff aus (ADR-064). Was die anderen Reiche in derselben Rüstzeit befehlen und was
 * vor dem eigenen Angriff geschieht, ist hier nicht bekannt.
 */
export function plannedTargets(
  play: RealmPlay,
  seat: number,
  orders: readonly RealmOrderDto[],
): number[] {
  const regions = plannedRegions(play, planOrders(play, seat, orders));
  return regions.flatMap((_, id) =>
    attackReachOn(play, regions, seat, id) === 'TARGET' ? [id] : [],
  );
}

/**
 * Warum ein Tipp auf `region` kein Ziel des Zugs ist, den das Blatt gerade einstellt: fremdes oder
 * freies Feld, zu weit weg oder voll. `null`: Das Feld ist ein Ziel (oder das Startfeld selbst).
 */
export type MoveRefusal =
  | { readonly kind: 'FOREIGN'; readonly owner: number }
  | { readonly kind: 'FREE' }
  | { readonly kind: 'TOO_FAR' }
  | { readonly kind: 'FULL'; readonly cap: number };

export function moveRefusal(
  play: RealmPlay,
  seat: number,
  field: FieldOptions,
  region: number,
): MoveRefusal | null {
  if (region === field.region) return null;
  const owner = play.board.regions[region]?.owner ?? null;
  if (owner === null) return { kind: 'FREE' };
  if (owner !== seat) return { kind: 'FOREIGN', owner };
  const option = field.moves.find((move) => move.to === region);
  if (!option) return { kind: 'TOO_FAR' };
  // Voll ist das Ziel auch, wenn schon geplante Züge seinen letzten Platz belegen
  return option.max > option.count ? null : { kind: 'FULL', cap: play.realm.economy.armyCap };
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
 * das Ziel feststeht. Ein freies Feld hat keinen Verteidiger: Dann liegen nur die eigenen und die
 * freien Lose auf dem Rad (O-37). `null`, wenn das Feld kein Ziel ist (das eigene).
 */
export function wheelPreview(play: RealmPlay, attacker: number, region: number): RealmWheel | null {
  const target = play.board.regions[region];
  if (!target || target.owner === attacker) return null;
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

/**
 * Mit welcher Chance (ganze Prozent) das Rad eine dieser Lieblingskategorien zieht: die Teile ihrer
 * Felder am ganzen Rad, die freien und die des Gegners in diesen Kategorien mitgezählt.
 */
export function favoriteChance(
  wheel: Pick<RealmWheel, 'segments' | 'total'>,
  favorites: readonly QuestionCategory[],
): number {
  if (wheel.total <= 0) return 0;
  const mine = wheel.segments.reduce(
    (total, segment) => total + (favorites.includes(segment.category) ? segment.weight : 0),
    0,
  );
  return Math.round((mine / wheel.total) * 100);
}

// ---------------------------------------------------------------------------------------------
// Bildschirm
// ---------------------------------------------------------------------------------------------

/** Wie `MatchScreenState`: Die Zustände der Rüstzeit, des Aufdeckens und des Rads stehen dort. */
export type RealmScreenState = MatchScreenState;

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
    if (revealedRound(events) !== null) return 'orders';
  }
  return base;
}

/**
 * Runde, deren Befehle eben aufgedeckt wurden; `null`, wenn seither schon etwas anderes geschah.
 * Hinter dem Aufdecken können Angriffe stehen, die sofort ausfielen (ADR-064), und wenn alle
 * ausfielen, auch schon das Einkommen der nächsten Runde oder das Ende der Partie: Der Schritt des
 * Bretts ist dann schon weiter, das Aufgedeckte steht trotzdem noch.
 */
export function revealedRound(events: readonly ParsedMatchEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) return null;
    if (event.type === 'ORDERS_REVEALED') return event.payload.round;
    if (
      event.type !== 'ATTACK_SKIPPED' &&
      event.type !== 'INCOME' &&
      event.type !== 'REALM_MATCH_FINISHED'
    ) {
      return null;
    }
  }
  return null;
}

/** Reiche, deren Angriff in dieser Runde ausfiel, in der Reihenfolge der Runde (ADR-064). */
export function skippedAttackers(events: readonly ParsedMatchEvent[], round: number): number[] {
  return events.flatMap((e) =>
    e.type === 'ATTACK_SKIPPED' && e.payload.round === round ? [e.payload.attacker] : [],
  );
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

// ---------------------------------------------------------------------------------------------
// Ablauf: wo die Partie gerade steht und was danach kommt
// ---------------------------------------------------------------------------------------------

/** Abschnitt im Ablauf, wie ihn die Zeile links unter dem Band nennt. */
export type FlowStep = 'CASTLE' | 'VILLAGE' | 'LAND' | 'PREPARE' | 'ORDERS' | 'ATTACK';

export interface RoundFlowView {
  readonly steps: readonly FlowStep[];
  /** Stelle des laufenden Abschnitts; -1, bevor der erste beginnt (Startfrage). */
  readonly now: number;
}

const FLOW_OPENING: readonly FlowStep[] = ['CASTLE', 'VILLAGE', 'LAND'];
const FLOW_ROUND: readonly FlowStep[] = ['PREPARE', 'ORDERS', 'ATTACK'];

/**
 * Die drei Abschnitte, zwischen denen die Partie gerade läuft: in der Eröffnung Burg, Dorf und
 * Landnahme, im Feldzug jede Runde Rüsten, Aufdecken und Angriffe. `null`, wenn nichts läuft.
 */
export function roundFlow(play: RealmPlay, state: RealmScreenState): RoundFlowView | null {
  if (state === 'finished' || state === 'abandoned' || state === 'lobby') return null;
  // Das Aufgedeckte steht noch kurz, während der Server schon weiter ist: beim ersten Angriff
  // oder, wenn alle Angriffe ausfielen (ADR-064), in der nächsten Rüstzeit oder am Ende
  if (state === 'orders') return { steps: FLOW_ROUND, now: 1 };
  switch (play.board.step.kind) {
    case 'START_ESTIMATE':
      return { steps: FLOW_OPENING, now: -1 };
    case 'CASTLE_PICK':
      return { steps: FLOW_OPENING, now: 0 };
    case 'VILLAGE_PICK':
      return { steps: FLOW_OPENING, now: 1 };
    case 'LAND_ESTIMATE':
    case 'LAND_PICK':
      return { steps: FLOW_OPENING, now: 2 };
    case 'PREPARE':
      return { steps: FLOW_ROUND, now: 0 };
    case 'CAMPAIGN_TARGET':
    case 'DUEL_WHEEL':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
      return { steps: FLOW_ROUND, now: 2 };
    case 'FINISHED':
      return null;
  }
}
