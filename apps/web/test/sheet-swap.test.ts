import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sheetSwap, sheetVeil, type SheetKind } from '../src/match/sheet-swap.ts';
import { StageCentre } from '../src/match/StageCentre.tsx';

const KINDS: readonly (SheetKind | null)[] = [
  null,
  'question',
  'wheel',
  'reveal',
  'result',
  'closed',
];

describe('Wechsel der Blätter mitten auf der Karte', () => {
  it('dreht die Fragekarte zur Auflösung um', () => {
    expect(sheetSwap('question', 'reveal')).toBe('turn');
  });

  it('hebt die Auflösung ab, wenn die Karte, die Abrechnung oder das Rad folgt', () => {
    expect(sheetSwap('reveal', null)).toBe('lift');
    expect(sheetSwap('reveal', 'result')).toBe('lift');
    expect(sheetSwap('reveal', 'closed')).toBe('lift');
    expect(sheetSwap('reveal', 'wheel')).toBe('lift');
  });

  it('bewegt nichts, wenn eine Frage beginnt (die Antwortzeit läuft)', () => {
    for (const from of KINDS) expect(sheetSwap(from, 'question')).toBeNull();
  });

  it('lässt alle anderen Wechsel harte Schnitte', () => {
    for (const from of KINDS) {
      for (const to of KINDS) {
        const moved =
          (from === 'question' && to === 'reveal') ||
          (from === 'reveal' && to !== 'reveal' && to !== 'question');
        expect(sheetSwap(from, to) !== null, `${from} → ${to}`).toBe(moved);
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
    expect(centre('result', 'wide')).toContain('class="stage-centre wide"');
  });
});
