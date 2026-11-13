/**
 * Bedenkzeit der Bots: wann ein Bot an einer Frage als fertig gilt. Die Ansicht zeigt ihn von da
 * an als „hat geantwortet“, und eine Frage, an der nur Bots gefragt sind, bleibt so lange zum
 * Mitlesen offen (O-43).
 */

/** Anteil des Zeitlimits, nach dem ein Bot bei einer Wissensfrage frühestens und spätestens „fertig“ ist. */
const BOT_THINK_MIN = 0.2;
const BOT_THINK_MAX = 0.55;

/**
 * Bedenkzeit, nach der ein Bot bei einer Wissensfrage als fertig gilt. Seine Antwort steht beim
 * Öffnen fest und hat keine Zeit (nur Schätzungen tragen eine, `effective_ms`); die Anzeige „hat
 * geantwortet“ bekommt deshalb eine feste, je Frage und Sitz verschiedene Dauer. Sie entscheidet
 * nichts und verrät nichts über die Antwort.
 */
export function botThinkMs(
  matchId: string,
  seq: number,
  seat: number,
  timeLimitMs: number,
): number {
  let hash = 2166136261;
  for (const char of `${matchId}.q${seq}.s${seat}`) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  }
  const share = BOT_THINK_MIN + ((hash >>> 0) / 0x1_0000_0000) * (BOT_THINK_MAX - BOT_THINK_MIN);
  return Math.round(timeLimitMs * share);
}
