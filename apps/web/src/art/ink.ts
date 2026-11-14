import type { CSSProperties } from 'react';
import { seeded } from './noise.ts';

/**
 * Nasse Tinte: Wie sich die Farbe eines neuen Besitzers in einer Region ausbreitet
 * (docs/ART_DIRECTION.md §5, Animation `ink-spread` in map-art.css). Statt eines wachsenden
 * Kreises ein Klecks mit unruhigem, lebendigem Rand: Er schießt mit Fingern vor, wird langsamer
 * und schließt sich zuletzt über der ganzen Region. Dazu eine dunklere nasse Kante, die beim
 * Trocknen verblasst.
 *
 * Jede Region hat ihren eigenen, fest gewürfelten Klecks (gleiche Region, gleiche Form, auf jedem
 * Gerät). Die Schlüsselbilder haben alle gleich viele Punkte, damit der Browser zwischen ihnen
 * überblenden kann (auch WebKit), und jeder Punkt liegt auf einem festen Strahl vom Ursprung aus,
 * der Klecks wächst auf jedem Strahl nur nach außen: So überschneidet sich der Rand nie selbst.
 *
 * Gerechnet wird in Prozent des Rahmens der Region (die Bezugsgröße von `clip-path`; bei SVG der
 * Rahmen samt Strich, WebKit kennt kein `fill-box` darin: Jede beschnittene Gruppe trägt deshalb
 * denselben unsichtbaren Rahmen `ink-frame`, damit alle Schichten genau übereinanderliegen). Die CSS
 * kennt nur Variablen (`--ink-0` … und `--wet-0` …); Ursprung und Reichweite stecken in ihnen,
 * der Takt in `--ink-at` und `--ink-ms`. Der Name der Animation bleibt so bei jeder Einfärbung
 * derselbe (ART_DIRECTION §5).
 */

/** Lage der Schlüsselbilder in der Dauer; `ink-spread` und `ink-wet` in map-art.css haben dieselben. */
export const INK_STOPS: readonly number[] = [0, 0.14, 0.32, 0.56, 0.8, 1];

/** Punkte je Schlüsselbild. */
export const INK_POINTS = 22;

export interface InkPoint {
  readonly x: number;
  readonly y: number;
}

/** Rahmen einer Region in Karteneinheiten. */
export interface InkBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface InkBlob {
  /** Rand der Farbe je Schlüsselbild: Punktliste in Prozent, geschlossen. */
  readonly edge: readonly string[];
  /** Innenrand der nassen Kante je Schlüsselbild, ebenso; zusammen mit `edge` ein Ring. */
  readonly wet: readonly string[];
}

/** Rahmen um einen Umriss. */
export function inkBox(outline: readonly InkPoint[]): InkBox {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Wo die Tinte einläuft, in Prozent des Rahmens: an der Stelle, an der die Linie von `from` zur
 * Mitte `centre` den Umriss zuletzt kreuzt, bevor sie die Mitte erreicht (die Grenze, über die
 * der Sieger kommt). Ohne `from` oder ohne Kreuzung: die Mitte selbst.
 */
export function inkOrigin(
  outline: readonly InkPoint[],
  box: InkBox,
  centre: InkPoint,
  from: InkPoint | null = null,
): InkPoint {
  let entry = centre;
  if (from) {
    let best = -1;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!;
      const b = outline[(i + 1) % outline.length]!;
      const t = crossing(from, centre, a, b);
      if (t !== null && t > best) {
        best = t;
        entry = { x: from.x + (centre.x - from.x) * t, y: from.y + (centre.y - from.y) * t };
      }
    }
  }
  return {
    x: round1(((entry.x - box.x) / (box.width || 1)) * 100),
    y: round1(((entry.y - box.y) / (box.height || 1)) * 100),
  };
}

