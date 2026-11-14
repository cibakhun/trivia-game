import type { MatchBotStrengthCode, MatchView, ParsedMatchEvent } from '@rdw/protocol';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { HeroMap } from '../art/HeroMap.tsx';
import { mapArt } from '../art/map-art.ts';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { SoundToggle } from '../components/SoundToggle.tsx';
import { t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { estimateToSend } from './estimate-input.ts';
import { LobbyPanel } from './LobbyPanel.tsx';
import { MatchBoard } from './MatchBoard.tsx';
import {
  duelResolved,
  duelStage,
  lastOf,
  revealFor,
  screenStateOf,
  shownPick,
  watchedFor,
  type LocalAnswer,
  type LocalQuestion,
  type WatchedQuestion,
} from './match-model.ts';
import { mapOfView, regionNames, seatNames, stepLabel } from './match-text.ts';
import { momentWeight } from './moments.ts';
import { ResultPanel } from './ResultPanel.tsx';
import { RevealPanel } from './RevealPanel.tsx';
import { RotateHint } from './RotateHint.tsx';
import { SeatList } from './SeatList.tsx';
import { useSent } from './sent-action.ts';
import { sheetVeil, type SheetKind } from './sheet-swap.ts';
import { StageBlatt } from './StageBlatt.tsx';
import { StageCentre } from './StageCentre.tsx';
import {
  blattScene,
  impactHoldMs,
  StageLive,
  useAfterImpact,
  useBlattTurn,
  useBorn,
  useLive,
} from './stage-live.ts';
import { StageQuestion, WatchedQuestionCard } from './StageQuestion.tsx';
import { TurnOrder } from './TurnOrder.tsx';
import { useMatchSounds } from './useMatchSounds.ts';
import { useMoments, type ShownMoment } from './useMoments.ts';
import { useRevealBeats } from './useRevealBeats.ts';
import { useStageFrame } from './useStageFrame.ts';
import './stage.css';

/**
 * Bühne der Partie (ADR-059): Der ganze Bildschirm ist die Spielkarte, am Handy im Querformat.
 * Links auf dem Meer stehen Abschnitt, Spielstand und Zugfolge, rechts das Blatt der Phase; Frage,
 * Auflösung und Abrechnung liegen als Blätter mitten auf der Karte. Die Karte steht in jedem
 * Zustand an derselben Stelle. Diese Komponente zeigt nur an: Stand und Aktionen kommen von außen
 * (`MatchScreen`).
 */
export interface MatchStageProps {
  readonly view: MatchView | null;
  readonly events: readonly ParsedMatchEvent[];
  /** Die eigene Frage, wie dieser Browser sie abgeholt hat. */
  readonly local: LocalQuestion | null;
  /** Die Frage anderer zum Mitlesen (ADR-065); fehlt sie, bleibt es beim Blatt rechts. */
  readonly watched?: WatchedQuestion | null;
  /** Ende der laufenden Phase als `performance.now()`-Wert. */
  readonly phaseDeadline: number | null;
  /** Fehler der Abfrage (Netz) und der letzten eigenen Aktion. */
  readonly feedError: unknown;
  readonly actionError: unknown;
  readonly busy: boolean;
  /** Eingabe des Ziffernfelds der Schätzfrage. */
  readonly estimate: string;
  readonly onRetry: () => void;
  readonly onEstimate: (update: (current: string) => string) => void;
  readonly onPick: (region: number) => void;
  readonly onAnswer: (current: LocalQuestion, answer: LocalAnswer) => void;
  /** Die eigene Antwortzeit ist abgelaufen. */
  readonly onExpire: () => void;
  readonly onStart: () => void;
  readonly onLeave: () => void;
  readonly onSetBot: (joinOrder: number, strength: MatchBotStrengthCode | null) => void;
}

export function MatchStage({
  view: feedView,
  events: feedEvents,
  local,
  watched = null,
  phaseDeadline,
  feedError,
  actionError,
  busy,
  estimate,
  onRetry,
  onEstimate,
  onPick,
  onAnswer,
  onExpire,
  onStart,
  onLeave,
  onSetBot,
}: MatchStageProps) {
  // Hat eine Auflösung ein Duell entschieden, kommen erst die Antworten, dann ihre Folgen
  // (ADR-069): Solange zeigt die Bühne den Stand vor dem Ausgang
  const { view, events, beat, late } = useRevealBeats(feedView, feedEvents, phaseDeadline);
  const state = screenStateOf(view, local);
  // Eine abgeschickte Wahl bleibt am Feld stehen, bis der Stand sie zeigt (`sent-action`)
  const sent = useSent(feedView?.lastEventSeq ?? null, actionError);
  // Hat diese Seite schon einen Wechsel miterlebt (`stage-live.ts`)? Nur dann schlägt das Blatt
  // rechts um, und nur dann baut sich die Abrechnung auf: Wer in die fertige Partie lädt, sieht
  // sofort das Endbild. Das Laden selbst ist kein Stand
  const live = useLive(state);
  const seq = view?.question?.seq ?? null;
  const board = view?.board ?? null;

  const map = useMemo(() => (view ? mapOfView(view) : null), [view]);
  const name = useMemo(() => (view ? seatNames(view) : () => ''), [view]);
  const region = useMemo(() => (map ? regionNames(map) : () => ''), [map]);
  const moment = useMoments(view, state, events, name);
  useMatchSounds(view, state, events);
  const reveal = useMemo(
    () => (state === 'reveal' && view?.question ? revealFor(events, view.question.seq) : null),
    [state, view?.question, events],
  );
  // Im Takt der Antworten kennt die Bühne den Ausgang noch nicht: Das Duell steht wie in der Frage
  const resolved = duelResolved(reveal);
  // Das Duell steht von der Ansage bis zum Ende der Auflösung auf der Karte
  const duel = view ? duelStage(view, state, reveal, beat === 'outcome') : null;
  // Wechsel am Rand (stage-live.ts): Der Spielstand folgt dem Schlag des Duells, das Band oben
  // links bleibt bis zum Ende der Auflösung bei dessen Runde, das Blatt rechts schlägt um
  const decided = state === 'reveal' && beat !== null && !late ? seq : null;
  const railView = useAfterImpact(
    view,
    beat === 'outcome' ? decided : null,
    impactHoldMs(view?.match.timers.revealMs ?? 0),
  );
  const calmView = useAfterImpact(view, decided, Number.POSITIVE_INFINITY);
  const page = useBlattTurn(
    blattScene(
      state,
      board?.step ?? null,
      seq,
      resolved?.type === 'DUEL_RESOLVED',
      state === 'announce' ? (shownPick(events)?.type ?? null) : null,
    ),
    live,
  );
  // Das Blatt mit Frage und Antworten: ohne Duell die ganze Auflösung, sonst im ersten Takt
  const answering = beat === null || beat === 'answers' || late;
  // Was ein Bot eben gewählt hat, trägt während der Ansage einen Ring
  const spot = state === 'announce' ? (shownPick(events)?.payload.region ?? null) : null;

  // Solange die Bühne steht, scrollt nichts, und alle Maße folgen dem Bildschirm (stage.css).
  // Steht vor dem Messen der Ränder: Erst mit der Klasse haben sie ihre Breite
  useLayoutEffect(() => {
    document.documentElement.classList.add('match-playing');
    return () => document.documentElement.classList.remove('match-playing');
  }, []);

  // Das Land liegt zwischen Spielstand und Blatt; beide sind in jedem Zustand gleich breit
  const land = board && map ? mapArt(map).tightViewBox : null;
  const { stage, frame } = useStageFrame(land);

  const attributes = {
    'data-testid': 'match-screen',
    'data-state': state,
    'data-beat': state === 'reveal' ? (beat ?? 'answers') : undefined,
    'data-seq': seq ?? undefined,
  };
  const toast = feedError ? (
    <div className="stage-toast">
      <ErrorNote error={feedError} onRetry={onRetry} />
    </div>
  ) : null;

  // Vor dem Start und nach einem Abbruch gibt es noch keine Karte der Partie: ein Blatt vor der
  // Wendelmark als Schmuckbild
  if (!view || !board || !map) {
    return (
      <main className="stage stage-plain" {...attributes}>
        <div className="stage-map">
          <HeroMap cover />
        </div>
        <div className="stage-veil on cut" aria-hidden="true" />
        <div className="stage-centre">
          {view && state === 'lobby' ? (
            <LobbyPanel
              view={view}
              busy={busy}
              error={actionError}
              onStart={onStart}
              onLeave={onLeave}
              onSetBot={onSetBot}
            />
          ) : view && state === 'abandoned' ? (
            <AbandonedPanel view={view} events={events} live={live} />
          ) : feedError ? null : (
            <p className="sheet plain-sheet">{t('app.loading')}</p>
          )}
        </div>
        {toast}
        <RotateHint />
      </main>
    );
  }

  // Die eigene Frage bleibt nach der Antwort stehen, bis die Auflösung kommt
  const asked =
    local?.question &&
    local.seq === seq &&
    (state === 'question' || state === 'answered' || state === 'missed')
      ? { ...local, question: local.question }
      : null;
  // Wer nicht gefragt ist, liest die Frage an derselben Stelle mit (ADR-065)
  const watching = watchedFor(state, seq, watched);
  let sheet: ReactNode = null;
  let sheetKind: SheetKind | null = null;
  if (asked) {
    sheetKind = 'question';
    sheet = (
      <StageQuestion
        key={asked.seq}
        question={asked.question}
        deadline={asked.deadline}
        reloaded={asked.reloaded}
        busy={busy}
        open={state === 'question'}
        estimate={estimate}
        sent={asked.sent ?? null}
        onExpire={onExpire}
        onAnswerTrivia={(optionToken) => onAnswer(asked, { optionToken })}
      />
    );
  } else if (watching) {
    sheetKind = 'question';
    sheet = (
      <WatchedQuestionCard
        key={watching.seq}
        question={watching.question}
        deadline={watching.deadline}
      />
    );
  } else if (state === 'reveal' && reveal && answering) {
    // Den Ausgang eines Duells sagen danach Karte und Blatt rechts; hier stehen Frage und Antworten
    sheetKind = 'reveal';
    sheet = <RevealPanel reveal={reveal} name={name} region={region} verdict={beat === null} />;
  } else if (state === 'finished') {
    sheetKind = 'result';
    sheet = (
      <ResultPanel
        view={view}
        finished={lastOf(events, 'MATCH_FINISHED')}
        name={name}
        live={live}
      />
    );
  } else if (state === 'abandoned') {
    sheetKind = 'closed';
    sheet = <AbandonedPanel view={view} events={events} live={live} />;
  }
  // Im Duell tritt die Karte schon selbst zurück: Dann liegt kein zweiter Schleier darüber
  const veil = sheetVeil(sheetKind, duel?.scene ?? null);
  const label = stepLabel(calmView ?? view);
  const closed = state === 'finished' || state === 'abandoned';

  const scene = (
    <main ref={stage} className="stage" {...attributes}>
      <div className="stage-map">
        <MatchBoard
          map={map}
          board={board}
          name={name}
          legal={state === 'pick' ? view.legalRegions : []}
          home={view.mySeat}
          duel={duel}
          spot={spot}
          busy={busy || sent.pending !== null}
          pending={state === 'pick' ? (sent.pending?.region ?? null) : null}
          onPick={(region) => {
            sent.mark(region);
            onPick(region);
          }}
          frame={frame}
        />
      </div>
      <div
        className={`stage-veil${veil.on ? ' on' : ''}${veil.cut ? ' cut' : ''}`}
        aria-hidden="true"
      />

      <div className="stage-rail stage-left" data-stage-rail="left">
        {label ? <StepRibbon label={label} /> : null}
        <SeatList view={railView ?? view} name={name} />
        <TurnOrder view={railView ?? view} name={name} />
        <div className="stage-tools">
          <SoundToggle />
          <button type="button" className="tool" onClick={() => navigate({ name: 'start' })}>
            {t('match.stage.leave')}
          </button>
        </div>
      </div>

      <aside
        className="stage-rail stage-right"
        data-stage-rail="right"
        data-turn={page.turn ?? undefined}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) page.settle();
        }}
      >
        <StageBlatt
          view={view}
          state={state}
          local={local}
          watching={watching !== null}
          phaseDeadline={phaseDeadline}
          estimate={estimate}
          busy={busy}
          events={events}
          reveal={reveal}
          outcome={resolved?.type === 'DUEL_RESOLVED' ? resolved : null}
          error={actionError}
          name={name}
          region={region}
          onEstimate={onEstimate}
          onAnswerEstimate={() => {
            const rawInput = estimateToSend(estimate);
            if (asked && rawInput !== null) onAnswer(asked, { rawInput });
          }}
        />
        <span className="blatt-ring" aria-hidden="true" />
      </aside>

      <div className="stage-banner" aria-hidden="true">
        {moment ? <MomentBanner key={moment.moment.key} shown={moment} /> : null}
      </div>

      <StageCentre kind={sheetKind} className={closed ? 'wide' : ''}>
        {sheet}
      </StageCentre>
      {toast}
      <RotateHint />
    </main>
  );
  // Was unter der Bühne erscheint, erfährt so, ob sie schon einen Wechsel miterlebt hat
  return <StageLive value={live}>{scene}</StageLive>;
}

