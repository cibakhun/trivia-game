import type { ArtRegion, Decor } from '../art/map-art.ts';

/**
 * Lageplan eines Felds der Partie mit Ausbau (Gebäude oben, Name in der Mitte, Armee unten): Wo
 * Bannerträger, Münze und eine Burg mit Träger daneben so stehen, dass sie im Feld bleiben, mit
 * Abstand zu seinem Rand, zum Namen und zueinander. Die Felder sind gewürfelte Sechsecke; ein fester
 * Platz stand in jedem zweiten an oder über der Grenze. Gerechnet wird einmal je Feld (gleiche
 * Karte, gleiche Plätze, auf jedem Gerät), gemessen an der Schrift auf dem Handy (die größte).
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

type Box = readonly [x0: number, y0: number, x1: number, y1: number];

/** Größe des Bannerträgers in Sechseckgrößen, auf einem Feld und neben einer Burg. */
export const FIELD_BEARER = { field: 0.58, castle: 0.62 } as const;

/** Burg mit Ausbau in Sechseckgrößen; neben einem Träger steht sie links von der Mitte. */
export const KEEP = {
  /** Mitte der Burg neben einem Träger, waagrecht. */
  beside: -0.27,
  /** Platz des Trägers neben der Burg. */
  bearerX: 0.42,
  bearerY: 0.04,
  /** Mitte der Burg, senkrecht. */
  y: -0.02,
  size: 0.74,
  /** Lebensschilde in einer Reihe unter der Burg: Höhe, Abstand, Größe. */
  livesY: 0.5,
  livesGap: 0.22,
  life: 0.2,
} as const;

/** Halbmesser der Münze mit Ausbau und ihr Maß auf dem Handy (`.narrow .coin`, 1,25-fach). */
const COIN = 0.17 * 1.25;

/**
 * Umriss des Bannerträgers (Symbol `bearer`, Rahmen −50…50, samt Strich) in Hundertsteln seiner
 * Größe: Fahne, Stange, Figur und Helm.
 */
const BEARER_EDGE: readonly Point[] = [
  { x: -6.5, y: -46.5 },
  { x: 21, y: -46.5 },
  { x: 48.5, y: -46.5 },
  { x: 48.5, y: -19 },
  { x: 48.5, y: 8.5 },
  { x: 21, y: -5 },
  { x: -4, y: -51 },
  { x: -4, y: 49 },
  { x: -48.5, y: 48.5 },
  { x: -27, y: 48.5 },
  { x: -5.5, y: 48.5 },
  { x: -48.5, y: 32 },
  { x: -44, y: 22 },
  { x: -41.5, y: 2 },
  { x: -27, y: -12.5 },
  { x: -12.5, y: 2 },
];

/** Kästen des Bannerträgers (Fahne mit Stange, Figur mit Helm) in Hundertsteln seiner Größe. */
const BEARER_BOXES: readonly Box[] = [
  [-7, -51, 48.5, 8.5],
  [-7, -51, -1, 49],
  [-48.5, -12.5, -5.5, 48.5],
];

/** Was von der Burg zu sehen ist (Symbol `castle`), in Hundertsteln ihrer Größe. */
const CASTLE_BOX: Box = [-48, -51, 48, 42];

/** Name mitten im Feld auf dem Handy (17 px, Halo 4 px, 3 px angehoben), in Sechseckgrößen. */
function nameBox(region: ArtRegion, s: number, y: number): Box {
  const half = (0.072 * region.name.length + 0.04) * s;
  return [region.cx - half, y - 0.32 * s, region.cx + half, y + 0.16 * s];
}

/** Abstand eines Punkts zum Umriss: positiv innen, negativ außen. */
function clearance(p: Point, outline: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!;
    const b = outline[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return inside ? best : -best;
}

/** Abstand zweier Kästen; negativ, wo sie sich überdecken. */
function gap(a: Box, b: Box): number {
  const dx = Math.max(b[0] - a[2], a[0] - b[2]);
  const dy = Math.max(b[1] - a[3], a[1] - b[3]);
  return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy);
}

function boxPoints(box: Box): Point[] {
  const [x0, y0, x1, y1] = box;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return [
    { x: x0, y: y0 },
    { x: mx, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: my },
    { x: x1, y: y1 },
    { x: mx, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: my },
  ];
}

const scaled = (box: Box, at: Point, size: number): Box => [
  at.x + (box[0] / 100) * size,
  at.y + (box[1] / 100) * size,
  at.x + (box[2] / 100) * size,
  at.y + (box[3] / 100) * size,
];

function bearerClearance(at: Point, b: number, outline: readonly Point[]): number {
  let least = Number.POSITIVE_INFINITY;
  for (const q of BEARER_EDGE) {
    least = Math.min(
      least,
      clearance({ x: at.x + (q.x / 100) * b, y: at.y + (q.y / 100) * b }, outline),
    );
  }
  return least;
}

