import type { MatchEventOf } from '@rdw/protocol';
import type { ReactNode } from 'react';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { formatDecimal, formatNumber, t, tp } from '../i18n/i18n.ts';
import { duelResolved, duelWinner, type Reveal } from './match-model.ts';
import { outcomeTexts, type RegionName, type SeatName } from './match-text.ts';
import { SeatChip } from './SeatChip.tsx';

/**
 * Auflösung einer Frage für alle Sitze, auch für Zuschauer (docs/ART_DIRECTION.md §4), als Blatt
 * mitten auf der Karte: oben in einem Satz, was daraus folgt, darunter die Frage und wer was
 * geantwortet hat. Bei einer Wissensfrage stehen die Antworten an derselben Stelle wie in der
 * Frage, und jedes Feld füllt sich mit der Farbe dessen, der es gewählt hat; wählten mehrere
 * dasselbe, teilen sie sich das Feld zu gleichen Teilen (ADR-065). Bei einer Schätzfrage stehen
 * die Sitze in der Reihenfolge ihrer Schätzung, die beste zuerst. Das Blatt passt ohne Scrollen
 * auf ein quer gehaltenes Handy.
 */

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

type Answer = MatchEventOf<'QUESTION_RESOLVED'>['payload']['answers'][number];

/** Zahl aus der Auflösung als Vergleichswert; `null` zählt als schlechtester Wert. */
function magnitude(value: string | null): number {
  return value === null ? Number.POSITIVE_INFINITY : Math.abs(Number(value));
}

/** Schätzungen in Rangfolge: kleinster Abstand zuerst, bei Gleichstand die schnellere Antwort. */
function byEstimate(a: Answer, b: Answer): number {
  if (a.answered !== b.answered) return a.answered ? -1 : 1;
  const distance = magnitude(a.distance) - magnitude(b.distance);
  if (distance !== 0 && !Number.isNaN(distance)) return distance;
  return (a.effectiveMs ?? Number.POSITIVE_INFINITY) - (b.effectiveMs ?? Number.POSITIVE_INFINITY);
}

export function RevealPanel({
  reveal,
  name,
  region,
  timer = null,
  verdict = true,
}: {
  readonly reveal: Reveal;
  readonly name: SeatName;
  readonly region: RegionName;
  /** Ablaufende Zeit der Auflösung; steht unten im Blatt. */
  readonly timer?: ReactNode;
  /** `false`, wenn die Folge schon woanders steht (Ausgang des Duells im Blatt der Phase). */
  readonly verdict?: boolean;
}) {
  const { resolved, opened, outcome } = reveal;
  const q = resolved.payload;
  const solution = q.solution;
  const unit = 'unit' in solution && solution.unit ? ` ${solution.unit}` : '';

  const duel = duelResolved(reveal);
  const ranked = outcome.find((o) => o.type === 'LAND_RANKED');
  const start = outcome.find((o) => o.type === 'START_RANKED');
  const fallen = outcome.filter((o) => o.type === 'KINGDOM_ELIMINATED');
  // Duell: Wirkung groß, Grund klein. Landnahme: Die Rangfolge steht in den Zeilen darunter.
  const duelLines = duel ? outcomeTexts(duel, name, region) : [];
  const headline =
    duelLines.at(-1) ??
    (ranked
      ? t('match.reveal.landTitle', { round: ranked.payload.round })
      : start
        ? t('realm.reveal.startTitle')
        : opened?.payload.purpose === 'DUEL_TRIVIA'
          ? t('match.reveal.bothCorrect')
          : null);
  const winner = duel ? duelWinner(duel.payload) : null;

  return (
    <section
      className="sheet resolution reveal"
      aria-labelledby="reveal-title"
      data-testid="match-reveal"
    >
      <h2 id="reveal-title" className="visually-hidden">
        {t('match.reveal.title')}
      </h2>
      {headline && verdict ? (
        <div
          className={`reveal-verdict${winner === null ? '' : ` seat-${winner}`}${duel || !(ranked || start) ? '' : ' land'}`}
          data-testid="reveal-outcome"
        >
          {winner === null ? null : <SeatCrest seat={winner} size={30} />}
          <div>
            <p className="reveal-headline">{headline}</p>
            {duelLines.length > 1 ? <p className="reveal-reason">{duelLines[0]}</p> : null}
            {fallen.flatMap((o) =>
              outcomeTexts(o, name, region).map((line) => (
                <p key={`${o.seq}-${line}`} className="reveal-reason">
                  {line}
                </p>
              )),
            )}
          </div>
        </div>
      ) : null}

      <p className="reveal-prompt">{q.prompt}</p>

      {'optionToken' in solution ? (
        <TriviaAnswers reveal={reveal} name={name} />
      ) : (
        <>
          <p className="reveal-solution" data-testid="reveal-solution">
            {t('match.reveal.solution', {
              answer: solution.value === null ? '?' : `${formatDecimal(solution.value)}${unit}`,
            })}
          </p>
          <EstimateAnswers reveal={reveal} name={name} unit={unit} />
        </>
      )}

      {q.explanation ? (
        <p className="muted reveal-explanation">
          {t('result.explanation')}: {q.explanation}
        </p>
      ) : null}
      {timer}
    </section>
  );
}

