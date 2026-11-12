import type { MatchPresentedQuestion, QuestionCategory } from '@rdw/protocol';
import { CategoryIcon } from '../art/RealmIcons.tsx';
import { t, tp } from '../i18n/i18n.ts';
import { Countdown } from '../quiz/Countdown.tsx';
import { showEstimate } from './estimate-input.ts';

/**
 * Fragekarte mitten auf der Karte (ADR-059): Art der Frage, Restzeit als Zahl und Lunte, die Frage
 * und bei einer Wissensfrage die Antworten in zwei Spalten. Bei einer Schätzfrage steht hier die
 * Zahl, die das Ziffernfeld im Blatt schreibt. In der Partie mit Ausbau nennt das Band die
 * Kategorie, die das Glücksrad gezogen hat. Nach der eigenen Antwort bleibt die Karte stehen,
 * die gewählte Antwort ist markiert: So springt nichts, bis die Auflösung kommt. Ohne Bewegung,
 * weil die Fragezeit läuft (ARCHITECTURE §15).
 */

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/** Lange Fragen und Antworten bekommen eine kleinere Schrift, damit die Karte nicht wächst. */
function density(question: MatchPresentedQuestion): string {
  const prompt = question.prompt.length > 110 ? ' prompt-long' : '';
  if (question.kind !== 'TRIVIA') return prompt;
  const longest = Math.max(0, ...question.options.map((o) => o.text.length));
  return `${prompt}${longest > 34 ? ' options-long' : longest > 16 ? ' options-mid' : ''}`;
}

function noop() {
  // Nach der eigenen Antwort läuft die Zeit nur noch zur Anzeige
}

export function StageQuestion({
  question,
  deadline,
  reloaded,
  busy,
  open,
  estimate,
  sent,
  category = null,
  onExpire,
  onAnswerTrivia,
}: {
  readonly question: MatchPresentedQuestion;
  /** Ende der eigenen Antwortzeit als `performance.now()`-Wert. */
  readonly deadline: number;
  readonly reloaded: boolean;
  readonly busy: boolean;
  /** `false`, sobald die eigene Antwort abgegeben oder die Zeit abgelaufen ist. */
  readonly open: boolean;
  /** Eingabe des Ziffernfelds (Schätzfrage); sie steht nur da, solange die Karte offen ist. */
  readonly estimate: string;
  /** Eigene Antwort, sobald sie abgeschickt ist: gewählte Option oder geschriebene Zahl. */
  readonly sent: { readonly optionToken?: string; readonly rawInput?: string } | null;
  /** Kategorie aus dem Glücksrad (Partie mit Ausbau); steht dann statt der Art der Frage im Band. */
  readonly category?: QuestionCategory | null;
  readonly onExpire: () => void;
  readonly onAnswerTrivia: (token: string) => void;
}) {
  const locked = !open || busy || sent !== null;
  return (
    <section
      className={`sheet question-sheet${density(question)}${open ? '' : ' closed'}`}
      aria-labelledby="question-prompt"
      data-testid="match-question"
      data-kind={question.kind}
    >
      <header className="sheet-head">
        <p className="sheet-kind" data-category={category ?? undefined}>
          {category ? (
            <>
              <CategoryIcon category={category} size={18} />
              {t(`realm.category.${category}`)}
            </>
          ) : question.kind === 'TRIVIA' ? (
            t('quiz.trivia')
          ) : (
            t('quiz.estimate')
          )}
        </p>
      </header>
      <Countdown
        deadline={deadline}
        totalMs={question.timeLimitMs}
        onExpire={open ? onExpire : noop}
        brief
      />
      {reloaded ? <p className="sheet-note">{t('quiz.reloaded')}</p> : null}
      <h2 id="question-prompt" className="sheet-prompt">
        {question.prompt}
      </h2>
      {question.kind === 'TRIVIA' ? (
        <ul className="sheet-options">
          {question.options.map((option, i) => (
            <li key={option.token}>
              <button
                type="button"
                className={`option${sent?.optionToken === option.token ? ' chosen' : ''}`}
                disabled={locked}
                aria-pressed={sent?.optionToken === option.token ? true : undefined}
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
        <>
          <p className={`estimate-entry${sent ? ' sent' : ''}`}>
            <span className="visually-hidden">
              {t('quiz.estimateLabel')}
              {question.unitLabel ? ` ${t('quiz.estimateUnit', { unit: question.unitLabel })}` : ''}
              {': '}
            </span>
            <span className="estimate-value" data-testid="estimate-value" aria-live="polite">
              {/* Zu zeigt die Karte nur, was abgeschickt wurde: lieber keine Zahl als eine, die nicht zählt */}
              {showEstimate(sent?.rawInput ?? (open ? estimate : ''))}
              {open && !sent ? <i className="caret" aria-hidden="true" /> : null}
            </span>
            {question.unitLabel ? (
              <span className="estimate-unit" aria-hidden="true">
                {question.unitLabel}
              </span>
            ) : null}
          </p>
          <p className="estimate-note">
            {question.answerPrecision === 0
              ? t('quiz.estimateWhole')
              : tp('quiz.estimatePrecision', question.answerPrecision)}
          </p>
        </>
      )}
    </section>
  );
}
