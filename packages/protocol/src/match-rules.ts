import { z } from 'zod';
import { SECOND_MS } from './rules-config.ts';

/**
 * Regeln einer rundenbasierten Partie (docs/MATCH_RULES.md, ADR-047). Alle Werte sind
 * Standardannahmen [E]; sie liegen hier, damit sie sich ohne Umbau ändern lassen. Dauern sind
 * ganzzahlige Millisekunden.
 */

/**
 * Feste Karten der Partie. Welche gespielt wird, richtet sich nach der Spielerzahl
 * (`MATCH_MAP_BY_SEATS`, ADR-052).
 */
export const MATCH_MAP_IDS = ['WENDELMARK', 'KERNMARK'] as const;
export const matchMapIdSchema = z.enum(MATCH_MAP_IDS);
export type MatchMapId = z.infer<typeof matchMapIdSchema>;

const timerMs = z
  .number()
  .int()
  .min(SECOND_MS)
  .max(10 * 60 * SECOND_MS);

/** Kurze Pause der Ansage; 0 schaltet sie ab. */
const pauseMs = z
  .number()
  .int()
  .min(0)
  .max(30 * SECOND_MS);

export const matchRulesSchema = z
  .object({
    schemaVersion: z.literal(1),
    map: matchMapIdSchema,
    /**
     * Plätze je Partie: zwei (Kernmark) oder drei (Wendelmark). Freie Plätze kann der Gastgeber
     * mit Bots füllen (ADR-052).
     */
    seats: z.union([z.literal(2), z.literal(3)]),
    capital: z
      .object({
        /** Leben der Hauptstadt; der Sieg, der das letzte nimmt, übernimmt das Reich (ADR-037). */
        lives: z.number().int().min(1).max(10),
        /** Mindestabstand zwischen zwei Hauptstädten in Feldern (2 = ein Feld dazwischen). */
        minDistance: z.number().int().min(1).max(5),
      })
      .strict(),
    landGrab: z
      .object({
        /**
         * Regionen, die der Erste, Zweite, Dritte einer Landnahmerunde wählt. Länge = Plätze,
         * nicht steigend, mindestens einer wählt.
         */
        picksByPlace: z.array(z.number().int().min(0).max(5)).min(1).max(10),
      })
      .strict(),
    campaign: z
      .object({
        /** Feldzugrunden; in jeder greift jedes lebende Reich einmal an. */
        rounds: z.number().int().min(1).max(10),
      })
      .strict(),
    values: z
      .object({
        region: z.number().int().min(1).max(10_000),
        capital: z.number().int().min(1).max(10_000),
        /** Wertzuwachs einer Region je erfolgreicher Verteidigung. */
        defenseBonus: z.number().int().min(0).max(10_000),
      })
      .strict(),
    timers: z
      .object({
        triviaMs: timerMs,
        estimateMs: timerMs,
        /** Wahl von Hauptstadt, Region oder Angriffsziel; danach wählt der Server. */
        pickMs: timerMs,
        /** Anzeige der Auflösung nach jeder Frage. */
        revealMs: timerMs,
        /**
         * Ansage eines Duells (ADR-053): So lange zeigt die Karte, wer wen wo angreift, bevor die
         * Frage kommt. Fehlt in Partien, die vor ADR-053 gestartet wurden; dann gibt es keine.
         */
        announceMs: pauseMs.optional(),
        /**
         * So lange bleibt eine Wahl stehen, bevor ein anderer Sitz wählt oder die Schätzfrage der
         * Landnahme kommt (ADR-053). Wählt derselbe Mensch gleich noch einmal, entfällt die Pause.
         */
        pickShowMs: pauseMs.optional(),
        /** `cap` aus QUIZ_ENGINE §6.2. */
        latencyAllowanceCapMs: z
          .number()
          .int()
          .min(0)
          .max(10 * SECOND_MS),
      })
      .strict(),
  })
  .strict()
  .superRefine((rules, ctx) => {
    const picks = rules.landGrab.picksByPlace;
    if (picks.length !== rules.seats) {
      ctx.addIssue({
        code: 'custom',
        path: ['landGrab', 'picksByPlace'],
        message: 'Je Platz genau ein Wert',
      });
    }
    if (picks.some((value, i) => i > 0 && value > (picks[i - 1] ?? 0))) {
      ctx.addIssue({
        code: 'custom',
        path: ['landGrab', 'picksByPlace'],
        message: 'Ein besserer Platz wählt nie weniger Regionen',
      });
    }
    if ((picks[0] ?? 0) < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['landGrab', 'picksByPlace'],
        message: 'Der Erste muss mindestens eine Region wählen',
      });
    }
  });
