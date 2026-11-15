import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sheetSwap, sheetVeil, type SheetFace, type SheetKind } from '../src/match/sheet-swap.ts';
import { StageCentre } from '../src/match/StageCentre.tsx';

const KINDS: readonly (SheetKind | null)[] = [
  null,
  'question',
  'wheel',
  'reveal',
  'result',
  'closed',
];

const FACES: readonly (SheetFace | null)[] = [null, 'TRIVIA', 'ESTIMATE'];

describe('Wechsel der Blätter mitten auf der Karte', () => {
  const at = (kind: SheetKind | null, face: SheetFace | null = null) => ({ kind, face });

  it('lässt die Karte einer Wissensfrage liegen: Die Auflösung legt sich darauf', () => {
    expect(sheetSwap(at('question', 'TRIVIA'), at('reveal', 'TRIVIA'))).toBe('stay');
  });

  it('dreht die Karte einer Schätzfrage um: Hinten stehen Lösung und Rangfolge', () => {
    expect(sheetSwap(at('question', 'ESTIMATE'), at('reveal', 'ESTIMATE'))).toBe('turn');
    // Passen Frage und Auflösung nicht zusammen, gibt es nichts, was liegen bleiben könnte
    expect(sheetSwap(at('question', 'TRIVIA'), at('reveal', 'ESTIMATE'))).toBe('turn');
    expect(sheetSwap(at('question', 'ESTIMATE'), at('reveal', 'TRIVIA'))).toBe('turn');
    expect(sheetSwap(at('question'), at('reveal'))).toBe('turn');
  });

  it('hebt die Auflösung ab, wenn die Karte, die Abrechnung oder das Rad folgt', () => {
    for (const face of ['TRIVIA', 'ESTIMATE'] as const) {
      expect(sheetSwap(at('reveal', face), at(null))).toBe('lift');
      expect(sheetSwap(at('reveal', face), at('result'))).toBe('lift');
      expect(sheetSwap(at('reveal', face), at('closed'))).toBe('lift');
      expect(sheetSwap(at('reveal', face), at('wheel'))).toBe('lift');
    }
  });

  it('bewegt nichts, wenn eine Frage beginnt (die Antwortzeit läuft)', () => {
    for (const from of KINDS) {
      for (const face of FACES) expect(sheetSwap(at(from, face), at('question', face))).toBeNull();
    }
  });

  it('lässt alle anderen Wechsel harte Schnitte', () => {
    for (const from of KINDS) {
      for (const to of KINDS) {
        for (const face of FACES) {
          const moved =
            (from === 'question' && to === 'reveal') ||
            (from === 'reveal' && to !== 'reveal' && to !== 'question');
          expect(sheetSwap(at(from, face), at(to, face)) !== null, `${from} → ${to}`).toBe(moved);
        }
      }
    }
  });
});

describe('Schleier unter einem Blatt', () => {
  it('liegt nicht ohne Blatt', () => {
    expect(sheetVeil(null, null).on).toBe(false);
    expect(sheetVeil(null, 'duel').on).toBe(false);
    expect(sheetVeil(null, 'settled').on).toBe(false);
  });

  it('liegt unter einem Blatt, wenn die Karte kein Duell zeigt', () => {
    expect(sheetVeil('question', null)).toEqual({ on: true, cut: true });
    expect(sheetVeil('reveal', null)).toEqual({ on: true, cut: false });
    expect(sheetVeil('result', null)).toEqual({ on: true, cut: false });
    expect(sheetVeil('closed', null)).toEqual({ on: true, cut: false });
  });

  it('liegt im Duell nicht: Die Karte dunkelt vom Aufmarsch bis zum Ausgang selbst ab', () => {
    expect(sheetVeil('wheel', 'announce').on).toBe(false);
    expect(sheetVeil('question', 'duel').on).toBe(false);
    expect(sheetVeil('reveal', 'duel').on).toBe(false);
    expect(sheetVeil('reveal', 'outcome').on).toBe(false);
  });

  it('liegt wieder, wenn das Duell entschieden auf der Karte steht (spät geladene Auflösung)', () => {
    expect(sheetVeil('reveal', 'settled')).toEqual({ on: true, cut: false });
  });
});

describe('Mitte der Bühne', () => {
  const centre = (kind: SheetKind | null, className?: string) =>
    renderToStaticMarkup(
      createElement(StageCentre, {
        kind,
        ...(className ? { className } : {}),
        children: kind ? createElement('section', { className: 'sheet' }, 'Blatt') : null,
      }),
    );

  it('zeichnet ohne Blatt nur die leere Ebene der Abbilder', () => {
    expect(centre(null)).toBe('<div class="sheet-ghosts" aria-hidden="true"></div>');
  });

  it('zeichnet das Blatt beim ersten Aufbau ohne Wechsel', () => {
    const html = centre('reveal');
    expect(html).toContain(
      '<div class="stage-centre"><section class="sheet">Blatt</section></div>',
    );
    expect(html).not.toContain('turned');
    expect(html).not.toContain('stayed');
    expect(centre('result', 'wide')).toContain('class="stage-centre wide"');
  });
});
