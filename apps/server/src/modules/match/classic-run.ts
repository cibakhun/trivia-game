import {
  applyMatchInput,
  autoPickRegion,
  chooseRegionForBot,
  currentChooser,
  MATCH_BOT_PROFILES,
  matchStandings,
  pendingQuestion,
  type MatchBotStrength,
  type MatchInput,
  type MatchState,
  type NpcProfile,
  type Rng,
} from '@rdw/game-core';
import { ApiError } from '../../infra/errors.ts';
import {
  eventPayload,
  MatchRun,
  type PendingMatchQuestion,
  type QuestionPurpose,
  type ResolvedAnswers,
} from './engine.ts';
import { classicStateOf } from './store.ts';

/**
 * Ablauf der Partie ohne Ausbau (MATCH_RULES §3–§5, ADR-049, ADR-053): Hauptstädte, Landnahme,
 * Feldzug. Zustandsmaschine `match.ts` aus game-core; Zeit, Fragen und Speicherung in `MatchRun`.
 */

function purposeOf(state: MatchState): QuestionPurpose {
  switch (state.step.kind) {
    case 'LAND_ESTIMATE':
      return 'LAND';
    case 'DUEL_TRIVIA':
      return 'DUEL_TRIVIA';
    case 'DUEL_ESTIMATE':
      return 'DUEL_ESTIMATE';
    case 'CAPITAL_PICK':
    case 'LAND_PICK':
    case 'CAMPAIGN_TARGET':
    case 'FINISHED':
      throw new Error(`Im Schritt ${state.step.kind} gibt es keine Frage`);
  }
}

function pickInput(state: MatchState, seat: number, region: number): MatchInput {
  switch (state.step.kind) {
    case 'CAPITAL_PICK':
      return { kind: 'PICK_CAPITAL', seat, region };
    case 'LAND_PICK':
      return { kind: 'PICK_REGION', seat, region };
    case 'CAMPAIGN_TARGET':
      return { kind: 'PICK_TARGET', seat, region };
    case 'LAND_ESTIMATE':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Gerade gibt es nichts zu wählen');
  }
}

export class ClassicRun extends MatchRun {
  get state(): MatchState {
    const state = classicStateOf(this.match);
    if (!state) throw new Error('Partie ohne Zustand');
    return state;
  }

  /** Wendet eine Eingabe an; Fehler sind Programmfehler, außer bei Wahlen von Menschen. */
  apply(input: MatchInput): void {
    const result = applyMatchInput(this.state, input);
    if (!result.ok) {
      if (result.error === 'INVALID_REGION') {
        throw new ApiError(422, 'INVALID_REGION', 'Diese Region ist nicht wählbar');
      }
      if (result.error === 'NOT_YOUR_TURN') {
        throw new ApiError(409, 'NOT_YOUR_TURN', 'Ein anderer Sitz ist dran');
      }
      throw new Error(`Eingabe ${input.kind} abgelehnt: ${result.error}`);
    }
    this.match.state = result.state;
    for (const event of result.events) this.emit(event.kind, eventPayload(event));
  }

  /** Dauer der Ansage vor dem aktuellen Schritt: ein Duell wird länger angesagt als eine Wahl. */
  private announceMsFor(state: MatchState): number | undefined {
    const { timers } = this.rules;
    return state.step.kind === 'DUEL_TRIVIA' ? timers.announceMs : timers.pickShowMs;
  }

  async enterStep(picker: number | null = null): Promise<void> {
    for (;;) {
      this.guard();
      const state = this.state;
      const { step } = state;
      switch (step.kind) {
        case 'FINISHED':
          await this.finish();
          return;
        case 'CAPITAL_PICK':
        case 'LAND_PICK':
        case 'CAMPAIGN_TARGET': {
          const seat = currentChooser(state);
          if (seat === null) throw new Error('Wahl ohne Wählenden');
          // Wählt derselbe Sitz gleich noch einmal (Landnahme), geht es ohne Pause weiter
          if (picker !== null && picker !== seat && this.announce(this.rules.timers.pickShowMs)) {
            return;
          }
          const player = this.playerAt(seat);
          if (player.botStrength !== null) {
            const { rng } = await this.drawRng('bot');
            this.apply(pickInput(state, seat, chooseRegionForBot(state, rng)));
            // Die Wahl bleibt stehen, damit alle sie sehen; ein Angriff wird angesagt
            if (this.announce(this.announceMsFor(this.state))) return;
            continue;
          }
          this.awaitPick();
          return;
        }
        case 'LAND_ESTIMATE':
        case 'DUEL_TRIVIA':
        case 'DUEL_ESTIMATE': {
          // Nach der Wahl eines Menschen kommt die Frage nicht sofort: erst die Ansage
          if (picker !== null && this.announce(this.announceMsFor(state))) return;
          const opened = await this.openQuestion();
          if (opened === 'WAITING') return;
          if (opened === 'ABANDONED') return;
          // Kein Mensch in der Partie: sofort auflösen, die Auflösung bleibt trotzdem stehen
          await this.resolveQuestion();
          return;
        }
      }
    }
  }

  protected chooser(): number | null {
    return currentChooser(this.state);
  }

  protected autoPick(rng: Rng): number {
    return autoPickRegion(this.state, rng);
  }

  protected applyPick(seat: number, region: number): void {
    this.apply(pickInput(this.state, seat, region));
  }

  protected pendingQuestion(): PendingMatchQuestion | null {
    const state = this.state;
    const pending = pendingQuestion(state);
    if (!pending) return null;
    return { type: pending.type, seats: pending.seats, purpose: purposeOf(state), category: null };
  }

  protected botProfile(_seat: number, strength: MatchBotStrength): NpcProfile {
    return MATCH_BOT_PROFILES[strength];
  }

  protected applyAnswers(answers: ResolvedAnswers): void {
    const { step } = this.state;
    switch (step.kind) {
      case 'LAND_ESTIMATE':
        this.apply({
          kind: 'LAND_ESTIMATES',
          answers: answers.seats.map((seat) => ({ seat, ...answers.estimate(seat) })),
        });
        return;
      case 'DUEL_TRIVIA':
        this.apply({
          kind: 'DUEL_TRIVIA',
          attackerCorrect: answers.correct(step.attacker),
          defenderCorrect: answers.correct(step.defender),
        });
        return;
      case 'DUEL_ESTIMATE':
        this.apply({
          kind: 'DUEL_ESTIMATES',
          attacker: answers.estimate(step.attacker),
          defender: answers.estimate(step.defender),
        });
        return;
      case 'CAPITAL_PICK':
      case 'LAND_PICK':
      case 'CAMPAIGN_TARGET':
      case 'FINISHED':
        throw new Error(`Die Frage passt nicht zum Schritt ${step.kind}`);
    }
  }

  protected winnerSeats(): ReadonlySet<number> {
    const state = this.state;
    if (state.step.kind !== 'FINISHED') throw new Error('Partie ist nicht beendet');
    return new Set(matchStandings(state).flatMap((s) => (s.place === 1 ? [s.seat] : [])));
  }
}
