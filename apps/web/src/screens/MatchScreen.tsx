import type { MatchAnswerRequest, MatchBotStrengthCode, MatchView } from '@rdw/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionKey, ApiRequestError, NetworkError, api, newActionKey } from '../api/client.ts';
import { playSound } from '../audio/sound.ts';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { SoundToggle } from '../components/SoundToggle.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { AnnouncePanel } from '../match/AnnouncePanel.tsx';
import { DuelHeader } from '../match/DuelHeader.tsx';
import { t } from '../i18n/i18n.ts';
import { LobbyPanel } from '../match/LobbyPanel.tsx';
import { MatchBoard } from '../match/MatchBoard.tsx';
import {
  duelFocus,
  lastOf,
  needsPresent,
  revealFor,
  screenStateOf,
  shownPick,
  type LocalQuestion,
  type MatchScreenState,
  type Reveal,
} from '../match/match-model.ts';
import {
  logText,
  mapOfView,
  pickText,
  regionNames,
  seatNames,
  stepLabel,
} from '../match/match-text.ts';
import { ResultPanel } from '../match/ResultPanel.tsx';
import { RevealPanel } from '../match/RevealPanel.tsx';
import { SeatList } from '../match/SeatList.tsx';
import { TurnOrder } from '../match/TurnOrder.tsx';
import type { Moment } from '../match/moments.ts';
import { useMatchFeed } from '../match/useMatchFeed.ts';
import { useMatchSounds } from '../match/useMatchSounds.ts';
import { useMoments } from '../match/useMoments.ts';
import { Countdown } from '../quiz/Countdown.tsx';
import { QuestionPanel } from '../quiz/QuestionPanel.tsx';
import { navigate } from '../router.ts';

/**
 * Eine Partie (API.md §2.6, MATCH_RULES §3): Aufstellung, Wahl auf der Karte, Frage mit
 * Countdown, Auflösung, Abrechnung. Den Stand liefert die Abfrage (`useMatchFeed`); sobald eine
 * Frage an diesen Sitz geht, holt der Browser sie sofort ab, denn ab dem Öffnen läuft die Zeit.
 * Nach einem Reload holt er sie erneut; dann zählt nur die Zeit des Servers.
 */

const LOG_LINES = 8;