/**
 * Antworten einer Wissensfrage: jede Option ein Feld an ihrer Stelle aus der Frage. Wer sie wählte,
 * malt das Feld in seiner Farbe aus (mehrere teilen es sich zu gleichen Teilen) und steht mit
 * Wappen und Namen darauf: Die Farbe ist nie der einzige Träger. Der Kreis links zeigt, was
 * richtig war und was falsch gewählt wurde, sonst den Buchstaben aus der Frage.
 */
function TriviaAnswers({ reveal, name }: { readonly reveal: Reveal; readonly name: SeatName }) {
  const q = reveal.resolved.payload;
  const correctToken = 'optionToken' in q.solution ? q.solution.optionToken : null;
  const silent = q.answers.filter((a) => !a.answered);
  return (
    <>
      <ul className="reveal-options">
        {q.options.map((option, i) => {
          const correct = option.token === correctToken;
          // In der Reihenfolge der Frage: im Duell der Angreifer links, wie im Kopf des Duells
          const chosenBy = q.answers.filter((a) => a.answered && a.optionText === option.text);
          const chosen = chosenBy.length > 0;
          return (
            <li
              key={option.token}
              className={`reveal-option${correct ? ' correct' : chosen ? ' wrong' : ''}${chosen ? ' chosen' : ''}`}
              data-chosen-by={chosenBy.map((a) => a.seat).join(' ')}
            >
              {chosen ? (
                <span className="reveal-fill" aria-hidden="true">
                  {chosenBy.map((a) => (
                    <i key={a.seat} className={`seat-${a.seat}`} />
                  ))}
                </span>
              ) : null}
              <span className="reveal-mark" aria-hidden="true">
                {correct ? '✓' : chosen ? '✗' : (OPTION_KEYS[i] ?? '')}
              </span>
              <span className="reveal-option-text">
                {option.text}
                {correct ? (
                  <span className="visually-hidden"> ({t('match.reveal.correctOption')})</span>
                ) : null}
              </span>
              <span className="reveal-chips">
                {chosenBy.map((a) => (
                  <SeatChip key={a.seat} seat={a.seat} name={name} />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      {silent.length > 0 ? (
        <p className="reveal-silent">
          <span>{t('match.reveal.noAnswerBy')}</span>
          {silent.map((a) => (
            <SeatChip key={a.seat} seat={a.seat} name={name} />
          ))}
        </p>
      ) : null}
    </>
  );
}

/**
 * Schätzungen in Rangfolge; in der Landnahme steht rechts, wie viele Regionen der Platz wählt, bei
 * der Startfrage, wer seine Burg zuerst setzt.
 */
function EstimateAnswers({
  reveal,
  name,
  unit,
}: {
  readonly reveal: Reveal;
  readonly name: SeatName;
  readonly unit: string;
}) {
  const q = reveal.resolved.payload;
  const ranked = reveal.outcome.find((o) => o.type === 'LAND_RANKED');
  // Startfrage der Partie mit Ausbau: Der Platz sagt, wer seine Burg wann setzt
  const start = reveal.outcome.find((o) => o.type === 'START_RANKED');
  const startPlace = (seat: number) =>
    start?.payload.ranking.find((r) => r.seat === seat)?.place ?? null;
  const place = (seat: number) => {
    const rank = ranked?.payload.ranking.find((r) => r.seat === seat);
    if (rank) return rank;
    const first = startPlace(seat);
    return first === null ? null : { place: first, picks: null };
  };
  const rows = [...q.answers].sort((a, b) => {
    const [pa, pb] = [place(a.seat), place(b.seat)];
    return pa && pb ? pa.place - pb.place : byEstimate(a, b);
  });
  return (
    <ol className="reveal-ranks">
      {rows.map((a, i) => {
        const rank = place(a.seat);
        const best = i === 0 && a.answered;
        return (
          <li
            key={a.seat}
            className={`reveal-rank${best ? ' best' : ''}${a.answered ? '' : ' silent'}`}
            data-seat={a.seat}
          >
            <span className="reveal-place" aria-hidden="true">
              {rank ? rank.place : i + 1}
            </span>
            <SeatChip seat={a.seat} name={name} />
            <span className="reveal-value">
              {a.answered
                ? `${a.value === null ? '?' : formatDecimal(a.value)}${unit}`
                : t('match.reveal.noAnswer')}
            </span>
            <span className="reveal-detail">
              {a.answered && a.distance !== null
                ? Number(a.distance) === 0
                  ? t('match.reveal.exact')
                  : t('match.reveal.off', { value: formatDecimal(a.distance) })
                : ''}
              {a.answered && a.effectiveMs !== null
                ? ` · ${t('result.seconds', {
                    value: formatNumber(Math.round(a.effectiveMs / 100) / 10),
                  })}`
                : ''}
            </span>
            {rank === null ? null : rank.picks === null ? (
              <span className="reveal-picks">
                {rank.place === 1
                  ? t('realm.reveal.first')
                  : t('realm.reveal.later', { place: rank.place })}
              </span>
            ) : (
              <span className={`reveal-picks${rank.picks > 0 ? '' : ' none'}`}>
                {rank.picks > 0 ? tp('match.reveal.picks', rank.picks) : t('match.reveal.noPicks')}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
