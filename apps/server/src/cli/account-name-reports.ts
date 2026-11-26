import { createDb, createPool, parseDbEnv } from '@rdw/db';
import { decideName, listOpenNameReports } from '../modules/identity/name-reports.ts';

/**
 * Aufruf (O-48, ADR-086):
 * - `pnpm account:name-reports` listet offene Meldungen je Konto: Name jetzt, gemeldete Namen,
 *   wie viele Spieler gemeldet haben, erste und letzte Meldung.
 * - `pnpm account:name-reports --block=NAME` sperrt die gemeldeten Namen dieses Kontos für alle.
 *   Trägt es einen davon noch, muss sich der Spieler einen neuen Namen geben, bevor er wieder eine
 *   Partie eröffnet oder einer beitritt. Die Spielleitung benennt niemanden selbst um.
 * - `pnpm account:name-reports --dismiss=NAME` lässt den Namen stehen und erledigt die Meldungen.
 *
 * NAME ist der Name von jetzt oder ein gemeldeter Name, in beliebiger Schreibweise. In Produktion
 * nur die Liste, bis Entscheidungen der Spielleitung in `audit_events` protokolliert werden.
 */
const USAGE = 'pnpm account:name-reports [--block=NAME | --dismiss=NAME]';

type Args =
  { readonly action: 'LIST' } | { readonly action: 'BLOCK' | 'DISMISS'; readonly name: string };

function parseNameReportArgs(argv: readonly string[]): Args | string {
  if (argv.length === 0) return { action: 'LIST' };
  if (argv.length > 1) return argv.slice(1).join(' ');
  const [arg = ''] = argv;
  for (const [flag, action] of [
    ['--block=', 'BLOCK'],
    ['--dismiss=', 'DISMISS'],
  ] as const) {
    if (arg.startsWith(flag) && arg.length > flag.length) {
      return { action, name: arg.slice(flag.length).normalize('NFC').trim() };
    }
  }
  return arg;
}

const reportCount = (n: number) => `${n} ${n === 1 ? 'Meldung' : 'Meldungen'}`;

const when = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
});

async function main(): Promise<void> {
  const args = parseNameReportArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(`Ungültige Argumente: ${args} (${USAGE})`);
    process.exitCode = 2;
    return;
  }
  const env = parseDbEnv(process.env);
  if (args.action !== 'LIST' && env.APP_ENV === 'production') {
    console.error(
      'Abbruch: In Produktion nur die Liste, bis Entscheidungen in audit_events protokolliert werden.',
    );
    process.exitCode = 2;
    return;
  }
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: 1,
    applicationName: 'rdw-name-reports',
  });
  const db = createDb(pool);
  try {
    console.log(`Umgebung: ${env.APP_ENV}`);
    if (args.action === 'LIST') {
      const reports = await listOpenNameReports(db);
      if (reports.length === 0) {
        console.log('Keine offenen Meldungen.');
        return;
      }
      for (const report of reports) {
        const now = report.currentName ?? '(kein Name)';
        const names = report.reportedNames.join(', ');
        console.log(
          `${now}${report.blocked ? ' [gesperrt]' : ''}: gemeldet als ${names}, ` +
            `${report.reporters} Spieler, ${when.format(report.firstAt)} bis ${when.format(report.lastAt)}`,
        );
      }
      console.log(`\nEntscheiden: ${USAGE}`);
      return;
    }
    const result = await decideName(db, args.name, args.action);
    if (!result) {
      console.error(`Zu „${args.name}“ gibt es keine offene Meldung.`);
      process.exitCode = 1;
      return;
    }
    if (args.action === 'BLOCK') {
      console.log(
        `Gesperrt: ${result.blockedNames.join(', ')} (${reportCount(result.resolved)} erledigt).`,
      );
      console.log(
        result.mustRename
          ? 'Der Spieler muss sich einen neuen Namen geben, bevor er wieder spielt.'
          : 'Der Spieler trägt den Namen nicht mehr; er bleibt für alle gesperrt.',
      );
    } else {
      console.log(`Freigegeben, ${reportCount(result.resolved)} erledigt.`);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
