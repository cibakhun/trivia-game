import { describe, expect, it } from 'vitest';
import { optionDensity, promptDensity, unbreakable } from '../src/match/option-fit.ts';

/**
 * Schrift der Antwortfelder (option-fit.ts): Ein langes Wort passt auf eine Zeile, statt mitten im
 * Wort umzubrechen. Gemessen wird hier mit festen Breiten je Zeichen, wie die Schätzung ohne
 * Zeichenfläche; im Browser misst die Schrift selbst.
 */

/** Breite in em: 0,47 je Zeichen, etwa die mittlere Breite der Antwortschrift. */
const measure = (text: string) => text.length * 0.47;

describe('Schrift der Antwortfelder', () => {
  it('teilt Antworten in Stücke, die nicht umbrechen können', () => {
    expect(unbreakable('Afrikanischer Elefant')).toEqual(['Afrikanischer', 'Elefant']);
    // Am Bindestrich bricht der Browser um, der Strich bleibt oben
    expect(unbreakable('Mecklenburg-Vorpommern')).toEqual(['Mecklenburg-', 'Vorpommern']);
    expect(unbreakable('Deutsche Luft- und Raumfahrt')).toEqual([
      'Deutsche',
      'Luft-',
      'und',
      'Raumfahrt',
    ]);
    expect(unbreakable('  ')).toEqual([]);
  });

  it('bleibt groß bei kurzen Antworten und richtet sich sonst nach der längsten (wie bisher)', () => {
    expect(optionDensity(['1987', '1989', '1990', '1991'], measure)).toBe('');
    expect(optionDensity(['Johann Wolfgang von Goethe', 'Lessing', 'Schiller'], measure)).toBe(
      ' options-mid',
    );
    expect(
      optionDensity(
        ['Das Ende der Napoleonischen Kriege', 'Der Wiener Kongress dauerte an'],
        measure,
      ),
    ).toBe(' options-mid');
    expect(optionDensity(['Deutsches Zentrum für Luft- und Raumfahrt', 'DLR'], measure)).toBe(
      ' options-long',
    );
  });

  it('macht ein langes Wort so klein, dass es auf eine Zeile passt', () => {
    // 16 Zeichen: Nach der Länge der Antwort blieb sie groß und brach als „Weißkopfseeadle-r“ um
    expect(
      optionDensity(['Weißkopfseeadler', 'Andenkondor', 'Wanderfalke', 'Steinadler'], measure),
    ).toBe(' options-mid');
    expect(optionDensity(['Küstenmammutbaum', 'Eukalyptus'], (t) => t.length * 0.555)).toBe(
      ' options-long',
    );
    expect(optionDensity(['Bundesverfassungsgericht', 'Bundesrat'], measure)).toBe(
      ' options-tight',
    );
    // Mehrere kurze Wörter brechen zwischen den Wörtern um: kein Grund für kleinere Schrift
    expect(optionDensity(['Rüsselsheim am Main', 'Bad Homburg'], measure)).toBe(' options-mid');
    // Ein Bindestrich teilt das Wort: Beide Hälften passen in die Stufe der Länge
    expect(optionDensity(['Garmisch-Partenkirchen', 'Oberstdorf'], measure)).toBe(' options-mid');
  });

  it('nimmt für ein Wort, das nirgends passt, die kleinste Stufe', () => {
    expect(optionDensity(['Donaudampfschifffahrtsgesellschaftskapitän'], measure)).toBe(
      ' options-tight',
    );
  });

  it('übergeht Antworten ohne Text (Auflösung einer Frage ohne Antworten)', () => {
    expect(optionDensity([null, 'Elf', null], measure)).toBe('');
    expect(optionDensity([], measure)).toBe('');
  });

  it('schätzt ohne Zeichenfläche nach der Zahl der Zeichen', () => {
    expect(optionDensity(['Weißkopfseeadler', 'Andenkondor'])).toBe(' options-mid');
    expect(optionDensity(['1987', '1989'])).toBe('');
  });

  it('gibt langen Fragen eine kleinere Schrift', () => {
    expect(promptDensity('Wie hoch ist der Turm?')).toBe('');
    expect(promptDensity('x'.repeat(111))).toBe(' prompt-long');
  });
});
