import { describe, expect, it } from 'vitest';
import { compactNames } from '../src/match/match-text.ts';
import { viewOf } from './match-fixtures.ts';

/** Knappe Namen für Zeilen, in denen zwei Namen nebeneinander stehen (Politur 2026-11-23). */
describe('compactNames', () => {
  function player(seat: number, name: string, isBot: boolean, isMe = false) {
    return {
      joinOrder: seat,
      seat,
      name,
      isBot,
      botStrength: isBot ? ('MEDIUM' as const) : null,
      isHost: isMe,
      isMe,
      favorites: null,
    };
  }

  it('lässt die Stärke weg, wenn die Bots auch ohne sie verschieden heißen', () => {
    const view = viewOf({
      players: [
        player(0, 'Anna', false, true),
        player(1, 'Bot 1 (mittel)', true),
        player(2, 'Bot 2 (mittel)', true),
      ],
    });
    const compact = compactNames(view);
    expect(compact(1)).toBe('Bot 1');
    expect(compact(2)).toBe('Bot 2');
    expect(compact(0)).toBe('Du');
  });

  it('behält die Stärke, wenn erst sie die Bots unterscheidet', () => {
    // Die Grundpartie der Testdaten: „Bot (leicht)“ und „Bot (schwer)“
    const compact = compactNames(viewOf());
    expect(compact(0)).toBe('Bot (leicht)');
    expect(compact(2)).toBe('Bot (schwer)');
  });

  it('kürzt einen einzelnen Bot und lässt Menschen, wie sie heißen', () => {
    const view = viewOf({
      players: [
        player(0, 'Anna', false, true),
        player(1, 'Bot (mittel)', true),
        player(2, 'Fröhliches Rotkehlchen (mittel)', false),
      ],
    });
    const compact = compactNames(view);
    expect(compact(1)).toBe('Bot');
    // Ein Mensch darf so heißen; sein Name bleibt ganz
    expect(compact(2)).toBe('Fröhliches Rotkehlchen (mittel)');
  });
});
