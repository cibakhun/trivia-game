import type { MatchEventOf, MatchView, ParsedMatchEvent, RealmWheelDto } from '@rdw/protocol';
import type { ReactNode } from 'react';
import { CategoryIcon, MarkIcon, type Mark } from '../art/RealmIcons.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { Swords } from '../art/Swords.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { t, tp } from '../i18n/i18n.ts';
import { Countdown } from '../quiz/Countdown.tsx';
import { AnnouncePanel } from './AnnouncePanel.tsx';
import { Answers } from './Answers.tsx';
import {
  duelWinner,
  shownPick,
  type LocalQuestion,
  type MatchScreenState,
  type Reveal,
} from './match-model.ts';
import {
  pickText,
  questionContext,
  shortNames,
  type RegionName,
  type SeatName,
} from './match-text.ts';
import { NumPad } from './NumPad.tsx';
import {
  attackReach,
  favoriteChance,
  realmSeat,
  revealedOrders,
  revealedRound,
  skippedAttackers,
  wheelPreview,
  type RealmPlay,
} from './realm-model.ts';
import { categoryName, placeName, revealedParts, targetWinKey, wheelFits } from './realm-text.ts';
import { latestLine } from './StageBlatt.tsx';

/**
 * Das Blatt rechts auf dem Meer in der Partie mit Ausbau (MATCH_RULES §11, ADR-060): sagt in jeder
 * Phase, was geschieht und was zu tun ist. Burg, Dorf und Feld setzen, das Angriffsziel mit seinen
 * Losen im Glücksrad, das Aufgedeckte nach der Rüstzeit, wer gegen wen kämpft und wer schon
 * geantwortet hat, das Ziffernfeld der Schätzfrage und der Ausgang eines Duells mit dem, was sich
 * auf dem Feld geändert hat. Die Rüstzeit selbst zeichnet `PreparePanel`. Immer an derselben
 * Stelle und gleich groß, damit die Karte daneben nie rückt.
 */

type RealmDuel = MatchEventOf<'REALM_DUEL_RESOLVED'>;

function noop() {
  // Ablauf einer Anzeige: Den nächsten Schritt bringt die Abfrage
}

/** Wer gegen wen und worum, oben im Blatt; ohne Verteidiger steht dort „freies Feld“ (O-37). */
function DuelBox({
  attacker,
  defender,
  what,
  short,
  sentence,
}: {
  readonly attacker: number;
  readonly defender: number | null;
  readonly what: string;
  readonly short: SeatName;
  /** Ganzer Satz für Screenreader. */
  readonly sentence: string | null;
}) {
  return (
    <div className="duel-box" data-testid="match-duel">
      {sentence ? <p className="visually-hidden">{sentence}</p> : null}
      <p className="duel-box-sides" aria-hidden="true">
        <span className="duel-who">
          <SeatCrest seat={attacker} size={22} />
          <strong>{short(attacker)}</strong>
        </span>
        <Swords size={20} />
        {defender === null ? (
          <span className="duel-who duel-free">
            <strong>{t('realm.target.freeField')}</strong>
          </span>
        ) : (
          <span className="duel-who">
            <SeatCrest seat={defender} size={22} />
            <strong>{short(defender)}</strong>
          </span>
        )}
      </p>
      <p className="duel-what">{what}</p>
    </div>
  );
}

function Pips({ count, seat }: { readonly count: number; readonly seat: number | null }) {
  return (
    <span className="pips" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={seat === null ? undefined : { background: `var(--seat-${seat})` }} />
      ))}
    </span>
  );
}

