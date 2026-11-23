import { matchEventPayloadSchemas } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  categoryRows,
  tallyEvents,
  tallyMatches,
  type FinishedMatch,
  type StatsEvent,
} from '../src/modules/match/stats.ts';

/** Eigene Zahlen der Kontoseite (`GET /me/stats`, ADR-080): die Rechnung ohne Datenbank. */

const finished = (
  id: string,
  minute: number,
  place: number | null,
  extra: Partial<FinishedMatch> = {},
): FinishedMatch => ({
  id,
  mode: 'CLASSIC',
  seat: 0,
  finishedAt: new Date(Date.UTC(2026, 10, 20, 12, minute)),
  createdAt: new Date(Date.UTC(2026, 10, 20, 11, minute)),
  final:
    place === null
      ? null
      : {
          standings: [
            { seat: 0, place },
            { seat: 1, place: place === 1 ? 2 : 1 },
          ],
        },
  ...extra,
});

describe('Bilanz über beendete Partien', () => {
  it('zählt Partien, Siege, Plätze und Spielarten', () => {
    const result = tallyMatches([
      finished('a', 1, 1),
      finished('b', 2, 2, { mode: 'REALM' }),
      finished('c', 3, 3),
      finished('d', 4, 1, { mode: 'REALM' }),
      finished('e', 5, null),
    ]);
    expect(result).toEqual({
      played: 5,
      won: 2,
      places: { first: 2, second: 1, third: 1 },
      classic: { played: 3, won: 1 },
      realm: { played: 2, won: 1 },
      streak: { current: 0, best: 1 },
    });
  });

  it('liest Siegesserien in der Reihenfolge des Endes, nicht der Eingabe', () => {
    const result = tallyMatches([
      finished('late', 50, 1),
      finished('first', 10, 1),
      finished('lost', 20, 2),
      finished('mid', 30, 1),
      finished('mid2', 40, 1),
    ]);
    // first (Sieg), lost, mid, mid2, late: drei Siege am Stück bis zuletzt
    expect(result.streak).toEqual({ current: 3, best: 3 });
  });

  it('nimmt ohne Ende den Beginn und bei gleicher Zeit die ID', () => {
    const result = tallyMatches([
      finished('b', 0, 2, { finishedAt: null, createdAt: new Date(Date.UTC(2026, 10, 20, 13)) }),
      finished('a', 0, 1, { finishedAt: null, createdAt: new Date(Date.UTC(2026, 10, 20, 13)) }),
    ]);
    // a vor b: erst Sieg, dann Niederlage
    expect(result.streak).toEqual({ current: 0, best: 1 });
  });

  it('ist ohne Partien überall null', () => {
    expect(tallyMatches([])).toEqual({
      played: 0,
      won: 0,
      places: { first: 0, second: 0, third: 0 },
      classic: { played: 0, won: 0 },
      realm: { played: 0, won: 0 },
      streak: { current: 0, best: 0 },
    });
  });
});

