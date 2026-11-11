import { QUESTION_CATEGORIES, type QuestionCategory, type RealmRules } from '@rdw/protocol';
import {
  applyRealmInput,
  autoPickRealmRegion,
  chooseRealmFavoritesForBot,
  chooseRealmOrdersForBot,
  chooseRegionForRealmBot,
  createRealm,
  createRng,
  DIFFICULTY_CLASS_B,
  formatDecimal,
  generateRealmBotAnswer,
  generateNpcEstimate,
  MATCH_BOT_STRENGTHS,
  realmBotProfile,
  realmCurrentChooser,
  realmPendingQuestion,
  scoreEstimate,
  spinRealmWheel,
  type MatchBotStrength,
  type MatchEstimateAnswer,
  type NpcEstimateSpec,
  type RealmEvent,
  type RealmInput,
  type RealmState,
  type Rng,
} from '../src/index.ts';

/**
 * Simulierte Partien mit Ausbau aus Bots (docs/MATCH_RULES.md §11.9): Grundlage für
 * `realm-simulation.test.ts` (Regeln und Invarianten) und `realm-measure.ts` (Messwerte für die
 * Doku). Die Ströme sind wie in `match-simulation.test.ts` je Partie fest, eine Wiederholung ist
 * bitgleich.
 */

export interface RealmSimOptions {
  /** Feste Stärke für alle Sitze; sonst je Sitz zufällig. */
  readonly strength?: MatchBotStrength;
  /**
   * Anteil verpasster Fragen, Wahlen und Rüstzeiten von Sitz 0 (wie ein Mensch); im Duell verpasst
   * er beide Fragen zusammen.
   */
  readonly seat0Misses?: number;
  /** Nach jedem Schritt aufgerufen, zum Prüfen von Invarianten. */
  readonly onStep?: (state: RealmState) => void;
}

/** Dauer je Schritt in ms: `full` = jede Zeit ausgereizt, `typical` = Annahmen aus dem Konzept. */
export interface RealmDurations {
  readonly full: number;
  readonly typical: number;
}

export interface RealmSimulated {
  readonly state: RealmState;
  readonly events: readonly RealmEvent[];
  readonly strengths: readonly MatchBotStrength[];
  readonly durationMs: RealmDurations;
  readonly steps: number;
}

/** Annahmen für die typische Dauer [E]: so schnell wählen, antworten und rüsten Menschen im Schnitt. */
export const TYPICAL_MS = {
  pick: 5_000,
  trivia: 8_000,
  estimate: 11_000,
  prepare: 25_000,
} as const;

export function seededRng(i: number, salt: number): Rng {
  const seed = new Uint8Array(16);
  const view = new DataView(seed.buffer);
  view.setUint32(0, i);
  view.setUint32(4, salt);
  view.setUint32(8, 0x5bd1e995);
  view.setUint32(12, 0x1b873593);
  return createRng(seed);
}

function randomEstimateSpec(rng: Rng): NpcEstimateSpec {
  const answer = 100 + (rng.nextUint32() % 4900);
  return rng.nextFloat() < 0.5
    ? {
        answerValue: String(answer),
        answerPrecision: 0,
        inputMin: '0',
        inputMax: '100000',
        scaleType: 'LINEAR',
        scale: Math.max(1, Math.round(answer * 0.15)),
      }
    : {
        answerValue: String(answer),
        answerPrecision: 0,
        inputMin: '1',
        inputMax: '1000000',
        scaleType: 'LOG',
        scale: 0.3,
      };
}

function scored(spec: NpcEstimateSpec, estimate: Parameters<typeof formatDecimal>[0], ms: number) {
  const result = scoreEstimate(formatDecimal(estimate), spec);
  if (!result.ok) throw new Error('Schätzung außerhalb des Bereichs');
  return { distance: result.distance, effectiveMs: ms };
}

const MISSED: MatchEstimateAnswer = { distance: null, effectiveMs: null };

