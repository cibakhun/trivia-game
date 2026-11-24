import type { MatchEventOf } from '@rdw/protocol';
import { compareDecimal, parseDecimal } from '@rdw/game-core';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { Swords } from '../art/Swords.tsx';
import { formatEstimateFigure, formatNumber, t, tp } from '../i18n/i18n.ts';
import { duelResolved, duelWinner, type Reveal } from './match-model.ts';
import { outcomeTexts, type RegionName, type SeatName } from './match-text.ts';
import { SeatChip } from './SeatChip.tsx';
import { QuestionKind } from './StageQuestion.tsx';

/**
 * Auflösung einer Frage für alle Sitze, auch für Zuschauer (docs/ART_DIRECTION.md §4), mit
 * demselben Aufbau wie die Fragekarte. Oben dasselbe Band (Kategorie oder Art der Frage), darunter
 * die Frage und die Antworten an derselben Stelle. Bei einer Wissensfrage ist es dieselbe Karte,
 * die liegen bleibt (ADR-070 Punkt 10): Zeile für Zeile so gebaut wie vorn, und die Antwortfelder
 * sind der Anker, an dem `StageCentre` sie auf die Frage legt. Bei einer Schätzfrage ist es die
 * Rückseite der Karte.
 *
 * Wissensfrage: Jede Antwort ist ein Feld wie auf der Vorderseite, die Antwort steht in seiner
 * Mitte. Links sitzt die Münze mit dem Buchstaben aus der Frage; auf sie setzt sich der Stempel
 * (richtig oder falsch gewählt). Wer eine Antwort gewählt hat, sagt die Farbe: Sie füllt das
 * ganze Feld, wählten zwei dasselbe, teilen sie es sich zu gleichen Teilen (ADR-065). Namen stehen
 * dort keine, aber an der Münze steckt das Wappen jedes Wählenden; die Namen dazu nennt das Blatt
 * rechts (`Answers`), ein Vorleser bekommt sie als Text. Richtig
 * und falsch sagen Stempel und Rand, nie die Füllung.
 *
 * Schätzfrage: Die Lösung steht in derselben Tafel, in die vorn die eigene Zahl geschrieben
 * wurde, die Schätzungen darunter in Rangfolge, ihre Zahlen in einer Spalte mit der Lösung.
 *
 * Was aus den Antworten folgt, steht darunter (ADR-069): bei Gleichstand, dass eine Schätzfrage
 * entscheidet. Das Blatt passt ohne Scrollen auf ein quer gehaltenes Handy.
 */

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

type Answer = MatchEventOf<'QUESTION_RESOLVED'>['payload']['answers'][number];

/**
 * Schätzungen in Rangfolge: kleinster Abstand zuerst, bei Gleichstand die schnellere Antwort.
 * Abstände werden exakt dezimal verglichen wie auf dem Server: Ohne erlaubte Grenze (ADR-076)
 * können sie größer werden, als eine Gleitkommazahl unterscheidet. `null` zählt als schlechtester.
 */
function byEstimate(a: Answer, b: Answer): number {
  if (a.answered !== b.answered) return a.answered ? -1 : 1;
  if (a.distance !== b.distance) {
    if (a.distance === null) return 1;
    if (b.distance === null) return -1;
    const order = compareDecimal(parseDecimal(a.distance), parseDecimal(b.distance));
    if (order !== 0) return order;
  }
  return (a.effectiveMs ?? Number.POSITIVE_INFINITY) - (b.effectiveMs ?? Number.POSITIVE_INFINITY);
}

/**
 * Passt die Auflösung nicht ganz ins Blatt (lange Frage und Antworten, dazu Gleichstand oder
 * Schweigende und eine Erklärung, auf der niedrigsten Bühne), gibt sie in zwei Stufen nach
 * (`data-fit`): Erst fällt die Erklärung weg (`trim`), dann wird auch die Frage kleiner und der
 * Platz der Lunte fällt weg (`tight`). Nur auf der zweiten Stufe weicht sie oben vom Aufbau der
 * Fragekarte ab; `StageCentre` legt sie dann nicht Feld auf Feld, sondern blendet sie an ihrer
 * Stelle über.
 */
function useSnug(sheet: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const node = sheet.current;
    if (!node) return;
    const fit = () => {
      node.removeAttribute('data-fit');
      for (const step of ['trim', 'tight']) {
        if (node.scrollHeight <= node.clientHeight + 1) return;
        node.setAttribute('data-fit', step);
      }
    };
    fit();
    // Kommt die Schrift erst nach dem Blatt, bricht der Text danach anders um
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) fit();
    });
    window.addEventListener('resize', fit);
    return () => {
      live = false;
      window.removeEventListener('resize', fit);
    };
  }, [sheet]);
}

