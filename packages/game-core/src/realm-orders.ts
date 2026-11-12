import type { MatchEconomy } from '@rdw/protocol';
import { regionNeighbors, type MatchMap } from './match-map.ts';
import {
  buildingLevel,
  REALM_BUILDINGS,
  realmMapOf,
  type RealmBoardRegion,
  type RealmBuilding,
  type RealmOrder,
  type RealmRegionState,
  type RealmState,
} from './realm-state.ts';

/**
 * Rüstzeit der Partie mit Ausbau (docs/MATCH_RULES.md §11.3 und §11.4, ADR-057): Befehle eines
 * Reichs prüfen und ausführen. Die Befehle laufen in der gegebenen Reihenfolge (erst tauschen, dann
 * bauen geht; umgekehrt nicht, wenn das Geld fehlt). Weil jeder Befehl nur eigene Felder und
 * Vorräte betrifft, ist es gleich, in welcher Reihenfolge die Reiche aufgedeckt werden.
 *
 * Die Regeln selbst stehen in `planRealmOrders` und brauchen nur einen Ausschnitt des Bretts. So
 * prüft der Server gegen seinen Zustand (`checkRealmOrders`) und der Browser plant mit denselben
 * Regeln auf seiner Ansicht.
 */

/**
 * Obergrenze je Rüstzeit, damit eine Eingabe nicht beliebig groß wird. Dieselbe Zahl wie
 * `MAX_REALM_ORDERS` in protocol (Anfrage der API); ein Test hält beide gleich.
 */
export const MAX_REALM_ORDERS = 200;

export type RealmOrderError =
  /** Region unbekannt, Anzahl keine positive ganze Zahl, Rohstoff unbekannt. */
  | 'INVALID'
  | 'TOO_MANY_ORDERS'
  | 'NOT_OWN_REGION'
  | 'TOO_EXPENSIVE'
  /** Auf diesem Feld wurde in dieser Rüstzeit schon gebaut. */
  | 'ALREADY_BUILT'
  /** Burg ist die höchste Stufe. */
  | 'MAX_LEVEL'
  /** Das Reich hat schon so viele Burgen, wie erlaubt sind. */
  | 'CASTLE_LIMIT'
  /** Armeen entstehen nur in einer eigenen Burg. */
  | 'NOT_A_CASTLE'
  | 'NOT_NEIGHBORS'
  /** So viele Armeen, die in dieser Runde noch ziehen dürfen, stehen dort nicht. */
  | 'NOT_ENOUGH_ARMIES'
  /** Nach der Rüstzeit stünden zu viele Armeen auf einem Feld. */
  | 'ARMY_CAP';

export interface RealmOrdersSummary {
  readonly built: readonly { readonly region: number; readonly building: RealmBuilding }[];
  readonly recruited: number;
  readonly moved: number;
  readonly traded: number;
}

/**
 * Ausschnitt des Bretts, gegen den Befehle geprüft werden: Karte, Regelwerte, Felder und die
 * Vorräte des Reichs zu Beginn der Rüstzeit.
 */
export interface RealmOrdersBoard<R extends RealmBoardRegion = RealmBoardRegion> {
  readonly map: MatchMap;
  readonly economy: MatchEconomy;
  readonly regions: readonly R[];
  readonly bread: number;
  readonly material: number;
}

export type RealmOrdersPlan<R extends RealmBoardRegion = RealmBoardRegion> =
  | {
      readonly ok: true;
      readonly bread: number;
      readonly material: number;
      /** Geänderte Regionen nach allen Befehlen. */
      readonly regions: ReadonlyMap<number, R>;
      readonly summary: RealmOrdersSummary;
    }
  | {
      readonly ok: false;
      readonly error: RealmOrderError;
      /** Index des Befehls, an dem es scheitert. */
      readonly index: number;
    };

export type RealmOrdersCheck = RealmOrdersPlan<RealmRegionState>;

const BUILD_COST_KEY = { VILLAGE: 'village', TOWN: 'town', CASTLE: 'castle' } as const;

function isCount(n: unknown): n is number {
  return Number.isSafeInteger(n) && (n as number) >= 1;
}

/**
 * Prüft die Befehle eines Sitzes gegen den Stand zu Beginn der Rüstzeit und rechnet das Ergebnis
 * aus, ohne den Zustand zu ändern.
 */
export function checkRealmOrders(
  state: RealmState,
  seat: number,
  orders: readonly RealmOrder[],
): RealmOrdersCheck {
  const seatState = state.seats[seat];
  if (!seatState || seatState.eliminatedInDuel !== null) {
    return { ok: false, error: 'INVALID', index: 0 };
  }
  const plan = planRealmOrders(
    {
      map: realmMapOf(state),
      economy: state.rules.economy,
      regions: state.regions,
      bread: seatState.bread,
      material: seatState.material,
    },
    seat,
    orders,
  );
  if (!plan.ok) return plan;
  // Ein neues Gebäude beginnt ohne Treffer
  const regions = new Map(plan.regions);
  for (const { region } of plan.summary.built) {
    const built = regions.get(region);
    if (built) regions.set(region, { ...built, castleHits: 0 });
  }
  return { ...plan, regions };
}

