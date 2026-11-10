import { SeatCrest } from '../art/SeatCrest.tsx';
import { formatDecimal, formatNumber, t } from '../i18n/i18n.ts';
import type { Reveal } from './match-model.ts';
import { outcomeTexts, type RegionName, type SeatName } from './match-text.ts';

/**
 * Auflösung einer Frage für alle Sitze, auch für Zuschauer: Frage, richtige Antwort, Antwort
 * jedes Sitzes und die Folge (Rangfolge der Landnahme oder Ausgang des Duells).
 */
export function RevealPanel({
  reveal,
  name,
  region,
}: {
  readonly reveal: Reveal;
  readonly name: SeatName;
  readonly region: RegionName;
}) {
  const { resolved, opened, outcome } = reveal;
  const q = resolved.payload;
  const solution = q.solution;
  const unit = 'unit' in solution && solution.unit ? ` ${solution.unit}` : '';
  const lines = outcome.flatMap((o) => outcomeTexts(o, name, region));
  // Wissensfrage im Duell ohne Ausgang: beide richtig, die Schätzfrage folgt
  if (lines.length === 0 && opened?.payload.purpose === 'DUEL_TRIVIA') {
    lines.push(t('match.reveal.bothCorrect'));
  }

  return (
    <section className="resolution" aria-labelledby="reveal-title" data-testid="match-reveal">
      <h2 id="reveal-title">{t('match.reveal.title')}</h2>
      <div className="result-question">
        <p className="muted">{q.kind === 'TRIVIA' ? t('quiz.trivia') : t('quiz.estimate')}</p>
        <p>
          <strong>{q.prompt}</strong>
        </p>
        {'optionToken' in solution ? (
          <ul className="result-options">
            {q.options.map((o) => (
              <li key={o.token} className={o.token === solution.optionToken ? 'correct' : ''}>
                {o.token === solution.optionToken ? (
                  <span className="tick" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
                {o.text}
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="reveal-solution">
            {t('match.reveal.solution', {
              answer: solution.value === null ? '?' : `${formatDecimal(solution.value)}${unit}`,
            })}
          </p>
        )}
      </div>
      <div className="table-wrap">
        <table className="sides">
          <thead>
            <tr>
              <th scope="col">{t('match.reveal.player')}</th>
              <th scope="col">{t('match.reveal.answer')}</th>
              <th scope="col">{t('match.reveal.result')}</th>
              {q.kind === 'ESTIMATE' ? <th scope="col">{t('match.reveal.time')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {q.answers.map((a) => (
              <tr
                key={a.seat}
                data-seat={a.seat}
                className={q.kind === 'TRIVIA' && a.answered ? (a.correct ? 'right' : 'wrong') : ''}
              >
                <th scope="row">
                  <span className="who">
                    <SeatCrest seat={a.seat} size={22} />
                    {name(a.seat)}
                  </span>
                </th>
                <td>
                  {!a.answered
                    ? t('match.reveal.noAnswer')
                    : q.kind === 'TRIVIA'
                      ? (a.optionText ?? '?')
                      : `${a.value === null ? '?' : formatDecimal(a.value)}${unit}`}
                </td>
                <td className="verdict">
                  {q.kind === 'TRIVIA'
                    ? a.correct
                      ? t('result.correct')
                      : t('result.wrong')
                    : a.distance === null
                      ? '–'
                      : t('match.reveal.distance', { value: formatDecimal(a.distance) })}
                </td>
                {q.kind === 'ESTIMATE' ? (
                  <td>
                    {a.effectiveMs === null
                      ? '–'
                      : t('result.seconds', {
                          value: formatNumber(Math.round(a.effectiveMs / 100) / 10),
                        })}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lines.length > 0 ? (
        <ul className="outcome" data-testid="reveal-outcome">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
      {q.explanation ? (
        <p className="muted">
          {t('result.explanation')}: {q.explanation}
        </p>
      ) : null}
    </section>
  );
}