/** Lange Fragen und Antworten bekommen eine kleinere Schrift, wie auf der Vorderseite. */
function density(prompt: string, options: readonly { readonly text: string | null }[]): string {
  const long = prompt.length > 110 ? ' prompt-long' : '';
  const longest = Math.max(0, ...options.map((o) => o.text?.length ?? 0));
  return `${long}${longest > 34 ? ' options-long' : longest > 16 ? ' options-mid' : ''}`;
}

/**
 * Stempel: eine Scheibe mit Haken (richtig) oder Kreuz (falsch gewählt), als Zeichnung, damit sie
 * auf jedem Gerät dieselbe Form hat. Er liegt auf der Münze mit dem Buchstaben der Antwort.
 */
export function Stamp({ kind }: { readonly kind: 'right' | 'wrong' }) {
  return (
    <span className={`reveal-stamp ${kind}`}>
      <svg viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">
        <path
          d={kind === 'right' ? 'M-6.2 0.6L-1.9 4.9L6.4-4.7' : 'M-4.7-4.7L4.7 4.7M4.7-4.7L-4.7 4.7'}
          fill="none"
          stroke="currentColor"
          strokeWidth="3.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function RevealPanel({
  reveal,
  name,
  region,
  timer = null,
  verdict = true,
  realm = false,
}: {
  readonly reveal: Reveal;
  readonly name: SeatName;
  readonly region: RegionName;
  /** Ablaufende Zeit der Auflösung; steht unten im Blatt. */
  readonly timer?: ReactNode;
  /** `false`, wenn die Folge schon woanders steht (Ausgang des Duells im Blatt der Phase). */
  readonly verdict?: boolean;
  /** Partie mit Ausbau: Dort heißen Regionen Felder. */
  readonly realm?: boolean;
}) {
  const { resolved, opened, outcome } = reveal;
  const q = resolved.payload;
  const solution = q.solution;
  const unit = 'unit' in solution && solution.unit ? solution.unit : null;

  const duel = duelResolved(reveal);
  const ranked = outcome.some((o) => o.type === 'LAND_RANKED' || o.type === 'START_RANKED');
  const fallen = outcome.filter((o) => o.type === 'KINGDOM_ELIMINATED');
  // Duell: Wirkung groß, Grund klein
  const duelLines = duel ? outcomeTexts(duel, name, region) : [];
  const headline = duelLines.at(-1) ?? null;
  const winner = duel ? duelWinner(duel.payload) : null;
  // Wissensfrage eines Duells ohne Ausgang: Beide lagen richtig, das Stechen folgt
  const tie = !duel && !ranked && opened?.payload.purpose === 'DUEL_TRIVIA';
  const self = useRef<HTMLElement>(null);
  useSnug(self);

  return (
    <section
      ref={self}
      className={`sheet resolution reveal${density(q.prompt, q.options)}`}
      aria-labelledby="reveal-title"
      data-testid="match-reveal"
      data-kind={q.kind}
    >
      <header className="sheet-head">
        <QuestionKind kind={q.kind} category={opened?.payload.category ?? null} />
        <h2 id="reveal-title" className="sheet-tag">
          {t('match.reveal.title')}
        </h2>
      </header>
      {headline && verdict ? (
        <div
          className={`reveal-verdict${winner === null ? '' : ` seat-${winner}`}`}
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
            <span className="reveal-mark" aria-hidden="true">
              <Stamp kind="right" />
            </span>
            <span className="reveal-solution-label">
              {t('match.reveal.solution')}
              <span className="visually-hidden">: </span>
            </span>
            <Figure value={solution.value} unit={unit} />
          </p>
          <EstimateAnswers reveal={reveal} name={name} unit={unit} realm={realm} />
        </>
      )}

      {tie && verdict ? (
        <p className="reveal-next" data-testid="reveal-outcome">
          <Swords size={24} />
          <strong className="reveal-next-title">
            {t('match.reveal.tie')}
            <span className="visually-hidden">: </span>
          </strong>
          <span className="reveal-next-text">{t('match.reveal.tieNext')}</span>
        </p>
      ) : null}

      {q.explanation ? (
        <p className="muted reveal-explanation">
          {t('result.explanation')}: {q.explanation}
        </p>
      ) : null}
      {timer}
    </section>
  );
}

/** Eine Zahl mit ihrer Einheit: die Zahl groß, die Einheit klein dahinter. */
function Figure({ value, unit }: { readonly value: string | null; readonly unit: string | null }) {
  return (
    <span className="reveal-figure">
      <span className="reveal-number">{value === null ? '?' : formatEstimateFigure(value)}</span>
      {unit ? <span className="reveal-unit"> {unit}</span> : null}
    </span>
  );
}

