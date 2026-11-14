import { WENDELMARK } from '@rdw/game-core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatchBoard, type BoardState } from '../src/match/MatchBoard.tsx';
import {
  armiesBefore,
  armySwitch,
  type RealmLayer,
  type RealmMotion,
  type RealmMove,
} from '../src/match/RealmBoardArt.tsx';

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

describe('Karte der Partie: Meer', () => {
  it('misst die Tiefe des Meers in Karteneinheiten am sichtbaren Bild', () => {
    const html = render();
    const gradient = /<radialGradient[^>]*-depth"[^>]*>/.exec(html)?.[0] ?? '';
    expect(gradient).toContain('gradientUnits="userSpaceOnUse"');
    // Ohne das wäre der Kreis so groß wie das Rechteck des Meers und im Bild nie zu sehen
    const r = Number(/ r="([\d.]+)"/.exec(gradient)?.[1]);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(1000);
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

describe('Karte der Partie: Bewegung beim Aufdecken und im Ausgang (ADR-067)', () => {
  interface Layer {
    readonly armies?: Readonly<Record<number, number>>;
    readonly buildings?: Readonly<Record<number, 'VILLAGE' | 'TOWN' | 'CASTLE'>>;
    readonly moves?: readonly RealmMove[];
    readonly fresh?: readonly number[];
    readonly motion?: RealmMotion | null;
  }
  const layer = (options: Layer): RealmLayer => ({
    regions: WENDELMARK.regions.map((r) => ({
      building: options.buildings?.[r.id] ?? ('NONE' as const),
      armies: options.armies?.[r.id] ?? 0,
      castleLives: 0,
      held: 0,
    })),
    moves: options.moves ?? [],
    fresh: options.fresh ?? [],
    motion: options.motion ?? null,
  });
  const MOVING = [
    'rising',
    'falling',
    'counting',
    'arriving',
    'army gone',
    'marcher',
    'drawn',
    'piece',
    'shatter',
    'shaken',
    'army-dust',
    'gate-light',
    'after-fall',
  ];

  it('rechnet aus der Bewegung zurück, wie viele Armeen vorher auf dem Feld standen', () => {
    expect(armiesBefore(3, null)).toBe(3);
    expect(armiesBefore(3, { recruited: 2 })).toBe(1);
    expect(armiesBefore(2, { arrived: 2 })).toBe(0);
    expect(armiesBefore(0, { left: 1 })).toBe(1);
    expect(armiesBefore(4, { recruited: 2, left: 1, arrived: 1 })).toBe(2);
    // `lost` nennt den Sitz, verloren geht genau eine Armee
    expect(armiesBefore(1, { lost: 2 })).toBe(2);
  });

  it('wechselt die Zahl auf der Fahne mit dem, was dort geschah', () => {
    expect(armySwitch({ recruited: 1, left: 1 })).toBe('recruit');
    expect(armySwitch({ arrived: 1, left: 1 })).toBe('in');
    expect(armySwitch({ left: 1 })).toBe('out');
    expect(armySwitch({ lost: 0, arrived: 1 })).toBe('loss');
  });

  it('steht ohne miterlebten Wechsel sofort im Endbild', () => {
    const html = render({
      realm: layer({
        armies: { 0: 2 },
        buildings: { 1: 'VILLAGE' },
        moves: [{ from: 1, to: 0, count: 1, seat: 0 }],
        fresh: [0, 1],
      }),
    });
    for (const word of MOVING) expect(html).not.toContain(word);
    expect(html).toContain('class="building fresh"');
    expect(html).toContain('class="army seat-0 fresh"');
  });

  it('lässt ein eben gebautes Gebäude aus dem Boden wachsen', () => {
    const html = render({
      realm: layer({
        buildings: { 1: 'VILLAGE' },
        fresh: [1],
        motion: { kind: 'orders', fields: { 1: { built: true } } },
      }),
    });
    expect(html).toContain('class="building fresh rising"');
    expect(count(html, ' rising"')).toBe(1);
  });

  it('zählt die Fahne um, wenn neue Armeen aus der Burg treten, und lässt sie herauslaufen', () => {
    const html = render({
      realm: layer({
        armies: { 0: 3 },
        buildings: { 0: 'CASTLE' },
        fresh: [0],
        motion: { kind: 'orders', fields: { 0: { recruited: 2 } } },
      }),
    });
    expect(html).toContain('class="army seat-0 fresh counting"');
    expect(html).toContain('data-switch="recruit"');
    expect(html).toContain('class="army-count was">1<');
    expect(html).toContain('class="army-count now">3<');
    expect(count(html, 'class="marcher recruit seat-0"')).toBe(1);
    expect(html).toContain('class="army-count">+2<');
  });

  it('lässt einen Zug vom Banner zum Banner marschieren: Aufbruch, Weg, Ankunft', () => {
    const html = render({
      realm: layer({
        armies: { 0: 1, 1: 2 },
        moves: [{ from: 0, to: 1, count: 2, seat: 0 }],
        fresh: [1],
        motion: { kind: 'orders', fields: { 0: { left: 2 }, 1: { arrived: 2 } } },
      }),
    });
    expect(html).toContain('class="plan-move drawn"');
    expect(count(html, 'class="marcher seat-0"')).toBe(1);
    // Am Start bleibt eine Armee: Die Fahne zählt von 3 auf 1, sobald der Zug aufbricht
    expect(html).toContain('data-switch="out"');
    expect(html).toContain('class="army-count was">3<');
    // Am Ziel stand vorher niemand: Der Bannerträger erscheint mit der Ankunft
    expect(html).toContain('class="army seat-0 fresh arriving"');
    expect(html).toContain('data-switch="in"');
  });

  it('zeigt den Bannerträger eines geräumten Felds noch, bis er aufbricht', () => {
    const html = render({
      realm: layer({
        armies: { 1: 1 },
        moves: [{ from: 0, to: 1, count: 1, seat: 0 }],
        motion: { kind: 'orders', fields: { 0: { left: 1 }, 1: { arrived: 1 } } },
      }),
    });
    expect(count(html, 'class="army gone seat-0"')).toBe(1);
  });

  it('lässt ein beschädigtes Gebäude fallen und holt die Beschriftung sofort zurück', () => {
    const html = render({
      realm: layer({
        buildings: { 1: 'VILLAGE' },
        fresh: [1],
        motion: { kind: 'outcome', fields: { 1: { fell: 'TOWN' } } },
      }),
    });
    expect(html).toContain('class="building falling"');
    expect(html).toContain('data-fell="TOWN"');
    // Bis zum Bruch steht die Stadt ganz, dann fallen drei Stücke entlang fester Bruchlinien
    expect(html.match(/class="whole"><use[^>]*-town"/g)).toHaveLength(1);
    expect(count(html, 'class="piece piece-')).toBe(3);
    expect(html.match(/clip-path="url\(#[^)]*-crack-[012]\)"><use[^>]*-town"/g)).toHaveLength(3);
    // Danach steigt das Dorf aus dem Staub, sein Schein erst mit ihm
    expect(html).toContain('class="building fresh settling"');
    expect(html).toContain('class="fresh-glow after-fall"');
    expect(count(html, ' prompt"')).toBe(1);
  });

  it('lässt eine getroffene Burg beben und ihr verlorenes Schild in zwei Hälften zerbrechen', () => {
    const base = layer({
      buildings: { 0: 'CASTLE' },
      motion: { kind: 'outcome', fields: { 0: { hit: true } } },
    });
    const html = render({
      board: {
        ...boardOf(),
        regions: boardOf().regions.map((r, i) => (i === 0 ? { ...r, capitalOf: 0 } : r)),
      },
      realm: {
        ...base,
        regions: base.regions.map((r, i) => (i === 0 ? { ...r, castleLives: 2 } : r)),
      },
    });
    expect(html).toContain('class="castle hit shaken"');
    expect(count(html, 'class="life life-shatter"')).toBe(1);
    expect(
      html.match(/class="half half-[01]"><g clip-path="url\(#[^)]*-half-[01]\)"/g),
    ).toHaveLength(2);
  });

  it('lässt eine genommene Burg mit ihren Schilden und ihrem Bannerträger einstürzen', () => {
    // Feld 5 gehört nach dem Sieg mir (Sitz 2); die Burg dort verlor Sitz 0
    const html = render({
      home: ME,
      realm: layer({
        motion: { kind: 'outcome', fields: { 5: { fell: 'CASTLE', fellOf: 0, lost: 0 } } },
      }),
    });
    expect(count(html, 'class="castle falling"')).toBe(1);
    expect(html.match(/class="whole"><use[^>]*-castle"/g)).toHaveLength(1);
    expect(html.match(/clip-path="url\(#[^)]*-tower-[012]\)"><use[^>]*-castle"/g)).toHaveLength(3);
    // Das letzte Schild zerspringt, die leeren fallen nacheinander mit
    expect(count(html, 'class="life life-shatter"')).toBe(1);
    expect(count(html, 'class="life life-off drop drop-')).toBe(2);
    expect(html).toContain('class="army gone seat-0" style="--flag:var(--seat-0)"');
    expect(html).toContain('data-switch="ruin"');
    expect(count(html, 'class="army-dust"')).toBe(1);
    // Die Beschriftung des Felds wartet wie bei jeder Eroberung
    expect(html).not.toContain(' prompt"');
  });

  it('lässt die verlorene Armee des Verlierers fallen, wo sie stand', () => {
    const html = render({
      realm: layer({
        armies: { 0: 1 },
        motion: { kind: 'outcome', fields: { 0: { lost: 0 }, 5: { lost: 2 } } },
      }),
    });
    // Feld 0 behält eine von zwei Armeen, Feld 5 verliert seine letzte
    expect(html).toContain('class="army seat-0 counting"');
    expect(html).toContain('class="army-count was">2<');
    expect(html).toContain(`class="army gone seat-${ME}"`);
    expect(count(html, 'data-switch="loss"')).toBe(2);
    // Wo der Träger getroffen wird oder fällt, wirbelt Staub auf
    expect(count(html, 'class="army-dust"')).toBe(2);
  });

  it('lässt den Träger auf einem eben genommenen Feld außerhalb der wartenden Beschriftung fallen', () => {
    // Feld 5 gehört nach dem Sieg mir (Sitz 2); dort verlor Sitz 1 seine Armee
    const html = render({
      realm: layer({
        armies: { 5: 1 },
        motion: { kind: 'outcome', fields: { 5: { lost: 1 } } },
      }),
    });
    expect(count(html, 'class="army gone rout seat-1"')).toBe(1);
    expect(html).toContain('data-switch="rout"');
    // Er steht vor der Beschriftung des Felds, nicht in ihr
    const rout = html.indexOf('class="army gone rout');
    const label = html.indexOf('class="region-label', rout);
    expect(rout).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(rout);
    expect(html.slice(rout, label)).not.toContain('region-label');
  });
});
