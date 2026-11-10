import type { Db } from '@rdw/db';
import type { ServerConfig } from './infra/config.ts';

/** Abhängigkeiten der Routen; Tests setzen eigene Datenbank und Konfiguration ein. */
export interface AppContext {
  readonly db: Db;
  readonly config: ServerConfig;
}
