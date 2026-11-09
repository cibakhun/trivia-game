import type { Locale } from './locale.ts';

/**
 * Zahleneingabe (docs/QUIZ_ENGINE.md §3, Widerspruch W-11). Gespielt wird nur auf Deutsch
 * (ADR-023): Tausendertrenner `.` oder Leerzeichen, Dezimaltrenner `,`. Die Tabelle ist nach
 * Sprache geschlüsselt, damit eine weitere Sprache nur einen Eintrag braucht.
 *
 * Client und Server verwenden dieselbe Funktion. Der Client zeigt die interpretierte Zahl vor dem
 * Bestätigen an; der Server speichert Rohtext und Ergebnis. Die Prüfung ist bewusst streng:
 * Tausendergruppen müssen genau drei Ziffern haben. So wird `1.5` abgelehnt statt still als 15
 * gelesen, und die englische Schreibweise `1,234.5` fällt auf, statt falsch verstanden zu werden.
 */

interface NumberFormat {
  readonly decimal: string;
  readonly groups: readonly string[];
}

const FORMATS: Readonly<Record<Locale, NumberFormat>> = {
  de: { decimal: ',', groups: ['.', ' '] },
};

/** Höchstlänge des Rohtexts und Höchstzahl an Ziffern (Schutz vor Missbrauch). */
export const MAX_NUMBER_INPUT_LENGTH = 40;
export const MAX_NUMBER_INPUT_DIGITS = 30;

export type NumberInputError =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'INVALID_CHARACTER'
  | 'MULTIPLE_DECIMAL_SEPARATORS'
  | 'INVALID_GROUPING'
  | 'MISSING_DIGITS';

export type NumberInputResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: NumberInputError };

/** Geschützte und schmale Leerzeichen, wie sie Tastaturen und Kopieren erzeugen. */
const SPACE_VARIANTS = /[\u00A0\u2007\u2009\u202F]/g;
const MINUS_VARIANTS = /[\u2212\u2012\u2013]/g;
const DIGITS = /^[0-9]+$/;

function fail(error: NumberInputError): NumberInputResult {
  return { ok: false, error };
}

/**
 * Liest eine Zahl in der Schreibweise der Sprache und liefert sie in kanonischer Form
 * (siehe `canonicalDecimalSchema`), z. B. de `"1.234,50"` → `"1234.5"`.
 */
export function parseNumberInput(raw: string, locale: Locale): NumberInputResult {
  if (raw.length > MAX_NUMBER_INPUT_LENGTH) return fail('TOO_LONG');
  const format = FORMATS[locale];
  let text = raw.replace(SPACE_VARIANTS, ' ').replace(MINUS_VARIANTS, '-').trim();
  if (text === '') return fail('EMPTY');

  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  if (text === '') return fail('MISSING_DIGITS');

  for (const ch of text) {
    const allowed = (ch >= '0' && ch <= '9') || ch === format.decimal || format.groups.includes(ch);
    if (!allowed) return fail('INVALID_CHARACTER');
  }

  const parts = text.split(format.decimal);
  if (parts.length > 2) return fail('MULTIPLE_DECIMAL_SEPARATORS');
  const intText = parts[0] ?? '';
  const fracText = parts[1];

  if (fracText !== undefined && !DIGITS.test(fracText)) {
    return fail(fracText === '' ? 'MISSING_DIGITS' : 'INVALID_GROUPING');
  }

  const intDigits = parseIntegerPart(intText, format);
  if (intDigits === null) return fail('INVALID_GROUPING');
  if (intDigits === '' && fracText === undefined) return fail('MISSING_DIGITS');

  const digitCount = intDigits.length + (fracText?.length ?? 0);
  if (digitCount > MAX_NUMBER_INPUT_DIGITS) return fail('TOO_LONG');

  return { ok: true, value: canonicalize(negative, intDigits, fracText ?? '') };
}

/** Ganzzahlteil ohne Trenner, `''` für leer (z. B. `,5`), `null` bei falscher Gruppierung. */
function parseIntegerPart(intText: string, format: NumberFormat): string | null {
  const used = format.groups.filter((g) => intText.includes(g));
  if (used.length === 0) return DIGITS.test(intText) || intText === '' ? intText : null;
  if (used.length > 1) return null; // gemischte Tausendertrenner, z. B. "1.234 567"
  const separator = used[0] as string;
  const groups = intText.split(separator);
  const [first, ...rest] = groups;
  if (first === undefined || !/^[0-9]{1,3}$/.test(first)) return null;
  if (!rest.every((g) => /^[0-9]{3}$/.test(g))) return null;
  return groups.join('');
}

function canonicalize(negative: boolean, intDigits: string, fracDigits: string): string {
  const intPart = intDigits.replace(/^0+/, '') || '0';
  const fracPart = fracDigits.replace(/0+$/, '');
  const body = fracPart === '' ? intPart : `${intPart}.${fracPart}`;
  return negative && body !== '0' ? `-${body}` : body;
}
