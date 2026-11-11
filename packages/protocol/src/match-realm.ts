import { z } from 'zod';
import { questionCategorySchema } from './question.ts';

/**
 * Bausteine der Partie mit Ausbau über HTTP (docs/MATCH_RULES.md §11, docs/API.md §2.6, ADR-057,
 * ADR-058): Gebäude, Befehle der Rüstzeit, Glücksrad. Die Regeln selbst stehen in `match-rules.ts`
 * (Abschnitt `economy`), die Zustandsmaschine in game-core (`realm.ts`).
 */

const seat = z.number().int().min(0).max(2);
const region = z.number().int().min(0).max(63);
const count = z.number().int().min(0);

/** Spielart einer Partie: wie bisher oder mit Ausbau (Burgen, Dörfer, Armeen). */
export const MATCH_MODES = ['CLASSIC', 'REALM'] as const;
export const matchModeSchema = z.enum(MATCH_MODES);
export type MatchMode = z.infer<typeof matchModeSchema>;

/** Gleiche Liste wie `REALM_BUILDINGS` in game-core; ein Test hält beide gleich. */
export const REALM_BUILDING_CODES = ['NONE', 'VILLAGE', 'TOWN', 'CASTLE'] as const;
export const realmBuildingSchema = z.enum(REALM_BUILDING_CODES);
export type RealmBuildingCode = z.infer<typeof realmBuildingSchema>;

/** Gleiche Liste wie `REALM_RESOURCES` in game-core; ein Test hält beide gleich. */
export const REALM_RESOURCE_CODES = ['BREAD', 'MATERIAL'] as const;
export const realmResourceSchema = z.enum(REALM_RESOURCE_CODES);

/** Schritte der Zustandsmaschine mit Ausbau (`RealmStep` in game-core). */
export const REALM_STEP_KINDS = [
  'START_ESTIMATE',
  'CASTLE_PICK',
  'VILLAGE_PICK',
  'LAND_ESTIMATE',
  'LAND_PICK',
  'PREPARE',
  'CAMPAIGN_TARGET',
  'DUEL_WHEEL',
  'DUEL_TRIVIA',
  'DUEL_ESTIMATE',
  'FINISHED',
] as const;
export const realmStepKindSchema = z.enum(REALM_STEP_KINDS);

/** Folgen eines Duells mit Ausbau (`RealmDuelEffect` in game-core). */
export const REALM_DUEL_EFFECTS = [
  'CONQUERED',
  'BUILDING_DAMAGED',
  'CASTLE_HIT',
  'CASTLE_DESTROYED',
  'TAKEOVER',
  'FORTIFIED',
] as const;

/** Gründe, aus denen Befehle der Rüstzeit abgelehnt werden (`RealmOrderError` in game-core). */
export const REALM_ORDER_ERRORS = [
  'INVALID',
  'TOO_MANY_ORDERS',
  'NOT_OWN_REGION',
  'TOO_EXPENSIVE',
  'ALREADY_BUILT',
  'MAX_LEVEL',
  'CASTLE_LIMIT',
  'NOT_A_CASTLE',
  'NOT_NEIGHBORS',
  'NOT_ENOUGH_ARMIES',
  'ARMY_CAP',
] as const;

/** Obergrenze der Befehle je Rüstzeit, damit eine Eingabe nicht beliebig groß wird. */
export const MAX_REALM_ORDERS = 200;

/** Anzahl in einem Befehl; ob sie bezahlbar ist und passt, prüfen die Regeln. */
const orderCount = z.number().int().min(1).max(1000);

/**
 * Ein Befehl der Rüstzeit (`RealmOrder` in game-core, MATCH_RULES §11.3 und §11.4): bauen, Armeen
 * kaufen, Armeen ziehen, tauschen. Befehle laufen in der gegebenen Reihenfolge.
 */
export const realmOrderSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('BUILD'), region }).strict(),
  z.object({ kind: z.literal('RECRUIT'), region, count: orderCount }).strict(),
  z.object({ kind: z.literal('MOVE'), from: region, to: region, count: orderCount }).strict(),
  z.object({ kind: z.literal('TRADE'), give: realmResourceSchema, count: orderCount }).strict(),
]);
export type RealmOrderDto = z.infer<typeof realmOrderSchema>;

/** Was die Befehle eines Reichs bewirkt haben (`RealmOrdersSummary` in game-core). */
export const realmOrdersSummarySchema = z
  .object({
    built: z.array(z.object({ region, building: realmBuildingSchema }).strict()),
    recruited: count,
    moved: count,
    traded: count,
  })
  .strict();

/**
 * Glücksrad eines Duells (`RealmWheel` in game-core, MATCH_RULES §11.5): Lose je Seite und je
 * Kategorie die Teile aus den Lieblingskategorien des Angreifers, des Verteidigers und frei. Die
 * Chance einer Kategorie ist `weight / total`.
 */
export const realmWheelSchema = z
  .object({
    attackerLots: count,
    defenderLots: count,
    freeLots: count,
    segments: z.array(
      z
        .object({
          category: questionCategorySchema,
          attacker: count,
          defender: count,
          free: count,
          weight: count,
        })
        .strict(),
    ),
    total: count,
  })
  .strict();
export type RealmWheelDto = z.infer<typeof realmWheelSchema>;

/** Platz im Endstand der Partie mit Ausbau (`RealmStanding` in game-core). */
export const realmStandingSchema = z.object({
  seat,
  /** 1 = bester Platz; bei völligem Gleichstand geteilt. */
  place: z.number().int().min(1).max(3),
  points: count,
  regions: count,
  /** Verbliebene Leben aller eigenen Burgen. */
  castleLives: count,
  eliminated: z.boolean(),
});
