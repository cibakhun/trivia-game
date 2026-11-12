import type { MatchEventOf, RealmBoard, RealmOrderDto } from '@rdw/protocol';
import { t } from '../i18n/i18n.ts';
import type { BoardState } from './MatchBoard.tsx';
import type {
  RealmBuilt,
  RealmChange,
  RealmLayer,
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

type RealmDuel = MatchEventOf<'REALM_DUEL_RESOLVED'>;

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
  | 'FORTIFIED' {
  const { effect, building } = duel.payload;
  if (effect !== 'BUILDING_DAMAGED') return effect;
  return building === 'VILLAGE' ? 'TOWN_DOWN' : 'VILLAGE_GONE';
}

/** Schild auf der Karte über dem Feld eines eben entschiedenen Duells, in der Farbe des Siegers. */
export function outcomeSign(duel: RealmDuel): RealmChange {
  const p = duel.payload;
  return {
    region: p.region,
    text: t(`realm.outcome.sign.${outcomeSignKey(duel)}`),
    seat: p.winner === 'ATTACKER' ? p.attacker : p.defender,
  };
}
