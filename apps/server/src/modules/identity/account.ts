import type { Db, Tx } from '@rdw/db';
import type { PlayerNameParts } from '@rdw/game-core';
import { sql } from 'kysely';
import { ApiError, isUniqueViolation } from '../../infra/errors.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { setPlayerName } from './profile.ts';
import { createSession } from './sessions.ts';
import type { LoginThrottle } from './throttle.ts';

/**
 * Gesicherte Konten (O-03, ADR-043): Ein Gast sichert sein Konto mit Benutzername, Passwort und
 * Spielername; Konto-ID und Spielstand bleiben. Danach meldet er sich mit Benutzername und
 * Passwort an. Jede Anmeldung und jede Sicherung stellt eine neue Sitzung aus (Rotation).
 */

export interface RegisterInput {
  readonly userId: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly playerName: PlayerNameParts;
}

/**
 * Wandelt den Gast in ein gesichertes Konto um und ersetzt alle seine Sitzungen durch eine neue.
 * Läuft in der Transaktion des Idempotenzspeichers; der Hash wird vorher berechnet, damit die
 * Transaktion nicht auf Argon2 wartet.
 */
export async function registerGuest(tx: Tx, input: RegisterInput): Promise<string> {
  const user = await tx
    .selectFrom('users')
    .select(['is_guest'])
    .where('id', '=', input.userId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (!user.is_guest) {
    throw new ApiError(409, 'ALREADY_REGISTERED', 'Konto ist bereits gesichert');
  }
  try {
    await tx
      .updateTable('users')
      .set({
        is_guest: false,
        username: input.username,
        password_hash: input.passwordHash,
        guest_bootstrap_hash: null,
      })
      .where('id', '=', input.userId)
      .execute();
  } catch (error) {
    if (isUniqueViolation(error, 'users_username_unique')) {
      throw new ApiError(409, 'USERNAME_TAKEN', 'Benutzername ist vergeben');
    }
    throw error;
  }
  await setPlayerName(tx, input.userId, input.playerName);
  await tx.deleteFrom('sessions').where('user_id', '=', input.userId).execute();
  return createSession(tx, input.userId);
}

export interface LoginInput {
  readonly username: string;
  readonly password: string;
  readonly address: string;
  /** Sitzung, mit der die Anfrage kam; sie wird beendet (auch die eines anderen Kontos). */
  readonly currentTokenHash: Buffer | null;
}

/**
 * Prüft Benutzername und Passwort und stellt eine Sitzung aus. Unbekannte Namen und falsche
 * Passwörter ergeben denselben Fehler nach gleichem Aufwand. Konten mit Löschantrag melden sich
 * nicht an (SECURITY §5.2).
 */
export async function login(
  db: Db,
  throttle: LoginThrottle,
  input: LoginInput,
): Promise<{ userId: string; sessionToken: string }> {
  throttle.assertAllowed(input.username, input.address);
  const user = await db
    .selectFrom('users')
    .select(['id', 'password_hash'])
    .where(sql<boolean>`username = ${input.username.normalize('NFC')}::citext`)
    .where('is_guest', '=', false)
    .where('deleted_at', 'is', null)
    .where('deletion_requested_at', 'is', null)
    .executeTakeFirst();
  const ok = await verifyPassword(user?.password_hash ?? null, input.password);
  if (!user || !ok) {
    throttle.recordFailure(input.username, input.address);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Benutzername oder Passwort falsch');
  }
  throttle.recordSuccess(input.username);
  const sessionToken = await db.transaction().execute(async (tx) => {
    if (input.currentTokenHash) {
      await tx.deleteFrom('sessions').where('token_hash', '=', input.currentTokenHash).execute();
    }
    return createSession(tx, user.id);
  });
  return { userId: user.id, sessionToken };
}

export interface PasswordChangeInput {
  readonly userId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly address: string;
  /** Die Sitzung der Anfrage bleibt, alle anderen Sitzungen des Kontos enden. */
  readonly keepTokenHash: Buffer;
}

/**
 * Prüft das bisherige Passwort (mit derselben Bremse wie die Anmeldung) und setzt das neue. Läuft
 * in der Transaktion des Idempotenzspeichers: Eine Wiederholung nach Erfolg liefert die
 * gespeicherte Antwort, statt am inzwischen geänderten Passwort zu scheitern. Die Kontozeile ist
 * gesperrt, gleichzeitige Änderungen laufen nacheinander.
 */
export async function changePassword(
  tx: Tx,
  throttle: LoginThrottle,
  input: PasswordChangeInput,
): Promise<void> {
  const throttleKey = `#${input.userId}`;
  throttle.assertAllowed(throttleKey, input.address);
  const user = await tx
    .selectFrom('users')
    .select(['is_guest', 'password_hash'])
    .where('id', '=', input.userId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const currentHash = user.password_hash;
  if (user.is_guest || currentHash === null) {
    throw new ApiError(403, 'GUEST_ACCOUNT', 'Nur für gesicherte Konten');
  }
  if (!(await verifyPassword(currentHash, input.currentPassword))) {
    throttle.recordFailure(throttleKey, input.address);
    throw new ApiError(403, 'INVALID_CREDENTIALS', 'Bisheriges Passwort falsch');
  }
  throttle.recordSuccess(throttleKey);
  await tx
    .updateTable('users')
    .set({ password_hash: await hashPassword(input.newPassword) })
    .where('id', '=', input.userId)
    .execute();
  await tx
    .deleteFrom('sessions')
    .where('user_id', '=', input.userId)
    .where('token_hash', '<>', input.keepTokenHash)
    .execute();
}
