/**
 * Ausschnitt der Karte für die Bühne der Partie (ADR-059): Die Karte füllt den ganzen Bildschirm,
 * das Land liegt genau in der freien Fläche zwischen den Rändern mit Spielstand und Blatt. Der
 * Ausschnitt hängt nur an der Größe des Bildschirms, nie am Zustand der Partie: Die Karte bleibt
 * an derselben Stelle.
 */

/** Freie Fläche in Bildschirmpunkten, gemessen ab der linken oberen Ecke der Bühne. */
export interface StageArea {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface StageFrame {
  /** `viewBox` der Karte: so viele Karteneinheiten zeigt die Bühne. */
  readonly viewBox: string;
  /** Bildschirmpunkte je Karteneinheit. */
  readonly scale: number;
}

/** Unter diesem Maßstab ist das Land klein (Handy): größere Schrift, weniger Zierde. */
export const COMPACT_SCALE = 0.8;

/**
 * Ausschnitt, bei dem das Land (`land`, der enge `viewBox` der Karte) genau in `area` passt und
 * mittig darin liegt; `width` und `height` sind die Maße der Bühne. `null`, solange nichts zu
 * messen ist.
 */
export function stageFrame(
  land: string,
  area: StageArea,
  width: number,
  height: number,
): StageFrame | null {
  const [lx, ly, lw, lh] = land.split(/\s+/).map(Number);
  const w = area.x1 - area.x0;
  const h = area.y1 - area.y0;
  if (
    lx === undefined ||
    ly === undefined ||
    lw === undefined ||
    lh === undefined ||
    ![lx, ly, lw, lh, w, h, width, height].every(Number.isFinite) ||
    !(lw > 0 && lh > 0 && w > 0 && h > 0 && width > 0 && height > 0)
  ) {
    return null;
  }
  const scale = Math.min(w / lw, h / lh);
  const cx = (area.x0 + area.x1) / 2;
  const cy = (area.y0 + area.y1) / 2;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    viewBox: [
      round(lx + lw / 2 - cx / scale),
      round(ly + lh / 2 - cy / scale),
      round(width / scale),
      round(height / scale),
    ].join(' '),
    scale,
  };
}
