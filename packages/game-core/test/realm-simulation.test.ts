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
 * `realm-measure.ts`. Seit ADR-062 endet die Landnahme nach zwei Runden, die übrigen Felder bleiben
 * frei und lassen sich im Feldzug mit einer Wissensfrage angreifen (O-37).
 */

const MATCHES = 1000;
const BALANCE_MATCHES = 400;
const LEGACY_MATCHES = 200;

interface Plan {
  readonly label: string;
  readonly rules: RealmRules;
  readonly matches: number;
  /** Bänder der Spielbalance und der Stärke prüfen (nur für die geltenden Regeln). */
  readonly balance: boolean;
  /** Schätzfragen der Landnahme, je Runde 2 + 1 Wahlen. */
  readonly landRounds: number;
  /** Felder, die nach der Landnahme frei bleiben. */
  readonly freeAfterLandGrab: number;
}

const PLANS: readonly Plan[] = [
  // Wendelmark, 24 − 3 Burgen − 3 Dörfer = 18 freie Regionen, zwei Runden vergeben 6: 12 bleiben
  {
    label: '3 Spielern',
    rules: DEFAULT_REALM_RULES,
    matches: MATCHES,
    balance: true,
    landRounds: 2,
    freeAfterLandGrab: 12,
  },
  // Kernmark, 16 − 2 − 2 = 12 freie Regionen, zwei Runden vergeben 6: 6 bleiben
  {
    label: '2 Spielern',
    rules: matchRulesForSeats(DEFAULT_REALM_RULES, 2),
    matches: MATCHES,
    balance: true,
    landRounds: 2,
    freeAfterLandGrab: 6,
  },
  // Partien von vor ADR-062 ohne `landGrabRounds`: Die Landnahme läuft, bis alles vergeben ist
  {
    label: '3 Spielern nach den Regeln vor ADR-062',
    rules: withoutLandGrabLimit(DEFAULT_REALM_RULES),
    matches: LEGACY_MATCHES,
    balance: false,
    landRounds: 6,
    freeAfterLandGrab: 0,
  },
];

function withoutLandGrabLimit(rules: RealmRules): RealmRules {
  const economy = { ...rules.economy };
  delete economy.landGrabRounds;
  return { ...rules, economy };
}

/** Obergrenze der Dauer, wenn jeder Timer ganz ausläuft und jedes Duell bis zur Schätzfrage geht. */
function maxDurationMs({ rules, landRounds, freeAfterLandGrab }: Plan): number {
  const t = rules.timers;
  const e = rules.economy.timers;
  const { seats } = rules;
  const claimed = matchMap(rules.map).regions.length - 2 * seats - freeAfterLandGrab;
  const pick = t.pickMs + (t.pickShowMs ?? 0);
  const estimate = t.estimateMs + t.revealMs;
  const duel = t.pickMs + e.wheelMs + t.triviaMs + t.revealMs + estimate;
  return (
    (1 + landRounds) * estimate +
    (2 * seats + claimed) * pick +
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
    if (r.owner === null && (r.building !== 'NONE' || r.fortifications !== 0)) {
      fail(`Freies Feld ${id} mit Gebäude oder Verteidigung`);
    }
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

  describe(`Partie mit Ausbau: ${plan.matches} Partien mit ${plan.label}`, () => {
    const runs: RealmSimulated[] = Array.from({ length: plan.matches }, (_, i) =>
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
        // Nach der Landnahme bleibt frei, was die Runden nicht vergeben haben; im Feldzug wird ein
        // freies Feld nur mit einer richtigen Antwort genommen und nie wieder frei
        const landGrab = count(events, (e) => e.kind === 'REGION_CLAIMED');
        expect(landGrab).toBe(state.regions.length - 2 * seats - plan.freeAfterLandGrab);
        const taken = count(events, (e) => e.kind === 'DUEL_RESOLVED' && e.effect === 'CLAIMED');
        expect(state.regions.filter((r) => r.owner === null).length).toBe(
          plan.freeAfterLandGrab - taken,
        );
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

    it('die Punkte sind die Summe der Werte aller vergebenen Felder, ein gefallenes Reich hat keine', () => {
      for (const { state } of runs) {
        const standings = realmStandings(state);
        // Freie Felder zählen für niemanden
        const total = state.regions.reduce((sum, r) => sum + (r.owner === null ? 0 : r.value), 0);
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
      expect(income).toBeGreaterThanOrEqual(plan.matches * plan.rules.campaign.rounds * 0.95);
      expect(built).toBeGreaterThan(plan.matches * seats);
    });

    it.runIf(plan.balance)('stärkere Bots gewinnen öfter', () => {
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

  describe.runIf(plan.balance)(
    `Partie mit Ausbau: Spielbalance mit ${seats} gleich starken Spielern`,
    () => {
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
            // Nur Duelle zweier Reiche; Angriffe auf freie Felder zählt der nächste Test
            if (e.kind !== 'DUEL_RESOLVED' || e.defender === null) continue;
            duels += 1;
            if (e.winner === 'ATTACKER') attackerWins += 1;
          }
        }
        expect(attackerWins / duels).toBeGreaterThan(0.35);
        expect(attackerWins / duels).toBeLessThan(0.55);
      });

      it('freie Felder werden im Feldzug angegriffen und meist genommen, ein Teil bleibt frei', () => {
        let claims = 0;
        let taken = 0;
        let freeLeft = 0;
        for (const r of runs) {
          freeLeft += r.state.regions.filter((x) => x.owner === null).length;
          for (const e of r.events) {
            if (e.kind !== 'DUEL_RESOLVED' || e.defender !== null) continue;
            claims += 1;
            if (e.effect === 'CLAIMED') taken += 1;
          }
        }
        // Mindestens ein Drittel der Angriffe gilt freien Feldern, aber nicht alle
        const attacks = BALANCE_MATCHES * plan.rules.campaign.rounds * seats;
        expect(claims / attacks).toBeGreaterThan(0.33);
        expect(claims / attacks).toBeLessThan(0.75);
        expect(taken / claims).toBeGreaterThan(0.6);
        expect(taken / claims).toBeLessThan(0.85);
        expect(freeLeft / BALANCE_MATCHES).toBeGreaterThan(1);
      });

      it('dauert typisch gut zehn Minuten (zu zweit knapp neun)', () => {
        const mean = runs.reduce((s, r) => s + r.durationMs.typical, 0) / BALANCE_MATCHES / 60_000;
        expect(mean).toBeLessThanOrEqual(seats === 3 ? 12 : 9.5);
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
    },
  );
}
