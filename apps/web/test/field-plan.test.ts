import { KERNMARK, WENDELMARK } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import { ART_HEX_SIZE, mapArt } from '../src/art/map-art.ts';
import {
  bearerNameGap,
  bearerRoom,
  boxClearance,
  coinRoom,
  decorClear,
  FIELD_BEARER,
  fieldPlan,
  KEEP,
} from '../src/match/field-plan.ts';

/**
 * Lageplan der Felder mit Ausbau: Bannerträger, Münze und Burg mit Träger bleiben im Feld. Ein
 * fester Platz stand auf der großen Karte in 36 von 48 Fällen an oder über der Grenze. Erlaubt
 * ist höchstens, die gezeichnete Grenze zu berühren: Zwischen zwei Reichen ist sie mit ihrer dunklen
 * Kante 5,8 Einheiten breit (`.frontier-casing`), die Hälfte davon liegt außerhalb des Umrisses.
 * Gemessen wird die Münze als ganzer Kreis samt Rand, so groß wie auf dem Handy.
 */
const s = ART_HEX_SIZE;
const LINE = -5.8 / 2;
/**
 * Neben einer Burg stehen Burg, drei Lebensschilde, Träger und Münze in einem Feld, und die Münze
 * berührt keins davon: Dort dürfen Schilde und Münze bis 5 Einheiten über den Umriss ragen, gut
 * 2 über die Kante der Grenze (etwa ein Pixel auf dem Handy).
 */
const KEEP_LINE = -5;
/**
 * Die engsten Felder, mit eigenem Maß: Auf Graufurt (Wendelmark) liegt schon die Münze neben dem
 * Träger knapp über der Kante, und neben der Burg ragt sie weit über die Grenze, wie vor dem
 * Lageplan; auf Otterbruch etwas weniger. Beides nur, wenn dort eine Burg mit Armee eine Münze trägt.
 */
const TIGHT: Readonly<Record<string, { readonly coin?: number; readonly keep?: number }>> = {
  Graufurt: { coin: -3.5, keep: -18 },
  Otterbruch: { keep: -8.5 },
};

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
      const r = (0.17 + 1.2 / 60) * 1.25 * s;
      expect(coinRoom(plan.coin, s, region.outline), region.name).toBeGreaterThan(
        TIGHT[region.name]?.coin ?? LINE,
      );
      // Seitlich neben dem Träger: Abstand der Mitten mindestens halbe Fahne plus Münze
      const apart = Math.abs(plan.coin.x - plan.bearerWithCoin.x);
      expect(apart, region.name).toBeGreaterThan(0.485 * FIELD_BEARER.field * s + r);
    }
  });

  it('rückt Burg, Lebensschilde, Träger und Münze so, dass sie im Feld bleiben', () => {
    for (const region of art.regions) {
      const { keep, keepCoin } = fieldPlan(region, s);
      const line = TIGHT[region.name]?.keep ?? KEEP_LINE;
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
      expect(boxClearance(walls, region.outline), region.name).toBeGreaterThan(LINE);
      // Drei Lebensschilde in einer Reihe unter der Burg
      const reach = (KEEP.livesGap + KEEP.life / 2) * s;
      const livesY = region.cy + KEEP.livesY * s + keep.y;
      const lives: [number, number, number, number] = [
        x - reach,
        livesY - (KEEP.life / 2) * s,
        x + reach,
        livesY + (KEEP.life / 2) * s,
      ];
      expect(boxClearance(lives, region.outline), region.name).toBeGreaterThan(line);
      expect(coinRoom(keepCoin, s, region.outline), region.name).toBeGreaterThan(line);
      // Die Fahne der Burg bleibt unter dem Namen darüber
      expect(keep.y, region.name).toBeGreaterThanOrEqual(0);
    }
  });

  it('nimmt Landschaft weg, die auf dem Platz der Armee stünde, und nur einen kleinen Teil', () => {
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
    expect(dropped).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(dropped * 3);
  });

  it('rechnet jedes Feld nur einmal', () => {
    const region = art.regions[0]!;
    expect(fieldPlan(region, s)).toBe(fieldPlan(region, s));
  });
});
