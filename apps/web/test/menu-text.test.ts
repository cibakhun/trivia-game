import type { MatchRecord, MeResponse } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  answersText,
  chronicleDetail,
  hitRate,
  initialOf,
  isOpenMatch,
  modeText,
  openLine,
  opponentsText,
  placeText,
  playerName,
  recordLine,
  whenText,
  type MatchSummary,
} from '../src/menu/menu-text.ts';

/** Texte des Hauptmenüs (ADR-074): Plakette, offene Partie und Zeilen der Chronik. */

const NOW = new Date(2026, 10, 16, 20, 15);

function at(day: number, hour: number, minute: number): string {
  return new Date(2026, 10, day, hour, minute).toISOString();
}

function summary(over: Partial<MatchSummary> = {}): MatchSummary {
  return {
    id: '0b8f5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
    kind: 'STANDARD',
    mode: 'REALM',
    status: 'FINISHED',
    createdAt: at(16, 16, 40),
    finishedAt: at(16, 17, 2),
    players: 3,
    place: 1,
    opponents: [
      { name: 'Márton', botStrength: null },
      { name: 'Bot (schwer)', botStrength: 'HARD' },
    ],
    answered: 12,
    correct: 9,
    ...over,
  } as MatchSummary;
}

function me(displayName: string | null, username: string | null, isGuest: boolean): MeResponse {
  return {
    user: { id: '0b8f5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', isGuest, username, createdAt: at(1, 9, 0) },
    profile: { displayName },
  } as unknown as MeResponse;
}

describe('Plakette', () => {
  it('nennt Spielername, sonst Anmeldename, sonst „Gast“', () => {
    expect(playerName(me('Krisztián', 'krisz', false))).toBe('Krisztián');
    expect(playerName(me(null, 'krisz', false))).toBe('krisz');
    expect(playerName(me(null, null, true))).toBe('Gast');
  });

  it('nimmt den ersten Buchstaben groß ins Wappen, auch mit Akzent', () => {
    expect(initialOf('  ádám')).toBe('Á');
    expect(initialOf('')).toBe('?');
  });

  it('zeigt die Bilanz mit Einzahl und Mehrzahl', () => {
    const record: MatchRecord = { played: 12, won: 1, answered: 40, correct: 30 };
    expect(recordLine(record)).toBe('12 Partien · 1 Sieg');
    expect(recordLine({ ...record, played: 1, won: 0 })).toBe('1 Partie · 0 Siege');
  });

  it('rechnet die Trefferquote gerundet und ohne Antwort gar nicht', () => {
    expect(hitRate({ answered: 12, correct: 9 })).toBe(75);
    expect(hitRate({ answered: 3, correct: 2 })).toBe(67);
    expect(hitRate({ answered: 0, correct: 0 })).toBeNull();
    // Mehr Richtige als Antworten kann es nicht geben: höchstens 100 %
    expect(hitRate({ answered: 2, correct: 5 })).toBe(100);
  });
});

describe('Zeitpunkt', () => {
  it('sagt heute und gestern, sonst Wochentag und Datum', () => {
    expect(whenText(at(16, 16, 40), NOW)).toBe('heute, 16:40');
    expect(whenText(at(15, 21, 5), NOW)).toBe('gestern, 21:05');
    expect(whenText(at(12, 9, 30), NOW)).toBe('Do., 12.11., 09:30');
  });
});

describe('Offene Partie', () => {
  it('ist offen in der Aufstellung und während sie läuft', () => {
    expect(isOpenMatch(summary({ status: 'LOBBY' }))).toBe(true);
    expect(isOpenMatch(summary({ status: 'RUNNING' }))).toBe(true);
    expect(isOpenMatch(summary({ status: 'FINISHED' }))).toBe(false);
    expect(isOpenMatch(summary({ status: 'ABANDONED' }))).toBe(false);
  });

  it('nennt Spielart, Beginn und Spieler; Übungspartien ohne Spielerzahl', () => {
    expect(openLine(summary({ status: 'RUNNING' }), NOW)).toBe(
      'Mit Ausbau · seit heute, 16:40 · 3 Spieler',
    );
    expect(openLine(summary({ status: 'LOBBY', kind: 'TEST', mode: 'CLASSIC' }), NOW)).toBe(
      'Übungspartie, Klassisch · seit heute, 16:40',
    );
  });
});

describe('Chronik', () => {
  it('nennt die Spielart, bei Übungspartien mit Zusatz', () => {
    expect(modeText({ mode: 'CLASSIC', kind: 'STANDARD' })).toBe('Klassisch');
    expect(modeText({ mode: 'REALM', kind: 'TEST' })).toBe('Übungspartie, Mit Ausbau');
  });

  it('zeigt Sieg, Platz oder Abbruch', () => {
    expect(placeText({ status: 'FINISHED', place: 1 })).toBe('Sieg');
    expect(placeText({ status: 'FINISHED', place: 2 })).toBe('2.');
    expect(placeText({ status: 'FINISHED', place: null })).toBe('–');
    expect(placeText({ status: 'ABANDONED', place: 1 })).toBe('abgebrochen');
  });

  it('nennt bis zu zwei Gegner, Gäste ohne Namen als „einen Gast“', () => {
    expect(opponentsText(summary())).toBe('gegen Márton und Bot (schwer)');
    expect(opponentsText({ opponents: [{ name: null, botStrength: null }] })).toBe(
      'gegen einen Gast',
    );
    expect(opponentsText({ opponents: [] })).toBe('');
  });

  it('zählt die eigenen Wissensfragen und lässt die Zeile ohne Antwort weg', () => {
    expect(answersText({ answered: 12, correct: 9 })).toBe('9 von 12 richtig');
    expect(answersText({ answered: 0, correct: 0 })).toBe('');
    expect(chronicleDetail(summary())).toBe('gegen Márton und Bot (schwer) · 9 von 12 richtig');
    expect(chronicleDetail(summary({ opponents: [], answered: 0, correct: 0 }))).toBe('');
  });
});
