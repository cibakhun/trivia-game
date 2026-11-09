import { z } from 'zod';

/**
 * Versionierte Regelkonfiguration einer Welt (`world_rules.config`).
 *
 * Schlüssel und Standardwerte folgen docs/GAME_RULES.md §10. Alle Dauern sind ganzzahlige
 * Millisekunden; Schlüssel ohne Einheitensuffix (z. B. `defense.baseDeadline`) tragen trotzdem
 * Millisekunden, damit die Namen mit der Dokumentation übereinstimmen.
 */

export const WORLD_MODES = ['ETERNAL', 'WEEKLY', 'DAILY'] as const;
export const worldModeSchema = z.enum(WORLD_MODES);
export type WorldMode = z.infer<typeof worldModeSchema>;

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Obergrenze für jede Dauer: schützt vor Tippfehlern wie Sekunden statt Millisekunden. */
const MAX_DURATION_MS = 366 * DAY_MS;

const durationMs = z.number().int().min(0).max(MAX_DURATION_MS);
const positiveDurationMs = durationMs.min(1);
const count = z.number().int().min(0).max(1_000_000);
const positiveCount = count.min(1);

/** Kontingent in einem gleitenden Fenster; `count: null` bedeutet unbegrenzt. */
export const rateBudgetSchema = z
  .object({
    count: positiveCount.nullable(),
    windowMs: positiveDurationMs,
  })
  .strict();
export type RateBudget = z.infer<typeof rateBudgetSchema>;

const defenseSchema = z
  .object({
    /** Frist ab Eröffnung einer PvP-Belagerung. */
    baseDeadline: positiveDurationMs,
    /** Obergrenze der Frist ab Eröffnung, auch mit Verlängerungen. */
    maxDeadline: positiveDurationMs,
    /** Zusätzliche Restzeit, die beim Beginn einer Verteidigung übrig sein muss. */
    startBuffer: durationMs,
    /** Technischer Abwicklungspuffer; verlängert keine Frist. */
    settleGrace: durationMs,
    pointsForDefending: count,
    pointsBonusCorrect: count,
    /** Höchstzahl punktbringender Verteidigungen je Reichspaar in 24 h. */
    pointsPairLimitPerDay: count,
  })
  .strict();

const quizSchema = z
  .object({
    triviaTimeLimit: positiveDurationMs,
    estimateTimeLimit: positiveDurationMs,
    /** `cap` aus QUIZ_ENGINE §6.2: höchstens anrechenbarer Netz- und Darstellungsanteil. */
    latencyAllowanceCapMs: z
      .number()
      .int()
      .min(0)
      .max(10 * SECOND_MS),
  })
  .strict();

const attackSchema = z
  .object({
    maxNewPvpSiegesPerAttacker: rateBudgetSchema,
    maxPvpAttemptsPerAttacker: rateBudgetSchema,
    maxOpenSiegesPerDefender: positiveCount,
    maxPveAttemptsPerPlayer: rateBudgetSchema,
  })
  .strict();

const protectionSchema = z
  .object({
    afterConquest: durationMs,
    /**
     * Anfängerschutz: endet nach `duration`, sobald das Reich `untilRegions` Regionen hat
     * (falls gesetzt) oder sobald es selbst einen Spieler angreift – was zuerst eintritt.
     */
    newPlayer: z
      .object({
        duration: durationMs,
        untilRegions: positiveCount.nullable(),
      })
      .strict(),
    respawn: durationMs,
    /**
     * Rangabstandsschutz: Ein Reich mit mindestens `factor`-mal so vielen Regionen darf ein Reich
     * mit weniger als `maxTargetRegions` Regionen nicht angreifen. `null` = Regel inaktiv.
     */
    rankGap: z
      .object({
        factor: z.number().min(1).max(1000),
        maxTargetRegions: positiveCount,
      })
      .strict()
      .nullable(),
  })
  .strict();

