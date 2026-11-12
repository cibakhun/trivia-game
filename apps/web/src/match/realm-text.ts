import { regionResource } from '@rdw/game-core';
import type {
  MatchEventOf,
  MatchView,
  QuestionCategory,
  RealmBuildingCode,
  RealmOrderDto,
} from '@rdw/protocol';
import type { Mark } from '../art/RealmIcons.tsx';
import { terrainOf } from '../art/terrain.ts';
import { t, tp } from '../i18n/i18n.ts';
import type { RegionName, SeatName } from './match-text.ts';
import type { RealmBuilt } from './RealmBoardArt.tsx';
import type { Cost, RealmPlay, RealmRegionView } from './realm-model.ts';

/**
 * Texte der Partie mit Ausbau (MATCH_RULES §11): Namen der Kategorien und Felder, die Befehle der
 * Rüstzeit als Plättchen, was beim Aufdecken geschah und was ein Sieg am Ziel bewirkt. Alles über
 * Schlüssel aus `de.ts` (ADR-036).
 */

export function categoryName(category: QuestionCategory): string {
  return t(`realm.category.${category}`);
}

const BUILDING_MARK: Readonly<Record<RealmBuilt, Mark>> = {
  VILLAGE: 'village',
  TOWN: 'town',
  CASTLE: 'castle',
};

export function buildingMark(building: RealmBuilt): Mark {
  return BUILDING_MARK[building];
}

/** Feld samt Gebäude als Name: „Dorf Kranichsee“. */
export function placeName(building: RealmBuildingCode, name: string): string {
  return t(`realm.place.${building}`, { region: name });
}

/** Am eigenen Sitz kurz „Du“, sonst der Name ohne Zusatz. */
export function shortNames(view: MatchView): SeatName {
  return (seat) => {
    const player = view.players.find((p) => p.seat === seat);
    if (!player) return `#${seat + 1}`;
    return player.isMe ? t('realm.you') : player.name;
  };
}

/** Ertrag eines Felds je Feldzugrunde, mit dem Gebäude, das dort steht. */
export function fieldYield(play: RealmPlay, region: number, building: RealmBuildingCode): Cost {
  const { yields } = play.realm.economy;
  if (building === 'CASTLE') return { bread: yields.castleBread, material: yields.castleMaterial };
  const amount =
    building === 'TOWN' ? yields.town : building === 'VILLAGE' ? yields.village : yields.plain;
  return regionResource(play.map, region) === 'BREAD'
    ? { bread: amount, material: 0 }
    : { bread: 0, material: amount };
}

/** Landschaft eines Felds als Wort: „Hügelland“. */
export function terrainName(play: RealmPlay, region: number): string {
  return t(`realm.terrain.${terrainOf(play.map.regions[region]?.name ?? '')}`);
}

// ---------------------------------------------------------------------------------------------
// Rüstzeit: Befehle als Plättchen
// ---------------------------------------------------------------------------------------------

export interface OrderChip {
  /** Stelle des Befehls im Entwurf. */
  readonly index: number;
  readonly kind: RealmOrderDto['kind'];
  readonly icon: Mark;
  /** Zweites Zeichen hinter dem Text (Tausch: was man bekommt). */
  readonly tail: Mark | null;
  readonly text: string;
  /** Ganzer Satz für Screenreader. */
  readonly label: string;
}

function resourceMark(give: 'BREAD' | 'MATERIAL'): 'bread' | 'material' {
  return give === 'BREAD' ? 'bread' : 'material';
}

/**
 * Befehle des Entwurfs in ihrer Reihenfolge. Ein Bau zeigt die Stufe, die entsteht: Dafür braucht
 * es das Brett (`play`) und die Bauten davor im selben Entwurf.
 */
