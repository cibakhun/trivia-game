import { WENDELMARK } from '@rdw/game-core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatchBoard, type BoardState } from '../src/match/MatchBoard.tsx';
import type { RealmLayer } from '../src/match/RealmBoardArt.tsx';

/**
 * Karte der Partie als Markup (docs/ART_DIRECTION.md, „Karte und Übersicht“): Reiche mit Farbband,
 * das eigene mit heller Linie, Wert des Felds nur, wo er zählt, Armeen als Bannerträger.
 */

const ME = 2;

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** Sitz 0 hält die Felder 0 und 1, Sitz 2 das Feld 5, alles andere ist frei. */
const OWNERS: Readonly<Record<number, number>> = { 0: 0, 1: 0, 5: ME };

function boardOf(values: Readonly<Record<number, number>> = {}): BoardState {
  return {
    regions: WENDELMARK.regions.map((r) => ({
      owner: OWNERS[r.id] ?? null,
      value: values[r.id] ?? 100,
      capitalOf: null,
    })),
    seats: [0, 1, 2].map(() => ({ capitalLivesLeft: 3 })),
  };
}

function layerOf(
  held: Readonly<Record<number, number>> = {},
  armies: Readonly<Record<number, number>> = {},
): RealmLayer {
  return {
    regions: WENDELMARK.regions.map((r) => ({
      building: 'NONE' as const,
      armies: armies[r.id] ?? 0,
      castleLives: 0,
      held: held[r.id] ?? 0,
    })),
  };
}

interface Options {
  readonly board?: BoardState;
  readonly realm?: RealmLayer | null;
  readonly home?: number | null;
  readonly legal?: readonly number[];
}

function render(options: Options = {}): string {
  return renderToStaticMarkup(
    createElement(MatchBoard, {
      map: WENDELMARK,
      board: options.board ?? boardOf(),
      name: (seat: number) => `Sitz ${seat}`,
      legal: options.legal ?? [],
      realm: options.realm ?? null,
      home: options.home ?? null,
      duel: null,
      spot: null,
      busy: false,
      onPick: () => undefined,
      frame: null,
    }),
  );
}

describe('Karte der Partie: Reiche', () => {
  it('zieht um jedes Reich ein Farbband, um freie Felder keines', () => {
    const html = render();
    expect(count(html, 'class="frontier seat-')).toBe(2);
    expect(count(html, 'class="frontier-band"')).toBe(2);
    expect(count(html, 'class="frontier-line"')).toBe(2);
    expect(html).toContain('class="frontier seat-0"');
    expect(html).toContain(`class="frontier seat-${ME}"`);
  });

  it('gibt nur dem eigenen Reich die helle Linie, in beiden Spielarten', () => {
    expect(render()).not.toContain(' home"');
    const classic = render({ home: ME });
    expect(count(classic, ' home"')).toBe(1);
    expect(count(classic, 'class="frontier-casing"')).toBe(1);
    expect(classic).toContain(`class="frontier seat-${ME} home"`);
    const realm = render({ home: 0, realm: layerOf() });
    expect(count(realm, ' home"')).toBe(1);
    expect(realm).toContain('class="frontier seat-0 home"');
  });

  it('färbt den Boden nach der Landschaft', () => {
    const html = render();
    expect(count(html, 'class="land terrain-')).toBe(WENDELMARK.regions.length);
  });

  it('hellt ein wählbares Ziel auf und lässt ihm die Klasse seines Besitzers', () => {
    const html = render({ legal: [0, 3] });
    expect(count(html, 'class="legal-glow"')).toBe(2);
    expect(html).toContain('board-region seat-0 legal');
    expect(html).toContain('board-region free legal');
  });
});

describe('Karte der Partie: Wert und Armeen', () => {
  it('zeigt ohne Ausbau auf jedem Feld die Münze mit dem Wert', () => {
    expect(count(render(), 'class="coin')).toBe(WENDELMARK.regions.length);
  });

  it('zeigt mit Ausbau die Münze nur, wo eine gehaltene Verteidigung das Feld aufwertet', () => {
    expect(count(render({ realm: layerOf() }), 'class="coin')).toBe(0);
    const html = render({ board: boardOf({ 1: 150 }), realm: layerOf({ 1: 1 }) });
    expect(count(html, 'class="coin')).toBe(1);
    expect(html).toContain('class="board-value">150<');
  });

  it('nennt den Wert weiter im Namen des Felds, auch ohne Münze', () => {
    const html = render({ realm: layerOf() });
    expect(count(html, '100 Punkte"')).toBe(WENDELMARK.regions.length);
  });

  it('stellt Armeen als Bannerträger mit ihrer Zahl auf', () => {
    const html = render({ realm: layerOf({}, { 0: 3, 5: 1 }) });
    expect(count(html, 'class="army seat-')).toBe(2);
    expect(html.match(/<use[^>]*-bearer"/g)).toHaveLength(2);
    expect(html).toContain('class="army-count">3<');
  });
});
