import type { QuestionCategory, RealmRules } from '@rdw/protocol';
import type { MatchFinishReason, MatchTurn } from './match.ts';
import { matchMap, regionDistance, regionNeighbors, type MatchMap } from './match-map.ts';
import { regionResource, type RealmResource } from './realm-resources.ts';

/**
 * Zustand und Abfragen der Partie mit Ausbau (docs/MATCH_RULES.md §11, ADR-057): Burgen, Dörfer
 * und Städte, Armeen, Brot und Baustoff, Glücksrad. Wie die bisherige Partie (`match.ts`) ist der
 * Zustand reines JSON; Übergänge stehen in `realm.ts`, die Rüstzeit in `realm-orders.ts`, das
 * Glücksrad in `realm-wheel.ts`.
 *
 * Sitze sind 0 … seats − 1 wie beim Aufrufer verteilt. Die Startfrage legt die Reihenfolge fest
 * (`order`): Burgen in dieser Reihenfolge, Startdörfer rückwärts. Runde n beginnt beim
 * Sitz `order[(n − 1) mod seats]`; in der letzten Feldzugrunde greift an, wer vorn liegt, zuerst
 * (O-35).
 */

export const REALM_STATE_VERSION = 1;

/** Gebäude in der Reihenfolge des Ausbaus; der Index ist die Stufe. */
export const REALM_BUILDINGS = ['NONE', 'VILLAGE', 'TOWN', 'CASTLE'] as const;
export type RealmBuilding = (typeof REALM_BUILDINGS)[number];

export function buildingLevel(building: RealmBuilding): number {
  return REALM_BUILDINGS.indexOf(building);
}

export interface RealmRegionState {
  /**
   * Besitzender Sitz, `null` = frei. Mit `economy.landGrabRounds` bleiben nach der Landnahme Felder
   * frei; im Feldzug nimmt sie, wer sie angreift und die Wissensfrage richtig beantwortet (O-37).
   */
  readonly owner: number | null;
  /** Punktwert: Grundwert (Feld 100, Startburg 300) plus Befestigungen. */
  readonly value: number;
  /** Gehaltene Verteidigungen dieser Region. */
  readonly fortifications: number;
  readonly building: RealmBuilding;
  /** Verlorene Leben der Burg auf diesem Feld; ohne Burg 0. */
  readonly castleHits: number;
  /** Sitz, dessen Startburg hier steht; nach ihrer Zerstörung `null`, der Wert bleibt. */
  readonly startCastleOf: number | null;
  /** Armeen des Besitzers auf diesem Feld. */
  readonly armies: number;
}

export interface RealmSeatState {
  readonly favorites: readonly QuestionCategory[];
  readonly bread: number;
  readonly material: number;
  readonly startCastle: number | null;
  /** Laufende Nummer des Duells, in dem das Reich fiel; `null` = im Spiel. */
  readonly eliminatedInDuel: number | null;
  readonly eliminatedBy: number | null;
}

/**
 * Befehle der Rüstzeit, in dieser Reihenfolge ausgeführt. Jeder Befehl betrifft nur eigene Felder
 * und eigene Vorräte; deshalb lassen sich alle Reiche gleichzeitig planen und aufdecken.
 */
export type RealmOrder =
  /** Baut auf einem eigenen Feld die nächste Stufe: Dorf, Stadt, Burg. */
  | { readonly kind: 'BUILD'; readonly region: number }
  /** Kauft Armeen; sie stehen in einer eigenen Burg und ziehen erst in der nächsten Runde. */
  | { readonly kind: 'RECRUIT'; readonly region: number; readonly count: number }
  /** Zieht Armeen ein Feld weit in ein eigenes Nachbarfeld. */
  | { readonly kind: 'MOVE'; readonly from: number; readonly to: number; readonly count: number }
  /** Tauscht `tradeRate · count` von `give` gegen `count` vom anderen Rohstoff. */
  | { readonly kind: 'TRADE'; readonly give: RealmResource; readonly count: number };

