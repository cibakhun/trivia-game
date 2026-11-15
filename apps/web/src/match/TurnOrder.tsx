import type { MatchView } from '@rdw/protocol';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { t } from '../i18n/i18n.ts';
import type { SeatName } from './match-text.ts';
import { useBorn } from './stage-live.ts';

/** Für Screenreader steht am eigenen Sitz kurz „Du“, sonst der Name. */
function shortName(view: MatchView, seat: number, name: SeatName): string {
  return seat === view.mySeat ? t('match.turns.you') : name(seat);
}

/**
 * Zugfolge des laufenden Abschnitts (MATCH_RULES §3, Zugfolge): eine schmale Zeile unter dem
 * Spielstand mit den Wappen in der Reihenfolge, in der gewählt oder angegriffen wird. Wer dran
 * ist, trägt einen goldenen Rand; wer schon dran war, einen Haken. Bei der Schätzfrage der
 * Landnahme, der Startfrage und in der Rüstzeit sind alle zugleich dran. Die Zeile ist immer gleich
 * hoch und verschiebt nichts. Ist einer dran, liegt der goldene Rand als eigene Marke unter den
 * Wappen (`ol::before`, kein Listenpunkt) und wandert von Platz zu Platz (stage.css, alle Plätze
 * sind gleich breit); der Haken dessen, der eben dran war, setzt sich. Namen stehen nur für
 * Screenreader da: Die Wappen stehen direkt darüber im Spielstand.
 */
export function TurnOrder({
  view,
  name,
  skipped = [],
}: {
  readonly view: MatchView;
  readonly name: SeatName;
  /** Partie mit Ausbau: Reiche, deren Angriff in dieser Runde ausfiel (ADR-064). */
  readonly skipped?: readonly number[];
}) {
  // Mit Ausbau steht die Zugfolge im Brett der Partie mit Ausbau (`realm.board`)
  const board = view.board ?? view.realm?.board ?? null;
  if (!board || board.turns.length === 0) return null;
  const kind = board.step.kind;
  const label =
    kind === 'CAPITAL_PICK'
      ? t('match.turns.CAPITAL_PICK')
      : kind === 'LAND_ESTIMATE'
        ? t('match.turns.LAND_ESTIMATE')
        : kind === 'LAND_PICK'
          ? t('match.turns.LAND_PICK')
          : kind === 'START_ESTIMATE' ||
              kind === 'CASTLE_PICK' ||
              kind === 'VILLAGE_PICK' ||
              kind === 'PREPARE'
            ? t(`realm.turns.${kind}`)
            : t('match.turns.CAMPAIGN');
  // Schätzfrage an alle und Rüstzeit: Alle sind zugleich dran, eine Reihenfolge gibt es nicht
  const preparing = kind === 'PREPARE';
  const together = kind === 'LAND_ESTIMATE' || kind === 'START_ESTIMATE' || preparing;
  // Stelle dessen, der dran ist: Dort liegt die Marke; -1, wenn keiner oder alle zugleich dran sind
  const now = together ? -1 : board.turns.findIndex((turn) => turn.status === 'NOW');
  const statusText = (status: 'DONE' | 'NOW' | 'NEXT') =>
    preparing && status !== 'NEXT'
      ? t(status === 'DONE' ? 'realm.seats.ready' : 'realm.seats.busy')
      : t(`match.turns.status.${status}`);
  return (
    <section className="turn-order" aria-labelledby="turns-title" data-testid="match-turns">
      <h2 id="turns-title" className="turn-order-label">
        {label}
      </h2>
      <ol
        className={together ? 'together' : now < 0 ? undefined : 'marked'}
        style={now < 0 ? undefined : { ['--turn-now' as string]: now }}
      >
        {board.turns.map((turn, i) => {
          // Wer aussetzt, war nicht dran: ein Strich statt des Hakens
          const out = turn.status === 'DONE' && skipped.includes(turn.seat);
          return (
            <li
              key={i}
              className={`turn-step turn-${turn.status.toLowerCase()} seat-${turn.seat}${
                turn.seat === view.mySeat ? ' me' : ''
              }${out ? ' turn-skipped' : ''}`}
              data-seat={turn.seat}
              data-status={turn.status}
              data-skipped={out ? 'true' : undefined}
            >
              {together ? null : (
                <TurnIndex
                  key={out ? 'out' : turn.status === 'DONE' ? 'done' : 'open'}
                  text={out ? '–' : turn.status === 'DONE' ? '✓' : String(i + 1)}
                />
              )}
              <SeatCrest seat={turn.seat} size={18} />
              <span className="visually-hidden">
                {shortName(view, turn.seat, name)},{' '}
                {out ? t('realm.turns.skipped') : statusText(turn.status)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Zahl, Haken oder Strich vor dem Wappen; ein Wechsel, den die Bühne miterlebt, setzt sich kurz. */
function TurnIndex({ text }: { readonly text: string }) {
  const born = useBorn();
  return (
    <span className={born ? 'turn-index arriving' : 'turn-index'} aria-hidden="true">
      {text}
    </span>
  );
}
