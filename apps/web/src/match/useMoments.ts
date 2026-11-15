import type { MatchView, ParsedMatchEvent } from '@rdw/protocol';
import { useEffect, useRef, useState } from 'react';
import { rulesOf, stepOf, type MatchScreenState } from './match-model.ts';
import type { SeatName } from './match-text.ts';
import { revealedRound } from './realm-model.ts';
import {
  enqueueMoments,
  holdSkips,
  isCalm,
  momentsBetween,
  momentTiming,
  pruneMoments,
  type Moment,
  type MomentSnapshot,
  type MomentTiming,
} from './moments.ts';

/** Das Band, das gerade über der Karte steht, mit seinen Zeiten (`momentTiming`). */
export interface ShownMoment extends MomentTiming {
  readonly moment: Moment;
}

/**
 * Warteschlange der großen Momente: Jeder Moment steht so lange, wie `momentTiming` sagt (die
 * CSS-Animation des Bands bekommt dieselben Zeiten), danach der nächste. Während einer Frage wird
 * nichts gezeigt (ARCHITECTURE §15); Ankündigungen verfallen dann. „Du bist dran“ verfällt, sobald
 * die eigene Wahl vorbei ist.
 */
export function useMoments(
  view: MatchView | null,
  state: MatchScreenState,
  events: readonly ParsedMatchEvent[],
  name: SeatName,
): ShownMoment | null {
  const previous = useRef<MomentSnapshot | null>(null);
  // Ausgefallene Angriffe, die während einer Auflösung kamen: Ihr Band folgt, sobald sie vorbei
  // ist, nach dem letzten Duell der Partie über der Abrechnung; vor einer Frage verfallen sie
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
    const { fresh, held: waiting } = holdSkips(held.current, arrived, state);
    held.current = waiting;
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

  // Die Zeiten eines Bands stehen fest, sobald es erscheint: mit dem Zustand, in dem es das tut
  // (Merken während des Renderns). Eine Frage blendet es aus; danach beginnt es neu
  const head = state === 'question' ? null : (queue[0] ?? null);
  const [timed, setTimed] = useState<{ key: string; timing: MomentTiming } | null>(null);
  if (head ? timed?.key !== head.key : timed !== null) {
    setTimed(head ? { key: head.key, timing: momentTiming(head, state) } : null);
  }
  const timing = head ? (timed?.key === head.key ? timed.timing : momentTiming(head, state)) : null;
  const headMs = timing ? timing.leadMs + timing.showMs : 0;

  // Die Zeit läuft je Band, nicht je Stand der Schlange: Wechselt unter einem Band die Phase oder
  // verfällt eines dahinter, beginnt sie nicht neu (sonst stünde das nächste Band später da, als
  // das laufende verschwunden ist)
  const headKey = head?.key ?? null;
  useEffect(() => {
    if (headKey === null) return;
    const timer = setTimeout(
      () => setQueue((q) => (q[0]?.key === headKey ? q.slice(1) : q)),
      headMs,
    );
    return () => clearTimeout(timer);
  }, [headKey, headMs]);

  // Eine Frage beginnt oder die eigene Wahl ist vorbei: Überholte Bänder verfallen
  useEffect(() => {
    setQueue((q) => pruneMoments(q, state));
  }, [state]);

  return head && timing ? { moment: head, ...timing } : null;
}