/** Ein Feld des Glücksrads. Gewichte in ganzen Teilen: Lose des Angreifers, des Verteidigers, frei. */
export interface RealmWheelSegment {
  readonly category: QuestionCategory;
  readonly attacker: number;
  readonly defender: number;
  readonly free: number;
  /** Summe der drei Teile; Chance = weight / total. */
  readonly weight: number;
}

export interface RealmWheel {
  readonly attackerLots: number;
  readonly defenderLots: number;
  readonly freeLots: number;
  readonly segments: readonly RealmWheelSegment[];
  readonly total: number;
}

export interface RealmDuelSetup {
  readonly round: number;
  readonly attacker: number;
  /** Besitzer des angegriffenen Felds; `null` = freies Feld, der Angreifer antwortet allein (O-37). */
  readonly defender: number | null;
  readonly region: number;
  /** Angreifer der Runde in ihrer Reihenfolge, fest ab dem ersten Angriff der Runde. */
  readonly attackers: readonly number[];
  /** Angreifer nach diesem in derselben Runde. */
  readonly queue: readonly number[];
}

/** Worauf die Partie gerade wartet. */
export type RealmStep =
  /** Schätzfrage an alle; die Rangfolge ist die Reihenfolge für Burgen und Runden. */
  | { readonly kind: 'START_ESTIMATE' }
  | { readonly kind: 'CASTLE_PICK'; readonly seat: number }
  | { readonly kind: 'VILLAGE_PICK'; readonly seat: number }
  | { readonly kind: 'LAND_ESTIMATE'; readonly round: number }
  | {
      readonly kind: 'LAND_PICK';
      readonly round: number;
      readonly queue: readonly number[];
      readonly picked: readonly number[];
    }
  | {
      /** Rüstzeit: alle Reiche geben gleichzeitig und verdeckt Befehle. */
      readonly kind: 'PREPARE';
      readonly round: number;
      /** Je Sitz die abgegebenen Befehle, `null` = noch nicht fertig. Nur der Server sieht sie. */
      readonly orders: readonly (readonly RealmOrder[] | null)[];
    }
  | {
      readonly kind: 'CAMPAIGN_TARGET';
      readonly round: number;
      readonly attacker: number;
      readonly attackers: readonly number[];
      readonly queue: readonly number[];
    }
  /** Ziel steht fest, das Glücksrad wartet auf die gezogene Kategorie. */
  | ({ readonly kind: 'DUEL_WHEEL'; readonly wheel: RealmWheel } & RealmDuelSetup)
  | ({
      readonly kind: 'DUEL_TRIVIA' | 'DUEL_ESTIMATE';
      readonly wheel: RealmWheel;
      readonly category: QuestionCategory;
    } & RealmDuelSetup)
  | {
      readonly kind: 'FINISHED';
      readonly reason: MatchFinishReason;
      readonly round: number;
      /** Angreifer der letzten Runde in ihrer Reihenfolge, für die Anzeige nach dem letzten Duell. */
      readonly attackers: readonly number[];
    };

export type RealmPhase = 'SETUP' | 'LAND_GRAB' | 'CAMPAIGN' | 'FINISHED';

export interface RealmState {
  readonly version: typeof REALM_STATE_VERSION;
  readonly rules: RealmRules;
  /** Kategorien des Glücksrads: nur solche mit genug Fragen (MATCH_RULES §11.6). */
  readonly categories: readonly QuestionCategory[];
  /** Reihenfolge aus der Startfrage; leer, bis sie beantwortet ist. */
  readonly order: readonly number[];
  readonly seats: readonly RealmSeatState[];
  readonly regions: readonly RealmRegionState[];
  readonly step: RealmStep;
  /** Aufgelöste Duelle. */
  readonly duels: number;
  /** Gestellte Fragen (Schätz- und Wissensfragen). */
  readonly questions: number;
}

export interface RealmStanding {
  readonly seat: number;
  /** 1 = bester Platz; bei völligem Gleichstand geteilt. */
  readonly place: number;
  readonly points: number;
  readonly regions: number;
  /** Verbliebene Leben aller eigenen Burgen. */
  readonly castleLives: number;
  readonly eliminated: boolean;
}

