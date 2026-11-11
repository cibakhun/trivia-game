import type { RealmOrderDto } from '@rdw/protocol';
import type { ReactNode } from 'react';
import { Amount, MarkIcon } from '../art/RealmIcons.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { t, tp } from '../i18n/i18n.ts';
import { Countdown } from '../quiz/Countdown.tsx';
import type { RegionName } from './match-text.ts';
import {
  fieldOptions,
  planOrders,
  realmSeat,
  settleOrders,
  tabsOf,
  tradeOptions,
  tradesFirst,
  withBuild,
  withMove,
  withRecruit,
  withTrade,
  type Cost,
  type FieldOptions,
  type PrepareTab,
  type RealmPlay,
} from './realm-model.ts';
import { buildingMark, fieldYield, orderChips, placeName, terrainName } from './realm-text.ts';

/**
 * Blatt der Rüstzeit (MATCH_RULES §11.3, §11.4): oben der Vorrat, wie er nach den geplanten
 * Befehlen bliebe, mit dem Tausch daneben; in der Mitte das gewählte Feld mit immer denselben drei
 * Knöpfen (Bauen, Kaufen, Ziehen) und dem, was dort gerade geht; darunter die eigenen Befehle als
 * Plättchen zum Zurücknehmen und „Fertig“. Gerechnet wird mit den Regeln des Servers
 * (`realm-model`); abgegeben ist erst, was „Fertig“ schickt. Das Blatt ist immer gleich groß.
 */

