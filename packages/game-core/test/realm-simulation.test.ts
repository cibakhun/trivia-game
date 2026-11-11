import { DEFAULT_REALM_RULES, matchRulesForSeats, type RealmRules } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  castlesOf,
  matchMap,
  realmPhase,
  realmStandings,
  type MatchBotStrength,
  type RealmEvent,
  type RealmState,
} from '../src/index.ts';
import { simulateRealm, type RealmSimulated } from './realm-sim.ts';

/**
 * Simulation der Partie mit Ausbau (docs/MATCH_RULES.md §11.9): je 1 000 Partien zu dritt
 * (Wendelmark) und zu zweit (Kernmark) mit Bots gemischter Stärke, Sitz 0 verpasst 15 % wie ein
 * Mensch. Nach jedem Schritt gelten die Invarianten, jede Partie endet in der geplanten Länge.
 * Dazu Bänder für die Spielbalance aus Partien gleich starker Bots; die genauen Messwerte liefert
 * `realm-measure.ts`.
 */

const MATCHES = 1000;
const BALANCE_MATCHES = 400;

interface Plan {
  readonly rules: RealmRules;
  /** Schätzfragen der Landnahme: freie Regionen nach Burgen und Dörfern, 2 + 1 Wahlen je Runde. */
  readonly landRounds: number;
}

const PLANS: readonly Plan[] = [
  // Wendelmark, 24 − 3 Burgen − 3 Dörfer = 18 freie Regionen: 6 Runden
  { rules: DEFAULT_REALM_RULES, landRounds: 6 },
  // Kernmark, 16 − 2 − 2 = 12 freie Regionen: 4 Runden
  { rules: matchRulesForSeats(DEFAULT_REALM_RULES, 2), landRounds: 4 },
];

/** Obergrenze der Dauer, wenn jeder Timer ganz ausläuft und jedes Duell bis zur Schätzfrage geht. */
function maxDurationMs({ rules, landRounds }: Plan): number {
  const t = rules.timers;
  const e = rules.economy.timers;
  const { seats } = rules;
  const free = matchMap(rules.map).regions.length - 2 * seats;
  const pick = t.pickMs + (t.pickShowMs ?? 0);
  const estimate = t.estimateMs + t.revealMs;
  const duel = t.pickMs + e.wheelMs + t.triviaMs + t.revealMs + estimate;
  return (
    (1 + landRounds) * estimate +
    (2 * seats + free) * pick +
    rules.campaign.rounds * (e.prepareMs + e.ordersRevealMs + seats * duel)
  );
}

/** Startfrage, Landnahme, je Duell Wissens- und Schätzfrage. */
function maxQuestions({ rules, landRounds }: Plan): number {
  return 1 + landRounds + 2 * rules.campaign.rounds * rules.seats;
}

/**
 * Prüft die Invarianten eines Zustands und wirft beim ersten Verstoß. Bewusst ohne `expect`, weil
 * sie nach jedem Schritt aller Partien laufen.
 */
