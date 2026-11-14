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
 * weil die Fragezeit läuft (ARCHITECTURE §15). Wer nicht gefragt ist, liest dieselbe Karte mit
 * (`WatchedQuestionCard`, ADR-065).
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

/**
 * Band oben links: die Kategorie aus dem Glücksrad, sonst die Art der Frage. Die Auflösung trägt
 * als Rückseite der Karte dasselbe Band (`RevealPanel`).
 */
export function QuestionKind({
  kind,
  category,
}: {
  readonly kind: MatchPresentedQuestion['kind'];
  readonly category: QuestionCategory | null;
}) {
  return (
    <p className="sheet-kind" data-category={category ?? undefined}>
      {category ? (
        <>
          <CategoryIcon category={category} size={18} />
          {t(`realm.category.${category}`)}
        </>
      ) : kind === 'TRIVIA' ? (
        t('quiz.trivia')
      ) : (
        t('quiz.estimate')
      )}
    </p>
  );
}

/** Wie genau die Zahl einer Schätzfrage sein soll. */
function estimateNote(question: MatchPresentedQuestion & { readonly kind: 'ESTIMATE' }): string {
  return question.answerPrecision === 0
    ? t('quiz.estimateWhole')
    : tp('quiz.estimatePrecision', question.answerPrecision);
}

/**
 * Die Frage anderer zum Mitlesen (ADR-065, O-38): dieselbe Karte an derselben Stelle, aber nichts
 * daran lässt sich antippen, und sie zeigt nie, was die Gefragten wählen; das füllt erst die
 * Auflösung in ihren Farben. Die Lunte läuft das Zeitlimit der Frage ab ihrem Öffnen herunter.
 */
export function WatchedQuestionCard({
  question,
  deadline,
  category = null,
}: {
  readonly question: MatchPresentedQuestion;
  /** Ende des Zeitlimits der Frage als `performance.now()`-Wert. */
  readonly deadline: number;
  readonly category?: QuestionCategory | null;
}) {
  return (
    <section
      className={`sheet question-sheet watching${density(question)}`}
      aria-labelledby="question-prompt"
      data-testid="match-question-watched"
      data-kind={question.kind}
    >
      <header className="sheet-head">
        <QuestionKind kind={question.kind} category={category} />
        <span className="sheet-tag">{t('match.watch.tag')}</span>
      </header>
      <Countdown deadline={deadline} totalMs={question.timeLimitMs} onExpire={noop} brief />
      <h2 id="question-prompt" className="sheet-prompt">
        {question.prompt}
      </h2>
      {question.kind === 'TRIVIA' ? (
        <ul className="sheet-options">
          {question.options.map((option, i) => (
            <li key={option.token}>
              <span className="option-read">
                <span className="option-key" aria-hidden="true">
                  {OPTION_KEYS[i] ?? ''}
                </span>
                <span className="option-text">{option.text}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="estimate-entry watch">
            <span className="estimate-value">
              <span aria-hidden="true">?</span>
              <span className="visually-hidden">
                {question.unitLabel
                  ? t('match.watch.estimateUnit', { unit: question.unitLabel })
                  : t('match.watch.estimate')}
              </span>
            </span>
            {question.unitLabel ? (
              <span className="estimate-unit" aria-hidden="true">
                {question.unitLabel}
              </span>
            ) : null}
          </p>
          <p className="estimate-note">{estimateNote(question)}</p>
        </>
      )}
    </section>
  );
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
        <QuestionKind kind={question.kind} category={category} />
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
          <p className="estimate-note">{estimateNote(question)}</p>
        </>
      )}
    </section>
  );
}
