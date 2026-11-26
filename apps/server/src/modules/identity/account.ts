import type { Db, Tx } from '@rdw/db';
import { normalizeUsername } from '@rdw/protocol';
import { sql } from 'kysely';
import { ApiError, isUniqueViolation } from '../../infra/errors.ts';
import { hasActiveMatch } from './deletion.ts';
import { setRegistrationEmail, type PendingLink } from './email.ts';
import { verifyPassword } from './passwords.ts';
import { nameTaken, setPlayerName } from './profile.ts';
import { createSession } from './sessions.ts';
import type { LoginThrottle } from './throttle.ts';

/**
 * Gesicherte Konten (O-03, ADR-043, ADR-082): Ein Gast sichert sein Konto mit einem selbst
 * gewählten Benutzernamen und einem Passwort; der Benutzername ist zugleich sein Spielername.
 * Konto-ID und Spielstand bleiben. Danach meldet er sich mit Benutzername und Passwort an. Jede
 * Anmeldung und jede Sicherung stellt eine neue Sitzung aus (Rotation).
 */

export interface RegisterInput {
  readonly userId: string;
  /** Vereinheitlicht und auf Regeln und Wortfilter geprüft. */
  readonly username: string;
  /** Adresse für den Bestätigungslink (ADR-086). */
  readonly email: string;
  readonly passwordHash: string;
}

export interface RegisterResult {
  readonly sessionToken: string;
  /** Erster Bestätigungslink; geht nach dem Commit hinaus. */
  readonly link: PendingLink;
}

/**
 * Wandelt den Gast in ein gesichertes Konto um und ersetzt alle seine Sitzungen durch eine neue.
 * Läuft in der Transaktion des Idempotenzspeichers; der Hash wird vorher berechnet, damit die
 * Transaktion nicht auf Argon2 wartet.
 */
