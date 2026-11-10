import type { MatchView } from '@rdw/protocol';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { Swords } from '../art/Swords.tsx';
import { t } from '../i18n/i18n.ts';
import { questionContext, type RegionName, type SeatName } from './match-text.ts';

/**
 * Kopf einer Duellfrage: Wappen des Angreifers und des Verteidigers stehen sich gegenüber, dazwischen
 * gekreuzte Schwerter, darunter die umkämpfte Region. Ohne Bewegung, weil die Fragezeit läuft
 * (ARCHITECTURE §15). Screenreader lesen den bisherigen Satz aus `questionContext`.
 */
export function DuelHeader({
  view,
  name,
  region,
}: {
  readonly view: MatchView;
  readonly name: SeatName;
  readonly region: RegionName;
}) {
  const step = view.board?.step;
  const sentence = questionContext(view, name, region);
  if (
    !step ||
    !sentence ||
    (step.kind !== 'DUEL_TRIVIA' && step.kind !== 'DUEL_ESTIMATE') ||
    step.attacker === null ||
    step.defender === null ||
    step.region === null
  ) {
    return sentence ? <p className="note">{sentence}</p> : null;
  }
  const side = (seat: number, role: 'attacker' | 'defender') => (
    <span className={`duel-side ${role} seat-${seat}${seat === view.mySeat ? ' me' : ''}`}>
      <SeatCrest seat={seat} size={34} />
      <span className="duel-name">{name(seat)}</span>
      <span className="duel-role">{t(`match.duelHead.${role}`)}</span>
    </span>
  );
  return (
    <div className="duel-head" data-testid="match-duel">
      <p className="visually-hidden">{sentence}</p>
      <div className="duel-sides" aria-hidden="true">
        {side(step.attacker, 'attacker')}
        <span className="duel-swords">
          <Swords size={34} />
        </span>
        {side(step.defender, 'defender')}
      </div>
      <p className="duel-title" aria-hidden="true">
        {step.kind === 'DUEL_ESTIMATE'
          ? t('match.duelHead.tiebreak', { region: region(step.region) })
          : t('match.duelHead.title', { region: region(step.region) })}
      </p>
    </div>
  );
}
