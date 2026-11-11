import type { ServerConfig } from '../../infra/config.ts';
import type { MatchEngineContext } from './engine.ts';

/** Was die Partie aus der Serverkonfiguration braucht. */
export interface MatchContext extends MatchEngineContext {
  /** Testpartien mit Bots: überall außer in Produktion (ADR-048). */
  readonly testMatchesEnabled: boolean;
  /**
   * Partien mit Ausbau (MATCH_RULES §11): überall außer in Produktion, bis der Browser sie zeigen
   * kann und der Spieltest sie freigibt (ADR-058).
   */
  readonly realmMatchesEnabled: boolean;
  /**
   * So viele Wissensfragen braucht eine Kategorie, um auf dem Glücksrad zu stehen (MATCH_RULES
   * §11.6): 20 [E], für den ersten Spieltest 10; lokal und in Tests 1, weil die Testfragen je
   * Kategorie nur wenige sind. `REALM_MIN_CATEGORY_QUESTIONS` überschreibt den Wert.
   */
  readonly realmMinCategoryQuestions: number;
}

/** Bedarf an Wissensfragen je Kategorie des Glücksrads [E]. */
export const REALM_MIN_CATEGORY_QUESTIONS = 20;

export function matchContextFrom(config: ServerConfig): MatchContext {
  const allowFixtures = config.appEnv === 'local' || config.appEnv === 'test';
  return {
    rngSecret: config.rngSecret,
    rngKeyId: config.rngKeyId,
    allowFixtures,
    testMatchesEnabled: config.appEnv !== 'production',
    realmMatchesEnabled: config.appEnv !== 'production',
    realmMinCategoryQuestions:
      config.realmMinCategoryQuestions ?? (allowFixtures ? 1 : REALM_MIN_CATEGORY_QUESTIONS),
  };
}
