import type { MatchEventOf, RealmBoard, RealmOrderDto } from '@rdw/protocol';
import { t } from '../i18n/i18n.ts';
import type { BoardState } from './MatchBoard.tsx';
import { duelWinner } from './match-model.ts';
import type {
  RealmBuilt,
  RealmChange,
  RealmFieldMotion,
  RealmLayer,
  RealmMotion,
  RealmMove,
  RealmRegionLayer,
} from './RealmBoardArt.tsx';
import { planOrders, type RealmPlay } from './realm-model.ts';

/**
 * Was die Karte von der Partie mit Ausbau zeigt (MATCH_RULES §11), als reine Ableitungen aus der
 * Ansicht: das Brett für `MatchBoard`, die Pläne der Rüstzeit, das Aufgedeckte und das Schild über
 * einem eben entschiedenen Duell.
 */

/** Brett für die Karte: Jede Burg zeichnet sie wie eine Hauptstadt, mit eigenen Leben. */
export function realmBoardState(board: RealmBoard): BoardState {
  return {
    regions: board.regions.map((r) => ({
      owner: r.owner,
      value: r.value,
      capitalOf: r.building === 'CASTLE' ? r.owner : null,
    })),
    seats: [],
  };
}

export function layerRegions(board: RealmBoard): RealmRegionLayer[] {
  return board.regions.map((r) => ({
    building: r.building,
    armies: r.armies,
    castleLives: r.castleLivesLeft,
    held: r.fortifications,
  }));
}

/** Züge mit demselben Weg fallen zu einem Pfeil zusammen. */
function mergeMoves(moves: readonly RealmMove[]): RealmMove[] {
  const merged = new Map<string, RealmMove>();
  for (const move of moves) {
    const key = `${move.seat}:${move.from}:${move.to}`;
    const before = merged.get(key);
    merged.set(key, before ? { ...before, count: before.count + move.count } : move);
  }
  return [...merged.values()];
}

/** Eigene Pläne der Rüstzeit: geplanter Bau (blass), Käufe und Züge. */
export function planLayer(
  play: RealmPlay,
  seat: number,
  orders: readonly RealmOrderDto[],
): Required<Pick<RealmLayer, 'planned' | 'recruits' | 'moves'>> {
  const planned: Record<number, RealmBuilt> = {};
  const recruits: Record<number, number> = {};
  const moves: RealmMove[] = [];
  for (const order of orders) {
    if (order.kind === 'RECRUIT') {
      recruits[order.region] = (recruits[order.region] ?? 0) + order.count;
    } else if (order.kind === 'MOVE') {
      moves.push({ from: order.from, to: order.to, count: order.count, seat });
    }
  }
  const plan = planOrders(play, seat, orders);
  if (plan.ok) {
    for (const { region, building } of plan.summary.built) {
      if (building !== 'NONE') planned[region] = building;
    }
  }
  return { planned, recruits, moves: mergeMoves(moves) };
}

/** Aufdecken: die Züge aller Reiche und die Felder, auf denen sich etwas geändert hat. */
export function revealLayer(
  revealed: readonly MatchEventOf<'ORDERS_REVEALED'>[],
): Required<Pick<RealmLayer, 'moves' | 'fresh'>> {
  const moves: RealmMove[] = [];
  const fresh = new Set<number>();
  for (const event of revealed) {
    const { seat, orders, summary } = event.payload;
    for (const built of summary.built) fresh.add(built.region);
    for (const order of orders) {
      if (order.kind === 'RECRUIT') fresh.add(order.region);
      if (order.kind === 'MOVE') {
        moves.push({ from: order.from, to: order.to, count: order.count, seat });
        fresh.add(order.to);
      }
    }
  }
  return { moves: mergeMoves(moves), fresh: [...fresh] };
}

/**
 * Aufdecken als Bewegung (ADR-067): je Feld, was dort gebaut wurde, wie viele Armeen aus der Burg
 * traten, ankamen und fortzogen. Daraus kennt die Karte den Stand davor, ohne ihn sich zu merken.
 */
export function revealMotion(revealed: readonly MatchEventOf<'ORDERS_REVEALED'>[]): RealmMotion {
  const fields: Record<number, RealmFieldMotion> = {};
  const add = (region: number, change: (field: RealmFieldMotion) => RealmFieldMotion) => {
    fields[region] = change(fields[region] ?? {});
  };
  for (const event of revealed) {
    const { orders, summary } = event.payload;
    for (const built of summary.built) add(built.region, (f) => ({ ...f, built: true }));
    for (const order of orders) {
      if (order.kind === 'RECRUIT') {
        add(order.region, (f) => ({ ...f, recruited: (f.recruited ?? 0) + order.count }));
      } else if (order.kind === 'MOVE') {
        add(order.from, (f) => ({ ...f, left: (f.left ?? 0) + order.count }));
        add(order.to, (f) => ({ ...f, arrived: (f.arrived ?? 0) + order.count }));
      }
    }
  }
  return { kind: 'orders', fields };
}

type RealmDuel = MatchEventOf<'REALM_DUEL_RESOLVED'>;

/**
 * Ausgang eines Duells als Bewegung (ADR-067): Ein beschädigtes Gebäude bricht eine Stufe ab, eine
 * getroffene Burg bebt und verliert ein Schild, eine genommene Burg stürzt ein, und wer verlor,
 * verliert sichtbar eine Armee. Die Eroberung selbst zeigt die Bühne des Duells.
 */
export function outcomeMotion(duel: RealmDuel): RealmMotion {
  const { effect, building, region, armyLost } = duel.payload;
  const fields: Record<number, RealmFieldMotion> = {};
  if (effect === 'BUILDING_DAMAGED') {
    fields[region] = { fell: building === 'VILLAGE' ? 'TOWN' : 'VILLAGE' };
  } else if (effect === 'CASTLE_HIT') {
    fields[region] = { hit: true };
  } else if (effect === 'CASTLE_DESTROYED' || effect === 'TAKEOVER') {
    // Das Feld gehört schon dem Angreifer: Die Burg fällt in der Farbe dessen, der sie verlor
    const { defender } = duel.payload;
    fields[region] = { fell: 'CASTLE', ...(defender === null ? {} : { fellOf: defender }) };
  }
  if (armyLost) fields[armyLost.region] = { ...fields[armyLost.region], lost: armyLost.seat };
  return { kind: 'outcome', fields };
}

/** Was mit dem umkämpften Feld geschah, als Schlüssel der kurzen Texte (`realm.outcome.sign`). */
export function outcomeSignKey(
  duel: RealmDuel,
):
  | 'CONQUERED'
  | 'VILLAGE_GONE'
  | 'TOWN_DOWN'
  | 'CASTLE_HIT'
  | 'CASTLE_DESTROYED'
  | 'TAKEOVER'
  | 'FORTIFIED'
  | 'CLAIMED'
  | 'UNCLAIMED' {
  const { effect, building } = duel.payload;
  if (effect !== 'BUILDING_DAMAGED') return effect;
  return building === 'VILLAGE' ? 'TOWN_DOWN' : 'VILLAGE_GONE';
}

/**
 * Schild auf der Karte über dem Feld eines eben entschiedenen Duells, in der Farbe des Siegers;
 * ohne Farbe, wenn ein freies Feld frei bleibt.
 */
export function outcomeSign(duel: RealmDuel): RealmChange {
  return {
    region: duel.payload.region,
    text: t(`realm.outcome.sign.${outcomeSignKey(duel)}`),
    seat: duelWinner(duel.payload),
  };
}
