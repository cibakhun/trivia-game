import { z } from 'zod';

/**
 * Kanonische Dezimalzahl als Zeichenkette: optionales Minus, keine führenden Nullen, Punkt als
 * Dezimaltrenner, keine abschließenden Nachkommanullen, kein `-0`. Beispiele: `0`, `-12.5`, `1386`.
 * Diese Form geht unverändert in PostgreSQL-`numeric` und in `game-core` (`parseDecimal`).
 */
export const CANONICAL_DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;

export function isCanonicalDecimal(value: string): boolean {
  return CANONICAL_DECIMAL_PATTERN.test(value) && value !== '-0';
}

export const canonicalDecimalSchema = z
  .string()
  .max(64)
  .refine(isCanonicalDecimal, { message: 'keine kanonische Dezimalzahl' });
