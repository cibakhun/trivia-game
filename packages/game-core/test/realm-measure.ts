import { DEFAULT_REALM_RULES, matchRulesForSeats, type RealmRules } from '@rdw/protocol';
import { realmStandings } from '../src/index.ts';
import { simulateRealm } from './realm-sim.ts';

/**
 * Messwerte der Partie mit Ausbau für docs/MATCH_RULES.md §11.9, aus simulierten Partien gleich
 * starker Bots (mittel, ohne verpasste Fragen). Aufruf:
 *
 *   corepack pnpm exec tsx packages/game-core/test/realm-measure.ts [Partien] [Runden]
 *
 * Gegenproben mit anderen Zahlen des Ausbaus: `REALM_ECONOMY` als JSON, das die Standardwerte
 * überlagert, etwa `REALM_ECONOMY='{"costs":{"castle":{"bread":5,"material":10}}}'`; ebenso
 * `REALM_PICKS='[2,1,1]'` für die Wahlen je Platz in der Landnahme zu dritt.
 *
 * Keine Abnahme: Die Tests stehen in `realm-simulation.test.ts`.
 */

const matches = Number(process.argv[2] ?? 2000);
const rounds = process.argv[3] ? Number(process.argv[3]) : undefined;

type Json = { readonly [key: string]: unknown };

/**
 * Legt `patch` über `base`: Objekte Schlüssel für Schlüssel, alles andere ersetzt. `null` nimmt
 * einen Schlüssel heraus, etwa `{"attackNeedsArmy":null}` für die Regeln von vor ADR-064.
 */
function overlay<T>(base: T, patch: unknown): T {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Json) };
  for (const [key, value] of Object.entries(patch as Json)) {
    if (value === null) delete out[key];
    else out[key] = overlay((base as Json | undefined)?.[key], value);
  }
  return out as T;
}

const economyPatch: unknown = process.env.REALM_ECONOMY
  ? JSON.parse(process.env.REALM_ECONOMY)
  : undefined;
const picksPatch: unknown = process.env.REALM_PICKS
  ? JSON.parse(process.env.REALM_PICKS)
  : undefined;

function pct(n: number, of: number): string {
  return `${((100 * n) / of).toFixed(1)} %`;
}

