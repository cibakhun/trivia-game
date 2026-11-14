import type { MatchView, ParsedMatchEvent } from '@rdw/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  answersFeed,
  decidedSeq,
  revealPlan,
  type RevealBeat,
  type RevealPlan,
} from './match-model.ts';

export interface RevealBeats {
  /** Stand und Ereignisse, wie die Bühne sie gerade zeigt. */
  readonly view: MatchView | null;
  readonly events: readonly ParsedMatchEvent[];
  /** Takt der Auflösung, wenn sie ein Duell entschieden hat; sonst `null`. */
  readonly beat: RevealBeat | null;
  /**
   * Die Antworten standen noch nicht: Die Seite kam erst in die Auflösung (neu geladen) oder zu
   * spät für den ersten Takt. Die Karte steht dann schon im Ergebnis, das Blatt liegt darüber.
   */
  readonly late: boolean;
}

/**
 * Reihenfolge einer Auflösung, die ein Duell entschieden hat (ADR-069, docs/ART_DIRECTION.md §4):
 * erst die Antworten, dann ihre Folgen. Der Server meldet beides zugleich. Im ersten Takt reicht
 * dieser Haken der Bühne deshalb den Stand vor dem Ausgang weiter (`answersFeed`), danach den
 * ganzen: Für Karte, Tafeln, Bänder und Klänge sieht es aus, als käme der Ausgang erst dann.
 *
 * Den Stand davor kennt nur, wer die Frage hat laufen sehen. Wer mitten in die Auflösung lädt,
 * sieht gleich das Ergebnis mit dem Blatt der Antworten darüber (`late`).
 */
export function useRevealBeats(
  view: MatchView | null,
  events: readonly ParsedMatchEvent[],
  deadline: number | null,
): RevealBeats {
  // Letzte Ansicht, solange eine Frage lief: der Stand vor ihren Folgen
  const asked = useRef<MatchView | null>(null);
  useEffect(() => {
    if (view?.phase?.kind === 'QUESTION' && view.question) asked.current = view;
  });
  const seq = decidedSeq(view, events);
  const before = seq !== null && asked.current?.question?.seq === seq ? asked.current : null;
  const revealMs = view?.match.timers.revealMs ?? 0;

  // Der Zeitplan steht mit dem ersten Bild der Auflösung fest; spätere Abfragen ändern ihn nicht
  const plan = useRef<{ readonly seq: number; readonly times: RevealPlan | null } | null>(null);
  const [passed, setPassed] = useState<{
    readonly seq: number;
    readonly beat: 'outcome' | 'settled';
    readonly late: boolean;
  } | null>(null);
  const witnessed = before !== null;
  useEffect(() => {
    if (seq === null) return;
    const now = performance.now();
    if (plan.current?.seq !== seq) {
      plan.current = { seq, times: witnessed ? revealPlan(now, deadline, revealMs) : null };
    }
    const times = plan.current.times;
    if (!times) {
      setPassed({ seq, beat: 'settled', late: true });
      return;
    }
    const timers = [
      setTimeout(
        () => setPassed({ seq, beat: 'outcome', late: false }),
        Math.max(0, times.outcomeAt - now),
      ),
      setTimeout(
        () => setPassed({ seq, beat: 'settled', late: false }),
        Math.max(0, times.settledAt - now),
      ),
    ];
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [seq, witnessed, deadline, revealMs]);

  const reached = seq !== null && passed?.seq === seq ? passed : null;
  const beat: RevealBeat | null =
    seq === null ? null : reached ? reached.beat : witnessed ? 'answers' : 'settled';
  const late = seq !== null && (reached ? reached.late : !witnessed);

  const held = useMemo(
    () => (beat === 'answers' && view && before ? answersFeed(view, events, before) : null),
    [beat, view, events, before],
  );
  return { view: held?.view ?? view, events: held?.events ?? events, beat, late };
}
