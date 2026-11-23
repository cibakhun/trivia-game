import type { MatchRecord, MeResponse, PlayerStatsResponse } from '@rdw/protocol';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { CountUp } from '../art/CountUp.tsx';
import { Icon, type IconKind } from '../art/Icons.tsx';
import { CategoryIcon } from '../art/RealmIcons.tsx';
import {
  LoginForm,
  PasswordForm,
  PlayerNameForm,
  RegisterForm,
} from '../components/AccountForms.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { formatNumber, t, tp, type MessageKey } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';
import {
  ACCOUNT_TABS,
  crestProgress,
  knowledgeExtremes,
  knowledgeRows,
  ofText,
  percentOf,
  percentText,
  secondsText,
  sinceText,
  statusLine,
  tabOf,
  type AccountTab,
  type AccountView,
} from './account-text.ts';
import { Crest, MenuIcon, RoundButton, SheetHead } from './MenuParts.tsx';
import { initialOf, playerName } from './menu-text.ts';

/**
 * Kontoseite (ADR-080): ein breites Blatt über der lebenden Karte wie die anderen Blätter des
 * Hauptmenüs. Links die Wappenseite (Wappen mit Stufe, Name, Stand des Kontos, dabei seit), rechts
 * drei Reiter: Bilanz (Partien, Plätze, Serien, Duelle), Wissen (Trefferquote je Kategorie) und
 * Zugang (sichern, anmelden, Name, Passwort, abmelden). Die Formulare ersetzen die rechte Seite und
 * haben eigene Pfade, damit „Zurück“ im Browser sie schließt.
 */

/** Eigene Zahlen für die Kontoseite; lädt neu, wenn ein anderes Konto angemeldet ist. */
function useStats(userId: string) {
  const [stats, setStats] = useState<PlayerStatsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setError(null);
    try {
      const next = await api.stats();
      if (current === generation.current) setStats(next);
    } catch (e) {
      if (current === generation.current) setError(e);
    }
  }, []);
  useEffect(() => {
    setStats(null);
    void load();
  }, [userId, load]);
  return { stats, error, load };
}

const TAB_ICON: Record<AccountTab, IconKind> = {
  record: 'banner',
  knowledge: 'scroll',
  access: 'key',
};

const VIEW_TITLE: Record<AccountView, MessageKey> = {
  name: 'konto.views.name',
  secure: 'konto.views.secure',
  password: 'konto.views.password',
  login: 'konto.views.login',
  logout: 'konto.views.logout',
};

/** Wappenseite: großes Wappen, Name (mit Vorschau einer Namenswahl), Stufe, Stand, dabei seit. */
function CrestPage({
  me,
  wins,
  preview,
  onRename,
  onBack,
  titleId,
}: {
  readonly me: MeResponse;
  readonly wins: number;
  readonly preview: string | null;
  readonly onRename: (() => void) | null;
  /** Fehlt, solange ein Formular offen ist: Dann führt dessen eigenes „Zurück“ heraus. */
  readonly onBack: (() => void) | undefined;
  readonly titleId: string;
}) {
  const name = preview ?? playerName(me);
  const tier = crestProgress(wins);
  return (
    <div className="acct-left">
      <SheetHead id={titleId} title={t('konto.title')} onBack={onBack} />
      <div className="acct-crest-wrap">
        <Crest
          key={`${tier.tier}-${initialOf(name)}`}
          letter={initialOf(name)}
          tier={tier.tier}
          className="acct-crest"
        />
      </div>
      <div className={`acct-name${preview ? ' preview' : ''}`}>
        <span className="acct-name-text" key={name} data-testid="account-name">
          {name}
        </span>
        {onRename ? (
          <RoundButton
            icon={<Icon kind="quill" size={18} />}
            label={t('konto.rename')}
            onClick={onRename}
          />
        ) : null}
      </div>
      <div className={`acct-tier tier-${tier.tier}`} data-testid="account-tier">
        <span className="acct-tier-name">{t(`konto.tier.${tier.tier}`)}</span>
        <span className="acct-tier-bar" aria-hidden="true">
          <span style={{ ['--p' as string]: tier.progress }} />
        </span>
        <span className="acct-tier-next">
          {tier.next === null
            ? t('konto.tier.top')
            : tp('konto.tier.toNext', tier.toNext, { next: t(`konto.tier.${tier.next}`) })}
        </span>
      </div>
      <p className={`acct-status${me.user.isGuest ? ' guest' : ''}`} data-testid="account-status">
        <Icon kind={me.user.isGuest ? 'person' : 'shield'} size={16} />
        <span key={me.user.isGuest ? 'guest' : 'secured'}>{statusLine(me)}</span>
      </p>
      <p className="acct-since">{sinceText(me.user.createdAt)}</p>
    </div>
  );
}

