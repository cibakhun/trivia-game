import { describe, expect, it } from 'vitest';
import { nameAllowed } from '../src/modules/identity/name-filter.ts';

/** Wortfilter für eigene Namen (ADR-082) [E]. */
describe('Wortfilter für Benutzernamen', () => {
  it('lässt gewöhnliche Namen durch, auch mit harmlosen Wortteilen', () => {
    for (const name of [
      'Krisz',
      'Anna Zimmer',
      'AnnaZimmer',
      'Badminton Bert',
      'Essex',
      'Peacock',
      'Kühner Falke 7',
      'Botond',
      'Szarvas',
      'Fuchsschwanz',
      'Graues Rotkehlchen',
      'Gastgeber',
      'Spaß 99',
    ]) {
      expect(nameAllowed(name), name).toBe(true);
    }
  });

  it('hält Beleidigungen, NS-Bezüge und Obszönes ab, auch verschleiert', () => {
    for (const name of [
      'Hurensohn',
      'H1tler',
      'Hit ler',
      'H.i.t.l.e.r',
      'NaZi',
      'Fuuuuck',
      'fück_you',
      'Sieg Heil',
      'Kurva Anyad',
      'Anyad',
      'Kevin 1488',
      'Team SS',
      'Sex Gott',
      'B1tch',
      'Arsch-Loch',
      'Szar',
    ]) {
      expect(nameAllowed(name), name).toBe(false);
    }
  });

  it('reserviert Ämter und Namen wie die der Bots', () => {
    for (const name of [
      'Admin',
      'Administrator',
      'Moderator Max',
      'Spielleitung',
      'Bot 2',
      'Gast',
    ]) {
      expect(nameAllowed(name), name).toBe(false);
    }
  });
});
