import { MINUTE_MS } from '@rdw/protocol';
import { ApiError } from '../../infra/errors.ts';

/**
 * Anmeldebremse (SECURITY.md §2, ADR-043): Fehlversuche je Benutzername und je IP-Adresse in
 * einem festen Zeitfenster. Ist eine Grenze erreicht, wird die Anmeldung bis zum Ende des
 * Fensters mit `RATE_LIMITED` abgelehnt, ohne das Passwort zu prüfen. Ein Erfolg setzt den
 * Zähler des Namens zurück.
 *
 * Der Zustand liegt im Speicher des api-Prozesses: Es gibt nur einen, und so speichert die
 * Datenbank keine IP-Adressen. Mit mehreren api-Prozessen (Paket 4) wandert er in die Datenbank.
 * Hinter dem Vite-Proxy haben alle Anfragen dieselbe Adresse; die IP-Grenze ist deshalb großzügig.
 */

export interface ThrottleLimit {
  readonly failures: number;
  readonly windowMs: number;
}

export interface ThrottleOptions {
  readonly perName: ThrottleLimit;
  readonly perAddress: ThrottleLimit;
  /** Obergrenze der gespeicherten Fenster (Standard `MAX_WINDOWS`). */
  readonly maxWindows?: number;
  readonly now?: () => number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  perName: { failures: 10, windowMs: 15 * MINUTE_MS },
  perAddress: { failures: 100, windowMs: 15 * MINUTE_MS },
};

interface Window {
  count: number;
  readonly startedAt: number;
}

/** Ab dieser Zahl von Einträgen werden abgelaufene Fenster beim nächsten Aufruf entfernt. */
const PRUNE_THRESHOLD = 10_000;

/**
 * Höchstens so viele Fenster (je Name und je Adresse zusammen, grob 20 MB). Fehlversuche von sehr
 * vielen Adressen mit immer neuen Namen könnten den Speicher sonst innerhalb eines Fensters
 * füllen. Darüber fallen die ältesten Fenster weg: Eine Flut kann so einzelne Zähler
 * zurücksetzen, aber den Prozess nicht erschöpfen.
 */
export const MAX_WINDOWS = 100_000;

export class LoginThrottle {
  /** In Einfügereihenfolge: vorne stehen die ältesten Fenster. */
  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;
  private readonly maxWindows: number;

  constructor(private readonly options: ThrottleOptions = DEFAULT_THROTTLE) {
    this.now = options.now ?? Date.now;
    this.maxWindows = options.maxWindows ?? MAX_WINDOWS;
  }

  /** Zahl der gespeicherten Fenster (für Tests). */
  get size(): number {
    return this.windows.size;
  }

  /** Lehnt mit `RATE_LIMITED` ab, wenn Name oder Adresse gesperrt sind. */
  assertAllowed(name: string, address: string): void {
    const now = this.now();
    if (this.windows.size > PRUNE_THRESHOLD) this.prune(now);
    const until = Math.max(
      this.blockedUntil(nameKey(name), this.options.perName, now),
      this.blockedUntil(addressKey(address), this.options.perAddress, now),
    );
    if (until > now) {
      throw new ApiError(429, 'RATE_LIMITED', 'Zu viele Fehlversuche, bitte später erneut', {
        retryAfterMs: until - now,
      });
    }
  }

  recordFailure(name: string, address: string): void {
    const now = this.now();
    this.count(nameKey(name), this.options.perName, now);
    this.count(addressKey(address), this.options.perAddress, now);
  }

  recordSuccess(name: string): void {
    this.windows.delete(nameKey(name));
  }

  private blockedUntil(key: string, limit: ThrottleLimit, now: number): number {
    const window = this.windows.get(key);
    if (!window || now >= window.startedAt + limit.windowMs) return 0;
    return window.count >= limit.failures ? window.startedAt + limit.windowMs : 0;
  }

  private count(key: string, limit: ThrottleLimit, now: number): void {
    const window = this.windows.get(key);
    if (!window || now >= window.startedAt + limit.windowMs) {
      // Neu einfügen, damit die Reihenfolge der Map dem Alter des Fensters folgt
      this.windows.delete(key);
      this.windows.set(key, { count: 1, startedAt: now });
      if (this.windows.size > this.maxWindows) this.evict(now);
    } else {
      window.count += 1;
    }
  }

  private evict(now: number): void {
    this.prune(now);
    for (const key of this.windows.keys()) {
      if (this.windows.size <= this.maxWindows) break;
      this.windows.delete(key);
    }
  }

  private prune(now: number): void {
    const longest = Math.max(this.options.perName.windowMs, this.options.perAddress.windowMs);
    for (const [key, window] of this.windows) {
      if (now >= window.startedAt + longest) this.windows.delete(key);
    }
  }
}

/** Namen ohne Rücksicht auf Groß- und Kleinschreibung, wie die Datenbank (citext). */
function nameKey(name: string): string {
  return `n:${name.normalize('NFC').toLowerCase()}`;
}

function addressKey(address: string): string {
  return `a:${address}`;
}
