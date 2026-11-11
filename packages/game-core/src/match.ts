import type { MatchRules } from '@rdw/protocol';
import { compareDecimal, formatDecimal, type Decimal } from './decimal.ts';
import { resolveDuel } from './duel.ts';
import { matchMap, regionDistance, regionNeighbors, type MatchMap } from './match-map.ts';
import type { Rng } from './rng.ts';

/**
 * Rundenbasierte Partie als Zustandsmaschine aus reinen Funktionen (docs/MATCH_RULES.md, ADR-047).
 *
 * Der Zustand ist reines JSON (keine Map, kein bigint): Der Server speichert ihn, stellt Fragen,
 * misst Zeiten und gibt die Ergebnisse als `MatchInput` zurück; `applyMatchInput` prüft sie und
 * schaltet weiter. Zeit und Zufall liegen außerhalb: Die Zugreihenfolge bestimmt der Aufrufer
 * (`drawSeatOrder`), Gleichstände ohne Zufall die Reihenfolge der Runde.
 *
 * Sitze sind 0 … seats − 1 in Zugreihenfolge. Runde n beginnt bei Sitz (n − 1) mod seats; so
 * wechselt, wer bei völligem Gleichstand vorn liegt und wer im Feldzug zuerst angreift.
 */

export const MATCH_STATE_VERSION = 1;

export interface MatchRegionState {
  /** Besitzender Sitz, `null` = frei (nur vor dem Ende der Landnahme). */
  readonly owner: number | null;
  /** Punktwert: Grundwert plus Befestigungen. */
  readonly value: number;
  /** Sitz, dessen Hauptstadt hier steht; nach einer Übernahme `null`. */
  readonly capitalOf: number | null;
  /** Erfolgreiche Verteidigungen dieser Region. */
  readonly fortifications: number;
}

export interface MatchSeatState {
  readonly capital: number | null;
  /** Verlorene Hauptstadtleben. */
  readonly capitalHits: number;
  /** Laufende Nummer des Duells, in dem das Reich übernommen wurde; `null` = im Spiel. */
  readonly eliminatedInDuel: number | null;
  readonly eliminatedBy: number | null;
}

export type MatchFinishReason = 'ROUNDS_COMPLETE' | 'LAST_KINGDOM';

/** Worauf die Partie gerade wartet. */
export type MatchStep =
  | { readonly kind: 'CAPITAL_PICK'; readonly seat: number }
  | { readonly kind: 'LAND_ESTIMATE'; readonly round: number }
  | {
      readonly kind: 'LAND_PICK';
      readonly round: number;
      /** Wer noch wählt, in dieser Reihenfolge; `queue[0]` ist dran. */
      readonly queue: readonly number[];
      /**
       * Wer in dieser Runde schon gewählt hat, in Reihenfolge der Wahlen (nur für die Anzeige der
       * Zugfolge). Fehlt in Zuständen, die vor diesem Feld gespeichert wurden.
       */
      readonly picked?: readonly number[];
    }
  | {
      readonly kind: 'CAMPAIGN_TARGET';
      readonly round: number;
      readonly attacker: number;
      /** Angreifer nach diesem in derselben Runde. */
      readonly queue: readonly number[];
    }
  | ({ readonly kind: 'DUEL_TRIVIA' | 'DUEL_ESTIMATE' } & DuelSetup)
  | {
      readonly kind: 'FINISHED';
      readonly reason: MatchFinishReason;
      /** Feldzugrunde, in der die Partie endete; fehlt in Partien von vor ADR-055. */
      readonly round?: number;
    };

interface DuelSetup {
  readonly round: number;
  readonly attacker: number;
  readonly defender: number;
  readonly region: number;
  readonly queue: readonly number[];
}

export type MatchPhase = 'CAPITALS' | 'LAND_GRAB' | 'CAMPAIGN' | 'FINISHED';

export interface MatchState {
  readonly version: typeof MATCH_STATE_VERSION;
  readonly rules: MatchRules;
  readonly seats: readonly MatchSeatState[];
  readonly regions: readonly MatchRegionState[];
  readonly step: MatchStep;
  /** Aufgelöste Duelle. */
  readonly duels: number;
  /** Gestellte Fragen (Schätz- und Wissensfragen, jede zählt einmal, egal wie viele antworten). */
  readonly questions: number;
}