function coinClearance(at: Point, r: number, outline: readonly Point[]): number {
  return clearance(at, outline) - r;
}

/** Wo die Münze neben einem Träger liegt: rechts unter seiner Fahne oder links neben ihm. */
function coinBeside(bearer: Point, b: number, s: number, side: 1 | -1): Point {
  return { x: bearer.x + side * (0.485 * b + 0.04 * s + COIN * s), y: bearer.y + 0.2 * b };
}

/** Ab diesem Abstand zählt nur noch, wie nah ein Platz am gewohnten liegt (Karteneinheiten). */
const ENOUGH = 0.16;

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

export interface FieldPlan {
  /** Bannerträger auf einem Feld ohne Burg. */
  readonly bearer: Point;
  /** Ebenso, wenn daneben die Münze liegt (gehaltene Verteidigung, MATCH_RULES §11.7). */
  readonly bearerWithCoin: Point;
  /** Münze neben dem Träger. */
  readonly coin: Point;
  /** Münze auf einem Burgfeld mit Träger: unter ihm, rechts der Lebensschilde. */
  readonly keepCoin: Point;
  /** Abstand zum Rand des Felds und zum Namen, ohne und mit Münze (Karteneinheiten). */
  readonly room: number;
  readonly roomWithCoin: number;
  /** Burg mit Träger daneben: Verschiebung der ganzen Gruppe (Burg, Leben, Träger, Münze). */
  readonly keep: Point;
  /**
   * Kästen, die Landschaft frei lassen muss: auf dem Feld Träger (mit und ohne Münze) und Münze,
   * auf einem Burgfeld Burg, Lebensschilde, Träger und Münze.
   */
  readonly fieldArmy: readonly Box[];
  readonly keepArmy: readonly Box[];
}

interface Placed {
  readonly at: Point;
  readonly coin: Point | null;
  readonly room: number;
}

/** Bester Platz des Trägers (und der Münze, links oder rechts von ihm) auf einem Feld ohne Burg. */
function placeField(region: ArtRegion, s: number, withCoin: boolean): Placed {
  const b = FIELD_BEARER.field * s;
  const label = nameBox(region, s, region.cy);
  let best: Placed & { score: number } = {
    score: Number.NEGATIVE_INFINITY,
    at: { x: region.cx, y: region.cy },
    coin: null,
    room: Number.NEGATIVE_INFINITY,
  };
  for (const side of withCoin ? ([1, -1] as const) : ([1] as const)) {
    // Gewohnt: unter dem Namen; mit Münze ein Stück zur Seite, damit beide darunter Platz haben
    const want = { x: region.cx + (withCoin ? -0.22 * side : -0.03) * s, y: region.cy + 0.44 * s };
    for (const dx of steps(-0.5, 0.4, 0.02)) {
      for (const dy of steps(0.22, 0.62, 0.02)) {
        const at = { x: region.cx + dx * s, y: region.cy + dy * s };
        let room = bearerClearance(at, b, region.outline);
        for (const box of BEARER_BOXES)
          room = Math.min(room, gap(scaled(box, at, b), label) + 0.04 * s);
        let coin: Point | null = null;
        if (withCoin) {
          coin = coinBeside(at, b, s, side);
          const r = COIN * s;
          room = Math.min(room, coinClearance(coin, r, region.outline));
          room = Math.min(
            room,
            gap([coin.x - r, coin.y - r, coin.x + r, coin.y + r], label) + 0.04 * s,
          );
        }
        const score = Math.min(room, ENOUGH * s) * 100 - Math.hypot(at.x - want.x, at.y - want.y);
        if (score > best.score) best = { score, at, coin, room };
      }
    }
  }
  return best;
}

/** Beste Verschiebung von Burg und Träger auf einem Burgfeld. */
function placeKeep(region: ArtRegion, s: number): Point {
  const b = FIELD_BEARER.castle * s;
  // Der Name steht über der Burg; ihre Fahne bleibt unter ihm
  const label = nameBox(region, s, region.cy - 0.56 * s);
  let best = { score: Number.NEGATIVE_INFINITY, at: { x: 0, y: 0 } };
  for (const dx of steps(-0.2, 0.2, 0.02)) {
    for (const dy of steps(0, 0.08, 0.02)) {
      const castle = { x: region.cx + (KEEP.beside + dx) * s, y: region.cy + (KEEP.y + dy) * s };
      const bearer = {
        x: region.cx + (KEEP.bearerX + dx) * s,
        y: region.cy + (KEEP.bearerY + dy) * s,
      };
      const walls = scaled(CASTLE_BOX, castle, KEEP.size * s);
      let room = bearerClearance(bearer, b, region.outline);
      for (const p of boxPoints(walls)) room = Math.min(room, clearance(p, region.outline));
      room = Math.min(room, gap(walls, label) + 0.06 * s);
      // Drei Lebensschilde unter der Burg
      const reach = KEEP.livesGap + KEEP.life / 2;
      const lives: Box = [
        castle.x - reach * s,
        region.cy + (KEEP.livesY + dy - KEEP.life / 2) * s,
        castle.x + reach * s,
        region.cy + (KEEP.livesY + dy + KEEP.life / 2) * s,
      ];
      for (const p of boxPoints(lives)) room = Math.min(room, clearance(p, region.outline));
      const score = Math.min(room, ENOUGH * s) * 100 - Math.hypot(dx, dy) * s;
      if (score > best.score) best = { score, at: { x: dx * s, y: dy * s } };
    }
  }
  return best.at;
}

