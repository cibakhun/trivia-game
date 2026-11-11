import { describe, expect, it } from 'vitest';
import { kingdomColor, KINGDOM_COLORS } from '../src/map/palette.ts';
import { inviteLink, parseRoute, routePath } from '../src/router.ts';

const ID = '0b8f5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

describe('Router', () => {
  it('erkennt Karte und Herausforderung mit UUID', () => {
    expect(parseRoute(`/play/${ID}`)).toEqual({ name: 'play', instanceId: ID });
    expect(parseRoute(`/challenge/${ID}/`)).toEqual({ name: 'challenge', challengeId: ID });
    expect(routePath({ name: 'play', instanceId: ID })).toBe(`/play/${ID}`);
  });

  it('kennt Weltwahl und Konto', () => {
    expect(parseRoute('/welten')).toEqual({ name: 'worlds' });
    expect(parseRoute('/konto/')).toEqual({ name: 'account' });
    expect(routePath({ name: 'worlds' })).toBe('/welten');
    expect(routePath({ name: 'account' })).toBe('/konto');
    expect(parseRoute('/kontos')).toEqual({ name: 'start' });
  });

  it('kennt die Partie mit und ohne ID', () => {
    expect(parseRoute('/partie')).toEqual({ name: 'matches' });
    expect(parseRoute('/partie/')).toEqual({ name: 'matches' });
    expect(parseRoute(`/partie/${ID}`)).toEqual({ name: 'match', matchId: ID });
    expect(routePath({ name: 'matches' })).toBe('/partie');
    expect(routePath({ name: 'match', matchId: ID })).toBe(`/partie/${ID}`);
    expect(parseRoute('/partie/ABCDEF')).toEqual({ name: 'start' });
  });

  it('kennt den Einladungslink, Groß- und Kleinschreibung egal', () => {
    expect(parseRoute('/partie/beitreten/K7M2QX')).toEqual({ name: 'matchJoin', code: 'K7M2QX' });
    expect(parseRoute('/partie/beitreten/k7m2qx/')).toEqual({ name: 'matchJoin', code: 'K7M2QX' });
    expect(routePath({ name: 'matchJoin', code: 'K7M2QX' })).toBe('/partie/beitreten/K7M2QX');
    // Der Link entsteht aus der Adresse, unter der das Spiel gerade läuft
    expect(inviteLink('K7M2QX', 'https://spiel.example')).toBe(
      'https://spiel.example/partie/beitreten/K7M2QX',
    );
    // Ein zu kurzer Code bleibt ein Einladungslink: Die Seite sagt, dass er unvollständig ist
    expect(parseRoute('/partie/beitreten/K7M')).toEqual({ name: 'matchJoin', code: 'K7M' });
    // Ohne Code oder mit fremden Zeichen und Pfaden geht es zur Startseite
    expect(parseRoute('/partie/beitreten/')).toEqual({ name: 'start' });
    expect(parseRoute('/partie/beitreten/K7M2QX/x')).toEqual({ name: 'start' });
    expect(parseRoute('/partie/beitreten/K7%20M2QX')).toEqual({ name: 'start' });
  });

  it('schickt IDs ohne UUID-Form zur Startseite', () => {
    expect(parseRoute('/play/------------------------------------')).toEqual({ name: 'start' });
    expect(parseRoute('/challenge/0b8f5a3e1c2d4e5f8a9b0c1d2e3f4a5b----')).toEqual({
      name: 'start',
    });
    expect(parseRoute(`/play/${ID}x`)).toEqual({ name: 'start' });
    expect(parseRoute('/unbekannt')).toEqual({ name: 'start' });
  });
});

describe('Reichsfarben', () => {
  it('liefert die Farbe zum Index und Grau für jeden ungültigen Index', () => {
    expect(kingdomColor(0)).toBe(KINGDOM_COLORS[0]);
    expect(kingdomColor(KINGDOM_COLORS.length - 1)).toBe(KINGDOM_COLORS.at(-1));
    for (const invalid of [-1, KINGDOM_COLORS.length, 1.5]) {
      expect(kingdomColor(invalid)).toBe(0x888888);
    }
  });
});