/** Ergebnis einer Schätzfrage für einen Sitz; `null` = nicht beantwortet (zählt als +∞). */
export interface MatchEstimateAnswer {
  readonly distance: Decimal | null;
  /** Effektive Antwortzeit in ms (QUIZ_ENGINE §6.2). */
  readonly effectiveMs: number | null;
}

export type MatchInput =
  | { readonly kind: 'PICK_CAPITAL'; readonly seat: number; readonly region: number }
  | {
      readonly kind: 'LAND_ESTIMATES';
      /** Je Sitz genau ein Eintrag. */
      readonly answers: readonly ({ readonly seat: number } & MatchEstimateAnswer)[];
    }
  | { readonly kind: 'PICK_REGION'; readonly seat: number; readonly region: number }
  | { readonly kind: 'PICK_TARGET'; readonly seat: number; readonly region: number }
  | {
      readonly kind: 'DUEL_TRIVIA';
      /** Verpasst zählt als falsch. */
      readonly attackerCorrect: boolean;
      readonly defenderCorrect: boolean;
    }
  | {
      readonly kind: 'DUEL_ESTIMATES';
      readonly attacker: MatchEstimateAnswer;
      readonly defender: MatchEstimateAnswer;
    };

export type MatchDuelReason = 'TRIVIA' | 'BOTH_WRONG' | 'ESTIMATE' | 'SPEED' | 'FULL_TIE';
export type MatchDuelEffect = 'CONQUERED' | 'CAPITAL_HIT' | 'TAKEOVER' | 'FORTIFIED';

export interface MatchStanding {
  readonly seat: number;
  /** 1 = bester Platz; bei völligem Gleichstand geteilt (1, 1, 3). */
  readonly place: number;
  readonly points: number;
  readonly regions: number;
  readonly capitalLives: number;
  readonly eliminated: boolean;
}

/** Was passiert ist, in Reihenfolge; JSON-tauglich (Abstände als kanonischer Text). */
export type MatchEvent =
  | { readonly kind: 'CAPITAL_CHOSEN'; readonly seat: number; readonly region: number }
  | {
      readonly kind: 'LAND_RANKED';
      readonly round: number;
      readonly ranking: readonly {
        readonly seat: number;
        readonly place: number;
        readonly picks: number;
        readonly distance: string | null;
        readonly effectiveMs: number | null;
      }[];
    }
  | {
      readonly kind: 'REGION_CLAIMED';
      readonly round: number;
      readonly seat: number;
      readonly region: number;
    }
  | {
      readonly kind: 'TARGET_CHOSEN';
      readonly round: number;
      readonly attacker: number;
      readonly defender: number;
      readonly region: number;
    }
  | {
      readonly kind: 'DUEL_RESOLVED';
      readonly round: number;
      readonly duel: number;
      readonly attacker: number;
      readonly defender: number;
      readonly region: number;
      readonly winner: 'ATTACKER' | 'DEFENDER';
      readonly reason: MatchDuelReason;
      readonly effect: MatchDuelEffect;
      /** Leben der Hauptstadt danach, nur bei `CAPITAL_HIT` und `TAKEOVER`. */
      readonly capitalLivesLeft: number | null;
      /** Wert der Region danach. */
      readonly regionValue: number;
    }
  | {
      readonly kind: 'KINGDOM_ELIMINATED';
      readonly round: number;
      readonly seat: number;
      readonly by: number;
      /** Regionen, die an den Sieger gingen. */
      readonly regions: number;
    }
  | {
      readonly kind: 'MATCH_FINISHED';
      readonly reason: MatchFinishReason;
      readonly standings: readonly MatchStanding[];
    };

export type MatchError =
  /** Die Eingabe passt nicht zum aktuellen Schritt. */
  | 'WRONG_STEP'
  /** Ein anderer Sitz ist dran. */
  | 'NOT_YOUR_TURN'
  /** Region unbekannt oder in diesem Schritt nicht wählbar. */
  | 'INVALID_REGION'
  /** Antworten unvollständig, doppelt oder mit ungültigen Werten. */
  | 'INVALID_ANSWERS';

export type MatchResult =
  | { readonly ok: true; readonly state: MatchState; readonly events: readonly MatchEvent[] }
  | { readonly ok: false; readonly error: MatchError };

// ---------------------------------------------------------------------------------------------
// Aufbau