// ---------------------------------------------------------------------------------------------
// Abfragen

export function realmMapOf(state: RealmState): MatchMap {
  return matchMap(state.rules.map);
}

export function realmPhase(state: RealmState): RealmPhase {
  switch (state.step.kind) {
    case 'START_ESTIMATE':
    case 'CASTLE_PICK':
    case 'VILLAGE_PICK':
      return 'SETUP';
    case 'LAND_ESTIMATE':
    case 'LAND_PICK':
      return 'LAND_GRAB';
    case 'PREPARE':
    case 'CAMPAIGN_TARGET':
    case 'DUEL_WHEEL':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
      return 'CAMPAIGN';
    case 'FINISHED':
      return 'FINISHED';
  }
}

export function isRealmSeatAlive(state: RealmState, seat: number): boolean {
  return state.seats[seat]?.eliminatedInDuel === null;
}

export function realmAliveSeats(state: RealmState): number[] {
  return state.seats.flatMap((s, seat) => (s.eliminatedInDuel === null ? [seat] : []));
}

export function realmRegionsOf(state: RealmState, seat: number): number[] {
  return state.regions.flatMap((r, id) => (r.owner === seat ? [id] : []));
}

export function realmFreeRegions(state: RealmState): number[] {
  return state.regions.flatMap((r, id) => (r.owner === null ? [id] : []));
}

/** Eigene Burgen eines Sitzes, aufsteigend. */
export function castlesOf(state: RealmState, seat: number): number[] {
  return state.regions.flatMap((r, id) =>
    r.owner === seat && r.building === 'CASTLE' ? [id] : [],
  );
}

/** Verbliebene Leben der Burg auf einem Feld; 0 ohne Burg. */
export function castleLivesLeft(state: RealmState, region: number): number {
  const r = state.regions[region];
  if (!r || r.building !== 'CASTLE') return 0;
  return Math.max(0, state.rules.capital.lives - r.castleHits);
}

/** Punkte = Summe der Werte der eigenen Regionen; Gebäude, Armeen und Vorräte zählen nicht (O-28). */
export function realmPoints(state: RealmState, seat: number): number {
  return state.regions.reduce((sum, r) => (r.owner === seat ? sum + r.value : sum), 0);
}

/**
 * Was die Regeln von einem Feld wissen müssen, wenn sie auch der Browser aus seiner Ansicht
 * rechnet (Rüstzeit planen, Lose fürs Glücksrad zeigen): beim Server ein `RealmRegionState`, im
 * Browser ein Feld aus `realm.board.regions`.
 */
export interface RealmBoardRegion {
  readonly owner: number | null;
  readonly building: RealmBuilding;
  readonly armies: number;
}

/** Armeen eines Sitzes auf einem Feld und seinen Nachbarn (Reichweite) auf einem beliebigen Brett. */
export function armiesInRangeOn(
  map: MatchMap,
  regions: readonly RealmBoardRegion[],
  seat: number,
  region: number,
): number {
  const own = (id: number) => {
    const r = regions[id];
    return r && r.owner === seat ? r.armies : 0;
  };
  return regionNeighbors(map, region).reduce((sum, id) => sum + own(id), own(region));
}

/** Armeen eines Sitzes auf einem Feld und seinen Nachbarn (Reichweite). */
export function armiesInRange(state: RealmState, seat: number, region: number): number {
  return armiesInRangeOn(realmMapOf(state), state.regions, seat, region);
}

/** Ertrag eines Felds je Feldzugrunde. */
export function regionYield(
  state: RealmState,
  region: number,
): { readonly bread: number; readonly material: number } {
  const r = state.regions[region];
  if (!r || r.owner === null) return { bread: 0, material: 0 };
  const { yields } = state.rules.economy;
  if (r.building === 'CASTLE')
    return { bread: yields.castleBread, material: yields.castleMaterial };
  const amount =
    r.building === 'TOWN' ? yields.town : r.building === 'VILLAGE' ? yields.village : yields.plain;
  return regionResource(realmMapOf(state), region) === 'BREAD'
    ? { bread: amount, material: 0 }
    : { bread: 0, material: amount };
}

