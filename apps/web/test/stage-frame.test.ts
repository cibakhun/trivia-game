import { KERNMARK, WENDELMARK } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import { mapArt } from '../src/art/map-art.ts';
import { stageFrame, type StageArea } from '../src/art/stage-frame.ts';

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
