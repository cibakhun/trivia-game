import type { QuestionCategory } from '@rdw/protocol';
import { regionDistance, regionNeighbors } from './match-map.ts';
import { MATCH_BOT_PROFILES, type MatchBotStrength } from './match-bots.ts';
import {
  DEFAULT_ESTIMATE_SPREAD,
  generateNpcEstimate,
  generateNpcTrivia,
  type EstimateSpreadParams,
  type NpcAnswer,
  type NpcProfile,
  type NpcQuestionSpec,
} from './npc.ts';
import {
  buildingLevel,
  castleLivesLeft,
  castlesOf,
  REALM_BUILDINGS,
  realmLegalRegions,
  realmMapOf,
  realmPoints,
  realmRegionsOf,
  type RealmOrder,
  type RealmRegionState,
  type RealmState,
} from './realm-state.ts';
import { realmWheel } from './realm-wheel.ts';
import type { Rng } from './rng.ts';

/**
 * Bots der Partie mit Ausbau (docs/MATCH_RULES.md §11.8, ADR-057): feste, einfache Regeln wie in
 * `match-bots.ts`, Gleichstände über den Strom `match`. Sie antworten über das NPC-Modell und in
 * ihren Lieblingskategorien eine Stufe besser.
 */

/**
 * Zuschlag auf die Fähigkeit eines Bots in seinen Lieblingskategorien [E]: Ein mittlerer Bot
 * trifft eine mittelschwere Frage dort zu rund 75 % statt 60 %.
 */
export const REALM_FAVORITE_THETA_BONUS = 0.7;

/** Antwortprofil eines Bots für eine Frage der Kategorie `category` (`null` = Schätzfrage). */
export function realmBotProfile(
  strength: MatchBotStrength,
  favorites: readonly QuestionCategory[],
  category: QuestionCategory | null,
): NpcProfile {
  const base = MATCH_BOT_PROFILES[strength];
  return category !== null && favorites.includes(category)
    ? { ...base, theta: base.theta + REALM_FAVORITE_THETA_BONUS }
    : base;
}

/**
 * Versiegelte Antworten eines Bots auf beide Fragen eines Duells, in derselben Ziehungsfolge wie
 * `generateNpcAnswer` (Strom `npc-answer`): die Wissensfrage aus der Kategorie des Glücksrads mit
 * dem Zuschlag für Lieblingskategorien, die Schätzfrage im Stechen ohne ihn, denn sie hat keine
 * Kategorie vom Rad (MATCH_RULES §11.5).
 */
export function generateRealmBotAnswer(
  rng: Rng,
  strength: MatchBotStrength,
  favorites: readonly QuestionCategory[],
  category: QuestionCategory,
  question: NpcQuestionSpec,
  spreadParams: EstimateSpreadParams = DEFAULT_ESTIMATE_SPREAD,
): NpcAnswer {
  if (!(question.estimate.scale > 0)) throw new RangeError('estimate_scale muss positiv sein');
  const triviaProfile = realmBotProfile(strength, favorites, category);
  const trivia = generateNpcTrivia(rng, triviaProfile, question.triviaB, question.wrongOptionCount);
  const estimate = generateNpcEstimate(
    rng,
    realmBotProfile(strength, favorites, null),
    question.estimate,
    question.estimateTimeLimitMs,
    spreadParams,
  );
  return {
    triviaCorrect: trivia.correct,
    wrongOptionIndex: trivia.wrongOptionIndex,
    estimate: estimate.estimate,
    estimateMs: estimate.estimateMs,
    audit: {
      theta: triviaProfile.theta,
      b: question.triviaB,
      pCorrect: trivia.pCorrect,
      spread: estimate.spread,
      draws: { trivia: trivia.draw, estimate: estimate.draws.estimate, time: estimate.draws.time },
    },
  };
}