/** Reiter oben auf der rechten Seite; Pfeiltasten wechseln wie bei Registerkarten üblich. */
function Tabs({
  tab,
  onTab,
  ids,
}: {
  readonly tab: AccountTab;
  readonly onTab: (tab: AccountTab) => void;
  readonly ids: (tab: AccountTab) => { tab: string; panel: string };
}) {
  const refs = useRef<Partial<Record<AccountTab, HTMLButtonElement | null>>>({});
  function onKey(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next =
      ACCOUNT_TABS[(ACCOUNT_TABS.indexOf(tab) + step + ACCOUNT_TABS.length) % ACCOUNT_TABS.length];
    if (!next) return;
    onTab(next);
    refs.current[next]?.focus();
  }
  return (
    <div className="acct-tabs" role="tablist" aria-label={t('konto.tabsLabel')} onKeyDown={onKey}>
      {ACCOUNT_TABS.map((key) => (
        <button
          key={key}
          ref={(node) => {
            refs.current[key] = node;
          }}
          type="button"
          role="tab"
          id={ids(key).tab}
          aria-controls={ids(key).panel}
          aria-selected={tab === key}
          tabIndex={tab === key ? 0 : -1}
          className={`acct-tab${tab === key ? ' on' : ''}`}
          onClick={() => onTab(key)}
        >
          <Icon kind={TAB_ICON[key]} size={18} />
          <span>{t(`konto.tabs.${key}`)}</span>
        </button>
      ))}
    </div>
  );
}

function Tile({
  value,
  label,
  render,
}: {
  readonly value: number | null;
  readonly label: string;
  readonly render?: (value: number) => string;
}) {
  const show = render ?? formatNumber;
  return (
    <div className="acct-tile">
      <dt>{label}</dt>
      <dd>{value === null ? '–' : <CountUp value={value} from={0} render={show} />}</dd>
    </div>
  );
}

/** Siegertreppchen: Platz 2 links, 1 in der Mitte, 3 rechts; die Zahl steht auf der Stufe. */
function Podium({ places }: { readonly places: PlayerStatsResponse['matches']['places'] }) {
  const steps = [
    { place: 2, count: places.second, key: 'second' },
    { place: 1, count: places.first, key: 'first' },
    { place: 3, count: places.third, key: 'third' },
  ] as const;
  return (
    <figure className="acct-podium" aria-label={t('konto.record.podium')}>
      <div className="acct-podium-steps">
        {steps.map((step) => (
          <div key={step.key} className={`acct-step-col p${step.place}`}>
            <span className="acct-step-count">
              <CountUp value={step.count} from={0} render={formatNumber} />
            </span>
            <span className="acct-step-block">
              <span className="acct-step-place">{t(`konto.record.${step.key}`)}</span>
            </span>
          </div>
        ))}
      </div>
      <figcaption className="visually-hidden">
        {t('konto.record.podiumText', {
          first: places.first,
          second: places.second,
          third: places.third,
        })}
      </figcaption>
    </figure>
  );
}

function Fact({
  icon,
  label,
  value,
  sub,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly sub?: string | undefined;
}) {
  return (
    <li className="acct-fact">
      <span className="acct-fact-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="acct-fact-label">{label}</span>
      <span className="acct-fact-value">
        {value}
        {sub ? <small>{sub}</small> : null}
      </span>
    </li>
  );
}

