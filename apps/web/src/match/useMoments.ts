import type { MatchView, ParsedMatchEvent } from '@rdw/protocol';
import { useEffect, useRef, useState } from 'react';
import { rulesOf, type MatchScreenState } from './match-model.ts';
import type { SeatName } from './match-text.ts';
import { isCalm, momentsBetween, type Moment, type MomentSnapshot } from './moments.ts';

/** Wie lange ein Band steht; die CSS-Animation `banner` ist genauso lang. */
export const MOMENT_MS = 1500;

/**
 * Warteschlange der großen Momente: Jeder Moment steht `MOMENT_MS` lang, danach der nächste.
 * Während einer Frage wird nichts gezeigt (ARCHITECTURE §15); Ankündigungen verfallen dann.
 */
export function useMoments(
  view: MatchView | null,
  state: MatchScreenState,
  events: readonly ParsedMatchEvent[],
  name: SeatName,
): Moment | null {
  const previous = useRef<MomentSnapshot | null>(null);
  const shown = useRef(new Set<string>());
  const [queue, setQueue] = useState<readonly Moment[]>([]);
  const lastSeq = events.at(-1)?.seq ?? 0;
  const step = view?.board?.step ?? null;
  const rounds = view ? rulesOf(view.match.rulesPreset).campaign.rounds : 0;

  useEffect(() => {
    if (!view?.board) return;
    const next: MomentSnapshot = {
      state,
      kind: step?.kind ?? null,
      round: step?.round ?? null,
      lastSeq,
    };
    const before = previous.current;
    // Phase und Runde gelten erst als gesehen, wenn angekündigt werden konnte (ruhiger Zustand)
    previous.current =
      before && !isCalm(state) ? { ...next, kind: before.kind, round: before.round } : next;
    if (state === 'question') return;
    const fresh = before ? events.filter((e) => e.seq > before.lastSeq) : [];
    const moments = momentsBetween(before, next, fresh, name, rounds).filter(
      (m) => !shown.current.has(m.key),
    );
    if (moments.length === 0) return;
    for (const m of moments) shown.current.add(m.key);
    setQueue((q) => [...q, ...moments]);
    // Nur bei neuem Stand vergleichen; Namen und Ereignisliste ändern sich mit ihm
  }, [lastSeq, state, step?.kind, step?.round, view?.board !== undefined]);

  useEffect(() => {
    if (queue.length === 0 || state === 'question') return;
    const timer = setTimeout(() => setQueue((q) => q.slice(1)), MOMENT_MS);
    return () => clearTimeout(timer);
  }, [queue, state]);

  // Eine Frage beginnt: Ankündigungen sind dann überholt, ein gefallenes Reich wird nachgeholt
  useEffect(() => {
    if (state === 'question') setQueue((q) => q.filter((m) => m.tone === 'seat'));
  }, [state]);

  return state === 'question' ? null : (queue[0] ?? null);
}
