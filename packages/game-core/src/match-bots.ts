import {
  capitalLivesLeft,
  legalRegions,
  mapOf,
  matchPoints,
  regionsOf,
  type MatchState,
} from './match.ts';
import { regionDistance, regionNeighbors } from './match-map.ts';
import { DEFAULT_RESPONSE_LOG_SIGMA, type NpcProfile } from './npc.ts';
import type { Rng } from './rng.ts';

/**
 * Bots der Partie (docs/MATCH_RULES.md §7): Der Gastgeber setzt sie auf freie Plätze (ADR-052),
 * in einer Testpartie stehen sie schon beim Anlegen fest (ADR-048). Außerdem spielen Unit-Tests
 * und Simulation mit ihnen.
 *
 * Bots antworten wie NPCs im PvE über das Antwortmodell (`generateNpcAnswer`,
 * `generateNpcEstimate`, Strom `npc-answer`), versiegelt vor der Frage, aber mit eigenen Stärken
 * (`MATCH_BOT_PROFILES`), und wählen mit einfachen, festen Regeln; Gleichstände entscheidet der
 * Strom `match`. Die Stärke wirkt nur auf die Antworten, nicht auf die Wahlen.
 */

export const MATCH_BOT_STRENGTHS = ['EASY', 'MEDIUM', 'HARD'] as const;
export type MatchBotStrength = (typeof MATCH_BOT_STRENGTHS)[number];

/**
 * Stärken der Bots (ADR-075, Rückmeldung des Product Owners am 2026-11-18: „bots sind zu hart“).
 * Bis dahin waren es die NPC-Archetypen LIGHT, MEDIUM, HEAVY; gegen sie trafen Menschen in zwei
 * Partien 4 von 12 Wissensfragen, der mittlere Bot 17 von 24, und er lag bei allen 12 gemeinsamen
 * Schätzfragen näher. Jetzt hat jede Stärke eigene Werte [E]:
 *
 * - `theta` = Trefferquote bei gleich vielen leichten, mittleren und schweren Wissensfragen:
 *   leicht 19 %, mittel 32 %, schwer 52 % (vorher 42, 62, 81 %). Leicht trifft damit seltener als
 *   Raten bei vier Antworten; gewollt, damit „leicht“ deutlich leichter ist als „mittel“.
 * - `estimateSpread` = Streuung der Schätzung in Vielfachen von `estimate_scale`, fest statt aus θ
 *   (vorher 1,0, 0,47, 0,21). Ein Mensch lag in denselben Partien im Median 1,33 daneben, was
 *   einer Streuung um 2 entspricht; mittel schätzt jetzt etwas schlechter als er.
 * - `estimateMedianMs` = Bedenkzeit der Schätzung; sie zählt nur bei gleichem Abstand.
 *
 * Gemessen mit `test/bot-staerke-measure.ts`: Ein Mensch wie in jenen Partien gewinnt zu zweit
 * gegen leicht, mittel, schwer rund 69, 45 und 16 % (vorher 24, 4 und 0 %).
 */
export const MATCH_BOT_PROFILES: Readonly<Record<MatchBotStrength, NpcProfile>> = Object.freeze({
  EASY: Object.freeze({
    theta: -1.7,
    estimateSpread: 3.5,
    estimateMedianMs: 12_000,
    responseLogSigma: DEFAULT_RESPONSE_LOG_SIGMA,
  }),
  MEDIUM: Object.freeze({
    theta: -0.9,
    estimateSpread: 2.4,
    estimateMedianMs: 10_000,
    responseLogSigma: DEFAULT_RESPONSE_LOG_SIGMA,
  }),
  HARD: Object.freeze({
    theta: 0.1,
    estimateSpread: 1.2,
    estimateMedianMs: 9_000,
    responseLogSigma: DEFAULT_RESPONSE_LOG_SIGMA,
  }),
});

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

/**
 * Wahl eines Bots im aktuellen Schritt:
 * - Hauptstadt: möglichst weit weg von den anderen (bis 3 Felder zählt), dann viele Nachbarn;
 * - Landnahme: viele eigene Nachbarn (zusammenhängendes Gebiet), dann viele freie;
 * - Angriffsziel: größter unmittelbarer Gewinn. Eine Region bringt ihren Wert; eine Hauptstadt
 *   mit einem letzten Leben das ganze Reich, sonst nur die Hälfte ihres Werts, weil der Treffer
 *   allein noch nichts einbringt.
 */
export function chooseRegionForBot(state: MatchState, rng: Rng): number {
  const map = mapOf(state);
  const options = legalRegions(state);
  const { step } = state;
  switch (step.kind) {
    case 'CAPITAL_PICK': {
      const others = state.seats.flatMap((s) => (s.capital === null ? [] : [s.capital]));
      return pickBest(
        options,
        (region) => {
          const spacing = Math.min(3, ...others.map((c) => regionDistance(map, region, c)));
          return spacing * 10 + regionNeighbors(map, region).length;
        },
        rng,
      );
    }
    case 'LAND_PICK': {
      const seat = step.queue[0] as number;
      const owned = new Set(regionsOf(state, seat));
      return pickBest(
        options,
        (region) => {
          const neighbors = regionNeighbors(map, region);
          const own = neighbors.filter((n) => owned.has(n)).length;
          const free = neighbors.filter((n) => state.regions[n]?.owner === null).length;
          return own * 3 + free;
        },
        rng,
      );
    }
    case 'CAMPAIGN_TARGET':
      return pickBest(
        options,
        (region) => {
          const target = state.regions[region];
          if (!target || target.owner === null) return Number.NEGATIVE_INFINITY;
          if (target.capitalOf === target.owner) {
            return capitalLivesLeft(state, target.owner) <= 1
              ? matchPoints(state, target.owner)
              : target.value / 2;
          }
          return target.value;
        },
        rng,
      );
    case 'LAND_ESTIMATE':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      throw new Error(`Im Schritt ${step.kind} gibt es nichts zu wählen`);
  }
}
