import { DEFAULT_REALM_RULES, matchRulesForSeats, type RealmRules } from '@rdw/protocol';
import { realmStandings } from '../src/index.ts';
import { simulateRealm } from './realm-sim.ts';

/**
 * Messwerte der Partie mit Ausbau für docs/MATCH_RULES.md §11.9, aus simulierten Partien gleich
 * starker Bots (mittel, ohne verpasste Fragen). Aufruf:
 *
 *   corepack pnpm exec tsx packages/game-core/test/realm-measure.ts [Partien] [Runden]
 *
 * Keine Abnahme: Die Tests stehen in `realm-simulation.test.ts`.
 */

const matches = Number(process.argv[2] ?? 2000);
const rounds = process.argv[3] ? Number(process.argv[3]) : undefined;

function pct(n: number, of: number): string {
  return `${((100 * n) / of).toFixed(1)} %`;
}

function measure(rules: RealmRules): void {
  let duels = 0;
  let attackerWins = 0;
  let conquered = 0;
  let falls = 0;
  let estimates = 0;
  let wheelA = 0;
  let wheelD = 0;
  let wheelFree = 0;
  let villages = 0;
  let towns = 0;
  let secondCastle = 0;
  let recruited = 0;
  let traded = 0;
  let incomeBread = 0;
  let incomeMaterial = 0;
  let incomeRows = 0;
  let questions = 0;
  const full: number[] = [];
  const typical: number[] = [];
  const winsByPlace: number[] = Array.from({ length: rules.seats }, () => 0);
  const seats = rules.seats;

  for (let i = 0; i < matches; i++) {
    const run = simulateRealm(rules, i, { strength: 'MEDIUM' });
    const { state, events } = run;
    full.push(run.durationMs.full / 60_000);
    typical.push(run.durationMs.typical / 60_000);
    questions += state.questions;
    // Partien, in denen mindestens ein Reich fällt (zu dritt können es zwei sein)
    if (events.some((e) => e.kind === 'KINGDOM_ELIMINATED')) falls += 1;
    for (const e of events) {
      if (e.kind === 'DUEL_RESOLVED') {
        duels += 1;
        if (e.winner === 'ATTACKER') attackerWins += 1;
        if (e.effect === 'CONQUERED' || e.effect === 'CASTLE_DESTROYED') conquered += 1;
        if (e.reason === 'ESTIMATE' || e.reason === 'SPEED' || e.reason === 'FULL_TIE')
          estimates += 1;
      }
      if (e.kind === 'TARGET_CHOSEN') {
        const { segments, total } = e.wheel;
        wheelA += segments.reduce((s, x) => s + x.attacker, 0) / total;
        wheelD += segments.reduce((s, x) => s + x.defender, 0) / total;
        wheelFree += segments.reduce((s, x) => s + x.free, 0) / total;
      }
      if (e.kind === 'ORDERS_REVEALED') {
        for (const b of e.summary.built) {
          if (b.building === 'VILLAGE') villages += 1;
          if (b.building === 'TOWN') towns += 1;
        }
        recruited += e.summary.recruited;
        traded += e.summary.traded > 0 ? 1 : 0;
      }
      if (e.kind === 'INCOME') {
        for (const row of e.income) {
          incomeBread += row.bread;
          incomeMaterial += row.material;
          incomeRows += 1;
        }
      }
    }
    // Zweite Burg: wer in der Partie eine gebaut hat
    const builtCastle = new Set(
      events.flatMap((e) =>
        e.kind === 'ORDERS_REVEALED' && e.summary.built.some((b) => b.building === 'CASTLE')
          ? [e.seat]
          : [],
      ),
    );
    secondCastle += builtCastle.size;
    const standings = realmStandings(state);
    const winners = standings.filter((s) => s.place === 1);
    for (const w of winners) {
      const place = state.order.indexOf(w.seat);
      winsByPlace[place] = (winsByPlace[place] ?? 0) + 1 / winners.length;
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const q = (xs: number[], p: number) => sorted(xs)[Math.floor(p * (xs.length - 1))] as number;
  const n = matches;
  console.log(`\n== ${seats} Spieler, ${rules.map}, ${rules.campaign.rounds} Runden, ${n} Partien`);
  console.log(`Fragen je Partie: ${(questions / n).toFixed(1)}`);
  console.log(
    `Duelle je Partie: ${(duels / n).toFixed(1)}, Eroberungen ${(conquered / n).toFixed(1)}`,
  );
  console.log(
    `Angreifer gewinnt: ${pct(attackerWins, duels)}, Schätzfrage entscheidet: ${pct(estimates, duels)}`,
  );
  console.log(
    `Rad Angreifer / Verteidiger / frei: ${pct(wheelA, duels)} / ${pct(wheelD, duels)} / ${pct(wheelFree, duels)}`,
  );
  console.log(
    `Einkommen je Runde und Reich Brot / Baustoff: ${(incomeBread / incomeRows).toFixed(1)} / ${(incomeMaterial / incomeRows).toFixed(1)}`,
  );
  console.log(
    `Je Spieler gebaut: Dörfer ${(villages / n / seats).toFixed(1)}, Städte ${(towns / n / seats).toFixed(1)}; zweite Burg gebaut: ${pct(secondCastle, n * seats)} der Spieler`,
  );
  console.log(
    `Armeen gekauft je Spieler: ${(recruited / n / seats).toFixed(1)}; Rüstzeiten mit Tausch: ${pct(traded, n * seats * rules.campaign.rounds)}`,
  );
  console.log(`Partien, in denen ein Reich fällt: ${pct(falls, n)}`);
  console.log(
    `Dauer typisch: Mittel ${mean(typical).toFixed(1)} min (90 %: ${q(typical, 0.9).toFixed(1)}); ausgereizt: Mittel ${mean(full).toFixed(1)}, höchstens ${Math.max(...full).toFixed(1)} min`,
  );
  console.log(`Sieg nach Platz der Startfrage: ${winsByPlace.map((w) => pct(w, n)).join(' / ')}`);
}

for (const seats of [3, 2] as const) {
  const base = matchRulesForSeats(DEFAULT_REALM_RULES, seats);
  measure(rounds ? { ...base, campaign: { rounds } } : base);
}
