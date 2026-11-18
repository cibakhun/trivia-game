import { DEFAULT_REALM_RULES, matchRulesForSeats } from '@rdw/protocol';
import {
  DIFFICULTY_CLASS_B,
  MATCH_BOT_PROFILES,
  MATCH_BOT_STRENGTHS,
  realmStandings,
  triviaProbability,
  type MatchBotStrength,
  type NpcProfile,
} from '../src/index.ts';
import { BALANCE_PROFILES, simulateRealm } from './realm-sim.ts';

/**
 * Wie oft ein Mensch gegen Bots jeder Stärke gewinnt (ADR-075), aus simulierten Partien mit Ausbau:
 * Sitz 0 antwortet mit dem Profil eines Menschen, die anderen Sitze sind Bots derselben Stärke.
 * Verglichen werden die Stärken von vor ADR-075 und die jetzigen. Aufruf:
 *
 *   corepack pnpm exec tsx packages/game-core/test/bot-staerke-measure.ts [Partien]
 *
 * Gegenproben mit anderen Stärken: `BOT_PROFILES` als JSON, etwa
 * `BOT_PROFILES='{"MEDIUM":{"theta":-0.4,"estimateSpread":2}}'` (überlagert die jetzigen Werte).
 *
 * Keine Abnahme: Die Reihenfolge der Stärken prüft `realm-simulation.test.ts`.
 */

const matches = Number(process.argv[2] ?? 2000);
if (!Number.isSafeInteger(matches) || matches < 1) {
  console.error(`Zahl der Partien muss eine ganze Zahl ab 1 sein: ${process.argv[2]}`);
  process.exit(1);
}

/** Stärken vor ADR-075. */
const BEFORE = BALANCE_PROFILES;

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const rawPatch: unknown = process.env.BOT_PROFILES ? JSON.parse(process.env.BOT_PROFILES) : {};
if (!isPlainObject(rawPatch)) {
  console.error(`BOT_PROFILES muss ein JSON-Objekt sein: ${process.env.BOT_PROFILES}`);
  process.exit(1);
}
for (const [strength, fields] of Object.entries(rawPatch)) {
  const known = (MATCH_BOT_STRENGTHS as readonly string[]).includes(strength);
  const valid =
    known &&
    isPlainObject(fields) &&
    Object.entries(fields).every(
      ([key, value]) =>
        key in MATCH_BOT_PROFILES.MEDIUM &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        // Die feste Streuung muss positiv sein, sonst lehnt `generateNpcEstimate` sie ab
        (key !== 'estimateSpread' || value > 0),
    );
  if (!valid) {
    console.error(`BOT_PROFILES: ungültiger Eintrag für ${strength}: ${JSON.stringify(fields)}`);
    process.exit(1);
  }
}
const patch = rawPatch as Partial<Record<MatchBotStrength, Partial<NpcProfile>>>;
const NOW = Object.fromEntries(
  MATCH_BOT_STRENGTHS.map((s) => [s, { ...MATCH_BOT_PROFILES[s], ...patch[s] }]),
) as Record<MatchBotStrength, NpcProfile>;

/** Trefferquote bei gleich vielen leichten, mittleren und schweren Fragen (wie die Simulation). */
function hitRate(theta: number): number {
  const levels = Object.values(DIFFICULTY_CLASS_B);
  return levels.reduce((sum, b) => sum + triviaProbability(theta, b), 0) / levels.length;
}

/** θ zu einer Trefferquote (Bisektion). */
function thetaFor(rate: number): number {
  let lo = -6;
  let hi = 6;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (hitRate(mid) < rate) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Menschen [E]: „wie in den Partien am 16. und 18.11.“ = gemessen am PC des Product Owners
 * (4 von 12 Wissensfragen richtig, Fehler der Schätzung im Median 1,33 Skaleneinheiten, also eine
 * Streuung um 2); die anderen beiden sind Annahmen für stärkere Spieler.
 */
const HUMANS = [
  { name: 'Mensch wie in den Partien am 16./18.11. (33 %, Streuung 2,0)', rate: 0.33, spread: 2.0 },
  { name: 'Gelegenheitsspieler (50 %, Streuung 1,5)', rate: 0.5, spread: 1.5 },
  { name: 'Kenner (65 %, Streuung 1,0)', rate: 0.65, spread: 1.0 },
] as const;

function pct(x: number): string {
  return `${(100 * x).toFixed(0)} %`;
}

function describe(table: Readonly<Record<MatchBotStrength, NpcProfile>>): string {
  return MATCH_BOT_STRENGTHS.map((s) => {
    const p = table[s];
    const spread = p.estimateSpread ?? NaN;
    return `${s} θ ${p.theta} (${pct(hitRate(p.theta))})${Number.isNaN(spread) ? '' : `, Streuung ${spread}`}`;
  }).join(' · ');
}

console.log(`Vorher: ${describe(BEFORE)}`);
console.log(`Jetzt:  ${describe(NOW)}`);

for (const seats of [2, 3] as const) {
  const rules = matchRulesForSeats(DEFAULT_REALM_RULES, seats);
  for (const human of HUMANS) {
    const profile: NpcProfile = {
      theta: thetaFor(human.rate),
      estimateMedianMs: 7_000,
      responseLogSigma: 0.35,
      estimateSpread: human.spread,
    };
    const cells: string[] = [];
    for (const strength of MATCH_BOT_STRENGTHS) {
      const rates = [BEFORE, NOW].map((profiles) => {
        let wins = 0;
        for (let i = 0; i < matches; i++) {
          const run = simulateRealm(rules, i, { strength, seat0Profile: profile, profiles });
          // Ein geteilter erster Platz zählt anteilig, wie in `realm-measure.ts`
          const winners = realmStandings(run.state).filter((s) => s.place === 1);
          if (winners.some((s) => s.seat === 0)) wins += 1 / winners.length;
        }
        return wins / matches;
      });
      cells.push(`${strength} ${pct(rates[0] as number)} → ${pct(rates[1] as number)}`);
    }
    console.log(`${seats} Spieler, ${human.name}: Sieg ${cells.join(' · ')}`);
  }
}
