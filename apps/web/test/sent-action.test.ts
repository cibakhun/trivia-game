import { describe, expect, it } from 'vitest';
import { stillSent } from '../src/match/sent-action.ts';

/**
 * Eine abgeschickte Wahl gilt als unterwegs, bis der Server geantwortet hat: mit einem neuen
 * Ereignis (die Ansicht ist weiter) oder mit einem Fehler. Dazwischen liegt die Lücke zwischen
 * dem Ende der Anfrage und der nächsten Abfrage; in ihr darf die Karte nicht zurückspringen.
 */
describe('Abgeschickte Wahl', () => {
  it('ist ohne Tipp nicht unterwegs', () => {
    expect(stillSent(null, 7, false)).toBe(false);
  });

  it('bleibt unterwegs, solange die Ansicht auf dem Stand des Tipps steht', () => {
    expect(stillSent({ region: 12, seq: 7 }, 7, false)).toBe(true);
    // „Fertig“ der Rüstzeit hat kein Feld
    expect(stillSent({ region: null, seq: 7 }, 7, false)).toBe(true);
  });

  it('endet mit dem nächsten Ereignis des Servers', () => {
    expect(stillSent({ region: 12, seq: 7 }, 8, false)).toBe(false);
    // Auch eine Ansicht ohne Ereignisstand (Seite lädt neu) hält nichts fest
    expect(stillSent({ region: 12, seq: 7 }, null, false)).toBe(false);
  });

  it('endet mit einem Fehler: Die Wahl ist wieder frei', () => {
    expect(stillSent({ region: 12, seq: 7 }, 7, true)).toBe(false);
  });
});
