import type { MatchEventOf } from '@rdw/protocol';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { t } from '../i18n/i18n.ts';
import { outcomeTexts, type RegionName, type SeatName } from './match-text.ts';

/**
 * Ausgang eines Duells in der Leiste (docs/ART_DIRECTION.md §4): Während die Karte zeigt, was
 * geschieht, steht hier in einem Satz aus der Sicht dieses Sitzes, wer die Region hat, mit dem
 * Wappen des Siegers. Darunter klein der Grund. Die Antworten folgen gleich danach im Blatt der
 * Auflösung; Screenreader bekommen hier schon den ganzen Satz.
 */
export function OutcomePanel({
  duel,
  mySeat,
  name,
  region,
}: {
  readonly duel: MatchEventOf<'DUEL_RESOLVED'>;
  readonly mySeat: number | null;
  readonly name: SeatName;
  readonly region: RegionName;
}) {
  const p = duel.payload;
  const role = p.attacker === mySeat ? 'attacker' : p.defender === mySeat ? 'defender' : 'other';
  const winner = p.winner === 'ATTACKER' ? p.attacker : p.defender;
  // Eigener Sieg, eigene Niederlage oder das Duell anderer
  const tone = role === 'other' ? 'other' : winner === mySeat ? 'won' : 'lost';
  const [reason, sentence] = outcomeTexts(duel, name, region);
  return (
    <section
      className={`outcome-card outcome-${tone} seat-${winner}`}
      data-testid="match-outcome"
      data-effect={p.effect}
      aria-live="polite"
    >
      <p className="outcome-title" aria-hidden="true">
        <SeatCrest seat={winner} size={30} />
        <span>
          {t(`match.outcome.${role}.${p.effect}`, {
            attacker: name(p.attacker),
            defender: name(p.defender),
            region: region(p.region),
          })}
        </span>
      </p>
      <p className="visually-hidden">{sentence}</p>
      <p className="outcome-reason">{reason}</p>
    </section>
  );
}
