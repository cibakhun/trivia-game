import type { MatchEventOf, MatchView, ParsedMatchEvent } from '@rdw/protocol';
import type { ReactNode } from 'react';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { t } from '../i18n/i18n.ts';
import { Countdown } from '../quiz/Countdown.tsx';
import { AnnouncePanel } from './AnnouncePanel.tsx';
import { DuelHeader } from './DuelHeader.tsx';
import {
  shownPick,
  type LocalQuestion,
  type MatchScreenState,
  type Reveal,
} from './match-model.ts';
import {
  logText,
  pickText,
  questionContext,
  type RegionName,
  type SeatName,
} from './match-text.ts';
import { NumPad } from './NumPad.tsx';
import { OutcomePanel } from './OutcomePanel.tsx';

/**
 * Das Blatt rechts auf dem Meer (ADR-059): sagt in jeder Phase, was gerade geschieht und was zu
 * tun ist. Wahl mit Restzeit, Ansage, wer gegen wen kämpft, das Ziffernfeld der Schätzfrage und
 * der Ausgang eines Duells. Es steht immer an derselben Stelle und ist immer gleich groß, damit
 * die Karte daneben nie rückt; die Frage selbst liegt mitten auf der Karte (`StageQuestion`).
 */

function noop() {
  // Ablauf einer Anzeige: Den nächsten Schritt bringt die Abfrage
}

/** Jüngste Zeile des Verlaufs: steht beim Warten im Blatt, einen eigenen Verlauf gibt es nicht. */
export function latestLine(
  events: readonly ParsedMatchEvent[],
  name: SeatName,
  region: RegionName,
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const text = event ? logText(event, name, region) : null;
    if (text) return text;
  }
  return null;
}

type PickKind = 'CAPITAL_PICK' | 'LAND_PICK' | 'CAMPAIGN_TARGET';

function pickKind(view: MatchView): PickKind {
  const kind = view.board?.step.kind;
  return kind === 'CAPITAL_PICK' || kind === 'LAND_PICK' ? kind : 'CAMPAIGN_TARGET';
}

/** Überschrift, solange ein anderer wählt oder eine Wahl gezeigt wird. */
function phaseTitle(view: MatchView, events: readonly ParsedMatchEvent[]): string {
  const shown = shownPick(events);
  if (shown?.type === 'CAPITAL_CHOSEN') return t('match.stage.wait.CAPITAL_PICK');
  if (shown?.type === 'REGION_CLAIMED') return t('match.stage.wait.LAND_PICK');
  const kind = view.board?.step.kind;
  if (kind === 'CAPITAL_PICK') return t('match.stage.wait.CAPITAL_PICK');
  if (kind === 'LAND_ESTIMATE' || kind === 'LAND_PICK') return t('match.stage.wait.LAND_PICK');
  return t('match.stage.wait.CAMPAIGN_TARGET');
}

/** Überschrift während einer Frage: aus der Sicht dieses Sitzes. */
function questionTitle(view: MatchView): string {
  const step = view.board?.step;
  if (step?.kind === 'LAND_ESTIMATE') return t('match.stage.role.land');
  if (step?.kind === 'DUEL_ESTIMATE') return t('match.stage.role.tiebreak');
  if (step?.attacker === view.mySeat) return t('match.stage.role.attacker');
  if (step?.defender === view.mySeat) return t('match.stage.role.defender');
  return t('match.stage.role.watching');
}

/** Worum die Schätzfrage geht, in einer kurzen Zeile über dem Ziffernfeld. */
function estimateRule(view: MatchView, region: RegionName): string {
  const step = view.board?.step;
  return step?.kind === 'DUEL_ESTIMATE' && step.region !== null
    ? t('match.stage.tiebreakRule', { region: region(step.region) })
    : t('match.moment.landDetail');
}

