/**
 * Bewegung des Glücksrads, nachgerechnet aus derselben Kurve, mit der CSS die Scheibe dreht
 * (`wheel-spin` in `realm.css`, ADR-067): Wann läuft ein Stift an einer Feldgrenze unter dem
 * Zeiger durch, wie schnell ist die Scheibe dann, und ab wann ist sie langsam genug, dass man ihre
 * Felder wieder sieht. Reine Rechnung ohne Zeit des Browsers: Der Zeiger klackert in CSS mit festen
 * Verzögerungen, die hier entstehen, und läuft so auch von der Stelle weiter, an der eine mitten in
 * der Drehung geladene Seite einsteigt.
 */

/**
 * Kurve der Hauptdrehung bis zum Überschwingen, wie in `realm.css` (`wheel-spin`, 0 % bis 80 %):
 * sehr schnell los, lang auslaufend. Wer sie dort ändert, ändert sie hier mit.
 */
export const WHEEL_EASE: readonly [number, number, number, number] = [0.13, 0.58, 0.12, 1];
/** Anteil der Drehzeit bis zum äußersten Punkt des Überschwingens (Schlüsselbild 80 %). */
export const WHEEL_MAIN_SHARE = 0.8;

/** Kürzester Abstand zweier Klacker: Darunter flimmerte der Zeiger nur noch. */
export const CLACK_MIN_GAP_MS = 65;
/** Schneller als das (Grad je ms) streift das Rad die Stifte nur, der Zeiger bleibt angelehnt. */
const CLACK_MAX_SPEED = 0.9;
/** Ab diesem Winkel vor der Grenze liegt ein Stift an der Nadel des Zeigers an. */
const CONTACT_DEG = 3;
/** Ausschlag des Zeigers bei einem Klacker in Grad: kräftiger, solange das Rad noch Fahrt hat. */
const KICK_MIN_DEG = 8;
const KICK_MAX_DEG = 15;
const KICK_PER_SPEED = 14;
/** So lange drückt ein Stift den Zeiger höchstens beiseite, bevor er durchrutscht. */
const PUSH_MIN_MS = 14;
const PUSH_MAX_MS = 70;

/** Schneller als das (Grad je ms) ist die Scheibe nur ein Wirbel; langsamer steht sie scharf. */
const BLUR_FULL_SPEED = 1.2;
const BLUR_GONE_SPEED = 0.42;

export interface CubicBezier {
  /** Zeitanteil und Fortschritt am Kurvenparameter `s` (0 bis 1). */
  readonly x: (s: number) => number;
  readonly y: (s: number) => number;
  /** Steigung dy/dx am Kurvenparameter `s`. */
  readonly slope: (s: number) => number;
  /** Kurvenparameter, an dem der Fortschritt `p` erreicht ist. */
  readonly forY: (p: number) => number;
  /** Kurvenparameter zum Zeitanteil `t`. */
  readonly forX: (t: number) => number;
}

/** Eine CSS-Kurve `cubic-bezier(x1, y1, x2, y2)`; x und y steigen beide, wie in CSS üblich. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): CubicBezier {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  const y = (s: number) => ((ay * s + by) * s + cy) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  const dy = (s: number) => (3 * ay * s + 2 * by) * s + cy;
  // Halbieren statt Newton: langsam genug für ein paar Dutzend Aufrufe je Rad, und nie daneben
  const solve = (f: (s: number) => number, target: number) => {
    if (target <= 0) return 0;
    if (target >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 48; i += 1) {
      const mid = (lo + hi) / 2;
      if (f(mid) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return {
    x,
    y,
    slope: (s) => {
      const run = dx(s);
      return run <= 1e-9 ? Number.POSITIVE_INFINITY : dy(s) / run;
    },
    forY: (p) => solve(y, p),
    forX: (t) => solve(x, t),
  };
}

const SPIN = cubicBezier(...WHEEL_EASE);

export interface WheelSweep {
  /** Feldgrenzen der Scheibe in Grad (0 = oben, im Uhrzeigersinn). */
  readonly edges: readonly number[];
  /** Drehung der Scheibe zu Beginn und am äußersten Punkt des Überschwingens, in Grad. */
  readonly from: number;
  readonly to: number;
  /** Ganze Drehzeit in ms (bis das Rad steht). */
  readonly spinMs: number;
}

/** Drehung der Scheibe nach `ms` in der Hauptdrehung, in Grad; danach steht sie bei `to`. */
export function wheelAngleAt(sweep: Pick<WheelSweep, 'from' | 'to' | 'spinMs'>, ms: number) {
  const main = sweep.spinMs * WHEEL_MAIN_SHARE;
  if (main <= 0) return sweep.to;
  const t = Math.min(1, Math.max(0, ms / main));
  return sweep.from + (sweep.to - sweep.from) * SPIN.y(SPIN.forX(t));
}

/** Geschwindigkeit der Scheibe nach `ms` in Grad je ms. */
export function wheelSpeedAt(sweep: Pick<WheelSweep, 'from' | 'to' | 'spinMs'>, ms: number) {
  const main = sweep.spinMs * WHEEL_MAIN_SHARE;
  if (main <= 0 || ms >= main) return 0;
  const s = SPIN.forX(Math.max(0, ms / main));
  return ((sweep.to - sweep.from) * SPIN.slope(s)) / main;
}

