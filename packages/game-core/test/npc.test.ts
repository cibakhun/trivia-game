import { describe, expect, it } from 'vitest';
import {
  compareDecimal,
  createRng,
  deriveSeed,
  difficultyClass,
  difficultyToB,
  estimateSpread,
  formatDecimal,
  garrisonProfile,
  generateNpcAnswer,
  NPC_BASE_PROFILES,
  parseDecimal,
  triviaProbability,
  type NpcQuestionSpec,
} from '../src/index.ts';

const SECRET = new Uint8Array(32).fill(0x11);

const QUESTION: NpcQuestionSpec = {
  triviaB: 0,
  wrongOptionCount: 3,
  estimate: {
    answerValue: '1386',
    answerPrecision: 0,
    inputMin: '1000',
    inputMax: '2026',
    scaleType: 'LINEAR',
    scale: 50,
  },
  estimateTimeLimitMs: 30_000,
};

function seededRng(i: number) {
  const seed = new Uint8Array(16);
  new DataView(seed.buffer).setUint32(0, i);
  new DataView(seed.buffer).setUint32(8, 0x9e3779b9);
  return createRng(seed);
}

describe('Trivia-Wahrscheinlichkeit (NPC_SYSTEM §3.1)', () => {
  it('reproduziert die Tabelle (Brief §6.3) auf ganze Prozent', () => {
    const table: [number, [number, number, number]][] = [
      [-0.4, [69, 40, 17]],
      [0.6, [86, 65, 35]],
      [1.7, [95, 85, 62]],
    ];
    for (const [theta, percents] of table) {
      const actual = [-1.2, 0, 1.2].map((b) => Math.round(triviaProbability(theta, b) * 100));
      expect(actual).toEqual(percents);
    }
  });

  it('empirische Trefferquote über 100 000 Ziehungen innerhalb ±1 % von σ(θ − b)', () => {
    for (const [theta, b] of [
      [-0.4, -1.2],
      [0.6, 0],
      [1.7, 1.2],
      [-2.5, -1.2],
    ] as const) {
      const rng = seededRng(Math.round((theta + 3) * 1000 + b * 10));
      let correct = 0;
      const n = 100_000;
      for (let i = 0; i < n; i++) {
        if (
          generateNpcAnswer(rng, { ...NPC_BASE_PROFILES.LIGHT, theta }, { ...QUESTION, triviaB: b })
            .triviaCorrect
        ) {
          correct++;
        }
      }
      expect(Math.abs(correct / n - triviaProbability(theta, b))).toBeLessThan(0.01);
    }
  });
});

describe('Schwierigkeit', () => {
  it.each([
    [1, 'EASY', -1.2],
    [2, 'EASY', -1.2],
    [3, 'MEDIUM', 0],
    [4, 'HARD', 1.2],
    [5, 'HARD', 1.2],
  ])('%i → %s (b = %d)', (d, cls, b) => {
    expect(difficultyClass(d)).toBe(cls);
    expect(difficultyToB(d)).toBe(b);
  });

  it.each([0, 6, 2.5])('lehnt %d ab', (d) => {
    expect(() => difficultyToB(d)).toThrow(RangeError);
  });
});

describe('Profile', () => {
  it('Garnison: θ von −1,4 (Stufe 0) bis +0,5 (Stufe 10)', () => {
    expect(garrisonProfile(0).theta).toBeCloseTo(-1.4, 10);
    expect(garrisonProfile(10).theta).toBeCloseTo(0.5, 10);
    expect(() => garrisonProfile(11)).toThrow(RangeError);
  });

  it('Streuung s(θ): leicht 1,00 · mittel 0,47 · schwer 0,21 · Garnison −1,4 gekappt auf 2,0', () => {
    expect(estimateSpread(-0.4)).toBeCloseTo(1.0, 2);
    expect(estimateSpread(0.6)).toBeCloseTo(0.47, 2);
    expect(estimateSpread(1.7)).toBeCloseTo(0.21, 2);
    expect(estimateSpread(-1.4)).toBe(2.0);
    expect(estimateSpread(10)).toBe(0.1);
  });
});