/** Lose im Glücksrad: je Seite ein Strich je Los, daneben die Zahl. */
function Lots({
  wheel,
  attacker,
  defender,
  short,
}: {
  readonly wheel: Pick<RealmWheelDto, 'attackerLots' | 'defenderLots' | 'freeLots'>;
  readonly attacker: number;
  /** `null` = freies Feld: Niemand bringt Lose dagegen mit. */
  readonly defender: number | null;
  readonly short: SeatName;
}) {
  const side = (seat: number, count: number) => (
    <li className={`lot seat-${seat}`} data-seat={seat}>
      <span className="lot-who">
        <SeatCrest seat={seat} size={16} /> {short(seat)}
      </span>
      <Pips count={count} seat={seat} />
      <strong>{count}</strong>
    </li>
  );
  return (
    <ul className="lots" data-testid="match-lots">
      {side(attacker, wheel.attackerLots)}
      {defender === null ? null : side(defender, wheel.defenderLots)}
      <li className="lot lot-free">
        <span className="lot-who">{t('realm.target.free')}</span>
        <Pips count={wheel.freeLots} seat={null} />
        <strong>{wheel.freeLots}</strong>
      </li>
    </ul>
  );
}

interface Fact {
  readonly icon: Mark | 'coin';
  readonly text: string;
}

/** Was sich mit dem Ausgang auf dem Feld geändert hat, als kurze Zeilen (MATCH_RULES §11.7). */
function outcomeFacts(duel: RealmDuel, mySeat: number | null, name: SeatName): Fact[] {
  const p = duel.payload;
  const attacker = name(p.attacker);
  const mine = p.attacker === mySeat;
  const facts: Fact[] = [];
  switch (p.effect) {
    case 'CONQUERED':
      facts.push({
        icon: 'army',
        text: mine
          ? t('realm.outcome.fact.conqueredMe')
          : t('realm.outcome.fact.conquered', { attacker }),
      });
      break;
    case 'BUILDING_DAMAGED':
      facts.push(
        p.building === 'VILLAGE'
          ? { icon: 'town', text: t('realm.outcome.fact.townDown') }
          : { icon: 'village', text: t('realm.outcome.fact.villageGone') },
      );
      break;
    case 'CASTLE_HIT':
      facts.push({
        icon: 'castle',
        text: tp('realm.outcome.fact.castleLives', p.castleLivesLeft ?? 0),
      });
      break;
    case 'CASTLE_DESTROYED':
      facts.push({
        icon: 'castle',
        text: mine
          ? t('realm.outcome.fact.castleGoneMe')
          : t('realm.outcome.fact.castleGone', { attacker }),
      });
      break;
    case 'TAKEOVER':
      facts.push({
        icon: 'castle',
        text: mine
          ? t('realm.outcome.fact.takeoverMe')
          : t('realm.outcome.fact.takeover', { attacker }),
      });
      break;
    case 'FORTIFIED':
      facts.push({
        icon: 'coin',
        text: t('realm.outcome.fact.fortified', { value: p.regionValue }),
      });
      break;
    case 'CLAIMED':
      facts.push(
        {
          icon: 'army',
          text: mine
            ? t('realm.outcome.fact.conqueredMe')
            : t('realm.outcome.fact.conquered', { attacker }),
        },
        { icon: 'coin', text: t('realm.outcome.fact.worth', { value: p.regionValue }) },
      );
      break;
    case 'UNCLAIMED':
      facts.push({ icon: 'army', text: t('realm.outcome.fact.noLoss') });
      break;
  }
  if (p.armyLost) {
    facts.push({
      icon: 'army',
      text:
        p.armyLost.seat === mySeat
          ? t('realm.outcome.fact.armyLostMe')
          : t('realm.outcome.fact.armyLost', { name: name(p.armyLost.seat) }),
    });
  }
  return facts;
}

/** Was nach dem Ausgang kommt, aus dem Schritt, in dem die Partie schon steht. */
function nextUp(
  view: MatchView,
  play: RealmPlay,
  name: SeatName,
): { readonly seat: number | null; readonly text: string } | null {
  const { step } = play.board;
  if (step.kind === 'CAMPAIGN_TARGET' && step.chooser !== null) {
    return {
      seat: step.chooser,
      text:
        step.chooser === view.mySeat
          ? t('realm.outcome.nextAttackMe')
          : t('realm.outcome.nextAttack', { name: name(step.chooser) }),
    };
  }
  if (step.kind === 'PREPARE') return { seat: null, text: t('realm.outcome.nextRound') };
  if (step.kind === 'FINISHED') return { seat: null, text: t('realm.outcome.nextEnd') };
  return null;
}

