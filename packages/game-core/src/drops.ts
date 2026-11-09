import type { Rng } from './rng.ts';

/**
 * Item-Drops (docs/ITEM_SYSTEM.md §3): eine gemeinsame gewichtete Ziehung `u ∈ [0, 1)` aus dem
 * Strom `drop:{siege_id}`. Gewichte in ppm (Millionstel), damit die Intervallgrenzen exakt sind:
 * Für `u = x / 2^32` ist `u · 10^6` in Gleitkomma exakt, der Vergleich mit ganzzahligen
 * Schwellen also frei von Rundungsfehlern (0,79 ist wirklich 0,79).
 */

export const ITEM_IDS = ['hourglass_small', 'chronos_seal', 'time_crystal'] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export interface DropEntry {
  readonly item: ItemId;
  readonly weightPpm: number;
}

const PPM = 1_000_000;

/** Standardtabelle [A]: kein Item 79 %, Sanduhr 15 %, Siegel 5 %, Kristall 1 %. */
export const DEFAULT_DROP_TABLE: readonly DropEntry[] = Object.freeze([
  { item: 'hourglass_small', weightPpm: 150_000 },
  { item: 'chronos_seal', weightPpm: 50_000 },
  { item: 'time_crystal', weightPpm: 10_000 },
]);

export interface DropDraw {
  /** Gezogener Wert (für das Ereignisprotokoll). */
  readonly u: number;
  /** Ergebnis; `null` = kein Item. */
  readonly item: ItemId | null;
  /** Wahrscheinlichkeit für „kein Item“ nach Skalierung, in ppm (`1 − f · 0,21`). */
  readonly nonePpm: number;
}

/**
 * Ordnet `u` einem Ergebnis zu. Reduzierte Berechtigung skaliert die Item-Gewichte mit `f` und
 * erhöht „kein Item“ entsprechend: `none = 1 − f · Σ Gewichte`. Die skalierten Gewichte werden
 * auf ganze ppm gerundet (für f ∈ {1, 0,5, 0,25} exakt).
 */
export function classifyDrop(
  u: number,
  factor: number,
  table: readonly DropEntry[] = DEFAULT_DROP_TABLE,
): DropDraw {
  if (!(u >= 0 && u < 1)) throw new RangeError(`u muss in [0, 1) liegen: ${u}`);
  if (!(factor >= 0 && factor <= 1))
    throw new RangeError(`Faktor muss in [0, 1] liegen: ${factor}`);
  for (const entry of table) {
    if (!Number.isSafeInteger(entry.weightPpm) || entry.weightPpm < 0) {
      throw new RangeError(`Gewicht von ${entry.item} muss eine nichtnegative ganze Zahl sein`);
    }
  }
  const scaled = table.map((e) => ({ item: e.item, weightPpm: Math.round(e.weightPpm * factor) }));
  const itemsPpm = scaled.reduce((sum, e) => sum + e.weightPpm, 0);
  if (itemsPpm > PPM) throw new RangeError('Summe der Item-Gewichte über 100 %');
  const nonePpm = PPM - itemsPpm;

  const position = u * PPM; // exakt für u = x / 2^32
  if (position < nonePpm) return { u, item: null, nonePpm };
  let threshold = nonePpm;
  for (const entry of scaled) {
    threshold += entry.weightPpm;
    if (position < threshold) return { u, item: entry.item, nonePpm };
  }
  // Unerreichbar: Die Schwellen summieren sich zu 10^6 und u · 10^6 < 10^6.
  throw new Error('Drop-Tabelle deckt [0, 1) nicht ab');
}

/** Eine Ziehung aus dem Strom `drop:{siege_id}`; verbraucht genau einen Wert. */
export function drawDrop(
  rng: Rng,
  factor: number,
  table: readonly DropEntry[] = DEFAULT_DROP_TABLE,
): DropDraw {
  return classifyDrop(rng.nextFloat(), factor, table);
}
