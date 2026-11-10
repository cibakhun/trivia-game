import {
  DEFAULT_CAPITAL_RULES,
  capitalRules,
  capitalRulesSchema,
  type CapitalRulesConfig,
  type RulesConfig,
} from '@rdw/protocol';
import { z } from 'zod';

/**
 * Regelwerte, die eine Belagerung bei ihrer Anlage kopiert (`sieges.rules_snapshot`), damit
 * spätere Regeländerungen nicht rückwirkend greifen (GAME_RULES §10).
 */

const duration = z.number().int().min(0);
const count = z.number().int().min(0);

export const siegeRulesSnapshotSchema = z.object({
  rulesId: z.string(),
  configHash: z.string(),
  quiz: z.object({
    triviaTimeLimit: duration,
    estimateTimeLimit: duration,
    latencyAllowanceCapMs: duration,
  }),
  defense: z.object({ settleGrace: duration }),
  /**
   * PvP-Werte (seit Phase 2): Fristen und Verteidigungspunkte. Belagerungen von vorher waren nur
   * PvE und tragen den Abschnitt nicht (`pvpOf`).
   */
  pvp: z
    .object({
      baseDeadline: duration,
      maxDeadline: duration,
      startBuffer: duration,
      pointsForDefending: count,
      pointsBonusCorrect: count,
      pointsPairLimitPerDay: count,
    })
    .optional(),
  protection: z.object({
    afterConquest: duration,
    newPlayerUntilRegions: z.number().int().min(1).nullable(),
  }),
  /** Seit Migration 0009; ältere Belagerungen nehmen die Eternal-Standardwerte (`capitalOf`). */
  capital: capitalRulesSchema.optional(),
});
export type SiegeRulesSnapshot = z.infer<typeof siegeRulesSnapshotSchema>;

export function makeSnapshot(
  rules: RulesConfig,
  rulesId: string,
  configHash: string,
): SiegeRulesSnapshot {
  return {
    rulesId,
    configHash,
    quiz: { ...rules.quiz },
    defense: { settleGrace: rules.defense.settleGrace },
    pvp: {
      baseDeadline: rules.defense.baseDeadline,
      maxDeadline: rules.defense.maxDeadline,
      startBuffer: rules.defense.startBuffer,
      pointsForDefending: rules.defense.pointsForDefending,
      pointsBonusCorrect: rules.defense.pointsBonusCorrect,
      pointsPairLimitPerDay: rules.defense.pointsPairLimitPerDay,
    },
    protection: {
      afterConquest: rules.protection.afterConquest,
      newPlayerUntilRegions: rules.protection.newPlayer.untilRegions,
    },
    capital: capitalRules(rules),
  };
}

/**
 * Hauptstadt-Regeln einer Belagerung. Belagerungen vor Migration 0009 tragen keine; sie laufen
 * höchstens Minuten, und bis dahin gab es nur Eternal-Testwelten.
 */
export function capitalOf(snapshot: SiegeRulesSnapshot): CapitalRulesConfig {
  return snapshot.capital ?? { ...DEFAULT_CAPITAL_RULES.ETERNAL };
}

export type PvpSnapshot = NonNullable<SiegeRulesSnapshot['pvp']>;

/** PvP-Werte einer Belagerung; jede PvP-Belagerung trägt sie seit ihrer Anlage. */
export function pvpOf(snapshot: SiegeRulesSnapshot): PvpSnapshot {
  if (!snapshot.pvp) throw new Error('Regelkopie ohne PvP-Werte');
  return snapshot.pvp;
}

export function parseSnapshot(value: unknown): SiegeRulesSnapshot {
  return siegeRulesSnapshotSchema.parse(value);
}
