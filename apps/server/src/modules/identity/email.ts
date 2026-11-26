import { newId, type Db, type Tx } from '@rdw/db';
import { DAY_MS, EMAIL_LINK_DAYS, MINUTE_MS, type EmailState } from '@rdw/protocol';
import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'kysely';
import { gameNow, intervalMs, readGameNow } from '../../infra/clock.ts';
import { hashToken, randomToken } from '../../infra/crypto.ts';
import { ApiError, isUniqueViolation } from '../../infra/errors.ts';
import type { Mailer } from '../../infra/mail.ts';
import { EMAIL_VERIFY_MS } from './deletion.ts';

/**
 * E-Mail des Kontos (O-48, ADR-086). Wer registriert, gibt eine Adresse an und muss sie innerhalb
 * von 30 Tagen über einen Link bestätigen, sonst löscht die Kontopflege das Konto; bis dahin spielt
 * er ohne Einschränkung. Ein bestätigtes Konto, das eine neue Adresse einträgt, behält die alte,
 * bis die neue bestätigt ist. Eindeutig ist eine Adresse erst bestätigt.
 *
 * Links: 32 Zufallsbytes in Base64url; gespeichert wird nur ihr SHA-256. Ein neuer Link macht die
 * älteren desselben Kontos ungültig. Bremse [E]: höchstens ein Link je Minute und sechs je Tag.
 */

export const EMAIL_TOKEN_BYTES = 32;
const LINK_MS = EMAIL_LINK_DAYS * DAY_MS;
/** Abstand zwischen zwei Links eines Kontos [E]. */
export const EMAIL_RESEND_GAP_MS = MINUTE_MS;
/** Höchstens so viele Links je Konto in 24 Stunden [E]. */
export const EMAIL_DAILY_LINKS = 6;

interface UserEmailRow {
  readonly email: string | null;
  readonly email_verified_at: Date | null;
  readonly email_due_at: Date | null;
}

const same = (a: string | null, b: string | null) =>
  a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

/** Neue Adresse eines bestätigten Kontos, die noch auf ihren Link wartet. */
async function pendingEmail(db: Db | Tx, userId: string, current: string | null) {
  const row = await db
    .selectFrom('email_verifications')
    .select('email')
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .where('expires_at', '>', gameNow)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row && !same(row.email, current) ? row.email : null;
}

