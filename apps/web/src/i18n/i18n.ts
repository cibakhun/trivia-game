import { ATTACK_REFUSAL_CODES, type ErrorCode } from '@rdw/protocol';
import { de, type Messages } from './de.ts';

/**
 * Schlanke Übersetzung mit geprüften Schlüsseln (ADR-036): `t('region.tier', { tier: 3 })`.
 * Schlüssel sind Pfade zu Texten in `de.ts`; ein Tippfehler ist ein Compilerfehler.
 */

type Leaf = string;
type Plural = { readonly one: string; readonly other: string };

type PathsOf<T, Want> = {
  [K in keyof T & string]: T[K] extends Want
    ? K
    : T[K] extends Plural
      ? never
      : T[K] extends object
        ? `${K}.${PathsOf<T[K], Want>}`
        : never;
}[keyof T & string];

export type MessageKey = PathsOf<Messages, Leaf>;
export type PluralKey = PathsOf<Messages, Plural>;
export type Params = Readonly<Record<string, string | number>>;

const LOCALE = 'de-DE';
const plurals = new Intl.PluralRules(LOCALE);

function lookup(key: string): unknown {
  let node: unknown = de;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function interpolate(text: string, params: Params | undefined): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function t(key: MessageKey, params?: Params): string {
  const text = lookup(key);
  return typeof text === 'string' ? interpolate(text, params) : key;
}

/** Text mit Pluralform; `{count}` wird ersetzt. */
export function tp(key: PluralKey, count: number, params?: Params): string {
  const forms = lookup(key) as Plural | undefined;
  if (!forms) return key;
  const form = plurals.select(count) === 'one' ? forms.one : forms.other;
  return interpolate(form, { ...params, count: formatNumber(count) });
}

/** Dynamischer Schlüssel (z. B. aus einem Code); `fallback`, wenn er fehlt. */
export function tDynamic(key: string, fallback: MessageKey, params?: Params): string {
  const text = lookup(key);
  return typeof text === 'string' ? interpolate(text, params) : t(fallback, params);
}

export function hasMessage(key: string): boolean {
  return typeof lookup(key) === 'string';
}

const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 20 });
const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Kanonische Dezimalzahl („-1234.5“) in deutscher Schreibweise („-1.234,5“, ASCII-Minus), ohne Rundung. */
export function formatDecimal(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign = '', whole = '0', fraction] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped}${fraction ? `,${fraction}` : ''}`;
}

/** Große deutsche Zahlwörter ab der Billion, je drei Stellen weiter (Einzahl, Mehrzahl). */
const LARGE_NUMBER_WORDS: readonly (readonly [string, string])[] = [
  ['Billion', 'Billionen'],
  ['Billiarde', 'Billiarden'],
  ['Trillion', 'Trillionen'],
  ['Trilliarde', 'Trilliarden'],
  ['Quadrillion', 'Quadrillionen'],
  ['Quadrilliarde', 'Quadrilliarden'],
  ['Quintillion', 'Quintillionen'],
  ['Quintilliarde', 'Quintilliarden'],
  ['Sextillion', 'Sextillionen'],
  ['Sextilliarde', 'Sextilliarden'],
];

/**
 * Eine geschätzte Zahl oder ihr Abstand in der Auflösung. Bis unter eine Billion wie
 * `formatDecimal`, darüber kurz mit Zahlwort („≈ 1,23 Trillionen“), damit auch eine absurd große
 * Schätzung in eine Zeile passt: Eine erlaubte Grenze gibt es nicht (ADR-076).
 */
export function formatEstimateFigure(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign = '', rawWhole = '0', fraction = ''] = match;
  const whole = rawWhole.replace(/^0+(?=\d)/, '');
  // Gruppe 0 ist die Billion (10^12), jede weitere drei Stellen mehr
  let group = Math.floor((whole.length - 1) / 3) - 4;
  if (group < 0) return formatDecimal(value);
  const point = whole.length - 3 * (group + 4);
  let mantissa = Number(Number(`${whole.slice(0, point)}.${whole.slice(point)}`).toPrecision(3));
  if (mantissa >= 1000) {
    mantissa /= 1000;
    group += 1;
  }
  const words = LARGE_NUMBER_WORDS[group];
  if (!words) return formatDecimal(value);
  // genau, wenn hinter den ersten drei Ziffern nur Nullen stehen
  const exact = /^0*$/.test(fraction) && whole.replace(/0+$/, '').length <= 3;
  const word = mantissa === 1 ? words[0] : words[1];
  return `${exact ? '' : '≈\u00a0'}${sign}${String(mantissa).replace('.', ',')}\u00a0${word}`;
}

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** Ablehnungsgründe eines Angriffs (mit Zeitpunkt) und sonstige Fehlercodes als Text. */
export function errorMessage(code: string, details?: Readonly<Record<string, unknown>>): string {
  const until = details?.until ?? details?.resetAt;
  const retry = details?.retryAfterMs;
  const params: Params | undefined =
    typeof until === 'string'
      ? { until: formatTime(until) }
      : typeof retry === 'number'
        ? { minutes: Math.max(1, Math.ceil(retry / 60_000)) }
        : undefined;
  if ((ATTACK_REFUSAL_CODES as readonly string[]).includes(code)) {
    return tDynamic(`attack.reason.${code}`, 'errors.generic', params);
  }
  return tDynamic(`errors.${code}`, 'errors.generic', params);
}

export type { ErrorCode };
