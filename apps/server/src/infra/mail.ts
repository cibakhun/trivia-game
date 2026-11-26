import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyBaseLogger } from 'fastify';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Mailversand (ADR-086). Der Server schickt bisher nur Bestätigungslinks für die E-Mail-Adresse.
 *
 * - `outbox` (Vorgabe, lokal und auf dem PC): Jede Mail landet als Textdatei im Ordner
 *   `mail-ausgang/` des Repositorys (von git ausgeschlossen), der Link steht zusätzlich im Log. Es
 *   geht nichts hinaus; darum löscht die Kontopflege dann auch keine unbestätigten Konten.
 * - `smtp`: Versand über einen SMTP-Zugang (`SMTP_URL`, `MAIL_FROM`), etwa ein Mailkonto mit
 *   App-Passwort oder einen Versanddienst. Nur damit gilt die 30-Tage-Frist.
 *
 * Zugangsdaten stehen nur in der Umgebung und erscheinen in keinem Log.
 */

export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  /** Erreichen Mails ihren Empfänger? Nur dann droht unbestätigten Konten die Löschung. */
  readonly delivers: boolean;
  send(mail: Mail): Promise<void>;
}

/** Ordner für Mails im Modus `outbox`: `<Repository>/mail-ausgang`. */
export const DEFAULT_OUTBOX_DIR = fileURLToPath(
  new URL('../../../../mail-ausgang/', import.meta.url),
);

/** Dateiname aus Zeit und Empfänger, ohne Zeichen, die Windows nicht mag. */
export function outboxFileName(at: Date, to: string): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  const who = to.replace(/[^A-Za-z0-9@._-]/g, '_').slice(0, 80);
  return `${stamp}_${who}.txt`;
}

export class OutboxMailer implements Mailer {
  readonly delivers = false;

  constructor(
    private readonly dir: string,
    private readonly log: Pick<FastifyBaseLogger, 'info'> | null,
  ) {}

  async send(mail: Mail): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = `${this.dir.replace(/[\\/]$/, '')}/${outboxFileName(new Date(), mail.to)}`;
    const body = `An: ${mail.to}\nBetreff: ${mail.subject}\n\n${mail.text}\n`;
    await writeFile(file, body, 'utf8');
    // Ohne echten Versand muss man den Link finden können: Er steht in der Datei und hier
    this.log?.info({ to: mail.to, file }, `Mail nicht verschickt (Ausgang): ${mail.subject}`);
  }
}

export class SmtpMailer implements Mailer {
  readonly delivers = true;
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}

/** Für Tests: hält die Mails fest; `delivers` stellt der Test ein. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  failNext = false;

  constructor(public delivers = true) {}

  async send(mail: Mail): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Versand fehlgeschlagen (Test)');
    }
    this.sent.push(mail);
    await Promise.resolve();
  }

  /** Letzte Mail an diese Adresse. */
  lastTo(to: string): Mail | undefined {
    return this.sent.findLast((mail) => mail.to.toLowerCase() === to.toLowerCase());
  }
}

export interface MailConfig {
  readonly transport: 'outbox' | 'smtp';
  readonly outboxDir: string;
  /** Nur bei `smtp`. */
  readonly smtpUrl: string | null;
  readonly from: string | null;
}

export function createMailer(
  config: MailConfig,
  log: Pick<FastifyBaseLogger, 'info'> | null,
): Mailer {
  if (config.transport === 'smtp' && config.smtpUrl && config.from) {
    return new SmtpMailer(config.smtpUrl, config.from);
  }
  return new OutboxMailer(config.outboxDir, log);
}