export async function registerGuest(tx: Tx, input: RegisterInput): Promise<RegisterResult> {
  const user = await tx
    .selectFrom('users')
    .select(['is_guest'])
    .where('id', '=', input.userId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (!user.is_guest) {
    throw new ApiError(409, 'ALREADY_REGISTERED', 'Konto ist bereits gesichert');
  }
  // Auch andere Schreibweisen gelten als vergeben (`player_name_key`); der eindeutige Index auf
  // dem Anmeldenamen fängt ein gleichzeitiges Sichern mit demselben Namen
  if (await nameTaken(tx, input.username, input.userId)) {
    throw new ApiError(409, 'USERNAME_TAKEN', 'Benutzername ist vergeben');
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
  // Derselbe Name ist der Spielername (ADR-082); ein vergebener Name rollt alles zurück
  await setPlayerName(tx, input.userId, input.username, { login: false });
  // E-Mail mit 30 Tagen Frist zur Bestätigung (ADR-086)
  const link = await setRegistrationEmail(tx, input.userId, input.email);
  await tx.deleteFrom('sessions').where('user_id', '=', input.userId).execute();
  return { sessionToken: await createSession(tx, input.userId), link };
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
 * Passwörter ergeben denselben Fehler nach gleichem Aufwand. Hat das Konto einen Löschantrag, hebt
 * die Anmeldung ihn auf (O-47 B, ADR-086); ist es schon gelöscht, gibt es den Namen nicht mehr.
 */
export async function login(
  db: Db,
  throttle: LoginThrottle,
  input: LoginInput,
): Promise<{ userId: string; sessionToken: string; deletionCancelled: boolean }> {
  throttle.assertAllowed(input.username, input.address);
  const user = await db
    .selectFrom('users')
    .select(['id', 'password_hash'])
    .where(sql<boolean>`username = ${normalizeUsername(input.username)}::citext`)
    .where('is_guest', '=', false)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  const ok = await verifyPassword(user?.password_hash ?? null, input.password);
  if (!user || !ok) {
    throttle.recordFailure(input.username, input.address);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Benutzername oder Passwort falsch');
  }
  throttle.recordSuccess(input.username);
  return db.transaction().execute(async (tx) => {
    // Argon2 lief ohne Sperre. Wurde das Passwort inzwischen zurückgesetzt oder geändert (beides
    // beendet alle Sitzungen), darf die Prüfung gegen den alten Hash keine neue Sitzung ergeben.
    // Die Sperre wartet auch auf eine laufende Löschung: Danach fehlt die Zeile.
    const current = await tx
      .selectFrom('users')
      .select(['password_hash', 'deletion_requested_at'])
      .where('id', '=', user.id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!current || current.password_hash !== user.password_hash) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Benutzername oder Passwort falsch');
    }
    const deletionCancelled = current.deletion_requested_at !== null;
    if (deletionCancelled) {
      await tx
        .updateTable('users')
        .set({ deletion_requested_at: null })
        .where('id', '=', user.id)
        .execute();
    }
    if (input.currentTokenHash) {
      await tx.deleteFrom('sessions').where('token_hash', '=', input.currentTokenHash).execute();
    }
    return { userId: user.id, sessionToken: await createSession(tx, user.id), deletionCancelled };
  });
}

export interface DeletionRequestInput {
  readonly userId: string;
  /** Pflicht für registrierte Konten; Gäste haben keins. */
  readonly password: string | undefined;
  readonly address: string;
}

/**
 * Löschantrag (`DELETE /me`, O-47 B, ADR-086): Registrierte Konten bestätigen mit dem Passwort
 * (gebremst wie die Anmeldung). Wer in einer Aufstellung oder laufenden Partie sitzt, beendet sie
 * zuerst (`MATCH_IN_PROGRESS`). Der Antrag beendet alle Sitzungen; registrierte Konten werden nach
 * 7 Tagen gelöscht, eine Anmeldung vorher hebt ihn auf. Gäste kommen ohne Sitzung nicht wieder
 * herein: Der Aufrufer löscht sie gleich (`deleteIfDue`). Liefert, ob es ein Gast war.
 */
export async function requestDeletion(
  db: Db,
  throttle: LoginThrottle,
  input: DeletionRequestInput,
): Promise<{ isGuest: boolean; requestedAt: Date }> {
  const throttleKey = `#${input.userId}`;
  const user = await db
    .selectFrom('users')
    .select(['is_guest', 'password_hash'])
    .where('id', '=', input.userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  if (!user.is_guest) {
    throttle.assertAllowed(throttleKey, input.address);
    if (!input.password || !(await verifyPassword(user.password_hash, input.password))) {
      throttle.recordFailure(throttleKey, input.address);
      throw new ApiError(403, 'INVALID_CREDENTIALS', 'Passwort falsch');
    }
    throttle.recordSuccess(throttleKey);
  }
  if (await hasActiveMatch(db, input.userId)) {
    throw new ApiError(409, 'MATCH_IN_PROGRESS', 'Erst die laufende Partie beenden');
  }
  return db.transaction().execute(async (tx) => {
    const row = await tx
      .updateTable('users')
      .set({ deletion_requested_at: sql<Date>`coalesce(deletion_requested_at, game_now())` })
      .where('id', '=', input.userId)
      .where('deleted_at', 'is', null)
      .returning(['is_guest', 'deletion_requested_at'])
      .executeTakeFirstOrThrow();
    await tx.deleteFrom('sessions').where('user_id', '=', input.userId).execute();
    return { isGuest: row.is_guest, requestedAt: row.deletion_requested_at ?? new Date() };
  });
}

export interface PasswordChangeInput {
  readonly userId: string;
  readonly currentPassword: string;
  /** Hash des neuen Passworts, vor der Transaktion berechnet. */
  readonly newPasswordHash: string;
  readonly address: string;
  /** Die Sitzung der Anfrage bleibt, alle anderen Sitzungen des Kontos enden. */
  readonly keepTokenHash: Buffer;
}

/**
 * Prüft das bisherige Passwort (mit derselben Bremse wie die Anmeldung) und setzt das neue. Läuft
 * in der Transaktion des Idempotenzspeichers: Eine Wiederholung nach Erfolg liefert die
 * gespeicherte Antwort, statt am inzwischen geänderten Passwort zu scheitern. Die Kontozeile ist
 * gesperrt, gleichzeitige Änderungen laufen nacheinander. Sperrfolge wie überall: erst das Konto,
 * dann seine Sitzungen.
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
    .set({ password_hash: input.newPasswordHash })
    .where('id', '=', input.userId)
    .execute();
  await tx
    .deleteFrom('sessions')
    .where('user_id', '=', input.userId)
    .where('token_hash', '<>', input.keepTokenHash)
    .execute();
}
