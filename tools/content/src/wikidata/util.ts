/** Kleine Hilfen für den Wikidata-Generator: deterministischer Zufall, Daten, Auswahl. */

export type Row = Readonly<Record<string, string>>;

/** Deterministischer Zufall aus einer Zeichenkette (FNV-1a als Saat, mulberry32). */
export function createRng(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let state = hash;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/** Jahr aus einem xsd:dateTime wie „1756-01-27T00:00:00Z“ (auch mit Vorzeichen). */
export function yearOf(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^([+-]?\d{1,6})-\d\d-\d\dT/.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}

export function numberOf(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function groupByItem(rows: readonly Row[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const item = row['item'];
    if (!item) continue;
    const group = groups.get(item);
    if (group) group.push(row);
    else groups.set(item, [row]);
  }
  return groups;
}

export function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * Wählt `count` Einträge gleichmäßig verteilt aus den ersten `window` einer nach Bekanntheit
 * sortierten Liste, damit leichte und schwerere Fragen dabei sind. Liefert die Position im
 * Fenster mit, aus der sich die Schwierigkeit ableitet.
 */
export function spreadPick<T>(ranked: readonly T[], count: number, window: number): { item: T; share: number }[] {
  const size = Math.min(ranked.length, Math.max(window, count));
  if (size <= count) return ranked.slice(0, size).map((item, i) => ({ item, share: size > 1 ? i / (size - 1) : 0 }));
  const picks: { item: T; share: number }[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.round((i * (size - 1)) / (count - 1 || 1));
    const item = ranked[index];
    if (item !== undefined) picks.push({ item, share: index / (size - 1) });
  }
  return picks;
}

/** Schwierigkeit aus der Lage im Fenster: bekannteste Drittel 2, mittleres 3, letztes 4. */
export function difficultyFromShare(share: number): 2 | 3 | 4 {
  if (share < 1 / 3) return 2;
  if (share < 2 / 3) return 3;
  return 4;
}

/** Schlüsselteil aus einer Q-Nummer („Q42“ → „q42“). */
export function qidKey(qid: string): string {
  return qid.toLowerCase();
}