export interface WheelPass {
  /** Zeitpunkt, an dem die Grenze genau unter dem Zeiger liegt, ab Beginn der Drehung. */
  readonly atMs: number;
  /** Geschwindigkeit der Scheibe in diesem Augenblick, Grad je ms. */
  readonly speed: number;
  /** Welche Grenze (Winkel auf der Scheibe). */
  readonly edge: number;
}

/**
 * Alle Durchgänge einer Feldgrenze unter dem Zeiger oben, nach der Zeit geordnet. Die Scheibe dreht
 * im Uhrzeigersinn von `from` nach `to`; oben liegt dabei der Winkel `-Drehung` der Scheibe. Ein
 * Rad mit nur einem Feld hat keine Grenze.
 */
export function wheelPasses(sweep: WheelSweep): WheelPass[] {
  const { from, to, spinMs } = sweep;
  const main = spinMs * WHEEL_MAIN_SHARE;
  if (to <= from || main <= 0) return [];
  const passes: WheelPass[] = [];
  for (const edge of sweep.edges) {
    // Oben liegt die Grenze, wenn Drehung + Grenze ein Vielfaches von 360 ist
    const first = Math.floor((from + edge) / 360) + 1;
    const last = Math.floor((to + edge) / 360);
    for (let k = first; k <= last; k += 1) {
      const angle = 360 * k - edge;
      const s = SPIN.forY((angle - from) / (to - from));
      passes.push({
        atMs: SPIN.x(s) * main,
        speed: ((to - from) * SPIN.slope(s)) / main,
        edge,
      });
    }
  }
  return passes.sort((a, b) => a.atMs - b.atMs);
}

export interface WheelClack {
  /** Augenblick, in dem der Stift unter der Spitze durchrutscht, ab Beginn der Drehung. */
  readonly atMs: number;
  /** So lange drückt der Stift den Zeiger vorher beiseite. */
  readonly pushMs: number;
  /** Ausschlag in Grad, in Drehrichtung des Rads. */
  readonly kick: number;
}

/**
 * Klacker des Zeigers: nur in der langsamen Phase und nur an Durchgängen, die weit genug vom
 * vorigen entfernt liegen; davor stehen die Stifte so dicht, dass der Zeiger nur angelehnt
 * mitläuft. Der letzte Durchgang, über den das Rad ins gezogene Feld läuft, klackert immer: Liegt
 * ein anderer zu dicht davor, fällt jener weg. Je langsamer das Rad, desto länger drückt ein Stift
 * und desto kleiner ist der Ausschlag: Die letzten Klacker kommen zögernd.
 */
export function wheelClacks(sweep: WheelSweep, minGapMs = CLACK_MIN_GAP_MS): WheelClack[] {
  const passes = wheelPasses(sweep);
  // Gezählt ab dem Anlaufen: Die Scheibe erscheint schon in voller Fahrt
  const candidates = passes.filter((pass, index) => {
    if (pass.speed > CLACK_MAX_SPEED) return false;
    if (index === passes.length - 1) return true;
    return pass.atMs - (passes[index - 1]?.atMs ?? 0) >= minGapMs;
  });
  const chosen: WheelPass[] = [];
  let next = Number.POSITIVE_INFINITY;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const pass = candidates[index];
    if (!pass || next - pass.atMs < minGapMs) continue;
    chosen.unshift(pass);
    next = pass.atMs;
  }
  return chosen.map((pass) => {
    const speed = Math.max(pass.speed, 1e-3);
    return {
      atMs: pass.atMs,
      pushMs: Math.min(PUSH_MAX_MS, Math.max(PUSH_MIN_MS, CONTACT_DEG / speed)),
      kick: Math.min(KICK_MAX_DEG, Math.max(KICK_MIN_DEG, KICK_MIN_DEG + KICK_PER_SPEED * speed)),
    };
  });
}

export interface WheelBlur {
  /** Bis dahin ist die Scheibe ganz verwischt. */
  readonly fullMs: number;
  /** Ab da steht sie scharf. */
  readonly goneMs: number;
}

/**
 * Wie lange die Scheibe verwischt aussieht: voll, solange sie schneller als ein Wirbel dreht, dann
 * blendet der Schleier aus, bis sie langsam genug ist, dass Felder und Zeichen stehen.
 */
export function wheelBlur(sweep: Pick<WheelSweep, 'from' | 'to' | 'spinMs'>): WheelBlur {
  const main = sweep.spinMs * WHEEL_MAIN_SHARE;
  if (main <= 0 || sweep.to <= sweep.from) return { fullMs: 0, goneMs: 0 };
  // Die Geschwindigkeit fällt über die ganze Kurve: Halbieren findet die Schwellen
  const when = (speed: number) => {
    let lo = 0;
    let hi = main;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (wheelSpeedAt(sweep, mid) > speed) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const goneMs = when(BLUR_GONE_SPEED);
  return { fullMs: Math.min(goneMs, when(BLUR_FULL_SPEED)), goneMs };
}