function checkInvariants(state: RealmState): void {
  const { economy, values } = state.rules;
  const phase = realmPhase(state);
  const fail = (what: string) => {
    throw new Error(`Invariante verletzt (${state.step.kind}): ${what}`);
  };
  state.regions.forEach((r, id) => {
    if (r.owner !== null && (r.owner < 0 || r.owner >= state.seats.length))
      fail(`Besitzer von ${id}`);
    if (r.armies < 0 || r.armies > economy.armyCap) fail(`Armeen auf ${id}: ${r.armies}`);
    if (r.armies > 0 && r.owner === null) fail(`Armeen auf freiem Feld ${id}`);
    if (r.building !== 'CASTLE' && r.castleHits !== 0) fail(`Treffer ohne Burg auf ${id}`);
    if (r.castleHits >= state.rules.capital.lives) fail(`Burg auf ${id} ohne Leben`);
    const base = r.value - r.fortifications * values.defenseBonus;
    if (r.fortifications < 0 || (base !== values.region && base !== values.capital)) {
      fail(`Wert von ${id}: ${r.value} bei ${r.fortifications} Verteidigungen`);
    }
    if (r.startCastleOf !== null && r.building !== 'CASTLE') fail(`Startburg ${id} ohne Burg`);
    if ((phase === 'CAMPAIGN' || phase === 'FINISHED') && r.owner === null) fail(`${id} frei`);
  });
  state.seats.forEach((s, seat) => {
    if (s.bread < 0 || s.material < 0) fail(`Vorräte von Sitz ${seat}`);
    const castles = castlesOf(state, seat).length;
    if (castles > economy.maxCastles) fail(`${castles} Burgen bei Sitz ${seat}`);
    if (s.eliminatedInDuel !== null) {
      if (state.regions.some((r) => r.owner === seat)) fail(`Gefallener Sitz ${seat} besitzt Land`);
      if (s.bread + s.material !== 0) fail(`Gefallener Sitz ${seat} hat Vorräte`);
    } else if (phase !== 'SETUP' && castles === 0) {
      fail(`Sitz ${seat} ohne Burg`);
    }
  });
}

function count(events: readonly RealmEvent[], test: (e: RealmEvent) => boolean): number {
  return events.reduce((n, e) => n + (test(e) ? 1 : 0), 0);
}

