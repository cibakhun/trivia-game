import type { MatchTurn } from '@rdw/protocol';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { t, tp } from '../i18n/i18n.ts';
import type { Reveal } from './match-model.ts';
import type { SeatName } from './match-text.ts';

/**
 * Blatt rechts in der Auflösung einer Schätzfrage an alle (Landnahme, Startfrage mit Ausbau): Die
 * Karte in der Mitte zeigt die Rangfolge; hier steht, was daraus für den eigenen Sitz folgt und
 * was als Nächstes kommt, wie im Ausgang eines Duells (ADR-081). Vorher stand dort unter dem Satz
 * der Regel nur leeres Papier. Mit Ausbau steht nach der Startfrage auch, in welcher Reihenfolge
 * Burgen und Dörfer gesetzt werden: Die Dörfer gehen rückwärts, das sah man vorher nirgends.
 */

/** Was das Blatt vom Stand der Karte nach der Auflösung braucht (ohne und mit Ausbau gleich). */
export interface RankedBoard {
  readonly step: { readonly kind: string; readonly chooser: number | null };
  readonly regions: readonly { readonly owner: number | null }[];
}

export interface RankedSummary {
  /** Was für den eigenen Sitz folgt; wer zuschaut, liest, wer zuerst wählt. */
  readonly mine: { readonly seat: number; readonly text: string } | null;
  /** Landnahme: noch freie Felder. */
  readonly free: string | null;
  /** Startfrage mit Ausbau: Reihenfolge der Burgen und, rückwärts, der Dörfer. */
  readonly order: {
    readonly castles: readonly number[];
    readonly villages: readonly number[];
  } | null;
  readonly next: { readonly seat: number | null; readonly text: string } | null;
}

/** Stelle in einer Reihenfolge von `of`: zuerst, an zweiter Stelle, zuletzt. */
function position(place: number, of: number): string {
  if (place <= 1) return t('realm.ranked.posFirst');
  if (place >= of) return t('realm.ranked.posLast');
  return t('realm.ranked.posSecond');
}

/**
 * Was aus der Rangfolge folgt. `realm`: Partie mit Ausbau, dort heißen Regionen Felder. `null`,
 * wenn die Auflösung keine Rangfolge hat (ein Duell).
 */
export function rankedSummary(
  reveal: Reveal,
  board: RankedBoard | null,
  mySeat: number | null,
  name: SeatName,
  realm: boolean,
): RankedSummary | null {
  const land = reveal.outcome.find((o) => o.type === 'LAND_RANKED');
  const start = reveal.outcome.find((o) => o.type === 'START_RANKED');
  const answered = (seat: number) =>
    reveal.resolved.payload.answers.find((a) => a.seat === seat)?.answered ?? false;
  const step = board?.step ?? null;
  const chooser = step?.chooser ?? null;

  if (land) {
    const ranking = [...land.payload.ranking].sort((a, b) => a.place - b.place);
    const unit = realm ? 'realm.ranked' : 'match.ranked';
    const own = ranking.find((r) => r.seat === mySeat) ?? null;
    let mine: RankedSummary['mine'] = null;
    if (own) {
      const before = ranking.filter((r) => r.place < own.place && r.picks > 0).map((r) => r.seat);
      mine = {
        seat: own.seat,
        text:
          own.picks === 0
            ? t(answered(own.seat) ? `${unit}.none` : `${unit}.noneSilent`)
            : before.length === 0
              ? tp(`${unit}.first`, own.picks)
              : tp(`${unit}.after`, own.picks, {
                  names: before.map((seat) => name(seat)).join(t('match.ranked.and')),
                }),
      };
    } else {
      const lead = ranking.find((r) => r.picks > 0);
      if (lead) {
        mine = {
          seat: lead.seat,
          text: tp(`${unit}.lead`, lead.picks, { name: name(lead.seat) }),
        };
      }
    }
    const open = board ? board.regions.filter((r) => r.owner === null).length : null;
    return {
      mine,
      free: open === null ? null : tp(`${unit}.free`, open),
      order: null,
      next:
        step?.kind === 'LAND_PICK' && chooser !== null
          ? {
              seat: chooser,
              text:
                chooser === mySeat
                  ? t('match.ranked.nextMe')
                  : t('match.ranked.next', { name: name(chooser) }),
            }
          : null,
    };
  }

  if (start) {
    const castles = [...start.payload.ranking].sort((a, b) => a.place - b.place).map((r) => r.seat);
    const villages = [...castles].reverse();
    const at = castles.indexOf(mySeat ?? -1);
    let mine: RankedSummary['mine'] = null;
    if (mySeat !== null && at >= 0) {
      const castle = position(at + 1, castles.length);
      const village = position(villages.indexOf(mySeat) + 1, villages.length);
      mine = {
        seat: mySeat,
        text:
          castle === village
            ? t('realm.ranked.startSame', { order: castle })
            : t('realm.ranked.start', { castle, village }),
      };
    }
    return {
      mine,
      free: null,
      order: { castles, villages },
      next:
        step?.kind === 'CASTLE_PICK' && chooser !== null
          ? {
              seat: chooser,
              text:
                chooser === mySeat
                  ? t('realm.ranked.nextCastleMe')
                  : t('realm.ranked.nextCastle', { name: name(chooser) }),
            }
          : null,
    };
  }
  return null;
}