/** Zufällige Lieblingskategorien eines Bots (Strom `match`). */
export function chooseRealmFavoritesForBot(
  categories: readonly QuestionCategory[],
  count: number,
  rng: Rng,
): QuestionCategory[] {
  const pool = [...categories];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const j = i + (rng.nextUint32() % (pool.length - i));
    [pool[i], pool[j]] = [pool[j] as QuestionCategory, pool[i] as QuestionCategory];
  }
  return pool.slice(0, count);
}

function pickBest(options: readonly number[], score: (region: number) => number, rng: Rng): number {
  let best: number[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const option of options) {
    const value = score(option);
    if (value > bestScore) {
      bestScore = value;
      best = [option];
    } else if (value === bestScore) {
      best.push(option);
    }
  }
  const choice = best[rng.nextUint32() % best.length];
  if (choice === undefined) throw new Error('Keine wählbare Region');
  return choice;
}

/** Annahme der Bots über die Trefferquote: in Lieblingskategorien 75 %, sonst 60 %. */
const ASSUMED_FAVORITE = 0.75;
const ASSUMED_OTHER = 0.6;
/** Annahme: Sind beide richtig, gewinnt der Angreifer die Schätzfrage knapp seltener. */
const ASSUMED_ESTIMATE_WIN = 0.48;

/**
 * Geschätzte Siegchance eines Angriffs aus dem Glücksrad. Bei einem freien Feld antwortet nur der
 * Angreifer: Seine Chance ist die Trefferquote in der gezogenen Kategorie.
 */
export function realmAttackChance(state: RealmState, attacker: number, region: number): number {
  const target = state.regions[region];
  if (!target || target.owner === attacker) return 0;
  const defender = target.owner;
  const wheel = realmWheel(state, attacker, region);
  const favA = state.seats[attacker]?.favorites ?? [];
  const favD = defender === null ? null : (state.seats[defender]?.favorites ?? []);
  let chance = 0;
  for (const segment of wheel.segments) {
    const pa = favA.includes(segment.category) ? ASSUMED_FAVORITE : ASSUMED_OTHER;
    let win = pa;
    if (favD !== null) {
      const pd = favD.includes(segment.category) ? ASSUMED_FAVORITE : ASSUMED_OTHER;
      win = pa * (1 - pd) + pa * pd * ASSUMED_ESTIMATE_WIN;
    }
    chance += (segment.weight / wheel.total) * win;
  }
  return chance;
}

/**
 * So viel zählt für einen Bot ein Punkt, den er einem Gegner abnimmt, gegenüber einem Punkt aus
 * freiem Land [E]: Ein erobertes Feld fehlt dem Gegner auch, ein freies Feld fehlt niemandem.
 */
export const REALM_RIVAL_GAIN_WEIGHT = 1.6;

/**
 * Was ein Sieg auf einem Feld unmittelbar bringt, in Punkten je nötigem Sieg: ein Feld ohne Gebäude
 * seinen Wert; Dorf und Stadt ihren Wert geteilt durch die Siege bis zur Eroberung; eine Burg mit
 * letztem Leben das ganze Reich (letzte Burg) oder ihr Feld, sonst ihren Wert geteilt durch ihre
 * Leben. Ein freies Feld bringt seinen Wert.
 */
export function realmTargetGain(state: RealmState, region: number): number {
  const target = state.regions[region];
  if (!target) return 0;
  if (target.owner === null) return target.value;
  if (target.building === 'CASTLE') {
    const lives = castleLivesLeft(state, region);
    if (lives <= 1) {
      return castlesOf(state, target.owner).length === 1
        ? realmPoints(state, target.owner)
        : target.value;
    }
    return target.value / lives;
  }
  return target.value / (buildingLevel(target.building) + 1);
}

/**
 * Wahl eines Bots im aktuellen Schritt:
 * - Burg: möglichst weit weg von den anderen Burgen (bis 3 Felder zählt), dann viele Nachbarn;
 * - Startdorf: etwa zwei Felder von der eigenen Burg, dann viele freie Nachbarn;
 * - Landnahme: viele eigene, dann viele freie Nachbarn;
 * - Angriffsziel: größter erwarteter Gewinn (Siegchance aus dem Glücksrad mal Gewinn); was einem
 *   Gegner abgenommen wird, zählt dabei mehr als freies Land (`REALM_RIVAL_GAIN_WEIGHT`).
 */