/** Einkommen eines Reichs zu Beginn einer Feldzugrunde. */
export function realmIncome(
  state: RealmState,
  seat: number,
): { readonly bread: number; readonly material: number } {
  let bread = 0;
  let material = 0;
  for (const id of realmRegionsOf(state, seat)) {
    const y = regionYield(state, id);
    bread += y.bread;
    material += y.material;
  }
  return { bread, material };
}

/** Sitze der Runde: `order` ab Stelle (round − 1) mod seats, nur lebende. */
export function realmRoundOrder(state: RealmState, round: number): number[] {
  const order = state.order.length > 0 ? state.order : state.seats.map((_, seat) => seat);
  const n = order.length;
  const start = (((round - 1) % n) + n) % n;
  return Array.from({ length: n }, (_, i) => order[(start + i) % n] as number).filter((s) =>
    isRealmSeatAlive(state, s),
  );
}

/**
 * Angreifer einer Feldzugrunde. In der letzten Runde greift an, wer nach Punkten vorn liegt, zuerst,
 * wer hinten liegt, zuletzt (O-35); bei gleichen Punkten gilt die Reihenfolge der Runde. Sonst die
 * Reihenfolge der Runde.
 */
export function realmAttackOrder(state: RealmState, round: number): number[] {
  const base = realmRoundOrder(state, round);
  if (round < state.rules.campaign.rounds) return base;
  return [...base].sort(
    (a, b) => realmPoints(state, b) - realmPoints(state, a) || base.indexOf(a) - base.indexOf(b),
  );
}

/** Wer jetzt eine Region wählt, sonst `null` (auch in der Rüstzeit, in der alle zugleich planen). */
export function realmCurrentChooser(state: RealmState): number | null {
  const { step } = state;
  switch (step.kind) {
    case 'CASTLE_PICK':
    case 'VILLAGE_PICK':
      return step.seat;
    case 'LAND_PICK':
      return step.queue[0] ?? null;
    case 'CAMPAIGN_TARGET':
      return step.attacker;
    case 'START_ESTIMATE':
    case 'LAND_ESTIMATE':
    case 'PREPARE':
    case 'DUEL_WHEEL':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      return null;
  }
}

/**
 * Zugfolge des laufenden Abschnitts für die Anzeige (wie `turnOrder` der bisherigen Partie): in der
 * Startfrage, der Schätzfrage der Landnahme und der Rüstzeit alle zugleich (in der Rüstzeit ist
 * fertig, wer Befehle abgegeben hat), bei Burgen und Dörfern die Wahlreihenfolge, im Feldzug die
 * Angreifer der Runde.
 */
export function realmTurnOrder(state: RealmState): MatchTurn[] {
  const { step } = state;
  const listed = (seats: readonly number[], index: number): MatchTurn[] =>
    seats.map((seat, i) => ({
      seat,
      status: i < index ? 'DONE' : i === index ? 'NOW' : 'NEXT',
    }));
  switch (step.kind) {
    case 'START_ESTIMATE':
      return state.seats.map((_, seat) => ({ seat, status: 'NOW' }));
    case 'CASTLE_PICK':
      return listed(state.order, state.order.indexOf(step.seat));
    case 'VILLAGE_PICK': {
      const reversed = [...state.order].reverse();
      return listed(reversed, reversed.indexOf(step.seat));
    }
    case 'LAND_ESTIMATE':
      return realmRoundOrder(state, step.round).map((seat) => ({ seat, status: 'NOW' }));
    case 'LAND_PICK':
      return [
        ...step.picked.map((seat): MatchTurn => ({ seat, status: 'DONE' })),
        ...step.queue.map((seat, i): MatchTurn => ({ seat, status: i === 0 ? 'NOW' : 'NEXT' })),
      ];
    case 'PREPARE':
      return realmRoundOrder(state, step.round).map((seat) => ({
        seat,
        status: step.orders[seat] ? 'DONE' : 'NOW',
      }));
    case 'CAMPAIGN_TARGET':
    case 'DUEL_WHEEL':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
      return step.attackers
        .filter((seat) => isRealmSeatAlive(state, seat))
        .map((seat) => ({
          seat,
          status: seat === step.attacker ? 'NOW' : step.queue.includes(seat) ? 'NEXT' : 'DONE',
        }));
    case 'FINISHED':
      return [];
  }
}

