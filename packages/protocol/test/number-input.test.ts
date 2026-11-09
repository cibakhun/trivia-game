import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isCanonicalDecimal, LOCALES, parseNumberInput, type Locale } from '../src/index.ts';

const ok = (value: string) => ({ ok: true, value });
const err = (error: string) => ({ ok: false, error });

describe('parseNumberInput', () => {
  it.each<[Locale, string, unknown]>([
    // Mehrdeutigkeit aus TEST_PLAN §3: "1.234" in de vs. en
    ['de', '1.234', ok('1234')],
    ['en', '1.234', ok('1.234')],
    ['hu', '1.234', err('INVALID_CHARACTER')],
    ['de', '1,234', ok('1.234')],
    ['en', '1,234', ok('1234')],
    ['hu', '1,234', ok('1.234')],
    // Beispiele aus QUIZ_ENGINE §3
    ['de', '1.234,5', ok('1234.5')],
    ['de', '1 234,5', ok('1234.5')],
    ['hu', '1 234,5', ok('1234.5')],
    ['en', '1,234.5', ok('1234.5')],
    // ohne Trenner
    ['de', '1386', ok('1386')],
    ['hu', '1386', ok('1386')],
    ['en', '1386', ok('1386')],
    ['de', '8848', ok('8848')],
    // Normalform
    ['de', '007', ok('7')],
    ['de', '12,50', ok('12.5')],
    ['de', '-0', ok('0')],
    ['de', '-0,00', ok('0')],
    ['de', ',5', ok('0.5')],
    ['en', '.5', ok('0.5')],
    ['de', '-12,5', ok('-12.5')],
    ['de', '\u2212 3', err('INVALID_GROUPING')],
    ['de', '\u22123', ok('-3')],
    ['de', '  42  ', ok('42')],
    ['hu', '1\u00A0234\u202F567', ok('1234567')], // geschütztes und schmales Leerzeichen gelten als Leerzeichen
    ['hu', '1\u00A0234\u00A0567', ok('1234567')],
    ['de', '1.234.567,89', ok('1234567.89')],
    // Fehler
    ['de', '', err('EMPTY')],
    ['de', '   ', err('EMPTY')],
    ['de', '-', err('MISSING_DIGITS')],
    ['de', '12,', err('MISSING_DIGITS')],
    ['de', '1.5', err('INVALID_GROUPING')],
    ['de', '1.23', err('INVALID_GROUPING')],
    ['de', '1234.567', err('INVALID_GROUPING')],
    ['de', '.123', err('INVALID_GROUPING')],
    ['de', '1.234 567', err('INVALID_GROUPING')],
    ['de', '1,2,3', err('MULTIPLE_DECIMAL_SEPARATORS')],
    ['de', '1,234.5', err('INVALID_GROUPING')],
    ['en', '1 234', err('INVALID_CHARACTER')],
    ['en', '1e5', err('INVALID_CHARACTER')],
    ['de', '+5', err('INVALID_CHARACTER')],
    ['de', '٣', err('INVALID_CHARACTER')],
    ['de', '--5', err('INVALID_CHARACTER')],
    ['de', '1'.repeat(41), err('TOO_LONG')],
    ['de', '1'.repeat(31), err('TOO_LONG')],
  ])('%s %j', (locale, raw, expected) => {
    expect(parseNumberInput(raw, locale)).toEqual(expected);
  });

  it('liefert immer eine kanonische Dezimalzahl oder einen Fehlercode', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 50 }), fc.constantFrom(...LOCALES), (raw, locale) => {
        const result = parseNumberInput(raw, locale);
        if (result.ok) expect(isCanonicalDecimal(result.value)).toBe(true);
      }),
    );
  });

  it('liest jede Zahl in der Schreibweise jeder Sprache zurück (mit und ohne Tausendertrenner)', () => {
    const formats: Record<Locale, { group: string; decimal: string }> = {
      de: { group: '.', decimal: ',' },
      hu: { group: ' ', decimal: ',' },
      en: { group: ',', decimal: '.' },
    };
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom(...LOCALES),
        fc.boolean(),
        (units, scale, locale, grouped) => {
          const negative = units < 0n;
          const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
          const intDigits = digits.slice(0, digits.length - scale);
          const fracDigits = digits.slice(digits.length - scale);
          const { group, decimal } = formats[locale];
          const intText = grouped ? intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, group) : intDigits;
          const raw = `${negative ? '-' : ''}${intText}${scale > 0 ? decimal + fracDigits : ''}`;
          const result = parseNumberInput(raw, locale);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          // Vergleich über den exakten Wert: units / 10^scale
          const [i, f = ''] = result.value.replace('-', '').split('.');
          const parsed =
            BigInt(`${i}${f.padEnd(scale, '0')}`) * (result.value.startsWith('-') ? -1n : 1n);
          expect(f.length).toBeLessThanOrEqual(scale);
          expect(parsed).toBe(units);
        },
      ),
    );
  });
});

describe('isCanonicalDecimal', () => {
  it.each(['0', '1', '-1', '12.5', '-0.001', '1386'])('akzeptiert %s', (v) => {
    expect(isCanonicalDecimal(v)).toBe(true);
  });
  it.each(['', '-0', '01', '1.', '.5', '1.50', '1,5', '+1', '1e3', ' 1'])('lehnt %j ab', (v) => {
    expect(isCanonicalDecimal(v)).toBe(false);
  });
});
