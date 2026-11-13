import {
  applyRealmInput,
  autoPickRealmRegion,
  chooseRealmOrdersForBot,
  chooseRegionForRealmBot,
  isRealmSeatAlive,
  realmBotProfile,
  realmCurrentChooser,
  realmPendingQuestion,
  realmRoundOrder,
  realmStandings,
  RNG_VERSION,
  spinRealmWheel,
  type MatchBotStrength,
  type NpcProfile,
  type RealmEvent,
  type RealmInput,
  type RealmState,
  type RealmWheel,
  type Rng,
} from '@rdw/game-core';
import type { MatchEconomy, RealmOrderDto } from '@rdw/protocol';
import { ApiError } from '../../infra/errors.ts';
import {
  eventPayload,
  MatchRun,
  type PendingMatchQuestion,
  type QuestionPurpose,
  type ResolvedAnswers,
} from './engine.ts';
import { realmStateOf } from './store.ts';

/**
 * Ablauf der Partie mit Ausbau (MATCH_RULES §11, ADR-057, ADR-058): Startfrage, Burgen, Startdörfer,
 * Landnahme, dann Feldzugrunden aus Einkommen, Rüstzeit, Aufdecken und Angriffen mit Glücksrad.
 * Zustandsmaschine `realm.ts` aus game-core; Zeit, Fragen und Speicherung in `MatchRun`.
 *
 * - **Rüstzeit (PREPARE):** Bots geben ihre Befehle gleich zu Beginn ab, Menschen bis zur Frist.
 *   Die Befehle liegen nur im gespeicherten Zustand; die Ansicht zeigt bis zum Aufdecken allein,
 *   wer fertig ist. Sind alle fertig oder ist die Frist um, wird aufgedeckt (`ORDERS_REVEALED`),
 *   und das Aufgedeckte bleibt `ordersRevealMs` stehen (ANNOUNCE).
 * - **Glücksrad:** Sobald ein Angriffsziel feststeht, dreht der Server das Rad (Strom `match`).
 *   Ziel, Rad und Kategorie stehen dann `wheelMs` lang als Ansage, danach kommt die Wissensfrage
 *   aus dieser Kategorie.
 */

/** Ereignisse, deren Inhalt von der Partie ohne Ausbau abweicht, heißen im Protokoll anders. */
function eventType(event: RealmEvent): string {
  switch (event.kind) {
    case 'DUEL_RESOLVED':
      return 'REALM_DUEL_RESOLVED';
    case 'MATCH_FINISHED':
      return 'REALM_MATCH_FINISHED';
    case 'START_RANKED':
    case 'CASTLE_CHOSEN':
    case 'VILLAGE_CHOSEN':
    case 'LAND_RANKED':
    case 'REGION_CLAIMED':
    case 'INCOME':
    case 'ORDERS_REVEALED':
    case 'ATTACK_SKIPPED':
    case 'TARGET_CHOSEN':
    case 'WHEEL_SPUN':
    case 'KINGDOM_ELIMINATED':
      return event.kind;
  }
}

function purposeOf(state: RealmState): QuestionPurpose {
  switch (state.step.kind) {
    case 'START_ESTIMATE':
      return 'START';
    case 'LAND_ESTIMATE':
      return 'LAND';
    case 'DUEL_TRIVIA':
      return 'DUEL_TRIVIA';
    case 'DUEL_ESTIMATE':
      return 'DUEL_ESTIMATE';
    case 'CASTLE_PICK':
    case 'VILLAGE_PICK':
    case 'LAND_PICK':
    case 'PREPARE':
    case 'CAMPAIGN_TARGET':
    case 'DUEL_WHEEL':
    case 'FINISHED':
      throw new Error(`Im Schritt ${state.step.kind} gibt es keine Frage`);
  }
}

function pickInput(state: RealmState, seat: number, region: number): RealmInput {
  switch (state.step.kind) {
    case 'CASTLE_PICK':
      return { kind: 'PICK_CASTLE', seat, region };
    case 'VILLAGE_PICK':
      return { kind: 'PICK_VILLAGE', seat, region };
    case 'LAND_PICK':
      return { kind: 'PICK_REGION', seat, region };
    case 'CAMPAIGN_TARGET':
      return { kind: 'PICK_TARGET', seat, region };
    case 'START_ESTIMATE':
    case 'LAND_ESTIMATE':
    case 'PREPARE':
    case 'DUEL_WHEEL':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Gerade gibt es nichts zu wählen');
  }
}

