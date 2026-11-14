import { KERNMARK, WENDELMARK } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import { mapArt } from '../src/art/map-art.ts';
import {
  isLowStage,
  LOW_STAGE,
  seaDepth,
  stageFrame,
  type StageArea,
} from '../src/art/stage-frame.ts';

/**
 * Ausschnitt der Karte auf der Bühne (ADR-059): Die Karte füllt den Bildschirm, das Land liegt
 * ganz in der freien Fläche zwischen den Rändern, mittig und so groß wie möglich.
 */

/** Rand des Landes in Bildschirmpunkten, wenn die Karte mit `viewBox` den Bildschirm füllt. */
function landOnScreen(land: string, viewBox: string, scale: number) {
  const [lx = 0, ly = 0, lw = 0, lh = 0] = land.split(' ').map(Number);
  const [vx = 0, vy = 0] = viewBox.split(' ').map(Number);
  return {
    x0: (lx - vx) * scale,
    y0: (ly - vy) * scale,
    x1: (lx + lw - vx) * scale,
    y1: (ly + lh - vy) * scale,
  };
}

// iPhone quer in Safari: 844 × 340, links der Spielstand, rechts das Blatt
const PHONE: StageArea = { x0: 195, y0: 5, x1: 597, y1: 335 };

describe('Ausschnitt der Karte auf der Bühne', () => {
  for (const map of [WENDELMARK, KERNMARK]) {
    it(`legt das Land der ${map.name} ganz zwischen die Ränder`, () => {
      const land = mapArt(map).tightViewBox;
      const frame = stageFrame(land, PHONE, 844, 340);
      if (!frame) throw new Error('kein Ausschnitt');
      const box = landOnScreen(land, frame.viewBox, frame.scale);
      expect(box.x0).toBeGreaterThanOrEqual(PHONE.x0 - 0.5);
      expect(box.x1).toBeLessThanOrEqual(PHONE.x1 + 0.5);
      expect(box.y0).toBeGreaterThanOrEqual(PHONE.y0 - 0.5);
      expect(box.y1).toBeLessThanOrEqual(PHONE.y1 + 0.5);
      // Mittig, und eine der beiden Richtungen ist ausgereizt
      expect((box.x0 + box.x1) / 2).toBeCloseTo((PHONE.x0 + PHONE.x1) / 2, 0);
      expect((box.y0 + box.y1) / 2).toBeCloseTo((PHONE.y0 + PHONE.y1) / 2, 0);
      const usedX = (box.x1 - box.x0) / (PHONE.x1 - PHONE.x0);
      const usedY = (box.y1 - box.y0) / (PHONE.y1 - PHONE.y0);
      expect(Math.max(usedX, usedY)).toBeCloseTo(1, 2);
    });
  }

  it('zeigt genau den Bildschirm: Das Meer reicht bis an alle Ränder', () => {
    const frame = stageFrame('10 20 400 300', PHONE, 844, 340);
    if (!frame) throw new Error('kein Ausschnitt');
    const [, , width = 0, height = 0] = frame.viewBox.split(' ').map(Number);
    expect(width * frame.scale).toBeCloseTo(844, 0);
    expect(height * frame.scale).toBeCloseTo(340, 0);
  });

  it('richtet sich nach der knapperen Richtung', () => {
    // Breites Land: Die Breite der freien Fläche begrenzt
    const wide = stageFrame('0 0 800 100', PHONE, 844, 340);
    expect(wide?.scale).toBeCloseTo((PHONE.x1 - PHONE.x0) / 800, 5);
    // Hohes Land: Die Höhe begrenzt
    const tall = stageFrame('0 0 100 660', PHONE, 844, 340);
    expect(tall?.scale).toBeCloseTo((PHONE.y1 - PHONE.y0) / 660, 5);
  });

  it('liefert nichts, solange nichts zu messen ist', () => {
    // Ränder ausgeblendet (Hochformat): Die freie Fläche hat keine Breite
    expect(stageFrame('0 0 400 300', { x0: 8, y0: 5, x1: -8, y1: 335 }, 390, 844)).toBeNull();
    expect(stageFrame('0 0 400 300', PHONE, 0, 0)).toBeNull();
    expect(stageFrame('kaputt', PHONE, 844, 340)).toBeNull();
    expect(stageFrame('0 0 0 300', PHONE, 844, 340)).toBeNull();
  });
});

