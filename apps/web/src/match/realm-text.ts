import { regionResource } from '@rdw/game-core';
import type {
  MatchEventOf,
  QuestionCategory,
  RealmBuildingCode,
  RealmOrderDto,
} from '@rdw/protocol';
import type { Mark } from '../art/RealmIcons.tsx';
import { terrainOf } from '../art/terrain.ts';
import { t, tp } from '../i18n/i18n.ts';
import type { RegionName, SeatName } from './match-text.ts';
import type { RealmBuilt } from './RealmBoardArt.tsx';
import type { Cost, FieldBlock, MoveRefusal, RealmPlay, RealmRegionView } from './realm-model.ts';

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

/** Ein Feld, das einem Reich Brot oder Baustoff bringt. */
export interface IncomeSource {
  readonly region: number;
  readonly kind: 'bread' | 'material';
  readonly amount: number;
}

/**
 * Woher das Einkommen eines Reichs kommt: je Feld, was es bringt. Eine Burg bringt beides und
 * steht deshalb zweimal da.
 */
export function incomeSources(play: RealmPlay, seat: number): IncomeSource[] {
  return play.board.regions.flatMap((field, region) => {
    if (field.owner !== seat) return [];
    const { bread, material } = fieldYield(play, region, field.building);
    return [
      ...(bread > 0 ? [{ region, kind: 'bread' as const, amount: bread }] : []),
      ...(material > 0 ? [{ region, kind: 'material' as const, amount: material }] : []),
    ];
  });
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
// Rüstzeit: warum eine Zeile nichts anbietet, warum ein Feld kein Ziel ist
// ---------------------------------------------------------------------------------------------

/** Grund, aus dem eine der drei Zeilen eines Felds gerade nichts anbietet, in Worten. */
export function blockText(block: FieldBlock): string {
  switch (block.kind) {
    case 'MISSING': {
      const parts = [
        block.bread > 0 ? `${block.bread} ${t('realm.bread')}` : null,
        block.material > 0 ? `${block.material} ${t('realm.material')}` : null,
      ].filter((part): part is string => part !== null);
      return t('realm.prepare.block.MISSING', { what: parts.join(t('realm.prepare.block.and')) });
    }
    case 'CASTLE_LIMIT':
      return t('realm.prepare.block.CASTLE_LIMIT', { max: block.max });
    case 'ARMY_CAP':
      return t('realm.prepare.block.ARMY_CAP', { cap: block.cap });
    case 'TARGETS_FULL':
      return t('realm.prepare.block.TARGETS_FULL', { cap: block.cap });
    case 'ALL_MOVED':
    case 'MAX_LEVEL':
    case 'NEXT_ROUND':
    case 'NO_ARMY':
    case 'NO_CASTLE':
    case 'NO_NEIGHBOR':
    case 'OTHER':
      return t(`realm.prepare.block.${block.kind}`);
  }
}

/** Warum das angetippte Feld kein Ziel des offenen Zugs ist, als ganzer Satz. */
export function refusalText(refusal: MoveRefusal, name: SeatName): string {
  switch (refusal.kind) {
    case 'FOREIGN':
      return t('realm.prepare.refused.FOREIGN', { owner: name(refusal.owner) });
    case 'FULL':
      return t('realm.prepare.refused.FULL', { cap: refusal.cap });
    case 'FREE':
    case 'TOO_FAR':
      return t(`realm.prepare.refused.${refusal.kind}`);
  }
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
): 'FREE' | 'NONE' | 'VILLAGE' | 'TOWN' | 'CASTLE_HIT' | 'CASTLE_DESTROYED' | 'TAKEOVER' {
  if (target.owner === null) return 'FREE';
  if (target.building !== 'CASTLE') return target.building;
  if (target.castleLivesLeft > 1) return 'CASTLE_HIT';
  const castles = play.board.seats.find((s) => s.seat === target.owner)?.castles ?? 1;
  return castles > 1 ? 'CASTLE_DESTROYED' : 'TAKEOVER';
}

/**
 * Wessen Lieblingskategorie das Rad gezogen hat, aus der Sicht dieses Sitzes. Ohne Verteidiger
 * (freies Feld) zählt nur der Angreifer.
 */
export function wheelFits(
  category: QuestionCategory,
  favorites: (seat: number) => readonly QuestionCategory[],
  attacker: number,
  defender: number | null,
  mySeat: number | null,
  name: SeatName,
): string {
  const a = favorites(attacker).includes(category);
  if (defender === null) {
    if (attacker === mySeat) return t(a ? 'realm.wheel.fits.mine' : 'realm.wheel.fits.notMine');
    return t(a ? 'realm.wheel.fits.theirs' : 'realm.wheel.fits.notTheirs', {
      name: name(attacker),
    });
  }
  const d = favorites(defender).includes(category);
  if (!a && !d) return t('realm.wheel.fits.none');
  const mine = mySeat === attacker || mySeat === defender;
  if (a && d) return t(mine ? 'realm.wheel.fits.both' : 'realm.wheel.fits.bothOthers');
  const seat = a ? attacker : defender;
  return seat === mySeat
    ? t('realm.wheel.fits.mine')
    : t('realm.wheel.fits.theirs', { name: name(seat) });
}
