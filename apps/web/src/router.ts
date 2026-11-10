import { useSyncExternalStore } from 'react';

/**
 * Kleiner Router über die History-API für die Routen aus ARCHITECTURE §12:
 * `/` (Start), `/play/:instanceId` (Karte), `/challenge/:challengeId` (Vollbild-Quiz).
 */

export type Route =
  | { readonly name: 'start' }
  | { readonly name: 'play'; readonly instanceId: string }
  | { readonly name: 'challenge'; readonly challengeId: string };

const ID = '[0-9a-fA-F-]{36}';

export function parseRoute(pathname: string): Route {
  const play = new RegExp(`^/play/(${ID})/?$`).exec(pathname);
  if (play?.[1]) return { name: 'play', instanceId: play[1] };
  const challenge = new RegExp(`^/challenge/(${ID})/?$`).exec(pathname);
  if (challenge?.[1]) return { name: 'challenge', challengeId: challenge[1] };
  return { name: 'start' };
}

export function routePath(route: Route): string {
  switch (route.name) {
    case 'start':
      return '/';
    case 'play':
      return `/play/${route.instanceId}`;
    case 'challenge':
      return `/challenge/${route.challengeId}`;
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