export function RealmBlatt({
  view,
  play,
  state,
  local,
  watching = false,
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
  target,
  refusedTarget = null,
  onEstimate,
  onAnswerEstimate,
  onAttack,
}: {
  readonly view: MatchView;
  readonly play: RealmPlay;
  readonly state: MatchScreenState;
  readonly local: LocalQuestion | null;
  /** Die Frage anderer steht zum Mitlesen auf der Karte (ADR-065). */
  readonly watching?: boolean;
  readonly phaseDeadline: number | null;
  readonly estimate: string;
  readonly busy: boolean;
  readonly events: readonly ParsedMatchEvent[];
  readonly reveal: Reveal | null;
  /** Eben entschiedenes Duell: steht während der ganzen Auflösung im Blatt. */
  readonly outcome: RealmDuel | null;
  /** Erster Takt der Auflösung: Die Karte zeigt den Ausgang, die Antworten folgen. */
  readonly outcomeBeat: boolean;
  readonly error: unknown;
  readonly name: SeatName;
  readonly region: RegionName;
  /** Angriffsziel, das der Spieler angetippt, aber noch nicht bestätigt hat. */
  readonly target: number | null;
  /** Angetipptes Feld, das kein Ziel ist: Das Blatt sagt, warum nicht (ADR-064). */
  readonly refusedTarget?: number | null;
  readonly onEstimate: (update: (current: string) => string) => void;
  readonly onAnswerEstimate: () => void;
  readonly onAttack: () => void;
}) {
  const { timers } = view.match;
  const { board, realm } = play;
  const { step } = board;
  const { economy } = realm;
  const short = shortNames(view);
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
  // Ohne Verteidiger (freies Feld) und für Zuschauer ohne Sitz wird niemand hier angegriffen
  const attacked = step.defender !== null && step.defender === view.mySeat;
  const place = (id: number) => placeName(board.regions[id]?.building ?? 'NONE', region(id));
  const building = (id: number) => board.regions[id]?.building ?? 'NONE';
  // Ein Ziel steht nur in den Schritten eines Duells; ohne Verteidiger ist es ein freies Feld
  const duelBox = (key: 'about' | 'attackOn') =>
    step.attacker !== null && step.region !== null ? (
      <DuelBox
        attacker={step.attacker}
        defender={step.defender}
        what={t(`realm.${key}.${step.defender === null ? 'FREE' : building(step.region)}`, {
          region: region(step.region),
        })}
        short={short}
        sentence={questionContext(view, name, region)}
      />
    ) : null;
  /** Überschrift während einer Frage: aus der Sicht dieses Sitzes. */
  const questionTitle = () => {
    if (step.kind === 'START_ESTIMATE') return t('realm.question.start');
    if (step.kind === 'LAND_ESTIMATE') return t('match.stage.role.land');
    if (step.kind === 'DUEL_ESTIMATE') return t('match.stage.role.tiebreak');
    if (step.attacker === view.mySeat) return t('match.stage.role.attacker');
    if (attacked) return t('realm.question.attacked');
    return t(step.defender === null ? 'realm.question.claimWatching' : 'match.stage.role.watching');
  };
  const questionTone = () => (step.kind === 'DUEL_TRIVIA' && attacked ? 'attacked' : 'turn');

  switch (state) {
    case 'pick': {
      if (step.kind === 'CAMPAIGN_TARGET') {
        const aimed = target === null ? null : (board.regions[target] ?? null);
        const wheel =
          aimed && target !== null && view.mySeat !== null
            ? wheelPreview(play, view.mySeat, target)
            : null;
        const refusedReach =
          refusedTarget !== null && view.mySeat !== null
            ? attackReach(play, view.mySeat, refusedTarget)
            : null;
        return sheet(
          'turn',
          'match-pick',
          true,
          <>
            <h2 className="blatt-title">{t('realm.pick.CAMPAIGN_TARGET')}</h2>
            <p className="visually-hidden">{pickText(view, name)}</p>
            {phaseTimer(timers.pickMs)}
            {aimed && wheel && target !== null && view.mySeat !== null ? (
              <>
                <div
                  className="feld"
                  data-testid="match-target"
                  data-region={target}
                  data-free={aimed.owner === null ? '' : undefined}
                >
                  <strong className="feld-name">{region(target)}</strong>
                  <span className="feld-fact">
                    {aimed.owner === null ? (
                      t('realm.target.fact.FREE')
                    ) : (
                      <>
                        {t(`realm.target.fact.${aimed.building}`, { owner: name(aimed.owner) })},{' '}
                        {tp('realm.armies', aimed.armies)}
                      </>
                    )}
                  </span>
                </div>
                <div className="lots-box">
                  <h3>{t('realm.target.lots')}</h3>
                  <Lots wheel={wheel} attacker={view.mySeat} defender={aimed.owner} short={short} />
                  <p className="lots-note" data-testid="match-lots-chance">
                    <strong>
                      {t('realm.target.chance', {
                        percent: favoriteChance(
                          wheel,
                          realmSeat(play, view.mySeat)?.favorites ?? [],
                        ),
                      })}
                    </strong>{' '}
                    {t('realm.target.chanceFor')}
                    <span className="lots-more"> {t('realm.target.lotsNote')}</span>
                  </p>
                </div>
                <p className="blatt-hint">
                  {t(`realm.target.win.${targetWinKey(play, aimed)}`, {
                    owner: aimed.owner === null ? '' : name(aimed.owner),
                  })}
                </p>
                <button
                  type="button"
                  className="button button-primary blatt-go"
                  disabled={busy}
                  onClick={onAttack}
                >
                  {t('realm.pick.attack')}
                </button>
              </>
            ) : (
              <>
                {refusedReach === 'NO_ARMY' || refusedReach === 'FAR' ? (
                  <p
                    className="act-info act-refused"
                    data-testid="match-target-refused"
                    data-reach={refusedReach}
                    role="status"
                  >
                    {t(`realm.pick.refused.${refusedReach}`, {
                      region: region(refusedTarget ?? 0),
                    })}
                  </p>
                ) : null}
                <p className="blatt-hint">
                  {t(
                    economy.attackNeedsArmy === 'ALWAYS'
                      ? 'realm.pick.hintTargetArmy'
                      : economy.attackNeedsArmy === 'RIVALS'
                        ? 'realm.pick.hintTargetRivals'
                        : 'realm.pick.hintTarget',
                  )}
                </p>
              </>
            )}
          </>,
        );
      }
      const kind =
        step.kind === 'CASTLE_PICK' || step.kind === 'VILLAGE_PICK' ? step.kind : 'LAND_PICK';
      return sheet(
        'turn',
        'match-pick',
        true,
        <>
          <h2 className="blatt-title">{t(`realm.pick.${kind}`)}</h2>
          <p className="visually-hidden">{pickText(view, name)}</p>
          {phaseTimer(timers.pickMs)}
          <p className="blatt-hint">
            {kind === 'CASTLE_PICK'
              ? t('realm.pick.hintCastle', {
                  lives: tp('match.board.lives', play.castleLives),
                  armies: tp('realm.armies', economy.startArmies),
                })
              : kind === 'VILLAGE_PICK'
                ? t('realm.pick.hintVillage', {
                    village: economy.yields.village,
                    plain: economy.yields.plain,
                  })
                : t('realm.pick.hintLand')}
          </p>
        </>,
      );
    }
    case 'waiting-pick': {
      const latest = latestLine(events, name, region);
      return sheet(
        '',
        'match-pick',
        true,
        <>
          <h2 className="blatt-title">{waitTitle(step.kind)}</h2>
          <p className="blatt-lead">
            {step.chooser === null ? null : <SeatCrest seat={step.chooser} size={24} />}
            <strong>{pickText(view, name)}</strong>
          </p>
          {phaseTimer(timers.pickMs, true)}
          {latest ? <p className="blatt-last">{latest}</p> : null}
        </>,
      );
    }
    case 'announce': {
      const shown = shownPick(events);
      const title =
        shown?.type === 'CASTLE_CHOSEN'
          ? waitTitle('CASTLE_PICK')
          : shown?.type === 'VILLAGE_CHOSEN'
            ? waitTitle('VILLAGE_PICK')
            : shown?.type === 'REGION_CLAIMED'
              ? waitTitle('LAND_PICK')
              : waitTitle(step.kind);
      return (
        <section className="blatt">
          <h2 className="blatt-title">{title}</h2>
          <AnnouncePanel
            view={view}
            events={events}
            name={name}
            region={region}
            fallback={latestLine(events, name, region)}
            timer={null}
          />
          {phaseTimer(timers.pickShowMs, true)}
          {note}
        </section>
      );
    }
    case 'orders': {
      // Fielen alle Angriffe aus, ist der Schritt schon in der nächsten Runde (ADR-064)
      const round = revealedRound(events) ?? step.round ?? 1;
      const rows = revealedOrders(events, round);
      const out = skippedAttackers(events, round);
      const attacking =
        step.kind === 'CAMPAIGN_TARGET' ||
        step.kind === 'DUEL_WHEEL' ||
        step.kind === 'DUEL_TRIVIA' ||
        step.kind === 'DUEL_ESTIMATE'
          ? board.turns.filter((turn) => !out.includes(turn.seat))
          : [];
      const order = attacking.map((turn) => short(turn.seat));
      return sheet(
        '',
        'match-orders',
        true,
        <>
          <h2 className="blatt-title">{t('realm.orders.title')}</h2>
          <ul className="aufdeck">
            {rows.map((row) => {
              const parts = revealedParts(row, region);
              return (
                <li
                  key={row.payload.seat}
                  className={`aufdeck-row seat-${row.payload.seat}`}
                  data-seat={row.payload.seat}
                >
                  <span className="aufdeck-who">
                    <SeatCrest seat={row.payload.seat} size={18} />
                    <strong>{short(row.payload.seat)}</strong>
                  </span>
                  {parts.length === 0 ? (
                    <span className="aufdeck-part none">{t('realm.orders.nothing')}</span>
                  ) : (
                    parts.map((part, i) => (
                      <span key={i} className="aufdeck-part">
                        <MarkIcon kind={part.icon} size={16} />
                        {part.text}
                      </span>
                    ))
                  )}
                </li>
              );
            })}
          </ul>
          {order.length > 0 ? (
            <p className="blatt-hint">{t('realm.orders.next', { names: order.join(', ') })}</p>
          ) : out.length > 0 ? (
            <p className="blatt-hint">{t('realm.orders.nobody')}</p>
          ) : null}
          {out.length > 0 ? (
            <p className="blatt-hint aufdeck-out" data-testid="orders-skipped">
              {t('realm.orders.skipped', { names: out.map((seat) => short(seat)).join(', ') })}
            </p>
          ) : null}
          {phaseTimer(economy.timers.ordersRevealMs, true)}
        </>,
      );
    }
    case 'wheel': {
      const { wheel, category } = step;
      if (!wheel || step.attacker === null) return null;
      const favorites = (seat: number) => board.seats.find((s) => s.seat === seat)?.favorites ?? [];
      const tone = attacked ? 'attacked' : step.attacker === view.mySeat ? 'turn' : '';
      return sheet(
        tone,
        'match-wheel',
        true,
        <>
          <h2 className="blatt-title">{t('realm.wheel.title')}</h2>
          {duelBox('attackOn')}
          <div className="lots-box">
            <h3>{t('realm.wheel.lots')}</h3>
            <Lots wheel={wheel} attacker={step.attacker} defender={step.defender} short={short} />
          </div>
          <p className="blatt-hint wheel-hint">
            {t(step.defender === null ? 'realm.wheel.hintFree' : 'realm.wheel.hint')}
          </p>
          {category ? (
            <p className="wheel-result" data-testid="wheel-result" data-category={category}>
              <CategoryIcon category={category} size={34} />
              <span>
                <strong>{categoryName(category)}</strong>
                <small>
                  {wheelFits(category, favorites, step.attacker, step.defender, view.mySeat, name)}
                </small>
              </span>
            </p>
          ) : null}
          {phaseTimer(economy.timers.wheelMs, true)}
        </>,
      );
    }
    case 'question': {
      if (!local?.question) return null;
      const question = local.question;
      return sheet(
        questionTone(),
        'match-answering',
        false,
        <>
          <h2 className="blatt-title">{questionTitle()}</h2>
          {question.kind === 'ESTIMATE' ? (
            <>
              {/* Das Ziffernfeld braucht die Höhe: Worum es geht, steht hier in einer Zeile */}
              <p className="blatt-hint">
                <span className="visually-hidden">{questionContext(view, name, region)} </span>
                <span aria-hidden="true">{estimateRule(step.kind, step.region, place)}</span>
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
              {duelBox('about')}
              <Answers view={view} local={local} short={short} />
              <p className="blatt-hint">
                {t(step.defender === null ? 'realm.question.claimRule' : 'match.stage.triviaRule')}
              </p>
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
            ? // Allein gefragt (freies Feld, O-37): Es gibt niemanden, auf den zu warten wäre
              t(
                view.question?.seats.length === 1
                  ? 'realm.question.claimAnswered'
                  : 'match.question.answered',
              )
            : state === 'missed'
              ? t('match.question.missed')
              : t(watching ? 'match.question.watching' : 'match.question.spectating');
      return sheet(
        '',
        'match-waiting',
        false,
        <>
          <h2 className="blatt-title">{questionTitle()}</h2>
          {duelBox('about') ?? (
            <p className="blatt-hint">{estimateRule(step.kind, step.region, place)}</p>
          )}
          <Answers view={view} local={local} short={short} />
          <p className={`blatt-status${state === 'answered' ? ' done' : ''}`} aria-live="polite">
            {text}
          </p>
          {phaseTimer(questionMs, true)}
        </>,
      );
    }
    case 'reveal': {
      if (outcome) {
        return (
          <OutcomeBlatt
            view={view}
            play={play}
            duel={outcome}
            name={name}
            region={region}
            timer={outcomeBeat ? null : phaseTimer(timers.revealMs, true)}
            note={note}
          />
        );
      }
      const ranked = reveal?.outcome.some(
        (o) => o.type === 'LAND_RANKED' || o.type === 'START_RANKED',
      );
      const start = reveal?.outcome.some((o) => o.type === 'START_RANKED') ?? false;
      return sheet(
        '',
        'match-revealing',
        false,
        <>
          <h2 className="blatt-title">{t('match.reveal.title')}</h2>
          {ranked ? (
            <p className="blatt-hint">
              {start ? t('realm.question.startRule') : t('match.moment.landDetail')}
            </p>
          ) : (
            // Gleichstand im Duell: Was daraus folgt, steht auf dem Blatt in der Mitte
            duelBox('about')
          )}
          {phaseTimer(timers.revealMs, true)}
        </>,
      );
    }
    case 'watching-prepare':
      return sheet(
        '',
        'match-prepare-watching',
        true,
        <>
          <h2 className="blatt-title">{t('realm.prepare.title')}</h2>
          <p className="blatt-hint">{t('realm.prepare.watching')}</p>
          {phaseTimer(economy.timers.prepareMs, true)}
        </>,
      );
    case 'prepare':
    case 'prepared':
    case 'finished':
    case 'loading':
    case 'lobby':
    case 'abandoned':
      return null;
  }
}

type StepKind = RealmPlay['board']['step']['kind'];

/** Überschrift, solange ein anderer wählt oder eine Wahl gezeigt wird. */
function waitTitle(kind: StepKind): string {
  switch (kind) {
    case 'CASTLE_PICK':
    case 'VILLAGE_PICK':
      return t(`realm.pick.wait.${kind}`);
    case 'START_ESTIMATE':
      return t('realm.question.start');
    case 'LAND_ESTIMATE':
    case 'LAND_PICK':
      return t('match.stage.wait.LAND_PICK');
    case 'PREPARE':
      return t('realm.prepare.title');
    case 'CAMPAIGN_TARGET':
    case 'DUEL_WHEEL':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      return t('match.stage.wait.CAMPAIGN_TARGET');
  }
}

/** Worum die Schätzfrage geht, in einer kurzen Zeile über dem Ziffernfeld. */
function estimateRule(
  kind: StepKind,
  region: number | null,
  place: (region: number) => string,
): string {
  if (kind === 'START_ESTIMATE') return t('realm.question.startRule');
  return kind === 'DUEL_ESTIMATE' && region !== null
    ? t('match.stage.tiebreakRule', { region: place(region) })
    : t('match.moment.landDetail');
}

/**
 * Ausgang eines Duells (MATCH_RULES §11.7): wer gewinnt, was das für das Feld heißt, was sich
 * geändert hat und was als Nächstes kommt. Farbe und Wappen des Siegers.
 */
function OutcomeBlatt({
  view,
  play,
  duel,
  name,
  region,
  timer,
  note,
}: {
  readonly view: MatchView;
  readonly play: RealmPlay;
  readonly duel: RealmDuel;
  readonly name: SeatName;
  readonly region: RegionName;
  readonly timer: ReactNode;
  readonly note: ReactNode;
}) {
  const p = duel.payload;
  const mySeat = view.mySeat;
  const defender = p.defender === null ? '' : name(p.defender);
  const role =
    p.attacker === mySeat
      ? 'attacker'
      : p.defender !== null && p.defender === mySeat
        ? 'defender'
        : 'other';
  // Freies Feld (O-37): Es gibt keinen Verteidiger, und bleibt es frei, gewinnt niemand
  const claim = p.effect === 'CLAIMED' || p.effect === 'UNCLAIMED' ? p.effect : null;
  const winner = duelWinner(p);
  const title = claim
    ? claim === 'UNCLAIMED'
      ? t('realm.outcome.title.unclaimed')
      : role === 'attacker'
        ? t('realm.outcome.title.claimed')
        : t('realm.outcome.title.claimedOther', { name: name(p.attacker) })
    : role === 'other'
      ? t('realm.outcome.title.other', { name: winner === null ? '' : name(winner) })
      : t(winner === mySeat ? 'realm.outcome.title.won' : 'realm.outcome.title.lost');
  const params = { attacker: name(p.attacker), defender, region: region(p.region) };
  const main =
    p.effect === 'CLAIMED' || p.effect === 'UNCLAIMED'
      ? t(`realm.outcome.${role === 'attacker' ? 'attacker' : 'other'}.${p.effect}`, params)
      : t(`realm.outcome.${role}.${p.effect}`, params);
  const next = nextUp(view, play, name);
  const stays =
    p.effect !== 'BUILDING_DAMAGED'
      ? null
      : role === 'defender'
        ? t(p.building === 'NONE' ? 'realm.outcome.staysMe' : 'realm.outcome.staysBuiltMe')
        : t(p.building === 'NONE' ? 'realm.outcome.stays' : 'realm.outcome.staysBuilt', {
            defender,
          });
  return (
    <section
      className={`blatt outcome${winner === null ? ' outcome-none' : ` seat-${winner}`}`}
      data-testid="match-outcome"
      data-effect={p.effect}
      aria-live="polite"
    >
      <h2 className="blatt-title">{title}</h2>
      <p className="outcome-main">
        {/* Bleibt ein freies Feld frei, steht das Wappen dessen da, der es versucht hat */}
        <SeatCrest seat={winner ?? p.attacker} size={30} />
        <span>{main}</span>
      </p>
      <ul className="outcome-list">
        {outcomeFacts(duel, mySeat, name).map((fact, i) => (
          <li key={i}>
            {fact.icon === 'coin' ? (
              <svg className="points-coin" viewBox="-50 -50 100 100" aria-hidden="true">
                <circle r="40" strokeWidth="12" />
              </svg>
            ) : (
              <MarkIcon kind={fact.icon} size={18} />
            )}
            {fact.text}
          </li>
        ))}
      </ul>
      {stays ? <p className="blatt-hint">{stays}</p> : null}
      {next ? (
        <div className="next">
          <h3>{t('realm.outcome.next')}</h3>
          <p>
            {next.seat === null ? null : <SeatCrest seat={next.seat} size={16} />}
            {next.text}
          </p>
        </div>
      ) : null}
      {timer}
      {note}
    </section>
  );
}
