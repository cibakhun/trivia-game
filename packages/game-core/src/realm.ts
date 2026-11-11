import type { QuestionCategory, RealmRules } from '@rdw/protocol';
import { compareDecimal, formatDecimal, type Decimal } from './decimal.ts';
import { resolveDuel } from './duel.ts';
import type { MatchDuelReason, MatchEstimateAnswer, MatchFinishReason } from './match.ts';
import { matchMap, regionNeighbors } from './match-map.ts';
import { checkRealmOrders, type RealmOrderError, type RealmOrdersSummary } from './realm-orders.ts';
import {
  buildingLevel,
  castlesOf,
  isRealmSeatAlive,
  REALM_BUILDINGS,
  REALM_STATE_VERSION,
  realmAliveSeats,
  realmAttackOrder,
  realmFreeRegions,
  realmIncome,
  realmLegalRegions,
  realmMapOf,
  realmRegionsOf,
  realmRoundOrder,
  realmStandings,
  type RealmBuilding,
  type RealmDuelSetup,
  type RealmOrder,
  type RealmRegionState,
  type RealmSeatState,
  type RealmStanding,
  type RealmState,
  type RealmStep,
  type RealmWheel,
} from './realm-state.ts';
import { realmWheel } from './realm-wheel.ts';
import type { Rng } from './rng.ts';

/**
 * Partie mit Ausbau als Zustandsmaschine aus reinen Funktionen (docs/MATCH_RULES.md §11,
 * ADR-057). Wie bei `match.ts` liegen Zeit und Zufall beim Aufrufer: Er stellt die Fragen, misst
 * die Zeiten, dreht das Glücksrad (`spinRealmWheel`, Strom `match`) und gibt die Ergebnisse als
 * `RealmInput` zurück. Die bisherige Partie bleibt unverändert, bis der Server umgestellt ist.
 *
 * Ablauf: Startfrage → Burgen in der Reihenfolge der Startfrage → Startdörfer rückwärts →
 * Landnahme → Feldzugrunden aus Einkommen, Rüstzeit (alle gleichzeitig), Aufdecken und Angriffen
 * mit Glücksrad → Abrechnung.
 */

export interface RealmSetup {
  /** Kategorien des Glücksrads (nur solche mit genug Fragen), ohne Doppelte. */
  readonly categories: readonly QuestionCategory[];
  /** Lieblingskategorien je Sitz, `economy.favorites` verschiedene aus `categories`. */
  readonly favorites: readonly (readonly QuestionCategory[])[];
}

export type RealmInput =
  | {
      readonly kind: 'START_ESTIMATES';
      /** Je Sitz genau ein Eintrag. */
      readonly answers: readonly ({ readonly seat: number } & MatchEstimateAnswer)[];
    }
  | { readonly kind: 'PICK_CASTLE'; readonly seat: number; readonly region: number }
  | { readonly kind: 'PICK_VILLAGE'; readonly seat: number; readonly region: number }
  | {
      readonly kind: 'LAND_ESTIMATES';
      readonly answers: readonly ({ readonly seat: number } & MatchEstimateAnswer)[];
    }
  | { readonly kind: 'PICK_REGION'; readonly seat: number; readonly region: number }
  /** Befehle eines Sitzes; ersetzt frühere Befehle desselben Sitzes in dieser Rüstzeit. */
  | {
      readonly kind: 'SUBMIT_ORDERS';
      readonly seat: number;
      readonly orders: readonly RealmOrder[];
    }
  /** Die Rüstzeit ist abgelaufen: Wer nichts abgegeben hat, tut in dieser Runde nichts. */
  | { readonly kind: 'CLOSE_PREPARE' }
  | { readonly kind: 'PICK_TARGET'; readonly seat: number; readonly region: number }
  /** Kategorie, auf der das Glücksrad stehen blieb. */
  | { readonly kind: 'SPIN_WHEEL'; readonly category: QuestionCategory }
  | {
      readonly kind: 'DUEL_TRIVIA';
      readonly attackerCorrect: boolean;
      readonly defenderCorrect: boolean;
    }
  | {
      readonly kind: 'DUEL_ESTIMATES';
      readonly attacker: MatchEstimateAnswer;
      readonly defender: MatchEstimateAnswer;
    };