describe('generateNpcAnswer', () => {
  it('gleiche Eingaben ⇒ gleiche Antworten (Strom npc-answer:{challenge_id})', async () => {
    const seed = await deriveSeed(SECRET, 'npc-answer', 'challenge-1');
    const a = generateNpcAnswer(createRng(seed), NPC_BASE_PROFILES.MEDIUM, QUESTION);
    const b = generateNpcAnswer(createRng(seed), NPC_BASE_PROFILES.MEDIUM, QUESTION);
    expect(a).toEqual(b);
  });

  it('verbraucht genau fünf Werte in fester Reihenfolge (Trivia, Schätzung, Zeit)', () => {
    const a = seededRng(5);
    generateNpcAnswer(a, NPC_BASE_PROFILES.HEAVY, QUESTION);
    const b = seededRng(5);
    for (let i = 0; i < 5; i++) b.nextUint32();
    expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('Schätzung: gerundet, im Eingabebereich, Streuung ≈ s(θ) · scale', () => {
    const rng = seededRng(77);
    const n = 50_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const answer = generateNpcAnswer(rng, NPC_BASE_PROFILES.LIGHT, QUESTION);
      expect(answer.estimate.scale).toBeLessThanOrEqual(0);
      expect(compareDecimal(answer.estimate, parseDecimal('1000'))).toBeGreaterThanOrEqual(0);
      expect(compareDecimal(answer.estimate, parseDecimal('2026'))).toBeLessThanOrEqual(0);
      const v = Number(formatDecimal(answer.estimate));
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean - 1386)).toBeLessThan(1);
    expect(Math.abs(sd - 50)).toBeLessThan(1.5); // s(−0,4) = 1 · scale 50 (Rundung erhöht minimal)
  });

  it('Schätzung wird auf [input_min, input_max] begrenzt', () => {
    const tight = {
      ...QUESTION,
      estimate: { ...QUESTION.estimate, inputMin: '1386', inputMax: '1386' },
    };
    const answer = generateNpcAnswer(seededRng(3), garrisonProfile(0), tight);
    expect(formatDecimal(answer.estimate)).toBe('1386');
  });

  it('LOG-Skala: Median ≈ wahrer Wert, Nachkommastellen nach Präzision', () => {
    const logQ: NpcQuestionSpec = {
      ...QUESTION,
      estimate: {
        answerValue: '2850.5',
        answerPrecision: 1,
        inputMin: '0',
        inputMax: '1000000',
        scaleType: 'LOG',
        scale: 0.5,
      },
    };
    const rng = seededRng(11);
    const values: number[] = [];
    for (let i = 0; i < 20_001; i++) {
      const a = generateNpcAnswer(rng, NPC_BASE_PROFILES.MEDIUM, logQ);
      expect(a.estimate.scale).toBeLessThanOrEqual(1);
      values.push(Number(formatDecimal(a.estimate)));
    }
    values.sort((x, y) => x - y);
    expect(Math.abs(values[10_000]! / 2850.5 - 1)).toBeLessThan(0.02);
  });

  it('Antwortzeit: Median je Archetyp, höchstens 1 s unter dem Zeitlimit', () => {
    for (const profile of [
      NPC_BASE_PROFILES.GARRISON_START,
      NPC_BASE_PROFILES.MEDIUM,
      NPC_BASE_PROFILES.HEAVY,
    ]) {
      const rng = seededRng(profile.estimateMedianMs);
      const times: number[] = [];
      for (let i = 0; i < 10_001; i++) {
        const { estimateMs } = generateNpcAnswer(rng, profile, QUESTION);
        expect(Number.isInteger(estimateMs)).toBe(true);
        expect(estimateMs).toBeGreaterThanOrEqual(1_000);
        expect(estimateMs).toBeLessThanOrEqual(29_000);
        times.push(estimateMs);
      }
      times.sort((x, y) => x - y);
      expect(Math.abs(times[5_000]! / profile.estimateMedianMs - 1)).toBeLessThan(0.03);
    }
  });

  it('falsche Option nur bei falscher Antwort, gleichverteilt über die falschen Optionen', () => {
    const rng = seededRng(99);
    const counts = [0, 0, 0];
    let wrong = 0;
    for (let i = 0; i < 30_000; i++) {
      const a = generateNpcAnswer(rng, NPC_BASE_PROFILES.LIGHT, QUESTION);
      if (a.triviaCorrect) {
        expect(a.wrongOptionIndex).toBeNull();
      } else {
        wrong++;
        counts[a.wrongOptionIndex!]!++;
      }
    }
    for (const c of counts) expect(Math.abs(c / wrong - 1 / 3)).toBeLessThan(0.02);
  });

  it('Protokoll enthält θ, b, p, s(θ) und die Ziehungen', () => {
    const a = generateNpcAnswer(seededRng(1), NPC_BASE_PROFILES.MEDIUM, {
      ...QUESTION,
      triviaB: 1.2,
    });
    expect(a.audit.theta).toBe(0.6);
    expect(a.audit.b).toBe(1.2);
    expect(a.audit.pCorrect).toBeCloseTo(triviaProbability(0.6, 1.2), 12);
    expect(a.audit.spread).toBeCloseTo(estimateSpread(0.6), 12);
    expect(Object.keys(a.audit.draws)).toEqual(['trivia', 'estimate', 'time']);
  });

  it('lehnt ungültige Fragenparameter ab', () => {
    expect(() =>
      generateNpcAnswer(seededRng(1), NPC_BASE_PROFILES.LIGHT, {
        ...QUESTION,
        estimate: { ...QUESTION.estimate, scaleType: 'LOG', answerValue: '0' },
      }),
    ).toThrow(RangeError);
    expect(() =>
      generateNpcAnswer(seededRng(1), NPC_BASE_PROFILES.LIGHT, {
        ...QUESTION,
        wrongOptionCount: 0,
      }),
    ).toThrow(RangeError);
  });
});
