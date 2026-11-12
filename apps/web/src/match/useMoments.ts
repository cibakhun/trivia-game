import type { MatchView, ParsedMatchEvent } from '@rdw/protocol';
import { useEffect, useRef, useState } from 'react';
import { rulesOf, stepOf, type MatchScreenState } from './match-model.ts';
import type { SeatName } from './match-text.ts';
import { revealedRound } from './realm-model.ts';
import {
  enqueueMoments,
  isCalm,
  momentsBetween,
  pruneMoments,
  type Moment,
  type MomentSnapshot,
} from './moments.ts';

/** Wie lange ein Band steht; die CSS-Animation `banner` ist genauso lang. */
export const MOMENT_MS = 1500;

/**
 * Warteschlange der großen Momente: Jeder Moment steht `MOMENT_MS` lang, danach der nächste.
 * Während einer Frage wird nichts gezeigt (ARCHITECTURE §15); Ankündigungen verfallen dann.
 * „Du bist dran“ verfällt, sobald die eigene Wahl vorbei ist.
 */
export function useMoments(
  view: MatchView | null,
  state: MatchScreenState,
  events: readonly ParsedMatchEvent[],
  name: SeatName,
): Moment | null {
  const previous = useRef<MomentSnapshot | null>(null);
  // Ausgefallene Angriffe, die während einer Auflösung kamen: Ihr Band folgt, sobald sie vorbei ist
  const held = useRef<readonly ParsedMatchEvent[]>([]);
  const shown = useRef(new Set<string>());
  const [queue, setQueue] = useState<readonly Moment[]>([]);
  const lastSeq = events.at(-1)?.seq ?? 0;
  const step = stepOf(view);
  const realm = view?.realm ?? null;
  const rounds = realm
    ? realm.campaignRounds
    : view
      ? rulesOf(view.match.rulesPreset).campaign.rounds
      : 0;

  useEffect(() => {
    if (!step) return;
    const next: MomentSnapshot = {
      state,
      kind: step?.kind ?? null,
      // Beim Aufdecken zählt die aufgedeckte Runde: Fielen alle Angriffe aus, ist der Schritt
      // schon in der nächsten (ADR-064), und deren Rüstzeit wird danach eigens angekündigt
      round: (state === 'orders' ? revealedRound(events) : null) ?? step?.round ?? null,
      lastSeq,
    };
    const before = previous.current;
    // Phase und Runde gelten erst als gesehen, wenn angekündigt werden konnte (ruhiger Zustand)
    previous.current =
      before && !isCalm(state) ? { ...next, kind: before.kind, round: before.round } : next;
    const arrived = before ? events.filter((e) => e.seq > before.lastSeq) : [];
    const calm = isCalm(state);
    const fresh = calm ? [...held.current, ...arrived] : arrived;
    held.current = calm
      ? []
      : [...held.current, ...arrived.filter((e) => e.type === 'ATTACK_SKIPPED')];
    if (state === 'question') return;
    const moments = momentsBetween(
      before,
      next,
      fresh,
      name,
      rounds,
      realm !== null,
      realm?.economy.landGrabRounds ?? null,
      view?.mySeat ?? null,
    ).filter((m) => !shown.current.has(m.key));
    if (moments.length === 0) return;
    for (const m of moments) shown.current.add(m.key);
    setQueue((q) => enqueueMoments(q, moments));
    // Nur bei neuem Stand vergleichen; Namen und Ereignisliste ändern sich mit ihm
  }, [lastSeq, state, step?.kind, step?.round, step !== null]);

  useEffect(() => {
    if (queue.length === 0 || state === 'question') return;
    const timer = setTimeout(() => setQueue((q) => q.slice(1)), MOMENT_MS);
    return () => clearTimeout(timer);
  }, [queue, state]);

  // Eine Frage beginnt oder die eigene Wahl ist vorbei: Überholte Bänder verfallen
  useEffect(() => {
    setQueue((q) => pruneMoments(q, state));
  }, [state]);

  return state === 'question' ? null : (queue[0] ?? null);
}
