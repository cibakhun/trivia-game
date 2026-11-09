/**
 * Exakte Dezimalzahlen für die Schätzbewertung (docs/QUIZ_ENGINE.md §3): `units / 10^scale`.
 * Kein Float, damit z. B. 0,1 + 0,2 genau 0,3 ergibt und Abstände bitgenau vergleichbar sind.
 */
export interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

const PLAIN_DECIMAL = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;
const MAX_SCALE = 100;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Liest `-12.50`, `0`, `1386`; wirft bei anderer Schreibweise (Eingaben vorher mit protocol parsen). */
export function parseDecimal(text: string): Decimal {
  const match = PLAIN_DECIMAL.exec(text);
  if (!match) throw new RangeError(`Keine Dezimalzahl: ${JSON.stringify(text)}`);
  const [, sign = '', intDigits = '', fracDigits = ''] = match;
  if (fracDigits.length > MAX_SCALE) throw new RangeError('Zu viele Nachkommastellen');
  const units = BigInt(intDigits + fracDigits);
  return { units: sign === '-' ? -units : units, scale: fracDigits.length };
}

/** Kanonische Form wie `canonicalDecimalSchema` in protocol (keine Nachkommanullen, kein `-0`). */
export function formatDecimal(d: Decimal): string {
  const negative = d.units < 0n;
  const digits = (negative ? -d.units : d.units).toString().padStart(d.scale + 1, '0');
  const intPart = digits.slice(0, digits.length - d.scale);
  const fracPart = digits.slice(digits.length - d.scale).replace(/0+$/, '');
  const body = fracPart === '' ? intPart : `${intPart}.${fracPart}`;
  return negative && body !== '0' ? `-${body}` : body;
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.units * pow10(scale - a.scale), b.units * pow10(scale - b.scale), scale];
}

export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { units: x + y, scale };
}

export function subtractDecimal(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { units: x - y, scale };
}

export function absDecimal(a: Decimal): Decimal {
  return a.units < 0n ? { units: -a.units, scale: a.scale } : a;
}

function assertPrecision(precision: number): void {
  if (!Number.isInteger(precision) || precision < 0 || precision > MAX_SCALE) {
    throw new RangeError(`Ungültige Präzision: ${precision}`);
  }
}

/**
 * Rundet auf `precision` Nachkommastellen mit ROUND_HALF_UP im Sinne der Doku:
 * Hälfte von null weg (2,5 → 3, −2,5 → −3).
 */
export function roundHalfUp(a: Decimal, precision: number): Decimal {
  assertPrecision(precision);
  if (a.scale <= precision) return a;
  const factor = pow10(a.scale - precision);
  let quotient = a.units / factor; // schneidet Richtung null ab
  const remainder = a.units % factor; // gleiches Vorzeichen wie units
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder * 2n >= factor) quotient += a.units < 0n ? -1n : 1n;
  return { units: quotient, scale: precision };
}

/**
 * Wandelt eine Gleitkommazahl mit ROUND_HALF_UP in eine Dezimalzahl mit `precision` Stellen.
 * `Number.prototype.toFixed` rundet laut ECMAScript-Spezifikation den exakten Binärwert und wählt
 * bei Gleichstand den betragsmäßig größeren Wert – das ist genau „Hälfte von null weg“.
 */
export function decimalFromNumber(x: number, precision: number): Decimal {
  assertPrecision(precision);
  if (!Number.isFinite(x)) throw new RangeError(`Zahl nicht endlich: ${x}`);
  // Ab 1e21 liefert toFixed die Exponentialschreibweise; solche Gleitkommazahlen sind ganzzahlig
  // und über BigInt exakt darstellbar.
  if (Math.abs(x) >= 1e21) return { units: BigInt(x) * 10n ** BigInt(precision), scale: precision };
  return parseDecimal(x.toFixed(precision));
}

/** Näherung als Gleitkommazahl, nur für Modellrechnungen (NPC), nie für Bewertungen. */
export function decimalToNumber(a: Decimal): number {
  return Number(formatDecimal(a));
}

export function minDecimal(a: Decimal, b: Decimal): Decimal {
  return compareDecimal(a, b) <= 0 ? a : b;
}

export function maxDecimal(a: Decimal, b: Decimal): Decimal {
  return compareDecimal(a, b) >= 0 ? a : b;
}
