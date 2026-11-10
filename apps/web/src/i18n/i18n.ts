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

/** Kanonische Dezimalzahl („-1234.5“) in deutscher Schreibweise („−1.234,5“), ohne Rundung. */
export function formatDecimal(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign = '', whole = '0', fraction] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped}${fraction ? `,${fraction}` : ''}`;
}

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** Ablehnungsgründe eines Angriffs (mit Zeitpunkt) und sonstige Fehlercodes als Text. */
export function errorMessage(code: string, details?: Readonly<Record<string, unknown>>): string {
  const until = details?.until ?? details?.resetAt;
  const params = typeof until === 'string' ? { until: formatTime(until) } : undefined;
  if ((ATTACK_REFUSAL_CODES as readonly string[]).includes(code)) {
    return tDynamic(`attack.reason.${code}`, 'errors.generic', params);
  }
  return tDynamic(`errors.${code}`, 'errors.generic', params);
}

export type { ErrorCode };
