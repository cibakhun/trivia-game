import { createDb, createPool, parseDbEnv } from '@rdw/db';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { hashPassword } from '../modules/identity/passwords.ts';

/**
 * Aufruf: `pnpm account:reset-password --username=NAME`
 *
 * Setzt das Passwort eines gesicherten Kontos auf einen neuen Zufallswert, beendet alle seine
 * Sitzungen und gibt das neue Passwort einmal aus (ADR-043). Ersatz für die Wiederherstellung per
 * E-Mail, solange es keinen Mailversand gibt. In Produktion gesperrt, bis es `audit_events` gibt:
 * Eine Änderung an Zugangsdaten braucht dort einen Eintrag mit Akteur und Begründung (API.md §2.5);
 * `--production-approved` ändert daran nichts.
 */
const RESET_USAGE = 'pnpm account:reset-password --username=NAME';

function parseResetArgs(argv: readonly string[]): { username: string } | string {
  let username: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith('--username=') && username === null && arg.length > 11) {
      username = arg.slice(11);
    } else return arg;
  }
  return username === null ? '--username fehlt' : { username };
}

async function main(): Promise<void> {
  const args = parseResetArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(`Ungültige Argumente: ${args} (${RESET_USAGE})`);
    process.exitCode = 2;
    return;
  }
  const env = parseDbEnv(process.env);
  if (env.APP_ENV === 'production') {
    console.error(
      'Abbruch: In Produktion gesperrt, bis Änderungen an Zugangsdaten in audit_events protokolliert werden.',
    );
    process.exitCode = 2;
    return;
  }
  const password = randomBytes(15).toString('base64url');
  const passwordHash = await hashPassword(password);
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: 1,
    applicationName: 'rdw-account-reset',
  });
  const db = createDb(pool);
  try {
    const user = await db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable('users')
        .set({ password_hash: passwordHash })
        .where(sql<boolean>`username = ${args.username.normalize('NFC')}::citext`)
        .where('is_guest', '=', false)
        .where('deleted_at', 'is', null)
        // Mit Löschantrag meldet sich niemand an (SECURITY §5.2); neue Zugangsdaten nützen nichts
        .where('deletion_requested_at', 'is', null)
        .returning(['id', 'username'])
        .executeTakeFirst();
      if (row) await tx.deleteFrom('sessions').where('user_id', '=', row.id).execute();
      return row;
    });
    if (!user) {
      console.error(
        `Kein gesichertes Konto ohne Löschantrag mit dem Benutzernamen ${args.username}.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Umgebung: ${env.APP_ENV}`);
    console.log(
      `Konto ${user.username ?? args.username}: Passwort zurückgesetzt, alle Sitzungen beendet.`,
    );
    console.log(`Neues Passwort (nur jetzt sichtbar): ${password}`);
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