export type MatchRules = z.infer<typeof matchRulesSchema>;

/**
 * Standardwerte aus dem Plan vom 2026-11-10 für drei Spieler (ADR-047); für zwei über
 * `matchRulesForSeats`. Nach dem ersten Spieltest nachjustieren.
 */
export const DEFAULT_MATCH_RULES: MatchRules = Object.freeze({
  schemaVersion: 1,
  map: 'WENDELMARK',
  seats: 3,
  capital: { lives: 3, minDistance: 2 },
  landGrab: { picksByPlace: [2, 1, 0] },
  campaign: { rounds: 4 },
  values: { region: 100, capital: 300, defenseBonus: 50 },
  timers: {
    triviaMs: 15 * SECOND_MS,
    estimateMs: 20 * SECOND_MS,
    pickMs: 10 * SECOND_MS,
    revealMs: 6 * SECOND_MS,
    announceMs: 2500,
    pickShowMs: 1200,
    latencyAllowanceCapMs: 500,
  },
});

export const MATCH_SEAT_COUNTS = [2, 3] as const;
export type MatchSeatCount = (typeof MATCH_SEAT_COUNTS)[number];

/**
 * Landnahme-Wahlen je Spielerzahl [E]: zu dritt 2, 1, 0 (Wendelmark: sieben Runden); zu zweit 2, 1
 * (Kernmark: vier volle Runden und eine fünfte mit den letzten beiden Regionen).
 */
export const LAND_GRAB_PICKS_BY_SEATS: Readonly<Record<MatchSeatCount, readonly number[]>> =
  Object.freeze({ 2: [2, 1], 3: [2, 1, 0] });

/**
 * Karte je Spielerzahl [E] (ADR-052): acht Regionen je Reich. Zu dritt die ganze Wendelmark
 * (24 Regionen), zu zweit ihr Kernland (16 Regionen).
 */
export const MATCH_MAP_BY_SEATS: Readonly<Record<MatchSeatCount, MatchMapId>> = Object.freeze({
  2: 'KERNMARK',
  3: 'WENDELMARK',
});

/** Regeln für eine Partie mit `seats` Spielern: Spielerzahl, Karte und Landnahme-Wahlen ersetzt. */
export function matchRulesForSeats(rules: MatchRules, seats: MatchSeatCount): MatchRules {
  return {
    ...rules,
    seats,
    map: MATCH_MAP_BY_SEATS[seats],
    landGrab: { picksByPlace: [...LAND_GRAB_PICKS_BY_SEATS[seats]] },
  };
}

/** Verkürzte Zeiten für Tests und schnelle Spieltests; Regeln sonst gleich. */
export const PLAYTEST_MATCH_RULES: MatchRules = Object.freeze({
  ...DEFAULT_MATCH_RULES,
  timers: {
    triviaMs: 8 * SECOND_MS,
    estimateMs: 10 * SECOND_MS,
    pickMs: 5 * SECOND_MS,
    revealMs: 2 * SECOND_MS,
    announceMs: 600,
    pickShowMs: 300,
    latencyAllowanceCapMs: 500,
  },
});