export type RealmDuelEffect =
  /** Ein Feld ohne Gebäude gehört dem Angreifer. */
  | 'CONQUERED'
  /** Stadt wird Dorf, Dorf verschwindet; das Feld bleibt beim Verteidiger. */
  | 'BUILDING_DAMAGED'
  /** Die Burg verliert ein Leben. */
  | 'CASTLE_HIT'
  /** Die Burg ist zerstört, das Reich hat noch eine: nur dieses Feld geht an den Angreifer. */
  | 'CASTLE_DESTROYED'
  /** Die letzte Burg ist zerstört: Das ganze Reich geht an den Angreifer. */
  | 'TAKEOVER'
  /** Der Verteidiger hält; die Region ist mehr wert. */
  | 'FORTIFIED';

export interface RealmRankingRow {
  readonly seat: number;
  readonly place: number;
  readonly distance: string | null;
  readonly effectiveMs: number | null;
}

/** Was passiert ist, in Reihenfolge; JSON-tauglich. */
export type RealmEvent =
  | { readonly kind: 'START_RANKED'; readonly ranking: readonly RealmRankingRow[] }
  | {
      readonly kind: 'CASTLE_CHOSEN';
      readonly seat: number;
      readonly region: number;
      readonly armies: number;
    }
  | { readonly kind: 'VILLAGE_CHOSEN'; readonly seat: number; readonly region: number }
  | {
      readonly kind: 'LAND_RANKED';
      readonly round: number;
      readonly ranking: readonly (RealmRankingRow & { readonly picks: number })[];
    }
  | {
      readonly kind: 'REGION_CLAIMED';
      readonly round: number;
      readonly seat: number;
      readonly region: number;
    }
  | {
      readonly kind: 'INCOME';
      readonly round: number;
      readonly income: readonly {
        readonly seat: number;
        readonly bread: number;
        readonly material: number;
      }[];
    }
  | {
      readonly kind: 'ORDERS_REVEALED';
      readonly round: number;
      readonly seat: number;
      readonly orders: readonly RealmOrder[];
      readonly summary: RealmOrdersSummary;
      /** Vorräte danach. */
      readonly bread: number;
      readonly material: number;
    }
  | {
      readonly kind: 'TARGET_CHOSEN';
      readonly round: number;
      readonly attacker: number;
      readonly defender: number;
      readonly region: number;
      readonly wheel: RealmWheel;
    }
  | {
      readonly kind: 'WHEEL_SPUN';
      readonly round: number;
      readonly region: number;
      readonly category: QuestionCategory;
    }
  | {
      readonly kind: 'DUEL_RESOLVED';
      readonly round: number;
      readonly duel: number;
      readonly attacker: number;
      readonly defender: number;
      readonly region: number;
      readonly category: QuestionCategory;
      readonly winner: 'ATTACKER' | 'DEFENDER';
      readonly reason: MatchDuelReason;
      readonly effect: RealmDuelEffect;
      /** Gebäude auf dem Feld danach. */
      readonly building: RealmBuilding;
      /** Leben der Burg danach, nur bei `CASTLE_HIT`, `CASTLE_DESTROYED` und `TAKEOVER`. */
      readonly castleLivesLeft: number | null;
      /** Wert der Region danach. */
      readonly regionValue: number;
      /** Armee, die der Verlierer verlor (Feld), `null` = er hatte keine in Reichweite. */
      readonly armyLost: { readonly seat: number; readonly region: number } | null;
    }
  | {
      readonly kind: 'KINGDOM_ELIMINATED';
      readonly round: number;
      readonly seat: number;
      readonly by: number;
      /** Regionen und Vorräte, die an den Sieger gingen. */
      readonly regions: number;
      readonly bread: number;
      readonly material: number;
    }
  | {
      readonly kind: 'MATCH_FINISHED';
      readonly reason: MatchFinishReason;
      readonly standings: readonly RealmStanding[];
    };