/** Münze neben Burg und Träger: unter dem Träger, rechts der Lebensschilde. */
function keepCoinAt(region: ArtRegion, s: number, keep: Point): Point {
  return { x: region.cx + 0.33 * s + keep.x, y: region.cy + 0.58 * s + keep.y };
}

const plans = new WeakMap<ArtRegion, FieldPlan>();

/** Lageplan eines Felds (gemerkt je Feld der Karte). */
export function fieldPlan(region: ArtRegion, s: number): FieldPlan {
  const known = plans.get(region);
  if (known) return known;
  const alone = placeField(region, s, false);
  const paired = placeField(region, s, true);
  const bearer = alone.at;
  const bearerWithCoin = paired.at;
  const keep = placeKeep(region, s);
  const b = FIELD_BEARER.field * s;
  const k = FIELD_BEARER.castle * s;
  const keepBearer = {
    x: region.cx + KEEP.bearerX * s + keep.x,
    y: region.cy + KEEP.bearerY * s + keep.y,
  };
  const coin = paired.coin ?? coinBeside(bearerWithCoin, b, s, 1);
  const castle = { x: region.cx + KEEP.beside * s + keep.x, y: region.cy + KEEP.y * s + keep.y };
  const reach = (KEEP.livesGap + KEEP.life / 2) * s;
  const livesY = region.cy + KEEP.livesY * s + keep.y;
  const keepCoin = keepCoinAt(region, s, keep);
  const r = COIN * s;
  const plan: FieldPlan = {
    bearer,
    bearerWithCoin,
    coin,
    keepCoin,
    room: alone.room,
    roomWithCoin: paired.room,
    keep,
    fieldArmy: [
      union(BEARER_BOXES.map((box) => scaled(box, bearer, b))),
      union(BEARER_BOXES.map((box) => scaled(box, bearerWithCoin, b))),
      [coin.x - r, coin.y - r, coin.x + r, coin.y + r],
    ],
    keepArmy: [
      union(BEARER_BOXES.map((box) => scaled(box, keepBearer, k))),
      scaled(CASTLE_BOX, castle, KEEP.size * s),
      [
        castle.x - reach,
        livesY - (KEEP.life / 2) * s,
        castle.x + reach,
        livesY + (KEEP.life / 2) * s,
      ],
      [keepCoin.x - r, keepCoin.y - r, keepCoin.x + r, keepCoin.y + r],
    ],
  };
  plans.set(region, plan);
  return plan;
}

function union(boxes: readonly Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/**
 * Landschaft eines Felds mit Ausbau, die dem Platz der Armee nicht im Weg steht. Sie bleibt
 * gleich, ob dort gerade eine Armee steht oder nicht: Sonst wüchse ein Baum, sobald sie abzieht.
 */
export function decorClear(region: ArtRegion, s: number, castle: boolean): (d: Decor) => boolean {
  const plan = fieldPlan(region, s);
  const army = castle ? plan.keepArmy : plan.fieldArmy;
  return (d) => {
    const half = 0.4 * d.size;
    const box: Box = [d.x - half, d.y - half, d.x + half, d.y + half];
    return army.every((part) => gap(box, part) > 0.02 * s);
  };
}

/** Abstand eines Kastens zum Umriss (für Tests): positiv, wenn er ganz im Feld liegt. */
export function boxClearance(box: Box, outline: readonly Point[]): number {
  return Math.min(...boxPoints(box).map((p) => clearance(p, outline)));
}

/** Abstand des Trägers zum Umriss (für Tests). */
export function bearerRoom(at: Point, b: number, outline: readonly Point[]): number {
  return bearerClearance(at, b, outline);
}

/** Abstand des Trägers zum Namen in der Mitte des Felds (für Tests). */
export function bearerNameGap(region: ArtRegion, at: Point, b: number, s: number): number {
  const label = nameBox(region, s, region.cy);
  return Math.min(...BEARER_BOXES.map((box) => gap(scaled(box, at, b), label)));
}