function noop() {
  // Ablauf einer Anzeige: Den nächsten Schritt bringt die Abfrage
}

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

  const map = useMemo(() => (view ? mapOfView(view) : null), [view]);
  const name = useMemo(() => (view ? seatNames(view) : () => ''), [view]);
  const region = useMemo(() => (map ? regionNames(map) : () => ''), [map]);
  const moment = useMoments(view, state, events, name);
  useMatchSounds(view, state, events);
  const reveal = useMemo(
    () => (state === 'reveal' && view?.question ? revealFor(events, view.question.seq) : null),
    [state, view?.question, events],
  );
  // Der Angriffspfeil steht von der Ansage bis zum Ende der Auflösung
  const focus = view ? duelFocus(view, reveal) : null;
  // Was ein Bot eben gewählt hat, trägt während der Ansage einen Ring
  const spot = state === 'announce' ? (shownPick(events)?.payload.region ?? null) : null;

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

  function answer(current: LocalQuestion, body: MatchAnswerRequest) {
    playSound('answer');
    const markAs = (status: LocalQuestion['status']) =>
      setLocal((l) => (l && l.seq === current.seq ? { ...l, status } : l));
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
          throw e;
        }
      }
    });
  }

  function timing(current: LocalQuestion) {
    // Nach einem Reload zählt nur die Serverzeit; der Client-Timer wird nicht gesendet
    return current.reloaded
      ? {}
      : { clientElapsedMs: Math.max(0, Math.round(performance.now() - current.shownAt)) };
  }

  const title = view ? t(`match.kind.${view.match.kind}`) : t('match.title');
  const label = view ? stepLabel(view) : null;
  // Laufende Partie: auf dem Handy eine feste Bildschirmseite ohne Scrollen (Karte, Leiste, Blatt)
  const playing = Boolean(view?.board && map) && state !== 'finished' && state !== 'abandoned';

  // Solange die feste Seite steht, scrollt auch das Dokument nicht (iPhone, siehe styles.css)
  useEffect(() => {
    document.documentElement.classList.toggle('match-playing', playing);
    return () => document.documentElement.classList.remove('match-playing');
  }, [playing]);

  return (
    <main
      className={`match-page${playing ? ' playing' : ''}`}
      data-testid="match-screen"
      data-state={state}
      data-seq={seq ?? undefined}
    >
      <header className="match-head">
        <div className="match-title">
          <h1>{title}</h1>
          {label ? (
            <p className="step-ribbon" data-testid="match-step">
              {label}
            </p>
          ) : null}
        </div>
        <nav className="page-nav" aria-label={t('nav.label')}>
          <SoundToggle />
          <button type="button" className="link" onClick={() => navigate({ name: 'start' })}>
            {t('nav.back')}
          </button>
        </nav>
      </header>

      {error ? <ErrorNote error={error} onRetry={refresh} /> : null}
      {state === 'loading' ? <p>{t('app.loading')}</p> : null}

      {view && state === 'lobby' ? (
        <LobbyPanel
          view={view}
          busy={busy}
          error={actionError}
          onStart={startMatch}
          onLeave={leaveMatch}
          onSetBot={setBot}
        />
      ) : null}

      {view && state === 'abandoned' ? <AbandonedPanel view={view} events={events} /> : null}

      {view?.board && map ? (
        <div className="match-body">
          <div className="moment-layer" aria-hidden="true">
            {moment ? <MomentBanner key={moment.key} moment={moment} /> : null}
          </div>
          <div className="match-panel">
            <StatePanel
              view={view}
              state={state}
              local={local}
              phaseDeadline={phaseDeadline}
              estimate={estimate}
              busy={busy}
              events={events}
              reveal={reveal}
              name={name}
              region={region}
              onEstimate={setEstimate}
              onExpire={() =>
                setLocal((l) => (l && l.status === 'OPEN' ? { ...l, status: 'MISSED' } : l))
              }
              onAnswer={(current, body) => answer(current, { ...body, ...timing(current) })}
            />
            {actionError ? <ErrorNote error={actionError} /> : null}
          </div>
          <div className="match-side">
            <SeatList view={view} name={name} />
            <TurnOrder view={view} name={name} />
            <MatchBoard
              map={map}
              board={view.board}
              name={name}
              legal={state === 'pick' ? view.legalRegions : []}
              contested={focus?.region ?? null}
              attacker={focus?.attacker ?? null}
              spot={spot}
              busy={busy}
              onPick={pick}
            />
            <MatchLog events={events} name={name} region={region} />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function StatePanel({
  view,
  state,
  local,
  phaseDeadline,
  estimate,
  busy,
  events,
  reveal,
  name,
  region,
  onEstimate,
  onExpire,
  onAnswer,
}: {
  readonly view: MatchView;
  readonly state: MatchScreenState;
  readonly local: LocalQuestion | null;
  readonly phaseDeadline: number | null;
  readonly estimate: string;
  readonly busy: boolean;
  readonly events: Parameters<typeof revealFor>[0];
  readonly reveal: Reveal | null;
  readonly name: (seat: number) => string;
  readonly region: (region: number) => string;
  readonly onEstimate: (value: string) => void;
  readonly onExpire: () => void;
  readonly onAnswer: (current: LocalQuestion, body: MatchAnswerRequest) => void;
}) {
  const { timers } = view.match;
  const questionMs = view.question?.kind === 'TRIVIA' ? timers.triviaMs : timers.estimateMs;
  const phaseTimer = (totalMs: number, quiet = false) =>
    phaseDeadline === null ? null : (
      <Countdown deadline={phaseDeadline} totalMs={totalMs} onExpire={noop} quiet={quiet} />
    );
  const contextNote = <DuelHeader view={view} name={name} region={region} />;

  switch (state) {
    case 'pick':
    case 'waiting-pick': {
      // Beim Warten das letzte Ereignis, damit man auf dem Handy ohne Verlauf sieht, was passiert ist
      const latest = state === 'waiting-pick' ? latestLine(events, name, region) : null;
      const hint =
        view.board?.step.kind === 'CAPITAL_PICK'
          ? t('match.pick.hintCapital')
          : t('match.pick.hint');
      return (
        <section
          className={`card stack pick-card${state === 'pick' ? ' turn' : ''}`}
          data-testid="match-pick"
          aria-live="polite"
        >
          <p>
            <strong>{pickText(view, name)}</strong>
          </p>
          {state === 'pick' ? <p className="muted pick-hint">{hint}</p> : null}
          {phaseTimer(timers.pickMs)}
          {latest ? <p className="pick-last">{latest}</p> : null}
        </section>
      );
    }
    case 'announce':
      return (
        <AnnouncePanel
          view={view}
          events={events}
          name={name}
          region={region}
          fallback={latestLine(events, name, region)}
          timer={phaseTimer(timers.announceMs, true)}
        />
      );
    case 'question':
      if (!local?.question) return null;
      return (
        <QuestionPanel
          key={local.seq}
          testId="match-question"
          question={local.question}
          deadline={local.deadline}
          reloaded={local.reloaded}
          busy={busy}
          estimate={estimate}
          note={contextNote}
          onEstimate={onEstimate}
          onExpire={onExpire}
          onAnswerTrivia={(token) => onAnswer(local, { optionToken: token })}
          onAnswerEstimate={() => onAnswer(local, { rawInput: estimate.trim(), locale: 'de' })}
        />
      );
    case 'presenting':
    case 'answered':
    case 'missed':
    case 'spectating': {
      const text =
        state === 'presenting'
          ? t('match.question.presenting')
          : state === 'answered'
            ? t('match.question.answered')
            : state === 'missed'
              ? t('match.question.missed')
              : t('match.question.spectating');
      return (
        <section className="card stack" data-testid="match-waiting">
          {contextNote}
          <p aria-live="polite">{text}</p>
          {phaseTimer(questionMs)}
        </section>
      );
    }
    case 'reveal':
      return reveal ? (
        <RevealPanel
          reveal={reveal}
          name={name}
          region={region}
          timer={phaseTimer(timers.revealMs, true)}
        />
      ) : (
        <p>{t('app.loading')}</p>
      );
    case 'finished':
      return <ResultPanel view={view} finished={lastOf(events, 'MATCH_FINISHED')} name={name} />;
    case 'loading':
    case 'lobby':
    case 'abandoned':
      return null;
  }
}

/**
 * Kurzes Banner „Du bist dran!“ über der Karte, sobald dieser Sitz wählen darf. Nur Zierde: Den
 * Auftrag liest die Karte daneben vor (aria-live).
 */
function MomentBanner({ moment }: { readonly moment: Moment }) {
  return (
    <div className={`turn-banner moment-${moment.tone}`}>
      <span className="moment-ribbon" data-seat={moment.seat ?? undefined}>
        {moment.tone === 'seat' && moment.seat !== null ? (
          <SeatCrest seat={moment.seat} size={34} />
        ) : null}
        <span className="moment-title">{moment.title}</span>
      </span>
      {moment.detail ? <span className="moment-detail">{moment.detail}</span> : null}
    </div>
  );
}

/** Jüngste Zeile des Verlaufs: steht auf dem Handy in der Wahlleiste, weil der Verlauf dort fehlt. */
function latestLine(
  events: Parameters<typeof revealFor>[0],
  name: (seat: number) => string,
  region: (region: number) => string,
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const text = event ? logText(event, name, region) : null;
    if (text) return text;
  }
  return null;
}

function MatchLog({
  events,
  name,
  region,
}: {
  readonly events: Parameters<typeof revealFor>[0];
  readonly name: (seat: number) => string;
  readonly region: (region: number) => string;
}) {
  const lines = useMemo(() => {
    const out: { seq: number; text: string }[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < LOG_LINES; i--) {
      const event = events[i];
      const text = event ? logText(event, name, region) : null;
      if (event && text) out.push({ seq: event.seq, text });
    }
    return out;
  }, [events, name, region]);
  if (lines.length === 0) return null;
  return (
    <section className="match-log" aria-labelledby="log-title">
      <h2 id="log-title">{t('match.log.title')}</h2>
      {/* neueste zuerst */}
      <ul>
        {lines.map((line) => (
          <li key={line.seq}>{line.text}</li>
        ))}
      </ul>
    </section>
  );
}

function AbandonedPanel({
  view,
  events,
}: {
  readonly view: MatchView;
  readonly events: Parameters<typeof revealFor>[0];
}) {
  const reason = lastOf(events, 'MATCH_ABANDONED')?.payload.reason;
  const known =
    reason === 'HOST_LEFT' ||
    reason === 'LOBBY_EXPIRED' ||
    reason === 'NO_QUESTION_AVAILABLE' ||
    reason === 'INTERNAL_ERROR';
  return (
    <section className="card stack" data-testid="match-abandoned">
      <h2>{t('match.abandoned.title')}</h2>
      {known ? <p>{t(`match.abandoned.reason.${reason}`)}</p> : null}
      {view.match.kind === 'TEST' ? <p className="muted">{t('match.result.test')}</p> : null}
      <button
        type="button"
        className="button button-primary"
        onClick={() => navigate({ name: 'matches' })}
      >
        {t('match.result.again')}
      </button>
    </section>
  );
}
