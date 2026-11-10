import type { ServerConfig } from '../../infra/config.ts';
import type { MatchEngineContext } from './engine.ts';

/** Was die Partie aus der Serverkonfiguration braucht. */
export interface MatchContext extends MatchEngineContext {
  /** Testpartien mit Bots: überall außer in Produktion (ADR-048). */
  readonly testMatchesEnabled: boolean;
}

export function matchContextFrom(config: ServerConfig): MatchContext {
  return {
    rngSecret: config.rngSecret,
    rngKeyId: config.rngKeyId,
    allowFixtures: config.appEnv === 'local' || config.appEnv === 'test',
    testMatchesEnabled: config.appEnv !== 'production',
  };
}
