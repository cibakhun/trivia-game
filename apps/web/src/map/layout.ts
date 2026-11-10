import { CHUNK_SIZE, type Axial, type ChunkCoord } from '@rdw/game-core';

/**
 * Bildschirmgeometrie der Hex-Karte (pointy-top, axiale Koordinaten wie in game-core).
 * `size` ist der Umkreisradius eines Sechsecks in Weltpixeln.
 */

export const HEX_SIZE = 28;
const SQRT3 = Math.sqrt(3);

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function axialToPixel({ q, r }: Axial, size = HEX_SIZE): Point {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}

/** Die sechs Ecken eines Sechsecks um den Mittelpunkt, im Uhrzeigersinn ab oben rechts. */
export function hexCorners(center: Point, size = HEX_SIZE): Point[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return { x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) };
  });
}

/** Rundet Bruchkoordinaten auf das Sechseck, in dem der Punkt liegt (Würfelkoordinaten). */
export function roundAxial(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // `+ 0` macht aus −0 eine 0
  return { q: rq + 0, r: rr + 0 };
}

export function pixelToAxial({ x, y }: Point, size = HEX_SIZE): Axial {
  return roundAxial(((SQRT3 / 3) * x - y / 3) / size, ((2 / 3) * y) / size);
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Höchstzahl Chunks je Kartenabfrage (API.md §2.2). */
export const MAX_CHUNKS_PER_REQUEST = 64;

/**
 * Chunks, die den sichtbaren Ausschnitt (Weltkoordinaten) berühren, mit einem Rand von einer
 * Zelle; höchstens `limit`, die nächsten zur Mitte zuerst.
 */
export function visibleChunks(
  bounds: Bounds,
  size = HEX_SIZE,
  limit = MAX_CHUNKS_PER_REQUEST,
): ChunkCoord[] {
  const rowMin = Math.floor(bounds.minY / (1.5 * size)) - 1;
  const rowMax = Math.ceil(bounds.maxY / (1.5 * size)) + 1;
  const colMin = Math.floor(bounds.minX / (SQRT3 * size)) - 1;
  const colMax = Math.ceil(bounds.maxX / (SQRT3 * size)) + 1;
  const chunkXMin = Math.floor(colMin / CHUNK_SIZE);
  const chunkXMax = Math.floor(colMax / CHUNK_SIZE);
  const chunkYMin = Math.floor(rowMin / CHUNK_SIZE);
  const chunkYMax = Math.floor(rowMax / CHUNK_SIZE);
  const centreX = (chunkXMin + chunkXMax) / 2;
  const centreY = (chunkYMin + chunkYMax) / 2;
  const chunks: ChunkCoord[] = [];
  for (let chunkY = chunkYMin; chunkY <= chunkYMax; chunkY++) {
    for (let chunkX = chunkXMin; chunkX <= chunkXMax; chunkX++) chunks.push({ chunkX, chunkY });
  }
  chunks.sort(
    (a, b) =>
      Math.hypot(a.chunkX - centreX, a.chunkY - centreY) -
        Math.hypot(b.chunkX - centreX, b.chunkY - centreY) ||
      a.chunkY - b.chunkY ||
      a.chunkX - b.chunkX,
  );
  return chunks.slice(0, limit);
}

export function chunkKey({ chunkX, chunkY }: ChunkCoord): string {
  return `${chunkX}:${chunkY}`;
}
