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

const amount = z.number().int().min(0).max(100);

/** Preis in Brot und Baustoff. */
const costSchema = z.object({ bread: amount, material: amount }).strict();

/**
 * Ausbau der Partie mit Burgen, Dörfern, Armeen, Brot und Baustoff (docs/MATCH_RULES.md §11,
 * ADR-057, Konzept vom 2026-11-11, O-25 bis O-35). Nur Regeln mit diesem Abschnitt spielen den
 * Ausbau (`createRealm` in game-core); ohne ihn läuft die Partie wie bisher (`createMatch`).
 * Burgleben und Abstand der Burgen stehen in `capital`, Punktwerte in `values`.
 */
export const matchEconomySchema = z
  .object({
    /** Lieblingskategorien je Spieler; über sie wirken die Lose im Glücksrad. */
    favorites: z.number().int().min(1).max(11),
    /** Armeen jeder Startburg. */
    startArmies: z.number().int().min(0).max(20),
    /** Mindestabstand des Startdorfs zu fremden Gebäuden in Feldern. */
    villageMinDistance: z.number().int().min(1).max(5),
    /** Ertrag je Feldzugrunde: Feld ohne Gebäude, mit Dorf, mit Stadt (in seinem Rohstoff); Burg in beiden. */
    yields: z
      .object({
        plain: amount,
        village: amount,
        town: amount,
        castleBread: amount,
        castleMaterial: amount,
      })
      .strict(),
    /** So viel eines Rohstoffs kostet 1 vom anderen. */
    tradeRate: z.number().int().min(1).max(10),
    costs: z
      .object({ village: costSchema, town: costSchema, castle: costSchema, army: costSchema })
      .strict(),
    /** Burgen je Reich, die Startburg mitgezählt. */
    maxCastles: z.number().int().min(1).max(5),
    /** Armeen je Feld. */
    armyCap: z.number().int().min(1).max(50),
    /** Lose im Glücksrad: für den Verteidiger je Gebäude auf dem Feld, frei für alle Kategorien. */
    lots: z.object({ village: amount, town: amount, castle: amount, free: amount }).strict(),
    timers: z
      .object({
        /** Rüstzeit: alle gleichzeitig und verdeckt; vorbei, sobald alle fertig sind. */
        prepareMs: timerMs,
        /** Aufdecken der Rüstzeit. */
        ordersRevealMs: pauseMs,
        /** Drehen des Glücksrads in der Ansage eines Duells. */
        wheelMs: pauseMs,
      })
      .strict(),
  })
  .strict();
export type MatchEconomy = z.infer<typeof matchEconomySchema>;

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
    /** Ausbau mit Burgen, Dörfern und Armeen (ADR-057); fehlt in der bisherigen Partie. */
    economy: matchEconomySchema.optional(),
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
    if (rules.economy && rules.economy.startArmies > rules.economy.armyCap) {
      ctx.addIssue({
        code: 'custom',
        path: ['economy', 'startArmies'],
        message: 'Die Startburg darf nicht mehr Armeen haben, als auf ein Feld passen',
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
 * Karte je Spielerzahl [E] (ADR-052): im Schnitt acht Regionen je Reich. Zu dritt die ganze Wendelmark
 * (24 Regionen), zu zweit ihr Kernland (16 Regionen).
 */
export const MATCH_MAP_BY_SEATS: Readonly<Record<MatchSeatCount, MatchMapId>> = Object.freeze({
  2: 'KERNMARK',
  3: 'WENDELMARK',
});

/** Regeln für eine Partie mit `seats` Spielern: Spielerzahl, Karte und Landnahme-Wahlen ersetzt. */
export function matchRulesForSeats<R extends MatchRules>(rules: R, seats: MatchSeatCount): R {
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

/** Regeln mit Ausbau: `economy` ist gesetzt. */
export type RealmRules = MatchRules & { readonly economy: MatchEconomy };

export function isRealmRules(rules: MatchRules): rules is RealmRules {
  return rules.economy !== undefined;
}

/**
 * Standardwerte des Ausbaus aus dem Konzept vom 2026-11-11, vom Product Owner mit allen
 * Empfehlungen freigegeben (O-25 bis O-35). Zahlen [E] bis zum Spieltest.
 */
export const DEFAULT_MATCH_ECONOMY: MatchEconomy = Object.freeze({
  favorites: 4,
  startArmies: 3,
  villageMinDistance: 2,
  yields: { plain: 1, village: 2, town: 3, castleBread: 2, castleMaterial: 2 },
  tradeRate: 3,
  costs: {
    village: { bread: 1, material: 3 },
    town: { bread: 2, material: 6 },
    castle: { bread: 8, material: 16 },
    army: { bread: 2, material: 0 },
  },
  maxCastles: 2,
  armyCap: 6,
  lots: { village: 2, town: 3, castle: 4, free: 2 },
  timers: { prepareMs: 40 * SECOND_MS, ordersRevealMs: 2 * SECOND_MS, wheelMs: 3 * SECOND_MS },
});

/**
 * Partie mit Ausbau zu dritt (O-31: fünf Feldzugrunden); zu zweit über `matchRulesForSeats`, das
 * den Ausbau übernimmt.
 */
export const DEFAULT_REALM_RULES: RealmRules = Object.freeze({
  ...DEFAULT_MATCH_RULES,
  campaign: { rounds: 5 },
  economy: DEFAULT_MATCH_ECONOMY,
});

/** Ausbau mit verkürzten Zeiten für Tests und schnelle Spieltests. */
export const PLAYTEST_REALM_RULES: RealmRules = Object.freeze({
  ...PLAYTEST_MATCH_RULES,
  campaign: { rounds: 5 },
  economy: {
    ...DEFAULT_MATCH_ECONOMY,
    timers: { prepareMs: 15 * SECOND_MS, ordersRevealMs: 500, wheelMs: 1000 },
  },
});
