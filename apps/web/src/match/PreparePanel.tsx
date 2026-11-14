import type { RealmOrderDto } from '@rdw/protocol';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { CountUp } from '../art/CountUp.tsx';
import { Amount, MarkIcon, type Mark } from '../art/RealmIcons.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { t, tp } from '../i18n/i18n.ts';
import { Countdown } from '../quiz/Countdown.tsx';
import type { RegionName } from './match-text.ts';
import {
  attackReachOn,
  fieldOptions,
  fieldRows,
  plannedRegions,
  plannedTargets,
  planOrders,
  realmSeat,
  settleOrders,
  tradeOptions,
  tradesFirst,
  withBuild,
  withRecruit,
  withTrade,
  type Cost,
  type FieldBlock,
  type FieldOptions,
  type MoveRefusal,
  type RealmPlay,
} from './realm-model.ts';
import {
  blockText,
  buildingMark,
  fieldYield,
  orderChips,
  placeName,
  refusalText,
  terrainName,
} from './realm-text.ts';

/**
 * Blatt der Rüstzeit (MATCH_RULES §11.3, §11.4): oben der Vorrat, wie er nach den geplanten
 * Befehlen bliebe, mit dem Tausch daneben; in der Mitte das gewählte Feld mit immer denselben drei
 * Zeilen (Ausbauen, Armeen kaufen, Armeen ziehen), jede mit Preis und eigenem Knopf oder mit dem
 * Grund, aus dem sie gerade nichts anbietet; darunter die eigenen Befehle als Plättchen zum
 * Zurücknehmen und „Fertig“. Gerechnet wird mit den Regeln des Servers (`realm-model`); abgegeben
 * ist erst, was „Fertig“ schickt. Das Blatt ist immer gleich groß. Zu Beginn der Rüstzeit landet
 * hier oben das Einkommen (ADR-070): Der Vorrat erscheint mit dem Stand davor, und seine Zahlen
 * zählen hoch, während die Plättchen von den eigenen Feldern ankommen.
 */

/** Einkommen, das gerade von den eigenen Feldern in den Vorrat dieses Blatts fliegt. */
export interface StockArrival {
  readonly bread: number;
  readonly material: number;
  /** Ab wann und wie lange die Zahlen mit den Ankünften hochzählen. */
  readonly delayMs: number;
  readonly durationMs: number;
  /** Was ankommt: Nur diese Zeichen heben sich. */
  readonly kinds: readonly ('bread' | 'material')[];
}

/** So lange zählt der Vorrat, wenn ein Befehl ihn ändert. */
const STOCK_COUNT_MS = 350;

function noop() {
  // Ablauf der Rüstzeit: Den nächsten Schritt bringt die Abfrage
}

/** Über so vielen Befehlen zeigen Bauten nur noch ihr Zeichen, damit mehr in die eine Zeile passen. */
const DENSE_FROM = 3;

/**
 * Die Befehle stehen in einer einzigen Zeile, damit das Blatt nie wächst. Passen nicht alle hinein,
 * lässt sich die Zeile seitlich schieben: Ein neuer Befehl rückt von selbst ins Bild, und die Ränder
 * blenden aus, wo noch etwas folgt.
 */
function useOrderStrip(count: number) {
  const ref = useRef<HTMLUListElement>(null);
  // Am Ende angeheftet, bis der Spieler die Zeile selbst zurückschiebt
  const pinned = useRef(true);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    pinned.current = !right;
    setEdge((now) => (now.left === left && now.right === right ? now : { left, right }));
  };
  const toEnd = () => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
    measure();
  };
  useLayoutEffect(toEnd, [count]);
  // Die Maße der Bühne stehen erst nach dem ersten Bild fest und ändern sich beim Drehen
  const empty = count === 0;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => (pinned.current ? toEnd() : measure()));
    observer.observe(el);
    return () => observer.disconnect();
    // Die Liste gibt es nur mit Befehlen: neu beobachten, wenn sie entsteht
  }, [empty]);
  return { ref, edge, measure };
}

