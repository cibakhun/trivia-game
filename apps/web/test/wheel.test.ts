import { realmWheelSchema, type QuestionCategory, type RealmWheelDto } from '@rdw/protocol';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { realmPlayOf, wheelPreview } from '../src/match/realm-model.ts';
import {
  Wheel,
  WHEEL_SWING_BACK,
  wheelOvershoot,
  wheelParts,
  wheelTurn,
  wheelWhirl,
  whirlStops,
  type WheelPart,
} from '../src/match/Wheel.tsx';
import {
  CLACK_MIN_GAP_MS,
  cubicBezier,
  WHEEL_EASE,
  WHEEL_MAIN_SHARE,
  wheelAngleAt,
  wheelBlur,
  wheelClacks,
  wheelPasses,
  wheelSpeedAt,
  type WheelSweep,
} from '../src/match/wheel-motion.ts';
import { realmViewOf } from './match-fixtures.ts';

/**
 * Glücksrad eines Duells als Zeichnung (MATCH_RULES §11.5): Jede Kategorie ist so breit wie ihre
 * Chance, die Anteile der Lieblingskategorien tragen die Farben der beiden Reiche, und das Rad
 * bleibt mit der gezogenen Kategorie unter dem Zeiger stehen.
 */

function segment(category: QuestionCategory, attacker: number, defender: number, free: number) {
  return { category, attacker, defender, free, weight: attacker + defender + free };
}

/** Kleines Rad: Geschichte halb, Sport und Technik je ein Viertel. */
const SMALL: Pick<RealmWheelDto, 'segments'> = {
  segments: [
    segment('HISTORY', 30, 0, 10),
    segment('SPORTS', 0, 0, 20),
    segment('TECHNOLOGY', 0, 15, 5),
    segment('GENERAL', 0, 0, 0),
  ],
};

function previewWheel(): RealmWheelDto {
  const play = realmPlayOf(realmViewOf());
  const wheel = play ? wheelPreview(play, 2, 12) : null;
  return realmWheelSchema.parse(wheel);
}

describe('Felder des Rads', () => {
  it('macht jede Kategorie so breit wie ihr Gewicht', () => {
    const parts = wheelParts(SMALL);
    expect(parts.map((p) => [p.category, p.from, p.to])).toEqual([
      ['HISTORY', 0, 180],
      ['SPORTS', 180, 270],
      ['TECHNOLOGY', 270, 360],
    ]);
  });

  it('teilt ein Feld in die Anteile von Angreifer und Verteidiger', () => {
    const [history, sports, technology] = wheelParts(SMALL);
    expect(history).toMatchObject({ span: 180, attacker: 135, defender: 0 });
    expect(sports).toMatchObject({ attacker: 0, defender: 0 });
    expect(technology).toMatchObject({ span: 90, attacker: 0, defender: 67.5 });
  });

  it('lässt Kategorien ohne Gewicht und ohne ungestellte Frage weg', () => {
    expect(wheelParts(SMALL).some((p) => p.category === 'GENERAL')).toBe(false);
    const parts = wheelParts(SMALL, ['HISTORY']);
    expect(parts.map((p) => [p.category, p.from, p.to])).toEqual([
      ['SPORTS', 0, 180],
      ['TECHNOLOGY', 180, 360],
    ]);
  });

  it('nimmt wieder das ganze Rad, wenn alle Kategorien erschöpft sind', () => {
    const all = wheelParts(SMALL, ['HISTORY', 'SPORTS', 'TECHNOLOGY']);
    expect(all).toEqual(wheelParts(SMALL));
  });

  it('ist leer ohne Gewicht', () => {
    expect(wheelParts({ segments: [segment('HISTORY', 0, 0, 0)] })).toEqual([]);
  });

  it('füllt mit dem Rad aus den Regeln genau den Kreis', () => {
    const parts = wheelParts(previewWheel());
    expect(parts).toHaveLength(11);
    expect(parts[0]?.from).toBe(0);
    expect(parts.at(-1)?.to).toBeCloseTo(360, 6);
    for (const part of parts) {
      expect(part.attacker + part.defender).toBeLessThanOrEqual(part.span + 1e-9);
    }
  });
});