/**
 * Kurzes Band über der Karte: „Du bist dran!“, der Beginn eines Abschnitts oder der Fall eines
 * Reichs. Eine kleine Schriftrolle, die sich von der Mitte her entrollt und wieder einrollt
 * (stage.css); wie lange sie steht, sagt `momentTiming`. Nur Zierde: Was zu tun ist, liest das
 * Blatt daneben vor (aria-live).
 */
export function MomentBanner({ shown }: { readonly shown: ShownMoment }) {
  const { moment, leadMs, showMs } = shown;
  const grand = momentWeight(moment) === 'grand';
  const style: CSSProperties = {
    ['--band-lead' as string]: `${leadMs}ms`,
    ['--band-ms' as string]: `${showMs}ms`,
  };
  // Spielt ein Duell in der oberen Hälfte der Karte (Ansage, Ausgang), weicht das Band an den
  // unteren Rand, damit es nichts verdeckt. Sein Platz steht mit seinem Erscheinen fest (vor dem
  // ersten Bild): Es springt nicht, wenn der Takt unter ihm wechselt oder die Auflösung endet
  const band = useRef<HTMLDivElement>(null);
  const [low, setLow] = useState(false);
  useLayoutEffect(() => {
    const stage = band.current?.closest('.stage');
    if (!stage) return;
    const playing =
      stage.getAttribute('data-state') === 'announce' ||
      stage.getAttribute('data-beat') === 'outcome';
    setLow(playing && stage.querySelector('.map-art[data-duel-high]') !== null);
  }, []);
  return (
    <div
      ref={band}
      className={`turn-banner moment-${moment.tone}${grand ? ' grand' : ''}${low ? ' low' : ''}`}
      style={style}
    >
      <span className="moment-ribbon" data-seat={moment.seat ?? undefined}>
        <span className="ribbon-shade" />
        <span className="ribbon-cloth">
          {moment.tone === 'seat' && moment.seat !== null ? (
            <SeatCrest seat={moment.seat} size={34} />
          ) : null}
          <span className="moment-title">{moment.title}</span>
        </span>
        {/* Die beiden Stäbe der Rolle: Sie fahren mit den Kanten des Tuchs auseinander */}
        <span className="ribbon-rod rod-l">
          <i />
        </span>
        <span className="ribbon-rod rod-r">
          <i />
        </span>
      </span>
      {moment.detail ? <span className="moment-detail">{moment.detail}</span> : null}
    </div>
  );
}

