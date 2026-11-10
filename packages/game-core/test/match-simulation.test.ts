import { DEFAULT_MATCH_RULES } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  applyMatchInput,
  autoPickRegion,
  chooseRegionForBot,
  createMatch,
  createRng,
  currentChooser,
  DIFFICULTY_CLASS_B,
  formatDecimal,
  freeRegions,
  generateNpcAnswer,
  generateNpcEstimate,
  MATCH_BOT_PROFILES,
  MATCH_BOT_STRENGTHS,
  matchPhase,
  matchStandings,
  pendingQuestion,
  regionsOf,
  scoreEstimate,
  type MatchBotStrength,
  type MatchEstimateAnswer,
  type MatchEvent,
  type MatchInput,
  type MatchState,
  type NpcEstimateSpec,
  type Rng,
} from '../src/index.ts';

/**
 * Simulation von 1 000 Bot-Partien (Abnahme M1, docs/MATCH_RULES.md §9): Nach jedem Schritt gelten
 * die Invarianten, jede Partie endet, die Punkte stimmen, und keine Partie braucht mehr Fragen
 * oder Zeit als geplant. Ein Teil der Sitze verpasst Fragen und Wahlen wie ein Mensch, der nicht
 * rechtzeitig antwortet.
 */

const MATCHES = 1000;
const RULES = DEFAULT_MATCH_RULES;
const { timers } = RULES;
/** Plan: 7 Schätzfragen + 12 Wissensfragen + bis zu 12 Schätzfragen bei Gleichstand. */
const MAX_QUESTIONS = 31;
/** Plan: unter 18 Minuten, auch wenn jeder Timer voll ausläuft. */
const MAX_DURATION_MS = 18 * 60_000;

