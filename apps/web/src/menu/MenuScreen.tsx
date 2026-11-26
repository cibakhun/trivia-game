import {
  DEFAULT_REALM_RULES,
  type MatchCreateRequest,
  type MatchListResponse,
  type MatchMode,
} from '@rdw/protocol';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ActionKey, ApiRequestError, api } from '../api/client.ts';
import { MenuMap } from '../art/MenuMap.tsx';
import { Swords } from '../art/Swords.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { t } from '../i18n/i18n.ts';
import { HelpSheet } from '../match/HelpSheet.tsx';
import { navigate, type Route } from '../router.ts';
import { useSession } from '../session.tsx';
import { AccountSheet } from './AccountSheet.tsx';
import { accountAlert, alertView, viewAllowed, type AccountView } from './account-text.ts';
import { MenuIcon, PlayerPlate, RoundButton, Seal, SoundButton, TitleMark } from './MenuParts.tsx';
import {
  ChronicleSheet,
  JoinSheet,
  LoginSheet,
  NewSheet,
  PracticeSheet,
  WelcomeSheet,
} from './MenuSheets.tsx';
import { isOpenMatch, openLine, type MatchSummary, type MenuSheet } from './menu-text.ts';
import '../match/stage.css';
import '../match/realm.css';
import './menu.css';
import './account.css';

/**
 * Hauptmenü (ADR-074): Die Wendelmark füllt den ganzen Bildschirm und lebt (Burgen, Armeen, ein
 * Angriff, Schiffe). Oben links die Plakette des Spielers, oben in der Mitte schmal der Name des
 * Spiels, oben rechts Ton und „So geht's“. Unten stehen Siegel für Beitreten, Neue Partie, Übung
 * und Chronik; läuft schon eine eigene Partie, steht dort stattdessen der Weg zurück in sie. Ein
 * Siegel öffnet sein Blatt in der Mitte; jedes Blatt hat einen eigenen Pfad, damit „Zurück“ im
 * Browser es schließt. Ohne Sitzung begrüßt ein Blatt mit „Als Gast spielen“ und „Anmelden“.
 * Die Plakette öffnet die Kontoseite (ADR-080), ebenfalls ein Blatt; ihre Formulare haben eigene
 * Pfade unter `/konto`.
 */

const SHEET_ROUTES: Record<MenuSheet, Route> = {
  new: { name: 'matches' },
  join: { name: 'menu', sheet: 'join' },
  practice: { name: 'menu', sheet: 'practice' },
  chronicle: { name: 'menu', sheet: 'chronicle' },
  account: { name: 'account', view: null },
};

const MODE_KEY = 'rdw.menu.mode';

/** Zuletzt gewählte Spielart dieses Geräts; ohne Speicher die klassische. */
function storedMode(): MatchMode {
  try {
    return globalThis.localStorage?.getItem(MODE_KEY) === 'REALM' ? 'REALM' : 'CLASSIC';
  } catch {
    return 'CLASSIC';
  }
}

function storeMode(mode: MatchMode): void {
  try {
    globalThis.localStorage?.setItem(MODE_KEY, mode);
  } catch {
    // Privates Fenster: Die Wahl gilt dann nur bis zum Neuladen
  }
}

/** Eigene Partien des Kontos; lädt neu, sobald ein anderes Konto angemeldet ist. */
function useMatchList(userId: string | null) {
  const [list, setList] = useState<MatchListResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Nur die jüngste Anfrage zählt: Eine späte Antwort für das vorige Konto bleibt liegen
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await api.matches();
      if (current !== generation.current) return;
      setList(next);
      setError(null);
    } catch (e) {
      if (current !== generation.current) return;
      setError(e);
    }
  }, []);
  useEffect(() => {
    generation.current += 1;
    setList(null);
    setError(null);
    if (userId !== null) void load();
  }, [userId, load]);
  return { list, error, load };
}

/** Partie eröffnen oder mit Code beitreten; danach geht es in die Partie. */
function useMatchActions(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const createKey = useRef(new ActionKey());
  const joinKey = useRef(new ActionKey());

  async function act(key: ActionKey, payload: unknown, call: (key: string) => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      let matchId: string;
      try {
        matchId = await call(key.for(payload));
        key.settle();
      } catch (e) {
        key.settle(e);
        throw e;
      }
      navigate({ name: 'match', matchId });
    } catch (e) {
      setError(e);
      // Schon in einer Partie: Das Blatt zeigt sie dann zum Fortsetzen
      if (e instanceof ApiRequestError && e.code === 'ALREADY_IN_MATCH') void reload();
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    reset: () => setError(null),
    create: (body: MatchCreateRequest) =>
      void act(createKey.current, body, async (key) => (await api.createMatch(body, key)).matchId),
    join: (code: string) =>
      void act(joinKey.current, code, async (key) => (await api.joinMatch(code, key)).matchId),
  };
}

