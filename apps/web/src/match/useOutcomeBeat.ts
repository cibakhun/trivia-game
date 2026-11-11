import { useEffect, useState } from 'react';

/**
 * Erster Takt einer Auflösung (docs/ART_DIRECTION.md §4): Ist ein Duell entschieden, zeigt zuerst
 * nur die Karte den Ausgang, `ms` lang; erst danach kommt das Blatt mit den Antworten. `seq` ist
 * die Frage, deren Auflösung ein Duell entschieden hat, sonst `null`.
 *
 * Wer erst spät in die Auflösung kommt (Seite neu geladen), sieht gleich die Antworten: Ist von
 * der Phase weniger als das Doppelte des Takts übrig, entfällt er.
 */
export function useOutcomeBeat(seq: number | null, ms: number, deadline: number | null): boolean {
  const [over, setOver] = useState<number | null>(null);
  useEffect(() => {
    if (seq === null) return;
    const left = deadline === null ? Number.POSITIVE_INFINITY : deadline - performance.now();
    if (ms <= 0 || left < 2 * ms) {
      setOver(seq);
      return;
    }
    const timer = setTimeout(() => setOver(seq), ms);
    return () => clearTimeout(timer);
  }, [seq, ms, deadline]);
  return seq !== null && over !== seq;
}
