import type { MatchEventOf, MatchView } from '@rdw/protocol';
import { formatNumber, t, tp } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { seatMark } from './MatchBoard.tsx';
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
    <section className="resolution" aria-labelledby="result-title" data-testid="match-result">
      <h1 id="result-title" className={mine?.place === 1 ? 'won' : ''}>
        {headline}
      </h1>
      {finished ? <p>{t(`match.result.reason.${finished.payload.reason}`)}</p> : null}
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
            <tr key={s.seat} data-seat={s.seat} className={`seat-${s.seat}`}>
              <td>{s.place}.</td>
              <th scope="row">
                <span className="seat-mark" aria-hidden="true">
                  {seatMark(s.seat)}
                </span>{' '}
                {name(s.seat)}
              </th>
              <td>{formatNumber(s.points)}</td>
              <td>{formatNumber(s.regions)}</td>
              <td>
                {s.eliminated
                  ? t('match.result.eliminated')
                  : tp('match.board.lives', s.capitalLives)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
