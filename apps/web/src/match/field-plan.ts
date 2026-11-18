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

/**
 * Halbmesser der Münze mit Ausbau, wie sie auf dem Handy gezeichnet wird: 0,17 samt halbem Rand
 * (2,4 Einheiten), 1,25-fach um ihre Mitte (`.narrow .coin.planned`, ohne das Absenken der
 * Münzen ohne Ausbau: Ihre Mitte bleibt, wo der Lageplan sie hinlegt).
 */
const COIN = (0.17 + 1.2 / 60) * 1.25;

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
  // Quadrate vergleichen, die Wurzel nur einmal: Die Suche ruft das sehr oft auf
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
    const ex = p.x - a.x - t * dx;
    const ey = p.y - a.y - t * dy;
    best = Math.min(best, ex * ex + ey * ey);
  }
  return inside ? Math.sqrt(best) : -Math.sqrt(best);
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

/** Abstand eines Kreises zu einem Kasten; negativ, wo er hineinragt. */
function circleGap(at: Point, r: number, box: Box): number {
  const dx = Math.max(box[0] - at.x, 0, at.x - box[2]);
  const dy = Math.max(box[1] - at.y, 0, at.y - box[3]);
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy) - r;
  return -r - Math.min(at.x - box[0], box[2] - at.x, at.y - box[1], box[3] - at.y);
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

/** Raster der Suche, der Nähe zum gewohnten Platz `want` nach geordnet (`near` in Sechseckgrößen). */
function grid(
  xs: readonly number[],
  ys: readonly number[],
  want: Point,
): (Point & { near: number })[] {
  const out: (Point & { near: number })[] = [];
  for (const x of xs)
    for (const y of ys) out.push({ x, y, near: Math.hypot(x - want.x, y - want.y) });
  return out.sort((a, b) => a.near - b.near);
}

/**
 * Sucht im Raster `x` × `y` (Schritt `step`, in Sechseckgrößen) den Platz mit der höchsten
 * Wertung: erst grob mit dreifachem Schritt, dann fein um den besten groben Platz. Die Plätze kommen
 * der Nähe zum gewohnten nach; `rate` bekommt Platz, Entfernung vom gewohnten (Karteneinheiten) und
 * die beste Wertung bisher und gibt −∞ zurück, sobald klar ist, dass der Platz nicht gewinnt, noch
 * bevor der Abstand zum Umriss gerechnet ist. Kann selbst voller Abstand nicht mehr gewinnen, endet
 * der Durchgang. So bleibt die Suche beim ersten Zeichnen aller Felder bei wenigen Millisekunden
 * je Feld; die volle feine Suche brauchte am Rechner gut 100.
 */
function search(
  x: readonly [number, number],
  y: readonly [number, number],
  step: number,
  want: Point,
  s: number,
  rate: (at: Point, far: number, best: number) => number,
): void {
  const top = ENOUGH * s * 100;
  const found: { score: number; at: Point | null } = { score: Number.NEGATIVE_INFINITY, at: null };
  const pass = (xs: readonly number[], ys: readonly number[]): void => {
    for (const at of grid(xs, ys, want)) {
      const far = at.near * s;
      if (top - far <= found.score) break;
      const score = rate(at, far, found.score);
      if (score > found.score) {
        found.score = score;
        found.at = at;
      }
    }
  };
  pass(steps(x[0], x[1], 3 * step), steps(y[0], y[1], 3 * step));
  const centre = found.at;
  if (centre === null) return;
  const around = (c: number, [from, to]: readonly [number, number]): number[] =>
    steps(Math.max(from, c - 3 * step), Math.min(to, c + 3 * step), step);
  pass(around(centre.x, x), around(centre.y, y));
}

