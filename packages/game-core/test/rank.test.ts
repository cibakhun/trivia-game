import { describe, expect, it } from 'vitest';
import { kingdomRank } from '../src/index.ts';

describe('kingdomRank (GAME_RULES §3.6)', () => {
  it.each([
    [0, null],
    [1, 'SETTLEMENT'],
    [4, 'SETTLEMENT'],
    [5, 'VILLAGE_LEAGUE'],
    [14, 'VILLAGE_LEAGUE'],
    [15, 'PRINCIPALITY'],
    [39, 'PRINCIPALITY'],
    [40, 'KINGDOM'],
    [99, 'KINGDOM'],
    [100, 'GREAT_KINGDOM'],
    [249, 'GREAT_KINGDOM'],
    [250, 'EMPIRE'],
    [1_000_000, 'EMPIRE'],
  ])('%i Regionen → %s', (regions, rank) => {
    expect(kingdomRank(regions)).toBe(rank);
  });

  it.each([-1, 1.5, Number.NaN])('lehnt %s ab', (n) => {
    expect(() => kingdomRank(n)).toThrow(RangeError);
  });
});
