import type { QuestionCategory, RealmOrderDto } from '@rdw/protocol';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { HeroMap } from '../art/HeroMap.tsx';
import { mapArt } from '../art/map-art.ts';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { SoundToggle } from '../components/SoundToggle.tsx';
import { t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { estimateToSend } from './estimate-input.ts';
import { MatchBoard } from './MatchBoard.tsx';
import {
  duelResolved,
  duelStage,
  lastOf,
  outcomeBeatMs,
  revealFor,
  shownPick,
} from './match-model.ts';
import { AbandonedPanel, MomentBanner, type MatchStageProps } from './MatchStage.tsx';
import { regionNames, seatNames, stepLabel } from './match-text.ts';
import { PreparePanel } from './PreparePanel.tsx';
import type { RealmLayer } from './RealmBoardArt.tsx';
import { RealmBlatt } from './RealmBlatt.tsx';
import { layerRegions, outcomeSign, planLayer, realmBoardState, revealLayer } from './realm-layer.ts';
import { RealmLobby } from './RealmLobby.tsx';
import {
  fieldOptions,
  prepareTab,
  realmPlayOf,
  realmScreenStateOf,
  realmSeat,
  revealedOrders,
  settleOrders,
  tradesFirst,
  withMove,
  type PrepareTab,
} from './realm-model.ts';
import { RealmSeatList } from './RealmSeatList.tsx';
import { ResultPanel } from './ResultPanel.tsx';
import { RevealPanel } from './RevealPanel.tsx';
import { RotateHint } from './RotateHint.tsx';
import { StageQuestion } from './StageQuestion.tsx';
import { TurnOrder } from './TurnOrder.tsx';
import { useMatchSounds } from './useMatchSounds.ts';
import { useMoments } from './useMoments.ts';
import { useOutcomeBeat } from './useOutcomeBeat.ts';
import { useStageFrame } from './useStageFrame.ts';
import { Wheel } from './Wheel.tsx';
import './stage.css';
import './realm.css';

/**
 * Bühne der Partie mit Ausbau (MATCH_RULES §11, ADR-059, ADR-060): dieselbe Karte im Vollbild wie
 * ohne Ausbau, mit Burgen, Dörfern, Städten und Armeen darauf. Links stehen die Reiche mit ihren
 * Vorräten, rechts das Blatt der Phase: Rüstzeit mit Bauen, Kaufen, Ziehen und Tauschen, das
 * Aufgedeckte, das Angriffsziel mit seinen Losen, das Glücksrad und der Ausgang. Fragen, Rad und
 * Abrechnung liegen mitten auf der Karte. Diese Komponente hält nur, was der Spieler gerade
 * plant (Entwurf der Befehle, gewähltes Feld, angetipptes Ziel); Stand und Aktionen kommen von
 * außen (`MatchScreen`).
 */

/** Anteil der Ansage, den das Glücksrad dreht; danach steht es mit dem Ergebnis. */
const WHEEL_SPIN_SHARE = 0.65;
/** So lange vor Ablauf der Rüstzeit gibt der Browser einen offenen Entwurf von selbst ab. */
const AUTO_SUBMIT_MS = 1500;

interface PrepState {
  /** Feldzugrunde, zu der der Entwurf gehört; `null` außerhalb der Rüstzeit. */
  readonly round: number | null;
  readonly orders: readonly RealmOrderDto[];
  readonly selected: number | null;
  readonly tab: PrepareTab;
  readonly moveTo: number | null;
  readonly trading: boolean;
  readonly dropped: boolean;
}

const NO_PREP: PrepState = {
  round: null,
  orders: [],
  selected: null,
  tab: 'build',
  moveTo: null,
  trading: false,
  dropped: false,
};

/** Vorgaben für Standbilder (Prüfstand): was der Spieler gerade gewählt hätte. */
export interface RealmStageInitial {
  readonly orders?: readonly RealmOrderDto[];
  readonly selected?: number | null;
  readonly tab?: PrepareTab;
  readonly moveTo?: number | null;
  readonly trading?: boolean;
  readonly editing?: boolean;
  readonly target?: number | null;
}

export interface RealmStageProps extends MatchStageProps {
  readonly onSetFavorites: (categories: readonly QuestionCategory[]) => void;
  /** Gibt die Befehle ab; `true`, wenn der Server sie angenommen hat. */
  readonly onSubmitOrders: (orders: readonly RealmOrderDto[]) => Promise<boolean>;
  readonly initial?: RealmStageInitial;
}

export function RealmStage({
  view,
  events,
  local,
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
  onSetFavorites,
  onSubmitOrders,
  initial,
}: RealmStageProps) {
  const play = useMemo(() => realmPlayOf(view), [view]);
  const [editing, setEditing] = useState(initial?.editing ?? false);
  const state = realmScreenStateOf(view, local, events, editing);
  const seq = view?.question?.seq ?? null;
  const mySeat = view?.mySeat ?? null;
  const step = play?.board.step ?? null;

  const name = useMemo(() => (view ? seatNames(view) : () => ''), [view]);
  const region = useMemo(() => (play ? regionNames(play.map) : () => ''), [play]);
  const moment = useMoments(view, state, events, name);
  useMatchSounds(view, state, events);
  const reveal = useMemo(
    () => (state === 'reveal' && view?.question ? revealFor(events, view.question.seq) : null),
    [state, view?.question, events],
  );
  // Ein entschiedenes Duell zeigt zuerst die Karte (erster Takt), danach das Blatt mit den Antworten
  const resolved = duelResolved(reveal);
  const realmDuel = resolved?.type === 'REALM_DUEL_RESOLVED' ? resolved : null;
  const outcomeBeat = useOutcomeBeat(
    resolved && view?.question ? view.question.seq : null,
    view ? outcomeBeatMs(view.match.timers.revealMs) : 0,
    phaseDeadline,
  );
  const duel = view ? duelStage(view, state, reveal, outcomeBeat) : null;
  // Was ein Bot eben gewählt hat, trägt während der Ansage einen Ring
  const spot = state === 'announce' ? (shownPick(events)?.payload.region ?? null) : null;

  // ---- Rüstzeit: Entwurf der eigenen Befehle, je Runde neu ----
  const prepRound = view?.phase?.kind === 'PREPARE' && step ? (step.round ?? 0) : null;
  const [prep, setPrep] = useState<PrepState>(() => ({
    ...NO_PREP,
    round: prepRound,
    orders: initial?.orders ?? play?.realm.myOrders ?? [],
    selected: initial?.selected ?? null,
    tab: initial?.tab ?? 'build',
    moveTo: initial?.moveTo ?? null,
    trading: initial?.trading ?? false,
  }));
  if (prep.round !== prepRound) {
    // Neue Rüstzeit oder ihr Ende: Der alte Entwurf gilt nicht mehr (Merken während des Renderns)
    setPrep({ ...NO_PREP, round: prepRound, orders: play?.realm.myOrders ?? [] });
    setEditing(false);
  }
  const preparing = state === 'prepare' && play !== null && mySeat !== null;
  const field =
    preparing && prep.selected !== null
      ? fieldOptions(play, mySeat, prep.orders, prep.selected)
      : null;
  const tab = field ? prepareTab(field, prep.tab) : prep.tab;
  const moveTargets =
    field && tab === 'move' && !prep.trading
      ? field.moves.filter((move) => move.max > 0).map((move) => move.to)
      : [];

  // ---- Feldzug: Das Ziel wird erst angetippt, dann mit „Angreifen“ bestätigt ----
  const [target, setTarget] = useState<number | null>(initial?.target ?? null);
  const aiming = state === 'pick' && step?.kind === 'CAMPAIGN_TARGET';
  const aimed = aiming && target !== null && view?.legalRegions.includes(target) ? target : null;
  useEffect(() => {
    if (!aiming && !initial) setTarget(null);
  }, [aiming, initial]);

  // Wer bis kurz vor Schluss nicht „Fertig“ tippt, gibt seinen Entwurf trotzdem ab: Ohne Abgabe
  // täte sein Reich in dieser Runde nichts
  const submit = useRef<() => void>(() => undefined);
  submit.current = () => {
    if (!preparing || prep.orders.length === 0 || busy) return;
    void onSubmitOrders(settleOrders(play, mySeat, prep.orders).orders);
  };
  useEffect(() => {
    if (!preparing || phaseDeadline === null || initial) return;
    const left = phaseDeadline - performance.now() - AUTO_SUBMIT_MS;
    const timer = setTimeout(() => submit.current(), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [preparing, phaseDeadline, initial]);

  // Solange die Bühne steht, scrollt nichts, und alle Maße folgen dem Bildschirm (stage.css)
  useLayoutEffect(() => {
    document.documentElement.classList.add('match-playing');
    return () => document.documentElement.classList.remove('match-playing');
  }, []);

  const land = play ? mapArt(play.map).tightViewBox : null;
  const { stage, frame } = useStageFrame(land);
  const wheelMs = play?.realm.economy.timers.wheelMs ?? 0;

  const attributes = {
    'data-testid': 'match-screen',
    'data-mode': 'REALM',
    'data-state': state,
    'data-step': step?.kind,
    'data-beat': state === 'reveal' ? (outcomeBeat ? 'outcome' : 'answers') : undefined,
    'data-seq': seq ?? undefined,
  };
  const toast = feedError ? (
    <div className="stage-toast">
      <ErrorNote error={feedError} onRetry={onRetry} />
    </div>
  ) : null;

  // Vor dem Start und nach einem Abbruch gibt es noch keine Karte der Partie
  if (!view || !play || !step) {
    return (
      <main className="stage stage-plain" {...attributes}>
        <div className="stage-map">
          <HeroMap cover />
        </div>
        <div className="stage-veil" aria-hidden="true" />
        <div className="stage-centre">
          {view && state === 'lobby' ? (
            <RealmLobby
              view={view}
              busy={busy}
              error={actionError}
              onStart={onStart}
              onLeave={onLeave}
              onSetBot={onSetBot}
              onSetFavorites={onSetFavorites}
            />
          ) : view && state === 'abandoned' ? (
            <AbandonedPanel view={view} events={events} />
          ) : feedError ? null : (
            <p className="sheet plain-sheet">{t('app.loading')}</p>
          )}
        </div>
        {toast}
        <RotateHint />
      </main>
    );
  }

  const { board, realm } = play;

  // ---- Was die Karte über Besitz und Wert hinaus zeigt ----
  const regions = layerRegions(board);
  let layer: RealmLayer = { regions };
  if (preparing) {
    layer = {
      regions,
      ...planLayer(play, mySeat, prep.orders),
      selected: prep.trading ? null : prep.selected,
      targets: moveTargets,
      focusSeat: mySeat,
    };
  } else if (state === 'prepared' && mySeat !== null) {
    layer = { regions, ...planLayer(play, mySeat, realm.myOrders ?? []), focusSeat: mySeat };
  } else if (state === 'orders') {
    layer = { regions, ...revealLayer(revealedOrders(events, step.round ?? 1)) };
  } else if (aimed !== null) {
    layer = { regions, selected: aimed };
  } else if (state === 'reveal' && realmDuel) {
    layer = { regions, changes: [outcomeSign(realmDuel)], fresh: [realmDuel.payload.region] };
  }
  const own = preparing
    ? board.regions.flatMap((r, id) => (r.owner === mySeat ? [id] : []))
    : [];

  const tapRegion = (id: number) => {
    if (preparing) {
      const move = moveTargets.includes(id) && id !== prep.selected && prep.selected !== null;
      if (move) {
        // Ziel eines Zugs: Die erste Armee zieht gleich mit, die Zahl stellt das Blatt ein
        const known = field?.moves.find((m) => m.to === id);
        const orders =
          known && known.count === 0
            ? settleOrders(
                play,
                mySeat,
                tradesFirst(withMove(prep.orders, prep.selected ?? id, id, 1)),
              ).orders
            : prep.orders;
        setPrep({ ...prep, orders, moveTo: id, trading: false, dropped: false });
      } else if (id !== prep.selected || prep.trading) {
        setPrep({ ...prep, selected: id, tab: 'build', moveTo: null, trading: false });
      }
      return;
    }
    if (aiming) {
      setTarget(id);
      return;
    }
    onPick(id);
  };

  // Die eigene Frage bleibt nach der Antwort stehen, bis die Auflösung kommt
  const asked =
    local?.question &&
    local.seq === seq &&
    (state === 'question' || state === 'answered' || state === 'missed')
      ? { ...local, question: local.question }
      : null;
  let sheet: ReactNode = null;
  let disc = false;
  if (asked) {
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
        category={step.kind === 'DUEL_TRIVIA' ? step.category : null}
        onExpire={onExpire}
        onAnswerTrivia={(optionToken) => onAnswer(asked, { optionToken })}
      />
    );
  } else if (
    state === 'wheel' &&
    step.wheel &&
    step.attacker !== null &&
    step.defender !== null
  ) {
    disc = true;
    sheet = (
      <WheelSheet
        key={`${step.round}:${step.attacker}:${step.region}`}
        wheelMs={wheelMs}
        phaseDeadline={phaseDeadline}
      >
        {(spinMs, elapsedMs) => (
          <Wheel
            wheel={step.wheel ?? { attackerLots: 0, defenderLots: 0, freeLots: 0, segments: [], total: 0 }}
            attacker={step.attacker ?? 0}
            defender={step.defender ?? 0}
            landed={step.category}
            exhausted={lastOf(events, 'WHEEL_SPUN')?.payload.exhausted ?? []}
            spinMs={spinMs}
            elapsedMs={elapsedMs}
          />
        )}
      </WheelSheet>
    );
  } else if (state === 'reveal' && reveal && !outcomeBeat) {
    // Den Ausgang eines Duells sagt das Blatt rechts; hier stehen Frage und Antworten
    sheet = <RevealPanel reveal={reveal} name={name} region={region} verdict={!resolved} />;
  } else if (state === 'finished') {
    sheet = (
      <ResultPanel view={view} finished={lastOf(events, 'REALM_MATCH_FINISHED')} name={name} />
    );
  } else if (state === 'abandoned') {
    sheet = <AbandonedPanel view={view} events={events} />;
  }
  const label = stepLabel(view);
  const closed = state === 'finished' || state === 'abandoned';
  const waiting = board.turns
    .filter((turn) => turn.status !== 'DONE' && turn.seat !== mySeat)
    .map((turn) => name(turn.seat));
  const style: CSSProperties | undefined =
    state === 'wheel'
      ? { ['--wheel-spin' as string]: `${Math.round(wheelMs * WHEEL_SPIN_SHARE)}ms` }
      : undefined;

  return (
    <main ref={stage} className="stage stage-realm" style={style} {...attributes}>
      <div className="stage-map">
        <MatchBoard
          map={play.map}
          board={realmBoardState(board)}
          name={name}
          legal={state === 'pick' ? view.legalRegions : []}
          selectable={own}
          realm={layer}
          duel={duel}
          spot={spot}
          busy={busy}
          onPick={tapRegion}
          frame={frame}
        />
      </div>
      {sheet ? <div className="stage-veil" aria-hidden="true" /> : null}

      <div className="stage-rail stage-left" data-stage-rail="left">
        {label ? (
          <p className="round-ribbon" data-testid="match-step">
            {label}
          </p>
        ) : null}
        <RealmSeatList view={view} play={play} name={name} />
        <TurnOrder view={view} name={name} />
        <div className="stage-tools">
          <SoundToggle />
          <button type="button" className="tool" onClick={() => navigate({ name: 'start' })}>
            {t('match.stage.leave')}
          </button>
        </div>
      </div>

      <aside className="stage-rail stage-right" data-stage-rail="right">
        {(state === 'prepare' || state === 'prepared') && mySeat !== null ? (
          <PreparePanel
            play={play}
            seat={mySeat}
            orders={state === 'prepared' ? (realm.myOrders ?? []) : prep.orders}
            done={state === 'prepared'}
            selected={prep.selected}
            tab={tab}
            moveTo={prep.moveTo}
            trading={prep.trading}
            dropped={prep.dropped}
            waiting={waiting}
            phaseDeadline={phaseDeadline}
            busy={busy}
            error={actionError}
            region={region}
            onOrders={(orders, dropped) => setPrep((p) => ({ ...p, orders, dropped }))}
            onTab={(next) => setPrep((p) => ({ ...p, tab: next, moveTo: null }))}
            onTrading={(open) => setPrep((p) => ({ ...p, trading: open }))}
            onSubmit={() => {
              void onSubmitOrders(prep.orders).then((accepted) => {
                if (accepted) setEditing(false);
              });
            }}
            onEdit={() => {
              setPrep((p) => ({ ...p, orders: realm.myOrders ?? [], dropped: false }));
              setEditing(true);
            }}
          />
        ) : (
          <RealmBlatt
            view={view}
            play={play}
            state={state}
            local={local}
            phaseDeadline={phaseDeadline}
            estimate={estimate}
            busy={busy}
            events={events}
            reveal={reveal}
            outcome={realmDuel}
            outcomeBeat={outcomeBeat}
            error={actionError}
            name={name}
            region={region}
            target={aimed}
            onEstimate={onEstimate}
            onAnswerEstimate={() => {
              const rawInput = estimateToSend(estimate);
              if (asked && rawInput !== null) onAnswer(asked, { rawInput });
            }}
            onAttack={() => {
              if (aimed !== null) onPick(aimed);
            }}
          />
        )}
      </aside>

      <div className="stage-banner" aria-hidden="true">
        {moment ? <MomentBanner key={moment.key} moment={moment} /> : null}
      </div>

      {sheet ? (
        <div className={`stage-centre${closed ? ' wide' : ''}${disc ? ' disc' : ''}`}>{sheet}</div>
      ) : null}
      {toast}
      <RotateHint />
    </main>
  );
}

/**
 * Das Glücksrad mitten auf der Karte. Es dreht den ersten Teil der Ansage und steht dann mit dem
 * Ergebnis; wer die Seite mittendrin lädt, sieht es an der Stelle weiterlaufen, an der es wäre.
 */
function WheelSheet({
  wheelMs,
  phaseDeadline,
  children,
}: {
  readonly wheelMs: number;
  readonly phaseDeadline: number | null;
  readonly children: (spinMs: number, elapsedMs: number) => ReactNode;
}) {
  // Beim ersten Bild festgehalten: Spätere Abfragen verschieben die Frist nur um Millisekunden
  const [elapsedMs] = useState(() =>
    phaseDeadline === null ? 0 : Math.max(0, wheelMs - (phaseDeadline - performance.now())),
  );
  return (
    <div className="wheel-sheet" data-testid="match-wheel-disc">
      {children(Math.round(wheelMs * WHEEL_SPIN_SHARE), elapsedMs)}
    </div>
  );
}