/**
 * Grobe Prüfung der Regeln, von denen die Zustandsmaschine abhängt. Die vollständige Prüfung macht
 * `matchRulesSchema` (protocol), wenn der Server die Regeln liest; game-core nutzt protocol nur für
 * Typen.
 */
function assertMatchRules(rules: MatchRules): void {
  const positive = (n: number) => Number.isInteger(n) && n >= 1;
  const { seats, landGrab, campaign, capital } = rules;
  if (
    !positive(seats) ||
    landGrab.picksByPlace.length !== seats ||
    !landGrab.picksByPlace.every((n) => Number.isInteger(n) && n >= 0) ||
    !positive(landGrab.picksByPlace[0] ?? 0) ||
    !positive(campaign.rounds) ||
    !positive(capital.lives) ||
    !positive(capital.minDistance)
  ) {
    throw new RangeError('Ungültige Regeln der Partie (matchRulesSchema)');
  }
}

/** Neue Partie: alle Regionen frei, Sitz 0 wählt die erste Hauptstadt. */
export function createMatch(rules: MatchRules): MatchState {
  assertMatchRules(rules);
  const map = matchMap(rules.map);
  return {
    version: MATCH_STATE_VERSION,
    rules,
    seats: Array.from({ length: rules.seats }, () => ({
      capital: null,
      capitalHits: 0,
      eliminatedInDuel: null,
      eliminatedBy: null,
    })),
    regions: map.regions.map(() => ({
      owner: null,
      value: rules.values.region,
      capitalOf: null,
      fortifications: 0,
    })),
    step: { kind: 'CAPITAL_PICK', seat: 0 },
    duels: 0,
    questions: 0,
  };
}

/**
 * Zugreihenfolge: gleichverteilte Permutation von `0 … count − 1` (Fisher-Yates aus dem Strom
 * `match:{match_id}`). Der Aufrufer setzt Teilnehmer `order[i]` auf Sitz `i`.
 */