const itemsSchema = z.discriminatedUnion('enabled', [
  z
    .object({
      enabled: z.literal(true),
      inventoryCap: positiveCount,
      dropEligibleConquestsPerDay: count,
      regionRewardCooldown: durationMs,
      pairRewardLimitPerDay: count,
      pendingRewardExpiry: positiveDurationMs,
      autoUse: z.object({ triggerBeforeDeadline: durationMs }).strict(),
    })
    .strict(),
  z.object({ enabled: z.literal(false) }).strict(),
]);

const npcSchema = z
  .object({
    maxActionsPerFactionPerHour: count,
    maxOpenSiegesAgainstHumanKingdom: count,
  })
  .strict();

/**
 * Längste mögliche Dauer einer Herausforderung: Σ (Zeitlimit + cap) beider Schritte.
 * Dieselbe Formel steht in game-core (`maxChallengeDurationMs`); ein Test hält beide gleich.
 */
function challengeDurationMs(quiz: z.infer<typeof quizSchema>): number {
  return quiz.triviaTimeLimit + quiz.estimateTimeLimit + 2 * quiz.latencyAllowanceCapMs;
}

export const rulesConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: worldModeSchema,
    defense: defenseSchema,
    quiz: quizSchema,
    attack: attackSchema,
    protection: protectionSchema,
    items: itemsSchema,
    npc: npcSchema,
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const { defense, items, quiz, attack } = cfg;
    if (defense.maxDeadline < defense.baseDeadline) {
      ctx.addIssue({
        code: 'custom',
        path: ['defense', 'maxDeadline'],
        message: 'maxDeadline muss mindestens baseDeadline sein',
      });
    }
    if (!items.enabled && defense.maxDeadline !== defense.baseDeadline) {
      ctx.addIssue({
        code: 'custom',
        path: ['defense', 'maxDeadline'],
        message: 'Ohne Items gibt es keine Verlängerung: maxDeadline muss baseDeadline entsprechen',
      });
    }
    if (items.enabled && items.autoUse.triggerBeforeDeadline >= defense.baseDeadline) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', 'autoUse', 'triggerBeforeDeadline'],
        message: 'Auslösezeitpunkt muss innerhalb der Grundfrist liegen',
      });
    }
    const minWindow = challengeDurationMs(quiz) + defense.startBuffer;
    if (defense.baseDeadline < minWindow) {
      ctx.addIssue({
        code: 'custom',
        path: ['defense', 'baseDeadline'],
        message: `Grundfrist kürzer als eine vollständige Verteidigung (${minWindow} ms)`,
      });
    }
    const sieges = attack.maxNewPvpSiegesPerAttacker;
    const attempts = attack.maxPvpAttemptsPerAttacker;
    if (
      sieges.windowMs === attempts.windowMs &&
      attempts.count !== null &&
      (sieges.count === null || attempts.count < sieges.count)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['attack', 'maxPvpAttemptsPerAttacker', 'count'],
        message: 'Jede Belagerung braucht einen Versuch: Versuche ≥ Belagerungen',
      });
    }
  });

export type RulesConfig = z.infer<typeof rulesConfigSchema>;
export type DefenseRules = RulesConfig['defense'];
export type QuizRules = RulesConfig['quiz'];

/** Prüft eine Regelkonfiguration (z. B. aus `world_rules.config`); wirft bei Verstößen. */
export function parseRulesConfig(input: unknown): RulesConfig {
  return rulesConfigSchema.parse(input);
}