function RecordPanel({
  stats,
  onNewMatch,
}: {
  readonly stats: PlayerStatsResponse;
  readonly onNewMatch: () => void;
}) {
  const { matches, duels, trivia, estimates } = stats;
  if (matches.played === 0) {
    return (
      <div className="acct-empty">
        <span className="acct-empty-art" aria-hidden="true">
          <Icon kind="banner" size={44} />
        </span>
        <p className="acct-empty-title">{t('konto.record.emptyTitle')}</p>
        <p className="menu-note">{t('konto.record.emptyText')}</p>
        <button type="button" className="button button-primary menu-go" onClick={onNewMatch}>
          {t('konto.record.emptyGo')}
        </button>
      </div>
    );
  }
  return (
    <div className="acct-record">
      <dl className="acct-tiles">
        <Tile value={matches.played} label={tp('konto.record.played', matches.played)} />
        <Tile value={matches.won} label={tp('konto.record.won', matches.won)} />
        <Tile
          value={percentOf(matches.won, matches.played)}
          label={t('konto.record.winRate')}
          render={(v) => percentText(v)}
        />
        <Tile
          value={percentOf(trivia.correct, trivia.answered)}
          label={t('konto.record.hitRate')}
          render={(v) => percentText(v)}
        />
      </dl>
      <div className="acct-record-body">
        <div className="acct-record-side">
          <Podium places={matches.places} />
          <ul className="acct-modes">
            <li>
              <span>{t('realm.hub.CLASSIC')}</span>
              <b>
                {tp('konto.record.playedN', matches.classic.played)} ·{' '}
                {tp('konto.record.wonN', matches.classic.won)}
              </b>
            </li>
            <li>
              <span>{t('realm.hub.REALM')}</span>
              <b>
                {tp('konto.record.playedN', matches.realm.played)} ·{' '}
                {tp('konto.record.wonN', matches.realm.won)}
              </b>
            </li>
          </ul>
        </div>
        <ul className="acct-facts">
          <Fact
            icon={<Icon kind="banner" size={18} />}
            label={t('konto.record.streak')}
            value={formatNumber(matches.streak.best)}
            sub={
              matches.streak.current > 0
                ? t('konto.record.streakNow', { count: formatNumber(matches.streak.current) })
                : undefined
            }
          />
          <Fact
            icon={<MenuIcon kind="target" />}
            label={t('konto.record.duels')}
            value={duels.fought === 0 ? '–' : ofText(duels.won, duels.fought)}
          />
          <Fact
            icon={<Icon kind="shield" size={18} />}
            label={t('konto.record.toppled')}
            value={formatNumber(duels.toppled)}
          />
          <Fact
            icon={<Icon kind="play" size={18} />}
            label={t('konto.record.fastest')}
            value={trivia.fastestCorrectMs === null ? '–' : secondsText(trivia.fastestCorrectMs)}
          />
          <Fact
            icon={<Icon kind="key" size={18} />}
            label={t('konto.record.estimates')}
            value={estimates.answered === 0 ? '–' : ofText(estimates.closest, estimates.answered)}
          />
        </ul>
      </div>
    </div>
  );
}

