/**
 * Bedenkzeit der Bots: wann ein Bot an einer Frage als fertig gilt. Die Ansicht zeigt ihn von da
 * an als „hat geantwortet“, und eine Frage, an der nur Bots gefragt sind, bleibt so lange zum
 * Mitlesen offen (O-43). In der Rüstzeit gibt ein Bot erst nach seiner Bedenkzeit ab (ADR-085).
 */

/** Anteil des Zeitlimits, nach dem ein Bot bei einer Wissensfrage frühestens und spätestens „fertig“ ist. */
const BOT_THINK_MIN = 0.2;
const BOT_THINK_MAX = 0.55;

/** Fester Anteil zwischen 0 und 1 je Schlüssel (FNV-1a); gleich für jeden, der nachrechnet. */
function shareOf(key: string): number {
  let hash = 2166136261;
  for (const char of key) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

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
  const share =
    BOT_THINK_MIN + shareOf(`${matchId}.q${seq}.s${seat}`) * (BOT_THINK_MAX - BOT_THINK_MIN);
  return Math.round(timeLimitMs * share);
}

/** Anteil der Rüstzeit, nach dem ein Bot frühestens und spätestens seine Befehle abgibt [E]. */
const BOT_PREPARE_MIN = 0.3;
const BOT_PREPARE_MAX = 0.7;

/**
 * Wie lange ein Bot in der Rüstzeit einer Runde überlegt, bevor er abgibt (ADR-085): fest je
 * Partie, Runde und Sitz, damit Lauf und Ansicht dieselbe Zeit nachrechnen. Seine Befehle
 * entscheiden sich erst dann; vorher steht er wie ein Mensch als „überlegt“ da.
 */
export function botPrepareMs(
  matchId: string,
  round: number,
  seat: number,
  prepareMs: number,
): number {
  const share =
    BOT_PREPARE_MIN +
    shareOf(`${matchId}.r${round}.s${seat}`) * (BOT_PREPARE_MAX - BOT_PREPARE_MIN);
  return Math.round(prepareMs * share);
}
