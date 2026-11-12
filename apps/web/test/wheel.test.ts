import { realmWheelSchema, type QuestionCategory, type RealmWheelDto } from '@rdw/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { realmPlayOf, wheelPreview } from '../src/match/realm-model.ts';
import { Wheel, wheelParts, wheelTurn } from '../src/match/Wheel.tsx';
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
    expect(draw()).toContain('class="wheel"');
    const spinning = draw({ spinMs: 1950, elapsedMs: 400 });
    expect(spinning).toContain('class="wheel spinning"');
    expect(spinning).toContain('--spin:1950ms');
    expect(spinning).toContain('--spun:-400ms');
  });

  it('dreht nicht ohne gezogene Kategorie und zeigt dann keinen Treffer', () => {
    const html = draw({ landed: null, spinMs: 1950 });
    expect(html).toContain('class="wheel"');
    expect(html).toContain('--turn:0deg');
    expect(html).not.toContain('seg-hit-ring');
  });

  it('lässt erschöpfte Kategorien aus der Zeichnung', () => {
    expect(count(draw({ exhausted: ['LITERATURE', 'SPORTS'] }), 'class="wheel-seg"')).toBe(9);
  });
});
