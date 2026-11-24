import { useSyncExternalStore } from 'react';
import type { AccountView } from './menu/account-text.ts';

/**
 * Kleiner Router über die History-API für die Routen aus ARCHITECTURE §12:
 * `/` (Hauptmenü), `/welten` (Weltwahl), `/play/:instanceId` (Karte),
 * `/challenge/:challengeId` (Vollbild-Quiz), dazu die Partie: `/partie/:matchId` (Aufstellung,
 * Spiel, Ergebnis) und der Einladungslink `/partie/beitreten/:code` (tritt der Aufstellung mit
 * diesem Code bei). Die Blätter des Hauptmenüs (ADR-074) haben eigene Pfade, damit „Zurück“ im
 * Browser ein Blatt schließt: `/partie` (Neue Partie), `/partie/code` (Mit Code beitreten),
 * `/partie/uebung` (Übungspartie) und `/chronik`. Die Kontoseite (ADR-080) ist ebenfalls ein Blatt
 * des Hauptmenüs unter `/konto`; ihre Formulare haben eigene Pfade darunter (`/konto/name`,
 * `/konto/registrieren`, `/konto/passwort`, `/konto/anmelden`, `/konto/abmelden`; der frühere Pfad
 * `/konto/sichern` führt seit ADR-082 ebenfalls zum Registrieren).
 */

export type Route =
  | { readonly name: 'start' }
  | { readonly name: 'worlds' }
  /** Kontoseite; `view` ist ein Formular auf ihr, `null` die Seite selbst. */
  | { readonly name: 'account'; readonly view: AccountView | null }
  | { readonly name: 'play'; readonly instanceId: string }
  | { readonly name: 'challenge'; readonly challengeId: string }
  /** Hauptmenü mit dem Blatt „Neue Partie“. */
  | { readonly name: 'matches' }
  /** Hauptmenü mit einem anderen Blatt. */
  | { readonly name: 'menu'; readonly sheet: 'join' | 'practice' | 'chronicle' }
  | { readonly name: 'match'; readonly matchId: string }
  /** Einladungslink; `code` steht in Großbuchstaben und ist noch nicht geprüft. */
  | { readonly name: 'matchJoin'; readonly code: string };

const MENU_PATHS = {
  join: '/partie/code',
  practice: '/partie/uebung',
  chronicle: '/chronik',
} as const;

const ACCOUNT_PATHS: Record<AccountView, string> = {
  name: '/konto/name',
  secure: '/konto/registrieren',
  password: '/konto/passwort',
  login: '/konto/anmelden',
  logout: '/konto/abmelden',
};

/** UUID-Form (8-4-4-4-12); andere Werte führen zur Startseite statt zu einem sicheren Fehlerabruf. */
const ID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export function parseRoute(pathname: string): Route {
  if (/^\/welten\/?$/.test(pathname)) return { name: 'worlds' };
  if (/^\/konto\/?$/.test(pathname)) return { name: 'account', view: null };
  for (const [view, path] of Object.entries(ACCOUNT_PATHS)) {
    if (pathname === path || pathname === `${path}/`) {
      return { name: 'account', view: view as AccountView };
    }
  }
  // Früherer Pfad zum Sichern (ADR-080), etwa aus einem Lesezeichen
  if (/^\/konto\/sichern\/?$/.test(pathname)) return { name: 'account', view: 'secure' };
  const play = new RegExp(`^/play/(${ID})/?$`).exec(pathname);
  if (play?.[1]) return { name: 'play', instanceId: play[1] };
  const challenge = new RegExp(`^/challenge/(${ID})/?$`).exec(pathname);
  if (challenge?.[1]) return { name: 'challenge', challengeId: challenge[1] };
  if (/^\/partie\/?$/.test(pathname)) return { name: 'matches' };
  if (/^\/partie\/code\/?$/.test(pathname)) return { name: 'menu', sheet: 'join' };
  if (/^\/partie\/uebung\/?$/.test(pathname)) return { name: 'menu', sheet: 'practice' };
  if (/^\/chronik\/?$/.test(pathname)) return { name: 'menu', sheet: 'chronicle' };
  const match = new RegExp(`^/partie/(${ID})/?$`).exec(pathname);
  if (match?.[1]) return { name: 'match', matchId: match[1] };
  // Groß- und Kleinschreibung egal, wie bei der Eingabe von Hand; ob der Code stimmt, sagt die Seite
  const join = /^\/partie\/beitreten\/([A-Za-z0-9]{1,16})\/?$/.exec(pathname);
  if (join?.[1]) return { name: 'matchJoin', code: join[1].toUpperCase() };
  return { name: 'start' };
}

export function routePath(route: Route): string {
  switch (route.name) {
    case 'start':
      return '/';
    case 'worlds':
      return '/welten';
    case 'account':
      return route.view === null ? '/konto' : ACCOUNT_PATHS[route.view];
    case 'play':
      return `/play/${route.instanceId}`;
    case 'challenge':
      return `/challenge/${route.challengeId}`;
    case 'matches':
      return '/partie';
    case 'menu':
      return MENU_PATHS[route.sheet];
    case 'match':
      return `/partie/${route.matchId}`;
    case 'matchJoin':
      return `/partie/beitreten/${route.code}`;
  }
}

/**
 * Einladungslink zu einer Aufstellung. Er entsteht aus der Adresse, unter der das Spiel gerade
 * läuft, denn die kann sich bei jedem Start ändern.
 */
export function inviteLink(code: string, origin: string = window.location.origin): string {
  return `${origin}${routePath({ name: 'matchJoin', code })}`;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const path = routePath(route);
  if (path === window.location.pathname) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  for (const listener of listeners) listener();
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname);
  return parseRoute(pathname);
}