export type RealmError =
  | 'WRONG_STEP'
  | 'NOT_YOUR_TURN'
  | 'INVALID_REGION'
  | 'INVALID_ANSWERS'
  /** Befehle der Rüstzeit verstoßen gegen eine Regel; `orderError` sagt, welche. */
  | 'INVALID_ORDERS'
  /** Die Kategorie steht nicht auf dem Glücksrad. */
  | 'INVALID_CATEGORY';

export type RealmResult =
  | { readonly ok: true; readonly state: RealmState; readonly events: readonly RealmEvent[] }
  | {
      readonly ok: false;
      readonly error: RealmError;
      readonly orderError?: { readonly error: RealmOrderError; readonly index: number };
    };

// ---------------------------------------------------------------------------------------------
// Aufbau

function assertRealmSetup(rules: RealmRules, setup: RealmSetup): void {
  const positive = (n: number) => Number.isInteger(n) && n >= 1;
  const { seats, landGrab, campaign, capital } = rules;
  if (
    rules.economy === undefined ||
    !positive(seats) ||
    landGrab.picksByPlace.length !== seats ||
    !landGrab.picksByPlace.every((n) => Number.isInteger(n) && n >= 0) ||
    !positive(landGrab.picksByPlace[0] ?? 0) ||
    !positive(campaign.rounds) ||
    !positive(capital.lives) ||
    !positive(capital.minDistance)
  ) {
    throw new RangeError('Ungültige Regeln der Partie mit Ausbau (matchRulesSchema)');
  }
  const { categories, favorites } = setup;
  if (categories.length === 0 || new Set(categories).size !== categories.length) {
    throw new RangeError('Das Glücksrad braucht verschiedene Kategorien');
  }
  if (favorites.length !== seats) throw new RangeError('Je Sitz eine Liste Lieblingskategorien');
  for (const list of favorites) {
    if (
      list.length !== rules.economy.favorites ||
      new Set(list).size !== list.length ||
      !list.every((c) => categories.includes(c))
    ) {
      throw new RangeError(
        `Je Sitz ${rules.economy.favorites} verschiedene Lieblingskategorien aus dem Glücksrad`,
      );
    }
  }
}

/** Neue Partie mit Ausbau: alle Regionen frei, alle beantworten die Startfrage. */
export function createRealm(rules: RealmRules, setup: RealmSetup): RealmState {
  assertRealmSetup(rules, setup);
  const map = matchMap(rules.map);
  return {
    version: REALM_STATE_VERSION,
    rules,
    categories: [...setup.categories],
    order: [],
    seats: setup.favorites.map((favorites) => ({
      favorites: [...favorites],
      bread: 0,
      material: 0,
      startCastle: null,
      eliminatedInDuel: null,
      eliminatedBy: null,
    })),
    regions: map.regions.map(() => ({
      owner: null,
      value: rules.values.region,
      fortifications: 0,
      building: 'NONE',
      castleHits: 0,
      startCastleOf: null,
      armies: 0,
    })),
    step: { kind: 'START_ESTIMATE' },
    duels: 0,
    questions: 0,
  };
}

/**
 * Wahl nach Zeitablauf: eine zufällige wählbare Region (Strom `match`), bewusst ohne Strategie,
 * damit Abwarten keinen Vorteil bringt.
 */
export function autoPickRealmRegion(state: RealmState, rng: Rng): number {
  const options = realmLegalRegions(state);
  const choice = options[rng.nextUint32() % options.length];
  if (choice === undefined)
    throw new Error(`Im Schritt ${state.step.kind} gibt es nichts zu wählen`);
  return choice;
}

// ---------------------------------------------------------------------------------------------
// Übergänge

type Draft = {
  order: number[];
  seats: RealmSeatState[];
  regions: RealmRegionState[];
  duels: number;
  questions: number;
};

function draftOf(state: RealmState): Draft {
  return {
    order: [...state.order],
    seats: [...state.seats],
    regions: [...state.regions],
    duels: state.duels,
    questions: state.questions,
  };
}

function withDraft(state: RealmState, draft: Draft, step: RealmStep): RealmState {
  return { ...state, ...draft, step };
}

