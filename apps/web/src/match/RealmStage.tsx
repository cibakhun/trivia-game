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
import { CategoryIcon, MarkIcon } from '../art/RealmIcons.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { SoundToggle } from '../components/SoundToggle.tsx';
import { t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { estimateToSend } from './estimate-input.ts';
import { Flights, type FlightPlan } from './Flights.tsx';
import { HelpSheet, helpSeen, markHelpSeen } from './HelpSheet.tsx';
import { incomeTiming, useIncomeFlight } from './income-flight.ts';
import { MatchBoard } from './MatchBoard.tsx';
import {
  duelResolved,
  duelStage,
  lastOf,
  outcomeBeatMs,
  revealFor,
  rulesOf,
  shownPick,
  watchedFor,
} from './match-model.ts';
import { AbandonedPanel, MomentBanner, type MatchStageProps } from './MatchStage.tsx';
import { regionNames, seatNames, stepLabel } from './match-text.ts';
import { PreparePanel } from './PreparePanel.tsx';
import type { RealmLayer } from './RealmBoardArt.tsx';
import { RealmBlatt } from './RealmBlatt.tsx';
import {
  layerRegions,
  outcomeMotion,
  outcomeSign,
  planLayer,
  realmBoardState,
  revealLayer,
  revealMotion,
} from './realm-layer.ts';
import { RealmLobby, type RealmLobbyInitial } from './RealmLobby.tsx';
import {
  fieldOptions,
  moveRefusal,
  realmPlayOf,
  realmScreenStateOf,
  revealedOrders,
  revealedRound,
  skippedAttackers,
  roundFlow,
  settleOrders,
  tradesFirst,
  withMove,
} from './realm-model.ts';
import { RealmSeatList } from './RealmSeatList.tsx';
import { incomeSources, type IncomeSource } from './realm-text.ts';
import { ResultPanel } from './ResultPanel.tsx';
import { RevealPanel } from './RevealPanel.tsx';
import { RotateHint } from './RotateHint.tsx';
import { RoundFlow } from './RoundFlow.tsx';
import { StageQuestion, WatchedQuestionCard } from './StageQuestion.tsx';
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
/** Das Zeichen der gezogenen Kategorie hebt kurz nach dem Stillstand ab und fliegt so lange. */
const WHEEL_FLY_AFTER_MS = 90;
const WHEEL_FLY_MS = 480;
/** So lange vor Ablauf der Rüstzeit gibt der Browser einen offenen Entwurf von selbst ab. */
const AUTO_SUBMIT_MS = 1500;

interface PrepState {
  /** Feldzugrunde, zu der der Entwurf gehört; `null` außerhalb der Rüstzeit. */
  readonly round: number | null;
  readonly orders: readonly RealmOrderDto[];
  readonly selected: number | null;
  /** „Ziehen“ ist offen: Der nächste Tipp auf ein leuchtendes Feld ist das Ziel, dann ist es zu. */
  readonly moving: boolean;
  /** Bei offenem „Ziehen“ zuletzt angetipptes Feld, das kein Ziel ist; das Blatt sagt warum. */
  readonly refused: number | null;
  readonly trading: boolean;
  readonly dropped: boolean;
}

const NO_PREP: PrepState = {
  round: null,
  orders: [],
  selected: null,
  moving: false,
  refused: null,
  trading: false,
  dropped: false,
};

/** Vorgaben für Standbilder (Prüfstand): was der Spieler gerade gewählt hätte. */
export interface RealmStageInitial {
  readonly orders?: readonly RealmOrderDto[];
  readonly selected?: number | null;
  readonly moving?: boolean;
  readonly refused?: number | null;
  readonly trading?: boolean;
  /** Ein Befehl fiel beim Entfernen eines anderen mit heraus. */
  readonly dropped?: boolean;
  readonly editing?: boolean;
  readonly target?: number | null;
  /** „So geht's“ ist offen. */
  readonly help?: boolean;
  /** Aufstellung: die eigene Wahl der Lieblingskategorien, bevor der Server sie hat. */
  readonly favorites?: RealmLobbyInitial;
}

export interface RealmStageProps extends MatchStageProps {
  /** Speichert die Lieblingskategorien; `true`, wenn der Server sie angenommen hat. */
  readonly onSetFavorites: (categories: readonly QuestionCategory[]) => Promise<boolean>;
  /** Gibt die Befehle ab; `true`, wenn der Server sie angenommen hat. */
  readonly onSubmitOrders: (orders: readonly RealmOrderDto[]) => Promise<boolean>;
  readonly initial?: RealmStageInitial;
}

export function RealmStage({
  view,
  events,
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
  onSetFavorites,
  onSubmitOrders,
  initial,
}: RealmStageProps) {
  const play = useMemo(() => realmPlayOf(view), [view]);
  const [editing, setEditing] = useState(initial?.editing ?? false);
  const state = realmScreenStateOf(view, local, events, editing);
  // Bewegung gibt es nur für Wechsel, die diese Seite miterlebt hat: Wer mitten im Aufdecken oder
  // in einer Auflösung lädt, sieht sofort das Endbild (Merken während des Renderns)
  const [entered, setEntered] = useState({ first: state, live: false });
  if (!entered.live && state !== entered.first) setEntered({ first: entered.first, live: true });
  const live = entered.live || state !== entered.first;
  const seq = view?.question?.seq ?? null;
  const mySeat = view?.mySeat ?? null;
  const step = play?.board.step ?? null;

  // ---- „So geht's“: vor der ersten Partie von selbst, sonst über „?“; nie über einer Frage ----
  const [help, setHelp] = useState(initial?.help ?? false);
  const asking = state === 'question';
  if (help && asking) setHelp(false);
  useEffect(() => {
    if (state !== 'lobby' || initial || helpSeen()) return;
    markHelpSeen();
    setHelp(true);
  }, [state, initial]);
  const rules = view ? rulesOf(view.match.rulesPreset) : null;
  const helpSheet =
    help && !asking && view && rules ? (
      <HelpSheet
        attackNeedsArmy={view.realm?.economy.attackNeedsArmy ?? null}
        rounds={view.realm?.campaignRounds ?? rules.campaign.rounds}
        castleLives={rules.capital.lives}
        fieldValue={rules.values.region}
        castleValue={rules.values.capital}
        onClose={() => setHelp(false)}
      />
    ) : null;

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
    moving: initial?.moving ?? false,
    refused: initial?.refused ?? null,
    trading: initial?.trading ?? false,
    dropped: initial?.dropped ?? false,
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
  // „Ziehen“ gilt nur, solange von dem Feld noch eine Armee ziehen kann
  const moving = field !== null && prep.moving && !prep.trading && field.movable > 0;
  const moveTargets = moving
    ? field.moves.filter((move) => move.max > move.count).map((move) => move.to)
    : [];
  const refused =
    moving && mySeat !== null && play && prep.refused !== null
      ? moveRefusal(play, mySeat, field, prep.refused)
      : null;

  // ---- Feldzug: Das Ziel wird erst angetippt, dann mit „Angreifen“ bestätigt ----
  const [target, setTarget] = useState<number | null>(initial?.target ?? null);
  const aiming = state === 'pick' && step?.kind === 'CAMPAIGN_TARGET';
  const aimed = aiming && target !== null && view?.legalRegions.includes(target) ? target : null;
  // Ein angetipptes Feld, das kein Ziel ist: Das Blatt sagt, warum nicht
  const refusedTarget = aiming && target !== null && aimed === null ? target : null;
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

  // ---- Einkommen: Brot und Baustoff wandern von den eigenen Feldern in den Vorrat (ADR-067) ----
  const sources = useMemo(
    () => (play && mySeat !== null ? incomeSources(play, mySeat) : []),
    [play, mySeat],
  );
  const incomeTime = useMemo(() => incomeTiming(sources.length), [sources.length]);
  const incomeSeq = useIncomeFlight(
    lastOf(events, 'INCOME')?.seq ?? 0,
    state === 'prepare' || state === 'prepared',
    live,
    incomeTime.totalMs,
  );
  // Der Flugplan steht mit dem ersten Bild fest: Spätere Ansichten ändern ihn nicht mehr
  const [incomePlan, setIncomePlan] = useState<{
    readonly seq: number;
    readonly plans: readonly FlightPlan[];
  } | null>(null);
  if (incomeSeq !== null && incomePlan?.seq !== incomeSeq) {
    setIncomePlan({ seq: incomeSeq, plans: incomeFlights(sources) });
  }
  const incoming = incomeSeq !== null && incomePlan?.seq === incomeSeq ? incomePlan.plans : null;
  const wheelMs = play?.realm.economy.timers.wheelMs ?? 0;
  const spinMs = Math.round(wheelMs * WHEEL_SPIN_SHARE);
  // Wie lange das Rad dieses Duells beim ersten Bild schon lief (Seite mitten in der Ansage
  // geladen): einmal festgehalten, denn spätere Abfragen verschieben die Frist nur um Millisekunden
  const wheelKey =
    state === 'wheel' && step ? `${step.round}:${step.attacker}:${step.region}` : null;
  const [spun, setSpun] = useState<{ key: string; elapsedMs: number } | null>(null);
  if (wheelKey !== null && spun?.key !== wheelKey) {
    setSpun({
      key: wheelKey,
      elapsedMs:
        phaseDeadline === null
          ? 0
          : Math.max(0, Math.round(wheelMs - (phaseDeadline - performance.now()))),
    });
  }
  const spunMs = wheelKey !== null && spun?.key === wheelKey ? spun.elapsedMs : 0;
  // Steht das Rad, springt das Zeichen der gezogenen Kategorie ins Blatt (ADR-067); nur, wenn die
  // Seite das Rad hat anlaufen sehen und danach noch Zeit bleibt
  const landed = state === 'wheel' ? (step?.category ?? null) : null;
  const flyMs = Math.min(WHEEL_FLY_MS, Math.round(wheelMs * 0.16));
  const flyAtMs = spinMs - spunMs + WHEEL_FLY_AFTER_MS;
  const catching = live && landed !== null && flyAtMs > 0 && flyMs >= 150;
  const wheelPlans = useMemo<readonly FlightPlan[]>(
    () =>
      catching && landed !== null && wheelKey !== null
        ? [
            {
              key: wheelKey,
              from: '[data-wheel-mark]',
              to: '.wheel-result .glyph',
              icon: <CategoryIcon category={landed} size={30} />,
            },
          ]
        : [],
    [catching, landed, wheelKey],
  );

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
              onHelp={() => setHelp(true)}
              initial={initial?.favorites}
            />
          ) : view && state === 'abandoned' ? (
            <AbandonedPanel view={view} events={events} />
          ) : feedError ? null : (
            <p className="sheet plain-sheet">{t('app.loading')}</p>
          )}
        </div>
        {helpSheet}
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
      hint:
        prep.selected === null && !prep.trading
          ? board.regions.flatMap((r, id) => (r.owner === mySeat ? [id] : []))
          : [],
      focusSeat: mySeat,
    };
  } else if (state === 'prepared' && mySeat !== null) {
    layer = { regions, ...planLayer(play, mySeat, realm.myOrders ?? []), focusSeat: mySeat };
  } else if (state === 'orders') {
    const revealed = revealedOrders(events, revealedRound(events) ?? step.round ?? 1);
    layer = {
      regions,
      ...revealLayer(revealed),
      motion: live ? revealMotion(revealed) : null,
    };
  } else if (aimed !== null) {
    layer = { regions, selected: aimed };
  } else if (state === 'reveal' && realmDuel) {
    layer = {
      regions,
      changes: [outcomeSign(realmDuel)],
      fresh: [realmDuel.payload.region],
      motion: live ? outcomeMotion(realmDuel) : null,
    };
  }
  // In der Rüstzeit lässt sich jedes Feld antippen: Fremde und freie sagen, warum dort nichts geht.
  // Beim Angriff ebenso jedes fremde und freie Feld: Was kein Ziel ist, nennt den Grund (ADR-064)
  const tappable = preparing
    ? board.regions.map((_, id) => id)
    : aiming
      ? board.regions.flatMap((r, id) => (r.owner === mySeat ? [] : [id]))
      : [];
  const campaigning =
    step.kind === 'CAMPAIGN_TARGET' ||
    step.kind === 'DUEL_WHEEL' ||
    step.kind === 'DUEL_TRIVIA' ||
    step.kind === 'DUEL_ESTIMATE';
  // Wessen Angriff ausfiel (ADR-064): beim Aufdecken in der aufgedeckten Runde, danach in der
  // laufenden; steht die letzte Runde noch (Schritt FINISHED), in dieser
  const skipRound =
    state === 'orders'
      ? revealedRound(events)
      : campaigning || step.kind === 'FINISHED'
        ? (step.round ?? null)
        : null;
  const skipped = skipRound === null ? [] : skippedAttackers(events, skipRound);

  const tapRegion = (id: number) => {
    if (preparing) {
      if (moving && prep.selected !== null) {
        const known = field.moves.find((m) => m.to === id);
        if (id === prep.selected) {
          // Tipp auf das Startfeld: doch nicht ziehen
          setPrep({ ...prep, moving: false, refused: null });
        } else if (known && moveTargets.includes(id)) {
          // Ziel des Zugs: Eine Armee zieht, und „Ziehen“ ist wieder zu
          const orders = settleOrders(
            play,
            mySeat,
            tradesFirst(withMove(prep.orders, prep.selected, id, known.count + 1)),
          ).orders;
          setPrep({ ...prep, orders, moving: false, refused: null, dropped: false });
        } else {
          setPrep({ ...prep, refused: id });
        }
      } else if (id !== prep.selected || prep.trading) {
        setPrep({ ...prep, selected: id, moving: false, refused: null, trading: false });
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
  // Wer nicht gefragt ist, liest die Frage an derselben Stelle mit (ADR-065)
  const watching = watchedFor(state, seq, watched);
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
  } else if (watching) {
    sheet = (
      <WatchedQuestionCard
        key={watching.seq}
        question={watching.question}
        deadline={watching.deadline}
        category={step.kind === 'DUEL_TRIVIA' ? step.category : null}
      />
    );
  } else if (state === 'wheel' && step.wheel && step.attacker !== null) {
    disc = true;
    sheet = (
      <div className="wheel-sheet" data-testid="match-wheel-disc">
        <Wheel
          key={wheelKey}
          wheel={step.wheel}
          attacker={step.attacker}
          defender={step.defender}
          landed={step.category}
          exhausted={lastOf(events, 'WHEEL_SPUN')?.payload.exhausted ?? []}
          spinMs={spinMs}
          elapsedMs={spunMs}
        />
      </div>
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
  // Beim Aufdecken zählt die aufgedeckte Runde: Fielen alle Angriffe aus, ist der Schritt schon in
  // der nächsten (ADR-064)
  const shownRound = state === 'orders' ? revealedRound(events) : null;
  const label =
    shownRound === null
      ? stepLabel(view)
      : t('realm.step.ROUND', { round: shownRound, rounds: realm.campaignRounds });
  const flow = roundFlow(play, state);
  const closed = state === 'finished' || state === 'abandoned';
  const waiting = board.turns
    .filter((turn) => turn.status !== 'DONE' && turn.seat !== mySeat)
    .map((turn) => name(turn.seat));
  const style: CSSProperties | undefined =
    state === 'wheel'
      ? {
          ['--wheel-spin' as string]: `${spinMs}ms`,
          ['--wheel-spun' as string]: `${-spunMs}ms`,
          // Das Zeichen im Blatt erscheint, kurz bevor das fliegende ankommt
          ['--wheel-fly' as string]: `${WHEEL_FLY_AFTER_MS + flyMs - 70}ms`,
        }
      : undefined;

  return (
    <main ref={stage} className="stage stage-realm" style={style} {...attributes}>
      <div className="stage-map">
        <MatchBoard
          map={play.map}
          board={realmBoardState(board)}
          name={name}
          legal={state === 'pick' ? view.legalRegions : []}
          selectable={tappable}
          realm={layer}
          home={mySeat}
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
        {flow ? <RoundFlow flow={flow} /> : null}
        <RealmSeatList
          view={view}
          play={play}
          name={name}
          receiving={
            incoming ? { delayMs: incomeTime.countAtMs, durationMs: incomeTime.countMs } : null
          }
        />
        <TurnOrder view={view} name={name} skipped={skipped} />
        <div className="stage-tools three">
          <SoundToggle />
          <button
            type="button"
            className="tool tool-help"
            data-testid="match-help-open"
            aria-label={t('realm.help.open')}
            title={t('realm.help.open')}
            disabled={asking}
            onClick={() => setHelp(true)}
          >
            ?
          </button>
          <button
            type="button"
            className="tool tool-leave"
            onClick={() => navigate({ name: 'start' })}
          >
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
            moving={moving}
            refused={refused}
            trading={prep.trading}
            dropped={prep.dropped}
            waiting={waiting}
            phaseDeadline={phaseDeadline}
            busy={busy}
            error={actionError}
            region={region}
            name={name}
            onOrders={(orders, dropped) => setPrep((p) => ({ ...p, orders, dropped }))}
            onMoving={(open) => setPrep((p) => ({ ...p, moving: open, refused: null }))}
            onTrading={(open) =>
              setPrep((p) => ({ ...p, trading: open, moving: false, refused: null }))
            }
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
            watching={watching !== null}
            phaseDeadline={phaseDeadline}
            estimate={estimate}
            busy={busy}
            events={events}
            reveal={reveal}
            outcome={realmDuel}
            outcomeBeat={outcomeBeat}
            catching={catching}
            error={actionError}
            name={name}
            region={region}
            target={aimed}
            refusedTarget={refusedTarget}
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
      {wheelPlans.length > 0 ? (
        <Flights
          key={`wheel-${wheelKey}`}
          stage={stage}
          plans={wheelPlans}
          startMs={flyAtMs}
          flightMs={flyMs}
          staggerMs={0}
          tone="coin"
        />
      ) : null}
      {incoming ? (
        <Flights
          key={`income-${incomeSeq}`}
          stage={stage}
          plans={incoming}
          startMs={incomeTime.startMs}
          flightMs={incomeTime.flightMs}
          staggerMs={incomeTime.staggerMs}
          nearestFirst
        />
      ) : null}
      {helpSheet}
      {toast}
      <RotateHint />
    </main>
  );
}

/** Flüge des Einkommens: je Feld ein Zeichen in den eigenen Vorrat; eine Burg schickt zwei. */
function incomeFlights(sources: readonly IncomeSource[]): FlightPlan[] {
  const perField = new Map<number, number>();
  for (const source of sources) perField.set(source.region, (perField.get(source.region) ?? 0) + 1);
  return sources.map((source) => ({
    key: `${source.region}-${source.kind}`,
    from: `[data-region="${source.region}"]`,
    to: `.plaque.me .amount-${source.kind}`,
    at: 'start' as const,
    icon: <MarkIcon kind={source.kind} size={14} />,
    // Zwei Zeichen vom selben Feld starten nebeneinander
    shift: (perField.get(source.region) ?? 1) > 1 ? (source.kind === 'bread' ? -8 : 8) : 0,
  }));
}
