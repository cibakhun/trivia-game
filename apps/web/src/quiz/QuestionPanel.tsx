import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { t, tp } from '../i18n/i18n.ts';
import { Countdown } from './Countdown.tsx';

/**
 * Eine gestellte Frage mit Restzeit: Wissensfrage mit Antwortknöpfen oder Schätzfrage mit
 * Zahlenfeld. Gemeinsam für Herausforderungen (Eternal) und die Partie; die Frage kommt vom
 * Server ohne Hinweis auf die richtige Antwort.
 */

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export type PanelQuestion =
  | {
      readonly kind: 'TRIVIA';
      readonly prompt: string;
      readonly timeLimitMs: number;
      readonly options: readonly { readonly token: string; readonly text: string }[];
    }
  | {
      readonly kind: 'ESTIMATE';
      readonly prompt: string;
      readonly timeLimitMs: number;
      readonly unitLabel: string | null;
      readonly answerPrecision: number;
    };

export function QuestionPanel({
  question,
  deadline,
  reloaded,
  busy,
  estimate,
  note,
  testId = 'question',
  onEstimate,
  onExpire,
  onAnswerTrivia,
  onAnswerEstimate,
}: {
  readonly question: PanelQuestion;
  /** Ende der eigenen Antwortzeit als `performance.now()`-Wert. */
  readonly deadline: number;
  readonly reloaded: boolean;
  readonly busy: boolean;
  readonly estimate: string;
  /** Hinweis über der Restzeit, etwa wofür die Frage zählt. */
  readonly note?: ReactNode;
  readonly testId?: string;
  readonly onEstimate: (value: string) => void;
  readonly onExpire: () => void;
  readonly onAnswerTrivia: (token: string) => void;
  readonly onAnswerEstimate: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (question.kind === 'ESTIMATE') input.current?.focus();
  }, [question.kind]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (estimate.trim() !== '') onAnswerEstimate();
  }

  return (
    <section
      className="question"
      aria-labelledby="question-prompt"
      data-testid={testId}
      data-kind={question.kind}
    >
      <p className="question-kind">
        {question.kind === 'TRIVIA' ? t('quiz.trivia') : t('quiz.estimate')}
      </p>
      {note}
      <Countdown deadline={deadline} totalMs={question.timeLimitMs} onExpire={onExpire} />
      {reloaded ? <p className="muted">{t('quiz.reloaded')}</p> : null}
      <h2 id="question-prompt" className="prompt">
        {question.prompt}
      </h2>
      {question.kind === 'TRIVIA' ? (
        <ul className="options">
          {question.options.map((option, i) => (
            <li key={option.token}>
              <button
                type="button"
                className="option"
                disabled={busy}
                onClick={() => onAnswerTrivia(option.token)}
              >
                {/* Buchstabe nur zur Zierde: Der Name der Schaltfläche bleibt der Antworttext */}
                <span className="option-key" aria-hidden="true">
                  {OPTION_KEYS[i] ?? ''}
                </span>
                <span className="option-text">{option.text}</span>
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
