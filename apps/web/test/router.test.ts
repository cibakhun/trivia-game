import { describe, expect, it } from 'vitest';
import { kingdomColor, KINGDOM_COLORS } from '../src/map/palette.ts';
import { parseRoute, routePath } from '../src/router.ts';

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