/** Anteil auf der Strecke p→q, an dem sie die Strecke a→b schneidet; `null` ohne Schnitt. */
function crossing(p: InkPoint, q: InkPoint, a: InkPoint, b: InkPoint): number | null {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den;
  const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Weiteste Ecke des Rahmens vom Ursprung aus, in Prozent: So weit muss die Tinte reichen. */
export function inkReach(origin: InkPoint): number {
  return Math.max(
    Math.hypot(origin.x, origin.y),
    Math.hypot(100 - origin.x, origin.y),
    Math.hypot(origin.x, 100 - origin.y),
    Math.hypot(100 - origin.x, 100 - origin.y),
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Halbmesser des Kerns je Schlüsselbild als Anteil der Reichweite: schnell heraus, dann zäh. */
const GROWTH = [0.05, 0.34, 0.62, 0.84, 0.96, 1.08];
/** Wie stark der Rand ausfranst: Am meisten, solange die Tinte läuft; am Ende fast rund. */
const FRAY = [0.15, 0.34, 0.3, 0.22, 0.14, 0.04];
/** Breite der nassen Kante in Prozent des Rahmens. */
const WET = [100, 10, 8.5, 7, 5.5, 3];

/**
 * Klecks einer Region: `seed` macht die Form (etwa Karte und Region), `origin` ist der Ursprung in
 * Prozent des Rahmens, `reach` die Reichweite in Prozent (`inkReach`). Das letzte Schlüsselbild
 * deckt den Rahmen sicher ganz.
 */
export function inkBlob(seed: string, origin: InkPoint, reach: number): InkBlob {
  const rand = seeded(`ink:${seed}`);
  const n = INK_POINTS;
  // Zwei glatte Rauschfelder über den Winkel; der Rand wandert vom einen zum anderen, so laufen
  // Finger vor und andere holen auf. Dazu je Punkt etwas Körnung für den unruhigen Rand.
  const field = () => {
    const parts = [2, 3, 5, 7].map((m, i) => ({
      m,
      phase: rand() * Math.PI * 2,
      weight: 1 / (i + 1),
    }));
    const total = parts.reduce((sum, p) => sum + p.weight, 0);
    return (angle: number) =>
      parts.reduce((sum, p) => sum + p.weight * Math.sin(p.m * angle + p.phase), 0) / total;
  };
  const early = field();
  const late = field();
  const rays = Array.from({ length: n }, (_, i) => {
    const angle = ((i + 0.6 * (rand() - 0.5)) / n) * Math.PI * 2;
    return { angle, cos: Math.cos(angle), sin: Math.sin(angle), grain: rand() - 0.5 };
  });
  const last = INK_STOPS.length - 1;
  const radii: number[][] = [];
  INK_STOPS.forEach((stop, k) => {
    radii.push(
      rays.map((ray, i) => {
        const noise = (1 - stop) * early(ray.angle) + stop * late(ray.angle) + 0.45 * ray.grain;
        const grown = reach * GROWTH[k]! * (1 + FRAY[k]! * noise);
        // Auf jedem Strahl nur nach außen; das letzte Bild reicht überall über den Rahmen hinaus
        const before = k > 0 ? radii[k - 1]![i]! : 0;
        return k === last ? Math.max(grown, before, reach * 1.08) : Math.max(grown, before);
      }),
    );
  });
  const list = (rs: readonly number[]) => {
    const points = rays.map(
      (ray, i) => `${round1(origin.x + rs[i]! * ray.cos)}% ${round1(origin.y + rs[i]! * ray.sin)}%`,
    );
    // Geschlossen: Der Ring der nassen Kante setzt den Innenrand an den ersten Punkt
    return [...points, points[0]].join(',');
  };
  return {
    edge: radii.map(list),
    wet: radii.map((rs, k) => list(rs.map((r) => Math.max(0, r - WET[k]!)))),
  };
}

/** Variablen für die CSS: je Schlüsselbild Rand und Innenrand der nassen Kante. */
export function inkStyle(blob: InkBlob): CSSProperties {
  const style: Record<string, string> = {};
  blob.edge.forEach((edge, k) => {
    style[`--ink-${k}`] = edge;
  });
  blob.wet.forEach((wet, k) => {
    style[`--wet-${k}`] = wet;
  });
  return style;
}
