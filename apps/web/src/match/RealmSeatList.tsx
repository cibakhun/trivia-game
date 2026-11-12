import type { MatchView } from '@rdw/protocol';
import { CountUp } from '../art/CountUp.tsx';
import { LifeShields } from '../art/LifeShields.tsx';
import { Amount } from '../art/RealmIcons.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { formatNumber, t, tp } from '../i18n/i18n.ts';
import type { SeatName } from './match-text.ts';
import type { RealmPlay } from './realm-model.ts';

/**
 * Spielstand der Partie mit Ausbau links auf dem Meer (MATCH_RULES §11): je Reich eine Tafel mit
 * Wappen, Name und Punkten, darunter die Leben seiner Burgen und die Vorräte an Brot und Baustoff.
 * In der Rüstzeit steht daneben, wer schon fertig ist und wer noch rüstet; wer gerade wählt, trägt
 * einen goldenen Rand und „am Zug“.
 */

/** Ab so vielen Leben steht statt einzelner Schilde eine Zahl (zwei Burgen). */
const SHIELDS_MAX = 3;

type SeatStatus = 'ready' | 'busy' | 'turn' | null;

export function RealmSeatList({
  view,
  play,
  name,
}: {
  readonly view: MatchView;
  readonly play: RealmPlay;
  readonly name: SeatName;
}) {
  const { board } = play;
  const preparing = view.phase?.kind === 'PREPARE';
  const chooser = view.phase?.kind === 'PICK' ? board.step.chooser : null;
  const statusOf = (seat: number): SeatStatus => {
    if (chooser === seat) return 'turn';
    if (!preparing) return null;
    const turn = board.turns.find((entry) => entry.seat === seat);
    return turn ? (turn.status === 'DONE' ? 'ready' : 'busy') : null;
  };
  return (
    <section className="plaques" aria-labelledby="seats-title" data-testid="match-seats">
      <h2 id="seats-title" className="visually-hidden">
        {t('match.seats.title')}
      </h2>
      <ul>
        {board.seats.map((s) => {
          const status = statusOf(s.seat);
          const maxLives = s.castles * play.castleLives;
          const lives = tp('realm.seats.castleLives', s.castleLivesLeft);
          return (
            <li
              key={s.seat}
              className={[
                'plaque',
                'realm',
                `seat-${s.seat}`,
                status === 'turn' ? 'turn' : '',
                s.seat === view.mySeat ? 'me' : '',
                s.eliminated ? 'eliminated' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-seat={s.seat}
              data-status={status ?? undefined}
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
              {s.eliminated || maxLives === 0 ? null : maxLives <= SHIELDS_MAX ? (
                <span className="plaque-lives">
                  <LifeShields left={s.castleLivesLeft} max={maxLives} label={lives} />
                </span>
              ) : (
                <span className="plaque-lives many">
                  <LifeShields left={1} max={1} label={lives} />
                  <span aria-hidden="true">{s.castleLivesLeft}</span>
                </span>
              )}
              <span className="plaque-foot">
                {s.eliminated ? (
                  <span className="plaque-out">{t('match.seats.eliminated')}</span>
                ) : (
                  <>
                    <Amount kind="bread" value={s.bread} label={t('realm.bread')} size={15} />
                    <Amount
                      kind="material"
                      value={s.material}
                      label={t('realm.material')}
                      size={15}
                    />
                  </>
                )}
                {status ? (
                  <span className={`plaque-state ${status}`}>
                    {status === 'turn' ? t('match.seats.turn') : t(`realm.seats.${status}`)}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
