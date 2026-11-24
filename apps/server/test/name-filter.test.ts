import {
  PLAYER_NAME_ADJECTIVES,
  PLAYER_NAME_NOUNS,
  PLAYER_NAME_NUMBER_MAX,
  PLAYER_NAME_NUMBER_MIN,
  playerDisplayName,
} from '@rdw/game-core';
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

  it('lässt jeden Namen aus den Bausteinen durch (Ideen unter dem Feld); nur die Zahl 88 nicht', () => {
    for (const adjective of PLAYER_NAME_ADJECTIVES) {
      for (const noun of Object.keys(PLAYER_NAME_NOUNS)) {
        const name = playerDisplayName({ adjective, noun, number: null });
        expect(nameAllowed(name), name).toBe(true);
      }
    }
    for (let number = PLAYER_NAME_NUMBER_MIN; number <= PLAYER_NAME_NUMBER_MAX; number++) {
      const name = playerDisplayName({ adjective: 'Kühn', noun: 'Falke', number });
      expect(nameAllowed(name), name).toBe(number !== 88);
    }
  });
});
