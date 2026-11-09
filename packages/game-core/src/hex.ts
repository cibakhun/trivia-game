/**
 * Hex-Mathematik (docs/GAME_RULES.md §2, docs/WORLD_SYSTEM.md §3.1):
 * axiale Koordinaten (q, r), pointy-top; Chunks über Offset-Koordinaten „odd-r“.
 */

export interface Axial {
  readonly q: number;
  readonly r: number;
}

export interface ChunkCoord {
  readonly chunkX: number;
  readonly chunkY: number;
}

/** Kantenlänge eines Chunks in Rasterzellen (16 × 16 = 256 Zellen). */
export const CHUNK_SIZE = 16;

/** Nachbarrichtungen in der Reihenfolge aus GAME_RULES §2. */
export const AXIAL_DIRECTIONS: readonly Axial[] = Object.freeze(
  [
    { q: 1, r: 0 },
    { q: -1, r: 0 },
    { q: 0, r: 1 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
    { q: -1, r: 1 },
  ].map((direction) => Object.freeze(direction)),
);

function assertAxial({ q, r }: Axial): void {
  if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) {
    throw new RangeError(`Ungültige Hex-Koordinate (${q}, ${r})`);
  }
}

/** Die sechs Nachbarn einer Zelle (ob sie Land sind, entscheidet die Karte). */
export function neighbors(cell: Axial): Axial[] {
  assertAxial(cell);
  return AXIAL_DIRECTIONS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }));
}

/** Hex-Distanz: `(|dq| + |dr| + |dq + dr|) / 2`. */
export function hexDistance(a: Axial, b: Axial): number {
  assertAxial(a);
  assertAxial(b);
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function areNeighbors(a: Axial, b: Axial): boolean {
  return hexDistance(a, b) === 1;
}

export function axialKey({ q, r }: Axial): string {
  return `${q},${r}`;
}

/** Axial → Offset „odd-r“: `col = q + (r − (r & 1)) / 2`, `row = r`. */
export function axialToOddR(cell: Axial): { col: number; row: number } {
  assertAxial(cell);
  // Parität wie `r & 1` im Zweierkomplement (auch −1 → 1), aber ohne 32-Bit-Grenze.
  const parity = Math.abs(cell.r) % 2;
  return { col: cell.q + (cell.r - parity) / 2, row: cell.r };
}

export function oddRToAxial(col: number, row: number): Axial {
  if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) {
    throw new RangeError(`Ungültige Offset-Koordinate (${col}, ${row})`);
  }
  const parity = Math.abs(row) % 2;
  return { q: col - (row - parity) / 2, r: row };
}

/** Chunk einer Zelle: `floor(col / 16)`, `floor(row / 16)`. */
export function chunkOf(cell: Axial): ChunkCoord {
  const { col, row } = axialToOddR(cell);
  return { chunkX: Math.floor(col / CHUNK_SIZE), chunkY: Math.floor(row / CHUNK_SIZE) };
}

/** Alle 256 Zellen eines Chunks in Zeilenreihenfolge. */
export function cellsOfChunk({ chunkX, chunkY }: ChunkCoord): Axial[] {
  const cells: Axial[] = [];
  for (let row = chunkY * CHUNK_SIZE; row < (chunkY + 1) * CHUNK_SIZE; row++) {
    for (let col = chunkX * CHUNK_SIZE; col < (chunkX + 1) * CHUNK_SIZE; col++) {
      cells.push(oddRToAxial(col, row));
    }
  }
  return cells;
}
