import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  defensePoints,
  NO_DEFENSE,
  parseDecimal,
  resolveDuel,
  scoreEstimate,
  siegeEndState,
  type Defense,
  type Outcome,
  type Performance,
} from '../src/index.ts';

/** Schätzfrage der Beispiele in QUIZ_ENGINE §8.1: Lösung 1386, ganzzahlig. */
const SPEC = { answerValue: '1386', answerPrecision: 0, inputMin: '0', inputMax: '3000' };
const ETERNAL_POINTS = { forDefending: 5, bonusCorrect: 5 };

function perf(triviaCorrect: boolean, estimate: string | null, ms: number | null): Performance {
  if (estimate === null) {
    return {
      triviaCorrect,
      estimateDistance: null,
      estimateEffectiveMs: null,
      answeredBoth: false,
    };
  }
  const score = scoreEstimate(estimate, SPEC);
  if (!score.ok) throw new Error('Testeingabe außerhalb des Bereichs');
  return {
    triviaCorrect,
    estimateDistance: score.distance,
    estimateEffectiveMs: ms,
    answeredBoth: true,
  };
}

describe('resolveDuel – Tabelle QUIZ_ENGINE §8.1 vollständig', () => {
  const cases: [number, Performance, Defense, Outcome, number][] = [
    [
      1,
      perf(true, '1390', 6100),
      perf(false, '1300', 8000),
      { winner: 'ATTACKER', reason: 'TRIVIA' },
      5,
    ],
    [
      2,
      perf(true, '1390', 9000),
      perf(true, '1400', 3000),
      { winner: 'ATTACKER', reason: 'ESTIMATE' },
      10,
    ],
    [
      3,
      perf(true, '1386', 5200),
      perf(true, '1386', 6800),
      { winner: 'ATTACKER', reason: 'SPEED' },
      10,
    ],
    [
      4,
      perf(true, '1382', 7000),
      perf(true, '1390', 4000),
      { winner: 'DEFENDER', reason: 'SPEED' },
      10,
    ],
    [
      5,
      perf(false, '1386', 5000),
      perf(true, '1500', 9000),
      { winner: 'DEFENDER', reason: 'ATTACKER_GATE' },
      10,
    ],
    [6, perf(true, '1386', 5000), NO_DEFENSE, { winner: 'ATTACKER', reason: 'TIMEOUT' }, 0],
    [
      7,
      perf(true, null, null),
      perf(true, '2000', 9000),
      { winner: 'DEFENDER', reason: 'ESTIMATE' },
      10,
    ],
    [
      8,
      perf(true, '1386', 5000),
      perf(true, '1386', 5000),
      { winner: 'DEFENDER', reason: 'FULL_TIE' },
      10,
    ],
    [9, perf(false, '1386', 5000), NO_DEFENSE, { winner: 'NONE', reason: 'ATTACKER_GATE' }, 0],
    [
      10,
      perf(false, '1386', 5000),
      perf(false, '1386', 5000),
      { winner: 'DEFENDER', reason: 'ATTACKER_GATE' },
      5,
    ],
    [
      11,
      perf(false, '1386', 5000),
      perf(true, null, null),
      { winner: 'DEFENDER', reason: 'ATTACKER_GATE' },
      0,
    ],
  ];

  it.each(cases)('Fall %i', (_n, att, def, outcome, points) => {
    expect(resolveDuel(att, def)).toEqual(outcome);
    expect(defensePoints(def, ETERNAL_POINTS)).toBe(points);
  });

  it('Fall 2 und 4 haben die dokumentierten Abstände', () => {
    expect(perf(true, '1390', 0).estimateDistance).toEqual(parseDecimal('4'));
    expect(perf(true, '1400', 0).estimateDistance).toEqual(parseDecimal('14'));
    expect(perf(true, '1382', 0).estimateDistance).toEqual(parseDecimal('4'));
  });
});

const performance = fc.record({
  triviaCorrect: fc.boolean(),
  estimateDistance: fc.option(
    fc.record({
      units: fc.bigInt({ min: 0n, max: 10_000n }),
      scale: fc.integer({ min: 0, max: 3 }),
    }),
  ),
  estimateEffectiveMs: fc.option(fc.integer({ min: 0, max: 30_500 })),
  answeredBoth: fc.boolean(),
});
const defense = fc.oneof(performance, fc.constant(NO_DEFENSE));