export function StageBlatt({
  view,
  state,
  local,
  phaseDeadline,
  estimate,
  busy,
  events,
  reveal,
  outcome,
  outcomeBeat,
  error,
  name,
  region,
  onEstimate,
  onAnswerEstimate,
}: {
  readonly view: MatchView;
  readonly state: MatchScreenState;
  readonly local: LocalQuestion | null;
  readonly phaseDeadline: number | null;
  readonly estimate: string;
  readonly busy: boolean;
  readonly events: readonly ParsedMatchEvent[];
  readonly reveal: Reveal | null;
  /** Eben entschiedenes Duell: steht während der ganzen Auflösung im Blatt. */
  readonly outcome: MatchEventOf<'DUEL_RESOLVED'> | null;
  /** Erster Takt der Auflösung: Die Karte zeigt den Ausgang, die Antworten folgen. */
  readonly outcomeBeat: boolean;
  /** Fehler der letzten eigenen Aktion. */
  readonly error: unknown;
  readonly name: SeatName;
  readonly region: RegionName;
  readonly onEstimate: (update: (current: string) => string) => void;
  readonly onAnswerEstimate: () => void;
}) {
  const { timers } = view.match;
  const questionMs = view.question?.kind === 'TRIVIA' ? timers.triviaMs : timers.estimateMs;
  const phaseTimer = (totalMs: number, quiet = false) =>
    phaseDeadline === null ? null : (
      <Countdown deadline={phaseDeadline} totalMs={totalMs} onExpire={noop} quiet={quiet} brief />
    );
  const note = error ? <ErrorNote error={error} /> : null;
  const sheet = (tone: string, testId: string, live: boolean, children: ReactNode) => (
    <section
      className={`blatt${tone ? ` ${tone}` : ''}`}
      data-testid={testId}
      aria-live={live ? 'polite' : undefined}
    >
      {children}
      {note}
    </section>
  );

  switch (state) {
    case 'pick': {
      const kind = pickKind(view);
      return sheet(
        'turn',
        'match-pick',
        true,
        <>
          <h2 className="blatt-title">{t(`match.stage.pick.${kind}`)}</h2>
          <p className="visually-hidden">{pickText(view, name)}</p>
          {phaseTimer(timers.pickMs)}
          <p className="blatt-hint">
            {kind === 'CAPITAL_PICK' ? t('match.pick.hintCapital') : t('match.pick.hint')}
          </p>
        </>,
      );
    }
    case 'waiting-pick': {
      const chooser = view.board?.step.chooser ?? null;
      const latest = latestLine(events, name, region);
      return sheet(
        '',
        'match-pick',
        true,
        <>
          <h2 className="blatt-title">{phaseTitle(view, [])}</h2>
          <p className="blatt-lead">
            {chooser === null ? null : <SeatCrest seat={chooser} size={24} />}
            <strong>{pickText(view, name)}</strong>
          </p>
          {phaseTimer(timers.pickMs, true)}
          {latest ? <p className="blatt-last">{latest}</p> : null}
        </>,
      );
    }
    case 'announce': {
      const step = view.board?.step;
      const duel = step?.kind === 'DUEL_TRIVIA';
      const tone = !duel
        ? ''
        : step.defender === view.mySeat
          ? 'attacked'
          : step.attacker === view.mySeat
            ? 'turn'
            : '';
      return (
        <section className={`blatt${tone ? ` ${tone}` : ''}`}>
          {duel ? null : <h2 className="blatt-title">{phaseTitle(view, events)}</h2>}
          <AnnouncePanel
            view={view}
            events={events}
            name={name}
            region={region}
            fallback={latestLine(events, name, region)}
            timer={phaseTimer(timers.announceMs, true)}
          />
          {duel ? <p className="blatt-hint">{t('match.stage.triviaNext')}</p> : null}
          {note}
        </section>
      );
    }
    case 'question': {
      if (!local?.question) return null;
      const question = local.question;
      return sheet(
        'turn',
        'match-answering',
        false,
        <>
          <h2 className="blatt-title">{questionTitle(view)}</h2>
          {question.kind === 'ESTIMATE' ? (
            <>
              {/* Das Ziffernfeld braucht die Höhe: Worum es geht, steht hier in einer Zeile */}
              <p className="blatt-hint">
                <span className="visually-hidden">{questionContext(view, name, region)} </span>
                <span aria-hidden="true">{estimateRule(view, region)}</span>
              </p>
              <NumPad
                value={estimate}
                precision={question.answerPrecision}
                busy={busy || local.sent !== undefined}
                onChange={onEstimate}
                onSubmit={onAnswerEstimate}
              />
            </>
          ) : (
            <>
              <DuelHeader view={view} name={name} region={region} />
              <p className="blatt-hint">{t('match.stage.triviaRule')}</p>
            </>
          )}
        </>,
      );
    }
    case 'presenting':
    case 'answered':
    case 'missed':
    case 'spectating': {
      const text =
        state === 'presenting'
          ? t('match.question.presenting')
          : state === 'answered'
            ? t('match.question.answered')
            : state === 'missed'
              ? t('match.question.missed')
              : t('match.question.spectating');
      return sheet(
        '',
        'match-waiting',
        false,
        <>
          <h2 className="blatt-title">{questionTitle(view)}</h2>
          <DuelHeader view={view} name={name} region={region} />
          <p className={`blatt-status${state === 'answered' ? ' done' : ''}`} aria-live="polite">
            {text}
          </p>
          {phaseTimer(questionMs, true)}
        </>,
      );
    }
    case 'reveal': {
      if (outcome) {
        const p = outcome.payload;
        const winner = p.winner === 'ATTACKER' ? p.attacker : p.defender;
        return (
          <section className={`blatt outcome seat-${winner}`}>
            <OutcomePanel duel={outcome} mySeat={view.mySeat} name={name} region={region} />
            {outcomeBeat ? null : phaseTimer(timers.revealMs, true)}
            {note}
          </section>
        );
      }
      const land = reveal?.outcome.some((o) => o.type === 'LAND_RANKED') ?? false;
      return sheet(
        '',
        'match-revealing',
        false,
        <>
          <h2 className="blatt-title">{t('match.reveal.title')}</h2>
          {land ? (
            <p className="blatt-hint">{t('match.moment.landDetail')}</p>
          ) : (
            // Gleichstand im Duell: Was daraus folgt, steht auf dem Blatt in der Mitte
            <DuelHeader view={view} name={name} region={region} />
          )}
          {phaseTimer(timers.revealMs, true)}
        </>,
      );
    }
    case 'finished':
    case 'loading':
    case 'lobby':
    case 'abandoned':
    // Partie mit Ausbau: Dort zeichnet `RealmBlatt`
    case 'prepare':
    case 'prepared':
    case 'watching-prepare':
    case 'orders':
    case 'wheel':
      return null;
  }
}
