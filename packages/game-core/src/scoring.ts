import {
  absDecimal,
  compareDecimal,
  parseDecimal,
  roundHalfUp,
  subtractDecimal,
  type Decimal,
} from './decimal.ts';

/**
 * Bewertung einzelner Antworten (docs/QUIZ_ENGINE.md §2–3). Die Richtigkeit hängt nur am
 * sprachunabhängigen `option_key`, nie an Reihenfolge, Präsentationstoken oder Sprache.
 */

/**
 * Löst ein Präsentationstoken auf und bewertet es. `presentation` ist die serverseitig
 * gespeicherte Zuordnung Token → `option_key` dieses Teilnehmers.
 */
export function scoreTrivia(
  presentation: ReadonlyMap<string, string>,
  optionToken: string,
  correctOptionKey: string,
):
  { ok: true; optionKey: string; correct: boolean } | { ok: false; error: 'INVALID_OPTION_TOKEN' } {
  const optionKey = presentation.get(optionToken);
  if (optionKey === undefined) return { ok: false, error: 'INVALID_OPTION_TOKEN' };
  return { ok: true, optionKey, correct: optionKey === correctOptionKey };
}

export interface EstimateSpec {
  /** Exakter Zielwert, kanonische Dezimalzahl. */
  readonly answerValue: string;
  /** Erlaubte Nachkommastellen (≥ 0). */
  readonly answerPrecision: number;
  readonly inputMin: string;
  readonly inputMax: string;
}

export type EstimateScore =
  | { readonly ok: true; readonly rounded: Decimal; readonly distance: Decimal }
  | { readonly ok: false; readonly error: 'OUT_OF_RANGE' };

/**
 * `distance = |round(eingabe, precision) − answer_value|` mit ROUND_HALF_UP, exakt dezimal.
 * `input` ist die kanonische Zahl aus `parseNumberInput` (protocol). Eingaben außerhalb von
 * `[input_min, input_max]` werden abgewiesen (Schutz vor Tippfehlern und Manipulation).
 */
export function scoreEstimate(input: string, spec: EstimateSpec): EstimateScore {
  const value = parseDecimal(input);
  if (
    compareDecimal(value, parseDecimal(spec.inputMin)) < 0 ||
    compareDecimal(value, parseDecimal(spec.inputMax)) > 0
  ) {
    return { ok: false, error: 'OUT_OF_RANGE' };
  }
  const rounded = roundHalfUp(value, spec.answerPrecision);
  const distance = absDecimal(subtractDecimal(rounded, parseDecimal(spec.answerValue)));
  return { ok: true, rounded, distance };
}