/**
 * Niedrige Bühne (ADR-068): Ob das Blatt zusammenrückt, hängt an der gemessenen Fläche der Bühne.
 * Am 2026-11-14 fehlte dem Product Owner in Chrome auf dem iPhone die Zeile „Ziehen“: Die
 * Medienabfrage sah quer den ganzen Bildschirm (932 × 430), sichtbar waren 354 Punkte Höhe.
 */
describe('Niedrige Bühne', () => {
  it('ist niedrig, wenn die Leiste des Browsers Höhe nimmt', () => {
    // iPhone quer in Safari und die Maße aus dem Spieltest (Chrome, iPhone mit 932 Punkten Breite)
    expect(isLowStage(844, 340)).toBe(true);
    expect(isLowStage(932, 354)).toBe(true);
    expect(isLowStage(740, 280)).toBe(true);
  });

  it('ist nicht niedrig, wo das Blatt in voller Höhe passt', () => {
    // Ohne Leiste (Vollbild), kleines iPhone quer, Tablet und Fenster am Rechner
    expect(isLowStage(844, 390)).toBe(false);
    expect(isLowStage(932, 430)).toBe(false);
    expect(isLowStage(667, 375)).toBe(false);
    expect(isLowStage(1024, 768)).toBe(false);
    expect(isLowStage(1280, 720)).toBe(false);
  });

  it('lässt keine Lücke zwischen beiden Fassungen des Blatts', () => {
    // In voller Höhe braucht das Blatt der Rüstzeit 385 Punkte der Bühne (gemessen am Prüfstand):
    // Jede Bühne darunter muss als niedrig gelten, sonst liegt die dritte Zeile unter dem Rand
    for (let height = 300; height < 386; height += 1) {
      expect(isLowStage(844, height), `844 × ${height}`).toBe(true);
    }
    // Das Maß der Bühne folgt der Breite: Dasselbe gilt für jedes breitere oder schmalere Handy
    for (const width of [667, 740, 800, 896, 932, 1000]) {
      const full = Math.ceil((width * 385) / 844);
      expect(isLowStage(width, full - 1), `${width} × ${full - 1}`).toBe(true);
    }
    expect(844 / LOW_STAGE).toBeGreaterThan(385);
    expect(844 / LOW_STAGE).toBeLessThan(390);
  });

  it('gilt nicht, solange nichts zu messen ist', () => {
    expect(isLowStage(0, 0)).toBe(false);
    expect(isLowStage(844, 0)).toBe(false);
    expect(isLowStage(Number.NaN, 340)).toBe(false);
    expect(isLowStage(844, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('Tiefe des Meers', () => {
  it('liegt um die Mitte des sichtbaren Bilds und reicht bis in dessen Ecken', () => {
    const depth = seaDepth('-206 51 1235 571');
    expect(depth).toEqual({ cx: 411.5, cy: 336.5, r: 680.31 });
    if (!depth) throw new Error('keine Tiefe');
    // Die Ecke des Bilds liegt genau auf dem Rand des Kreises: Dort ist das Meer am dunkelsten
    expect(Math.hypot(-206 - depth.cx, 51 - depth.cy)).toBeCloseTo(depth.r, 1);
  });

  it('bleibt im sichtbaren Bild: Schon am linken und rechten Rand dunkelt das Meer nach', () => {
    const frame = stageFrame(mapArt(WENDELMARK).tightViewBox, PHONE, 844, 340);
    if (!frame) throw new Error('kein Ausschnitt');
    const depth = seaDepth(frame.viewBox);
    if (!depth) throw new Error('keine Tiefe');
    const [, , width = 0] = frame.viewBox.split(' ').map(Number);
    // Der Verlauf beginnt bei der Hälfte des Radius: Der Rand des Bilds liegt dahinter
    expect(width / 2).toBeGreaterThan(depth.r / 2);
    expect(width / 2).toBeLessThan(depth.r);
  });

  it('liefert nichts für einen Ausschnitt, der nicht zu lesen ist', () => {
    expect(seaDepth('kaputt')).toBeNull();
    expect(seaDepth('0 0 0 300')).toBeNull();
    expect(seaDepth('0 0 400')).toBeNull();
  });
});
