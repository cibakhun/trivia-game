import type { MatchView } from '@rdw/protocol';
import { DEFAULT_MATCH_RULES } from '@rdw/protocol';
import { CountUp } from '../art/CountUp.tsx';
import { LifeShields } from '../art/LifeShields.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { formatNumber, t, tp } from '../i18n/i18n.ts';
import type { SeatName } from './match-text.ts';

/**
 * Spielstand links auf dem Meer (ADR-059): je Sitz eine Tafel mit Wappen (Farbe und Bild), Name,
 * Punkten als Münze mit Zahl (zählen bei Änderungen hoch) und Hauptstadtleben als Schilde, darunter
 * die Zahl der Regionen. Wer gerade wählt, trägt einen goldenen Rand und „am Zug“.
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
    <section className="plaques" aria-labelledby="seats-title" data-testid="match-seats">
      <h2 id="seats-title" className="visually-hidden">
        {t('match.seats.title')}
      </h2>
      <ul>
        {board.seats.map((s) => (
          <li
            key={s.seat}
            className={[
              'plaque',
              `seat-${s.seat}`,
              chooser === s.seat ? 'turn' : '',
              s.seat === view.mySeat ? 'me' : '',
              s.eliminated ? 'eliminated' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-seat={s.seat}
          >
            <span className="plaque-crest">
              <SeatCrest seat={s.seat} size={27} />
            </span>
            <strong className="plaque-name">{name(s.seat)}</strong>
            <span className="plaque-points">
              <svg className="points-coin" viewBox="-50 -50 100 100" aria-hidden="true">
                <circle r="40" strokeWidth="12" />
              </svg>
              <CountUp value={s.points} render={formatNumber} />
              <span className="visually-hidden"> {t('match.result.pointsColumn')}</span>
            </span>
            {s.capital !== null && !s.eliminated ? (
              <span className="plaque-lives">
                <LifeShields
                  left={s.capitalLivesLeft}
                  max={maxLives}
                  label={tp('match.board.lives', s.capitalLivesLeft)}
                />
              </span>
            ) : null}
            <span className="plaque-foot">
              {s.eliminated ? (
                <span className="plaque-out">{t('match.seats.eliminated')}</span>
              ) : (
                <span className="plaque-regions">{tp('match.seats.regions', s.regions)}</span>
              )}
              {chooser === s.seat ? (
                <span className="plaque-state">{t('match.seats.turn')}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