export function chooseRegionForRealmBot(state: RealmState, rng: Rng): number {
  const map = realmMapOf(state);
  const options = realmLegalRegions(state);
  const { step } = state;
  switch (step.kind) {
    case 'CASTLE_PICK': {
      const castles = state.regions.flatMap((r, id) => (r.building === 'CASTLE' ? [id] : []));
      return pickBest(
        options,
        (region) =>
          Math.min(3, ...castles.map((c) => regionDistance(map, region, c))) * 10 +
          regionNeighbors(map, region).length,
        rng,
      );
    }
    case 'VILLAGE_PICK': {
      const mine = realmRegionsOf(state, step.seat);
      return pickBest(
        options,
        (region) => {
          const near = Math.min(...mine.map((m) => regionDistance(map, region, m)));
          const free = regionNeighbors(map, region).filter(
            (n) => state.regions[n]?.owner === null,
          ).length;
          return -Math.abs(near - 2) * 10 + free;
        },
        rng,
      );
    }
    case 'LAND_PICK': {
      const seat = step.queue[0] as number;
      return pickBest(
        options,
        (region) => {
          const neighbors = regionNeighbors(map, region);
          const own = neighbors.filter((n) => state.regions[n]?.owner === seat).length;
          const free = neighbors.filter((n) => state.regions[n]?.owner === null).length;
          return own * 3 + free;
        },
        rng,
      );
    }
    case 'CAMPAIGN_TARGET':
      return pickBest(
        options,
        (region) =>
          realmAttackChance(state, step.attacker, region) *
          realmTargetGain(state, region) *
          (state.regions[region]?.owner === null ? 1 : REALM_RIVAL_GAIN_WEIGHT),
        rng,
      );
    case 'START_ESTIMATE':
    case 'LAND_ESTIMATE':
    case 'PREPARE':
    case 'DUEL_WHEEL':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      throw new Error(`Im Schritt ${step.kind} gibt es nichts zu wählen`);
  }
}

/**
 * Befehle eines Bots in der Rüstzeit, in dieser Reihenfolge:
 * 1. Armeen hinter der Grenze ziehen ein Feld Richtung Grenze (nächstes eigenes Feld mit
 *    gegnerischem Nachbarn; grenzt das Reich an keinen Gegner, zählt der Rand zum freien Land),
 *    soweit dort Platz ist.
 * 2. Ein Ausbau je Runde: die höchste erreichbare Stufe (Burg vor Stadt vor Dorf), auf dem Feld mit
 *    den wenigsten gegnerischen Nachbarn; fehlt ein Rohstoff, wird 3 zu 1 getauscht, wenn der andere
 *    reicht.
 * 3. Mit dem übrigen Brot Armeen in der Burg mit den wenigsten.
 */