export interface FieldPlan {
  /** Bannerträger auf einem Feld ohne Burg. */
  readonly bearer: Point;
  /** Ebenso, wenn daneben die Münze liegt (gehaltene Verteidigung, MATCH_RULES §11.7). */
  readonly bearerWithCoin: Point;
  /** Münze neben dem Träger. */
  readonly coin: Point;
  /** Münze auf einem Burgfeld mit Träger: wo neben Träger und Lebensschilden Platz ist. */
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
  const r = COIN * s;
  const label = nameBox(region, s, region.cy);
  let best: Placed & { score: number } = {
    score: Number.NEGATIVE_INFINITY,
    at: { x: region.cx, y: region.cy },
    coin: null,
    room: Number.NEGATIVE_INFINITY,
  };
  for (const side of withCoin ? ([1, -1] as const) : ([1] as const)) {
    // Gewohnt: unter dem Namen; mit Münze ein Stück zur Seite, damit beide darunter Platz haben
    const want = { x: withCoin ? -0.22 * side : -0.03, y: 0.44 };
    search([-0.5, 0.4], [0.22, 0.62], 0.02, want, s, (step, far, floor) => {
      const at = { x: region.cx + step.x * s, y: region.cy + step.y * s };
      // Erst, was nichts kostet: Abstand zum Namen
      let room = Number.POSITIVE_INFINITY;
      for (const box of BEARER_BOXES)
        room = Math.min(room, gap(scaled(box, at, b), label) + 0.04 * s);
      let coin: Point | null = null;
      if (withCoin) {
        coin = coinBeside(at, b, s, side);
        room = Math.min(
          room,
          gap([coin.x - r, coin.y - r, coin.x + r, coin.y + r], label) + 0.04 * s,
        );
      }
      if (Math.min(room, ENOUGH * s) * 100 - far <= floor) return Number.NEGATIVE_INFINITY;
      room = Math.min(room, bearerClearance(at, b, region.outline));
      if (coin) room = Math.min(room, coinClearance(coin, r, region.outline));
      const score = Math.min(room, ENOUGH * s) * 100 - far;
      if (score > best.score) best = { score, at, coin, room };
      return score;
    });
  }
  return best;
}

/** Burg mit Träger: Verschiebung der Gruppe und Platz der Münze darin. */
interface Keep {
  readonly at: Point;
  readonly coin: Point;
}

/** Gewohnter Platz der Münze auf einem Burgfeld: unter dem Träger, rechts der Lebensschilde. */
const KEEP_COIN = { x: 0.33, y: 0.58 } as const;

/** Raster der Burgfelder (Sechseckgrößen): Verschiebung der Gruppe und Platz der Münze. */
const KEEP_STEP = 0.02;

/**
 * Beste Verschiebung von Burg und Träger auf einem Burgfeld, samt Platz der Münze. Die Münze
 * berührt nie Burg, Lebensschilde oder Träger und liegt so weit im Feld wie möglich, am liebsten
 * unter dem Träger; die Gruppe rückt so, dass auch sie im Feld bleibt, auch wenn gerade keine Münze
 * liegt (sonst spränge die Burg, sobald eine kommt). Verschiebung und Münze liegen auf demselben
 * Raster: Ob die Münze die Gruppe berührt, hängt nicht von der Verschiebung ab, und ihr Abstand zum
 * Rand wird für jeden Punkt nur einmal gerechnet.
 */