export class RealmRun extends MatchRun {
  get state(): RealmState {
    const state = realmStateOf(this.match);
    if (!state) throw new Error('Partie ohne Zustand');
    return state;
  }

  private get economy(): MatchEconomy {
    return this.state.rules.economy;
  }

  /**
   * Wendet eine Eingabe an; Fehler sind Programmfehler, außer bei Wahlen und Befehlen von
   * Menschen. `extra` ergänzt den Inhalt eines Ereignisses um Angaben des Servers (etwa den
   * Zufallsnachweis des Glücksrads).
   */
  apply(
    input: RealmInput,
    extra: Partial<Record<RealmEvent['kind'], Record<string, unknown>>> = {},
  ): void {
    const result = applyRealmInput(this.state, input);
    if (!result.ok) {
      switch (result.error) {
        case 'INVALID_REGION':
          throw new ApiError(422, 'INVALID_REGION', 'Diese Region ist nicht wählbar');
        case 'NOT_YOUR_TURN':
          throw new ApiError(409, 'NOT_YOUR_TURN', 'Ein anderer Sitz ist dran');
        case 'INVALID_ORDERS':
          throw new ApiError(422, 'INVALID_ORDERS', 'Diese Befehle sind so nicht möglich', {
            reason: result.orderError?.error ?? 'INVALID',
            index: result.orderError?.index ?? 0,
          });
        case 'WRONG_STEP':
        case 'INVALID_ANSWERS':
        case 'INVALID_CATEGORY':
          throw new Error(`Eingabe ${input.kind} abgelehnt: ${result.error}`);
      }
    }
    this.match.state = result.state;
    for (const event of result.events) {
      this.emit(eventType(event), { ...eventPayload(event), ...extra[event.kind] });
    }
  }

  async enterStep(picker: number | null = null): Promise<void> {
    let shown = picker;
    for (;;) {
      this.guard();
      const state = this.state;
      const { step } = state;
      const { timers } = this.rules;
      switch (step.kind) {
        case 'FINISHED':
          await this.finish();
          return;
        case 'CASTLE_PICK':
        case 'VILLAGE_PICK':
        case 'LAND_PICK':
        case 'CAMPAIGN_TARGET': {
          const seat = realmCurrentChooser(state);
          if (seat === null) throw new Error('Wahl ohne Wählenden');
          // Wählt derselbe Sitz gleich noch einmal (letzte Burg und erstes Startdorf, Landnahme),
          // geht es ohne Pause weiter
          if (shown !== null && shown !== seat && this.announce(timers.pickShowMs)) return;
          const player = this.playerAt(seat);
          if (player.botStrength !== null) {
            const { rng } = await this.drawRng('bot');
            this.applyPick(seat, chooseRegionForRealmBot(state, rng));
            // Ein Angriffsziel führt gleich zum Glücksrad; jede andere Wahl bleibt erst stehen
            if (this.state.step.kind !== 'DUEL_WHEEL' && this.announce(timers.pickShowMs)) return;
            continue;
          }
          this.awaitPick();
          return;
        }
        case 'DUEL_WHEEL':
          await this.spinWheel();
          // Ziel, Rad und Kategorie stehen als Ansage; die Frage folgt danach ohne weitere Pause
          if (this.announce(this.economy.timers.wheelMs)) return;
          shown = null;
          continue;
        case 'PREPARE':
          // Die letzte Wahl der Landnahme bleibt stehen, bevor die Rüstzeit beginnt
          if (shown !== null && this.announce(timers.pickShowMs)) return;
          if (await this.openPrepare()) return;
          // Kein Mensch mehr im Spiel: Die Bots haben abgegeben, es ist schon aufgedeckt
          if (this.announce(this.economy.timers.ordersRevealMs)) return;
          continue;
        case 'START_ESTIMATE':
        case 'LAND_ESTIMATE':
        case 'DUEL_TRIVIA':
        case 'DUEL_ESTIMATE': {
          // Nach der Wahl eines Menschen kommt die Frage nicht sofort: erst die Ansage
          if (shown !== null && this.announce(timers.pickShowMs)) return;
          const opened = await this.openQuestion();
          if (opened !== 'RESOLVE_NOW') return;
          // Nur Bots an der Frage: sofort auflösen, die Auflösung bleibt trotzdem stehen
          await this.resolveQuestion();
          return;
        }
      }
    }
  }

