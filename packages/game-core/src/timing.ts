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
  /**
   * C, ungeprüft aus der Anfrage (`clientElapsedMs`, laut API ganze Millisekunden; der Client
   * rundet `performance.now()`); fehlend = `undefined`/`null`.
   */
  readonly clientMs: unknown;
  /** cap aus `quiz.latencyAllowanceCapMs`. */
  readonly capMs: number;
  /** Seite wurde während des Schritts neu geladen: der Client-Timer ist ungültig. */
  readonly reloaded: boolean;
}

/** Missbrauchssignale (SECURITY.md, Manipulierte Client-Timer). */
export type TimingSignal = 'NEGATIVE_CLIENT_TIME' | 'NON_INTEGER_CLIENT_TIME';

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

/**
 * Signal für einen unzulässigen Client-Wert. Fehlende oder nicht numerische Werte sind kein
 * Signal (älterer Client, Reload); Typfehler weist schon das Protokollschema ab.
 */
function clientTimeSignal(c: unknown): TimingSignal | null {
  if (typeof c !== 'number') return null;
  if (c < 0) return 'NEGATIVE_CLIENT_TIME';
  if (!Number.isSafeInteger(c)) return 'NON_INTEGER_CLIENT_TIME'; // auch NaN und Infinity
  return null;
}

export function effectiveAnswerTime(input: EffectiveTimeInput): EffectiveTime {
  const { serverMs: s, clientMs: c, capMs: cap } = input;
  assertNonNegativeInteger('serverMs', s);
  assertNonNegativeInteger('capMs', cap);

  // Das Signal gilt auch nach einem Reload, sonst ließe es sich durch Neuladen umgehen.
  const signal = clientTimeSignal(c);
  if (input.reloaded || signal !== null || typeof c !== 'number') {
    return { effectiveMs: s, clientTimeUsed: false, signal };
  }
  const lower = Math.max(0, s - cap);
  return { effectiveMs: Math.min(Math.max(c, lower), s), clientTimeUsed: true, signal: null };
}