function noop() {
  // Ablauf der Rüstzeit: Den nächsten Schritt bringt die Abfrage
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
  tab,
  moveTo,
  trading,
  dropped,
  waiting,
  phaseDeadline,
  busy,
  error,
  region,
  onOrders,
  onTab,
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
  /** Reiter, der für das gewählte Feld gilt (`prepareTab`). */
  readonly tab: PrepareTab;
  /** Ziel des Zugs, den das Blatt gerade einstellt. */
  readonly moveTo: number | null;
  readonly trading: boolean;
  /** Mit dem letzten Zurücknehmen fiel ein späterer Befehl mit heraus. */
  readonly dropped: boolean;
  /** Namen der Reiche, die noch rüsten. */
  readonly waiting: readonly string[];
  readonly phaseDeadline: number | null;
  readonly busy: boolean;
  readonly error: unknown;
  readonly region: RegionName;
  readonly onOrders: (orders: RealmOrderDto[], dropped: boolean) => void;
  readonly onTab: (tab: PrepareTab) => void;
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
  const chips = orderChips(play, orders, region);
  const field = selected === null || done ? null : fieldOptions(play, seat, orders, selected);
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
        orders={orders}
        field={field}
        tab={tab}
        moveTo={moveTo}
        busy={busy}
        region={region}
        onChange={change}
        onTab={onTab}
      />
    );
  } else {
    body = (
      <>
        {stock ? (
          <p className="income">
            <span>{t('realm.prepare.income')}</span>
            <span className="income-plus">
              +
              <Amount
                kind="bread"
                value={stock.income.bread}
                label={t('realm.bread')}
                size={15}
              />
            </span>
            <span className="income-plus">
              +
              <Amount
                kind="material"
                value={stock.income.material}
                label={t('realm.material')}
                size={15}
              />
            </span>
          </p>
        ) : null}
        <p className="blatt-hint">{t('realm.prepare.hint')}</p>
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
      <div className="stock-row" data-testid="prepare-stock">
        <span className="stock-label">{t('realm.prepare.stock')}</span>
        <Amount kind="bread" value={left.bread} label={t('realm.bread')} size={19} />
        <Amount kind="material" value={left.material} label={t('realm.material')} size={19} />
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
      {dropped && !done ? <p className="blatt-note">{t('realm.prepare.dropped')}</p> : null}
      {error ? <ErrorNote error={error} /> : null}
      <div className="orders">
        <h3>{t('realm.prepare.orders')}</h3>
        {chips.length === 0 ? (
          <p className="orders-none">{t('realm.prepare.none')}</p>
        ) : (
          <ul data-testid="prepare-orders">
            {chips.map((chip) => {
              const inner = (
                <>
                  <MarkIcon kind={chip.icon} size={15} />
                  <span>{chip.text}</span>
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
          onClick={onSubmit}
        >
          {t('realm.prepare.done')}
        </button>
      )}
    </section>
  );
}

/** Das gewählte Feld: Name, was es ist, die drei Knöpfe und was der gewählte gerade anbietet. */
function FieldBody({
  play,
  orders,
  field,
  tab,
  moveTo,
  busy,
  region,
  onChange,
  onTab,
}: {
  readonly play: RealmPlay;
  readonly orders: readonly RealmOrderDto[];
  readonly field: FieldOptions;
  readonly tab: PrepareTab;
  readonly moveTo: number | null;
  readonly busy: boolean;
  readonly region: RegionName;
  readonly onChange: (orders: readonly RealmOrderDto[]) => void;
  readonly onTab: (tab: PrepareTab) => void;
}) {
  const { economy } = play.realm;
  const start = play.board.regions[field.region];
  const open = tabsOf(field);
  const name = region(field.region);
  const move = tab === 'move' ? (field.moves.find((m) => m.to === moveTo) ?? null) : null;
  const produce = fieldYield(play, field.region, start?.building ?? 'NONE');

  const seg = (id: PrepareTab, icon: Parameters<typeof MarkIcon>[0]['kind'], label: string) => (
    <button
      type="button"
      className={`seg${tab === id ? ' on' : ''}`}
      disabled={busy || !open[id]}
      aria-pressed={tab === id}
      data-tab={id}
      onClick={() => onTab(id)}
    >
      <MarkIcon kind={icon} size={21} />
      {label}
    </button>
  );

  let detail: ReactNode;
  let note: string | null = null;
  if (tab === 'build') {
    const build = field.build;
    if (!build) {
      detail = <p className="detail-none">{t('realm.prepare.maxLevel')}</p>;
    } else {
      const blocked = build.ordered ? null : build.blocked;
      note =
        blocked === null
          ? null
          : blocked === 'TOO_EXPENSIVE'
            ? t('realm.prepare.blocked.TOO_EXPENSIVE')
            : blocked === 'CASTLE_LIMIT'
              ? t('realm.prepare.blocked.CASTLE_LIMIT', { max: economy.maxCastles })
              : t('realm.prepare.blocked.OTHER');
      detail = (
        <div className="detail">
          <span className="detail-what">
            <strong>{t(`realm.building.${build.building}`)}</strong>
            {build.ordered ? (
              <span className="act-note">{t('realm.prepare.built')}</span>
            ) : (
              <CostView cost={build.cost} />
            )}
          </span>
          {build.ordered ? (
            <button
              type="button"
              className="button detail-go"
              disabled={busy}
              onClick={() => onChange(withBuild(orders, field.region, false))}
            >
              {t('realm.prepare.unbuild')}
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary detail-go"
              disabled={busy || blocked !== null}
              onClick={() => onChange(withBuild(orders, field.region, true))}
            >
              {t('realm.prepare.build')}
            </button>
          )}
        </div>
      );
    }
  } else if (tab === 'buy') {
    const recruit = field.recruit;
    if (!recruit) {
      detail = <p className="detail-none">{t('realm.prepare.buyOnlyCastle')}</p>;
    } else {
      if (recruit.max === recruit.count) {
        note =
          field.armies >= economy.armyCap
            ? t('realm.prepare.blocked.ARMY_CAP', { cap: economy.armyCap })
            : t('realm.prepare.blocked.TOO_EXPENSIVE');
      }
      detail = (
        <div className="detail">
          <span className="detail-what">
            <strong>{t('realm.prepare.armiesTitle')}</strong>
            <span className="cost">
              {t('realm.prepare.each')} <CostView cost={recruit.cost} />
            </span>
          </span>
          <Stepper
            value={recruit.count}
            max={recruit.max}
            label={t('realm.prepare.buy')}
            disabled={busy}
            onChange={(count) => onChange(withRecruit(orders, field.region, count))}
          />
        </div>
      );
    }
  } else if (move) {
    detail = (
      <div className="detail">
        <span className="detail-what">
          <strong>{t('realm.prepare.armiesTitle')}</strong>
          <span className="act-note">{tp('realm.prepare.ready', move.max)}</span>
        </span>
        <Stepper
          value={move.count}
          max={move.max}
          label={t('realm.prepare.move')}
          disabled={busy}
          onChange={(count) => onChange(withMove(orders, field.region, move.to, count))}
        />
      </div>
    );
  } else {
    detail = (
      <p className="detail-none">
        {open.move
          ? t('realm.prepare.moveHint')
          : field.moves.length === 0
            ? t('realm.prepare.moveNoTarget')
            : t('realm.prepare.moveNone')}
      </p>
    );
  }

  return (
    <>
      <div className="feld" data-testid="prepare-field" data-region={field.region}>
        <strong className="feld-name">
          {move
            ? t('realm.prepare.moveTitle', { from: name, to: region(move.to) })
            : placeName(start?.building ?? 'NONE', name)}
        </strong>
        <span className="feld-fact">
          {move ? (
            t('realm.prepare.moveFact')
          ) : start?.building === 'CASTLE' ? (
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
      <div className="segs">
        {seg('build', buildingMark(field.build?.building ?? 'CASTLE'), t('realm.prepare.build'))}
        {seg('buy', 'army', t('realm.prepare.buy'))}
        {seg('move', 'move', t('realm.prepare.move'))}
      </div>
      {detail}
      {note ? <p className="detail-note">{note}</p> : null}
    </>
  );
}