/** Unten statt der Siegel, solange eine eigene Partie offen ist. */
function OpenBanner({ match }: { readonly match: MatchSummary }) {
  const status = match.status === 'LOBBY' ? 'LOBBY' : 'RUNNING';
  return (
    <div className="menu-banner" data-testid="menu-open">
      <span className="menu-banner-seal" aria-hidden="true">
        <Swords size={30} />
      </span>
      <span className="menu-banner-text">
        <b>{t(`menu.open.${status}`)}</b>
        <span>{openLine(match)}</span>
      </span>
      <button
        type="button"
        className="button button-primary menu-banner-go"
        onClick={() => navigate({ name: 'match', matchId: match.id })}
      >
        {t(`menu.open.${status}_go`)}
      </button>
    </div>
  );
}

export function MenuScreen({
  sheet,
  accountView = null,
}: {
  readonly sheet: MenuSheet | null;
  /** Formular der Kontoseite aus dem Pfad; nur mit `sheet = 'account'`. */
  readonly accountView?: AccountView | null;
}) {
  const { state, reload } = useSession();
  const me = state.status === 'ready' ? state.me : null;
  const { list, error: listError, load } = useMatchList(me?.user.id ?? null);
  const actions = useMatchActions(load);
  const [mode, setMode] = useState<MatchMode>(storedMode);
  const [help, setHelp] = useState(false);
  const [login, setLogin] = useState(false);
  // Siegel kehren nach einem Blatt ohne Wartezeit zurück; nur der erste Auftritt ist gestaffelt
  const [again, setAgain] = useState(false);
  // Im Menü geöffnet: Schließen geht in der Geschichte zurück, damit „Zurück“ es nicht neu öffnet
  const openedHere = useRef(false);
  // Dasselbe für die Formulare der Kontoseite
  const viewOpenedHere = useRef(false);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('match-playing');
    return () => root.classList.remove('match-playing');
  }, []);

  // Die Übungspartie gibt es nur, wo der Server sie anbietet (nicht in Produktion). Die Kontoseite
  // braucht die Liste der Partien nicht: Sichern und Anmelden gehen auch, wenn sie fehlt
  const shown: MenuSheet | null =
    me && (list || sheet === 'account') && !(sheet === 'practice' && !list?.testMatchesEnabled)
      ? sheet
      : null;
  const open = list?.matches.find(isOpenMatch) ?? null;
  // Ein Formular, das es für dieses Konto nicht gibt (Gäste ändern keinen Namen, gesicherte Konten
  // sichern nicht), zeigt die Kontoseite selbst
  const view: AccountView | null =
    shown === 'account' && accountView !== null && me && viewAllowed(accountView, me.user.isGuest)
      ? accountView
      : null;

  useEffect(() => {
    if (sheet === null) openedHere.current = false;
    else setAgain(true);
  }, [sheet]);

  useEffect(() => {
    if (me && list && sheet === 'practice' && !list.testMatchesEnabled) {
      navigate({ name: 'start' }, { replace: true });
    }
  }, [me, list, sheet]);

  // Direkt aufgerufenes Formular, das es für dieses Konto nicht gibt: Pfad der Kontoseite
  useEffect(() => {
    if (sheet !== 'account' || accountView === null || !me || viewOpenedHere.current) return;
    if (!viewAllowed(accountView, me.user.isGuest)) {
      navigate({ name: 'account', view: null }, { replace: true });
    }
  }, [sheet, accountView, me]);

  const openAccountView = useCallback((next: AccountView) => {
    viewOpenedHere.current = true;
    navigate({ name: 'account', view: next });
  }, []);

  /** Schließt das Formular der Kontoseite oder ersetzt es durch ein anderes. */
  const closeAccountView = useCallback((replaceWith?: AccountView) => {
    if (replaceWith) {
      navigate({ name: 'account', view: replaceWith }, { replace: true });
      return;
    }
    if (window.location.pathname === '/konto') return;
    if (viewOpenedHere.current) {
      viewOpenedHere.current = false;
      window.history.back();
    } else {
      navigate({ name: 'account', view: null }, { replace: true });
    }
  }, []);

  const close = useCallback(() => {
    actions.reset();
    if (openedHere.current) {
      openedHere.current = false;
      window.history.back();
    } else {
      navigate({ name: 'start' }, { replace: true });
    }
  }, [actions]);

  useEffect(() => {
    if (!shown || help) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Ein offenes Formular der Kontoseite schließt zuerst
      if (shown === 'account' && accountView !== null) closeAccountView();
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, help, close, accountView, closeAccountView]);

  function openSheet(next: MenuSheet) {
    actions.reset();
    openedHere.current = true;
    navigate(SHEET_ROUTES[next]);
  }

  function chooseMode(next: MatchMode) {
    setMode(next);
    storeMode(next);
  }

  let centre: ReactNode = null;
  let bottom: ReactNode = null;
  if (state.status === 'error') {
    centre = (
      <section className="sheet menu-sheet menu-fail" aria-label={t('app.title')}>
        <ErrorNote error={state.error} onRetry={() => void reload()} />
      </section>
    );
  } else if (state.status === 'anonymous') {
    centre = login ? (
      <LoginSheet onBack={() => setLogin(false)} />
    ) : (
      <WelcomeSheet onLogin={() => setLogin(true)} />
    );
  } else if (me && list) {
    const props = {
      list,
      mode,
      onMode: chooseMode,
      busy: actions.busy,
      error: actions.error,
      onCreate: actions.create,
      onBack: close,
    };
    switch (shown) {
      case 'new':
        centre = <NewSheet {...props} />;
        break;
      case 'practice':
        centre = <PracticeSheet {...props} />;
        break;
      case 'join':
        centre = (
          <JoinSheet
            list={list}
            busy={actions.busy}
            error={actions.error}
            onJoin={actions.join}
            onBack={close}
          />
        );
        break;
      case 'chronicle':
        centre = <ChronicleSheet list={list} onBack={close} />;
        break;
      case 'account':
        centre = (
          <AccountSheet
            me={me}
            record={list.record}
            view={view}
            onView={openAccountView}
            onViewDone={closeAccountView}
            onBack={close}
          />
        );
        break;
      case null:
        bottom = (
          <>
            {open ? <OpenBanner match={open} /> : null}
            <nav
              className={`menu-seals${open ? ' aside' : ''}${again ? ' again' : ''}`}
              aria-label={t('nav.label')}
            >
              {open ? null : (
                <>
                  <Seal
                    icon={<MenuIcon kind="key" />}
                    label={t('menu.seal.join')}
                    onClick={() => openSheet('join')}
                  />
                  <Seal
                    big
                    icon={<Swords size={40} />}
                    label={t('menu.seal.new')}
                    onClick={() => openSheet('new')}
                  />
                  {list.testMatchesEnabled ? (
                    <Seal
                      icon={<MenuIcon kind="target" />}
                      label={t('menu.seal.practice')}
                      onClick={() => openSheet('practice')}
                    />
                  ) : null}
                </>
              )}
              <Seal
                icon={<MenuIcon kind="scroll" />}
                label={t('menu.seal.chronicle')}
                onClick={() => openSheet('chronicle')}
              />
            </nav>
          </>
        );
        break;
    }
  } else if (me && shown === 'account') {
    centre = (
      <AccountSheet
        me={me}
        record={null}
        view={view}
        onView={openAccountView}
        onViewDone={closeAccountView}
        onBack={close}
      />
    );
  } else if (me && listError) {
    bottom = (
      <div className="menu-fail-bar">
        <ErrorNote error={listError} onRetry={() => void load()} />
      </div>
    );
  }
  const loading =
    state.status === 'loading' ||
    (me !== null && list === null && !listError && shown !== 'account');

  return (
    <main
      className={`stage menu${centre ? ' with-sheet' : ''}`}
      data-testid="menu"
      data-sheet={shown ?? (state.status === 'anonymous' ? 'welcome' : 'home')}
    >
      <div className="stage-map">
        <MenuMap cover />
      </div>
      <div className={`stage-veil${centre ? ' on' : ''}`} aria-hidden="true" />
      <header className="menu-top">
        {me ? (
          <PlayerPlate
            me={me}
            record={list?.record ?? null}
            onOpen={() => {
              if (shown !== 'account') {
                openSheet('account');
                // Eine Mahnung führt gleich zu ihrem Formular; „Zurück“ landet auf der Kontoseite
                const alert = accountAlert(me);
                if (alert) openAccountView(alertView(alert));
              } else if (accountView !== null) closeAccountView();
              else close();
            }}
          />
        ) : null}
        <TitleMark />
        <div className="menu-tools">
          <SoundButton />
          {list?.realmMatchesEnabled ? (
            <RoundButton
              icon={<MenuIcon kind="help" />}
              label={t('menu.help')}
              onClick={() => setHelp(true)}
            />
          ) : null}
        </div>
      </header>
      {bottom}
      {centre ? (
        <div
          className="menu-centre"
          onClick={(event) => {
            // Ein Tipp neben das Blatt schließt es, wie „Zurück“. Ein offenes Formular der
            // Kontoseite bleibt: Am Handy tippt man daneben, um die Tastatur zu schließen
            if (event.target !== event.currentTarget || !shown) return;
            if (shown === 'account' && accountView !== null) return;
            close();
          }}
        >
          {centre}
        </div>
      ) : null}
      {loading ? (
        <p className="menu-loading" role="status">
          {t('menu.loading')}
        </p>
      ) : null}
      {help ? (
        <HelpSheet
          attackNeedsArmy={DEFAULT_REALM_RULES.economy.attackNeedsArmy ?? null}
          rounds={DEFAULT_REALM_RULES.campaign.rounds}
          castleLives={DEFAULT_REALM_RULES.capital.lives}
          fieldValue={DEFAULT_REALM_RULES.values.region}
          castleValue={DEFAULT_REALM_RULES.values.capital}
          onClose={() => setHelp(false)}
        />
      ) : null}
    </main>
  );
}
