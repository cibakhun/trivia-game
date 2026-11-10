import { CHALLENGE_START_WINDOW_MS } from '@rdw/game-core';
import type { AnswerRequest, PresentedQuestion, Resolution } from '@rdw/protocol';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiRequestError, api, newActionKey } from '../api/client.ts';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { t, tp } from '../i18n/i18n.ts';
import { Countdown } from '../quiz/Countdown.tsx';
import { ResolutionView } from '../quiz/ResolutionView.tsx';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';
import { recallAttack } from './attack-memory.ts';

/**
 * Vollbild-Quiz einer Herausforderung (QUIZ_ENGINE §7): Start, Wissensfrage, Schätzfrage,
 * Auflösung. Nach einem Reload wird die offene Frage erneut abgerufen; der Server liefert sie mit
 * der ursprünglichen Frist und wertet sie dann nur nach seiner Uhr.
 */

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'intro' }
  | {
      readonly kind: 'question';
      readonly question: PresentedQuestion;
      /** `performance.now()` beim Anzeigen und am Ende der Antwortzeit. */
      readonly shownAt: number;
      readonly deadline: number;
      readonly reloaded: boolean;
    }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'resolution'; readonly resolution: Resolution }
  | { readonly kind: 'closed' };

/** Wartezeit bis zur Auswertung nach Ablauf (Kulanzzeit `settleGrace` + Puffer). */
const SETTLE_WAIT_MS = 6_000;
const POLL_MS = 2_000;
const POLL_LIMIT = 15;

function showQuestion(question: PresentedQuestion, reloaded: boolean): Phase {
  const now = performance.now();
  return {
    kind: 'question',
    question,
    shownAt: now,
    deadline: now + question.remainingMs,
    reloaded,
  };
}

