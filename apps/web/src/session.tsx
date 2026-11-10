import type { MeResponse } from '@rdw/protocol';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api/client.ts';

/**
 * Sitzung des Spielers: Gastkonto (Cookie, API.md §1) und Profil mit Reichen. Der Zustand wird
 * nach jeder Aktion neu vom Server gelesen; der Client hält keine eigene Wahrheit.
 */

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'anonymous' }
  | { readonly status: 'ready'; readonly me: MeResponse }
  | { readonly status: 'error'; readonly error: unknown };

interface SessionValue {
  readonly state: SessionState;
  readonly reload: () => Promise<MeResponse | null>;
  readonly startGuest: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const reload = useCallback(async (): Promise<MeResponse | null> => {
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
      setState({ status: 'error', error });
      return null;
    }
  }, []);

  const startGuest = useCallback(async () => {
    await api.guest();
    await reload();
  }, [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <SessionContext.Provider value={{ state, reload, startGuest }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession außerhalb von SessionProvider');
  return value;
}