/** Stand der E-Mail für `GET /me` und die Antworten; `null` für Gäste. */
export async function loadEmailState(
  db: Db | Tx,
  userId: string,
  mailDelivers: boolean,
): Promise<EmailState | null> {
  const user = await db
    .selectFrom('users')
    .select(['is_guest', 'email', 'email_verified_at', 'email_due_at'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  if (user.is_guest) return null;
  return emailState(
    user,
    user.email_verified_at ? await pendingEmail(db, userId, user.email) : null,
    mailDelivers,
  );
}

export function emailState(
  user: UserEmailRow,
  pending: string | null,
  mailDelivers: boolean,
): EmailState {
  const verified = user.email !== null && user.email_verified_at !== null;
  return {
    address: user.email,
    verified,
    pending,
    // Ohne Zustellung droht keine Löschung (deletion.ts hält die Frist dann fest)
    dueAt: !verified && mailDelivers && user.email_due_at ? user.email_due_at.toISOString() : null,
  };
}

/** Ist die Adresse schon von einem anderen Konto bestätigt? */
async function takenByOther(tx: Tx, userId: string, email: string): Promise<boolean> {
  const row = await tx
    .selectFrom('users')
    .select('id')
    .where(sql<boolean>`email = ${email}::citext`)
    .where('email_verified_at', 'is not', null)
    .where('id', '<>', userId)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Bremse für neue Links: höchstens einer je Minute und sechs je Tag. Wirft `RATE_LIMITED` mit
 * `retryAfterMs`.
 */
async function assertLinkAllowed(tx: Tx, userId: string): Promise<void> {
  const rows = await tx
    .selectFrom('email_verifications')
    .select(sql<number>`extract(epoch from (game_now() - created_at)) * 1000`.as('age_ms'))
    .where('user_id', '=', userId)
    .where(sql<boolean>`created_at > game_now() - ${intervalMs(DAY_MS)}`)
    .orderBy('created_at', 'desc')
    .execute();
  const ages = rows.map((row) => Number(row.age_ms));
  const newest = ages[0];
  if (newest !== undefined && newest < EMAIL_RESEND_GAP_MS) {
    throw new ApiError(429, 'RATE_LIMITED', 'Bitte kurz warten', {
      retryAfterMs: Math.ceil(EMAIL_RESEND_GAP_MS - newest),
    });
  }
  const oldest = ages[EMAIL_DAILY_LINKS - 1];
  if (oldest !== undefined) {
    throw new ApiError(429, 'RATE_LIMITED', 'Zu viele Links heute', {
      retryAfterMs: Math.max(1000, Math.ceil(DAY_MS - oldest)),
    });
  }
}

/** Legt einen neuen Link für die Adresse an und macht die älteren ungültig; liefert das Token. */
async function createLink(tx: Tx, userId: string, email: string): Promise<string> {
  await assertLinkAllowed(tx, userId);
  await tx
    .updateTable('email_verifications')
    .set({ used_at: gameNow })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .execute();
  const token = randomToken(EMAIL_TOKEN_BYTES);
  await tx
    .insertInto('email_verifications')
    .values({
      id: newId(),
      user_id: userId,
      email,
      token_hash: hashToken(token),
      expires_at: sql<Date>`game_now() + ${intervalMs(LINK_MS)}`,
    })
    .execute();
  return token;
}

/** Was nach dem Commit verschickt werden soll. */
export interface PendingLink {
  readonly to: string;
  readonly token: string;
}

/**
 * Beim Registrieren (in der Transaktion von `registerGuest`): Adresse eintragen, Frist setzen,
 * ersten Link anlegen.
 */
export async function setRegistrationEmail(
  tx: Tx,
  userId: string,
  email: string,
): Promise<PendingLink> {
  if (await takenByOther(tx, userId, email)) {
    throw new ApiError(409, 'EMAIL_TAKEN', 'Diese Adresse gehört schon zu einem Konto');
  }
  await tx
    .updateTable('users')
    .set({
      email,
      email_verified_at: null,
      email_due_at: sql<Date>`game_now() + ${intervalMs(EMAIL_VERIFY_MS)}`,
    })
    .where('id', '=', userId)
    .execute();
  return { to: email, token: await createLink(tx, userId, email) };
}

/**
 * `PUT /me/email`: neue Adresse. Ohne bestätigte Adresse ersetzt sie die bisherige sofort (die
 * Frist bleibt); mit bestätigter Adresse wartet sie, bis ihr Link bestätigt ist. Die gleiche
 * Adresse noch einmal schickt nur einen neuen Link, wenn sie unbestätigt ist.
 */
export async function changeEmail(
  tx: Tx,
  userId: string,
  email: string,
): Promise<PendingLink | null> {
  const user = await tx
    .selectFrom('users')
    .select(['is_guest', 'email', 'email_verified_at', 'email_due_at'])
    .where('id', '=', userId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (user.is_guest) throw new ApiError(403, 'GUEST_ACCOUNT', 'Nur für gesicherte Konten');
  const verified = user.email !== null && user.email_verified_at !== null;
  if (verified && same(user.email, email)) {
    // Zurück zur bestätigten Adresse: Ein wartender Wechsel entfällt
    await tx
      .updateTable('email_verifications')
      .set({ used_at: gameNow })
      .where('user_id', '=', userId)
      .where('used_at', 'is', null)
      .execute();
    return null;
  }
  if (await takenByOther(tx, userId, email)) {
    throw new ApiError(409, 'EMAIL_TAKEN', 'Diese Adresse gehört schon zu einem Konto');
  }
  if (same(user.email, email)) {
    return { to: user.email ?? email, token: await createLink(tx, userId, user.email ?? email) };
  }
  if (!verified) {
    await tx
      .updateTable('users')
      .set({
        email,
        email_verified_at: null,
        // Konten ohne Frist (sollte es nicht geben) bekommen jetzt eine; eine laufende bleibt
        email_due_at: sql<Date>`coalesce(email_due_at, game_now() + ${intervalMs(EMAIL_VERIFY_MS)})`,
      })
      .where('id', '=', userId)
      .execute();
  }
  return { to: email, token: await createLink(tx, userId, email) };
}

/**
 * `POST /me/email/resend`: neuer Link für die wartende oder die unbestätigte Adresse. Ohne
 * Adresse `EMAIL_MISSING`; ist alles bestätigt, geht nichts hinaus.
 */
export async function resendEmailLink(tx: Tx, userId: string): Promise<PendingLink | null> {
  const user = await tx
    .selectFrom('users')
    .select(['is_guest', 'email', 'email_verified_at'])
    .where('id', '=', userId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (user.is_guest) throw new ApiError(403, 'GUEST_ACCOUNT', 'Nur für gesicherte Konten');
  if (user.email === null) throw new ApiError(409, 'EMAIL_MISSING', 'Noch keine Adresse');
  const target =
    user.email_verified_at === null ? user.email : await pendingEmail(tx, userId, user.email);
  if (target === null) return null;
  if (await takenByOther(tx, userId, target)) {
    throw new ApiError(409, 'EMAIL_TAKEN', 'Diese Adresse gehört schon zu einem Konto');
  }
  return { to: target, token: await createLink(tx, userId, target) };
}

/**
 * `POST /auth/email/verify`: bestätigt die Adresse des Links. Geht ohne Sitzung. Ein schon
 * benutzter Link für die jetzt bestätigte Adresse gilt als Wiederholung und gelingt noch einmal.
 */
export async function verifyEmail(db: Db, token: string): Promise<{ email: string }> {
  const invalid = () =>
    new ApiError(410, 'EMAIL_LINK_INVALID', 'Link abgelaufen, ersetzt oder unbekannt');
  return db.transaction().execute(async (tx) => {
    const link = await tx
      .selectFrom('email_verifications')
      .select([
        'id',
        'user_id',
        'email',
        'used_at',
        sql<boolean>`expires_at <= game_now()`.as('expired'),
      ])
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!link) throw invalid();
    const user = await tx
      .selectFrom('users')
      .select(['email', 'email_verified_at', 'deletion_requested_at'])
      .where('id', '=', link.user_id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!user) throw invalid();
    if (link.used_at !== null) {
      if (user.email_verified_at !== null && same(user.email, link.email)) {
        return { email: link.email };
      }
      throw invalid();
    }
    if (link.expired) throw invalid();
    try {
      await tx
        .updateTable('users')
        .set({ email: link.email, email_verified_at: gameNow })
        .where('id', '=', link.user_id)
        .execute();
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_verified_unique')) {
        throw new ApiError(409, 'EMAIL_TAKEN', 'Diese Adresse gehört schon zu einem Konto');
      }
      throw error;
    }
    await tx
      .updateTable('email_verifications')
      .set({ used_at: gameNow })
      .where('user_id', '=', link.user_id)
      .where('used_at', 'is', null)
      .execute();
    return { email: link.email };
  });
}

const dueFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Berlin',
});

/** Text der Bestätigungsmail (nur Deutsch, ADR-023). */
export function verificationMail(input: {
  readonly name: string | null;
  readonly link: string;
  readonly dueAt: Date | null;
}): { subject: string; text: string } {
  const lines = [
    input.name ? `Hallo ${input.name},` : 'Hallo,',
    '',
    'bitte bestätige deine E-Mail-Adresse für dein Konto im Spiel. Tippe dazu auf diesen Link:',
    '',
    input.link,
    '',
    input.dueAt
      ? `Bestätige bis zum ${dueFormat.format(input.dueAt)}. Ohne Bestätigung wird dein Konto danach gelöscht. Spielen kannst du bis dahin ganz normal.`
      : 'Mit der Bestätigung bleibt dein Konto sicher bestehen.',
    `Der Link gilt ${EMAIL_LINK_DAYS} Tage. Einen neuen bekommst du auf deiner Kontoseite unter „Zugang“.`,
    '',
    'Hast du dich nicht registriert? Dann kannst du diese Mail einfach löschen.',
  ];
  return { subject: 'Bitte bestätige deine E-Mail-Adresse', text: lines.join('\n') };
}

/** Pfad der Bestätigungsseite im Browser (router.ts). */
export function verificationLink(origin: string, token: string): string {
  return `${origin}/email/bestaetigen/${token}`;
}

/**
 * Schickt einen Link nach dem Commit. Ein Fehler beim Versand macht die Aktion nicht ungeschehen:
 * Er wird geloggt, und der Spieler kann einen neuen Link anfordern. Liefert, ob die Mail raus ist.
 */
export async function sendLink(
  ctx: { readonly db: Db; readonly mailer: Mailer; readonly publicOrigin: string },
  userId: string,
  link: PendingLink,
  log: Pick<FastifyBaseLogger, 'error'>,
): Promise<boolean> {
  try {
    const user = await ctx.db
      .selectFrom('users as u')
      .leftJoin('player_profiles as p', 'p.user_id', 'u.id')
      .select(['u.email_verified_at', 'u.email_due_at', 'p.display_name'])
      .where('u.id', '=', userId)
      .executeTakeFirstOrThrow();
    const dueAt = ctx.mailer.delivers && user.email_verified_at === null ? user.email_due_at : null;
    const mail = verificationMail({
      name: user.display_name,
      link: verificationLink(ctx.publicOrigin, link.token),
      dueAt,
    });
    await ctx.mailer.send({ to: link.to, ...mail });
    return true;
  } catch (error) {
    log.error({ err: error, userId }, 'Bestätigungsmail konnte nicht verschickt werden');
    return false;
  }
}

/** Jetzt laut Datenbank; für Antworten. */
export async function nowIso(db: Db): Promise<string> {
  return (await readGameNow(db)).toISOString();
}