describe('Drehung des Rads', () => {
  it('legt die gezogene Kategorie unter den Zeiger oben', () => {
    const parts = wheelParts(SMALL);
    for (const part of parts) {
      const at = -wheelTurn(parts, part.category);
      expect(at).toBeGreaterThan(part.from);
      expect(at).toBeLessThan(part.to);
    }
  });

  it('dreht nicht ohne Treffer', () => {
    const parts = wheelParts(SMALL);
    expect(wheelTurn(parts, null)).toBe(0);
    expect(wheelTurn(parts, 'LITERATURE')).toBe(0);
  });

  it('läuft höchstens 7 Grad über das Ziel hinaus und federt zurück (ADR-067)', () => {
    expect(wheelOvershoot(180)).toBe(7);
    expect(wheelOvershoot(90)).toBe(7);
    expect(wheelOvershoot(10)).toBeCloseTo(2.48, 6);
    expect(wheelOvershoot(0)).toBe(0);
  });

  it('lässt den Zeiger dabei nie das gezogene Feld verlassen, auch ein schmales nicht', () => {
    for (const wheel of [SMALL, previewWheel()]) {
      const parts = wheelParts(wheel);
      for (const part of parts) {
        const rest = -wheelTurn(parts, part.category);
        const over = wheelOvershoot(part.span);
        // Über das Ziel hinaus wandert der Zeiger zum Anfang des Felds, zurück zum Ende
        expect(rest - over).toBeGreaterThan(part.from);
        expect(rest + over * WHEEL_SWING_BACK).toBeLessThan(part.to);
      }
    }
  });
});

describe('Rad als Zeichnung', () => {
  const draw = (props: Partial<Parameters<typeof Wheel>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(Wheel, {
        wheel: previewWheel(),
        attacker: 2,
        defender: 1,
        landed: 'HISTORY',
        ...props,
      }),
    );
  const count = (html: string, needle: string) => html.split(needle).length - 1;

  it('zeichnet jedes Feld und die Anteile in den Farben der beiden Reiche', () => {
    const html = draw();
    expect(count(html, 'class="wheel-seg"')).toBe(11);
    // Vier Lieblingskategorien je Reich
    expect(count(html, 'fill:var(--seat-2)')).toBe(4);
    expect(count(html, 'fill:var(--seat-1)')).toBe(4);
    expect(count(html, 'class="seg-hit-ring"')).toBe(1);
    expect(html).toContain('aria-hidden="true"');
  });

  it('steht ohne Drehzeit und dreht mit ihr', () => {
    const still = draw();
    expect(still).toContain('class="wheel"');
    // Ohne Drehung gibt es weder Wirbel noch Klacker
    expect(still).not.toContain('wheel-whirl');
    expect(still).not.toContain('wheel-clack');
    const spinning = draw({ spinMs: 1950, elapsedMs: 400 });
    expect(spinning).toContain('class="wheel spinning"');
    expect(spinning).toContain('--spin:1950ms');
    expect(spinning).toContain('--spun:-400ms');
    expect(spinning).toContain('class="wheel-whirl"');
    expect(count(spinning, 'class="wheel-clack"')).toBeGreaterThanOrEqual(2);
  });

  it('setzt an jede Feldgrenze einen Stift', () => {
    expect(count(draw(), 'class="wheel-peg"')).toBe(11);
  });

  it('dreht nicht ohne gezogene Kategorie und zeigt dann keinen Treffer', () => {
    const html = draw({ landed: null, spinMs: 1950 });
    expect(html).toContain('class="wheel"');
    expect(html).toContain('--turn:0deg');
    expect(html).not.toContain('seg-hit-ring');
  });

  it('zeichnet ein Rad mit nur einer Kategorie als ganzen Kreis', () => {
    // Alle anderen sind erschöpft: Das Feld reicht von 0 bis 360 Grad. Ein einzelner Bogen hätte
    // denselben Anfangs- und Endpunkt und fiele in SVG weg; zwei Halbkreise zeichnen ihn.
    const others = previewWheel()
      .segments.map((s) => s.category)
      .filter((category) => category !== 'HISTORY');
    const html = draw({ exhausted: others });
    expect(count(html, 'class="wheel-seg"')).toBe(1);
    const free = (drawn: string) => /<path d="([^"]+)" class="seg-free"/.exec(drawn)?.[1] ?? '';
    expect(count(free(html), 'A')).toBe(2);
    // Kein Strich zur Mitte: Der Kreis hat keine Kanten
    expect(free(html)).not.toContain('L');
    // Auch der Rahmen um das getroffene Feld ist ein ganzer Kreis
    expect(count(/<path d="([^"]+)" class="seg-hit-ring"/.exec(html)?.[1] ?? '', 'A')).toBe(2);
    // Ein Rad mit mehreren Feldern bleibt bei einem Bogen je Feld
    expect(count(free(draw()), 'A')).toBe(1);
  });

  it('lässt erschöpfte Kategorien aus der Zeichnung', () => {
    expect(count(draw({ exhausted: ['LITERATURE', 'SPORTS'] }), 'class="wheel-seg"')).toBe(9);
  });
});

