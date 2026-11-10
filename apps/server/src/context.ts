import type { Db } from '@rdw/db';
import type { ServerConfig } from './infra/config.ts';
import type { ThrottleOptions } from './modules/identity/throttle.ts';

/** Abhängigkeiten der Routen; Tests setzen eigene Datenbank und Konfiguration ein. */
export interface AppContext {
  readonly db: Db;
  readonly config: ServerConfig;
  /** Grenzen der Anmeldebremse; Tests setzen eigene Werte und eine eigene Uhr. */
  readonly loginThrottle?: ThrottleOptions;
}
