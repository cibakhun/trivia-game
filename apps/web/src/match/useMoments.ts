import type { MatchView, ParsedMatchEvent } from '@rdw/protocol';
import { useEffect, useRef, useState } from 'react';
import { stepOf, type MatchScreenState } from './match-model.ts';
import type { SeatName } from './match-text.ts';
import { revealedRound } from './realm-model.ts';
import {
  closingTiming,
  enqueueMoments,
  holdSkips,
  isCalm,
  momentsBetween,
  momentTiming,
  momentWeight,
  pruneMoments,
  type Moment,
  type MomentSnapshot,
  type MomentTiming,
} from './moments.ts';

/** Das Band, das gerade über der Karte steht, mit seinen Zeiten (`momentTiming`). */
export interface ShownMoment extends MomentTiming {
  readonly moment: Moment;
}

/** Zeiten des laufenden Bands, seit wann es steht und ab wann es sich vorzeitig einrollt. */
interface Timed {
  readonly key: string;
  readonly timing: MomentTiming;
  /** `performance.now()`, als es erschien. */
  readonly at: number;
  /** Millisekunden nach dem Erscheinen, als es verfiel; `null`, solange es gilt. */
  readonly closing: number | null;
}

/**
 * Warteschlange der großen Momente: Jeder Moment steht so lange, wie `momentTiming` sagt (die
 * CSS-Animation des Bands bekommt dieselben Zeiten), danach der nächste. Während einer Frage wird
 * nichts gezeigt (ARCHITECTURE §15); Ankündigungen verfallen dann. „Du bist dran“ verfällt, sobald
 * die eigene Wahl vorbei ist, und rollt sich dann gleich ein. `ending`: Die letzte Auflösung der
 * Partie steht in ihrem letzten Takt, der Ausgang ist gespielt.
 */
export function useMoments(
  view: MatchView | null,
  state: MatchScreenState,
  events: readonly ParsedMatchEvent[],
  name: SeatName,
  ending = false,
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
  const rounds = view?.match.campaignRounds ?? 0;

  useEffect(() => {
    if (!step) return;
    // Ist der letzte Ausgang gespielt, gilt für ausgefallene Angriffe schon das Ende der Partie:
    // Ihr Band steht dann über der Karte, bevor die Abrechnung sie verdeckt (sonst stünde es unter
    // ihr). Für alles andere ist es wie die Auflösung kein ruhiger Zustand
    const shownState: MatchScreenState = ending ? 'finished' : state;
    const next: MomentSnapshot = {
      state: shownState,
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
    const { fresh, held: waiting } = holdSkips(held.current, arrived, shownState);
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
  }, [lastSeq, state, step?.kind, step?.round, step !== null, ending]);

  // Die Zeiten eines Bands stehen fest, sobald es erscheint: mit dem Zustand, in dem es das tut
  // (Merken während des Renderns). Eine Frage blendet es aus; danach beginnt es neu
  const head = state === 'question' ? null : (queue[0] ?? null);
  const [timed, setTimed] = useState<Timed | null>(null);
  if (head ? timed?.key !== head.key : timed !== null) {
    setTimed(
      head
        ? { key: head.key, timing: momentTiming(head, state), at: performance.now(), closing: null }
        : null,
    );
  }
  // Verfällt das laufende Band (die eigene Wahl ist vorbei), rollt es sich von da an ein. Der
  // Augenblick steht einmal fest: Spätere Stände verschieben das Ende nicht
  const doomed = head !== null && pruneMoments([head], state).length === 0;
  if (doomed && timed?.key === head.key && timed.closing === null) {
    setTimed({ ...timed, closing: performance.now() - timed.at });
  }
  const planned = head
    ? timed?.key === head.key
      ? timed.timing
      : momentTiming(head, state)
    : null;
  const timing =
    head && planned && timed?.key === head.key && timed.closing !== null
      ? closingTiming(planned, timed.closing, momentWeight(head))
      : planned;
  const headMs = timing ? timing.leadMs + timing.showMs : 0;

  // Die Zeit läuft je Band, nicht je Stand der Schlange: Wechselt unter einem Band die Phase oder
  // verfällt eines dahinter, beginnt sie nicht neu (sonst stünde das nächste Band später da, als
  // das laufende verschwunden ist)
  const headKey = head?.key ?? null;
  const headAt = timed !== null && timed.key === headKey ? timed.at : null;
  useEffect(() => {
    if (headKey === null) return;
    // Rollt es sich vorzeitig ein, zählt das neue Ende ab seinem Erscheinen
    const left = headAt === null ? headMs : headAt + headMs - performance.now();
    const timer = setTimeout(
      () => setQueue((q) => (q[0]?.key === headKey ? q.slice(1) : q)),
      Math.max(0, left),
    );
    return () => clearTimeout(timer);
    // Der Beginn eines Bands steht mit ihm fest
  }, [headKey, headMs]);

  // Eine Frage beginnt oder die eigene Wahl ist vorbei: Überholte Bänder verfallen. Steht eines
  // davon schon da, rollt es sich ein (oben) und geht danach wie jedes Band; vor einer Frage und
  // solange es noch nicht erschienen ist, geht es sofort
  const shownSince = timed !== null && timed.key === head?.key ? timed : null;
  useEffect(() => {
    const visible =
      shownSince !== null && performance.now() - shownSince.at >= shownSince.timing.leadMs;
    setQueue((q) => {
      const kept = pruneMoments(q, state);
      const first = q[0];
      if (kept === q || !first || state === 'question' || !visible) return kept;
      if (first.key !== shownSince?.key || kept[0]?.key === first.key) return kept;
      return [first, ...kept];
    });
    // Nur beim Wechsel des Zustands; welches Band steht, gilt in diesem Augenblick
  }, [state]);

  return head && timing ? { moment: head, ...timing } : null;
}