function CostView({ cost }: { readonly cost: Cost }) {
  return (
    <span className="cost">
      {cost.bread > 0 ? (
        <Amount kind="bread" value={cost.bread} label={t('realm.bread')} size={15} />
      ) : null}
      {cost.material > 0 ? (
        <Amount kind="material" value={cost.material} label={t('realm.material')} size={15} />
      ) : null}
    </span>
  );
}

function Stepper({
  value,
  max,
  label,
  disabled,
  onChange,
}: {
  readonly value: number;
  readonly max: number;
  /** Wovon die Zahl spricht, für Screenreader. */
  readonly label: string;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="step-btn"
        aria-label={t('realm.prepare.less')}
        disabled={disabled || value <= 0}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <strong className="step-value" aria-live="polite">
        {value}
      </strong>
      <button
        type="button"
        className="step-btn"
        aria-label={t('realm.prepare.more')}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </span>
  );
}

export function PreparePanel({
  play,
  seat,
  orders,
  done,
  selected,
  moving,
  refused,
  trading,
  dropped,
  waiting,
  phaseDeadline,
  busy,
  error,
  region,
  name,
  arriving = null,
  onOrders,
  onMoving,
  onTrading,
  onSubmit,
  onEdit,
}: {
  readonly play: RealmPlay;
  readonly seat: number;
  /** Entwurf der eigenen Befehle; nach der Abgabe die abgegebenen. */
  readonly orders: readonly RealmOrderDto[];
  /** Abgegeben: Das Blatt zeigt die Befehle und wartet auf die anderen. */
  readonly done: boolean;
  readonly selected: number | null;
  /** „Ziehen“ ist offen: Der nächste Tipp auf ein leuchtendes Feld ist das Ziel des Zugs. */
  readonly moving: boolean;
  /** Der letzte Tipp bei offenem „Ziehen“ war kein Ziel: warum nicht. */
  readonly refused: MoveRefusal | null;
  readonly trading: boolean;
  /** Mit dem letzten Zurücknehmen fiel ein späterer Befehl mit heraus. */
  readonly dropped: boolean;
  /** Namen der Reiche, die noch rüsten. */
  readonly waiting: readonly string[];
  readonly phaseDeadline: number | null;
  readonly busy: boolean;
  readonly error: unknown;
  readonly region: RegionName;
  readonly name: (seat: number) => string;
  /** Das Einkommen dieser Runde ist noch unterwegs in den Vorrat oben im Blatt. */
  readonly arriving?: StockArrival | null;
  readonly onOrders: (orders: RealmOrderDto[], dropped: boolean) => void;
  readonly onMoving: (open: boolean) => void;
  readonly onTrading: (open: boolean) => void;
  readonly onSubmit: () => void;
  readonly onEdit: () => void;
}) {
  const { economy } = play.realm;
  const stock = realmSeat(play, seat);
  const plan = planOrders(play, seat, orders);
  const left = plan.ok
    ? { bread: plan.bread, material: plan.material }
    : { bread: stock?.bread ?? 0, material: stock?.material ?? 0 };
  // Solange noch kein Befehl geplant ist, zählt der Vorrat mit den Ankünften; ein Befehl mitten im
  // Flug rechnet sofort, ohne auf die Plättchen zu warten
  const landing = arriving !== null && orders.length === 0 ? arriving : null;
  const stockValue = (kind: 'bread' | 'material') => (
    <CountUp
      value={left[kind]}
      render={String}
      {...(arriving ? { from: Math.max(0, left[kind] - arriving[kind]) } : {})}
      durationMs={landing?.durationMs ?? STOCK_COUNT_MS}
      delayMs={landing?.delayMs ?? 0}
      steady={landing !== null}
    />
  );
  const chips = orderChips(play, orders, region);
  const strip = useOrderStrip(chips.length);
  const field = selected === null || done ? null : fieldOptions(play, seat, orders, selected);
  // Angriff nur mit Armee (ADR-064): Stünde nach dem Entwurf keine neben einem Ziel, fiele er aus
  const noTarget =
    economy.attackNeedsArmy !== undefined && plannedTargets(play, seat, orders).length === 0;
  // Ein Hinweis zur Zeit, kurz in der Zeile über den Befehlen; der ganze Satz für Screenreader
  const note = done
    ? null
    : dropped
      ? {
          kind: 'DROPPED' as const,
          short: t('realm.prepare.droppedShort'),
          text: t('realm.prepare.dropped'),
        }
      : noTarget
        ? {
            kind: 'NO_TARGET' as const,
            short: t('realm.prepare.noTargetShort'),
            text: t('realm.prepare.noTarget'),
          }
        : null;
  // Jede Änderung geht durch die Regeln: Was danach nicht mehr geht, fällt mit heraus
  const change = (next: readonly RealmOrderDto[]) => {
    const settled = settleOrders(play, seat, tradesFirst(next));
    onOrders(settled.orders, settled.dropped.length > 0);
  };

  let body: ReactNode;
  if (done) {
    body = (
      <p className="blatt-wait" aria-live="polite">
        <strong>{t('realm.prepare.submitted')}</strong>{' '}
        {waiting.length > 0
          ? tp('realm.prepare.waiting', waiting.length, { names: waiting.join(', ') })
          : null}{' '}
        {t('realm.prepare.secret')}
      </p>
    );
  } else if (trading) {
    body = (
      <>
        <div className="feld">
          <strong className="feld-name">{t('realm.prepare.tradeTitle')}</strong>
          <span className="feld-fact">
            {t('realm.prepare.tradeFact', { rate: economy.tradeRate })}
          </span>
        </div>
        {tradeOptions(play, seat, orders).map((option) => {
          const give = option.give === 'BREAD' ? 'bread' : 'material';
          const get = option.give === 'BREAD' ? 'material' : 'bread';
          return (
            <div key={option.give} className="detail" data-trade={option.give}>
              <span className="detail-what trade-what" aria-hidden="true">
                <Amount kind={give} value={option.rate} label="" size={16} />
                <span className="trade-for">{t('realm.prepare.tradeFor')}</span>
                <Amount kind={get} value={1} label="" size={16} />
              </span>
              <Stepper
                value={option.count}
                max={option.max}
                label={t(`realm.prepare.tradeGive.${option.give}`)}
                disabled={busy}
                onChange={(count) => change(withTrade(orders, option.give, count))}
              />
            </div>
          );
        })}
      </>
    );
  } else if (field) {
    body = (
      <FieldBody
        play={play}
        seat={seat}
        orders={orders}
        field={field}
        moving={moving}
        refused={refused}
        busy={busy}
        region={region}
        name={name}
        onChange={change}
        onMoving={onMoving}
      />
    );
  } else if (selected !== null && !done && play.board.regions[selected]) {
    // Fremdes oder freies Feld: In der Rüstzeit geht dort nichts, das Blatt sagt warum
    const owner = play.board.regions[selected]?.owner ?? null;
    // Gemessen am Entwurf: Eine Armee, die gerade herangezogen wird, zählt schon
    const reach = attackReachOn(play, plannedRegions(play, plan), seat, selected);
    const needsArmy = economy.attackNeedsArmy !== undefined;
    const reachKey =
      reach === 'TARGET'
        ? needsArmy && !(economy.attackNeedsArmy === 'RIVALS' && owner === null)
          ? 'reach'
          : 'near'
        : reach === 'NO_ARMY'
          ? 'noArmy'
          : 'far';
    body = (
      <>
        <div className="feld" data-testid="prepare-field" data-region={selected}>
          <strong className="feld-name">
            {placeName(play.board.regions[selected]?.building ?? 'NONE', region(selected))}
          </strong>
          <span className="feld-fact">
            {owner === null
              ? t('realm.prepare.foreign.free')
              : t('realm.prepare.foreign.owner', { owner: name(owner) })}
          </span>
        </div>
        <p
          className="act-info"
          data-testid="prepare-foreign"
          data-near={reach === 'TARGET' ? 'true' : 'false'}
          data-reach={reach}
        >
          {t('realm.prepare.foreign.now')} {t(`realm.prepare.foreign.${reachKey}`)}
        </p>
      </>
    );
  } else {
    // Kein Feld gewählt: dieselben drei Zeilen an derselben Stelle, hier sagen sie, wozu sie gut sind
    body = (
      <>
        <div className="feld idle" data-testid="prepare-idle">
          <strong className="feld-name">{t('realm.prepare.idle.title')}</strong>
          {stock ? (
            <span className="feld-fact">
              {t('realm.prepare.income')} <CostView cost={stock.income} />{' '}
              {t('realm.prepare.perRound')}
            </span>
          ) : null}
        </div>
        <ul className="acts" data-testid="prepare-acts">
          <Act
            act="build"
            state="info"
            icon="village"
            title={t('realm.prepare.row.build')}
            sub={t('realm.prepare.idle.build')}
          />
          <Act
            act="buy"
            state="info"
            icon="army"
            title={t('realm.prepare.row.buy')}
            sub={t('realm.prepare.idle.buy')}
          />
          <Act
            act="move"
            state="info"
            icon="move"
            title={t('realm.prepare.row.move')}
            sub={t('realm.prepare.idle.move')}
          />
        </ul>
      </>
    );
  }

  return (
    <section
      className={`blatt prep${done ? ' prep-done' : ' turn'}`}
      data-testid="match-prepare"
      data-done={done ? 'true' : undefined}
    >
      <h2 className="blatt-title">{t('realm.prepare.title')}</h2>
      {phaseDeadline === null ? null : (
        <Countdown
          deadline={phaseDeadline}
          totalMs={economy.timers.prepareMs}
          onExpire={noop}
          brief
        />
      )}
      <div
        className={[
          'stock-row',
          ...(arriving ? arriving.kinds.map((kind) => `receive-${kind}`) : []),
        ].join(' ')}
        style={
          arriving
            ? ({
                '--receive-at': `${arriving.delayMs}ms`,
                '--receive-ms': `${arriving.durationMs}ms`,
              } as CSSProperties)
            : undefined
        }
        data-testid="prepare-stock"
      >
        {/* Das Wort trüge die Zeile bei zweistelligen Vorräten über den Rand: nur für Screenreader */}
        <span className="visually-hidden">{t('realm.prepare.stock')}</span>
        <Amount kind="bread" value={stockValue('bread')} label={t('realm.bread')} size={19} />
        <Amount
          kind="material"
          value={stockValue('material')}
          label={t('realm.material')}
          size={19}
        />
        {done ? null : (
          <button
            type="button"
            className={`trade${trading ? ' on' : ''}`}
            aria-label={t('realm.prepare.trade', { rate: economy.tradeRate })}
            aria-pressed={trading}
            disabled={busy}
            onClick={() => onTrading(!trading)}
          >
            <MarkIcon kind="trade" size={15} />
            {t('realm.prepare.tradeShort', { rate: economy.tradeRate })}
          </button>
        )}
      </div>
      <div className="blatt-body">{body}</div>
      {done && noTarget ? (
        <p className="blatt-note warn" data-testid="prepare-no-target" role="status">
          {t('realm.prepare.noTarget')}
        </p>
      ) : null}
      {error ? <ErrorNote error={error} /> : null}
      <div
        className={`orders${note ? ' noted' : ''}${chips.length > 0 ? ' filled' : ''}`}
        data-note={note?.kind}
      >
        {/* Der Hinweis steht in der Zeile der Überschrift: So wächst das Blatt nie */}
        {note ? (
          <p
            className="orders-note"
            data-testid={note.kind === 'NO_TARGET' ? 'prepare-no-target' : 'prepare-dropped'}
            role="status"
          >
            <span aria-hidden="true">{note.short}</span>
            <span className="visually-hidden">{note.text}</span>
          </p>
        ) : (
          <h3>{t('realm.prepare.orders')}</h3>
        )}
        {chips.length === 0 ? (
          <p className="orders-none">{t('realm.prepare.none')}</p>
        ) : (
          <ul
            ref={strip.ref}
            data-testid="prepare-orders"
            className={chips.length > DENSE_FROM ? 'dense' : undefined}
            data-left={strip.edge.left ? 'true' : undefined}
            data-right={strip.edge.right ? 'true' : undefined}
            onScroll={strip.measure}
          >
            {chips.map((chip) => {
              const inner = (
                <>
                  <MarkIcon kind={chip.icon} size={15} />
                  <span className={`order-text order-${chip.kind}`}>{chip.text}</span>
                  {chip.tail ? <MarkIcon kind={chip.tail} size={15} /> : null}
                </>
              );
              return (
                <li key={chip.index}>
                  {done ? (
                    <span className="order-chip" aria-label={chip.label}>
                      {inner}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="order-chip"
                      aria-label={t('realm.prepare.remove', { order: chip.label })}
                      disabled={busy}
                      onClick={() => change(orders.filter((_, index) => index !== chip.index))}
                    >
                      {inner}
                      <span className="order-x" aria-hidden="true">
                        ×
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {done ? (
        <button type="button" className="button blatt-go" disabled={busy} onClick={onEdit}>
          {t('realm.prepare.change')}
        </button>
      ) : (
        <button
          type="button"
          className="button button-primary blatt-go"
          disabled={busy || !plan.ok}
          data-no-attack={noTarget ? 'true' : undefined}
          onClick={onSubmit}
        >
          {noTarget ? t('realm.prepare.doneNoAttack') : t('realm.prepare.done')}
        </button>
      )}
    </section>
  );
}

/** Grund einer Zeile als Text; was im Vorrat fehlt, steht als Zeichen mit Zahl da. */
function BlockView({ block }: { readonly block: FieldBlock }) {
  if (block.kind !== 'MISSING') return <>{blockText(block)}</>;
  return (
    <span className="act-missing">
      <span aria-hidden="true">{t('realm.prepare.block.missingShort')}</span>
      <span aria-hidden="true">
        <CostView cost={block} />
      </span>
      <span className="visually-hidden">{blockText(block)}</span>
    </span>
  );
}

/**
 * Eine der drei festen Zeilen: Zeichen, Titel mit dem, was sie bringt, darunter Preis oder Grund,
 * rechts ihr Knopf. `off`: Die Zeile bietet gerade nichts an und sagt warum; `set`: Sie ist schon
 * befohlen; `info`: Kein Feld ist gewählt, die Zeile sagt nur, wozu sie gut ist.
 */
function Act({
  act,
  state,
  icon,
  title,
  aside,
  sub,
  children,
  ...data
}: {
  readonly act: 'build' | 'buy' | 'move';
  readonly state?: 'off' | 'set' | 'info' | undefined;
  readonly icon: Mark;
  readonly title: ReactNode;
  /** Rechts in der Titelzeile, wenn kein Knopf dort steht (Preis einer Stufe, die noch nicht geht). */
  readonly aside?: ReactNode;
  readonly sub: ReactNode;
  readonly children?: ReactNode;
  readonly [data: `data-${string}`]: string | number | undefined;
}) {
  return (
    <li className={`act${state ? ` ${state}` : ''}`} data-act={act} {...data}>
      <MarkIcon kind={icon} size={18} />
      <span className="act-what">
        <span className="act-title">
          <strong>{title}</strong>
          {aside}
        </span>
        <span className="act-sub">{sub}</span>
      </span>
      {children}
    </li>
  );
}

/**
 * Das gewählte Feld: Name, was es ist, und darunter immer dieselben drei Zeilen. Jede Zeile nennt,
 * was sie kostet und was sie bringt, und trägt ihren eigenen Knopf; geht sie gerade nicht, steht an
 * seiner Stelle der Grund in Worten.
 */
function FieldBody({
  play,
  seat,
  orders,
  field,
  moving,
  refused,
  busy,
  region,
  name,
  onChange,
  onMoving,
}: {
  readonly play: RealmPlay;
  readonly seat: number;
  readonly orders: readonly RealmOrderDto[];
  readonly field: FieldOptions;
  readonly moving: boolean;
  readonly refused: MoveRefusal | null;
  readonly busy: boolean;
  readonly region: RegionName;
  readonly name: (seat: number) => string;
  readonly onChange: (orders: readonly RealmOrderDto[]) => void;
  readonly onMoving: (open: boolean) => void;
}) {
  const { economy } = play.realm;
  const start = play.board.regions[field.region];
  const rows = fieldRows(play, seat, orders, field);
  const fieldName = region(field.region);
  const now = start?.building ?? 'NONE';
  const produce = fieldYield(play, field.region, now);

  // ---- Ausbauen ----
  const build = field.build;
  let buildRow: ReactNode;
  if (!build) {
    buildRow = (
      <Act
        act="build"
        state="off"
        icon="castle"
        title={t('realm.prepare.row.build')}
        sub={rows.build ? <BlockView block={rows.build} /> : null}
      />
    );
  } else {
    const next = fieldYield(play, field.region, build.building);
    const gain = {
      bread: Math.max(0, next.bread - produce.bread),
      material: Math.max(0, next.material - produce.material),
    };
    const blocked = build.ordered ? null : rows.build;
    const title = (
      <>
        {t(`realm.building.${build.building}`)}
        {build.ordered ? null : build.building === 'CASTLE' ? (
          <span className="act-gain">
            <span aria-hidden="true">+</span>
            <MarkIcon kind="army" size={13} />
            <span className="visually-hidden">{t('realm.prepare.gain.castle')}</span>
          </span>
        ) : gain.bread + gain.material > 0 ? (
          <span className="act-gain">
            <span className="visually-hidden">{t('realm.prepare.gain.more')} </span>
            <span aria-hidden="true">+</span>
            <CostView cost={gain} />
          </span>
        ) : null}
      </>
    );
    buildRow = (
      <Act
        act="build"
        state={build.ordered ? 'set' : blocked ? 'off' : undefined}
        icon={buildingMark(build.building)}
        title={title}
        aside={blocked ? <CostView cost={build.cost} /> : null}
        sub={
          build.ordered ? (
            <span className="act-planned">{t('realm.prepare.built')}</span>
          ) : blocked ? (
            <BlockView block={blocked} />
          ) : (
            <CostView cost={build.cost} />
          )
        }
        data-ordered={build.ordered ? 'true' : undefined}
      >
        {build.ordered ? (
          <button
            type="button"
            className="button act-go"
            disabled={busy}
            onClick={() => onChange(withBuild(orders, field.region, false))}
          >
            {t('realm.prepare.unbuild')}
          </button>
        ) : blocked ? null : (
          <button
            type="button"
            className="button button-primary act-go"
            disabled={busy}
            onClick={() => onChange(withBuild(orders, field.region, true))}
          >
            {t('realm.prepare.build')}
          </button>
        )}
      </Act>
    );
  }

  // ---- Armeen kaufen: erst ein Knopf wie in den anderen Zeilen, danach der Zähler ----
  const recruit = field.recruit;
  let buyRow: ReactNode;
  if (!recruit || (rows.buy && recruit.count === 0)) {
    buyRow = (
      <Act
        act="buy"
        state="off"
        icon="army"
        title={t('realm.prepare.row.buy')}
        aside={recruit ? <CostView cost={recruit.cost} /> : null}
        sub={rows.buy ? <BlockView block={rows.buy} /> : null}
      />
    );
  } else {
    const price = (
      <>
        {t('realm.prepare.each')} <CostView cost={recruit.cost} />
      </>
    );
    buyRow =
      recruit.count === 0 ? (
        <Act act="buy" icon="army" title={t('realm.prepare.row.buyShort')} sub={price}>
          <button
            type="button"
            className="button button-primary act-go"
            disabled={busy}
            onClick={() => onChange(withRecruit(orders, field.region, 1))}
          >
            {t('realm.prepare.buy')}
          </button>
        </Act>
      ) : (
        <Act
          act="buy"
          state="set"
          icon="army"
          title={t('realm.prepare.row.buyShort')}
          sub={price}
          data-count={recruit.count}
        >
          <Stepper
            value={recruit.count}
            max={recruit.max}
            label={t('realm.prepare.row.buy')}
            disabled={busy}
            onChange={(count) => onChange(withRecruit(orders, field.region, count))}
          />
        </Act>
      );
  }

  // ---- Armeen ziehen: „Ziehen“, dann ein leuchtendes Feld; jeder Zug nimmt eine Armee mit ----
  let moveRow: ReactNode;
  if (rows.move) {
    moveRow = (
      <Act
        act="move"
        state="off"
        icon="move"
        title={t('realm.prepare.row.move')}
        sub={<BlockView block={rows.move} />}
      />
    );
  } else {
    moveRow = (
      <Act
        act="move"
        icon="move"
        title={t('realm.prepare.row.moveShort')}
        sub={tp('realm.prepare.ready', field.movable)}
        data-movable={field.movable}
      >
        <button
          type="button"
          className="button button-primary act-go"
          disabled={busy}
          onClick={() => onMoving(true)}
        >
          {t('realm.prepare.move')}
        </button>
      </Act>
    );
  }

  // Niedriger Bildschirm: Für die Zeile unter dem Namen ist kein Platz. Was das Feld bringt oder wie
  // voll die Burg ist, steht dann kurz neben dem Namen (realm.css), für Screenreader als ganzer Satz.
  const castle = now === 'CASTLE';
  const short =
    !castle && produce.bread === 0 && produce.material === 0 ? null : (
      <span className="feld-short" data-testid="prepare-fact-short">
        {castle ? (
          <>
            <MarkIcon kind="army" size={15} />
            <span aria-hidden="true">
              {field.armies}/{economy.armyCap}
            </span>
            <span className="visually-hidden">
              {t('realm.prepare.castleFact', {
                armies: tp('realm.armies', field.armies),
                cap: economy.armyCap,
              })}
            </span>
          </>
        ) : (
          <>
            <span className="visually-hidden">
              {terrainName(play, field.region)}, {t('realm.prepare.yields')}{' '}
            </span>
            <span aria-hidden="true">+</span>
            <CostView cost={produce} />
            <span className="visually-hidden"> {t('realm.prepare.perRound')}</span>
          </>
        )}
      </span>
    );

  return (
    <>
      <div className="feld" data-testid="prepare-field" data-region={field.region}>
        <strong className="feld-name">{placeName(now, fieldName)}</strong>
        {short}
        <span className="feld-fact">
          {castle ? (
            t('realm.prepare.castleFact', {
              armies: tp('realm.armies', field.armies),
              cap: economy.armyCap,
            })
          ) : (
            <>
              {terrainName(play, field.region)}, {t('realm.prepare.yields')}{' '}
              <CostView cost={produce} /> {t('realm.prepare.perRound')}
            </>
          )}
        </span>
      </div>
      {moving ? (
        // „Ziehen“ ist offen: Der nächste Tipp gehört der Karte, die drei Zeilen machen so lange Platz
        <div
          className="act-move"
          data-testid="prepare-moving"
          data-act="move"
          data-moving="true"
          data-refused={refused?.kind}
        >
          <div className="act-move-head">
            <MarkIcon kind="move" size={18} />
            <strong>{t('realm.prepare.moveWhere')}</strong>
            <button
              type="button"
              className="button act-go"
              disabled={busy}
              onClick={() => onMoving(false)}
            >
              {t('realm.prepare.moveCancel')}
            </button>
          </div>
          <p className={`act-move-text${refused ? ' act-refused' : ''}`} aria-live="polite">
            {refused ? refusalText(refused, name) : t('realm.prepare.moveHint')}
          </p>
          <p className="act-move-ready">{tp('realm.prepare.readyLong', field.movable)}</p>
        </div>
      ) : (
        <ul className="acts" data-testid="prepare-acts">
          {buildRow}
          {buyRow}
          {moveRow}
        </ul>
      )}
    </>
  );
}
