import type { MatchPresentedQuestion, MatchView, QuestionCategory } from '@rdw/protocol';
import { Fragment } from 'react';
import { CategoryIcon } from '../art/RealmIcons.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { Swords } from '../art/Swords.tsx';
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
 * (`WatchedQuestionCard`, ADR-065). Die Antwortfelder sind der Anker (`data-anchor`): Auf sie legt
 * sich die Auflösung einer Wissensfrage, Feld auf Feld (`StageCentre`, ADR-070 Punkt 10).
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

/** Wer an der mitgelesenen Frage beteiligt ist und wer schon geantwortet hat (aus der Ansicht). */
export interface WatchedSeats {
  /** Sitze der Frage in der Reihenfolge des Servers. */
  readonly seats: readonly number[];
  readonly answered: readonly number[];
  /** Angreifer eines Duells: Er steht vorn, die gekreuzten Schwerter hinter ihm. */
  readonly attacker: number | null;
}

/**
 * Gefragte Sitze der laufenden Frage aus der Ansicht, für den Kopf der mitgelesenen Karte; `null`,
 * wenn die Ansicht keine Frage nennt.
 */
export function watchedSeats(
  question: MatchView['question'],
  attacker: number | null,
): WatchedSeats | null {
  if (!question || question.seats.length === 0) return null;
  return { seats: question.seats, answered: question.answered, attacker };
}

/** Das Zeichen „hat geantwortet“: goldene Münze mit Haken, wie die Münzen der Antworten. */
function Sealed() {
  return (
    <svg viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">
      <path
        d="M-5.6 0.4L-1.8 4.2L5.8-4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Kopf der mitgelesenen Frage: die Wappen derer, die gefragt sind, im Duell mit gekreuzten
 * Schwertern dazwischen (Angreifer vorn). Wer noch überlegt, trägt drei Punkte am Wappen, wer
 * geantwortet hat, eine goldene Münze mit Haken, die sich in dem Augenblick aufsetzt. Nie, was er
 * gewählt hat (O-38). Für Vorleser steht dabei, dass man zuschaut.
 */
function WatchDuel({ who }: { readonly who: WatchedSeats }) {
  const order =
    who.attacker !== null && who.seats.includes(who.attacker)
      ? [who.attacker, ...who.seats.filter((s) => s !== who.attacker)]
      : [...who.seats];
  const duel = who.attacker !== null && order.length === 2;
  return (
    <span className="watch-duel" data-testid="watch-duel">
      <span className="visually-hidden">{t('match.watch.tag')}</span>
      {order.map((seat, i) => {
        const done = who.answered.includes(seat);
        return (
          <Fragment key={seat}>
            {duel && i === 1 ? <Swords size={17} /> : null}
            <span
              className={`watch-seat seat-${seat}`}
              data-seat={seat}
              data-answered={done ? 'true' : 'false'}
              aria-hidden="true"
            >
              <SeatCrest seat={seat} size={22} />
              {done ? (
                <i className="watch-state done">
                  <Sealed />
                </i>
              ) : (
                <i className="watch-state thinking">
                  <b />
                  <b />
                  <b />
                </i>
              )}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

/**
 * Die Frage anderer zum Mitlesen (ADR-065, O-38): dieselbe Karte an derselben Stelle, aber nichts
 * daran lässt sich antippen, und sie zeigt nie, was die Gefragten wählen; das füllt erst die
 * Auflösung in ihren Farben. Die Lunte läuft das Zeitlimit der Frage ab ihrem Öffnen herunter.
 * Oben stehen die Wappen der Gefragten mit ihrem Stand (`WatchDuel`); ohne sie das Schild
 * „Du schaust zu“.
 */
export function WatchedQuestionCard({
  question,
  deadline,
  category = null,
  who = null,
}: {
  readonly question: MatchPresentedQuestion;
  /** Ende des Zeitlimits der Frage als `performance.now()`-Wert. */
  readonly deadline: number;
  readonly category?: QuestionCategory | null;
  readonly who?: WatchedSeats | null;
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
        {who && who.seats.length > 0 ? (
          <WatchDuel who={who} />
        ) : (
          <span className="sheet-tag">{t('match.watch.tag')}</span>
        )}
      </header>
      <Countdown deadline={deadline} totalMs={question.timeLimitMs} onExpire={noop} brief />
      <h2 id="question-prompt" className="sheet-prompt">
        {question.prompt}
      </h2>
      {question.kind === 'TRIVIA' ? (
        <ul className="sheet-options" data-anchor="">
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
        <ul className="sheet-options" data-anchor="">
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