/**
 * Bewegung des Rads, nachgerechnet aus der Kurve, mit der CSS es dreht (ADR-069): Stifte an den
 * Feldgrenzen laufen unter dem Zeiger durch, in der langsamen Phase klackert er an jedem.
 */
describe('Kurve der Drehung', () => {
  const ease = cubicBezier(...WHEEL_EASE);

  it('beginnt bei 0, endet bei 1 und steigt dazwischen', () => {
    expect(ease.y(ease.forX(0))).toBe(0);
    expect(ease.y(ease.forX(1))).toBe(1);
    let last = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const y = ease.y(ease.forX(t));
      expect(y).toBeGreaterThan(last);
      last = y;
    }
  });

  it('findet zu einem Fortschritt die Stelle der Kurve und zurück', () => {
    for (const p of [0.1, 0.5, 0.9, 0.99]) {
      expect(ease.y(ease.forY(p))).toBeCloseTo(p, 9);
    }
    for (const t of [0.2, 0.6]) expect(ease.x(ease.forX(t))).toBeCloseTo(t, 9);
  });

  it('läuft schnell an und rollt ganz aus', () => {
    expect(ease.slope(0)).toBeCloseTo(0.58 / 0.13, 6);
    expect(ease.slope(1)).toBe(0);
  });

  it('ist dieselbe Kurve wie in realm.css', () => {
    // Wer die Kurve oder das Schlüsselbild des Überschwingens dort ändert, muss es hier tun
    const css = readFileSync(
      fileURLToPath(new URL('../src/match/realm.css', import.meta.url)),
      'utf8',
    );
    const spin = /@keyframes wheel-spin \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(spin).toContain(`cubic-bezier(${WHEEL_EASE.join(', ')})`);
    expect(spin).toContain(`${WHEEL_MAIN_SHARE * 100}% {`);
  });
});

/** Rad aus den Regeln mit der gezogenen Kategorie, wie `Wheel` es dreht (1,95 s). */
function sweepOf(parts: readonly WheelPart[], landed: QuestionCategory, spinMs = 1950): WheelSweep {
  const turn = wheelTurn(parts, landed);
  const hit = parts.find((p) => p.category === landed);
  return {
    edges: parts.length > 1 ? parts.map((p) => p.from) : [],
    from: turn - 1080,
    to: turn + wheelOvershoot(hit?.span ?? 0),
    spinMs,
  };
}

const mod360 = (angle: number) => ((angle % 360) + 360) % 360;

