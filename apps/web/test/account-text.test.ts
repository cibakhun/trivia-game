import {
  QUESTION_CATEGORIES,
  type EmailState,
  type MeResponse,
  type PlayerStatsResponse,
} from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_VIEWS,
  accountAlert,
  alertLine,
  alertView,
  crestProgress,
  emailRow,
  emailStatus,
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
  it('zeigt Gästen Sichern, Anmelden und Abmelden, gesicherten Konten Name, Passwort und E-Mail', () => {
    const guest = ACCOUNT_VIEWS.filter((v) => viewAllowed(v, true));
    const secured = ACCOUNT_VIEWS.filter((v) => viewAllowed(v, false));
    expect(guest).toEqual(['secure', 'login', 'logout', 'delete']);
    expect(secured).toEqual(['name', 'password', 'email', 'delete']);
  });

  it('kehrt nach einer Ansicht zum Reiter Zugang zurück, nach der Namenswahl nicht', () => {
    expect(tabOf(null)).toBeNull();
    expect(tabOf('name')).toBeNull();
    expect(tabOf('secure')).toBe('access');
    expect(tabOf('password')).toBe('access');
    expect(tabOf('logout')).toBe('access');
    expect(tabOf('email')).toBe('access');
    expect(tabOf('delete')).toBe('access');
  });
});

describe('E-Mail und gesperrter Name (ADR-086)', () => {
  const DUE = '2026-12-26T21:00:00.000Z';
  const email = (over: Partial<EmailState> = {}): EmailState => ({
    address: 'anna@example.org',
    verified: false,
    pending: null,
    dueAt: DUE,
    ...over,
  });
  const me = (over: { email?: EmailState | null; nameBlocked?: boolean; isGuest?: boolean }) =>
    ({
      user: {
        isGuest: over.isGuest ?? false,
        email: over.email === undefined ? email() : over.email,
      },
      profile: { displayName: 'Anna', nameBlocked: over.nameBlocked ?? false },
    }) as unknown as MeResponse;

  it('mahnt erst den gesperrten Namen, dann die E-Mail mit Frist', () => {
    expect(accountAlert(me({ nameBlocked: true }))).toEqual({ kind: 'name' });
    expect(accountAlert(me({}))).toEqual({ kind: 'emailUnverified', dueAt: DUE });
    expect(accountAlert(me({ email: email({ address: null }) }))).toEqual({
      kind: 'emailMissing',
      dueAt: DUE,
    });
    expect(alertView({ kind: 'name' })).toBe('name');
    expect(alertView({ kind: 'emailMissing', dueAt: DUE })).toBe('email');
  });

  it('drängt nicht ohne Frist, bei bestätigter Adresse und bei Gästen', () => {
    expect(accountAlert(me({ email: email({ dueAt: null }) }))).toBeNull();
    expect(accountAlert(me({ email: email({ verified: true, dueAt: null }) }))).toBeNull();
    expect(accountAlert(me({ isGuest: true, email: null }))).toBeNull();
  });

  it('nennt die Frist mit Tag und Monat', () => {
    expect(alertLine({ kind: 'emailUnverified', dueAt: DUE })).toMatch(
      /^E-Mail bestätigen bis 2[67]\. Dezember$/,
    );
    expect(alertLine({ kind: 'name' })).toBe('Neuen Namen wählen');
  });

  it('beschreibt die Zeile E-Mail im Reiter Zugang', () => {
    expect(emailRow(email({ verified: true, dueAt: null }))).toEqual({
      value: 'anna@example.org',
      note: 'bestätigt',
      urgent: false,
    });
    const unverified = emailRow(email());
    expect(unverified.urgent).toBe(true);
    expect(unverified.note).toMatch(/^bestätigen bis 2[67]\. Dezember$/);
    const missing = emailRow(email({ address: null }));
    expect(missing).toMatchObject({ value: 'keine Adresse', urgent: true });
    expect(missing.note).toMatch(/^eintragen bis/);
    expect(
      emailRow(email({ verified: true, dueAt: null, pending: 'neu@example.org' })),
    ).toMatchObject({ note: 'neue Adresse wartet auf Bestätigung', urgent: false });
    expect(emailRow(email({ dueAt: null }))).toMatchObject({
      note: 'nicht bestätigt',
      urgent: false,
    });
  });

  it('wählt Ton und Text für den Stand der Adresse', () => {
    expect(emailStatus(email({ verified: true, dueAt: null })).tone).toBe('done');
    expect(
      emailStatus(email({ verified: true, dueAt: null, pending: 'neu@example.org' })),
    ).toMatchObject({
      tone: 'wait',
      text: 'Der Link ging an neu@example.org. Bis du ihn öffnest, gilt weiter anna@example.org.',
    });
    const due = emailStatus(email());
    expect(due.tone).toBe('warn');
    expect(due.title).toMatch(/^Bitte bis 2[67]\. Dezember 2026 bestätigen$/);
    expect(emailStatus(email({ dueAt: null }))).toMatchObject({
      tone: 'wait',
      title: 'Noch nicht bestätigt',
    });
    expect(emailStatus(email({ address: null })).tone).toBe('warn');
    expect(emailStatus(email({ address: null, dueAt: null })).tone).toBe('wait');
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
    expect(statusLine(me(true, null))).toBe('Gast · nicht registriert');
    expect(statusLine(me(false, 'krisz'))).toBe('Registriert');
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
