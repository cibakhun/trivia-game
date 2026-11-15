import { useState } from 'react';

/**
 * Eine eigene Aktion (Wahl eines Felds, „Angreifen“, „Fertig“) ist abgeschickt, und der Stand, der
 * sie zeigt, ist noch nicht da. Die Bühne ist nur „beschäftigt“, bis der Server geantwortet hat;
 * den neuen Stand bringt erst die nächste Abfrage. Dazwischen stünde für einen Augenblick wieder
 * alles zur Wahl: Die goldenen Ränder gingen aus, an und wieder aus, die Knöpfe würden blass, kräftig
 * und verschwänden dann. Deshalb gilt die Aktion als unterwegs, bis ein neues Ereignis der Partie
 * da ist (jede angenommene Wahl und jede Abgabe schreibt eines) oder der Server sie abgelehnt hat.
 */
export interface SentAction {
  /** Gewähltes Feld; `null` für eine Aktion ohne Feld (Abgabe der Befehle). */
  readonly region: number | null;
  /** Letztes Ereignis der Partie, als die Aktion abging. */
  readonly seq: number;
}

/** Ist die Aktion noch unterwegs? Ein neues Ereignis oder ein Fehler beendet das Warten. */
export function stillSent(
  sent: SentAction | null,
  lastEventSeq: number | null,
  failed: boolean,
): boolean {
  return sent !== null && !failed && lastEventSeq === sent.seq;
}

export interface Sent {
  /** Die Aktion, die gerade unterwegs ist. */
  readonly pending: SentAction | null;
  /** Vor dem Abschicken aufrufen: merkt sich, was abgeht. */
  readonly mark: (region: number | null) => void;
}

/**
 * Merkt sich die zuletzt abgeschickte Aktion, bis der Stand sie zeigt. Kein Zeitgeber: Was gilt,
 * folgt allein aus der Ansicht (`lastEventSeq`) und dem Fehler der letzten Aktion.
 */
export function useSent(lastEventSeq: number | null, error: unknown): Sent {
  const [sent, setSent] = useState<SentAction | null>(null);
  const pending = stillSent(sent, lastEventSeq, Boolean(error)) ? sent : null;
  // Erledigt oder abgelehnt: vergessen (Merken während des Renderns)
  if (sent !== null && pending === null) setSent(null);
  return {
    pending,
    mark: (region) => {
      if (lastEventSeq !== null) setSent({ region, seq: lastEventSeq });
    },
  };
}