export function ChallengeScreen({ challengeId }: { readonly challengeId: string }) {
  const { reload } = useSession();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState('');
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ein Schlüssel je gestellter Frage, auch wenn der Spieler nach einem Netzfehler erneut sendet. */
  const answerKeys = useRef(new Map<string, string>());
  const remembered = recallAttack(challengeId);

  /** Liest den Stand vom Server und setzt die passende Phase. */
  const sync = useCallback(
    async (attempt = 0): Promise<void> => {
      try {
        const view = await api.challenge(challengeId);
        setError(null);
        setInstanceId(view.instanceId);
        if (view.resolution) {
          setPhase({ kind: 'resolution', resolution: view.resolution });
          return;
        }
        if (view.status !== 'PREPARING') {
          setPhase({ kind: 'closed' });
          return;
        }
        if (view.question && view.currentStep !== null) {
          // Reload: dieselbe Frage erneut abrufen (der Server protokolliert das)
          const presented = await api.present(challengeId, view.currentStep);
          setPhase(showQuestion(presented.question, true));
          return;
        }
        if (view.currentStep === 0) {
          setPhase({ kind: 'intro' });
          return;
        }
        // Auswertung steht noch aus: kurz warten und erneut lesen
        setPhase({ kind: 'waiting' });
        if (attempt < POLL_LIMIT) {
          pollTimer.current = setTimeout(() => void sync(attempt + 1), POLL_MS);
        }
      } catch (e) {
        // fremde oder unbekannte Herausforderung (z. B. alter Link nach neuem Gastkonto)
        if (e instanceof ApiRequestError && e.status === 404) {
          navigate({ name: 'start' }, { replace: true });
          return;
        }
        setError(e);
      }
    },
    [challengeId],
  );

  useEffect(() => {
    void sync();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [sync]);

  function waitForResult(delay: number) {
    setPhase({ kind: 'waiting' });
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(() => void sync(), delay);
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const presented = await api.present(challengeId, 0);
      setPhase(showQuestion(presented.question, false));
    } catch (e) {
      setError(e);
      void sync();
    } finally {
      setBusy(false);
    }
  }

  async function submit(question: PresentedQuestion, body: AnswerRequest) {
    setBusy(true);
    setError(null);
    try {
      const slot = `${question.step}-${question.presentedAt}`;
      const key = answerKeys.current.get(slot) ?? newActionKey();
      answerKeys.current.set(slot, key);
      const result = await api.answer(challengeId, question.step, body, key);
      setEstimate('');
      if (result.resolution) setPhase({ kind: 'resolution', resolution: result.resolution });
      else if (result.next) setPhase(showQuestion(result.next, false));
      else waitForResult(POLL_MS);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'STEP_EXPIRED') {
        waitForResult(SETTLE_WAIT_MS);
      } else if (e instanceof ApiRequestError && e.code === 'CHALLENGE_CLOSED') {
        void sync();
      } else {
        // Eingabefehler (Zahl unlesbar, außerhalb des Bereichs) oder Netz: Frage bleibt offen
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  function timing(current: Extract<Phase, { kind: 'question' }>) {
    // Nach einem Reload zählt nur die Serverzeit; der Client-Timer wird nicht gesendet.
    return current.reloaded
      ? {}
      : { clientElapsedMs: Math.max(0, Math.round(performance.now() - current.shownAt)) };
  }

  async function backToMap() {
    await reload();
    navigate(instanceId ? { name: 'play', instanceId } : { name: 'start' });
  }

  const regionLabel = remembered?.regionLabel ?? t('quiz.regionUnknown');
  const defenderLabel = remembered?.attack.defender.kingdom
    ? t('quiz.defenderKingdom', { name: remembered.attack.defender.kingdom.name })
    : t('quiz.defenderGarrison');

  return (
    <div className="challenge" role="dialog" aria-modal="true" aria-labelledby="quiz-title">
      <div className="challenge-inner">
        <header className="challenge-head">
          <h1 id="quiz-title">{t('quiz.title', { region: regionLabel })}</h1>
          {remembered ? <p className="muted">{defenderLabel}</p> : null}
        </header>

        {phase.kind === 'loading' ? <p>{t('app.loading')}</p> : null}

        {phase.kind === 'intro' ? (
          <section className="quiz-intro">
            <p>{t('quiz.intro')}</p>
            <p className="muted">
              {tp('quiz.startWindow', Math.round(CHALLENGE_START_WINDOW_MS / 60_000))}
            </p>
            <button
              type="button"
              className="button button-primary button-wide"
              disabled={busy}
              onClick={() => void start()}
            >
              {t('quiz.start')}
            </button>
          </section>
        ) : null}

        {phase.kind === 'question' ? (
          <QuestionView
            key={`${phase.question.step}-${phase.question.presentedAt}`}
            phase={phase}
            busy={busy}
            estimate={estimate}
            onEstimate={setEstimate}
            onExpire={() => waitForResult(SETTLE_WAIT_MS)}
            onAnswerTrivia={(token) =>
              void submit(phase.question, { optionToken: token, ...timing(phase) })
            }
            onAnswerEstimate={() =>
              void submit(phase.question, {
                rawInput: estimate.trim(),
                locale: 'de',
                ...timing(phase),
              })
            }
          />
        ) : null}

        {phase.kind === 'waiting' ? (
          <section aria-live="polite">
            <p>{t('quiz.saved')}</p>
            <p className="muted">{t('quiz.waiting')}</p>
          </section>
        ) : null}

        {phase.kind === 'resolution' ? (
          <ResolutionView resolution={phase.resolution} onDone={() => void backToMap()} />
        ) : null}

        {phase.kind === 'closed' ? (
          <section>
            <p>{t('quiz.closed')}</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void backToMap()}
            >
              {t('quiz.backToMap')}
            </button>
          </section>
        ) : null}

        {error ? (
          <ErrorNote
            error={error}
            // In der Frage selbst sendet der Spieler einfach erneut; sonst Stand neu laden
            {...(phase.kind === 'question' ? {} : { onRetry: () => void sync() })}
          />
        ) : null}
      </div>
    </div>
  );
}

function QuestionView({
  phase,
  busy,
  estimate,
  onEstimate,
  onExpire,
  onAnswerTrivia,
  onAnswerEstimate,
}: {
  readonly phase: Extract<Phase, { kind: 'question' }>;
  readonly busy: boolean;
  readonly estimate: string;
  readonly onEstimate: (value: string) => void;
  readonly onExpire: () => void;
  readonly onAnswerTrivia: (token: string) => void;
  readonly onAnswerEstimate: () => void;
}) {
  const { question } = phase;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (question.kind === 'ESTIMATE') input.current?.focus();
  }, [question.kind]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (estimate.trim() !== '') onAnswerEstimate();
  }

  return (
    <section className="question" aria-labelledby="question-prompt" data-testid="question">
      <p className="muted">{question.kind === 'TRIVIA' ? t('quiz.trivia') : t('quiz.estimate')}</p>
      {question.kind === 'ESTIMATE' ? <p className="note">{t('quiz.tiebreak')}</p> : null}
      <Countdown deadline={phase.deadline} totalMs={question.timeLimitMs} onExpire={onExpire} />
      {phase.reloaded ? <p className="muted">{t('quiz.reloaded')}</p> : null}
      <h2 id="question-prompt" className="prompt">
        {question.prompt}
      </h2>
      {question.kind === 'TRIVIA' ? (
        <ul className="options">
          {question.options.map((option) => (
            <li key={option.token}>
              <button
                type="button"
                className="option"
                disabled={busy}
                onClick={() => onAnswerTrivia(option.token)}
              >
                {option.text}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <form className="estimate" onSubmit={onSubmit}>
          <label htmlFor="estimate-input">
            {t('quiz.estimateLabel')}
            {question.unitLabel ? ` ${t('quiz.estimateUnit', { unit: question.unitLabel })}` : ''}
          </label>
          <input
            id="estimate-input"
            ref={input}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={estimate}
            disabled={busy}
            onChange={(event) => onEstimate(event.target.value)}
          />
          <p className="muted">
            {question.answerPrecision === 0
              ? t('quiz.estimateWhole')
              : tp('quiz.estimatePrecision', question.answerPrecision)}
          </p>
          <button
            type="submit"
            className="button button-primary button-wide"
            disabled={busy || estimate.trim() === ''}
          >
            {busy ? t('quiz.sending') : t('quiz.submit')}
          </button>
        </form>
      )}
    </section>
  );
}