for (const plan of PLANS) {
  const { seats } = plan.rules;
  const bound = maxDurationMs(plan);

  describe(`Partie mit Ausbau: ${MATCHES} Partien mit ${seats} Spielern`, () => {
    const runs: RealmSimulated[] = Array.from({ length: MATCHES }, (_, i) =>
      simulateRealm(plan.rules, i, {
        seat0Misses: 0.15,
        onStep: checkInvariants,
      }),
    );

    it('hält nach jedem Schritt die Invarianten', () => {
      // `onStep` hätte beim Aufbau geworfen; hier noch einmal für jeden Endstand
      for (const run of runs) expect(() => checkInvariants(run.state)).not.toThrow();
    });

    it('jede Partie endet regelgerecht und in der geplanten Länge', () => {
      for (const { state, events, durationMs } of runs) {
        expect(state.step.kind).toBe('FINISHED');
        expect(state.questions).toBeLessThanOrEqual(maxQuestions(plan));
        expect(state.duels).toBeLessThanOrEqual(plan.rules.campaign.rounds * seats);
        expect(durationMs.full).toBeLessThanOrEqual(bound);
        expect(count(events, (e) => e.kind === 'LAND_RANKED')).toBe(plan.landRounds);
        expect(count(events, (e) => e.kind === 'CASTLE_CHOSEN')).toBe(seats);
        expect(count(events, (e) => e.kind === 'VILLAGE_CHOSEN')).toBe(seats);
        const finished = events.at(-1);
        expect(finished).toEqual({
          kind: 'MATCH_FINISHED',
          reason: (state.step as { reason: string }).reason,
          standings: realmStandings(state),
        });
      }
    });

    it('die Punkte sind die Summe der Regionswerte, ein gefallenes Reich hat keine', () => {
      for (const { state } of runs) {
        const standings = realmStandings(state);
        const total = state.regions.reduce((sum, r) => sum + r.value, 0);
        expect(standings.reduce((sum, s) => sum + s.points, 0)).toBe(total);
        expect(standings.some((s) => s.place === 1)).toBe(true);
        for (const s of standings) if (s.eliminated) expect(s.points).toBe(0);
      }
    });

    it('jedes Reich bekommt Einkommen, deckt Befehle auf und baut', () => {
      const income = runs.reduce((n, r) => n + count(r.events, (e) => e.kind === 'INCOME'), 0);
      const built = runs.reduce(
        (n, r) =>
          n +
          r.events.reduce(
            (m, e) => m + (e.kind === 'ORDERS_REVEALED' ? e.summary.built.length : 0),
            0,
          ),
        0,
      );
      expect(income).toBeGreaterThanOrEqual(MATCHES * plan.rules.campaign.rounds * 0.95);
      expect(built).toBeGreaterThan(MATCHES * seats);
    });

    it('stärkere Bots gewinnen öfter', () => {
      const wins = { EASY: 0, MEDIUM: 0, HARD: 0 };
      const played = { EASY: 0, MEDIUM: 0, HARD: 0 };
      for (const run of runs) {
        for (const s of realmStandings(run.state)) {
          // Sitz 0 verpasst Fragen, er zählt nicht mit
          if (s.seat === 0) continue;
          const strength = run.strengths[s.seat] as MatchBotStrength;
          played[strength] += 1;
          if (s.place === 1) wins[strength] += 1;
        }
      }
      const rate = (k: MatchBotStrength) => wins[k] / played[k];
      expect(rate('HARD')).toBeGreaterThan(rate('MEDIUM'));
      expect(rate('MEDIUM')).toBeGreaterThan(rate('EASY'));
    });

    it('ist mit denselben Strömen bitgleich wiederholbar', () => {
      const again = simulateRealm(plan.rules, 17, { seat0Misses: 0.15 });
      expect(again.events).toEqual(runs[17]?.events);
      expect(again.state).toEqual(runs[17]?.state);
    });
  });

  describe(`Partie mit Ausbau: Spielbalance mit ${seats} gleich starken Spielern`, () => {
    const runs = Array.from({ length: BALANCE_MATCHES }, (_, i) =>
      simulateRealm(plan.rules, i, { strength: 'MEDIUM' }),
    );
    const players = BALANCE_MATCHES * seats;

    it('eine zweite Burg ist erreichbar, aber kein Selbstläufer', () => {
      const builders = runs.reduce(
        (n, r) =>
          n +
          new Set(
            r.events.flatMap((e) =>
              e.kind === 'ORDERS_REVEALED' && e.summary.built.some((b) => b.building === 'CASTLE')
                ? [e.seat]
                : [],
            ),
          ).size,
        0,
      );
      expect(builders / players).toBeGreaterThan(0.3);
      expect(builders / players).toBeLessThan(0.8);
    });

    it('ein Reich fällt selten, der Angreifer gewinnt weniger als die Hälfte der Duelle', () => {
      const falls = runs.filter((r) => r.events.some((e) => e.kind === 'KINGDOM_ELIMINATED'));
      expect(falls.length / BALANCE_MATCHES).toBeLessThan(0.05);
      let duels = 0;
      let attackerWins = 0;
      for (const r of runs) {
        for (const e of r.events) {
          if (e.kind !== 'DUEL_RESOLVED') continue;
          duels += 1;
          if (e.winner === 'ATTACKER') attackerWins += 1;
        }
      }
      expect(attackerWins / duels).toBeGreaterThan(0.35);
      expect(attackerWins / duels).toBeLessThan(0.55);
    });

    it('dauert typisch höchstens eine Viertelstunde (zu zweit gut elf Minuten)', () => {
      const mean = runs.reduce((s, r) => s + r.durationMs.typical, 0) / BALANCE_MATCHES / 60_000;
      expect(mean).toBeLessThanOrEqual(seats === 3 ? 15.5 : 11.5);
    });

    it('der erste Platz der Startfrage gewinnt zu zweit seltener als 60 %', () => {
      if (seats !== 2) return;
      let first = 0;
      for (const r of runs) {
        const winners = realmStandings(r.state).filter((s) => s.place === 1);
        for (const w of winners) {
          if (r.state.order.indexOf(w.seat) === 0) first += 1 / winners.length;
        }
      }
      expect(first / BALANCE_MATCHES).toBeLessThan(0.6);
    });
  });
}
