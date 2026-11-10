import type { BattleSide, ParticipantRole, Resolution } from '@rdw/protocol';
import { formatDecimal, formatTime, hasMessage, t, tDynamic, tp } from '../i18n/i18n.ts';

/**
 * Vollständige Auflösung nach dem Kampf (QUIZ_ENGINE §7.2): Ergebnis, Grund, Lösung und beide
 * Seiten mit Antwort, Schätzung, Abstand und effektiver Zeit. Aus Sicht der eigenen Rolle: Im PvP
 * sieht der Verteidiger sein Ergebnis und seine Verteidigungspunkte.
 */
export function ResolutionView({
  resolution,
  role = 'ATTACKER',
  onDone,
}: {
  readonly resolution: Resolution;
  readonly role?: ParticipantRole;
  readonly onDone: () => void;
}) {
  const capital = resolution.capital;
  const defending = role === 'DEFENDER';
  // Ohne Sieger (abgebrochen, verfallen, Gate ohne Verteidigung) ist die Überschrift neutral
  const won = resolution.winner === (defending ? 'DEFENDER' : 'ATTACKER');
  const headline = defending
    ? resolution.winner === 'ATTACKER'
      ? capital
        ? capital.takenOver
          ? t('result.defenseTakenOver')
          : t('result.defenseCapitalHit')
        : t('result.defenseLost')
      : resolution.winner === 'DEFENDER'
        ? t('result.defenseWon')
        : t('result.defenseNone')
    : resolution.winner === 'ATTACKER'
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
  const attackerName = resolution.attacker.kingdom?.name ?? t('result.opponent');
  // Fehlt ein Text aus Verteidigersicht, gilt der allgemeine
  const defenderReason = `result.reasonDefender.${resolution.reason}`;
  const reasonText = tDynamic(
    defending && hasMessage(defenderReason) ? defenderReason : `result.reason.${resolution.reason}`,
    'errors.generic',
  );
  const mine = defending ? resolution.defender : resolution.attacker;
  const theirs = defending ? resolution.attacker : resolution.defender;
  return (
    <section className="resolution" aria-labelledby="result-title" data-testid="resolution">
      <h1
        id="result-title"
        className={resolution.winner === 'NONE' ? undefined : won ? 'won' : 'lost'}
      >
        {headline}
      </h1>
      <p>{reasonText}</p>
      {capital ? (
        <p data-testid="capital-effect">
          {defending
            ? capital.takenOver
              ? tp('result.defenseRegionsTaken', capital.regionsTaken, { name: attackerName })
              : tp('result.defenseCapitalLivesLeft', capital.livesLeft, { max: capital.maxLives })
            : capital.takenOver
              ? tp('result.regionsTaken', capital.regionsTaken, { name: defenderName })
              : tp('result.capitalLivesLeft', capital.livesLeft, {
                  name: defenderName,
                  max: capital.maxLives,
                })}
        </p>
      ) : null}
      {defending && resolution.mode === 'PVP' ? (
        <p data-testid="defense-points">
          {resolution.defensePoints > 0
            ? tp('result.defensePoints', resolution.defensePoints)
            : t('result.defenseNoPoints')}
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
          <SideRow label={t('result.answer')} pick={(s) => triviaText(s)} sides={[mine, theirs]} />
          {resolution.estimate ? (
            <>
              <SideRow
                label={t('result.estimateValue')}
                pick={(s) => (s.estimate ? formatDecimal(s.estimate) : t('result.noAnswer'))}
                sides={[mine, theirs]}
              />
              <SideRow
                label={t('result.distance')}
                pick={(s) => (s.estimateDistance ? formatDecimal(s.estimateDistance) : '–')}
                sides={[mine, theirs]}
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
                sides={[mine, theirs]}
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

/** Zeile der Vergleichstabelle: erst die eigene Seite („Du“), dann der Gegner. */
function SideRow({
  label,
  pick,
  sides,
}: {
  readonly label: string;
  readonly pick: (side: BattleSide) => string;
  readonly sides: readonly [BattleSide, BattleSide];
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{pick(sides[0])}</td>
      <td>{pick(sides[1])}</td>
    </tr>
  );
}
