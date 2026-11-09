/**
 * Effektive Antwortzeit mit begrenztem Latenzausgleich (docs/QUIZ_ENGINE.md §6.2):
 *
 *     effective = clamp(C, max(0, S − cap), S)      // ganze Millisekunden
 *
 * S = Serverzeit zwischen Präsentation und Eingang, C = vom Client gemessene Zeit.
 */

export interface EffectiveTimeInput {
  /** S = received_at − presented_at in ganzen ms (≥ 0). */
  readonly serverMs: number;
  /** C, ungeprüft aus der Anfrage (`clientElapsedMs`); fehlend = `undefined`/`null`. */
  readonly clientMs: unknown;
  /** cap aus `quiz.latencyAllowanceCapMs`. */
  readonly capMs: number;
  /** Seite wurde während des Schritts neu geladen: der Client-Timer ist ungültig. */
  readonly reloaded: boolean;
}

export type TimingSignal = 'NEGATIVE_CLIENT_TIME';

export interface EffectiveTime {
  readonly effectiveMs: number;
  /** C wurde verwendet (sonst gilt S ohne Ausgleich). */
  readonly clientTimeUsed: boolean;
  /** Missbrauchssignal, das protokolliert werden soll. */
  readonly signal: TimingSignal | null;
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} muss eine nichtnegative ganze Zahl sein: ${value}`);
  }
}

export function effectiveAnswerTime(input: EffectiveTimeInput): EffectiveTime {
  const { serverMs: s, clientMs: c, capMs: cap } = input;
  assertNonNegativeInteger('serverMs', s);
  assertNonNegativeInteger('capMs', cap);

  if (input.reloaded) return { effectiveMs: s, clientTimeUsed: false, signal: null };
  if (typeof c !== 'number' || !Number.isSafeInteger(c) || c < 0) {
    const negative = typeof c === 'number' && c < 0;
    return {
      effectiveMs: s,
      clientTimeUsed: false,
      signal: negative ? 'NEGATIVE_CLIENT_TIME' : null,
    };
  }
  const lower = Math.max(0, s - cap);
  return { effectiveMs: Math.min(Math.max(c, lower), s), clientTimeUsed: true, signal: null };
}
