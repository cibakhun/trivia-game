import { KERNMARK, WENDELMARK } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import { ART_HEX_SIZE, mapArt } from '../src/art/map-art.ts';
import {
  bearerNameGap,
  bearerRoom,
  boxClearance,
  decorClear,
  FIELD_BEARER,
  fieldPlan,
  KEEP,
} from '../src/match/field-plan.ts';

/**
 * Lageplan der Felder mit Ausbau: Bannerträger, Münze und Burg mit Träger bleiben im Feld. Ein
 * fester Platz stand auf der großen Karte in 36 von 48 Fällen an oder über der Grenze. Erlaubt
 * ist höchstens, die Grenzlinie selbst zu berühren (sie ist 2,6 Einheiten breit).
 */
const s = ART_HEX_SIZE;
const LINE = -3.5;

describe.each([
  ['Wendelmark', WENDELMARK],
  ['Kernmark', KERNMARK],
])('Lageplan auf %s', (_, map) => {
  const art = mapArt(map);

  it('stellt den Träger eines Felds ganz hinein, unter den Namen', () => {
    for (const region of art.regions) {
      const plan = fieldPlan(region, s);
      const b = FIELD_BEARER.field * s;
      expect(bearerRoom(plan.bearer, b, region.outline), region.name).toBeGreaterThan(0);
      expect(bearerNameGap(region, plan.bearer, b, s), region.name).toBeGreaterThan(-2.5);
      expect(bearerRoom(plan.bearerWithCoin, b, region.outline), region.name).toBeGreaterThan(LINE);
      expect(plan.bearer.y, region.name).toBeGreaterThan(region.cy);
    }
  });

  it('legt die Münze neben den Träger, nicht auf ihn und nicht über die Grenze', () => {
    for (const region of art.regions) {
      const plan = fieldPlan(region, s);
      const r = 0.17 * 1.25 * s;
      const coin: [number, number, number, number] = [
        plan.coin.x - r * 0.7,
        plan.coin.y - r * 0.7,
        plan.coin.x + r * 0.7,
        plan.coin.y + r * 0.7,
      ];
      expect(boxClearance(coin, region.outline), region.name).toBeGreaterThan(LINE);
      // Seitlich neben dem Träger: Abstand der Mitten mindestens halbe Fahne plus Münze
      const apart = Math.abs(plan.coin.x - plan.bearerWithCoin.x);
      expect(apart, region.name).toBeGreaterThan(0.485 * FIELD_BEARER.field * s + r);
    }
  });

  it('rückt Burg, Lebensschilde und Träger so, dass sie im Feld bleiben', () => {
    for (const region of art.regions) {
      const { keep } = fieldPlan(region, s);
      const bearer = {
        x: region.cx + KEEP.bearerX * s + keep.x,
        y: region.cy + KEEP.bearerY * s + keep.y,
      };
      expect(
        bearerRoom(bearer, FIELD_BEARER.castle * s, region.outline),
        region.name,
      ).toBeGreaterThan(LINE);
      const x = region.cx + KEEP.beside * s + keep.x;
      const y = region.cy + KEEP.y * s + keep.y;
      const z = KEEP.size * s;
      const walls: [number, number, number, number] = [
        x - 0.48 * z,
        y - 0.3 * z,
        x + 0.48 * z,
        y + 0.42 * z,
      ];
      expect(boxClearance(walls, region.outline), region.name).toBeGreaterThan(0);
      // Die Fahne der Burg bleibt unter dem Namen darüber
      expect(keep.y, region.name).toBeGreaterThanOrEqual(0);
    }
  });

  it('nimmt Landschaft weg, die auf dem Platz der Armee stünde, und nur die', () => {
    let dropped = 0;
    let kept = 0;
    for (const region of art.regions) {
      const clear = decorClear(region, s, false);
      for (const d of region.decor) {
        if (clear(d)) kept++;
        else dropped++;
      }
      // Gleich, ob eine Armee dort steht: dieselbe Antwort bei jedem Aufruf
      expect(region.decor.map(decorClear(region, s, false))).toEqual(region.decor.map(clear));
    }
    expect(kept).toBeGreaterThan(dropped * 3);
  });

  it('rechnet jedes Feld nur einmal', () => {
    const region = art.regions[0]!;
    expect(fieldPlan(region, s)).toBe(fieldPlan(region, s));
  });
});