/**
 * Abschnitt der Partie im Band oben links. Wechselt der Text, während die Bühne zusieht, schreibt
 * er sich neu ein; das Band selbst bleibt stehen.
 */
export function StepRibbon({ label }: { readonly label: string }) {
  return (
    <p className="round-ribbon" data-testid="match-step">
      <StepText key={label} label={label} />
    </p>
  );
}

function StepText({ label }: { readonly label: string }) {
  const born = useBorn();
  return <span className={born ? 'arriving' : undefined}>{label}</span>;
}

export function AbandonedPanel({
  view,
  events,
  live = false,
}: {
  readonly view: MatchView;
  readonly events: readonly ParsedMatchEvent[];
  /** Die Seite hat den Abbruch miterlebt: Nur dann erscheint das Blatt mit einer Bewegung. */
  readonly live?: boolean;
}) {
  // Steht beim Erscheinen fest: Ein späteres Rendern stößt nichts neu an
  const [entrance] = useState(live);
  const reason = lastOf(events, 'MATCH_ABANDONED')?.payload.reason;
  const known =
    reason === 'HOST_LEFT' ||
    reason === 'LOBBY_EXPIRED' ||
    reason === 'NO_QUESTION_AVAILABLE' ||
    reason === 'INTERNAL_ERROR';
  return (
    <section
      className={`sheet plain-sheet${entrance ? ' entrance' : ''}`}
      data-testid="match-abandoned"
    >
      <h2>{t('match.abandoned.title')}</h2>
      {known ? <p>{t(`match.abandoned.reason.${reason}`)}</p> : null}
      {view.match.kind === 'TEST' ? <p className="muted">{t('match.result.test')}</p> : null}
      <button
        type="button"
        className="button button-primary"
        onClick={() => navigate({ name: 'matches' })}
      >
        {t('match.result.again')}
      </button>
    </section>
  );
}
