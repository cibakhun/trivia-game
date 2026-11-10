import { parseMatchEvent, type MatchView, type ParsedMatchEvent } from '@rdw/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { navigate } from '../router.ts';
import { pollDelay } from './match-model.ts';

/**
 * Stand einer Partie per Abfrage (`GET /matches/:id?after=n`, API.md §2.6), bis M3 den
 * WebSocket bringt. Ereignisse kommen nur einmal und werden hier gesammelt; die Ansicht selbst
 * (Karte, Phase, Frage) ist jedes Mal vollständig. Nach einem Fehler wird mit wachsendem Abstand
 * weiter gefragt; eine fremde oder unbekannte Partie führt zur Übersicht.
 */

export interface MatchFeed {
  readonly view: MatchView | null;
  /** Alle bisher gelesenen Ereignisse in Reihenfolge. */
  readonly events: readonly ParsedMatchEvent[];
  readonly error: unknown;
  /**
   * Ende der aktuellen Phase als `performance.now()`-Wert, gemessen beim ersten Empfang dieser
   * Frist (spätere Abfragen verschieben die Anzeige nicht); `null` ohne Phase.
   */
  readonly phaseDeadline: number | null;
  /** Sofort neu abfragen, etwa nach einer eigenen Wahl oder Antwort. */
  readonly refresh: () => void;
}

const MAX_RETRY_MS = 5_000;

export function useMatchFeed(matchId: string): MatchFeed {
  const [state, setState] = useState<Omit<MatchFeed, 'refresh'>>({
    view: null,
    events: [],
    error: null,
    phaseDeadline: null,
  });
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let again = false;
    let after = 0;
    let failures = 0;
    let events: ParsedMatchEvent[] = [];
    let phase: { key: string; deadline: number } | null = null;

    function schedule(delay: number | null) {
      if (timer) clearTimeout(timer);
      timer = delay === null ? null : setTimeout(() => void tick(), delay);
    }

    async function tick(): Promise<void> {
      if (cancelled) return;
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      let next: number | null;
      try {
        const view = await api.match(matchId, after);
        if (cancelled) return;
        const fresh = view.events.flatMap((e) => {
          const parsed = parseMatchEvent(e);
          return parsed ? [parsed] : [];
        });
        after = view.events.at(-1)?.seq ?? after;
        if (fresh.length > 0) events = [...events, ...fresh];
        failures = 0;
        const key = view.phase ? `${view.phase.kind}:${view.phase.deadline}` : null;
        if (key === null) phase = null;
        else if (phase?.key !== key) {
          phase = { key, deadline: performance.now() + (view.phase?.remainingMs ?? 0) };
        }
        setState({ view, events, error: null, phaseDeadline: phase?.deadline ?? null });
        // Mehr als eine Seite Ereignisse: gleich weiterlesen
        next = after < view.lastEventSeq ? 0 : pollDelay(view);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 404) {
          navigate({ name: 'matches' }, { replace: true });
          return;
        }
        failures += 1;
        setState((current) => ({ ...current, error }));
        next = Math.min(MAX_RETRY_MS, 1000 * failures);
      } finally {
        inFlight = false;
      }
      if (again) {
        again = false;
        next = 0;
      }
      schedule(next);
    }

    refreshRef.current = () => schedule(0);
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      refreshRef.current = () => undefined;
    };
  }, [matchId]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { ...state, refresh };
}
