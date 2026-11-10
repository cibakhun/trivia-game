import type { Db } from '@rdw/db';
import { DAY_MS, HOUR_MS } from '@rdw/protocol';
import { sql } from 'kysely';
import { gameNow, intervalMs } from '../../infra/clock.ts';
import { hashToken, isToken, randomToken } from '../../infra/crypto.ts';

/**
 * Sitzungen (SECURITY.md §2, API.md §1): 256-Bit-Zufallstoken im Cookie, in der Datenbank nur
 * dessen SHA-256. Ablauf 30 Tage gleitend; verlängert wird höchstens stündlich, damit nicht jede
 * Anfrage schreibt. Mit der Verlängerung wird `users.last_seen_at` gesetzt – das beendet auch die
 * Wiederholbarkeit von `/auth/guest` (API.md §1).
 */

export const SESSION_COOKIE = 'rdw_session';
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TTL_MS = 30 * DAY_MS;
export const SESSION_TOUCH_INTERVAL_MS = HOUR_MS;

export interface AuthContext {
  readonly userId: string;
  readonly isGuest: boolean;
  readonly tokenHash: Buffer;
  /** `true`, wenn die Sitzung bei dieser Anfrage verlängert wurde (Cookie neu setzen). */
  readonly renewed: boolean;
}

/** Legt eine Sitzung an und gibt das Token für das Cookie zurück. */
export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomToken(SESSION_TOKEN_BYTES);
  await db
    .insertInto('sessions')
    .values({
      token_hash: hashToken(token),
      user_id: userId,
      created_at: gameNow,
      expires_at: sql<Date>`game_now() + ${intervalMs(SESSION_TTL_MS)}`,
    })
    .execute();
  return token;
}

/**
 * Prüft ein Sitzungstoken. Unbekannte, abgelaufene Sitzungen und Konten mit Löschantrag gelten
 * als nicht angemeldet (SECURITY.md §5.2: der Antrag beendet alle Sitzungen).
 */
export async function authenticate(db: Db, token: unknown): Promise<AuthContext | null> {
  if (!isToken(token, SESSION_TOKEN_BYTES)) return null;
  const tokenHash = hashToken(token);
  const row = await db
    .selectFrom('sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select([
      's.user_id',
      'u.is_guest',
      sql<boolean>`s.last_used_at is null or s.last_used_at <= game_now() - ${intervalMs(SESSION_TOUCH_INTERVAL_MS)}`.as(
        'due',
      ),
    ])
    .where('s.token_hash', '=', tokenHash)
    .where('s.expires_at', '>', gameNow)
    .where('u.deleted_at', 'is', null)
    .where('u.deletion_requested_at', 'is', null)
    .executeTakeFirst();
  if (!row) return null;
  if (row.due) {
    // Sperrfolge wie beim Sichern, Anmelden und Passwortwechsel: erst das Konto, dann die
    // Sitzung. Umgekehrt könnte eine Verlängerung mit einem Passwortwechsel verklemmen.
    await db.transaction().execute(async (tx) => {
      await tx
        .updateTable('users')
        .set({ last_seen_at: gameNow })
        .where('id', '=', row.user_id)
        .execute();
      await tx
        .updateTable('sessions')
        .set({
          last_used_at: gameNow,
          expires_at: sql<Date>`game_now() + ${intervalMs(SESSION_TTL_MS)}`,
        })
        .where('token_hash', '=', tokenHash)
        .execute();
    });
  }
  return { userId: row.user_id, isGuest: row.is_guest, tokenHash, renewed: row.due };
}

export async function deleteSession(db: Db, tokenHash: Buffer): Promise<void> {
  await db.deleteFrom('sessions').where('token_hash', '=', tokenHash).execute();
}
