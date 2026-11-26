import { describe, expect, it } from 'vitest';
import {
  normalizeUsername,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
  registerRequestSchema,
  usernameProblem,
  usernameSchema,
} from '../src/index.ts';

/** Eigener Benutzername (ADR-082): Vereinheitlichung und Regeln, gleich in Client und Server. */
describe('Benutzername', () => {
  it('vereinheitlicht Leerraum und Unicode-Form', () => {
    expect(normalizeUsername('  Ödön \t  Kőszegi  ')).toBe('Ödön Kőszegi');
    // „ö“ aus o + Trema wird ein Zeichen (NFC)
    expect(normalizeUsername('König')).toBe('König');
  });

  it('nimmt übliche Namen an', () => {
    for (const name of [
      'Krisz',
      'krisz_93',
      'Kühner Falke 7',
      'Łukasz',
      'Anna-Lena',
      'Mr.Bean',
      'Ádám',
      // Rumänisch und Türkisch (Hinweis aus der Durchsicht von PR #48)
      'Ștefan Țepeș',
      'İpek Işık',
      'abc',
      'a'.repeat(20),
    ]) {
      expect(usernameProblem(name), name).toBeNull();
      expect(usernameSchema.safeParse(name).success, name).toBe(true);
    }
  });

  it('nennt den Grund, wenn ein Name nicht passt', () => {
    expect(usernameProblem('')).toBe('SHORT');
    expect(usernameProblem('ab')).toBe('SHORT');
    expect(usernameProblem('a'.repeat(21))).toBe('LONG');
    expect(usernameProblem('Krisz!')).toBe('CHARS');
    expect(usernameProblem('Krisz😀')).toBe('CHARS');
    // Kyrillisch, Griechisch: sehen aus wie lateinische Buchstaben
    expect(usernameProblem('Кrisz')).toBe('CHARS');
    expect(usernameProblem('Οrisz')).toBe('CHARS');
    expect(usernameProblem('_Krisz')).toBe('EDGE');
    expect(usernameProblem('Krisz.')).toBe('EDGE');
    expect(usernameProblem('Kri__sz')).toBe('DOUBLE');
    expect(usernameProblem('Kri -sz')).toBe('DOUBLE');
    expect(usernameProblem('J.R.R. Tolkien')).toBe('DOUBLE');
    expect(usernameProblem('2026')).toBe('NO_LETTER');
  });

  it('zählt Zeichen, nicht UTF-16-Einheiten, und prüft nach dem Vereinheitlichen', () => {
    expect(usernameSchema.parse('   Kőszegi Ödön   ')).toBe('Kőszegi Ödön');
    expect(usernameSchema.safeParse('  ab  ').success).toBe(false);
  });

  it('verlangt beim Registrieren Name, E-Mail-Adresse und Passwort, mindestens sieben Zeichen', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(7);
    expect(passwordSchema.safeParse('sechs6').success).toBe(false);
    expect(passwordSchema.safeParse('sieben7').success).toBe(true);
    expect(
      registerRequestSchema.parse({
        username: ' Krisz ',
        email: ' krisz@example.org ',
        password: 'sieben7',
      }),
    ).toEqual({ username: 'Krisz', email: 'krisz@example.org', password: 'sieben7' });
    // Seit ADR-086 gehört die Adresse dazu, und sie muss eine sein
    expect(
      registerRequestSchema.safeParse({ username: 'Krisz', password: 'sieben7' }).success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({ username: 'Krisz', email: 'krisz@', password: 'sieben7' })
        .success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({
        username: 'Krisz',
        email: 'krisz@example.org',
        password: 'sieben7',
        playerName: { adjective: 'Kühn', noun: 'Falke', number: null },
      }).success,
    ).toBe(false);
  });
});