function seededRng(i: number, salt: number): Rng {
  const seed = new Uint8Array(16);
  const view = new DataView(seed.buffer);
  view.setUint32(0, i);
  view.setUint32(4, salt);
  view.setUint32(8, 0x27d4eb2f);
  view.setUint32(12, 0x165667b1);
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

function scoreBot(
  rng: Rng,
  strength: MatchBotStrength,
  spec: NpcEstimateSpec,
  missed: boolean,
): MatchEstimateAnswer {
  // Gezogen wird immer, damit ein verpasster Schritt die Folge der anderen nicht verschiebt.
  const answer = generateNpcEstimate(rng, MATCH_BOT_PROFILES[strength], spec, timers.estimateMs);
  if (missed) return { distance: null, effectiveMs: null };
  const scored = scoreEstimate(formatDecimal(answer.estimate), spec);
  if (!scored.ok) throw new Error('Bot-Schätzung außerhalb des Bereichs');
  return { distance: scored.distance, effectiveMs: answer.estimateMs };
}

interface Simulated {
  readonly state: MatchState;
  readonly events: readonly MatchEvent[];
  readonly strengths: readonly MatchBotStrength[];
  readonly durationMs: number;
  readonly steps: number;
}

function checkInvariants(state: MatchState, capitals: ReadonlySet<number>): void {
  const { values, capital } = RULES;
  state.regions.forEach((r, id) => {
    if (r.owner !== null && !(r.owner >= 0 && r.owner < state.seats.length)) {
      throw new Error(`Region ${id}: unbekannter Besitzer ${r.owner}`);
    }
    if (r.capitalOf !== null) {
      if (r.owner !== r.capitalOf) throw new Error(`Hauptstadt ${id} gehört nicht ihrem Reich`);
      if (state.seats[r.capitalOf]?.capital !== id)
        throw new Error(`Hauptstadt ${id} falsch zugeordnet`);
    }
    const base = capitals.has(id) ? values.capital : values.region;
    if (r.value !== base + r.fortifications * values.defenseBonus) {
      throw new Error(`Region ${id}: Wert ${r.value} passt nicht zu den Befestigungen`);
    }
  });
  state.seats.forEach((s, seat) => {
    const owned = regionsOf(state, seat);
    if (s.eliminatedInDuel !== null) {
      if (owned.length > 0) throw new Error(`Ausgeschiedener Sitz ${seat} hat noch Regionen`);
      return;
    }
    if (s.capital === null) return;
    const capitalsHeld = state.regions.filter((r) => r.capitalOf === seat).length;
    if (capitalsHeld !== 1) throw new Error(`Sitz ${seat} hat ${capitalsHeld} Hauptstädte`);
    if (s.capitalHits >= capital.lives) throw new Error(`Sitz ${seat} lebt ohne Leben`);
  });
  const phase = matchPhase(state);
  if ((phase === 'CAMPAIGN' || phase === 'FINISHED') && freeRegions(state).length > 0) {
    throw new Error('Feldzug mit freien Regionen');
  }
  // Während der Schätzfrage eines Duells ist dessen Wissensfrage schon gezählt
  const openDuel = state.step.kind === 'DUEL_ESTIMATE' ? 1 : 0;
  if (state.questions > 7 + 2 * (state.duels + openDuel))
    throw new Error('Mehr Fragen als möglich');
  if (state.duels > RULES.campaign.rounds * RULES.seats) throw new Error('Zu viele Duelle');
}

function simulate(index: number): Simulated {
  const choices = seededRng(index, 1); // Strom `match`: Stärken, Zeitabläufe, Bot-Wahlen
  const answers = seededRng(index, 2); // Strom `npc-answer`
  const questions = seededRng(index, 3); // Fragen
  const strengths = [0, 1, 2].map(
    () =>
      MATCH_BOT_STRENGTHS[choices.nextUint32() % MATCH_BOT_STRENGTHS.length] as MatchBotStrength,
  );
  // Sitz 0 spielt wie ein Mensch, der manchmal nicht rechtzeitig antwortet oder wählt
  const missRate = [0.15, 0, 0];
  const missed = (seat: number) => choices.nextFloat() < (missRate[seat] ?? 0);

  let state = createMatch(RULES);
  const events: MatchEvent[] = [];
  const capitals = new Set<number>();
  let durationMs = 0;
  let steps = 0;
  let sealed: { attacker: MatchEstimateAnswer; defender: MatchEstimateAnswer } | null = null;

  while (state.step.kind !== 'FINISHED') {
    steps += 1;
    if (steps > 500) throw new Error(`Partie ${index} endet nicht`);
    const { step } = state;
    let input: MatchInput;
    switch (step.kind) {
      case 'CAPITAL_PICK':
      case 'LAND_PICK':
      case 'CAMPAIGN_TARGET': {
        const seat = currentChooser(state) as number;
        const region = missed(seat)
          ? autoPickRegion(state, choices)
          : chooseRegionForBot(state, choices);
        const kind =
          step.kind === 'CAPITAL_PICK'
            ? 'PICK_CAPITAL'
            : step.kind === 'LAND_PICK'
              ? 'PICK_REGION'
              : 'PICK_TARGET';
        if (kind === 'PICK_CAPITAL') capitals.add(region);
        input = { kind, seat, region };
        durationMs += timers.pickMs;
        break;
      }
      case 'LAND_ESTIMATE': {
        const spec = randomEstimateSpec(questions);
        const seats = pendingQuestion(state)?.seats ?? [];
        input = {
          kind: 'LAND_ESTIMATES',
          answers: seats.map((seat) => ({
            seat,
            ...scoreBot(answers, strengths[seat] as MatchBotStrength, spec, missed(seat)),
          })),
        };
        durationMs += timers.estimateMs + timers.revealMs;
        break;
      }
      case 'DUEL_TRIVIA': {
        // Wie im PvE stehen die Antworten beider Fragen vorab fest (versiegelt)
        const levels = Object.values(DIFFICULTY_CLASS_B);
        const triviaB = levels[questions.nextUint32() % levels.length] as number;
        const spec = randomEstimateSpec(questions);
        const answer = (seat: number) => {
          const a = generateNpcAnswer(
            answers,
            MATCH_BOT_PROFILES[strengths[seat] as MatchBotStrength],
            {
              triviaB,
              wrongOptionCount: 3,
              estimate: spec,
              estimateTimeLimitMs: timers.estimateMs,
            },
          );
          const scored = scoreEstimate(formatDecimal(a.estimate), spec);
          if (!scored.ok) throw new Error('Bot-Schätzung außerhalb des Bereichs');
          const miss = missed(seat);
          return {
            correct: a.triviaCorrect && !miss,
            estimate: miss
              ? { distance: null, effectiveMs: null }
              : { distance: scored.distance, effectiveMs: a.estimateMs },
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
        durationMs += timers.triviaMs + timers.revealMs;
        break;
      }
      case 'DUEL_ESTIMATE': {
        if (!sealed) throw new Error('Schätzfrage ohne versiegelte Antworten');
        input = { kind: 'DUEL_ESTIMATES', ...sealed };
        sealed = null;
        durationMs += timers.estimateMs + timers.revealMs;
        break;
      }
    }
    const result = applyMatchInput(state, input);
    if (!result.ok) throw new Error(`Partie ${index}, ${step.kind}: ${result.error}`);
    state = result.state;
    events.push(...result.events);
    checkInvariants(state, capitals);
  }
  return { state, events, strengths, durationMs, steps };
}

describe(`Simulation von ${MATCHES} Bot-Partien`, () => {
  const runs = Array.from({ length: MATCHES }, (_, i) => simulate(i));

  it('jede Partie endet regelgerecht und in der geplanten Länge', () => {
    for (const run of runs) {
      const { state, events } = run;
      expect(state.step.kind).toBe('FINISHED');
      expect(state.questions).toBeLessThanOrEqual(MAX_QUESTIONS);
      expect(state.duels).toBeLessThanOrEqual(12);
      expect(run.durationMs).toBeLessThanOrEqual(MAX_DURATION_MS);
      expect(events.filter((e) => e.kind === 'LAND_RANKED')).toHaveLength(7);
      expect(events.filter((e) => e.kind === 'REGION_CLAIMED')).toHaveLength(21);
    }
  });

  it('die Punkte sind die Summe der Regionswerte, der Endstand ist stimmig', () => {
    for (const { state, events } of runs) {
      const standings = matchStandings(state);
      const finished = events.at(-1);
      expect(finished).toEqual({
        kind: 'MATCH_FINISHED',
        reason: (state.step as { reason: string }).reason,
        standings,
      });
      const total = state.regions.reduce((sum, r) => sum + r.value, 0);
      expect(standings.reduce((sum, s) => sum + s.points, 0)).toBe(total);
      expect(standings.some((s) => s.place === 1)).toBe(true);
      for (const s of standings) {
        if (s.eliminated) expect(s.points).toBe(0);
        expect(s.place).toBeGreaterThanOrEqual(1);
        expect(s.place).toBeLessThanOrEqual(3);
      }
    }
  });

  it('übernimmt Reiche und befestigt Regionen in nennenswerter Zahl', () => {
    const takeovers = runs.filter((r) =>
      r.events.some((e) => e.kind === 'KINGDOM_ELIMINATED'),
    ).length;
    const lastKingdom = runs.filter(
      (r) => r.state.step.kind === 'FINISHED' && r.state.step.reason === 'LAST_KINGDOM',
    ).length;
    const fortified = runs.reduce(
      (n, r) =>
        n + r.events.filter((e) => e.kind === 'DUEL_RESOLVED' && e.effect === 'FORTIFIED').length,
      0,
    );
    const estimates = runs.reduce(
      (n, r) =>
        n +
        r.events.filter(
          (e) => e.kind === 'DUEL_RESOLVED' && (e.reason === 'ESTIMATE' || e.reason === 'SPEED'),
        ).length,
      0,
    );
    expect(takeovers).toBeGreaterThan(0);
    expect(lastKingdom).toBeLessThan(takeovers + 1);
    expect(fortified).toBeGreaterThan(MATCHES);
    expect(estimates).toBeGreaterThan(MATCHES);
  });

  it('stärkere Bots gewinnen öfter', () => {
    const wins = { EASY: 0, MEDIUM: 0, HARD: 0 };
    const seats = { EASY: 0, MEDIUM: 0, HARD: 0 };
    for (const run of runs) {
      for (const s of matchStandings(run.state)) {
        const strength = run.strengths[s.seat] as MatchBotStrength;
        seats[strength] += 1;
        if (s.place === 1) wins[strength] += 1;
      }
    }
    const rate = (k: MatchBotStrength) => wins[k] / seats[k];
    expect(rate('HARD')).toBeGreaterThan(rate('MEDIUM'));
    expect(rate('MEDIUM')).toBeGreaterThan(rate('EASY'));
  });

  it('ist mit denselben Strömen bitgleich wiederholbar', () => {
    const again = simulate(17);
    expect(again.events).toEqual(runs[17]?.events);
    expect(again.state).toEqual(runs[17]?.state);
  });
});
