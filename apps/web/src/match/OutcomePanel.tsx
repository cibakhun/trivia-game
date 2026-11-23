import { DEFAULT_MATCH_RULES, type MatchBoard, type MatchEventOf } from '@rdw/protocol';
import { LifeShields } from '../art/LifeShields.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { t, tp } from '../i18n/i18n.ts';
import { outcomeTexts, type RegionName, type SeatName } from './match-text.ts';
// Liste der Folgen und „Als Nächstes“ sehen aus wie im Blatt der Partie mit Ausbau
import './realm.css';

type Duel = MatchEventOf<'DUEL_RESOLVED'>;

/** Eine Folge des Ausgangs als kurze Zeile: mit Münze, mit Schilden der Hauptstadt oder Wappen. */
export type OutcomeFact =
  | { readonly icon: 'coin'; readonly text: string }
  | { readonly icon: 'lives'; readonly seat: number; readonly left: number; readonly text: string }
  | { readonly icon: 'crest'; readonly seat: number; readonly text: string };

/**
 * Was der Ausgang auf der Karte ändert (ADR-080), aus der Sicht dieses Sitzes: wohin das Feld mit
 * seinen Punkten geht, wie viele Leben der Hauptstadt bleiben, dass ein ganzes Reich übergeht,
 * was ein gehaltenes Feld jetzt wert ist.
 */
export function outcomeFacts(duel: Duel, mySeat: number | null, name: SeatName): OutcomeFact[] {
  const p = duel.payload;
  const value = p.regionValue;
  switch (p.effect) {
    case 'CONQUERED':
      return [
        {
          icon: 'coin',
          text:
            p.attacker === mySeat
              ? t('match.outcome.fact.conqueredMe', { value })
              : t('match.outcome.fact.conquered', { value, attacker: name(p.attacker) }),
        },
      ];
    case 'CAPITAL_HIT': {
      const left = p.capitalLivesLeft ?? 0;
      return [
        {
          icon: 'lives',
          seat: p.defender,
          left,
          text:
            p.defender === mySeat
              ? tp('match.outcome.fact.capitalLivesMe', left)
              : tp('match.outcome.fact.capitalLives', left),
        },
      ];
    }
    case 'TAKEOVER':
      return [
        {
          icon: 'crest',
          seat: p.attacker,
          text:
            p.defender === mySeat
              ? t('match.outcome.fact.takeoverLost', { attacker: name(p.attacker) })
              : p.attacker === mySeat
                ? t('match.outcome.fact.takeoverMe', { defender: name(p.defender) })
                : t('match.outcome.fact.takeover', {
                    attacker: name(p.attacker),
                    defender: name(p.defender),
                  }),
        },
      ];
    case 'FORTIFIED':
      return [{ icon: 'coin', text: t('match.outcome.fact.fortified', { value }) }];
  }
}

/** Was nach dem Ausgang kommt. */
export interface OutcomeNext {
  /** Eine neue Runde beginnt mit dem nächsten Angriff: ihre Zeile darüber. */
  readonly round: string | null;
  readonly seat: number | null;
  readonly text: string;
}

/**
 * Was nach dem Ausgang kommt, aus dem Schritt, in dem die Partie schon steht (wie mit Ausbau):
 * wer als Nächstes angreift, ob damit eine neue Runde beginnt, oder die Abrechnung.
 */
export function outcomeNext(
  duel: Duel,
  board: MatchBoard,
  rounds: number,
  mySeat: number | null,
  name: SeatName,
): OutcomeNext | null {
  const { step } = board;
  if (step.kind === 'FINISHED')
    return { round: null, seat: null, text: t('match.outcome.nextEnd') };
  if (step.kind !== 'CAMPAIGN_TARGET' || step.chooser === null) return null;
  const round =
    step.round !== null && step.round > duel.payload.round
      ? step.round === rounds
        ? t('match.moment.lastRound')
        : t('match.moment.round', { round: step.round, rounds })
      : null;
  return {
    round,
    seat: step.chooser,
    text:
      step.chooser === mySeat
        ? t('match.outcome.nextAttackMe')
        : t('match.outcome.nextAttack', { name: name(step.chooser) }),
  };
}

/**
 * Ausgang eines Duells in der Leiste (docs/ART_DIRECTION.md §4): Während die Karte zeigt, was
 * geschieht, steht hier in einem Satz aus der Sicht dieses Sitzes, wer die Region hat, mit dem
 * Wappen des Siegers. Darunter klein der Grund, dann was sich ändert und, mit dem Stand der Karte
 * (`board`), was als Nächstes kommt (ADR-080). Die Antworten standen davor im Blatt der
 * Auflösung; Screenreader bekommen hier den ganzen Satz.
 */
export function OutcomePanel({
  duel,
  mySeat,
  name,
  region,
  board = null,
  rounds = 0,
}: {
  readonly duel: Duel;
  readonly mySeat: number | null;
  readonly name: SeatName;
  readonly region: RegionName;
  /** Stand der Karte nach dem Duell: Daraus folgt, was als Nächstes kommt. */
  readonly board?: MatchBoard | null;
  /** Runden des Feldzugs. */
  readonly rounds?: number;
}) {
  const p = duel.payload;
  const role = p.attacker === mySeat ? 'attacker' : p.defender === mySeat ? 'defender' : 'other';
  const winner = p.winner === 'ATTACKER' ? p.attacker : p.defender;
  // Eigener Sieg, eigene Niederlage oder das Duell anderer
  const tone = role === 'other' ? 'other' : winner === mySeat ? 'won' : 'lost';
  const [reason, sentence] = outcomeTexts(duel, name, region);
  const facts = outcomeFacts(duel, mySeat, name);
  const next = board ? outcomeNext(duel, board, rounds, mySeat, name) : null;
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
      <ul className="outcome-list">
        {facts.map((fact, i) => (
          <li key={i} className={fact.icon === 'coin' ? undefined : `seat-${fact.seat}`}>
            {fact.icon === 'coin' ? (
              <svg className="points-coin" viewBox="-50 -50 100 100" aria-hidden="true">
                <circle r="40" strokeWidth="12" />
              </svg>
            ) : fact.icon === 'lives' ? (
              <span className="fact-lives" aria-hidden="true">
                <LifeShields
                  left={fact.left}
                  max={DEFAULT_MATCH_RULES.capital.lives}
                  label={fact.text}
                />
              </span>
            ) : (
              <SeatCrest seat={fact.seat} size={18} />
            )}
            <span>{fact.text}</span>
          </li>
        ))}
      </ul>
      {next ? (
        <div className="next">
          <h3>{t('realm.outcome.next')}</h3>
          {next.round ? <p className="next-round">{next.round}</p> : null}
          <p>
            {next.seat === null ? null : <SeatCrest seat={next.seat} size={16} />}
            {next.text}
          </p>
        </div>
      ) : null}
    </section>
  );
}
