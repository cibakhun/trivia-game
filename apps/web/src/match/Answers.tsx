import type { MatchView } from '@rdw/protocol';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { formatEstimateFigure, t } from '../i18n/i18n.ts';
import type { LocalQuestion, Reveal } from './match-model.ts';
import type { SeatName } from './match-text.ts';
import { Stamp } from './RevealPanel.tsx';
import { useKept } from './stage-live.ts';

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

type Resolved = Reveal['resolved']['payload'];
type Answer = Resolved['answers'][number];

/**
 * Wer an der laufenden Frage schon geantwortet hat (API.md §2.6, `question.answered`): je Sitz der
 * Frage eine Zeile, nur dass, nie was. Die eigene Antwort zählt sofort, auch ehe der Server sie
 * bestätigt. Ohne Bewegung: Die Fragezeit läuft.
 *
 * In der Auflösung (`reveal`) deckt dieselbe Liste auf, was jeder gegeben hat: Die Zeilen bleiben
 * stehen, an die Stelle von „hat geantwortet“ tritt die Antwort mit ihrem Buchstaben, die Zeile
 * füllt sich in der Farbe des Sitzes wie sein Feld auf der Karte in der Mitte, und der Stempel
 * (richtig oder falsch) setzt sich im selben Augenblick wie dort. So steht neben der Karte mit
 * Namen, wer was gewählt hat (Thread „Zuschauen eindeutiger“).
 */
export function Answers({
  view,
  local,
  short,
  reveal = null,
}: {
  readonly view: MatchView;
  readonly local: LocalQuestion | null;
  readonly short: SeatName;
  /** Auflösung dieser Frage: Die Liste zeigt dann die Antworten selbst. */
  readonly reveal?: Reveal | null;
}) {
  // Stand die Liste schon auf der Seite davor (während der Frage), schreibt sie sich beim
  // Umschlagen nicht neu ein: Nur die Antworten erscheinen in ihr
  const kept = useKept();
  const question = view.question;
  const resolved = reveal?.resolved.payload ?? null;
  const shown = resolved && (!question || question.seq === resolved.seq) ? resolved : null;
  if (shown) {
    // In der Reihenfolge der Frage, im Duell der Angreifer zuerst wie im Kopf des Duells. Es zählt,
    // wer in der Auflösung steht; wen die Ansicht nicht nennt, der kommt ans Ende
    const order = question?.seats ?? [];
    const at = (seat: number) => {
      const i = order.indexOf(seat);
      return i < 0 ? order.length : i;
    };
    const rows = [...shown.answers].sort((a, b) => at(a.seat) - at(b.seat));
    if (rows.length === 0) return null;
    return (
      <div
        className={`answers revealed${kept ? ' kept' : ''}`}
        data-testid="match-answers"
        data-kind={shown.kind}
      >
        <h3>{t('match.answers.title')}</h3>
        <ul>
          {rows.map((a) => (
            <RevealedRow key={a.seat} answer={a} resolved={shown} short={short} />
          ))}
        </ul>
      </div>
    );
  }
  if (!question || question.seats.length === 0) return null;
  // Eine abgeschickte, noch unbestätigte Antwort zählt nur, solange die Frage offen ist: Kam sie zu
  // spät, steht „verpasst“ im Blatt und hier nicht „abgegeben“
  const mine =
    question.myStatus === 'ANSWERED' ||
    (local?.seq === question.seq &&
      (local.status === 'ANSWERED' || (local.status === 'OPEN' && local.sent !== undefined)));
  return (
    <div className={`answers${kept ? ' kept' : ''}`} data-testid="match-answers">
      <h3>{t('match.answers.title')}</h3>
      <ul>
        {question.seats.map((seat) => {
          const me = seat === view.mySeat;
          const done = me ? mine : question.answered.includes(seat);
          return (
            <li key={seat} data-seat={seat} data-answered={done ? 'true' : 'false'}>
              <SeatCrest seat={seat} size={18} />
              <strong>{short(seat)}</strong>
              <span className={`answer-state${done ? ' on' : ''}`}>
                {done
                  ? t(me ? 'match.answers.answeredMe' : 'match.answers.answered')
                  : t(me ? 'match.answers.thinkingMe' : 'match.answers.thinking')}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Eine Zeile der Auflösung: Wappen und Name wie während der Frage, rechts die Antwort. Bei einer
 * Wissensfrage die Münze mit dem Buchstaben aus der Frage (darauf der Stempel) und der Text, bei
 * einer Schätzfrage die Zahl. Wer nicht geantwortet hat, bekommt keine Farbe.
 */
function RevealedRow({
  answer,
  resolved,
  short,
}: {
  readonly answer: Answer;
  readonly resolved: Resolved;
  readonly short: SeatName;
}) {
  const trivia = resolved.kind === 'TRIVIA';
  const index = trivia ? resolved.options.findIndex((o) => o.text === answer.optionText) : -1;
  const verdict = !answer.answered
    ? 'silent'
    : !trivia
      ? 'estimate'
      : answer.correct
        ? 'right'
        : 'wrong';
  const unit = 'unit' in resolved.solution ? (resolved.solution.unit ?? null) : null;
  return (
    <li
      className={`answer-row seat-${answer.seat} ${verdict}`}
      data-seat={answer.seat}
      data-answered={answer.answered ? 'true' : 'false'}
      data-verdict={verdict}
    >
      {answer.answered ? (
        <span className="reveal-fill" aria-hidden="true">
          <i className={`seat-${answer.seat}`} />
        </span>
      ) : null}
      <SeatCrest seat={answer.seat} size={18} />
      <strong>{short(answer.seat)}</strong>
      <span className="answer-pick">
        {!answer.answered ? (
          <span className="answer-none">{t('match.reveal.noAnswer')}</span>
        ) : trivia ? (
          <>
            <span className="reveal-mark" aria-hidden="true">
              {OPTION_KEYS[index] ?? ''}
              <Stamp kind={answer.correct ? 'right' : 'wrong'} />
            </span>
            <span className="answer-text">
              {answer.optionText}
              <span className="visually-hidden">
                {' '}
                ({t(answer.correct ? 'match.answers.right' : 'match.answers.wrong')})
              </span>
            </span>
          </>
        ) : (
          <span className="answer-text answer-figure">
            {answer.value === null ? '?' : formatEstimateFigure(answer.value)}
            {unit ? <small> {unit}</small> : null}
          </span>
        )}
      </span>
    </li>
  );
}
