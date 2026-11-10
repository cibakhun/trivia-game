import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDecimal,
  compareDecimal,
  decimalFromNumber,
  formatDecimal,
  parseDecimal,
  roundHalfUp,
  scoreEstimate,
  scoreTrivia,
} from '../src/index.ts';

const d = parseDecimal;

describe('Decimal', () => {
  it('0,1 + 0,2 = 0,3 exakt (kein Float)', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(compareDecimal(addDecimal(d('0.1'), d('0.2')), d('0.3'))).toBe(0);
    expect(formatDecimal(addDecimal(d('0.1'), d('0.2')))).toBe('0.3');
  });

  it.each([
    ['2.5', 0, '3'],
    ['-2.5', 0, '-3'],
    ['2.4999', 0, '2'],
    ['-2.4999', 0, '-2'],
    ['1.005', 2, '1.01'],
    ['-1.005', 2, '-1.01'],
    ['0.5', 0, '1'],
    ['-0.5', 0, '-1'],
    ['-0.4', 0, '0'],
    ['1386', 0, '1386'],
    ['12.345', 1, '12.3'],
    ['12.35', 1, '12.4'],
    ['9.995', 2, '10'],
  ])('roundHalfUp(%s, %i) = %s', (value, precision, expected) => {
    expect(formatDecimal(roundHalfUp(d(value), precision))).toBe(expected);
  });

  it('Rundung ist punktsymmetrisch (Hälfte von null weg)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 6 }),
        (units, scale, p) => {
          const x = { units, scale };
          const neg = { units: -units, scale };
          expect(formatDecimal(roundHalfUp(neg, p))).toBe(
            formatDecimal({ units: -roundHalfUp(x, p).units, scale: roundHalfUp(x, p).scale }),
          );
        },
      ),
    );
  });

  it('formatDecimal ∘ parseDecimal ist die kanonische Form', () => {
    expect(formatDecimal(d('007.500'))).toBe('7.5');
    expect(formatDecimal(d('-0.000'))).toBe('0');
    expect(formatDecimal(d('-12.50'))).toBe('-12.5');
  });

  it.each(['', '1,5', '1e3', '+1', '.5', '1.', ' 1'])('parseDecimal lehnt %j ab', (text) => {
    expect(() => parseDecimal(text)).toThrow(RangeError);
  });

  it('decimalFromNumber rundet den exakten Binärwert mit „Hälfte von null weg“', () => {
    expect(formatDecimal(decimalFromNumber(2.5, 0))).toBe('3');
    expect(formatDecimal(decimalFromNumber(-2.5, 0))).toBe('-3');
    expect(formatDecimal(decimalFromNumber(1386.4999, 0))).toBe('1386');
    // 1,005 ist binär 1,00499999999999989… und wird deshalb abgerundet
    expect(formatDecimal(decimalFromNumber(1.005, 2))).toBe('1');
    expect(formatDecimal(decimalFromNumber(-0.4, 0))).toBe('0');
    expect(() => decimalFromNumber(Number.NaN, 0)).toThrow(RangeError);
    expect(() => decimalFromNumber(Number.POSITIVE_INFINITY, 0)).toThrow(RangeError);
    expect(formatDecimal(decimalFromNumber(1e21, 0))).toBe('1000000000000000000000');
    expect(formatDecimal(decimalFromNumber(-2e22, 2))).toBe('-20000000000000000000000');
  });
});

describe('scoreEstimate', () => {
  const spec = { answerValue: '1386', answerPrecision: 0, inputMin: '0', inputMax: '3000' };

  it('rundet die Eingabe auf die Präzision, bevor der Abstand gebildet wird', () => {
    const r = scoreEstimate('1385.5', spec);
    expect(r.ok && formatDecimal(r.rounded)).toBe('1386');
    expect(r.ok && formatDecimal(r.distance)).toBe('0');
    const s = scoreEstimate('1385.4999', spec);
    expect(s.ok && formatDecimal(s.distance)).toBe('1');
  });

  it('rechnet mit Nachkommastellen exakt', () => {
    const r = scoreEstimate('8848.86', {
      answerValue: '8848.86',
      answerPrecision: 2,
      inputMin: '0',
      inputMax: '10000',
    });
    expect(r.ok && formatDecimal(r.distance)).toBe('0');
    const s = scoreEstimate('-2.5', {
      answerValue: '0',
      answerPrecision: 0,
      inputMin: '-10',
      inputMax: '10',
    });
    expect(s.ok && formatDecimal(s.distance)).toBe('3');
  });

  it('weist Eingaben außerhalb von [input_min, input_max] ab (Grenzen inklusive)', () => {
    expect(scoreEstimate('3000.0001', spec)).toEqual({ ok: false, error: 'OUT_OF_RANGE' });
    expect(scoreEstimate('-1', spec)).toEqual({ ok: false, error: 'OUT_OF_RANGE' });
    expect(scoreEstimate('3000', spec).ok).toBe(true);
    expect(scoreEstimate('0', spec).ok).toBe(true);
  });
});

describe('scoreTrivia', () => {
  it('bewertet über option_key, unabhängig von Reihenfolge und Token', () => {
    const p1 = new Map([
      ['t1', 'b'],
      ['t2', 'a'],
      ['t3', 'd'],
      ['t4', 'c'],
    ]);
    const p2 = new Map([
      ['x9', 'a'],
      ['x8', 'b'],
      ['x7', 'c'],
      ['x6', 'd'],
    ]);
    expect(scoreTrivia(p1, 't2', 'a')).toEqual({ ok: true, optionKey: 'a', correct: true });
    expect(scoreTrivia(p2, 'x9', 'a')).toEqual({ ok: true, optionKey: 'a', correct: true });
    expect(scoreTrivia(p1, 't1', 'a')).toEqual({ ok: true, optionKey: 'b', correct: false });
  });

  it('erkennt ungültige Token (auch option_keys selbst)', () => {
    const p = new Map([['t1', 'a']]);
    expect(scoreTrivia(p, 'a', 'a')).toEqual({ ok: false, error: 'INVALID_OPTION_TOKEN' });
    expect(scoreTrivia(p, '', 'a')).toEqual({ ok: false, error: 'INVALID_OPTION_TOKEN' });
  });
});