/** Sitze, die die Frage eines Angriffs beantworten: bei einem freien Feld nur der Angreifer. */
function duelSeats(setup: RealmDuelSetup): number[] {
  return setup.defender === null ? [setup.attacker] : [setup.attacker, setup.defender];
}

/** Frage, die jetzt gestellt wird, mit Kategorie bei der Wissensfrage; sonst `null`. */
export function realmPendingQuestion(state: RealmState): {
  readonly type: 'TRIVIA' | 'ESTIMATE';
  readonly seats: readonly number[];
  readonly category: QuestionCategory | null;
} | null {
  const { step } = state;
  switch (step.kind) {
    case 'START_ESTIMATE':
      return { type: 'ESTIMATE', seats: state.seats.map((_, seat) => seat), category: null };
    case 'LAND_ESTIMATE':
      return { type: 'ESTIMATE', seats: realmRoundOrder(state, step.round), category: null };
    case 'DUEL_TRIVIA':
      return { type: 'TRIVIA', seats: duelSeats(step), category: step.category };
    case 'DUEL_ESTIMATE':
      return { type: 'ESTIMATE', seats: duelSeats(step), category: null };
    case 'CASTLE_PICK':
    case 'VILLAGE_PICK':
    case 'LAND_PICK':
    case 'PREPARE':
    case 'CAMPAIGN_TARGET':
    case 'DUEL_WHEEL':
    case 'FINISHED':
      return null;
  }
}