/**
 * Die Regeln der Rüstzeit auf einem beliebigen Brett: prüft die Befehle des Sitzes `seat` und
 * rechnet Vorräte und geänderte Felder aus, ohne das Brett zu ändern. Ob das Reich überhaupt
 * rüsten darf (nicht ausgeschieden, Rüstzeit läuft), prüft der Aufrufer.
 */
export function planRealmOrders<R extends RealmBoardRegion>(
  board: RealmOrdersBoard<R>,
  seat: number,
  orders: readonly RealmOrder[],
): RealmOrdersPlan<R> {
  const fail = (error: RealmOrderError, index: number): RealmOrdersPlan<R> => ({
    ok: false,
    error,
    index,
  });
  if (orders.length > MAX_REALM_ORDERS) return fail('TOO_MANY_ORDERS', MAX_REALM_ORDERS);

  const { map, economy: econ } = board;
  let { bread, material } = board;
  let castles = board.regions.filter((r) => r.owner === seat && r.building === 'CASTLE').length;
  const changed = new Map<number, R>();
  const regionAt = (id: number): R => changed.get(id) ?? (board.regions[id] as R);
  const isOwn = (id: unknown): id is number =>
    Number.isInteger(id) &&
    (id as number) >= 0 &&
    (id as number) < board.regions.length &&
    board.regions[id as number]?.owner === seat;
  /** Armeen, die in dieser Runde noch ziehen dürfen: die vom Rundenbeginn, abzüglich gezogener. */
  const movable = new Map<number, number>();
  const builtHere = new Set<number>();
  /** Letzter Befehl, der Armeen auf ein Feld brachte (für die Meldung bei `ARMY_CAP`). */
  const lastArrival = new Map<number, number>();
  const built: { region: number; building: RealmBuilding }[] = [];
  let recruited = 0;
  let moved = 0;
  let traded = 0;

  for (const [index, order] of orders.entries()) {
    switch (order.kind) {
      case 'TRADE': {
        if (!isCount(order.count) || (order.give !== 'BREAD' && order.give !== 'MATERIAL')) {
          return fail('INVALID', index);
        }
        const price = order.count * econ.tradeRate;
        if (order.give === 'BREAD') {
          if (bread < price) return fail('TOO_EXPENSIVE', index);
          bread -= price;
          material += order.count;
        } else {
          if (material < price) return fail('TOO_EXPENSIVE', index);
          material -= price;
          bread += order.count;
        }
        traded += order.count;
        break;
      }
      case 'BUILD': {
        if (!Number.isInteger(order.region)) return fail('INVALID', index);
        if (!isOwn(order.region)) return fail('NOT_OWN_REGION', index);
        if (builtHere.has(order.region)) return fail('ALREADY_BUILT', index);
        const region = regionAt(order.region);
        const level = buildingLevel(region.building);
        const next = REALM_BUILDINGS[level + 1];
        if (next === undefined || next === 'NONE') return fail('MAX_LEVEL', index);
        if (next === 'CASTLE' && castles >= econ.maxCastles) return fail('CASTLE_LIMIT', index);
        const cost = econ.costs[BUILD_COST_KEY[next]];
        if (bread < cost.bread || material < cost.material) return fail('TOO_EXPENSIVE', index);
        bread -= cost.bread;
        material -= cost.material;
        if (next === 'CASTLE') castles += 1;
        changed.set(order.region, { ...region, building: next });
        builtHere.add(order.region);
        built.push({ region: order.region, building: next });
        break;
      }
      case 'RECRUIT': {
        if (!Number.isInteger(order.region) || !isCount(order.count)) return fail('INVALID', index);
        if (!isOwn(order.region)) return fail('NOT_OWN_REGION', index);
        const region = regionAt(order.region);
        if (region.building !== 'CASTLE') return fail('NOT_A_CASTLE', index);
        const cost = econ.costs.army;
        if (bread < cost.bread * order.count || material < cost.material * order.count) {
          return fail('TOO_EXPENSIVE', index);
        }
        bread -= cost.bread * order.count;
        material -= cost.material * order.count;
        changed.set(order.region, { ...region, armies: region.armies + order.count });
        lastArrival.set(order.region, index);
        recruited += order.count;
        break;
      }
      case 'MOVE': {
        if (!Number.isInteger(order.from) || !Number.isInteger(order.to) || !isCount(order.count)) {
          return fail('INVALID', index);
        }
        if (!isOwn(order.from) || !isOwn(order.to)) return fail('NOT_OWN_REGION', index);
        if (!regionNeighbors(map, order.from).includes(order.to)) {
          return fail('NOT_NEIGHBORS', index);
        }
        const left = movable.get(order.from) ?? (board.regions[order.from] as R).armies;
        if (left < order.count) return fail('NOT_ENOUGH_ARMIES', index);
        movable.set(order.from, left - order.count);
        const from = regionAt(order.from);
        changed.set(order.from, { ...from, armies: from.armies - order.count });
        const to = regionAt(order.to);
        changed.set(order.to, { ...to, armies: to.armies + order.count });
        lastArrival.set(order.to, index);
        moved += order.count;
        break;
      }
      default:
        return fail('INVALID', index);
    }
  }

  for (const [id, region] of changed) {
    if (region.armies > econ.armyCap) return fail('ARMY_CAP', lastArrival.get(id) ?? 0);
  }
  return {
    ok: true,
    bread,
    material,
    regions: changed,
    summary: { built, recruited, moved, traded },
  };
}
