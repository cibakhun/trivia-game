import { describe, expect, it } from 'vitest';
import { placeOf } from '../src/modules/match/view.ts';

/** Platz einer beendeten Partie für die Chronik im Hauptmenü, gelesen aus der Abrechnung. */
describe('Platz in der Chronik', () => {
  const payload = {
    standings: [
      { seat: 1, place: 1 },
      { seat: 0, place: 2 },
      { seat: 2, place: 2 },
    ],
  };

  it('liest den eigenen Platz, auch einen geteilten', () => {
    expect(placeOf(payload, 1)).toBe(1);
    expect(placeOf(payload, 0)).toBe(2);
    expect(placeOf(payload, 2)).toBe(2);
  });

  it('kennt keinen Platz ohne Sitz, ohne Abrechnung oder mit fremdem Inhalt', () => {
    expect(placeOf(payload, null)).toBeNull();
    expect(placeOf(payload, 3)).toBeNull();
    expect(placeOf(null, 0)).toBeNull();
    expect(placeOf({}, 0)).toBeNull();
    expect(placeOf({ standings: 'Sieg' }, 0)).toBeNull();
    expect(
      placeOf(
        {
          standings: [
            { seat: 0, place: 0 },
            { seat: 0, place: 1.5 },
          ],
        },
        0,
      ),
    ).toBeNull();
  });

  it('bleibt höchstens Dritter', () => {
    expect(placeOf({ standings: [{ seat: 0, place: 4 }] }, 0)).toBe(3);
  });
});