function setRegion(draft: Draft, id: number, patch: Partial<RealmRegionState>): RealmRegionState {
  const next = { ...(draft.regions[id] as RealmRegionState), ...patch };
  draft.regions[id] = next;
  return next;
}

function setSeat(draft: Draft, seat: number, patch: Partial<RealmSeatState>): void {
  draft.seats[seat] = { ...(draft.seats[seat] as RealmSeatState), ...patch };
}

function fail(error: RealmError): RealmResult {
  return { ok: false, error };
}

function isRegionId(state: RealmState, region: number): boolean {
  return Number.isInteger(region) && region >= 0 && region < state.regions.length;
}

function isValidEstimate(answer: MatchEstimateAnswer): boolean {
  if (answer.distance !== null && answer.distance.units < 0n) return false;
  return (
    answer.effectiveMs === null ||
    (Number.isSafeInteger(answer.effectiveMs) && answer.effectiveMs >= 0)
  );
}

function compareNullableDecimal(a: Decimal | null, b: Decimal | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return compareDecimal(a, b);
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * Rangfolge einer Schätzfrage: kleinerer Abstand, dann kürzere Zeit, dann die gegebene Reihenfolge.
 * `null`, wenn die Antworten nicht genau einmal je Sitz aus `seats` kommen oder ungültig sind.
 */
function rankEstimates(
  seats: readonly number[],
  answers: readonly ({ readonly seat: number } & MatchEstimateAnswer)[],
): RealmRankingRow[] | null {
  const bySeat = new Map(answers.map((a) => [a.seat, a]));
  if (
    bySeat.size !== answers.length ||
    bySeat.size !== seats.length ||
    !seats.every((seat) => bySeat.has(seat)) ||
    !answers.every(isValidEstimate)
  ) {
    return null;
  }
  const ranked = [...seats].sort((a, b) => {
    const x = bySeat.get(a) as MatchEstimateAnswer;
    const y = bySeat.get(b) as MatchEstimateAnswer;
    return (
      compareNullableDecimal(x.distance, y.distance) ||
      compareNullableNumber(x.effectiveMs, y.effectiveMs) ||
      seats.indexOf(a) - seats.indexOf(b)
    );
  });
  return ranked.map((seat, index) => {
    const answer = bySeat.get(seat) as MatchEstimateAnswer;
    return {
      seat,
      place: index + 1,
      distance: answer.distance === null ? null : formatDecimal(answer.distance),
      effectiveMs: answer.effectiveMs,
    };
  });
}

/** Wendet eine Eingabe an; der alte Zustand bleibt unverändert. */
export function applyRealmInput(state: RealmState, input: RealmInput): RealmResult {
  const { step } = state;
  switch (input.kind) {
    case 'START_ESTIMATES': {
      if (step.kind !== 'START_ESTIMATE') return fail('WRONG_STEP');
      const ranking = rankEstimates(
        state.seats.map((_, seat) => seat),
        input.answers,
      );
      if (!ranking) return fail('INVALID_ANSWERS');
      const draft = draftOf(state);
      draft.order = ranking.map((r) => r.seat);
      draft.questions += 1;
      return {
        ok: true,
        state: withDraft(state, draft, { kind: 'CASTLE_PICK', seat: draft.order[0] as number }),
        events: [{ kind: 'START_RANKED', ranking }],
      };
    }

    case 'PICK_CASTLE': {
      if (step.kind !== 'CASTLE_PICK') return fail('WRONG_STEP');
      if (input.seat !== step.seat) return fail('NOT_YOUR_TURN');
      if (!isRegionId(state, input.region) || !realmLegalRegions(state).includes(input.region)) {
        return fail('INVALID_REGION');
      }
      const draft = draftOf(state);
      const armies = state.rules.economy.startArmies;
      setRegion(draft, input.region, {
        owner: input.seat,
        value: state.rules.values.capital,
        building: 'CASTLE',
        startCastleOf: input.seat,
        armies,
      });
      setSeat(draft, input.seat, { startCastle: input.region });
      const events: RealmEvent[] = [
        { kind: 'CASTLE_CHOSEN', seat: input.seat, region: input.region, armies },
      ];
      const next = state.order[state.order.indexOf(input.seat) + 1];
      const nextStep: RealmStep =
        next === undefined
          ? { kind: 'VILLAGE_PICK', seat: state.order[state.order.length - 1] as number }
          : { kind: 'CASTLE_PICK', seat: next };
      return { ok: true, state: withDraft(state, draft, nextStep), events };
    }

    case 'PICK_VILLAGE': {
      if (step.kind !== 'VILLAGE_PICK') return fail('WRONG_STEP');
      if (input.seat !== step.seat) return fail('NOT_YOUR_TURN');
      if (!isRegionId(state, input.region) || !realmLegalRegions(state).includes(input.region)) {
        return fail('INVALID_REGION');
      }
      const draft = draftOf(state);
      setRegion(draft, input.region, { owner: input.seat, building: 'VILLAGE' });
      const events: RealmEvent[] = [
        { kind: 'VILLAGE_CHOSEN', seat: input.seat, region: input.region },
      ];
      const reversed = [...state.order].reverse();
      const next = reversed[reversed.indexOf(input.seat) + 1];
      if (next !== undefined) {
        return {
          ok: true,
          state: withDraft(state, draft, { kind: 'VILLAGE_PICK', seat: next }),
          events,
        };
      }
      return continueLandGrab(withDraft(state, draft, step), 1, events);
    }

    case 'LAND_ESTIMATES': {
      if (step.kind !== 'LAND_ESTIMATE') return fail('WRONG_STEP');
      const ranking = rankEstimates(realmRoundOrder(state, step.round), input.answers);
      if (!ranking) return fail('INVALID_ANSWERS');
      const picks = state.rules.landGrab.picksByPlace;
      const rows = ranking.map((row, index) => ({ ...row, picks: picks[index] ?? 0 }));
      const queue = rows
        .flatMap((r) => Array.from({ length: r.picks }, () => r.seat))
        .slice(0, realmFreeRegions(state).length);
      const draft = draftOf(state);
      draft.questions += 1;
      const events: RealmEvent[] = [{ kind: 'LAND_RANKED', round: step.round, ranking: rows }];
      if (queue.length === 0) {
        return continueLandGrab(withDraft(state, draft, step), step.round + 1, events);
      }
      return {
        ok: true,
        state: withDraft(state, draft, { kind: 'LAND_PICK', round: step.round, queue, picked: [] }),
        events,
      };
    }

    case 'PICK_REGION': {
      if (step.kind !== 'LAND_PICK') return fail('WRONG_STEP');
      if (input.seat !== step.queue[0]) return fail('NOT_YOUR_TURN');
      if (!isRegionId(state, input.region) || !realmLegalRegions(state).includes(input.region)) {
        return fail('INVALID_REGION');
      }
      const draft = draftOf(state);
      setRegion(draft, input.region, { owner: input.seat });
      const events: RealmEvent[] = [
        { kind: 'REGION_CLAIMED', round: step.round, seat: input.seat, region: input.region },
      ];
      const queue = step.queue.slice(1);
      const picked = [...step.picked, input.seat];
      const after = withDraft(state, draft, { ...step, queue, picked });
      if (queue.length > 0 && realmFreeRegions(after).length > 0) {
        return { ok: true, state: after, events };
      }
      return continueLandGrab(after, step.round + 1, events);
    }

    case 'SUBMIT_ORDERS': {
      if (step.kind !== 'PREPARE') return fail('WRONG_STEP');
      if (!isRealmSeatAlive(state, input.seat)) return fail('NOT_YOUR_TURN');
      const check = checkRealmOrders(state, input.seat, input.orders);
      if (!check.ok) {
        return {
          ok: false,
          error: 'INVALID_ORDERS',
          orderError: { error: check.error, index: check.index },
        };
      }
      const orders = step.orders.map((o, seat) => (seat === input.seat ? [...input.orders] : o));
      const next: RealmState = { ...state, step: { ...step, orders } };
      if (orders.every((o) => o !== null)) return resolvePrepare(next, step.round, orders, []);
      return { ok: true, state: next, events: [] };
    }

    case 'CLOSE_PREPARE': {
      if (step.kind !== 'PREPARE') return fail('WRONG_STEP');
      return resolvePrepare(
        state,
        step.round,
        step.orders.map((o) => o ?? []),
        [],
      );
    }

    case 'PICK_TARGET': {
      if (step.kind !== 'CAMPAIGN_TARGET') return fail('WRONG_STEP');
      if (input.seat !== step.attacker) return fail('NOT_YOUR_TURN');
      if (!isRegionId(state, input.region) || !realmLegalRegions(state).includes(input.region)) {
        return fail('INVALID_REGION');
      }
      const defender = state.regions[input.region]?.owner as number;
      const wheel = realmWheel(state, step.attacker, input.region);
      const setup: RealmDuelSetup = {
        round: step.round,
        attacker: step.attacker,
        defender,
        region: input.region,
        attackers: step.attackers,
        queue: step.queue,
      };
      return {
        ok: true,
        state: { ...state, step: { kind: 'DUEL_WHEEL', wheel, ...setup } },
        events: [
          {
            kind: 'TARGET_CHOSEN',
            round: step.round,
            attacker: step.attacker,
            defender,
            region: input.region,
            wheel,
          },
        ],
      };
    }

    case 'SPIN_WHEEL': {
      if (step.kind !== 'DUEL_WHEEL') return fail('WRONG_STEP');
      const segment = step.wheel.segments.find((s) => s.category === input.category);
      if (!segment || segment.weight <= 0) return fail('INVALID_CATEGORY');
      return {
        ok: true,
        state: { ...state, step: { ...step, kind: 'DUEL_TRIVIA', category: input.category } },
        events: [
          { kind: 'WHEEL_SPUN', round: step.round, region: step.region, category: input.category },
        ],
      };
    }

    case 'DUEL_TRIVIA': {
      if (step.kind !== 'DUEL_TRIVIA') return fail('WRONG_STEP');
      const counted = { ...state, questions: state.questions + 1 };
      if (input.attackerCorrect && input.defenderCorrect) {
        return {
          ok: true,
          state: { ...counted, step: { ...step, kind: 'DUEL_ESTIMATE' } },
          events: [],
        };
      }
      const reason: MatchDuelReason =
        input.attackerCorrect || input.defenderCorrect ? 'TRIVIA' : 'BOTH_WRONG';
      return finishDuel(counted, step, input.attackerCorrect ? 'ATTACKER' : 'DEFENDER', reason);
    }

    case 'DUEL_ESTIMATES': {
      if (step.kind !== 'DUEL_ESTIMATE') return fail('WRONG_STEP');
      if (!isValidEstimate(input.attacker) || !isValidEstimate(input.defender)) {
        return fail('INVALID_ANSWERS');
      }
      // Dieselbe Auswertung wie in der bisherigen Partie: Abstand, dann Zeit, sonst hält der Verteidiger
      const outcome = resolveDuel(
        {
          triviaCorrect: true,
          estimateDistance: input.attacker.distance,
          estimateEffectiveMs: input.attacker.effectiveMs,
          answeredAll: true,
        },
        {
          triviaCorrect: true,
          estimateDistance: input.defender.distance,
          estimateEffectiveMs: input.defender.effectiveMs,
          answeredAll: true,
        },
      );
      if (outcome.winner === 'NONE') throw new Error('Duell ohne Sieger nach beiden Antworten');
      const { reason } = outcome;
      if (reason !== 'ESTIMATE' && reason !== 'SPEED' && reason !== 'FULL_TIE') {
        throw new Error(`Unerwarteter Duellausgang nach der Schätzfrage: ${reason}`);
      }
      const counted = { ...state, questions: state.questions + 1 };
      return finishDuel(counted, step, outcome.winner, reason);
    }
  }
}

/** Nächste Landnahmerunde, oder der Feldzug, wenn alle Regionen vergeben sind. */
function continueLandGrab(state: RealmState, round: number, events: RealmEvent[]): RealmResult {
  if (realmFreeRegions(state).length > 0) {
    return { ok: true, state: { ...state, step: { kind: 'LAND_ESTIMATE', round } }, events };
  }
  return startCampaignRound(state, 1, events);
}

/** Beginn einer Feldzugrunde: Einkommen, dann Rüstzeit. */
function startCampaignRound(state: RealmState, round: number, events: RealmEvent[]): RealmResult {
  const draft = draftOf(state);
  const alive = realmAliveSeats(state);
  const income = alive.map((seat) => ({ seat, ...realmIncome(state, seat) }));
  for (const { seat, bread, material } of income) {
    const s = state.seats[seat] as RealmSeatState;
    setSeat(draft, seat, { bread: s.bread + bread, material: s.material + material });
  }
  const orders = state.seats.map((_, seat) => (alive.includes(seat) ? null : []));
  return {
    ok: true,
    state: withDraft(state, draft, { kind: 'PREPARE', round, orders }),
    events: [...events, { kind: 'INCOME', round, income }],
  };
}

/** Aufdecken: Befehle aller Reiche ausführen, dann greift der Erste der Runde an. */
function resolvePrepare(
  state: RealmState,
  round: number,
  orders: readonly (readonly RealmOrder[])[],
  events: RealmEvent[],
): RealmResult {
  const draft = draftOf(state);
  const out = [...events];
  for (const seat of realmRoundOrder(state, round)) {
    const list = orders[seat] ?? [];
    // Befehle betreffen nur eigene Felder: gegen den Stand vor dem Aufdecken geprüft, bleiben sie gültig
    const check = checkRealmOrders(state, seat, list);
    if (!check.ok)
      throw new Error(`Befehle von Sitz ${seat} beim Aufdecken ungültig: ${check.error}`);
    for (const [id, region] of check.regions) draft.regions[id] = region;
    setSeat(draft, seat, { bread: check.bread, material: check.material });
    out.push({
      kind: 'ORDERS_REVEALED',
      round,
      seat,
      orders: [...list],
      summary: check.summary,
      bread: check.bread,
      material: check.material,
    });
  }
  const revealed = withDraft(state, draft, state.step);
  const attackers = realmAttackOrder(revealed, round);
  return nextAttack(revealed, round, attackers, attackers, out);
}

/** Nächster lebender Angreifer der Runde, sonst die nächste Runde oder das Ende. */
function nextAttack(
  state: RealmState,
  round: number,
  attackers: readonly number[],
  queue: readonly number[],
  events: RealmEvent[],
): RealmResult {
  if (realmAliveSeats(state).length <= 1) return finish(state, 'LAST_KINGDOM', round, events);
  const [attacker, ...rest] = queue.filter((seat) => isRealmSeatAlive(state, seat));
  if (attacker === undefined) {
    if (round >= state.rules.campaign.rounds) {
      return finish(state, 'ROUNDS_COMPLETE', round, events);
    }
    return startCampaignRound(state, round + 1, events);
  }
  return {
    ok: true,
    state: {
      ...state,
      step: { kind: 'CAMPAIGN_TARGET', round, attacker, attackers, queue: rest },
    },
    events,
  };
}

/**
 * Feld, von dem der Verlierer eines Duells eine Armee verliert: der Verteidiger zuerst vom
 * angegriffenen Feld, sonst wie der Angreifer vom eigenen Nachbarfeld mit den meisten Armeen (bei
 * Gleichstand das mit der kleineren ID); `null`, wenn er keine in Reichweite hat.
 */
function armyLossRegion(state: RealmState, seat: number, region: number): number | null {
  const target = state.regions[region] as RealmRegionState;
  if (target.owner === seat && target.armies > 0) return region;
  let best: number | null = null;
  for (const id of regionNeighbors(realmMapOf(state), region)) {
    const r = state.regions[id] as RealmRegionState;
    if (r.owner !== seat || r.armies === 0) continue;
    if (best === null || r.armies > (state.regions[best] as RealmRegionState).armies) best = id;
  }
  return best;
}

function finishDuel(
  state: RealmState,
  setup: RealmDuelSetup & { readonly category: QuestionCategory },
  winner: 'ATTACKER' | 'DEFENDER',
  reason: MatchDuelReason,
): RealmResult {
  const draft = draftOf(state);
  draft.duels += 1;
  const duel = draft.duels;
  const { attacker, defender, region, round, category } = setup;
  const events: RealmEvent[] = [];

  // Wer verliert, verliert eine beteiligte Armee
  const loser = winner === 'ATTACKER' ? defender : attacker;
  const lossAt = armyLossRegion(state, loser, region);
  if (lossAt !== null) {
    setRegion(draft, lossAt, { armies: (draft.regions[lossAt] as RealmRegionState).armies - 1 });
  }
  const armyLost = lossAt === null ? null : { seat: loser, region: lossAt };

  const target = draft.regions[region] as RealmRegionState;
  let effect: RealmDuelEffect;
  let castleLivesLeftAfter: number | null = null;
  let eliminated: { regions: number; bread: number; material: number } | null = null;

  if (winner === 'DEFENDER') {
    effect = 'FORTIFIED';
    setRegion(draft, region, {
      value: target.value + state.rules.values.defenseBonus,
      fortifications: target.fortifications + 1,
    });
  } else if (target.building === 'CASTLE') {
    const hits = target.castleHits + 1;
    castleLivesLeftAfter = Math.max(0, state.rules.capital.lives - hits);
    if (castleLivesLeftAfter > 0) {
      effect = 'CASTLE_HIT';
      setRegion(draft, region, { castleHits: hits });
    } else if (castlesOf(state, defender).length > 1) {
      // Das Reich hat noch eine Burg: nur dieses Feld geht an den Angreifer, die Armeen darauf sind verloren
      effect = 'CASTLE_DESTROYED';
      setRegion(draft, region, {
        owner: attacker,
        building: 'NONE',
        castleHits: 0,
        startCastleOf: null,
        armies: 0,
      });
    } else {
      // Die letzte Burg: Das ganze Reich geht an den Angreifer, mit Gebäuden und Vorräten;
      // seine Armeen lösen sich auf
      effect = 'TAKEOVER';
      const taken = realmRegionsOf(state, defender);
      for (const id of taken) setRegion(draft, id, { owner: attacker, armies: 0 });
      setRegion(draft, region, { building: 'NONE', castleHits: 0, startCastleOf: null });
      const lost = state.seats[defender] as RealmSeatState;
      const winnerSeat = state.seats[attacker] as RealmSeatState;
      setSeat(draft, attacker, {
        bread: winnerSeat.bread + lost.bread,
        material: winnerSeat.material + lost.material,
      });
      setSeat(draft, defender, {
        bread: 0,
        material: 0,
        eliminatedInDuel: duel,
        eliminatedBy: attacker,
      });
      eliminated = { regions: taken.length, bread: lost.bread, material: lost.material };
    }
  } else if (target.building !== 'NONE') {
    effect = 'BUILDING_DAMAGED';
    setRegion(draft, region, {
      building: REALM_BUILDINGS[buildingLevel(target.building) - 1] as RealmBuilding,
    });
  } else {
    effect = 'CONQUERED';
    setRegion(draft, region, { owner: attacker, armies: 0 });
  }

  const after = draft.regions[region] as RealmRegionState;
  events.push({
    kind: 'DUEL_RESOLVED',
    round,
    duel,
    attacker,
    defender,
    region,
    category,
    winner,
    reason,
    effect,
    building: after.building,
    castleLivesLeft: castleLivesLeftAfter,
    regionValue: after.value,
    armyLost,
  });
  if (eliminated) {
    events.push({ kind: 'KINGDOM_ELIMINATED', round, seat: defender, by: attacker, ...eliminated });
  }
  return nextAttack(
    withDraft(state, draft, state.step),
    round,
    setup.attackers,
    setup.queue,
    events,
  );
}

function finish(
  state: RealmState,
  reason: MatchFinishReason,
  round: number,
  events: RealmEvent[],
): RealmResult {
  const done: RealmState = { ...state, step: { kind: 'FINISHED', reason, round } };
  return {
    ok: true,
    state: done,
    events: [...events, { kind: 'MATCH_FINISHED', reason, standings: realmStandings(done) }],
  };
}