describe('Duelle und Schätzungen aus den Ereignissen', () => {
  const seats = new Map([
    ['m1', 0],
    ['m2', 2],
  ]);

  const duel = (
    matchId: string,
    attacker: number,
    defender: number,
    winner: 'ATTACKER' | 'DEFENDER',
    reason: 'TRIVIA' | 'ESTIMATE' | 'SPEED' = 'TRIVIA',
  ): StatsEvent => ({
    matchId,
    type: 'DUEL_RESOLVED',
    payload: {
      round: 1,
      duel: 1,
      attacker,
      defender,
      region: 4,
      winner,
      reason,
      effect: 'CONQUERED',
      capitalLivesLeft: null,
      regionValue: 300,
    },
  });

  const realmDuel = (
    matchId: string,
    attacker: number,
    defender: number | null,
    winner: 'ATTACKER' | 'DEFENDER' | 'NONE',
  ): StatsEvent => ({
    matchId,
    type: 'REALM_DUEL_RESOLVED',
    payload: {
      round: 2,
      duel: 1,
      attacker,
      defender,
      region: 7,
      category: 'HISTORY',
      winner,
      reason: 'TRIVIA',
      effect: 'CONQUERED',
      building: 'NONE',
      castleLivesLeft: null,
      regionValue: 300,
      armyLost: null,
    },
  });

  const ranked = (
    matchId: string,
    type: 'LAND_RANKED' | 'START_RANKED',
    ranking: { seat: number; place: number; distance: string | null }[],
  ): StatsEvent => ({
    matchId,
    type,
    payload:
      type === 'LAND_RANKED'
        ? {
            round: 1,
            ranking: ranking.map((r) => ({ ...r, picks: 1, effectiveMs: 2000 })),
          }
        : { ranking: ranking.map((r) => ({ ...r, effectiveMs: 2000 })) },
  });

  it('nutzt Inhalte, die zu den Schemas passen', () => {
    expect(
      matchEventPayloadSchemas.DUEL_RESOLVED.safeParse(duel('m1', 0, 1, 'ATTACKER').payload)
        .success,
    ).toBe(true);
    expect(
      matchEventPayloadSchemas.REALM_DUEL_RESOLVED.safeParse(
        realmDuel('m1', 0, null, 'NONE').payload,
      ).success,
    ).toBe(true);
    expect(
      matchEventPayloadSchemas.LAND_RANKED.safeParse(
        ranked('m1', 'LAND_RANKED', [{ seat: 0, place: 1, distance: '3' }]).payload,
      ).success,
    ).toBe(true);
    expect(
      matchEventPayloadSchemas.START_RANKED.safeParse(
        ranked('m1', 'START_RANKED', [{ seat: 0, place: 1, distance: '3' }]).payload,
      ).success,
    ).toBe(true);
  });

  it('zählt eigene Duelle als Angreifer und Verteidiger', () => {
    const { duels } = tallyEvents(
      [
        duel('m1', 0, 1, 'ATTACKER'), // gewonnen als Angreifer
        duel('m1', 1, 0, 'DEFENDER'), // gewonnen als Verteidiger
        duel('m1', 1, 0, 'ATTACKER'), // verloren
        duel('m1', 1, 2, 'ATTACKER'), // fremdes Duell
        duel('m2', 2, 0, 'DEFENDER'), // in m2 sitzt man auf 2: verloren
      ],
      seats,
    );
    expect(duels).toEqual({ fought: 4, won: 2, toppled: 0 });
  });

  it('zählt Angriffe auf freie Felder nicht als Duell', () => {
    const { duels } = tallyEvents(
      [realmDuel('m1', 0, null, 'ATTACKER'), realmDuel('m1', 0, 2, 'ATTACKER')],
      seats,
    );
    expect(duels).toEqual({ fought: 1, won: 1, toppled: 0 });
  });

  it('zählt Schätzungen auf Platz 1 und per Schätzung gewonnene Duelle', () => {
    const { closest } = tallyEvents(
      [
        ranked('m1', 'LAND_RANKED', [
          { seat: 0, place: 1, distance: '2' },
          { seat: 1, place: 2, distance: '9' },
        ]),
        // Platz 1 ohne eigene Schätzung zählt nicht
        ranked('m1', 'LAND_RANKED', [
          { seat: 0, place: 1, distance: null },
          { seat: 1, place: 1, distance: null },
        ]),
        ranked('m2', 'START_RANKED', [
          { seat: 2, place: 1, distance: '0' },
          { seat: 0, place: 2, distance: '5' },
        ]),
        duel('m1', 0, 1, 'ATTACKER', 'ESTIMATE'),
        duel('m1', 0, 1, 'DEFENDER', 'ESTIMATE'), // verloren
        duel('m1', 0, 1, 'ATTACKER', 'SPEED'), // keine Schätzung
      ],
      seats,
    );
    expect(closest).toBe(3);
  });

  it('zählt gestürzte Reiche, nicht das eigene', () => {
    const eliminated = (matchId: string, seat: number, by: number): StatsEvent => ({
      matchId,
      type: 'KINGDOM_ELIMINATED',
      payload: { round: 3, seat, by, regions: 2 },
    });
    const { duels } = tallyEvents(
      [
        eliminated('m1', 1, 0),
        eliminated('m1', 0, 1),
        eliminated('m2', 0, 2),
        eliminated('m1', 2, 1),
      ],
      seats,
    );
    expect(duels.toppled).toBe(2);
  });

  it('übergeht fremde Partien und unlesbare Inhalte', () => {
    const result = tallyEvents(
      [
        duel('fremd', 0, 1, 'ATTACKER'),
        { matchId: 'm1', type: 'DUEL_RESOLVED', payload: { attacker: 0 } },
        { matchId: 'm1', type: 'LAND_RANKED', payload: 'kaputt' },
        { matchId: 'm1', type: 'KINGDOM_ELIMINATED', payload: null },
        { matchId: 'm1', type: 'REGION_CLAIMED', payload: { round: 1, seat: 0, region: 1 } },
      ],
      seats,
    );
    expect(result).toEqual({ duels: { fought: 0, won: 0, toppled: 0 }, closest: 0 });
  });
});

describe('Wissen je Kategorie', () => {
  it('ordnet nach der festen Reihenfolge und lässt Unbekanntes und Leeres weg', () => {
    expect(
      categoryRows([
        { category: 'SPORTS', answered: 4, correct: 1 },
        { category: 'HISTORY', answered: 3, correct: 5 },
        { category: 'ASTROLOGY', answered: 9, correct: 9 },
        { category: 'SCIENCE', answered: 0, correct: 0 },
      ]),
    ).toEqual([
      { category: 'HISTORY', answered: 3, correct: 3 },
      { category: 'SPORTS', answered: 4, correct: 1 },
    ]);
  });
});
