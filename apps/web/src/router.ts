import { useSyncExternalStore } from 'react';

/**
 * Kleiner Router über die History-API für die Routen aus ARCHITECTURE §12:
 * `/` (Start), `/welten` (Weltwahl), `/konto` (Konto), `/play/:instanceId` (Karte),
 * `/challenge/:challengeId` (Vollbild-Quiz), dazu die Partie: `/partie` (anlegen, beitreten) und
 * `/partie/:matchId` (Aufstellung, Spiel, Ergebnis).
 */

export type Route =
  | { readonly name: 'start' }
  | { readonly name: 'worlds' }
  | { readonly name: 'account' }
  | { readonly name: 'play'; readonly instanceId: string }
  | { readonly name: 'challenge'; readonly challengeId: string }
  | { readonly name: 'matches' }
  | { readonly name: 'match'; readonly matchId: string };

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
  }
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
