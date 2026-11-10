/**
 * Deterministischer Zufall für die Kartengrafik: gleiche Eingabe, gleiche Form, auf jedem Gerät.
 * Nur für die Darstellung, nie für Spielregeln (die Ströme dafür liegen in game-core).
 */

/** 32-Bit-Hash eines Textes (FNV-1a). */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Zahlenfolge in [0, 1) aus einem Startwert (mulberry32). */
export function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zahlenfolge zu einem Schlüssel, etwa einer Kante oder einer Region. */
export function seeded(key: string): () => number {
  return sequence(hashText(key));
}
