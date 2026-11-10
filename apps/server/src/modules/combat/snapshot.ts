import type { RulesConfig } from '@rdw/protocol';
import { z } from 'zod';

/**
 * Regelwerte, die eine Belagerung bei ihrer Anlage kopiert (`sieges.rules_snapshot`), damit
 * spätere Regeländerungen nicht rückwirkend greifen (GAME_RULES §10).
 */

const duration = z.number().int().min(0);

export const siegeRulesSnapshotSchema = z.object({
  rulesId: z.string(),
  configHash: z.string(),
  quiz: z.object({
    triviaTimeLimit: duration,
    estimateTimeLimit: duration,
    latencyAllowanceCapMs: duration,
  }),
  defense: z.object({ settleGrace: duration }),
  protection: z.object({
    afterConquest: duration,
    newPlayerUntilRegions: z.number().int().min(1).nullable(),
  }),
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
    protection: {
      afterConquest: rules.protection.afterConquest,
      newPlayerUntilRegions: rules.protection.newPlayer.untilRegions,
    },
  };
}

export function parseSnapshot(value: unknown): SiegeRulesSnapshot {
  return siegeRulesSnapshotSchema.parse(value);
}