describe('resolveDuel – Eigenschaften', () => {
  it('liefert für jede Eingabe ein definiertes, gültiges Ergebnis', () => {
    const valid = new Set([
      'ATTACKER/TIMEOUT',
      'ATTACKER/TRIVIA',
      'ATTACKER/ESTIMATE',
      'ATTACKER/SPEED',
      'DEFENDER/ATTACKER_GATE',
      'DEFENDER/ESTIMATE',
      'DEFENDER/SPEED',
      'DEFENDER/FULL_TIE',
      'NONE/ATTACKER_GATE',
    ]);
    fc.assert(
      fc.property(performance, defense, (att, def) => {
        const o = resolveDuel(att, def);
        expect(valid.has(`${o.winner}/${o.reason}`)).toBe(true);
        expect([
          'ATTACKER_WON_BY_TIMEOUT',
          'ATTACKER_WON',
          'DEFENDER_WON',
          'ATTACK_FAILED',
        ]).toContain(siegeEndState(o));
      }),
    );
  });

  it('verdecktes Gate: Angreifer falsch ⇒ nie ein Angreifersieg', () => {
    fc.assert(
      fc.property(performance, defense, (att, def) => {
        expect(resolveDuel({ ...att, triviaCorrect: false }, def).winner).not.toBe('ATTACKER');
      }),
    );
  });

  it('kein Sieger nur ohne Verteidigung bei falschem Angreifer', () => {
    fc.assert(
      fc.property(performance, defense, (att, def) => {
        const none = resolveDuel(att, def).winner === 'NONE';
        expect(none).toBe(!att.triviaCorrect && def === NO_DEFENSE);
      }),
    );
  });

  it('Rollentausch: Bei gleicher Leistung gewinnt der Verteidiger, sonst entscheidet die Leistung', () => {
    fc.assert(
      fc.property(performance, performance, (a, b) => {
        const x = { ...a, triviaCorrect: true };
        const y = { ...b, triviaCorrect: true };
        const forward = resolveDuel(x, y);
        const backward = resolveDuel(y, x);
        if (forward.reason === 'FULL_TIE') {
          expect(backward).toEqual({ winner: 'DEFENDER', reason: 'FULL_TIE' });
        } else {
          expect(backward.reason).toBe(forward.reason);
          expect(backward.winner).not.toBe(forward.winner);
        }
        expect(resolveDuel(x, x)).toEqual({ winner: 'DEFENDER', reason: 'FULL_TIE' });
      }),
    );
  });
});

describe('defensePoints', () => {
  it.each([
    [true, true, 10],
    [true, false, 5],
    [false, true, 0],
    [false, false, 0],
  ])('beide beantwortet=%s, Trivia richtig=%s → %i', (answeredBoth, triviaCorrect, points) => {
    const def: Performance = {
      triviaCorrect,
      estimateDistance: null,
      estimateEffectiveMs: null,
      answeredBoth,
    };
    expect(defensePoints(def, ETERNAL_POINTS)).toBe(points);
    expect(defensePoints(def, { forDefending: 2, bonusCorrect: 3 })).toBe(
      points === 10 ? 5 : points === 5 ? 2 : 0,
    );
  });

  it('keine Verteidigung ⇒ 0', () => {
    expect(defensePoints(NO_DEFENSE, ETERNAL_POINTS)).toBe(0);
  });

  it('hängt nie vom Ausgang oder von der Angreiferleistung ab', () => {
    // defensePoints kennt den Angreifer nicht (Signatur); geprüft wird, dass dieselbe Verteidigung
    // bei jedem Angreifer und damit bei jedem Ausgang dieselben Punkte ergibt.
    fc.assert(
      fc.property(
        fc.array(performance, { minLength: 2, maxLength: 5 }),
        defense,
        (attackers, def) => {
          const expected = def === NO_DEFENSE || !def.answeredBoth ? 0 : def.triviaCorrect ? 10 : 5;
          for (const att of attackers) {
            expect(resolveDuel(att, def).winner).toBeDefined(); // der Ausgang variiert mit dem Angreifer …
            expect(defensePoints(def, ETERNAL_POINTS)).toBe(expected); // … die Punkte nicht
          }
        },
      ),
    );
  });
});

describe('siegeEndState', () => {
  it.each<[Outcome, string]>([
    [{ winner: 'ATTACKER', reason: 'TIMEOUT' }, 'ATTACKER_WON_BY_TIMEOUT'],
    [{ winner: 'ATTACKER', reason: 'TRIVIA' }, 'ATTACKER_WON'],
    [{ winner: 'ATTACKER', reason: 'ESTIMATE' }, 'ATTACKER_WON'],
    [{ winner: 'ATTACKER', reason: 'SPEED' }, 'ATTACKER_WON'],
    [{ winner: 'DEFENDER', reason: 'ATTACKER_GATE' }, 'DEFENDER_WON'],
    [{ winner: 'DEFENDER', reason: 'FULL_TIE' }, 'DEFENDER_WON'],
    [{ winner: 'NONE', reason: 'ATTACKER_GATE' }, 'ATTACK_FAILED'],
  ])('%j → %s', (outcome, state) => {
    expect(siegeEndState(outcome)).toBe(state);
  });
});
