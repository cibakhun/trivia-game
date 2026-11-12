import { t } from '../i18n/i18n.ts';

/**
 * Meldung zu einem Fehler, der die Oberfläche angehalten hat (ADR-061): kurz genug zum Kopieren,
 * mit allem, was die Fehlersuche braucht (Fehler, Stelle im Code, Bauteil, Seite, Browser, Zeit).
 * Reine Ableitungen, damit sie testbar sind. Die Meldung bleibt im Browser; gesendet wird nichts.
 */

/** Wo und wann der Fehler auftrat. */
export interface CrashEnv {
  /** Pfad der Seite, ohne Adresse des Servers. */
  readonly path: string;
  /** Kennung des Browsers (`navigator.userAgent`). */
  readonly agent: string;
  /** Zeitpunkt als ISO-Text. */
  readonly at: string;
}

/**
 * Woran es vermutlich lag. `foreign-dom`: Etwas außerhalb des Spiels hat die Seite umgebaut, meist
 * die automatische Übersetzung des Browsers oder eine Erweiterung; React findet dann seine eigenen
 * Textstellen nicht mehr und der Browser meldet `NotFoundError`.
 */
export type CrashCause = 'foreign-dom' | 'unknown';

/** Zeilen von Stapel und Bauteilen, die die Meldung höchstens zeigt. */
const STACK_LINES = 8;

function nameOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && name !== '' ? name : null;
}

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return typeof error === 'string' ? error : String(error);
}

export function crashCause(error: unknown): CrashCause {
  return nameOf(error) === 'NotFoundError' ? 'foreign-dom' : 'unknown';
}

/** Die ersten Zeilen eines Stapels, ohne die Adresse des Servers und ohne Leerraum am Rand. */
function firstLines(text: string, skip: (line: string) => boolean): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/https?:\/\/[^/\s)]+\//g, ''))
    .filter((line) => line !== '' && !skip(line))
    .slice(0, STACK_LINES);
}

/**
 * Die Meldung als Text, Zeile für Zeile. `componentStack` ist der Weg durch die Bauteile, den
 * React beim Auffangen mitgibt; `null`, solange er noch nicht bekannt ist.
 */
export function crashReport(error: unknown, componentStack: string | null, env: CrashEnv): string {
  const name = nameOf(error);
  const message = messageOf(error);
  const headline = name && !message.startsWith(name) ? `${name}: ${message}` : message;
  const lines = [
    `${t('crash.report.time')}: ${env.at}`,
    `${t('crash.report.page')}: ${env.path}`,
    `${t('crash.report.browser')}: ${env.agent}`,
    `${t('crash.report.error')}: ${headline}`,
  ];
  const stack =
    typeof error === 'object' && error !== null ? (error as { stack?: unknown }).stack : null;
  if (typeof stack === 'string') {
    // Manche Browser wiederholen in der ersten Zeile des Stapels die Meldung. Ohne Meldung steht dort
    // nur der Name; am Ende vergleichen hieße dann, jede Zeile zu streichen
    const where = firstLines(
      stack,
      (line) => line === headline || (message === '' ? line === name : line.endsWith(message)),
    );
    if (where.length > 0) lines.push(`${t('crash.report.stack')}:`, ...where.map((l) => `  ${l}`));
  }
  if (componentStack) {
    const parts = firstLines(componentStack, () => false);
    if (parts.length > 0) lines.push(`${t('crash.report.parts')}:`, ...parts.map((l) => `  ${l}`));
  }
  return lines.join('\n');
}
