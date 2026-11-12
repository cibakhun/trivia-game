import type { MatchView } from '@rdw/protocol';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { t } from '../i18n/i18n.ts';
import type { LocalQuestion } from './match-model.ts';
import type { SeatName } from './match-text.ts';

/**
 * Wer an der laufenden Frage schon geantwortet hat (API.md §2.6, `question.answered`): je Sitz der
 * Frage eine Zeile, nur dass, nie was. Die eigene Antwort zählt sofort, auch ehe der Server sie
 * bestätigt. Ohne Bewegung: Die Fragezeit läuft.
 */
export function Answers({
  view,
  local,
  short,
}: {
  readonly view: MatchView;
  readonly local: LocalQuestion | null;
  readonly short: SeatName;
}) {
  const question = view.question;
  if (!question || question.seats.length === 0) return null;
  // Eine abgeschickte, noch unbestätigte Antwort zählt nur, solange die Frage offen ist: Kam sie zu
  // spät, steht „verpasst“ im Blatt und hier nicht „abgegeben“
  const mine =
    question.myStatus === 'ANSWERED' ||
    (local?.seq === question.seq &&
      (local.status === 'ANSWERED' || (local.status === 'OPEN' && local.sent !== undefined)));
  return (
    <div className="answers" data-testid="match-answers">
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