export function drawSeatOrder(rng: Rng, count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = rng.nextUint32() % (i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}

// ---------------------------------------------------------------------------------------------
// Abfragen

export function matchPhase(state: MatchState): MatchPhase {
  switch (state.step.kind) {
    case 'CAPITAL_PICK':
      return 'CAPITALS';
    case 'LAND_ESTIMATE':
    case 'LAND_PICK':
      return 'LAND_GRAB';
    case 'CAMPAIGN_TARGET':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
      return 'CAMPAIGN';
    case 'FINISHED':
      return 'FINISHED';
  }
}

export function mapOf(state: MatchState): MatchMap {
  return matchMap(state.rules.map);
}

export function isAlive(state: MatchState, seat: number): boolean {
  return state.seats[seat]?.eliminatedInDuel === null;
}

export function aliveSeats(state: MatchState): number[] {
  return state.seats.flatMap((s, seat) => (s.eliminatedInDuel === null ? [seat] : []));
}

export function regionsOf(state: MatchState, seat: number): number[] {
  return state.regions.flatMap((r, id) => (r.owner === seat ? [id] : []));
}

export function freeRegions(state: MatchState): number[] {
  return state.regions.flatMap((r, id) => (r.owner === null ? [id] : []));
}

export function capitalLivesLeft(state: MatchState, seat: number): number {
  const s = state.seats[seat];
  if (!s || s.eliminatedInDuel !== null || s.capital === null) return 0;
  return Math.max(0, state.rules.capital.lives - s.capitalHits);
}

/** Punkte = Summe der Werte der eigenen Regionen. */
export function matchPoints(state: MatchState, seat: number): number {
  return state.regions.reduce((sum, r) => (r.owner === seat ? sum + r.value : sum), 0);
}

/** Sitze der Runde ab `(round − 1) mod seats`, nur lebende. */
export function roundOrder(state: MatchState, round: number): number[] {
  const n = state.seats.length;
  const start = (((round - 1) % n) + n) % n;
  return Array.from({ length: n }, (_, i) => (start + i) % n).filter((s) => isAlive(state, s));
}

/** Wer jetzt eine Region wählen muss (Hauptstadt, Landnahme, Angriffsziel), sonst `null`. */
export function currentChooser(state: MatchState): number | null {
  const { step } = state;
  switch (step.kind) {
    case 'CAPITAL_PICK':
      return step.seat;
    case 'LAND_PICK':
      return step.queue[0] ?? null;
    case 'CAMPAIGN_TARGET':
      return step.attacker;
    case 'LAND_ESTIMATE':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      return null;
  }
}

export type MatchTurnStatus = 'DONE' | 'NOW' | 'NEXT';

export interface MatchTurn {
  readonly seat: number;
  readonly status: MatchTurnStatus;
}

/**
 * Zugfolge des laufenden Abschnitts für die Anzeige „wer ist wann dran“ (MATCH_RULES §3.5):
 * - Hauptstädte: alle Sitze in Zugreihenfolge;
 * - Schätzfrage der Landnahme: alle lebenden Sitze der Runde, alle zugleich dran;
 * - Wahl der Landnahme: ein Eintrag je Wahl in Reihenfolge der Rangfolge (ein Sitz mit zwei Wahlen
 *   steht zweimal da);
 * - Feldzug: die Angreifer der Runde in ihrer Reihenfolge, auch während des Duells. Wer in der
 *   Runde ausscheidet, entfällt.
 * Nach dem Ende ist die Liste leer.
 */
export function turnOrder(state: MatchState): MatchTurn[] {
  const { step } = state;
  switch (step.kind) {
    case 'CAPITAL_PICK':
      return state.seats.map((_, seat) => ({
        seat,
        status: seat < step.seat ? 'DONE' : seat === step.seat ? 'NOW' : 'NEXT',
      }));
    case 'LAND_ESTIMATE':
      return roundOrder(state, step.round).map((seat) => ({ seat, status: 'NOW' }));
    case 'LAND_PICK':
      return [
        ...(step.picked ?? []).map((seat): MatchTurn => ({ seat, status: 'DONE' })),
        ...step.queue.map((seat, i): MatchTurn => ({ seat, status: i === 0 ? 'NOW' : 'NEXT' })),
      ];
    case 'CAMPAIGN_TARGET':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
      return roundOrder(state, step.round).map((seat) => ({
        seat,
        status: seat === step.attacker ? 'NOW' : step.queue.includes(seat) ? 'NEXT' : 'DONE',
      }));
    case 'FINISHED':
      return [];
  }
}

/** Frage, die jetzt gestellt wird, und wer sie beantwortet; sonst `null`. */
export function pendingQuestion(
  state: MatchState,
): { readonly type: 'TRIVIA' | 'ESTIMATE'; readonly seats: readonly number[] } | null {
  const { step } = state;
  switch (step.kind) {
    case 'LAND_ESTIMATE':
      return { type: 'ESTIMATE', seats: roundOrder(state, step.round) };
    case 'DUEL_TRIVIA':
      return { type: 'TRIVIA', seats: [step.attacker, step.defender] };
    case 'DUEL_ESTIMATE':
      return { type: 'ESTIMATE', seats: [step.attacker, step.defender] };
    case 'CAPITAL_PICK':
    case 'LAND_PICK':
    case 'CAMPAIGN_TARGET':
    case 'FINISHED':
      return null;
  }
}

/** Zeitlimit des aktuellen Schritts in ms; `null` nach dem Ende. */
export function stepTimeLimitMs(state: MatchState): number | null {
  const { timers } = state.rules;
  switch (state.step.kind) {
    case 'CAPITAL_PICK':
    case 'LAND_PICK':
    case 'CAMPAIGN_TARGET':
      return timers.pickMs;
    case 'LAND_ESTIMATE':
    case 'DUEL_ESTIMATE':
      return timers.estimateMs;
    case 'DUEL_TRIVIA':
      return timers.triviaMs;
    case 'FINISHED':
      return null;
  }
}

function touches(map: MatchMap, region: number, owned: ReadonlySet<number>): boolean {
  return regionNeighbors(map, region).some((n) => owned.has(n));
}

/**
 * Regionen, die im aktuellen Schritt wählbar sind (aufsteigend):
 * - Hauptstadt: frei und mindestens `capital.minDistance` Felder von jeder gewählten Hauptstadt;
 * - Landnahme: frei und am eigenen Gebiet, gibt es keine solche, jede freie;
 * - Angriffsziel: gegnerisch und am eigenen Gebiet, gibt es keine solche, jede gegnerische.
 */
export function legalRegions(state: MatchState): number[] {
  const map = mapOf(state);
  const { step } = state;
  switch (step.kind) {
    case 'CAPITAL_PICK': {
      const capitals = state.seats.flatMap((s) => (s.capital === null ? [] : [s.capital]));
      const free = freeRegions(state);
      const spaced = free.filter((id) =>
        capitals.every((c) => regionDistance(map, id, c) >= state.rules.capital.minDistance),
      );
      // Auf der Wendelmark gibt es immer genug Platz; der Rückfall hält jede Karte spielbar.
      return spaced.length > 0 ? spaced : free;
    }
    case 'LAND_PICK': {
      const seat = step.queue[0];
      if (seat === undefined) return [];
      const owned = new Set(regionsOf(state, seat));
      const free = freeRegions(state);
      const adjacent = free.filter((id) => touches(map, id, owned));
      return adjacent.length > 0 ? adjacent : free;
    }
    case 'CAMPAIGN_TARGET': {
      const owned = new Set(regionsOf(state, step.attacker));
      const enemy = state.regions.flatMap((r, id) =>
        r.owner !== null && r.owner !== step.attacker ? [id] : [],
      );
      const adjacent = enemy.filter((id) => touches(map, id, owned));
      return adjacent.length > 0 ? adjacent : enemy;
    }
    case 'LAND_ESTIMATE':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      return [];
  }
}

/**
 * Wahl nach Zeitablauf: eine zufällige wählbare Region (Strom `match`). Bewusst ohne Strategie,
 * damit Abwarten keinen Vorteil bringt.
 */
export function autoPickRegion(state: MatchState, rng: Rng): number {
  const options = legalRegions(state);
  const choice = options[rng.nextUint32() % options.length];
  if (choice === undefined)
    throw new Error(`Im Schritt ${state.step.kind} gibt es nichts zu wählen`);
  return choice;
}

/**
 * Endstand: Punkte absteigend; ein ausgeschiedenes Reich liegt hinter jedem lebenden, ein später
 * ausgeschiedenes vor einem früher ausgeschiedenen; dann mehr Regionen, dann mehr Hauptstadtleben.
 * Wer in allem gleich liegt, teilt sich den Platz.
 */
export function matchStandings(state: MatchState): MatchStanding[] {
  const rows = state.seats.map((s, seat) => ({
    seat,
    points: matchPoints(state, seat),
    regions: regionsOf(state, seat).length,
    capitalLives: capitalLivesLeft(state, seat),
    eliminated: s.eliminatedInDuel !== null,
    survival: s.eliminatedInDuel ?? Number.POSITIVE_INFINITY,
  }));
  const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    b.points - a.points ||
    (b.survival === a.survival ? 0 : b.survival > a.survival ? 1 : -1) ||
    b.regions - a.regions ||
    b.capitalLives - a.capitalLives;
  const sorted = [...rows].sort((a, b) => compare(a, b) || a.seat - b.seat);
  return sorted.map((row, index) => {
    const first = sorted.findIndex((other) => compare(other, row) === 0);
    return {
      seat: row.seat,
      place: (first === -1 ? index : first) + 1,
      points: row.points,
      regions: row.regions,
      capitalLives: row.capitalLives,
      eliminated: row.eliminated,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Übergänge

type Draft = {
  seats: MatchSeatState[];
  regions: MatchRegionState[];
  duels: number;
  questions: number;
};

function draftOf(state: MatchState): Draft {
  return {
    seats: [...state.seats],
    regions: [...state.regions],
    duels: state.duels,
    questions: state.questions,
  };
}

function withDraft(state: MatchState, draft: Draft, step: MatchStep): MatchState {
  return { ...state, ...draft, step };
}

function setRegion(draft: Draft, id: number, patch: Partial<MatchRegionState>): MatchRegionState {
  const current = draft.regions[id] as MatchRegionState;
  const next = { ...current, ...patch };
  draft.regions[id] = next;
  return next;
}

function setSeat(draft: Draft, seat: number, patch: Partial<MatchSeatState>): void {
  draft.seats[seat] = { ...(draft.seats[seat] as MatchSeatState), ...patch };
}

function fail(error: MatchError): MatchResult {
  return { ok: false, error };
}

function isRegionId(state: MatchState, region: number): boolean {
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

/** Wendet eine Eingabe an; der alte Zustand bleibt unverändert. */
export function applyMatchInput(state: MatchState, input: MatchInput): MatchResult {
  const { step } = state;
  switch (input.kind) {
    case 'PICK_CAPITAL': {
      if (step.kind !== 'CAPITAL_PICK') return fail('WRONG_STEP');
      if (input.seat !== step.seat) return fail('NOT_YOUR_TURN');
      if (!isRegionId(state, input.region) || !legalRegions(state).includes(input.region)) {
        return fail('INVALID_REGION');
      }
      const draft = draftOf(state);
      setRegion(draft, input.region, {
        owner: input.seat,
        capitalOf: input.seat,
        value: state.rules.values.capital,
      });
      setSeat(draft, input.seat, { capital: input.region });
      const events: MatchEvent[] = [
        { kind: 'CAPITAL_CHOSEN', seat: input.seat, region: input.region },
      ];
      const next = input.seat + 1;
      if (next < state.seats.length) {
        return {
          ok: true,
          state: withDraft(state, draft, { kind: 'CAPITAL_PICK', seat: next }),
          events,
        };
      }
      return continueLandGrab(withDraft(state, draft, step), 1, events);
    }

    case 'LAND_ESTIMATES': {
      if (step.kind !== 'LAND_ESTIMATE') return fail('WRONG_STEP');
      const order = roundOrder(state, step.round);
      const bySeat = new Map(input.answers.map((a) => [a.seat, a]));
      if (
        bySeat.size !== input.answers.length ||
        bySeat.size !== order.length ||
        !order.every((seat) => bySeat.has(seat)) ||
        !input.answers.every(isValidEstimate)
      ) {
        return fail('INVALID_ANSWERS');
      }
      const ranked = [...order].sort((a, b) => {
        const x = bySeat.get(a) as MatchEstimateAnswer;
        const y = bySeat.get(b) as MatchEstimateAnswer;
        return (
          compareNullableDecimal(x.distance, y.distance) ||
          compareNullableNumber(x.effectiveMs, y.effectiveMs) ||
          order.indexOf(a) - order.indexOf(b)
        );
      });
      const picks = state.rules.landGrab.picksByPlace;
      const ranking = ranked.map((seat, index) => {
        const answer = bySeat.get(seat) as MatchEstimateAnswer;
        return {
          seat,
          place: index + 1,
          picks: picks[index] ?? 0,
          distance: answer.distance === null ? null : formatDecimal(answer.distance),
          effectiveMs: answer.effectiveMs,
        };
      });
      const queue = ranking
        .flatMap((r) => Array.from({ length: r.picks }, () => r.seat))
        .slice(0, freeRegions(state).length);
      const draft = draftOf(state);
      draft.questions += 1;
      const events: MatchEvent[] = [{ kind: 'LAND_RANKED', round: step.round, ranking }];
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
      if (!isRegionId(state, input.region) || !legalRegions(state).includes(input.region)) {
        return fail('INVALID_REGION');
      }
      const draft = draftOf(state);
      setRegion(draft, input.region, { owner: input.seat });
      const events: MatchEvent[] = [
        { kind: 'REGION_CLAIMED', round: step.round, seat: input.seat, region: input.region },
      ];
      const queue = step.queue.slice(1);
      const picked = [...(step.picked ?? []), input.seat];
      const after = withDraft(state, draft, { ...step, queue, picked });
      if (queue.length > 0 && freeRegions(after).length > 0) {
        return { ok: true, state: after, events };
      }
      return continueLandGrab(after, step.round + 1, events);
    }

    case 'PICK_TARGET': {
      if (step.kind !== 'CAMPAIGN_TARGET') return fail('WRONG_STEP');
      if (input.seat !== step.attacker) return fail('NOT_YOUR_TURN');
      if (!isRegionId(state, input.region) || !legalRegions(state).includes(input.region)) {
        return fail('INVALID_REGION');
      }
      const defender = state.regions[input.region]?.owner as number;
      const setup: DuelSetup = {
        round: step.round,
        attacker: step.attacker,
        defender,
        region: input.region,
        queue: step.queue,
      };
      return {
        ok: true,
        state: { ...state, step: { kind: 'DUEL_TRIVIA', ...setup } },
        events: [
          {
            kind: 'TARGET_CHOSEN',
            round: step.round,
            attacker: step.attacker,
            defender,
            region: input.region,
          },
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
      // Dieselbe Auswertung wie im Eternal-Duell: Abstand, dann Zeit, sonst hält der Verteidiger.
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
function continueLandGrab(state: MatchState, round: number, events: MatchEvent[]): MatchResult {
  if (freeRegions(state).length > 0) {
    return { ok: true, state: { ...state, step: { kind: 'LAND_ESTIMATE', round } }, events };
  }
  return nextAttack(state, 1, roundOrder(state, 1), events);
}

/** Nächster lebender Angreifer der Runde, sonst die nächste Runde oder das Ende. */
function nextAttack(
  state: MatchState,
  round: number,
  queue: readonly number[],
  events: MatchEvent[],
): MatchResult {
  if (aliveSeats(state).length <= 1) return finish(state, 'LAST_KINGDOM', round, events);
  const remaining = queue.filter((seat) => isAlive(state, seat));
  const [attacker, ...rest] = remaining;
  if (attacker === undefined) {
    if (round >= state.rules.campaign.rounds) {
      return finish(state, 'ROUNDS_COMPLETE', round, events);
    }
    return nextAttack(state, round + 1, roundOrder(state, round + 1), events);
  }
  return {
    ok: true,
    state: { ...state, step: { kind: 'CAMPAIGN_TARGET', round, attacker, queue: rest } },
    events,
  };
}

function finishDuel(
  state: MatchState,
  setup: DuelSetup,
  winner: 'ATTACKER' | 'DEFENDER',
  reason: MatchDuelReason,
): MatchResult {
  const draft = draftOf(state);
  draft.duels += 1;
  const duel = draft.duels;
  const { attacker, defender, region, round } = setup;
  const target = state.regions[region] as MatchRegionState;
  const events: MatchEvent[] = [];
  let effect: MatchDuelEffect;
  let capitalLivesLeftAfter: number | null = null;
  let regionValue = target.value;

  if (winner === 'DEFENDER') {
    effect = 'FORTIFIED';
    regionValue = target.value + state.rules.values.defenseBonus;
    setRegion(draft, region, { value: regionValue, fortifications: target.fortifications + 1 });
  } else if (target.capitalOf === defender) {
    const hits = (state.seats[defender] as MatchSeatState).capitalHits + 1;
    capitalLivesLeftAfter = Math.max(0, state.rules.capital.lives - hits);
    if (capitalLivesLeftAfter > 0) {
      effect = 'CAPITAL_HIT';
      setSeat(draft, defender, { capitalHits: hits });
    } else {
      // Das letzte Leben übernimmt das ganze Reich (ADR-037); die eroberte Hauptstadt wird eine
      // gewöhnliche Region des Siegers und behält ihren Wert.
      effect = 'TAKEOVER';
      const taken = regionsOf(state, defender);
      for (const id of taken) setRegion(draft, id, { owner: attacker });
      setRegion(draft, region, { capitalOf: null });
      setSeat(draft, defender, {
        capitalHits: hits,
        eliminatedInDuel: duel,
        eliminatedBy: attacker,
      });
      events.push({
        kind: 'DUEL_RESOLVED',
        round,
        duel,
        attacker,
        defender,
        region,
        winner,
        reason,
        effect,
        capitalLivesLeft: 0,
        regionValue,
      });
      events.push({
        kind: 'KINGDOM_ELIMINATED',
        round,
        seat: defender,
        by: attacker,
        regions: taken.length,
      });
      return nextAttack(withDraft(state, draft, state.step), round, setup.queue, events);
    }
  } else {
    effect = 'CONQUERED';
    setRegion(draft, region, { owner: attacker });
  }

  events.push({
    kind: 'DUEL_RESOLVED',
    round,
    duel,
    attacker,
    defender,
    region,
    winner,
    reason,
    effect,
    capitalLivesLeft: capitalLivesLeftAfter,
    regionValue,
  });
  return nextAttack(withDraft(state, draft, state.step), round, setup.queue, events);
}

function finish(
  state: MatchState,
  reason: MatchFinishReason,
  round: number,
  events: MatchEvent[],
): MatchResult {
  const done: MatchState = { ...state, step: { kind: 'FINISHED', reason, round } };
  return {
    ok: true,
    state: done,
    events: [...events, { kind: 'MATCH_FINISHED', reason, standings: matchStandings(done) }],
  };
}