  /**
   * Beginnt die Rüstzeit: Bots geben sofort ab, Menschen bekommen die Frist. `false`, wenn danach
   * niemand mehr fehlt (kein lebender Mensch) und die Zustandsmaschine schon aufgedeckt hat.
   */
  private async openPrepare(): Promise<boolean> {
    const start = this.state.step;
    if (start.kind !== 'PREPARE') throw new Error('Keine Rüstzeit');
    const { round } = start;
    for (const seat of realmRoundOrder(this.state, round)) {
      const state = this.state;
      if (state.step.kind !== 'PREPARE' || state.step.round !== round) break;
      const waiting = state.step.orders[seat] === null;
      if (this.playerAt(seat).botStrength === null || !waiting) continue;
      const { rng } = await this.drawRng('orders');
      this.submit(round, seat, chooseRealmOrdersForBot(state, seat, rng));
    }
    if (this.revealed(round)) return false;
    this.match.phase = 'PREPARE';
    this.match.phaseDeadlineAt = new Date(
      this.now.getTime() + this.economy.timers.prepareMs + this.rules.timers.latencyAllowanceCapMs,
    );
    return true;
  }

  /**
   * Die Rüstzeit dieser Runde ist aufgedeckt. Fallen danach alle Angriffe aus (ADR-064), steht die
   * Zustandsmaschine schon in der Rüstzeit der nächsten Runde: Deshalb zählt die Runde mit, nicht
   * nur die Art des Schritts.
   */
  private revealed(round: number): boolean {
    const { step } = this.state;
    return step.kind !== 'PREPARE' || step.round !== round;
  }

  /** Befehle eines Sitzes eintragen; das Ereignis nennt nur, dass er fertig ist. */
  private submit(round: number, seat: number, orders: readonly RealmOrderDto[]): void {
    this.emit('ORDERS_SUBMITTED', { round, seat });
    this.apply({ kind: 'SUBMIT_ORDERS', seat, orders });
  }

  /** Nach dem Aufdecken: Die Befehle bleiben stehen, dann greift der Erste der Runde an. */
  private async afterReveal(): Promise<void> {
    if (!this.announce(this.economy.timers.ordersRevealMs)) await this.enterStep();
  }

  override async submitOrders(userId: string, orders: readonly RealmOrderDto[]): Promise<void> {
    if (this.match.status !== 'RUNNING') {
      throw new ApiError(409, 'MATCH_NOT_RUNNING', 'Die Partie läuft nicht', {
        status: this.match.status,
      });
    }
    const { step } = this.state;
    if (this.match.phase !== 'PREPARE' || step.kind !== 'PREPARE') {
      throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Gerade ist keine Rüstzeit');
    }
    const seat = this.seatOf(userId);
    if (seat === null || !isRealmSeatAlive(this.state, seat)) {
      throw new ApiError(409, 'NOT_YOUR_TURN', 'Dein Reich ist nicht mehr im Spiel');
    }
    this.submit(step.round, seat, orders);
    // Der Letzte hat abgegeben: Die Zustandsmaschine hat aufgedeckt
    if (this.revealed(step.round)) await this.afterReveal();
  }

  protected override async closePrepare(): Promise<void> {
    const { step } = this.state;
    if (step.kind !== 'PREPARE') throw new Error('Keine Rüstzeit');
    this.emit('PREPARE_CLOSED', {
      round: step.round,
      missing: step.orders.flatMap((orders, seat) => (orders === null ? [seat] : [])),
    });
    this.apply({ kind: 'CLOSE_PREPARE' });
    await this.afterReveal();
  }

