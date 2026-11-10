import { describe, expect, it } from 'vitest';
import {
  QUESTION_EXCLUSION_WINDOWS_DAYS,
  createRng,
  difficultyWeights,
  parseDecimal,
  performanceFromSteps,
  pickQuestion,
  targetDifficulty,
  type QuestionCandidate,
} from '../src/index.ts';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

function rng(byte = 3) {
  return createRng(new Uint8Array(16).fill(byte));
}

function candidate(n: number, overrides: Partial<QuestionCandidate> = {}): QuestionCandidate {
  return {
    versionId: `v${String(n).padStart(3, '0')}`,
    questionId: `q${n}`,
    category: n % 2 === 0 ? 'SCIENCE' : 'HISTORY',
    difficulty: (n % 5) + 1,
    lastSeenAt: null,
    ...overrides,
  };
}

describe('Fragenauswahl (QUIZ_ENGINE §5)', () => {
  it('leitet die Zielschwierigkeit aus der Regionsstufe ab', () => {
    expect(difficultyWeights(0).EASY).toBeGreaterThan(difficultyWeights(0).HARD);
    expect(difficultyWeights(10).HARD).toBeGreaterThan(difficultyWeights(10).EASY);
    expect(difficultyWeights(4)).toEqual({ EASY: 0.3, MEDIUM: 0.4, HARD: 0.3 });
    expect(difficultyWeights(9, true)).toEqual({ EASY: 1, MEDIUM: 0, HARD: 0 });
    expect(targetDifficulty(difficultyWeights(0))).toBeLessThan(0);
    expect(targetDifficulty(difficultyWeights(4))).toBe(0);
    expect(targetDifficulty(difficultyWeights(10))).toBeGreaterThan(0);
    expect(() => difficultyWeights(11)).toThrow(RangeError);
    expect(() => targetDifficulty({ EASY: 0, MEDIUM: 0, HARD: 0 })).toThrow(RangeError);
  });

  it('ist deterministisch und unabhängig von der Reihenfolge der Kandidaten', () => {
    const pool = Array.from({ length: 20 }, (_, i) => candidate(i));
    const options = { now: NOW, weights: difficultyWeights(5), recentCategories: [] };
    const a = pickQuestion(pool, options, rng());
    expect(pickQuestion([...pool].reverse(), options, rng())).toEqual(a);
    const picks = new Set(
      Array.from(
        { length: 30 },
        (_, i) => pickQuestion(pool, options, rng(i + 1))?.candidate.versionId,
      ),
    );
    expect(picks.size).toBeGreaterThan(3);
    expect(pickQuestion([], options, rng())).toBeNull();
  });

  it('folgt den Schwierigkeitsgewichten und schließt Klassen mit Gewicht 0 aus', () => {
    const pool = Array.from({ length: 25 }, (_, i) => candidate(i));
    const tutorial = { now: NOW, weights: difficultyWeights(0, true), recentCategories: [] };
    for (let i = 1; i <= 40; i++) {
      const pick = pickQuestion(pool, tutorial, rng(i));
      expect(pick?.candidate.difficulty).toBeLessThanOrEqual(2);
    }
    // keine leichte Frage vorhanden: trotzdem eine Frage
    const hardOnly = pool.filter((c) => c.difficulty >= 4);
    expect(pickQuestion(hardOnly, tutorial, rng())?.candidate.difficulty).toBeGreaterThanOrEqual(4);
  });

  it('mischt die Klassen nach ihren Gewichten, unabhängig von ihrer Größe', () => {
    // 1 leichte und 4 mittlere Fragen bei Stufe 0 (leicht 0,7 · mittel 0,25 · schwer 0,05)
    const pool = [
      candidate(1, { difficulty: 1 }),
      ...[2, 3, 4, 5].map((n) => candidate(n, { difficulty: 3 })),
    ];
    const options = { now: NOW, weights: difficultyWeights(0), recentCategories: [] };
    const runs = 2000;
    let easy = 0;
    for (let i = 0; i < runs; i++) {
      const seed = new Uint8Array(16);
      new DataView(seed.buffer).setUint32(0, i + 1);
      const pick = pickQuestion(pool, options, createRng(seed));
      if (pick?.candidate.difficulty === 1) easy++;
    }
    // ohne schwere Fragen: 0,7 / (0,7 + 0,25) ≈ 74 %
    expect(easy / runs).toBeGreaterThan(0.69);
    expect(easy / runs).toBeLessThan(0.79);
  });

  it('bleibt im Tutorial bei leichten Fragen, auch wenn sie schon gesehen wurden', () => {
    const tutorial = { now: NOW, weights: difficultyWeights(0, true), recentCategories: [] };
    const seen = (days: number) => NOW - days * DAY;
    const pool = [
      candidate(1, { difficulty: 1, lastSeenAt: seen(40) }),
      candidate(2, { difficulty: 4 }),
      candidate(3, { difficulty: 3 }),
    ];
    // die leichte liegt nur außerhalb des 30-Tage-Fensters: sie, nicht die ungesehenen schweren
    expect(pickQuestion(pool, tutorial, rng())).toEqual({
      candidate: pool[0],
      fallback: 1,
      poolSize: 1,
    });
    // auch der letzte Rückfall bleibt bei den leichten Fragen
    const recent = [
      candidate(4, { difficulty: 2, lastSeenAt: seen(1) }),
      candidate(5, { difficulty: 1, lastSeenAt: seen(2) }),
      candidate(6, { difficulty: 5 }),
    ];
    expect(pickQuestion(recent, tutorial, rng())).toEqual({
      candidate: recent[1],
      fallback: QUESTION_EXCLUSION_WINDOWS_DAYS.length,
      poolSize: 2,
    });
  });

  it('wertet zuletzt gestellte Kategorien ab', () => {
    const pool = Array.from({ length: 20 }, (_, i) => candidate(i, { difficulty: 3 }));
    const count = (recent: string[]) => {
      let science = 0;
      for (let i = 1; i <= 400; i++) {
        const pick = pickQuestion(
          pool,
          { now: NOW, weights: difficultyWeights(5), recentCategories: recent },
          rng(i),
        );
        if (pick?.candidate.category === 'SCIENCE') science++;
      }
      return science;
    };
    expect(count(['SCIENCE'])).toBeLessThan(count([]) * 0.6);
  });

  it('schließt gesehene Fragen aus und verkleinert das Fenster schrittweise', () => {
    const options = { now: NOW, weights: difficultyWeights(5), recentCategories: [] };
    const seen = (days: number) => NOW - days * DAY;
    const pool = [
      candidate(1, { lastSeenAt: seen(10) }),
      candidate(2, { lastSeenAt: seen(40) }),
      candidate(3, { lastSeenAt: seen(1) }),
    ];
    // 90 Tage: alles gesehen → 30 Tage: nur Nr. 2 frei
    expect(pickQuestion(pool, options, rng())).toEqual({
      candidate: pool[1],
      fallback: 1,
      poolSize: 1,
    });
    const fresh = pickQuestion([...pool, candidate(4, { lastSeenAt: seen(100) })], options, rng());
    expect(fresh?.candidate.versionId).toBe('v004');
    expect(fresh).toMatchObject({ fallback: 0, poolSize: 1 });
    // alles in den letzten 7 Tagen gesehen → die am längsten nicht gesehene
    const recent = [candidate(5, { lastSeenAt: seen(2) }), candidate(6, { lastSeenAt: seen(3) })];
    expect(pickQuestion(recent, options, rng())).toEqual({
      candidate: recent[1],
      fallback: QUESTION_EXCLUSION_WINDOWS_DAYS.length,
      poolSize: 2,
    });
  });
});

describe('Leistung aus gespeicherten Antworten', () => {
  it('zählt verpasste Schritte als falsch bzw. unendlich', () => {
    const distance = parseDecimal('4');
    expect(performanceFromSteps({ correct: true }, { distance, effectiveMs: 5000 }, true)).toEqual({
      triviaCorrect: true,
      estimateDistance: distance,
      estimateEffectiveMs: 5000,
      answeredAll: true,
    });
    expect(performanceFromSteps(null, null, true)).toEqual({
      triviaCorrect: false,
      estimateDistance: null,
      estimateEffectiveMs: null,
      answeredAll: false,
    });
    expect(performanceFromSteps({ correct: false }, null, true).answeredAll).toBe(false);
  });

  it('verlangt die Schätzfrage nur, wenn sie gestellt wurde (Tiebreaker, GAME_RULES §5.5)', () => {
    expect(performanceFromSteps({ correct: false }, null, false)).toMatchObject({
      triviaCorrect: false,
      estimateDistance: null,
      answeredAll: true,
    });
    expect(performanceFromSteps(null, null, false).answeredAll).toBe(false);
  });
});
