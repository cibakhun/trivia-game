import { QUESTION_CATEGORIES, type MeResponse, type PlayerStatsResponse } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_VIEWS,
  crestProgress,
  knowledgeExtremes,
  knowledgeRows,
  ofText,
  percentOf,
  percentText,
  secondsText,
  sinceText,
  statusLine,
  tabOf,
  viewAllowed,
} from '../src/menu/account-text.ts';

/** Texte und Rechnungen der Kontoseite (ADR-080). */

describe('Ansichten der Kontoseite', () => {
  it('zeigt Gästen Sichern, Anmelden und Abmelden, gesicherten Konten Name und Passwort', () => {
    const guest = ACCOUNT_VIEWS.filter((v) => viewAllowed(v, true));
    const secured = ACCOUNT_VIEWS.filter((v) => viewAllowed(v, false));
    expect(guest).toEqual(['secure', 'login', 'logout']);
    expect(secured).toEqual(['name', 'password']);
  });

  it('kehrt nach einer Ansicht zum Reiter Zugang zurück, nach der Namenswahl nicht', () => {
    expect(tabOf(null)).toBeNull();
    expect(tabOf('name')).toBeNull();
    expect(tabOf('secure')).toBe('access');
    expect(tabOf('password')).toBe('access');
    expect(tabOf('logout')).toBe('access');
  });
});

describe('Wappenstufe', () => {
  it('beginnt aus Holz und steigt mit den Siegen', () => {
    expect(crestProgress(0)).toEqual({ tier: 'wood', next: 'bronze', toNext: 1, progress: 0 });
    expect(crestProgress(1)).toEqual({ tier: 'bronze', next: 'silver', toNext: 4, progress: 0 });
    expect(crestProgress(3)).toEqual({ tier: 'bronze', next: 'silver', toNext: 2, progress: 0.5 });
    expect(crestProgress(9)).toMatchObject({ tier: 'silver', next: 'gold', toNext: 6 });
    expect(crestProgress(15)).toMatchObject({ tier: 'gold', next: 'crown', toNext: 25 });
  });

  it('endet bei der Krone', () => {
    expect(crestProgress(40)).toEqual({ tier: 'crown', next: null, toNext: 0, progress: 1 });
    expect(crestProgress(400)).toEqual({ tier: 'crown', next: null, toNext: 0, progress: 1 });
  });

  it('übersteht krumme und negative Zahlen', () => {
    expect(crestProgress(-3).tier).toBe('wood');
    expect(crestProgress(4.9)).toMatchObject({ tier: 'bronze', toNext: 1 });
  });
});

describe('Kopf und Zahlen', () => {
  const me = (isGuest: boolean, username: string | null) =>
    ({ user: { isGuest, username } }) as unknown as MeResponse;

  it('nennt den Stand des Kontos', () => {
    expect(statusLine(me(true, null))).toBe('Gast · nicht gesichert');
    expect(statusLine(me(false, 'krisz'))).toBe('Gesichert · krisz');
  });

  it('schreibt das Datum aus', () => {
    expect(sinceText(new Date(2026, 10, 10, 12).toISOString())).toBe(
      'dabei seit 10. November 2026',
    );
  });

  it('rechnet Anteile ohne Grundmenge nicht aus', () => {
    expect(percentOf(9, 23)).toBe(39);
    expect(percentOf(5, 0)).toBeNull();
    expect(percentOf(7, 5)).toBe(100);
    expect(percentText(39)).toBe('39\u00a0%');
    expect(percentText(null)).toBe('–');
  });

  it('zeigt Sekunden mit einer Stelle (geschütztes Leerzeichen) und „von“', () => {
    expect(secondsText(1840)).toBe('1,8\u00a0s');
    expect(secondsText(12_000)).toBe('12,0\u00a0s');
    expect(secondsText(-5)).toBe('0,0\u00a0s');
    expect(ofText(1234, 5000)).toBe('1.234 von 5.000');
  });
});

describe('Wissen je Kategorie', () => {
  const stats = (
    categories: PlayerStatsResponse['trivia']['categories'],
  ): PlayerStatsResponse['trivia'] => ({
    answered: categories.reduce((s, c) => s + c.answered, 0),
    correct: categories.reduce((s, c) => s + c.correct, 0),
    fastestCorrectMs: null,
    categories,
  });

  it('zeigt alle Kategorien, gespielte nach Trefferquote, ungespielte dahinter', () => {
    const rows = knowledgeRows(
      stats([
        { category: 'SPORTS', answered: 10, correct: 5 },
        { category: 'HISTORY', answered: 4, correct: 4 },
        { category: 'SCIENCE', answered: 2, correct: 1 },
        { category: 'GEOGRAPHY', answered: 8, correct: 4 },
      ]),
    );
    expect(rows).toHaveLength(QUESTION_CATEGORIES.length);
    // Gleichstand bei 50 %: mehr Antworten zuerst
    expect(rows.slice(0, 4).map((r) => [r.category, r.rate])).toEqual([
      ['HISTORY', 100],
      ['SPORTS', 50],
      ['GEOGRAPHY', 50],
      ['SCIENCE', 50],
    ]);
    const unplayed = rows.slice(4);
    expect(unplayed.every((r) => r.rate === null && r.answered === 0)).toBe(true);
    expect(unplayed.map((r) => r.category)).toEqual(
      QUESTION_CATEGORIES.filter((c) => !['SPORTS', 'HISTORY', 'SCIENCE', 'GEOGRAPHY'].includes(c)),
    );
  });

  it('nennt stärkstes und schwächstes Gebiet erst ab drei Antworten', () => {
    const rows = knowledgeRows(
      stats([
        { category: 'HISTORY', answered: 2, correct: 2 },
        { category: 'SPORTS', answered: 5, correct: 4 },
        { category: 'ARTS_CULTURE', answered: 3, correct: 1 },
      ]),
    );
    const extremes = knowledgeExtremes(rows);
    expect(extremes?.best.category).toBe('SPORTS');
    expect(extremes?.worst.category).toBe('ARTS_CULTURE');
  });

  it('nennt mit einem Gebiet dasselbe zweimal und ohne keines', () => {
    const one = knowledgeExtremes(
      knowledgeRows(stats([{ category: 'LITERATURE', answered: 3, correct: 2 }])),
    );
    expect(one?.best).toBe(one?.worst);
    expect(knowledgeExtremes(knowledgeRows(stats([])))).toBeNull();
  });
});
