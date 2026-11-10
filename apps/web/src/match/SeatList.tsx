import type { MatchView } from '@rdw/protocol';
import { t, tp } from '../i18n/i18n.ts';
import { seatMark } from './MatchBoard.tsx';
import type { SeatName } from './match-text.ts';

/** Spielstand je Sitz: Zeichen und Farbe, Name, Punkte, Regionen, Hauptstadtleben. */
export function SeatList({ view, name }: { readonly view: MatchView; readonly name: SeatName }) {
  const board = view.board;
  if (!board) return null;
  const chooser = view.phase?.kind === 'PICK' ? board.step.chooser : null;
  return (
    <section className="seat-list" aria-labelledby="seats-title" data-testid="match-seats">
      <h2 id="seats-title" className="visually-hidden">
        {t('match.seats.title')}
      </h2>
      <ul>
        {board.seats.map((s) => (
          <li
            key={s.seat}
            className={`seat seat-${s.seat}${s.eliminated ? ' eliminated' : ''}`}
            data-seat={s.seat}
          >
            <span className="seat-mark" aria-hidden="true">
              {seatMark(s.seat)}
            </span>
            <span className="seat-name">
              <strong>{name(s.seat)}</strong>
              {chooser === s.seat ? <span className="badge">{t('match.seats.turn')}</span> : null}
              {s.eliminated ? <span className="badge">{t('match.seats.eliminated')}</span> : null}
            </span>
            <span className="seat-facts">
              {tp('match.seats.points', s.points)} · {tp('match.seats.regions', s.regions)}
              {s.capital !== null && !s.eliminated ? (
                <>
                  {' · '}
                  <span className="hearts" aria-label={tp('match.board.lives', s.capitalLivesLeft)}>
                    {'♥'.repeat(s.capitalLivesLeft)}
                  </span>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
