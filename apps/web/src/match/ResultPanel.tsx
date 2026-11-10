import type { MatchEventOf, MatchView } from '@rdw/protocol';
import { DEFAULT_MATCH_RULES } from '@rdw/protocol';
import { LifeShields } from '../art/LifeShields.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { formatNumber, t, tp } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import type { SeatName } from './match-text.ts';

/** Abrechnung (MATCH_RULES §6): Platz, Punkte, Regionen und Hauptstadtleben je Sitz. */
export function ResultPanel({
  view,
  finished,
  name,
}: {
  readonly view: MatchView;
  readonly finished: MatchEventOf<'MATCH_FINISHED'> | null;
  readonly name: SeatName;
}) {
  // Ohne das Ereignis (etwa nicht mehr im Speicher) zählt der Stand der Karte
  const standings =
    finished?.payload.standings ??
    [...(view.board?.seats ?? [])]
      .sort((a, b) => b.points - a.points)
      .map((s, i) => ({
        seat: s.seat,
        place: i + 1,
        points: s.points,
        regions: s.regions,
        capitalLives: s.capitalLivesLeft,
        eliminated: s.eliminated,
      }));
  const maxLives = Math.max(
    DEFAULT_MATCH_RULES.capital.lives,
    ...standings.map((s) => s.capitalLives),
  );
  const mine = standings.find((s) => s.seat === view.mySeat);
  const shared = mine?.place === 1 && standings.filter((s) => s.place === 1).length > 1;
  const headline =
    mine?.place === 1
      ? shared
        ? t('match.result.sharedWin')
        : t('match.result.won')
      : mine
        ? t('match.result.place', { place: mine.place })
        : t('match.result.title');

  return (
    <section
      className={`resolution result${mine?.place === 1 ? ' victory' : ''}`}
      aria-labelledby="result-title"
      data-testid="match-result"
    >
      {mine?.place === 1 ? <Laurel /> : null}
      <h1 id="result-title" className={mine?.place === 1 ? 'won' : ''}>
        {headline}
      </h1>
      {finished ? <p>{t(`match.result.reason.${finished.payload.reason}`)}</p> : null}
      <div className="table-wrap">
        <table className="sides">
          <thead>
            <tr>
              <th scope="col">{t('match.result.placeColumn')}</th>
              <th scope="col">{t('match.reveal.player')}</th>
              <th scope="col">{t('match.result.pointsColumn')}</th>
              <th scope="col">{t('match.result.regionsColumn')}</th>
              <th scope="col">{t('match.result.livesColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => (
              <tr
                key={s.seat}
                data-seat={s.seat}
                className={`seat-${s.seat} place-${s.place}${s.seat === view.mySeat ? ' me' : ''}${s.eliminated ? ' out' : ''}`}
              >
                <td>
                  <span className="place">{s.place}.</span>
                </td>
                <th scope="row">
                  <span className="who">
                    <SeatCrest seat={s.seat} size={24} />
                    {name(s.seat)}
                  </span>
                </th>
                <td>{formatNumber(s.points)}</td>
                <td>{formatNumber(s.regions)}</td>
                <td>
                  <LifeShields
                    left={s.eliminated ? 0 : s.capitalLives}
                    max={maxLives}
                    label={
                      s.eliminated
                        ? t('match.result.eliminated')
                        : tp('match.board.lives', s.capitalLives)
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.match.kind === 'TEST' ? <p className="muted">{t('match.result.test')}</p> : null}
      <div className="actions">
        <button
          type="button"
          className="button button-primary"
          onClick={() => navigate({ name: 'matches' })}
        >
          {t('match.result.again')}
        </button>
        <button type="button" className="button" onClick={() => navigate({ name: 'start' })}>
          {t('match.hub.back')}
        </button>
      </div>
    </section>
  );
}

/** Lorbeerkranz mit Krone über dem Sieg (eigene Zeichnung). */
function Laurel() {
  const leaves = Array.from({ length: 7 }, (_, i) => i);
  return (
    <svg className="laurel" viewBox="-60 -50 120 90" aria-hidden="true" focusable="false">
      <g className="laurel-rays">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M0 0L-4-46H4Z" transform={`rotate(${i * 30})`} />
        ))}
      </g>
      {[-1, 1].map((side) => (
        <g key={side} transform={`scale(${side} 1)`}>
          <path d="M-8 34C-34 28-46 6-40-18" className="laurel-stem" />
          {leaves.map((i) => {
            const angle = 200 + i * 20;
            const rad = (angle * Math.PI) / 180;
            const x = -4 + Math.cos(rad) * 38;
            const y = 4 + Math.sin(rad) * -30;
            return (
              <ellipse
                key={i}
                cx={x.toFixed(1)}
                cy={y.toFixed(1)}
                rx="9"
                ry="4"
                transform={`rotate(${(-angle + 120).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})`}
                className="laurel-leaf"
              />
            );
          })}
        </g>
      ))}
      <path
        d="M-20 4L-24-22L-11-10L0-28L11-10L24-22L20 4Z"
        className="laurel-crown"
        strokeLinejoin="round"
      />
      <circle cx="0" cy="-30" r="3.5" className="laurel-gem" />
    </svg>
  );
}
