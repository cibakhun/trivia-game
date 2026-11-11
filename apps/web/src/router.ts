import { useSyncExternalStore } from 'react';

/**
 * Kleiner Router über die History-API für die Routen aus ARCHITECTURE §12:
 * `/` (Start), `/welten` (Weltwahl), `/konto` (Konto), `/play/:instanceId` (Karte),
 * `/challenge/:challengeId` (Vollbild-Quiz), dazu die Partie: `/partie` (anlegen, beitreten),
 * `/partie/:matchId` (Aufstellung, Spiel, Ergebnis) und der Einladungslink
 * `/partie/beitreten/:code` (tritt der Aufstellung mit diesem Code bei).
 */

export type Route =
  | { readonly name: 'start' }
  | { readonly name: 'worlds' }
  | { readonly name: 'account' }
  | { readonly name: 'play'; readonly instanceId: string }
  | { readonly name: 'challenge'; readonly challengeId: string }
  | { readonly name: 'matches' }
  | { readonly name: 'match'; readonly matchId: string }
  /** Einladungslink; `code` steht in Großbuchstaben und ist noch nicht geprüft. */
  | { readonly name: 'matchJoin'; readonly code: string };

/** UUID-Form (8-4-4-4-12); andere Werte führen zur Startseite statt zu einem sicheren Fehlerabruf. */
const ID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export function parseRoute(pathname: string): Route {
  if (/^\/welten\/?$/.test(pathname)) return { name: 'worlds' };
  if (/^\/konto\/?$/.test(pathname)) return { name: 'account' };
  const play = new RegExp(`^/play/(${ID})/?$`).exec(pathname);
  if (play?.[1]) return { name: 'play', instanceId: play[1] };
  const challenge = new RegExp(`^/challenge/(${ID})/?$`).exec(pathname);
  if (challenge?.[1]) return { name: 'challenge', challengeId: challenge[1] };
  if (/^\/partie\/?$/.test(pathname)) return { name: 'matches' };
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
      return '/konto';
    case 'play':
      return `/play/${route.instanceId}`;
    case 'challenge':
      return `/challenge/${route.challengeId}`;
    case 'matches':
      return '/partie';
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