const day = (count: number): RateBudget => ({ count, windowMs: DAY_MS });

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Standardwerte je Modus aus docs/GAME_RULES.md §10 (Kennzeichnungen dort); unveränderlich. */
export const DEFAULT_RULES: Readonly<Record<WorldMode, RulesConfig>> = deepFreeze({
  ETERNAL: {
    schemaVersion: 1,
    mode: 'ETERNAL',
    defense: {
      baseDeadline: 24 * HOUR_MS,
      maxDeadline: 48 * HOUR_MS,
      startBuffer: 10 * SECOND_MS,
      settleGrace: 5 * SECOND_MS,
      pointsForDefending: 5,
      pointsBonusCorrect: 5,
      pointsPairLimitPerDay: 2,
    },
    quiz: {
      triviaTimeLimit: 20 * SECOND_MS,
      estimateTimeLimit: 30 * SECOND_MS,
      latencyAllowanceCapMs: 500,
    },
    attack: {
      maxNewPvpSiegesPerAttacker: day(3),
      maxPvpAttemptsPerAttacker: day(6),
      maxOpenSiegesPerDefender: 4,
      maxPveAttemptsPerPlayer: day(50),
    },
    protection: {
      afterConquest: 6 * HOUR_MS,
      newPlayer: { duration: 72 * HOUR_MS, untilRegions: 10 },
      respawn: 24 * HOUR_MS,
      rankGap: { factor: 4, maxTargetRegions: 15 },
    },
    items: {
      enabled: true,
      inventoryCap: 10,
      dropEligibleConquestsPerDay: 6,
      regionRewardCooldown: 24 * HOUR_MS,
      pairRewardLimitPerDay: 2,
      pendingRewardExpiry: 7 * DAY_MS,
      autoUse: { triggerBeforeDeadline: 6 * HOUR_MS },
    },
    npc: { maxActionsPerFactionPerHour: 2, maxOpenSiegesAgainstHumanKingdom: 1 },
  },
  WEEKLY: {
    schemaVersion: 1,
    mode: 'WEEKLY',
    defense: {
      baseDeadline: 4 * HOUR_MS,
      maxDeadline: 4 * HOUR_MS,
      startBuffer: 10 * SECOND_MS,
      settleGrace: 5 * SECOND_MS,
      pointsForDefending: 2,
      pointsBonusCorrect: 3,
      pointsPairLimitPerDay: 2,
    },
    quiz: {
      triviaTimeLimit: 20 * SECOND_MS,
      estimateTimeLimit: 30 * SECOND_MS,
      latencyAllowanceCapMs: 500,
    },
    attack: {
      maxNewPvpSiegesPerAttacker: day(6),
      maxPvpAttemptsPerAttacker: day(12),
      maxOpenSiegesPerDefender: 3,
      maxPveAttemptsPerPlayer: day(60),
    },
    protection: {
      afterConquest: 1 * HOUR_MS,
      newPlayer: { duration: 2 * HOUR_MS, untilRegions: null },
      respawn: 1 * HOUR_MS,
      rankGap: { factor: 4, maxTargetRegions: 10 },
    },
    items: { enabled: false },
    npc: { maxActionsPerFactionPerHour: 4, maxOpenSiegesAgainstHumanKingdom: 1 },
  },
  DAILY: {
    schemaVersion: 1,
    mode: 'DAILY',
    defense: {
      baseDeadline: 15 * MINUTE_MS,
      maxDeadline: 15 * MINUTE_MS,
      startBuffer: 10 * SECOND_MS,
      settleGrace: 5 * SECOND_MS,
      pointsForDefending: 2,
      pointsBonusCorrect: 3,
      pointsPairLimitPerDay: 2,
    },
    quiz: {
      triviaTimeLimit: 15 * SECOND_MS,
      estimateTimeLimit: 25 * SECOND_MS,
      latencyAllowanceCapMs: 500,
    },
    attack: {
      maxNewPvpSiegesPerAttacker: { count: 4, windowMs: HOUR_MS },
      maxPvpAttemptsPerAttacker: { count: 8, windowMs: HOUR_MS },
      maxOpenSiegesPerDefender: 2,
      maxPveAttemptsPerPlayer: { count: null, windowMs: HOUR_MS },
    },
    protection: {
      afterConquest: 5 * MINUTE_MS,
      newPlayer: { duration: 15 * MINUTE_MS, untilRegions: null },
      respawn: 10 * MINUTE_MS,
      rankGap: null,
    },
    items: { enabled: false },
    npc: { maxActionsPerFactionPerHour: 12, maxOpenSiegesAgainstHumanKingdom: 1 },
  },
});