function KnowledgePanel({ stats }: { readonly stats: PlayerStatsResponse }) {
  const rows = knowledgeRows(stats.trivia);
  const extremes = knowledgeExtremes(rows);
  const { estimates } = stats;
  return (
    <div className="acct-knowledge">
      {extremes ? (
        <p className="acct-extremes">
          <span className="acct-badge best">
            <CategoryIcon category={extremes.best.category} size={16} />
            {t('konto.knowledge.best')}: <b>{t(`realm.category.${extremes.best.category}`)}</b>
          </span>
          {extremes.worst.category !== extremes.best.category ? (
            <span className="acct-badge worst">
              <CategoryIcon category={extremes.worst.category} size={16} />
              {t('konto.knowledge.worst')}: <b>{t(`realm.category.${extremes.worst.category}`)}</b>
            </span>
          ) : null}
        </p>
      ) : (
        <p className="menu-note">{t('konto.knowledge.emptyText')}</p>
      )}
      <ul className="acct-bars" data-testid="knowledge-rows">
        {rows.map((row, i) => (
          <li
            key={row.category}
            className={`acct-bar-row${row.rate === null ? ' none' : ''}`}
            style={{ ['--i' as string]: i }}
          >
            <CategoryIcon category={row.category} size={18} />
            <span className="acct-bar-name">{t(`realm.category.${row.category}`)}</span>
            <span className="acct-bar" aria-hidden="true">
              <span style={{ ['--p' as string]: (row.rate ?? 0) / 100 }} />
            </span>
            <span className="acct-bar-value">
              {row.rate === null ? (
                t('konto.knowledge.none')
              ) : (
                <>
                  <b>{percentText(row.rate)}</b>
                  <small>
                    {formatNumber(row.correct)}/{formatNumber(row.answered)}
                  </small>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="acct-estimates">
        <b>{t('konto.knowledge.estimates')}</b>
        <span>
          {estimates.answered === 0
            ? t('konto.knowledge.noEstimates')
            : t('konto.knowledge.estimatesLine', {
                closest: formatNumber(estimates.closest),
                answered: formatNumber(estimates.answered),
              })}
        </span>
      </p>
    </div>
  );
}

/** Zeile im Reiter Zugang: Bezeichnung, Wert und auf Wunsch ein Weg zum Ändern. */
function AccessRow({
  icon,
  label,
  value,
  note,
  action,
  onClick,
}: {
  readonly icon: IconKind;
  readonly label: string;
  readonly value: string;
  readonly note?: string;
  readonly action?: string;
  readonly onClick?: () => void;
}) {
  const body = (
    <>
      <span className="acct-row-icon" aria-hidden="true">
        <Icon kind={icon} size={20} />
      </span>
      <span className="acct-row-text">
        <span className="acct-row-label">{label}</span>
        <span className="acct-row-value">
          {value}
          {note ? <small>{note}</small> : null}
        </span>
      </span>
      {action ? (
        <span className="acct-row-action">
          {action}
          <MenuIcon kind="next" />
        </span>
      ) : null}
    </>
  );
  return (
    <li>
      {onClick ? (
        <button type="button" className="acct-row" onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className="acct-row">{body}</div>
      )}
    </li>
  );
}

function AccessPanel({
  me,
  onView,
  onLogout,
  leaving,
  logoutError,
}: {
  readonly me: MeResponse;
  readonly onView: (view: AccountView) => void;
  readonly onLogout: () => void;
  readonly leaving: boolean;
  readonly logoutError: unknown;
}) {
  if (me.user.isGuest) {
    return (
      <div className="acct-access">
        <div className="acct-callout">
          <b>{t('konto.access.guestTitle')}</b>
          <span>{t('konto.access.guestText')}</span>
        </div>
        <div className="acct-choices">
          <button type="button" className="menu-big primary" onClick={() => onView('secure')}>
            <span className="menu-big-icon" aria-hidden="true">
              <Icon kind="shield" size={22} />
            </span>
            <span className="menu-big-text">
              <span className="menu-big-title">{t('konto.access.secure')}</span>
              <span className="menu-big-sub">{t('konto.access.secureSub')}</span>
            </span>
          </button>
          <button type="button" className="menu-big" onClick={() => onView('login')}>
            <span className="menu-big-icon" aria-hidden="true">
              <MenuIcon kind="person" />
            </span>
            <span className="menu-big-text">
              <span className="menu-big-title">{t('konto.access.login')}</span>
              <span className="menu-big-sub">{t('konto.access.loginSub')}</span>
            </span>
          </button>
        </div>
        <button type="button" className="acct-leave" onClick={() => onView('logout')}>
          <Icon kind="door" size={16} />
          {t('account.logout')}
        </button>
      </div>
    );
  }
  return (
    <div className="acct-access">
      <ul className="acct-rows">
        <AccessRow
          icon="person"
          label={t('konto.access.username')}
          value={me.user.username ?? ''}
          note={t('konto.access.usernameNote')}
        />
        <AccessRow
          icon="quill"
          label={t('konto.access.playerName')}
          value={playerName(me)}
          action={t('konto.access.change')}
          onClick={() => onView('name')}
        />
        <AccessRow
          icon="lock"
          label={t('konto.access.password')}
          value={'•'.repeat(10)}
          action={t('konto.access.change')}
          onClick={() => onView('password')}
        />
      </ul>
      <button
        type="button"
        className="acct-leave"
        disabled={leaving}
        onClick={onLogout}
        data-testid="account-logout"
      >
        <Icon kind="door" size={16} />
        {t('account.logout')}
      </button>
      {logoutError ? <ErrorNote error={logoutError} /> : null}
    </div>
  );
}

/** Abmelden als Gast: erst sichern oder bewusst alles aufgeben. */
function LogoutView({
  leaving,
  error,
  onSecure,
  onLogout,
}: {
  readonly leaving: boolean;
  readonly error: unknown;
  readonly onSecure: () => void;
  readonly onLogout: () => void;
}) {
  return (
    <div className="acct-logout">
      <div className="acct-callout warn">
        <b>{t('konto.logout.title')}</b>
        <span>{t('konto.logout.guestText')}</span>
      </div>
      {error ? <ErrorNote error={error} /> : null}
      <div className="acct-form-foot">
        <button
          type="button"
          className="button button-danger acct-anyway"
          disabled={leaving}
          onClick={onLogout}
        >
          {t('account.logoutAnyway')}
        </button>
        <button type="button" className="button button-primary menu-go" onClick={onSecure}>
          {t('konto.logout.secureFirst')}
        </button>
      </div>
    </div>
  );
}

export function AccountSheet({
  me,
  record,
  view,
  onView,
  onViewDone,
  onBack,
}: {
  readonly me: MeResponse;
  readonly record: MatchRecord;
  readonly view: AccountView | null;
  readonly onView: (view: AccountView) => void;
  /** Schließt das Formular; `replaceWith` öffnet stattdessen gleich ein anderes. */
  readonly onViewDone: (replaceWith?: AccountView) => void;
  readonly onBack: () => void;
}) {
  const { logout } = useSession();
  const { stats, error: statsError, load } = useStats(me.user.id);
  const [tab, setTab] = useState<AccountTab>(() => tabOf(view) ?? 'record');
  const [preview, setPreview] = useState<string | null>(null);
  const [secureStep, setSecureStep] = useState<1 | 2>(1);
  const [notice, setNotice] = useState<{ key: MessageKey; n: number } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const titleId = useId();
  const panelId = useId();
  const viewTitleId = useId();
  const section = useRef<HTMLElement>(null);

  // Der Fokus springt beim Öffnen auf den Titel, wie bei den anderen Blättern
  useEffect(() => {
    const root = section.current;
    if (!root || root.contains(document.activeElement)) return;
    root.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, []);

  // Ein geöffnetes Formular gehört zu seinem Reiter; die Vorschau gilt nur, solange es offen ist
  useEffect(() => {
    const home = tabOf(view);
    if (home) setTab(home);
    if (view === null) setPreview(null);
    if (view !== 'secure') setSecureStep(1);
    setLogoutError(null);
  }, [view]);

  // Eine Meldung bleibt vier Sekunden
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const done = (key: MessageKey) => () => {
    setNotice((current) => ({ key, n: (current?.n ?? 0) + 1 }));
    setPreview(null);
    onViewDone();
  };

  async function signOut() {
    setLeaving(true);
    setLogoutError(null);
    try {
      await logout();
      navigate({ name: 'start' }, { replace: true });
    } catch (e) {
      setLogoutError(e);
      setLeaving(false);
    }
  }

  const ids = (key: AccountTab) => ({ tab: `${panelId}-tab-${key}`, panel: `${panelId}-${key}` });

  let right: ReactNode;
  if (view !== null) {
    let body: ReactNode = null;
    switch (view) {
      case 'name':
        body = (
          <PlayerNameForm
            current={
              me.profile.playerName && me.profile.displayName
                ? { parts: me.profile.playerName, name: me.profile.displayName }
                : null
            }
            onPreview={setPreview}
            onDone={done('account.nameSaved')}
          />
        );
        break;
      case 'secure':
        body = (
          <RegisterForm
            step={secureStep}
            onStep={setSecureStep}
            onPreview={setPreview}
            onDone={done('account.registered')}
          />
        );
        break;
      case 'password':
        body = <PasswordForm onDone={done('account.passwordSaved')} />;
        break;
      case 'login':
        body = (
          <LoginForm warning={t('konto.access.loginWarning')} onDone={done('konto.loggedIn')} />
        );
        break;
      case 'logout':
        body = (
          <LogoutView
            leaving={leaving}
            error={logoutError}
            onSecure={() => onViewDone('secure')}
            onLogout={() => void signOut()}
          />
        );
        break;
    }
    right = (
      <section className="acct-view" aria-labelledby={viewTitleId} data-view={view} key={view}>
        <header className="acct-view-head">
          <RoundButton
            icon={<MenuIcon kind="back" />}
            label={t('menu.back')}
            onClick={() => {
              // Beim Sichern führt „Zurück“ erst vom Zugang zum Namen
              if (view === 'secure' && secureStep === 2) setSecureStep(1);
              else onViewDone();
            }}
          />
          <h3 id={viewTitleId}>{t(VIEW_TITLE[view])}</h3>
          {view === 'secure' ? (
            <span className="acct-view-step">{t('konto.secure.step', { n: secureStep })}</span>
          ) : null}
        </header>
        <div className="acct-view-body">{body}</div>
      </section>
    );
  } else {
    let panel: ReactNode;
    if (tab === 'access') {
      panel = (
        <AccessPanel
          me={me}
          onView={onView}
          onLogout={() => void signOut()}
          leaving={leaving}
          logoutError={logoutError}
        />
      );
    } else if (stats) {
      panel =
        tab === 'record' ? (
          <RecordPanel stats={stats} onNewMatch={() => navigate({ name: 'matches' })} />
        ) : (
          <KnowledgePanel stats={stats} />
        );
    } else if (statsError) {
      // Ohne Sitzung (401) lädt die Sitzung selbst neu; alles andere darf man erneut versuchen
      panel =
        statsError instanceof ApiRequestError && statsError.status === 401 ? null : (
          <ErrorNote error={statsError} onRetry={() => void load()} />
        );
    } else {
      panel = (
        <p className="menu-note acct-loading" role="status">
          {t('konto.loading')}
        </p>
      );
    }
    right = (
      <>
        <Tabs tab={tab} onTab={setTab} ids={ids} />
        <div
          className="acct-panel"
          role="tabpanel"
          id={ids(tab).panel}
          aria-labelledby={ids(tab).tab}
          key={tab}
          data-tab={tab}
        >
          {panel}
        </div>
      </>
    );
  }

  return (
    <section
      ref={section}
      className="sheet menu-sheet acct"
      aria-labelledby={titleId}
      data-testid="account"
      data-view={view ?? 'home'}
    >
      <CrestPage
        me={me}
        wins={stats?.matches.won ?? record.won}
        preview={preview}
        onRename={me.user.isGuest || view !== null ? null : () => onView('name')}
        onBack={view === null ? onBack : undefined}
        titleId={titleId}
      />
      <div className="acct-right">
        {right}
        {notice ? (
          <p className="acct-notice" aria-hidden="true" key={notice.n} data-testid="account-notice">
            <Icon kind="shield" size={18} />
            {t(notice.key, { name: playerName(me) })}
          </p>
        ) : null}
        {/* Dauerhafte Vorlesezone: So wird die Meldung sicher angesagt */}
        <p className="visually-hidden" role="status">
          {notice ? t(notice.key, { name: playerName(me) }) : ''}
        </p>
      </div>
    </section>
  );
}