export function orderChips(
  play: RealmPlay,
  orders: readonly RealmOrderDto[],
  region: RegionName,
): OrderChip[] {
  const rate = play.realm.economy.tradeRate;
  return orders.map((order, index): OrderChip => {
    switch (order.kind) {
      case 'BUILD': {
        const building = nextBuilding(play.board.regions[order.region]?.building ?? 'NONE');
        const name = t(`realm.building.${building}`);
        return {
          index,
          kind: order.kind,
          icon: buildingMark(building),
          tail: null,
          text: t('realm.prepare.order.BUILD', { building: name }),
          label: t('realm.prepare.order.BUILD_LONG', {
            building: name,
            region: region(order.region),
          }),
        };
      }
      case 'RECRUIT':
        return {
          index,
          kind: order.kind,
          icon: 'army',
          tail: null,
          text: t('realm.prepare.order.RECRUIT', { count: order.count }),
          label: t('realm.prepare.order.RECRUIT_LONG', {
            count: tp('realm.armies', order.count),
            region: region(order.region),
          }),
        };
      case 'MOVE':
        return {
          index,
          kind: order.kind,
          icon: 'move',
          tail: null,
          text: t('realm.prepare.order.MOVE', { count: order.count }),
          label: t('realm.prepare.order.MOVE_LONG', {
            count: tp('realm.armies', order.count),
            from: region(order.from),
            to: region(order.to),
          }),
        };
      case 'TRADE': {
        const get = order.give === 'BREAD' ? 'MATERIAL' : 'BREAD';
        return {
          index,
          kind: order.kind,
          icon: resourceMark(order.give),
          tail: resourceMark(get),
          text: t('realm.prepare.order.TRADE', { give: order.count * rate, get: order.count }),
          label: t('realm.prepare.order.TRADE_LONG', {
            give: `${order.count * rate} ${t(order.give === 'BREAD' ? 'realm.bread' : 'realm.material')}`,
            get: `${order.count} ${t(get === 'BREAD' ? 'realm.bread' : 'realm.material')}`,
          }),
        };
      }
    }
  });
}

function nextBuilding(building: RealmBuildingCode): RealmBuilt {
  return building === 'NONE' ? 'VILLAGE' : building === 'VILLAGE' ? 'TOWN' : 'CASTLE';
}

// ---------------------------------------------------------------------------------------------
// Aufdecken
// ---------------------------------------------------------------------------------------------

export interface RevealedPart {
  readonly icon: Mark;
  readonly text: string;
}

/** Was die Befehle eines Reichs bewirkt haben, in kurzen Zeilen; leer = es hat nicht gerüstet. */
export function revealedParts(
  event: MatchEventOf<'ORDERS_REVEALED'>,
  region: RegionName,
): RevealedPart[] {
  const { summary } = event.payload;
  const parts: RevealedPart[] = [];
  for (const built of summary.built) {
    if (built.building === 'NONE') continue;
    parts.push({
      icon: buildingMark(built.building),
      text: t('realm.orders.built', {
        building: t(`realm.building.${built.building}`),
        region: region(built.region),
      }),
    });
  }
  const armies = [
    summary.recruited > 0 ? t('realm.orders.recruited', { count: summary.recruited }) : null,
    summary.moved > 0 ? t('realm.orders.moved', { count: summary.moved }) : null,
  ].filter((text): text is string => text !== null);
  if (armies.length > 0) parts.push({ icon: 'army', text: armies.join(', ') });
  if (summary.traded > 0) {
    parts.push({ icon: 'trade', text: t('realm.orders.traded', { count: summary.traded }) });
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------
// Angriffsziel
// ---------------------------------------------------------------------------------------------

/** Was ein Sieg am Ziel bewirkt (MATCH_RULES §11.7), als Schlüssel von `realm.target.win`. */
export function targetWinKey(
  play: RealmPlay,
  target: RealmRegionView,
): 'NONE' | 'VILLAGE' | 'TOWN' | 'CASTLE_HIT' | 'CASTLE_DESTROYED' | 'TAKEOVER' {
  if (target.building !== 'CASTLE') return target.building;
  if (target.castleLivesLeft > 1) return 'CASTLE_HIT';
  const castles = play.board.seats.find((s) => s.seat === target.owner)?.castles ?? 1;
  return castles > 1 ? 'CASTLE_DESTROYED' : 'TAKEOVER';
}

/** Wessen Lieblingskategorie das Rad gezogen hat, aus der Sicht dieses Sitzes. */
export function wheelFits(
  category: QuestionCategory,
  favorites: (seat: number) => readonly QuestionCategory[],
  attacker: number,
  defender: number,
  mySeat: number | null,
  name: SeatName,
): string {
  const a = favorites(attacker).includes(category);
  const d = favorites(defender).includes(category);
  if (!a && !d) return t('realm.wheel.fits.none');
  const mine = mySeat === attacker || mySeat === defender;
  if (a && d) return t(mine ? 'realm.wheel.fits.both' : 'realm.wheel.fits.bothOthers');
  const seat = a ? attacker : defender;
  return seat === mySeat
    ? t('realm.wheel.fits.mine')
    : t('realm.wheel.fits.theirs', { name: name(seat) });
}
