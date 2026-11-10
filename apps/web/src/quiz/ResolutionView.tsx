import type { BattleSide, Resolution } from '@rdw/protocol';
import { formatDecimal, formatTime, t, tDynamic, tp } from '../i18n/i18n.ts';

/**
 * Vollständige Auflösung nach dem Kampf (QUIZ_ENGINE §7.2): Ergebnis, Grund, Lösung und beide
 * Seiten mit Antwort, Schätzung, Abstand und effektiver Zeit.
 */
export function ResolutionView({
  resolution,
  onDone,
}: {
  readonly resolution: Resolution;
  readonly onDone: () => void;
}) {
  const capital = resolution.capital;
  const headline =
    resolution.winner === 'ATTACKER'
      ? capital
        ? capital.takenOver
          ? t('result.takenOver')
          : t('result.capitalHit')
        : t('result.won')
      : resolution.winner === 'DEFENDER'
        ? t('result.lost')
        : t('result.none');
  const unit = resolution.estimate?.unitLabel;
  const defenderName = resolution.defender.kingdom?.name ?? t('result.opponent');
  return (
    <section className="resolution" aria-labelledby="result-title" data-testid="resolution">
      <h1 id="result-title" className={resolution.winner === 'ATTACKER' ? 'won' : 'lost'}>
        {headline}
      </h1>
      <p>{tDynamic(`result.reason.${resolution.reason}`, 'errors.generic')}</p>
      {capital ? (
        <p data-testid="capital-effect">
          {capital.takenOver
            ? tp('result.regionsTaken', capital.regionsTaken, { name: defenderName })
            : tp('result.capitalLivesLeft', capital.livesLeft, {
                name: defenderName,
                max: capital.maxLives,
              })}
        </p>
      ) : null}
      {capital?.protectedUntil ? (
        <p className="muted">
          {t('result.capitalProtectedUntil', { time: formatTime(capital.protectedUntil) })}
        </p>
      ) : null}
      {resolution.regionProtectedUntil ? (
        <p className="muted">
          {t('result.protectedUntil', { time: formatTime(resolution.regionProtectedUntil) })}
        </p>
      ) : null}

      {resolution.trivia ? (
        <div className="result-question">
          <h2>{t('quiz.trivia')}</h2>
          <p>{resolution.trivia.prompt}</p>
          <ul className="result-options">
            {resolution.trivia.options.map((option) => (
              <li key={option.text} className={option.correct ? 'correct' : ''}>
                {option.text}
                {option.correct ? ` – ${t('result.correctAnswer')}` : ''}
              </li>
            ))}
          </ul>
          {resolution.trivia.explanation ? (
            <p className="muted">{resolution.trivia.explanation}</p>
          ) : null}
        </div>
      ) : null}

      {resolution.estimate ? (
        <div className="result-question">
          <h2>{t('quiz.estimate')}</h2>
          <p>{resolution.estimate.prompt}</p>
          <p>
            {t('result.correctAnswer')}:{' '}
            <strong>
              {formatDecimal(resolution.estimate.answerValue)}
              {unit ? ` ${unit}` : ''}
            </strong>
          </p>
          {resolution.estimate.explanation ? (
            <p className="muted">{resolution.estimate.explanation}</p>
          ) : null}
        </div>
      ) : null}

      <table className="sides">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">{t('result.you')}</th>
            <th scope="col">{t('result.opponent')}</th>
          </tr>
        </thead>
        <tbody>
          <SideRow label={t('result.answer')} pick={(s) => triviaText(s)} resolution={resolution} />
          {resolution.estimate ? (
            <>
              <SideRow
                label={t('result.estimateValue')}
                pick={(s) => (s.estimate ? formatDecimal(s.estimate) : t('result.noAnswer'))}
                resolution={resolution}
              />
              <SideRow
                label={t('result.distance')}
                pick={(s) => (s.estimateDistance ? formatDecimal(s.estimateDistance) : '–')}
                resolution={resolution}
              />
              <SideRow
                label={t('result.time')}
                pick={(s) =>
                  s.estimateEffectiveMs === null
                    ? '–'
                    : t('result.seconds', {
                        value: formatDecimal((s.estimateEffectiveMs / 1000).toFixed(1)),
                      })
                }
                resolution={resolution}
              />
            </>
          ) : null}
        </tbody>
      </table>

      <button type="button" className="button button-primary" onClick={onDone}>
        {t('quiz.backToMap')}
      </button>
    </section>
  );
}

function triviaText(side: BattleSide): string {
  if (side.triviaAnswer === null) return t('result.noAnswer');
  return `${side.triviaAnswer} (${side.triviaCorrect ? t('result.correct') : t('result.wrong')})`;
}

function SideRow({
  label,
  pick,
  resolution,
}: {
  readonly label: string;
  readonly pick: (side: BattleSide) => string;
  readonly resolution: Resolution;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{pick(resolution.attacker)}</td>
      <td>{pick(resolution.defender)}</td>
    </tr>
  );
}
