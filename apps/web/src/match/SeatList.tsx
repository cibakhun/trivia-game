import type { MatchView } from '@rdw/protocol';
import { DEFAULT_MATCH_RULES } from '@rdw/protocol';
import { CountUp } from '../art/CountUp.tsx';
import { LifeShields } from '../art/LifeShields.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { t, tp } from '../i18n/i18n.ts';
import type { SeatName } from './match-text.ts';

/**
 * Spielstand je Sitz als Wappenbanner: Wappen (Farbe und Bild), Name, Punkte (zählen bei
 * Änderungen hoch), Regionen und Hauptstadtleben als Schilde. Wer gerade wählt, leuchtet.
 */
export function SeatList({ view, name }: { readonly view: MatchView; readonly name: SeatName }) {
  const board = view.board;
  if (!board) return null;
  const chooser = view.phase?.kind === 'PICK' ? board.step.chooser : null;
  const maxLives = Math.max(
    DEFAULT_MATCH_RULES.capital.lives,
    ...board.seats.map((s) => s.capitalLivesLeft),
  );
  return (
    <section className="seat-list" aria-labelledby="seats-title" data-testid="match-seats">
      <h2 id="seats-title" className="visually-hidden">
        {t('match.seats.title')}
      </h2>
      <ul style={{ ['--seats' as string]: board.seats.length }}>
        {board.seats.map((s) => (
          <li
            key={s.seat}
            className={[
              'seat',
              `seat-${s.seat}`,
              chooser === s.seat ? 'turn' : '',
              s.seat === view.mySeat ? 'me' : '',
              s.eliminated ? 'eliminated' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-seat={s.seat}
          >
            <span className="seat-mark">
              <SeatCrest seat={s.seat} size={34} />
            </span>
            <span className="seat-name">
              <strong>{name(s.seat)}</strong>
              {chooser === s.seat ? <span className="badge">{t('match.seats.turn')}</span> : null}
              {s.eliminated ? <span className="badge">{t('match.seats.eliminated')}</span> : null}
            </span>
            <span className="seat-facts">
              <span className="seat-points">
                <CountUp value={s.points} render={(n) => tp('match.seats.points', n)} />
              </span>
              <span className="seat-regions">
                {' · '}
                {tp('match.seats.regions', s.regions)}
              </span>
              {s.capital !== null && !s.eliminated ? (
                <>
                  <span className="sep">{' · '}</span>
                  <LifeShields
                    left={s.capitalLivesLeft}
                    max={maxLives}
                    label={tp('match.board.lives', s.capitalLivesLeft)}
                  />
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