export function chooseRealmOrdersForBot(state: RealmState, seat: number, rng: Rng): RealmOrder[] {
  const map = realmMapOf(state);
  const econ = state.rules.economy;
  const seatState = state.seats[seat];
  if (!seatState || seatState.eliminatedInDuel !== null) return [];
  const own = realmRegionsOf(state, seat);
  const ownSet = new Set(own);
  const orders: RealmOrder[] = [];
  const armies = new Map(own.map((id) => [id, (state.regions[id] as RealmRegionState).armies]));
  const enemyNeighbors = (id: number) =>
    regionNeighbors(map, id).filter((n) => {
      const owner = state.regions[n]?.owner;
      return owner !== null && owner !== undefined && owner !== seat;
    }).length;

  // 1. Ziehen: Abstand jedes eigenen Felds zur Grenze, nur durch eigenes Land
  const rivals = own.filter((id) => enemyNeighbors(id) > 0);
  const front =
    rivals.length > 0
      ? rivals
      : own.filter((id) => regionNeighbors(map, id).some((n) => state.regions[n]?.owner === null));
  const distance = new Map(front.map((id) => [id, 0]));
  const queue = [...front];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as number;
    for (const n of regionNeighbors(map, at)) {
      if (ownSet.has(n) && !distance.has(n)) {
        distance.set(n, (distance.get(at) as number) + 1);
        queue.push(n);
      }
    }
  }
  for (const id of own) {
    const count = (state.regions[id] as RealmRegionState).armies;
    const d = distance.get(id);
    if (count === 0 || d === undefined || d === 0) continue;
    const steps = regionNeighbors(map, id).filter((n) => distance.get(n) === d - 1);
    const to = steps.sort(
      (a, b) => (armies.get(a) as number) - (armies.get(b) as number) || a - b,
    )[0];
    if (to === undefined) continue;
    const room = econ.armyCap - (armies.get(to) as number);
    const moving = Math.min(count, room);
    if (moving <= 0) continue;
    orders.push({ kind: 'MOVE', from: id, to, count: moving });
    armies.set(id, (armies.get(id) as number) - moving);
    armies.set(to, (armies.get(to) as number) + moving);
  }

  // 2. Bauen
  let bread = seatState.bread;
  let material = seatState.material;
  const castles = castlesOf(state, seat).length;
  const costKey = { VILLAGE: 'village', TOWN: 'town', CASTLE: 'castle' } as const;
  const options = own
    .map((id) => ({
      id,
      next: REALM_BUILDINGS[buildingLevel(state.regions[id]?.building ?? 'NONE') + 1],
    }))
    .filter(
      (o): o is { id: number; next: 'VILLAGE' | 'TOWN' | 'CASTLE' } =>
        o.next !== undefined &&
        o.next !== 'NONE' &&
        (o.next !== 'CASTLE' || castles < econ.maxCastles),
    )
    .map((o) => ({
      ...o,
      level: buildingLevel(o.next),
      safety: -enemyNeighbors(o.id),
      tie: rng.nextUint32(),
    }))
    .sort((a, b) => b.level - a.level || b.safety - a.safety || a.tie - b.tie);
  for (const option of options) {
    const cost = econ.costs[costKey[option.next]];
    const needBread = Math.max(0, cost.bread - bread);
    const needMaterial = Math.max(0, cost.material - material);
    if (needBread > 0 && needMaterial > 0) continue;
    if (needBread > 0) {
      if (material - cost.material < needBread * econ.tradeRate) continue;
      orders.push({ kind: 'TRADE', give: 'MATERIAL', count: needBread });
      material -= needBread * econ.tradeRate;
      bread += needBread;
    } else if (needMaterial > 0) {
      if (bread - cost.bread < needMaterial * econ.tradeRate) continue;
      orders.push({ kind: 'TRADE', give: 'BREAD', count: needMaterial });
      bread -= needMaterial * econ.tradeRate;
      material += needMaterial;
    }
    orders.push({ kind: 'BUILD', region: option.id });
    bread -= cost.bread;
    material -= cost.material;
    break;
  }

  // 3. Armeen kaufen (in Burgen, die schon zu Beginn der Rüstzeit standen)
  const armyCost = econ.costs.army;
  const recruits = new Map<number, number>();
  const strongholds = castlesOf(state, seat);
  while (
    strongholds.length > 0 &&
    bread >= armyCost.bread &&
    material >= armyCost.material &&
    (armyCost.bread > 0 || armyCost.material > 0)
  ) {
    const open = strongholds.filter((id) => (armies.get(id) as number) < econ.armyCap);
    const at = open.sort(
      (a, b) => (armies.get(a) as number) - (armies.get(b) as number) || a - b,
    )[0];
    if (at === undefined) break;
    armies.set(at, (armies.get(at) as number) + 1);
    recruits.set(at, (recruits.get(at) ?? 0) + 1);
    bread -= armyCost.bread;
    material -= armyCost.material;
  }
  for (const [region, count] of recruits) orders.push({ kind: 'RECRUIT', region, count });
  return orders;
}