function measure(rules: RealmRules): void {
  let duels = 0;
  let claims = 0;
  let claimed = 0;
  let freeLeft = 0;
  let leftBread = 0;
  let leftMaterial = 0;
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
  let idle = 0;
  let prepares = 0;
  let startFields = 0;
  let startFewest = 0;
  let startMost = 0;
  let winsOfLargest = 0;
  let skipped = 0;
  let skippedMatches = 0;
  const skippedByRound: number[] = Array.from({ length: rules.campaign.rounds }, () => 0);
  const incomeByRound: number[] = Array.from({ length: rules.campaign.rounds }, () => 0);
  const full: number[] = [];
  const typical: number[] = [];
  const solo: number[] = [];
  const soloInstant: number[] = [];
  const winsByPlace: number[] = Array.from({ length: rules.seats }, () => 0);
  const seats = rules.seats;

  for (let i = 0; i < matches; i++) {
    const run = simulateRealm(rules, i, { strength: 'MEDIUM' });
    const { state, events } = run;
    full.push(run.durationMs.full / 60_000);
    typical.push(run.durationMs.typical / 60_000);
    solo.push(run.durationMs.solo / 60_000);
    soloInstant.push(run.durationMs.soloInstant / 60_000);
    questions += state.questions;
    // Partien, in denen mindestens ein Reich fällt (zu dritt können es zwei sein)
    if (events.some((e) => e.kind === 'KINGDOM_ELIMINATED')) falls += 1;
    freeLeft += state.regions.filter((r) => r.owner === null).length;
    for (const s of state.seats) {
      leftBread += s.bread;
      leftMaterial += s.material;
    }
    // Angriffe, die ausfielen, weil keine eigene Armee an einem Ziel stand (ADR-064)
    if (events.some((e) => e.kind === 'ATTACK_SKIPPED')) skippedMatches += 1;
    for (const e of events) {
      if (e.kind === 'ATTACK_SKIPPED') {
        skipped += 1;
        skippedByRound[e.round - 1] = (skippedByRound[e.round - 1] ?? 0) + 1;
        continue;
      }
      // Angriff auf ein freies Feld (O-37): eigene Zählung, kein Duell
      if (e.kind === 'DUEL_RESOLVED' && e.defender === null) {
        claims += 1;
        if (e.effect === 'CLAIMED') claimed += 1;
        continue;
      }
      if (e.kind === 'TARGET_CHOSEN' && e.defender === null) continue;
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
        prepares += 1;
        if (e.summary.built.length === 0 && e.summary.recruited === 0) idle += 1;
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
          incomeByRound[e.round - 1] =
            (incomeByRound[e.round - 1] ?? 0) + (row.bread + row.material) / e.income.length;
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
    // Felder je Reich zu Beginn des Feldzugs: Burg, Startdorf und Landnahme
    const fields = Array.from({ length: seats }, () => 0);
    for (const e of events) {
      if (e.kind === 'CASTLE_CHOSEN' || e.kind === 'VILLAGE_CHOSEN' || e.kind === 'REGION_CLAIMED')
        fields[e.seat] = (fields[e.seat] ?? 0) + 1;
    }
    startFields += fields.reduce((a, b) => a + b, 0) / seats;
    startFewest += Math.min(...fields);
    startMost += Math.max(...fields);
    const standings = realmStandings(state);
    const winners = standings.filter((s) => s.place === 1);
    const largest = fields.flatMap((f, seat) => (f === Math.max(...fields) ? [seat] : []));
    winsOfLargest +=
      winners.filter((w) => largest.includes(w.seat)).length / winners.length / largest.length;
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
    `Angriffe auf freie Felder je Partie: ${(claims / n).toFixed(1)}, davon genommen ${claims > 0 ? pct(claimed, claims) : '–'}; frei am Ende: ${(freeLeft / n).toFixed(1)} Felder`,
  );
  console.log(
    `Ausgefallene Angriffe je Partie (keine Armee am Ziel): ${(skipped / n).toFixed(2)} von ${(seats * rules.campaign.rounds).toFixed(0)}, je Runde ${skippedByRound.map((x) => (x / n).toFixed(2)).join(' / ')}; Partien mit mindestens einem: ${pct(skippedMatches, n)}`,
  );
  console.log(
    `Vorrat am Ende je Spieler, Brot / Baustoff: ${(leftBread / n / seats).toFixed(1)} / ${(leftMaterial / n / seats).toFixed(1)}`,
  );
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
  console.log(
    `Einkommen je Reich nach Runde (Brot + Baustoff): ${incomeByRound.map((x) => (x / n).toFixed(1)).join(' / ')}; Rüstzeiten ohne Bau und ohne Kauf: ${pct(idle, prepares)}`,
  );
  console.log(
    `Felder je Reich zu Beginn des Feldzugs: Mittel ${(startFields / n).toFixed(1)}, kleinstes ${(startFewest / n).toFixed(1)}, größtes ${(startMost / n).toFixed(1)}; ein Reich mit den meisten gewinnt zu ${pct(winsOfLargest, n)}`,
  );
  console.log(`Partien, in denen ein Reich fällt: ${pct(falls, n)}`);
  console.log(
    `Dauer typisch: Mittel ${mean(typical).toFixed(1)} min (90 %: ${q(typical, 0.9).toFixed(1)}); ausgereizt: Mittel ${mean(full).toFixed(1)}, höchstens ${Math.max(...full).toFixed(1)} min`,
  );
  console.log(
    `Dauer allein gegen Bots (nur Sitz 0 ein Mensch): Mittel ${mean(solo).toFixed(1)} min (90 %: ${q(solo, 0.9).toFixed(1)}); wenn Fragen nur an Bots sofort aufgelöst würden: ${mean(soloInstant).toFixed(1)} min`,
  );
  console.log(`Sieg nach Platz der Startfrage: ${winsByPlace.map((w) => pct(w, n)).join(' / ')}`);
}

for (const seats of [3, 2] as const) {
  let base = matchRulesForSeats(DEFAULT_REALM_RULES, seats);
  if (economyPatch !== undefined) base = { ...base, economy: overlay(base.economy, economyPatch) };
  if (picksPatch !== undefined && seats === 3) {
    base = { ...base, landGrab: { picksByPlace: picksPatch as number[] } };
  }
  measure(rounds ? { ...base, campaign: { rounds } } : base);
}