function placeKeep(region: ArtRegion, s: number): Keep {
  const b = FIELD_BEARER.castle * s;
  const r = COIN * s;
  const at = (x: number, y: number): Point => ({ x: region.cx + x * s, y: region.cy + y * s });
  // Der Name steht über der Burg; ihre Fahne bleibt unter ihm
  const label = nameBox(region, s, region.cy - 0.56 * s);
  const reach = KEEP.livesGap + KEEP.life / 2;
  const group = (dx: number, dy: number) => {
    const castle = at(KEEP.beside + dx, KEEP.y + dy);
    const bearer = at(KEEP.bearerX + dx, KEEP.bearerY + dy);
    const lives: Box = [
      castle.x - reach * s,
      region.cy + (KEEP.livesY + dy - KEEP.life / 2) * s,
      castle.x + reach * s,
      region.cy + (KEEP.livesY + dy + KEEP.life / 2) * s,
    ];
    return {
      bearer,
      walls: scaled(CASTLE_BOX, castle, KEEP.size * s),
      lives,
      figure: BEARER_BOXES.map((box) => scaled(box, bearer, b)),
    };
  };
  // Plätze der Münze neben der Gruppe, ohne sie zu berühren, der Nähe zum gewohnten nach
  const home = group(0, 0);
  const own = [home.lives, home.walls, ...home.figure];
  const coins = grid(
    steps(-0.76, 0.76, 2 * KEEP_STEP),
    steps(-0.2, 0.84, 2 * KEEP_STEP),
    KEEP_COIN,
  ).filter((c) => own.every((box) => circleGap(at(c.x, c.y), r, box) >= 0.02 * s));
  const cell = (v: number): number => Math.round(v / KEEP_STEP);
  const rooms = new Map<number, number>();
  const coinRoom = (x: number, y: number): number => {
    const key = cell(x) * 1000 + cell(y);
    let room = rooms.get(key);
    if (room === undefined) {
      const p = at(x, y);
      room = circleGap(p, r, label) < 0.02 * s ? -s : coinClearance(p, r, region.outline);
      rooms.set(key, room);
    }
    return room;
  };
  let best: Keep & { score: number } = {
    score: Number.NEGATIVE_INFINITY,
    at: { x: 0, y: 0 },
    coin: at(KEEP_COIN.x, KEEP_COIN.y),
  };
  const offsets = grid(steps(-0.3, 0.3, KEEP_STEP), steps(0, 0.12, KEEP_STEP), { x: 0, y: 0 });
  // Was am knappsten steht (Mauer, Schild, Träger oder Münze), bekommt den meisten Raum; ist
  // genug für alle da, zählt die Nähe zum gewohnten Platz
  const enough = ENOUGH * s * 100;
  for (const { x: dx, y: dy, near } of offsets) {
    const far = near * s;
    if (enough - far <= best.score) break;
    const { bearer, walls, lives } = group(dx, dy);
    // Die Mauern bleiben ganz im Feld, wo es irgend geht: Für sie rückt nichts anderes
    let fort = gap(walls, label) + 0.06 * s;
    for (const p of boxPoints(walls)) fort = Math.min(fort, clearance(p, region.outline));
    const wall = Math.min(fort, 0) * 1000;
    let room = Math.min(fort, bearerClearance(bearer, b, region.outline));
    for (const p of boxPoints(lives)) room = Math.min(room, clearance(p, region.outline));
    // Mehr Raum als die Gruppe selbst hat, bringt der Münze nichts: dann zählt nur ihre Nähe
    const cap = Math.min(room * 100, enough);
    if (wall + cap - far <= best.score) continue;
    let coin = { score: Number.NEGATIVE_INFINITY, x: 0, y: 0, room: -s };
    for (const c of coins) {
      const cfar = c.near * s;
      if (cap - cfar <= coin.score) break;
      const cr = coinRoom(c.x + dx, c.y + dy);
      const score = Math.min(cr * 100, cap) - cfar;
      if (score > coin.score) coin = { score, x: c.x + dx, y: c.y + dy, room: cr };
    }
    const score = wall + Math.min(room * 100, coin.room * 100, enough) - far;
    if (score > best.score) {
      best = { score, at: { x: dx * s, y: dy * s }, coin: at(coin.x, coin.y) };
    }
  }
  return { at: best.at, coin: best.coin };
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
  const b = FIELD_BEARER.field * s;
  const r = COIN * s;
  const coin = paired.coin ?? coinBeside(bearerWithCoin, b, s, 1);
  // Den Platz neben einer Burg braucht nur ein Burgfeld: erst rechnen, wenn ihn jemand liest
  let kept: { at: Point; coin: Point; army: readonly Box[] } | null = null;
  const keepPart = (): { at: Point; coin: Point; army: readonly Box[] } => {
    if (kept) return kept;
    const placed = placeKeep(region, s);
    const keep = placed.at;
    const keepBearer = {
      x: region.cx + KEEP.bearerX * s + keep.x,
      y: region.cy + KEEP.bearerY * s + keep.y,
    };
    const castle = { x: region.cx + KEEP.beside * s + keep.x, y: region.cy + KEEP.y * s + keep.y };
    const reach = (KEEP.livesGap + KEEP.life / 2) * s;
    const livesY = region.cy + KEEP.livesY * s + keep.y;
    const at = placed.coin;
    kept = {
      at: keep,
      coin: at,
      army: [
        union(BEARER_BOXES.map((box) => scaled(box, keepBearer, FIELD_BEARER.castle * s))),
        scaled(CASTLE_BOX, castle, KEEP.size * s),
        [
          castle.x - reach,
          livesY - (KEEP.life / 2) * s,
          castle.x + reach,
          livesY + (KEEP.life / 2) * s,
        ],
        [at.x - r, at.y - r, at.x + r, at.y + r],
      ],
    };
    return kept;
  };
  const plan: FieldPlan = {
    bearer,
    bearerWithCoin,
    coin,
    get keepCoin() {
      return keepPart().coin;
    },
    room: alone.room,
    roomWithCoin: paired.room,
    get keep() {
      return keepPart().at;
    },
    fieldArmy: [
      union(BEARER_BOXES.map((box) => scaled(box, bearer, b))),
      union(BEARER_BOXES.map((box) => scaled(box, bearerWithCoin, b))),
      [coin.x - r, coin.y - r, coin.x + r, coin.y + r],
    ],
    get keepArmy() {
      return keepPart().army;
    },
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

/** Abstand der Münze zum Umriss, ganzer Kreis im Maß auf dem Handy (für Tests). */
export function coinRoom(at: Point, s: number, outline: readonly Point[]): number {
  return coinClearance(at, COIN * s, outline);
}

/** Abstand des Trägers zum Namen in der Mitte des Felds (für Tests). */
export function bearerNameGap(region: ArtRegion, at: Point, b: number, s: number): number {
  const label = nameBox(region, s, region.cy);
  return Math.min(...BEARER_BOXES.map((box) => gap(scaled(box, at, b), label)));
}
