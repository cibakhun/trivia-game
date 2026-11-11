import type { MatchBotStrengthCode } from '@rdw/protocol';
import { useEffect, useRef, useState } from 'react';
import { ActionKey, ApiRequestError, NetworkError, api, newActionKey } from '../api/client.ts';
import { playSound } from '../audio/sound.ts';
import {
  needsPresent,
  screenStateOf,
  type LocalAnswer,
  type LocalQuestion,
} from '../match/match-model.ts';
import { MatchStage } from '../match/MatchStage.tsx';
import { useMatchFeed } from '../match/useMatchFeed.ts';
import { navigate } from '../router.ts';

/**
 * Eine Partie (API.md §2.6, MATCH_RULES §3): Aufstellung, Wahl auf der Karte, Frage mit
 * Countdown, Auflösung, Abrechnung. Den Stand liefert die Abfrage (`useMatchFeed`); sobald eine
 * Frage an diesen Sitz geht, holt der Browser sie sofort ab, denn ab dem Öffnen läuft die Zeit.
 * Nach einem Reload holt er sie erneut; dann zählt nur die Zeit des Servers. Diese Komponente
 * hält den Stand und schickt die Aktionen; was zu sehen ist, zeichnet die Bühne (`MatchStage`).
 */
export function MatchScreen({ matchId }: { readonly matchId: string }) {
  const { view, events, error, phaseDeadline, refresh } = useMatchFeed(matchId);
  const [local, setLocal] = useState<LocalQuestion | null>(null);
  const [estimate, setEstimate] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const presenting = useRef<number | null>(null);
  /** Ein Schlüssel je Frage, auch wenn nach einem Netzfehler erneut gesendet wird. */
  const answerKeys = useRef(new Map<number, string>());
  const pickKey = useRef(new ActionKey());
  const lobbyKey = useRef(new ActionKey());

  const state = screenStateOf(view, local);
  const seq = view?.question?.seq ?? null;

  // Ein neuer Schritt nimmt alte Fehlermeldungen mit
  useEffect(() => {
    setActionError(null);
  }, [state, seq]);

  // Frage abholen, sobald sie an diesen Sitz geht (auch nach einem Reload)
  useEffect(() => {
    if (!view || !needsPresent(view, local) || view.question === null) return;
    const { seq: questionSeq, myStatus } = view.question;
    if (presenting.current === questionSeq) return;
    presenting.current = questionSeq;
    const reloaded = myStatus === 'PRESENTED';
    api
      .presentMatchQuestion(matchId, questionSeq)
      .then((presented) => {
        const now = performance.now();
        setEstimate('');
        setLocal({
          seq: questionSeq,
          question: presented.question,
          shownAt: now,
          deadline: now + presented.question.remainingMs,
          reloaded,
          status: 'OPEN',
        });
      })
      .catch((e: unknown) => {
        if (e instanceof NetworkError) {
          // Nächste Abfrage versucht es erneut
          presenting.current = null;
          return;
        }
        // Geschlossen oder nicht (mehr) für diesen Sitz: warten auf die Auflösung
        const now = performance.now();
        setLocal({
          seq: questionSeq,
          question: null,
          shownAt: now,
          deadline: now,
          reloaded,
          status: 'MISSED',
        });
        refresh();
      });
  }, [view, local, matchId, refresh]);

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  function pick(target: number) {
    if (!view) return;
    void runAction(async () => {
      const key = pickKey.current;
      try {
        await api.pickRegion(matchId, target, key.for({ seq: view.lastEventSeq, target }));
        key.settle();
      } catch (e) {
        key.settle(e);
        throw e;
      } finally {
        refresh();
      }
    });
  }

  function startMatch() {
    void runAction(async () => {
      const key = lobbyKey.current;
      try {
        await api.startMatch(matchId, key.for('start'));
        key.settle();
      } catch (e) {
        key.settle(e);
        throw e;
      } finally {
        refresh();
      }
    });
  }

  function setBot(joinOrder: number, strength: MatchBotStrengthCode | null) {
    void runAction(async () => {
      const key = lobbyKey.current;
      try {
        await api.setSeatBot(matchId, joinOrder, strength, key.for({ joinOrder, strength }));
        key.settle();
      } catch (e) {
        key.settle(e);
        throw e;
      } finally {
        refresh();
      }
    });
  }

  function leaveMatch() {
    void runAction(async () => {
      const key = lobbyKey.current;
      try {
        await api.leaveMatch(matchId, key.for('leave'));
        key.settle();
      } catch (e) {
        key.settle(e);
        throw e;
      }
      navigate({ name: 'matches' });
    });
  }

  function answer(current: LocalQuestion, given: LocalAnswer) {
    playSound('answer');
    const update = (change: (question: LocalQuestion) => LocalQuestion) =>
      setLocal((l) => (l && l.seq === current.seq ? change(l) : l));
    const markAs = (status: LocalQuestion['status']) => update((l) => ({ ...l, status }));
    // Die Fragekarte zeigt die eigene Antwort sofort, noch ehe der Server sie bestätigt
    update((l) => ({ ...l, sent: given }));
    // Nach einem Reload zählt nur die Serverzeit; der Client-Timer wird nicht gesendet
    const timing = current.reloaded
      ? {}
      : { clientElapsedMs: Math.max(0, Math.round(performance.now() - current.shownAt)) };
    const body =
      given.optionToken !== undefined
        ? { optionToken: given.optionToken, ...timing }
        : { rawInput: given.rawInput ?? '', locale: 'de' as const, ...timing };
    void runAction(async () => {
      const key = answerKeys.current.get(current.seq) ?? newActionKey();
      answerKeys.current.set(current.seq, key);
      try {
        await api.answerMatchQuestion(matchId, current.seq, body, key);
        setEstimate('');
        markAs('ANSWERED');
        refresh();
      } catch (e) {
        if (e instanceof ApiRequestError && e.code === 'STEP_EXPIRED') {
          markAs('MISSED');
          refresh();
        } else if (e instanceof ApiRequestError && e.code === 'IDEMPOTENCY_KEY_REUSED') {
          // Die erste Antwort kam an, nur ihre Bestätigung ging verloren
          markAs('ANSWERED');
          refresh();
        } else if (
          e instanceof ApiRequestError &&
          (e.code === 'STEP_NOT_AVAILABLE' || e.code === 'MATCH_NOT_RUNNING')
        ) {
          refresh();
        } else {
          // Eingabefehler oder Netz: Die Frage bleibt offen, erneut senden geht
          update((l) => ({ ...l, sent: undefined }));
          throw e;
        }
      }
    });
  }

  return (
    <MatchStage
      view={view}
      events={events}
      local={local}
      phaseDeadline={phaseDeadline}
      feedError={error}
      actionError={actionError}
      busy={busy}
      estimate={estimate}
      onRetry={refresh}
      onEstimate={setEstimate}
      onPick={pick}
      onAnswer={answer}
      onExpire={() => setLocal((l) => (l && l.status === 'OPEN' ? { ...l, status: 'MISSED' } : l))}
      onStart={startMatch}
      onLeave={leaveMatch}
      onSetBot={setBot}
    />
  );
}