  /**
   * Dreht das Glücksrad des anstehenden Duells. Kategorien ohne ungestellte Wissensfrage können
   * nicht gezogen werden, ihre Teile fallen weg (`exhausted` im Ereignis, MATCH_RULES §11.6). Hat
   * keine Kategorie des Rads mehr eine, gilt das ganze Rad; die Frage kommt dann aus dem übrigen
   * Bestand oder wiederholt sich (`chooseQuestion`).
   */
  private async spinWheel(): Promise<void> {
    const { step } = this.state;
    if (step.kind !== 'DUEL_WHEEL') throw new Error('Kein Glücksrad');
    const fresh = await this.freshCategories('TRIVIA');
    const segments = step.wheel.segments.filter((s) => s.weight > 0);
    const open = segments.filter((s) => fresh.has(s.category));
    const wheel: RealmWheel =
      open.length === 0
        ? step.wheel
        : { ...step.wheel, segments: open, total: open.reduce((sum, s) => sum + s.weight, 0) };
    const { rng, entityId } = await this.drawRng('wheel');
    this.apply(
      { kind: 'SPIN_WHEEL', category: spinRealmWheel(wheel, rng) },
      {
        WHEEL_SPUN: {
          exhausted: segments.filter((s) => !fresh.has(s.category)).map((s) => s.category),
          rng: { purpose: 'match', entityId, keyId: this.ctx.rngKeyId, version: RNG_VERSION },
        },
      },
    );
  }

  protected chooser(): number | null {
    return realmCurrentChooser(this.state);
  }

  protected autoPick(rng: Rng): number {
    return autoPickRealmRegion(this.state, rng);
  }

  protected applyPick(seat: number, region: number): void {
    this.apply(pickInput(this.state, seat, region));
  }

  protected pendingQuestion(): PendingMatchQuestion | null {
    const state = this.state;
    const pending = realmPendingQuestion(state);
    if (!pending) return null;
    return {
      type: pending.type,
      seats: pending.seats,
      purpose: purposeOf(state),
      category: pending.category,
    };
  }

  /**
   * In der Wissensfrage eines Duells antwortet ein Bot in seinen Lieblingskategorien besser
   * (`realmBotProfile`); maßgeblich ist die Kategorie vom Glücksrad. Schätzfragen haben keine.
   */
  protected botProfile(seat: number, strength: MatchBotStrength): NpcProfile {
    const state = this.state;
    const category = state.step.kind === 'DUEL_TRIVIA' ? state.step.category : null;
    return realmBotProfile(strength, state.seats[seat]?.favorites ?? [], category);
  }

  protected applyAnswers(answers: ResolvedAnswers): void {
    const { step } = this.state;
    const estimates = () => answers.seats.map((seat) => ({ seat, ...answers.estimate(seat) }));
    switch (step.kind) {
      case 'START_ESTIMATE':
        this.apply({ kind: 'START_ESTIMATES', answers: estimates() });
        return;
      case 'LAND_ESTIMATE':
        this.apply({ kind: 'LAND_ESTIMATES', answers: estimates() });
        return;
      case 'DUEL_TRIVIA':
        this.apply({
          kind: 'DUEL_TRIVIA',
          attackerCorrect: answers.correct(step.attacker),
          // Freies Feld (O-37): Nur der Angreifer antwortet
          defenderCorrect: step.defender !== null && answers.correct(step.defender),
        });
        return;
      case 'DUEL_ESTIMATE':
        if (step.defender === null) throw new Error('Schätzfrage ohne Verteidiger');
        this.apply({
          kind: 'DUEL_ESTIMATES',
          attacker: answers.estimate(step.attacker),
          defender: answers.estimate(step.defender),
        });
        return;
      case 'CASTLE_PICK':
      case 'VILLAGE_PICK':
      case 'LAND_PICK':
      case 'PREPARE':
      case 'CAMPAIGN_TARGET':
      case 'DUEL_WHEEL':
      case 'FINISHED':
        throw new Error(`Die Frage passt nicht zum Schritt ${step.kind}`);
    }
  }

  protected winnerSeats(): ReadonlySet<number> {
    const state = this.state;
    if (state.step.kind !== 'FINISHED') throw new Error('Partie ist nicht beendet');
    return new Set(realmStandings(state).flatMap((s) => (s.place === 1 ? [s.seat] : [])));
  }
}
