import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { flightTrail } from '../src/match/Flights.tsx';
import {
  incomeHeld,
  incomeTiming,
  incomeWatch,
  type IncomeWatch,
} from '../src/match/income-flight.ts';
import { seatNames } from '../src/match/match-text.ts';
import { realmPlayOf } from '../src/match/realm-model.ts';
import { RealmSeatList } from '../src/match/RealmSeatList.tsx';
import { realmViewOf } from './match-fixtures.ts';

/**
 * Zeitplan des Einkommens als Bewegung (ADR-067): Die Zeichen fliegen nacheinander ab, die Vorräte
 * zählen mit den Ankünften mit, und auch ein großes Reich braucht nicht länger als ein kleines.
 */

describe('Zeitplan des Einkommens', () => {
  it('lässt ein einzelnes Zeichen ohne Abstand fliegen', () => {
    const one = incomeTiming(1);
    expect(one.staggerMs).toBe(0);
    expect(one.countAtMs).toBeLessThan(one.startMs + one.flightMs);
    expect(one.totalMs).toBeGreaterThan(one.startMs + one.flightMs);
    expect(incomeTiming(0).staggerMs).toBe(0);
  });

  it('staffelt wenige Zeichen mit festem Abstand', () => {
    expect(incomeTiming(4).staggerMs).toBe(80);
    expect(incomeTiming(9).staggerMs).toBe(80);
  });

  it('rückt viele Zeichen enger zusammen, damit es nicht länger dauert', () => {
    const many = incomeTiming(24);
    expect(many.staggerMs).toBeLessThan(80);
    expect(many.staggerMs * 23).toBeCloseTo(640, 6);
    expect(many.totalMs).toBe(incomeTiming(9).totalMs);
    // Alle Zeichen sind nach rund 2 s angekommen, das Nachfedern im Vorrat folgt
    expect(many.landedMs).toBeLessThanOrEqual(1700);
    expect(many.totalMs).toBeLessThanOrEqual(2700);
  });

  it('räumt erst ab, wenn alle Zeichen da sind und der Vorrat ausgefedert hat (ADR-070)', () => {
    for (const count of [0, 1, 3, 9, 24]) {
      const time = incomeTiming(count);
      expect(time.totalMs).toBeGreaterThan(time.landedMs);
      // Ring und Verlöschen nach dem letzten Zeichen brauchen bis zu 0,74 s (realm.css)
      expect(time.totalMs - (time.countAtMs + time.countMs)).toBeGreaterThanOrEqual(740);
    }
  });

  it('zählt die Vorräte vom ersten bis zum letzten Zeichen hoch', () => {
    for (const count of [1, 3, 9, 24]) {
      const time = incomeTiming(count);
      const first = time.startMs + time.flightMs;
      const last = first + (count - 1) * time.staggerMs;
      expect(time.countAtMs).toBeLessThanOrEqual(first);
      expect(time.countAtMs + time.countMs).toBeGreaterThanOrEqual(last);
      expect(time.totalMs).toBeGreaterThan(time.countAtMs + time.countMs);
    }
  });
});

/**
 * Der Server verbucht das Einkommen mit dem Ende des letzten Duells der Runde, die Rüstzeit beginnt
 * erst nach dessen Auflösung. Die Vorräte warten so lange, sonst stünde die neue Zahl schon da,
 * bevor ein Zeichen fliegt.
 */
describe('Einkommen zwischen Verbuchen und Rüstzeit', () => {
  const before: IncomeWatch = { seen: 40, playing: null, rising: null };

  it('hält ein Einkommen zurück, das während der Auflösung kommt', () => {
    const during = incomeWatch(before, 57, false, false, true);
    expect(during).toBe(before);
    expect(incomeHeld(during, 57)).toBe(true);
  });

  it('lässt es fliegen, sobald die eigene Rüstzeit steht, und gibt die Vorräte frei', () => {
    const start = incomeWatch(before, 57, true, true, true);
    expect(start).toEqual({ seen: 57, playing: 57, rising: 57 });
    expect(incomeHeld(start, 57)).toBe(false);
    // Danach ändert sich nichts mehr, bis das nächste Einkommen kommt
    expect(incomeWatch(start, 57, true, true, true)).toBe(start);
  });

  it('zeigt nur die Zahl, wenn die Seite den Wechsel nicht miterlebt hat', () => {
    const start = incomeWatch(before, 57, true, true, false);
    expect(start).toEqual({ seen: 57, playing: null, rising: null });
    expect(incomeHeld(start, 57)).toBe(false);
  });

  it('gibt die Vorräte frei, wenn die Partie ohne eigene Rüstzeit weitergeht', () => {
    // Zuschauer, gefallenes Reich, nur noch Bots: Es fliegt nichts, die Zahlen zählen hoch und
    // die Tafeln schimmern, weil die Seite den Wechsel miterlebt hat
    const on = incomeWatch(before, 57, false, true, true);
    expect(on).toEqual({ seen: 57, playing: null, rising: 57 });
    expect(incomeWatch(before, 57, false, true, false)).toEqual({
      seen: 57,
      playing: null,
      rising: null,
    });
    expect(incomeHeld(on, 57)).toBe(false);
  });

  it('hält nichts zurück, wenn die Seite mit diesem Stand geladen wurde', () => {
    const loaded: IncomeWatch = { seen: 57, playing: null, rising: null };
    expect(incomeHeld(loaded, 57)).toBe(false);
    expect(incomeWatch(loaded, 57, false, false, false)).toBe(loaded);
  });
});

/**
 * Ankunft im Vorrat (ADR-070): Das Einkommen fliegt in den Vorrat im Blatt der Rüstzeit rechts. Nur
 * die Zeichen, die wirklich ankommen, heben sich dort; die eigene Tafel links zählt nur mit, die
 * Tafeln der anderen schimmern, wenn ihr Vorrat hochzählt. Bei vielen Feldern bleibt die Spur
 * schmal.
 */
describe('Tafeln beim Einkommen', () => {
  const view = realmViewOf();
  const play = realmPlayOf(view);
  if (!play) throw new Error('Ansicht ohne Brett');
  const mine = view.mySeat ?? 0;
  const render = (props: Partial<Parameters<typeof RealmSeatList>[0]>) =>
    renderToStaticMarkup(
      createElement(RealmSeatList, { view, play, name: seatNames(view), ...props }),
    );
  const tag = (html: string, seat: number) =>
    new RegExp(`<li class="(plaque realm seat-${seat}(?: [^"]*)?)"`).exec(html)?.[1] ?? '';

  it('hebt auf der eigenen Tafel nichts: Das Einkommen landet im Blatt rechts', () => {
    const html = render({ receiving: { delayMs: 990, durationMs: 760 } });
    expect(tag(html, mine)).not.toContain('receiv');
    expect(html).not.toContain('--receive-');
  });

  it('lässt die anderen Reiche schimmern, nie das eigene, in das gerade geflogen wird', () => {
    const others = play.board.seats.map((s) => s.seat).filter((seat) => seat !== mine);
    const html = render({
      receiving: { delayMs: 990, durationMs: 760 },
      gaining: play.board.seats.map((s) => s.seat),
    });
    for (const seat of others) expect(tag(html, seat)).toContain('gaining');
    expect(tag(html, mine)).not.toContain('gaining');
    expect(render({})).not.toContain('gaining');
  });

  it('zieht bei vielen Feldern nur einen Glanzpunkt nach', () => {
    expect(flightTrail('token', 4)).toBe(2);
    expect(flightTrail('token', 24)).toBe(1);
    expect(flightTrail('coin', 1)).toBe(3);
  });
});