describe('Stifte unter dem Zeiger', () => {
  const parts = wheelParts(previewWheel());
  const categories = parts.map((p) => p.category);

  it('findet jeden Durchgang einer Grenze, wenn sie genau oben liegt', () => {
    for (const landed of categories) {
      const sweep = sweepOf(parts, landed);
      const passes = wheelPasses(sweep);
      // Drei ganze Umdrehungen und das Stück bis ins Ziel: jede Grenze drei- oder viermal
      expect(passes.length).toBeGreaterThanOrEqual(parts.length * 3);
      expect(passes.length).toBeLessThanOrEqual(parts.length * 4);
      let last = 0;
      for (const pass of passes) {
        expect(pass.atMs).toBeGreaterThanOrEqual(last);
        last = pass.atMs;
        // Oben liegt der Winkel -Drehung: Dort steht in diesem Augenblick die Grenze
        const top = mod360(-wheelAngleAt(sweep, pass.atMs));
        const off = Math.min(mod360(top - pass.edge), mod360(pass.edge - top));
        expect(off).toBeLessThan(0.01);
      }
      expect(last).toBeLessThan(sweep.spinMs * WHEEL_MAIN_SHARE);
    }
  });

  it('klackert nur in der langsamen Phase und nie dichter als 65 ms', () => {
    for (const landed of categories) {
      const sweep = sweepOf(parts, landed);
      const clacks = wheelClacks(sweep);
      expect(clacks.length).toBeGreaterThanOrEqual(2);
      expect(clacks.length).toBeLessThanOrEqual(10);
      let previous = 0;
      for (const clack of clacks) {
        expect(clack.atMs - previous).toBeGreaterThanOrEqual(CLACK_MIN_GAP_MS);
        expect(wheelSpeedAt(sweep, clack.atMs)).toBeLessThanOrEqual(0.9 + 1e-6);
        previous = clack.atMs;
      }
    }
  });

  it('stößt den Zeiger zuletzt an der Grenze an, über die das Rad ins gezogene Feld läuft', () => {
    for (const landed of categories) {
      const sweep = sweepOf(parts, landed);
      const hit = parts.find((p) => p.category === landed);
      const entry = wheelPasses(sweep).at(-1);
      // Das Rad dreht im Uhrzeigersinn: Unter dem Zeiger kommt zuletzt der Rand am Ende des Felds
      expect(mod360(entry?.edge ?? -1)).toBeCloseTo(mod360(hit?.to ?? 0), 6);
      expect(wheelClacks(sweep).at(-1)?.atMs).toBe(entry?.atMs);
    }
  });

  it('schlägt kräftig aus, solange das Rad Fahrt hat, und zögert am Ende', () => {
    const clacks = wheelClacks(sweepOf(parts, 'HISTORY'));
    for (let i = 1; i < clacks.length; i += 1) {
      expect(clacks[i]!.kick).toBeLessThanOrEqual(clacks[i - 1]!.kick);
      expect(clacks[i]!.pushMs).toBeGreaterThanOrEqual(clacks[i - 1]!.pushMs);
    }
    for (const clack of clacks) {
      expect(clack.kick).toBeGreaterThanOrEqual(8);
      expect(clack.kick).toBeLessThanOrEqual(15);
    }
  });

  it('hat ohne Grenze keine Stifte und klackert nicht', () => {
    const one = wheelParts(SMALL, ['SPORTS', 'TECHNOLOGY']);
    expect(one).toHaveLength(1);
    expect(wheelClacks(sweepOf(one, 'HISTORY'))).toEqual([]);
  });

  it('dreht nicht ohne Drehzeit', () => {
    expect(wheelPasses({ ...sweepOf(parts, 'HISTORY'), spinMs: 0 })).toEqual([]);
  });
});

describe('Wirbel der schnellen Scheibe', () => {
  const parts = wheelParts(previewWheel());

  it('steht ganz, solange das Rad schneller als ein Wirbel dreht, und ist weg, wenn es langsam ist', () => {
    const sweep = sweepOf(parts, 'HISTORY');
    const blur = wheelBlur(sweep);
    expect(blur.fullMs).toBeGreaterThan(0);
    expect(blur.goneMs).toBeGreaterThan(blur.fullMs);
    expect(blur.goneMs).toBeLessThan(sweep.spinMs * WHEEL_MAIN_SHARE);
    expect(wheelSpeedAt(sweep, blur.fullMs)).toBeCloseTo(1.2, 2);
    expect(wheelSpeedAt(sweep, blur.goneMs)).toBeCloseTo(0.42, 2);
    // Der erste Klacker kommt erst, wenn man die Felder wieder sieht
    expect(wheelClacks(sweep)[0]!.atMs).toBeGreaterThan(blur.fullMs);
  });

  it('verwischt die Farben der Felder zu einem Verlauf rund um die Mitte', () => {
    const whirl = wheelWhirl(parts, 2, 1);
    expect(whirl.startsWith('conic-gradient(')).toBe(true);
    expect(whirl).toContain('var(--seat-2)');
    expect(whirl).toContain('var(--seat-1)');
    // Der Verlauf läuft einmal herum und schließt bei 0 und 360 Grad mit derselben Farbe
    const stops = whirlStops(parts, 2, 1);
    expect(stops[0]?.angle).toBe(0);
    expect(stops.at(-1)?.angle).toBe(360);
    expect(stops[0]?.colour).toBe(stops.at(-1)?.colour);
    for (let i = 1; i < stops.length; i += 1) {
      expect(stops[i]!.angle).toBeGreaterThan(stops[i - 1]!.angle);
    }
    // Freies Feld: kein Verteidiger im Wirbel
    expect(wheelWhirl(parts, 2, null)).not.toContain('var(--seat-1)');
  });
});
