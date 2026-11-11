import type { MatchMap } from './match-map.ts';

/**
 * Rohstoffe der Partie mit Ausbau (docs/MATCH_RULES.md §11, ADR-057): Jedes Feld liefert genau
 * einen, und man sieht ihn an der Landschaft der Karte. Brot wächst auf Feldern, Wiesen, an Flüssen
 * und Seen und in Dörfern; Baustoff kommt aus Wäldern, Bergen, Hügeln und Mooren. Die Landschaft
 * zeichnet der Browser (`apps/web/src/art/terrain.ts`); ein Test dort hält beide deckungsgleich.
 */

export const REALM_RESOURCES = ['BREAD', 'MATERIAL'] as const;
export type RealmResource = (typeof REALM_RESOURCES)[number];

/**
 * Rohstoff je Region der Wendelmark; die Kernmark trägt dieselben Namen. Wendelmark: 11 Brot,
 * 13 Baustoff; Kernmark: 9 Brot, 7 Baustoff.
 */
const RESOURCE_BY_NAME: Readonly<Record<string, RealmResource>> = Object.freeze({
  Eschenhain: 'MATERIAL', // Wald
  Falkenwacht: 'MATERIAL', // Hügel
  Graufurt: 'BREAD', // Fluss
  Hirschgrund: 'MATERIAL', // Wald
  Ackerbrunn: 'BREAD', // Felder
  Birkental: 'MATERIAL', // Wald
  Dornfeld: 'BREAD', // Felder
  Eisenhang: 'MATERIAL', // Berge
  Fuchsmoor: 'MATERIAL', // Moor
  Goldwiese: 'BREAD', // Wiese
  Hagelstein: 'MATERIAL', // Berge
  Immenau: 'BREAD', // Wiese
  Kranichsee: 'BREAD', // See
  Lindenhof: 'BREAD', // Dorf
  Mühlbach: 'BREAD', // Fluss
  Nebelsenke: 'MATERIAL', // Moor
  Otterbruch: 'MATERIAL', // Moor
  Quellheim: 'BREAD', // Dorf
  Rabenfels: 'MATERIAL', // Hügel
  Salzweide: 'BREAD', // Wiese
  Tannenruh: 'MATERIAL', // Kiefern
  Uferland: 'BREAD', // Felder
  Wolfsklamm: 'MATERIAL', // Berge
  Zinnberg: 'MATERIAL', // Berge
});

/** Rohstoff einer Region. Eine Karte mit unbekanntem Namen ist ein Programmfehler. */
export function regionResource(map: MatchMap, region: number): RealmResource {
  const entry = map.regions[region];
  if (!entry) throw new RangeError(`Unbekannte Region ${region}`);
  const resource = RESOURCE_BY_NAME[entry.name];
  if (!resource) throw new Error(`Kein Rohstoff für ${entry.name} (${map.id})`);
  return resource;
}

/** Namen mit ihrem Rohstoff, für den Abgleich mit der Landschaft im Browser. */
export function realmResourceTable(): Readonly<Record<string, RealmResource>> {
  return RESOURCE_BY_NAME;
}