/**
 * Mehrere Wahlen nacheinander (Landnahme): die wievielte der eigenen Reihe gerade läuft und wie
 * viele es sind. `null`, wenn dieser Sitz nicht dran ist oder nur einmal wählt. In der Zugfolge
 * steht ein Sitz je Wahl, also auch zweimal hintereinander.
 */
export function pickRun(
  turns: readonly MatchTurn[],
  mySeat: number | null,
): { readonly nth: number; readonly of: number } | null {
  const now = turns.findIndex((turn) => turn.status === 'NOW');
  if (mySeat === null || now < 0 || turns[now]?.seat !== mySeat) return null;
  let first = now;
  while (first > 0 && turns[first - 1]?.seat === mySeat) first--;
  let last = now;
  while (last < turns.length - 1 && turns[last + 1]?.seat === mySeat) last++;
  const of = last - first + 1;
  return of > 1 ? { nth: now - first + 1, of } : null;
}

/** Marken der eigenen Wahlen unter der Überschrift: getan, jetzt, noch offen. */
export function PickRun({
  run,
  seat,
  realm,
}: {
  readonly run: { readonly nth: number; readonly of: number };
  readonly seat: number;
  readonly realm: boolean;
}) {
  return (
    <p className={`pick-run seat-${seat}`} data-testid="match-pick-run">
      <span className="pick-run-marks" aria-hidden="true">
        {Array.from({ length: run.of }, (_, i) => (
          <span
            key={i}
            className={`pick-run-mark ${i + 1 < run.nth ? 'done' : i + 1 === run.nth ? 'now' : 'next'}`}
          />
        ))}
      </span>
      <span>
        {t(realm ? 'realm.ranked.run' : 'match.ranked.run', { nth: run.nth, of: run.of })}
      </span>
    </p>
  );
}

/**
 * Was aus der Rangfolge folgt, im Blatt unter dem Satz der Regel. Es schreibt sich ein, wenn auf
 * der Karte die Rangfolge steht (stage.css, `.ranked-sum`); „Als Nächstes“ steht unten wie im
 * Ausgang eines Duells.
 */
export function RankedNext({
  summary,
  mySeat,
}: {
  readonly summary: RankedSummary;
  readonly mySeat: number | null;
}) {
  const { mine, free, order, next } = summary;
  return (
    <>
      {order ? (
        <dl className="ranked-order ranked-in" data-testid="match-ranked-order">
          {(
            [
              ['castles', order.castles],
              ['villages', order.villages],
            ] as const
          ).map(([kind, seats]) => (
            <div key={kind}>
              <dt>{t(`realm.ranked.${kind}`)}</dt>
              <dd>
                <ol>
                  {seats.map((seat, i) => (
                    <li key={seat} className={seat === mySeat ? 'me' : undefined}>
                      <span className="ranked-at" aria-hidden="true">
                        {i + 1}
                      </span>
                      <SeatCrest seat={seat} size={18} />
                    </li>
                  ))}
                </ol>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {mine || free ? (
        <ul className="outcome-list ranked-list ranked-in" data-testid="match-ranked">
          {mine ? (
            <li className={`seat-${mine.seat}`}>
              <SeatCrest seat={mine.seat} size={18} />
              <span>{mine.text}</span>
            </li>
          ) : null}
          {free ? (
            <li className="ranked-free">
              <svg className="free-mark" viewBox="-50 -50 100 100" aria-hidden="true">
                <path d="M-34-30L6-42L38-14L30 30L-8 42L-40 12Z" strokeWidth="9" />
              </svg>
              <span>{free}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
      {next ? (
        <div className="next ranked-next">
          <h3>{t('realm.outcome.next')}</h3>
          <p>
            {next.seat === null ? null : <SeatCrest seat={next.seat} size={16} />}
            {next.text}
          </p>
        </div>
      ) : null}
    </>
  );
}
