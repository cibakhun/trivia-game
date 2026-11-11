import type { MatchView, ParsedMatchEvent } from '@rdw/protocol';
import type { ReactNode } from 'react';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { t } from '../i18n/i18n.ts';
import { shownPick } from './match-model.ts';
import { logText, questionContext, type RegionName, type SeatName } from './match-text.ts';
import { SeatChip } from './SeatChip.tsx';

/**
 * Ansage (ADR-053, docs/ART_DIRECTION.md §4): Die Karte zeigt, was eben geschah oder gleich
 * geschieht, die Leiste sagt es in einem Satz. Vor einem Duell steht, wo angegriffen wird (aus der
 * Sicht dieses Sitzes) und wer wen angreift; sonst die letzte Wahl mit dem Wappen dessen, der
 * gewählt hat. Es gibt nichts zu tun: Die Zeit läuft nur als schmaler Strich ohne Zahl.
 */
export function AnnouncePanel({
  view,
  events,
  name,
  region,
  fallback,
  timer,
}: {
  readonly view: MatchView;
  readonly events: readonly ParsedMatchEvent[];
  readonly name: SeatName;
  readonly region: RegionName;
  /** Satz, falls das jüngste Ereignis keine Wahl ist (etwa nach einem Neuladen). */
  readonly fallback: string | null;
  /** Ablaufende Zeit der Ansage eines Duells. */
  readonly timer: ReactNode;
}) {
  const step = view.board?.step;
  if (
    step?.kind === 'DUEL_TRIVIA' &&
    step.attacker !== null &&
    step.defender !== null &&
    step.region !== null
  ) {
    const mine =
      step.defender === view.mySeat
        ? 'attacked'
        : step.attacker === view.mySeat
          ? 'attacking'
          : 'other';
    const capital = view.board?.regions[step.region]?.capitalOf === step.defender;
    return (
      <section
        className={`card pick-card announce-card announce-duel announce-${mine}`}
        data-testid="match-announce"
        aria-live="polite"
      >
        <p className="announce-title">
          {t(`match.announce.${mine}${capital ? 'Capital' : ''}`, { region: region(step.region) })}
        </p>
        <p className="visually-hidden">{questionContext(view, name, region)}</p>
        <p className="announce-versus" aria-hidden="true">
          <SeatChip seat={step.attacker} name={name} />
          <span>{t('match.announce.verbLead')}</span>
          <SeatChip seat={step.defender} name={name} />
          <span>{t('match.announce.verbTail')}</span>
        </p>
        {timer}
      </section>
    );
  }
  const pick = shownPick(events);
  return (
    <section
      className="card pick-card announce-card"
      data-testid="match-announce"
      aria-live="polite"
    >
      <p className="announce-line">
        {pick ? <SeatCrest seat={pick.payload.seat} size={26} /> : null}
        <strong>
          {pick ? logText(pick, name, region) : (fallback ?? t('match.announce.next'))}
        </strong>
      </p>
    </section>
  );
}