export function simulateRealm(
  rules: RealmRules,
  index: number,
  options: RealmSimOptions = {},
): RealmSimulated {
  const { timers, economy } = rules;
  const choices = seededRng(index, 1); // wie Strom `match`: Stärken, Wahlen, Rad, Zeitabläufe
  const answers = seededRng(index, 2); // wie Strom `npc-answer`
  const questions = seededRng(index, 3); // Fragen
  const categories: QuestionCategory[] = [...QUESTION_CATEGORIES];
  const strengths = Array.from(
    { length: rules.seats },
    () =>
      options.strength ??
      (MATCH_BOT_STRENGTHS[choices.nextUint32() % MATCH_BOT_STRENGTHS.length] as MatchBotStrength),
  );
  const favorites = strengths.map(() =>
    chooseRealmFavoritesForBot(categories, economy.favorites, choices),
  );
  const missRate = options.seat0Misses ?? 0;
  const missed = (seat: number) => choices.nextFloat() < (seat === 0 ? missRate : 0);

  let state = createRealm(rules, { categories, favorites });
  const events: RealmEvent[] = [];
  let full = 0;
  let typical = 0;
  let steps = 0;
  let sealed: { attacker: MatchEstimateAnswer; defender: MatchEstimateAnswer } | null = null;

  const estimateRound = (seats: readonly number[]) => {
    const spec = randomEstimateSpec(questions);
    full += timers.estimateMs + timers.revealMs;
    typical += TYPICAL_MS.estimate + timers.revealMs;
    return seats.map((seat) => {
      const a = generateNpcEstimate(
        answers,
        realmBotProfile(strengths[seat] as MatchBotStrength, favorites[seat] ?? [], null),
        spec,
        timers.estimateMs,
      );
      return { seat, ...(missed(seat) ? MISSED : scored(spec, a.estimate, a.estimateMs)) };
    });
  };

  while (state.step.kind !== 'FINISHED') {
    steps += 1;
    if (steps > 1000) throw new Error(`Partie ${index} endet nicht`);
    const { step } = state;
    let input: RealmInput;
    switch (step.kind) {
      case 'START_ESTIMATE':
        input = { kind: 'START_ESTIMATES', answers: estimateRound(state.seats.map((_, s) => s)) };
        break;
      case 'LAND_ESTIMATE':
        input = {
          kind: 'LAND_ESTIMATES',
          answers: estimateRound(realmPendingQuestion(state)?.seats ?? []),
        };
        break;
      case 'CASTLE_PICK':
      case 'VILLAGE_PICK':
      case 'LAND_PICK':
      case 'CAMPAIGN_TARGET': {
        const seat = realmCurrentChooser(state) as number;
        const region = missed(seat)
          ? autoPickRealmRegion(state, choices)
          : chooseRegionForRealmBot(state, choices);
        const kind =
          step.kind === 'CASTLE_PICK'
            ? 'PICK_CASTLE'
            : step.kind === 'VILLAGE_PICK'
              ? 'PICK_VILLAGE'
              : step.kind === 'LAND_PICK'
                ? 'PICK_REGION'
                : 'PICK_TARGET';
        input = { kind, seat, region };
        // Ein Angriff wird mit dem Glücksrad angesagt, jede andere Wahl bleibt kurz stehen
        const pause = kind === 'PICK_TARGET' ? economy.timers.wheelMs : (timers.pickShowMs ?? 0);
        full += timers.pickMs + pause;
        typical += TYPICAL_MS.pick + pause;
        break;
      }
      case 'PREPARE': {
        // Alle Bots planen gleichzeitig; wer verpasst, gibt nichts ab
        const pending = step.orders.flatMap((o, seat) => (o === null ? [seat] : []));
        let anyMissed = false;
        for (const seat of pending) {
          if (missed(seat)) {
            anyMissed = true;
            continue;
          }
          const r = applyRealmInput(state, {
            kind: 'SUBMIT_ORDERS',
            seat,
            orders: chooseRealmOrdersForBot(state, seat, choices),
          });
          if (!r.ok) throw new Error(`Partie ${index}, Befehle von Sitz ${seat}: ${r.error}`);
          state = r.state;
          events.push(...r.events);
          options.onStep?.(state);
        }
        full += economy.timers.prepareMs + economy.timers.ordersRevealMs;
        typical +=
          (anyMissed ? economy.timers.prepareMs : TYPICAL_MS.prepare) +
          economy.timers.ordersRevealMs;
        if (state.step.kind !== 'PREPARE') continue;
        input = { kind: 'CLOSE_PREPARE' };
        break;
      }
      case 'DUEL_WHEEL':
        input = { kind: 'SPIN_WHEEL', category: spinRealmWheel(step.wheel, choices) };
        break;
      case 'DUEL_TRIVIA': {
        // Wie im PvE stehen die Antworten beider Fragen vorab fest (versiegelt)
        const levels = Object.values(DIFFICULTY_CLASS_B);
        const triviaB = levels[questions.nextUint32() % levels.length] as number;
        const spec = randomEstimateSpec(questions);
        const answer = (seat: number) => {
          const a = generateRealmBotAnswer(
            answers,
            strengths[seat] as MatchBotStrength,
            favorites[seat] ?? [],
            step.category,
            {
              triviaB,
              wrongOptionCount: 3,
              estimate: spec,
              estimateTimeLimitMs: timers.estimateMs,
            },
          );
          // Wer ein Duell verpasst, verpasst beide Fragen (wie match-simulation.test.ts)
          const miss = missed(seat);
          return {
            correct: a.triviaCorrect && !miss,
            estimate: miss ? MISSED : scored(spec, a.estimate, a.estimateMs),
          };
        };
        const attacker = answer(step.attacker);
        const defender = answer(step.defender);
        sealed = { attacker: attacker.estimate, defender: defender.estimate };
        input = {
          kind: 'DUEL_TRIVIA',
          attackerCorrect: attacker.correct,
          defenderCorrect: defender.correct,
        };
        full += timers.triviaMs + timers.revealMs;
        typical += TYPICAL_MS.trivia + timers.revealMs;
        break;
      }
      case 'DUEL_ESTIMATE': {
        if (!sealed) throw new Error('Schätzfrage ohne versiegelte Antworten');
        input = { kind: 'DUEL_ESTIMATES', ...sealed };
        sealed = null;
        full += timers.estimateMs + timers.revealMs;
        typical += TYPICAL_MS.estimate + timers.revealMs;
        break;
      }
    }
    const result = applyRealmInput(state, input);
    if (!result.ok) throw new Error(`Partie ${index}, ${step.kind}: ${result.error}`);
    state = result.state;
    events.push(...result.events);
    options.onStep?.(state);
  }
  return { state, events, strengths, durationMs: { full, typical }, steps };
}
