import type { MatchView, ParsedMatchEvent } from '@rdw/protocol';
import { useEffect, useRef } from 'react';
import { playSound } from '../audio/sound.ts';
import { lastOf, stepOf, type MatchScreenState } from './match-model.ts';
import { cuesFor } from './sound-cues.ts';

/** Spielt die Klänge zu neuen Ereignissen (freigegeben über `installAudioUnlock` in main). */
export function useMatchSounds(
  view: MatchView | null,
  state: MatchScreenState,
  events: readonly ParsedMatchEvent[],
): void {
  const previous = useRef<{ state: MatchScreenState; lastSeq: number } | null>(null);
  const lastSeq = events.at(-1)?.seq ?? 0;
  const mySeat = view?.mySeat ?? null;
  // Mit Ausbau steht das Brett in `realm.board`
  const started = stepOf(view) !== null;

  useEffect(() => {
    if (!started) return;
    const next = { state, lastSeq };
    const before = previous.current;
    previous.current = next;
    const fresh = before ? events.filter((e) => e.seq > before.lastSeq) : [];
    const standings =
      lastOf(events, 'MATCH_FINISHED')?.payload.standings ??
      lastOf(events, 'REALM_MATCH_FINISHED')?.payload.standings ??
      null;
    for (const { cue, delayMs } of cuesFor(before, next, fresh, mySeat, standings)) {
      playSound(cue, delayMs);
    }
    // Nur bei neuem Stand; die Ereignisliste wächst mit `lastSeq`
  }, [lastSeq, state, mySeat, started]);
}
