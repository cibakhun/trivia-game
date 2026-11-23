import type { NameCheckStatus } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import { learnStatus } from '../src/components/NameField.tsx';

/** Namensfeld (ADR-082): ältere Antworten überschreiben kein neueres Ergebnis. */
describe('Namensfeld: bekannte Ergebnisse', () => {
  it('merkt sich Prüfung und Ideen nur für Namen ohne Ergebnis', () => {
    let known: ReadonlyMap<string, NameCheckStatus> = new Map();
    known = learnStatus(known, 'Krisz', 'FREE');
    expect(known.get('Krisz')).toBe('FREE');
    // Beim Absenden zeigt sich: vergeben (remember setzt das direkt)
    known = new Map(known).set('Krisz', 'TAKEN');
    // Danach treffen eine ältere Prüfung und eine ältere Liste von Ideen ein
    const before = known;
    known = learnStatus(known, 'Krisz', 'FREE');
    expect(known.get('Krisz')).toBe('TAKEN');
    expect(known).toBe(before);
    // Andere Namen lernt das Feld weiter
    known = learnStatus(known, 'Weiser Biber', 'FREE');
    expect(known.get('Weiser Biber')).toBe('FREE');
  });
});