/**
 * Antworten einer Wissensfrage: jede Option ein Feld an ihrer Stelle aus der Frage, die Antwort in
 * der Mitte, links die Münze mit ihrem Buchstaben, auf der der Stempel sitzt. Das Feld füllt sich
 * mit der Farbe derer, die es gewählt haben: je Sitz ein gleich breites Stück. Sichtbar steht kein
 * Name im Feld (Wunsch des Product Owners, ADR-070 Punkt 9); für Vorleser steht er als Text dabei.
 * An der Münze steckt das Wappen jedes Wählenden, damit auch wer zuschaut ohne Blick auf den
 * Spielstand sieht, wer was nahm.
 */
function TriviaAnswers({ reveal, name }: { readonly reveal: Reveal; readonly name: SeatName }) {
  const q = reveal.resolved.payload;
  const correctToken = 'optionToken' in q.solution ? q.solution.optionToken : null;
  const silent = q.answers.filter((a) => !a.answered);
  return (
    <>
      <ul className="reveal-options" data-anchor="">
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
                {OPTION_KEYS[i] ?? ''}
                {correct || chosen ? <Stamp kind={correct ? 'right' : 'wrong'} /> : null}
                {chosen ? (
                  // Wer gewählt hat, steckt als kleines Wappen an der Münze (Thread „Zuschauen
                  // eindeutiger“): neben dem Stempel, der sagt, ob es richtig war. Die Farbe sagt
                  // es auch, das Wappen zeigt es ohne Farbsinn und ohne Blick auf den Spielstand
                  <span className={`reveal-who${chosenBy.length > 1 ? ' shared' : ''}`}>
                    {chosenBy.map((a) => (
                      <SeatCrest key={a.seat} seat={a.seat} size={16} />
                    ))}
                  </span>
                ) : null}
              </span>
              <span className="reveal-option-text">
                {option.text}
                {correct ? (
                  <span className="visually-hidden"> ({t('match.reveal.correctOption')})</span>
                ) : null}
                {chosen ? (
                  <span className="visually-hidden">
                    {', '}
                    {t('match.reveal.chosenBy', {
                      names: chosenBy.map((a) => name(a.seat)).join(', '),
                    })}
                  </span>
                ) : null}
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
 * Schätzungen in Rangfolge, jede Zeile eine kleine Tafel mit der Farbe des Sitzes am Rand: Platz,
 * Wappen und Name, rechts die Zahl in einer Spalte mit der Lösung, darunter Abstand und Zeit. In
 * der Landnahme steht rechts unten, wie viele Regionen der Platz wählt, bei der Startfrage, wer
 * seine Burg zuerst setzt.
 */
function EstimateAnswers({
  reveal,
  name,
  unit,
  realm,
}: {
  readonly reveal: Reveal;
  readonly name: SeatName;
  readonly unit: string | null;
  readonly realm: boolean;
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
        const at = rank ? rank.place : i + 1;
        const exact = a.answered && a.distance !== null && Number(a.distance) === 0;
        return (
          <li
            key={a.seat}
            className={`reveal-rank seat-${a.seat}${best ? ' best' : ''}${a.answered ? '' : ' silent'}`}
            data-seat={a.seat}
            data-place={at}
          >
            <span className="reveal-place" aria-hidden="true">
              {at}
            </span>
            <SeatChip seat={a.seat} name={name} />
            <span className="reveal-value">
              {a.answered ? <Figure value={a.value} unit={unit} /> : t('match.reveal.noAnswer')}
            </span>
            <span className="reveal-detail">
              {a.answered && a.distance !== null ? (
                <span className={`reveal-off${exact ? ' exact' : ''}`}>
                  {exact
                    ? t('match.reveal.exact')
                    : t('match.reveal.off', { value: formatEstimateFigure(a.distance) })}
                </span>
              ) : null}
              {a.answered && a.effectiveMs !== null ? (
                <span className="reveal-time">
                  {' · '}
                  {t('result.seconds', {
                    value: formatNumber(Math.round(a.effectiveMs / 100) / 10),
                  })}
                </span>
              ) : null}
            </span>
            {rank === null ? null : rank.picks === null ? (
              <span className="reveal-picks">
                {rank.place === 1
                  ? t('realm.reveal.first')
                  : t('realm.reveal.later', { place: rank.place })}
              </span>
            ) : (
              <span className={`reveal-picks${rank.picks > 0 ? '' : ' none'}`}>
                {rank.picks > 0
                  ? tp(realm ? 'realm.reveal.picks' : 'match.reveal.picks', rank.picks)
                  : t(realm ? 'realm.reveal.noPicks' : 'match.reveal.noPicks')}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
