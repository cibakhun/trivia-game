import {
  capitalLivesLeft,
  legalRegions,
  mapOf,
  matchPoints,
  regionsOf,
  type MatchState,
} from './match.ts';
import { regionDistance, regionNeighbors } from './match-map.ts';
import { NPC_BASE_PROFILES, type NpcProfile } from './npc.ts';
import type { Rng } from './rng.ts';

/**
 * Bots für Testpartien (docs/MATCH_RULES.md §7, ADR-048). Eine normale Partie spielen nur
 * Menschen; in einer Testpartie füllen Bots freie Plätze, damit sich das Spiel allein testen
 * lässt. Außerdem spielen Unit-Tests und Simulation mit ihnen.
 *
 * Bots antworten wie NPCs im PvE über das Antwortmodell (`generateNpcAnswer`,
 * `generateNpcEstimate`, Strom `npc-answer`), versiegelt vor der Frage, und wählen mit einfachen,
 * festen Regeln; Gleichstände entscheidet der Strom `match`. Die Stärke wirkt nur auf die
 * Antworten, nicht auf die Wahlen.
 */

export const MATCH_BOT_STRENGTHS = ['EASY', 'MEDIUM', 'HARD'] as const;
export type MatchBotStrength = (typeof MATCH_BOT_STRENGTHS)[number];

/** Leicht, mittel, schwer = die NPC-Archetypen LIGHT, MEDIUM, HEAVY (NPC_SYSTEM §2) [E]. */
export const MATCH_BOT_PROFILES: Readonly<Record<MatchBotStrength, NpcProfile>> = Object.freeze({
  EASY: NPC_BASE_PROFILES.LIGHT,
  MEDIUM: NPC_BASE_PROFILES.MEDIUM,
  HARD: NPC_BASE_PROFILES.HEAVY,
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
