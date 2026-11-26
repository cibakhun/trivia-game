import type { MeResponse } from '@rdw/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiRequestError } from './api/client.ts';

/**
 * Sitzung des Spielers: Gast- oder gesichertes Konto (Cookie, API.md §1) und Profil mit Reichen.
 * Der Zustand wird nach jeder Aktion neu vom Server gelesen; der Client hält keine eigene Wahrheit.
 */

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'anonymous' }
  | { readonly status: 'ready'; readonly me: MeResponse }
  | { readonly status: 'error'; readonly error: unknown };

/**
 * Einmalige Nachricht über einem Bildschirm nach einem Kontowechsel (ADR-086): Löschantrag
 * gestellt (`deletesAt` = Löschung; `null` = schon gelöscht) oder mit der Anmeldung aufgehoben.
 */
export type SessionFlash =
  | { readonly kind: 'deletionRequested'; readonly deletesAt: string | null }
  | { readonly kind: 'deletionCancelled' };

export interface ReloadOptions {
  /**
   * Nach einem Wechsel des Kontos (Anmelden, Sichern) ist der bisherige Stand falsch: Ein
   * vorübergehender Fehler beim Nachladen ersetzt ihn dann, statt ihn stehen zu lassen.
   */
  readonly discardStale?: boolean;
}

interface SessionValue {
  readonly state: SessionState;
  readonly reload: (options?: ReloadOptions) => Promise<MeResponse | null>;
  /** Läuft gerade ein Kontowechsel (Gast, Anmelden, Abmelden)? Solange ruhen die Knöpfe dafür. */
  readonly switching: boolean;
  readonly startGuest: () => Promise<void>;
  /** Anmelden mit Benutzername und Passwort; eine laufende Sitzung wird ersetzt. */
  readonly login: (username: string, password: string) => Promise<void>;
  readonly logout: () => Promise<void>;
  /** Löschantrag (O-47): Danach gibt es keine Sitzung mehr; Gäste ohne Passwort. */
  readonly deleteAccount: (password: string | null) => Promise<void>;
  readonly flash: SessionFlash | null;
  readonly dismissFlash: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Fehler, nach denen ein späterer Versuch gelingen kann: kein Netz, Überlast, Serverfehler. */
function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  return error.status === 429 || error.status >= 500;
}

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [flash, setFlash] = useState<SessionFlash | null>(null);

  const reload = useCallback(async (options: ReloadOptions = {}): Promise<MeResponse | null> => {
    try {
      const status = await api.bootstrap();
      if (!status.authenticated) {
        setState({ status: 'anonymous' });
        return null;
      }
      const me = await api.me();
      setState({ status: 'ready', me });
      return me;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        // Sitzung abgelaufen oder widerrufen: kein Profil mehr zeigen
        setState({ status: 'anonymous' });
      } else {
        // Ein vorübergehender Fehler (Netz, Server) beim 30-s-Abgleich verwirft den bekannten
        // Stand nicht; nur ohne geladenen Stand wird er zum Zustand. Andere API-Fehler ersetzen
        // den Stand, damit kein veraltetes Profil stehen bleibt.
        setState((previous) =>
          previous.status === 'ready' && isTransient(error) && !options.discardStale
            ? previous
            : { status: 'error', error },
        );
      }
      return null;
    }
  }, []);

  // Kontowechsel laufen nacheinander: Eine langsame Gastanmeldung darf eine spätere Anmeldung
  // nicht überschreiben, denn beide ersetzen das Sitzungscookie.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const [switching, setSwitching] = useState(false);
  const switchAccount = useCallback(
    async (change: () => Promise<unknown>) => {
      pending.current += 1;
      setSwitching(true);
      const run = queue.current
        .catch(() => undefined)
        .then(async () => {
          await change();
          await reload({ discardStale: true });
        });
      queue.current = run;
      try {
        await run;
      } finally {
        pending.current -= 1;
        if (pending.current === 0) setSwitching(false);
      }
    },
    [reload],
  );

  const startGuest = useCallback(() => switchAccount(() => api.guest()), [switchAccount]);

  const login = useCallback(
    (username: string, password: string) =>
      switchAccount(async () => {
        const result = await api.login({ username, password });
        // Wer sich in den 7 Tagen nach einem Löschantrag anmeldet, behält sein Konto
        setFlash(result.deletionCancelled ? { kind: 'deletionCancelled' } : null);
      }),
    [switchAccount],
  );

  const logout = useCallback(() => switchAccount(() => api.logout()), [switchAccount]);

  const deleteAccount = useCallback(
    (password: string | null) =>
      switchAccount(async () => {
        const result = await api.deleteAccount(password);
        setFlash({ kind: 'deletionRequested', deletesAt: result.deletesAt });
      }),
    [switchAccount],
  );

  const dismissFlash = useCallback(() => setFlash(null), []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <SessionContext.Provider
      value={{
        state,
        reload,
        switching,
        startGuest,
        login,
        logout,
        deleteAccount,
        flash,
        dismissFlash,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession außerhalb von SessionProvider');
  return value;
}
