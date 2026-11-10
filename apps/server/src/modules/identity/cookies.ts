import { API_PREFIX } from '@rdw/protocol';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { ServerConfig } from '../../infra/config.ts';
import { SESSION_TTL_MS } from './sessions.ts';

/** Bootstrap-Cookie für `/auth/guest` (API.md §1): 128 bit, nur unter /api/v1/auth, 24 h. */
export const BOOTSTRAP_COOKIE = 'guest_bootstrap';
export const BOOTSTRAP_TOKEN_BYTES = 16;
const BOOTSTRAP_MAX_AGE_S = 24 * 60 * 60;

export function sessionCookieOptions(config: ServerConfig): CookieSerializeOptions {
  return {
    path: API_PREFIX,
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export function bootstrapCookieOptions(config: ServerConfig): CookieSerializeOptions {
  return {
    path: `${API_PREFIX}/auth`,
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    maxAge: BOOTSTRAP_MAX_AGE_S,
  };
}