/** Zeitlimit des aktuellen Schritts in ms; `null` nach dem Ende. */
export function realmStepTimeLimitMs(state: RealmState): number | null {
  const { timers, economy } = state.rules;
  switch (state.step.kind) {
    case 'CASTLE_PICK':
    case 'VILLAGE_PICK':
    case 'LAND_PICK':
    case 'CAMPAIGN_TARGET':
      return timers.pickMs;
    case 'START_ESTIMATE':
    case 'LAND_ESTIMATE':
    case 'DUEL_ESTIMATE':
      return timers.estimateMs;
    case 'PREPARE':
      return economy.timers.prepareMs;
    case 'DUEL_WHEEL':
      return economy.timers.wheelMs;
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
 * Felder, die `seat` im Feldzug angreifen kann (aufsteigend): gegnerisch oder frei und am eigenen
 * Gebiet. Mit `economy.attackNeedsArmy` (ADR-064) muss das Ziel dazu in Reichweite einer eigenen
 * Armee liegen, also an ein eigenes Feld mit Armee grenzen: bei `ALWAYS` jedes Ziel, bei `RIVALS`
 * nur ein gegnerisches. Leer heißt: Der Sitz setzt in dieser Runde aus.
 *
 * Ohne den Regelwert (Partien von vor ADR-064) genügt das eigene Gebiet; grenzt dort nichts
 * Fremdes oder Freies ans eigene Gebiet, ist jede gegnerische Region ein Ziel.
 */
export function realmTargetsOf(state: RealmState, seat: number): number[] {
  const map = realmMapOf(state);
  const owned = new Set(realmRegionsOf(state, seat));
  const adjacent = state.regions.flatMap((r, id) =>
    r.owner !== seat && touches(map, id, owned) ? [id] : [],
  );
  const need = state.rules.economy.attackNeedsArmy;
  if (need === undefined) {
    if (adjacent.length > 0) return adjacent;
    return state.regions.flatMap((r, id) => (r.owner !== null && r.owner !== seat ? [id] : []));
  }
  return adjacent.filter(
    (id) =>
      (need === 'RIVALS' && state.regions[id]?.owner === null) ||
      armiesInRange(state, seat, id) > 0,
  );
}

/**
 * Regionen, die im aktuellen Schritt wählbar sind (aufsteigend):
 * - Burg: frei und mindestens `capital.minDistance` Felder von jeder gewählten Burg;
 * - Startdorf: frei und mindestens `economy.villageMinDistance` Felder von jedem fremden Gebäude;
 * - Landnahme: frei und am eigenen Gebiet, gibt es keine solche, jede freie;
 * - Angriffsziel: gegnerisch oder frei und am eigenen Gebiet (ein freies Feld nimmt, wer die
 *   Wissensfrage allein richtig beantwortet, O-37); siehe `realmTargetsOf`.
 * Gibt es für Burg oder Dorf keinen Platz mit Abstand, ist jede freie Region wählbar.
 */
export function realmLegalRegions(state: RealmState): number[] {
  const map = realmMapOf(state);
  const { step } = state;
  switch (step.kind) {
    case 'CASTLE_PICK': {
      const castles = state.regions.flatMap((r, id) => (r.building === 'CASTLE' ? [id] : []));
      const free = realmFreeRegions(state);
      const spaced = free.filter((id) =>
        castles.every((c) => regionDistance(map, id, c) >= state.rules.capital.minDistance),
      );
      return spaced.length > 0 ? spaced : free;
    }
    case 'VILLAGE_PICK': {
      const foreign = state.regions.flatMap((r, id) =>
        r.owner !== null && r.owner !== step.seat && r.building !== 'NONE' ? [id] : [],
      );
      const free = realmFreeRegions(state);
      const spaced = free.filter((id) =>
        foreign.every((b) => regionDistance(map, id, b) >= state.rules.economy.villageMinDistance),
      );
      return spaced.length > 0 ? spaced : free;
    }
    case 'LAND_PICK': {
      const seat = step.queue[0];
      if (seat === undefined) return [];
      const owned = new Set(realmRegionsOf(state, seat));
      const free = realmFreeRegions(state);
      const adjacent = free.filter((id) => touches(map, id, owned));
      return adjacent.length > 0 ? adjacent : free;
    }
    case 'CAMPAIGN_TARGET':
      return realmTargetsOf(state, step.attacker);
    case 'START_ESTIMATE':
    case 'LAND_ESTIMATE':
    case 'PREPARE':
    case 'DUEL_WHEEL':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      return [];
  }
}

/**
 * Endstand: Punkte absteigend; ein gefallenes Reich liegt hinter jedem lebenden, ein später
 * gefallenes vor einem früher gefallenen; dann mehr Regionen, dann mehr Burgleben. Wer in allem
 * gleich liegt, teilt sich den Platz.
 */
export function realmStandings(state: RealmState): RealmStanding[] {
  const rows = state.seats.map((s, seat) => ({
    seat,
    points: realmPoints(state, seat),
    regions: realmRegionsOf(state, seat).length,
    castleLives: castlesOf(state, seat).reduce((sum, id) => sum + castleLivesLeft(state, id), 0),
    eliminated: s.eliminatedInDuel !== null,
    survival: s.eliminatedInDuel ?? Number.POSITIVE_INFINITY,
  }));
  const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    b.points - a.points ||
    (b.survival === a.survival ? 0 : b.survival > a.survival ? 1 : -1) ||
    b.regions - a.regions ||
    b.castleLives - a.castleLives;
  const sorted = [...rows].sort((a, b) => compare(a, b) || a.seat - b.seat);
  return sorted.map((row, index) => {
    const first = sorted.findIndex((other) => compare(other, row) === 0);
    return {
      seat: row.seat,
      place: (first === -1 ? index : first) + 1,
      points: row.points,
      regions: row.regions,
      castleLives: row.castleLives,
      eliminated: row.eliminated,
    };
  });
}
