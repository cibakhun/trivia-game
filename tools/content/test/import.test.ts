import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { contentHash, validateQuestionText, type QuestionFile } from '../src/index.ts';

const base = {
  schema_version: 1,
  key: 'hash-frage',
  kind: 'TRIVIA',
  category: 'SCIENCE',
  difficulty: 2,
  origin: 'AI_ASSISTED',
  license_note: null,
  status: 'DRAFT',
  tags: [],
  sources: [{ title: 'Gold', url: 'https://en.wikipedia.org/wiki/Gold', accessed: '2026-11-09' }],
  reviews: [],
  trivia: { options: ['a', 'b', 'c', 'd'], correct: 'b' },
  translations: {
    de: {
      status: 'DRAFT',
      prompt: 'Welches chemische Symbol hat Gold?',
      options: { a: 'Ag', b: 'Au', c: 'Go', d: 'Gd' },
    },
  },
};

function parse(text: string): QuestionFile {
  const result = validateQuestionText(text, { file: 'hash-frage.yaml', fixture: false });
  if (!result.question) throw new Error(JSON.stringify(result.issues));
  return result.question;
}

describe('contentHash', () => {
  const hash = contentHash(parse(stringify(base)));

  it('ist ein SHA-256 in Hex', () => {
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hängt nicht von Formatierung, Kommentaren und Schlüsselreihenfolge ab', () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse());
    const text = `# Kommentar\n${stringify(reordered, { indent: 4 })}`;
    expect(contentHash(parse(text))).toBe(hash);
  });

  it('ignoriert Status und Felder der Frage (Kategorie, Tags, Herkunft)', () => {
    const changed = {
      ...base,
      status: 'IN_REVIEW',
      category: 'HISTORY',
      origin: 'EDITORIAL',
      tags: ['region:HU'],
    };
    expect(contentHash(parse(stringify(changed)))).toBe(hash);
  });

  it('ignoriert die Reihenfolge von Optionen und Prüfungen (ohne Reihenfolge gespeichert)', () => {
    const fact = { kind: 'FACT', reviewer: 'Anna', date: '2026-11-09' };
    const language = { kind: 'LANGUAGE', locale: 'de', reviewer: 'Ben', date: '2026-11-09' };
    const reviewed = contentHash(parse(stringify({ ...base, reviews: [fact, language] })));
    expect(contentHash(parse(stringify({ ...base, reviews: [language, fact] })))).toBe(reviewed);
    const options = { ...base, trivia: { ...base.trivia, options: ['d', 'c', 'b', 'a'] } };
    expect(contentHash(parse(stringify(options)))).toBe(hash);
  });

  it('ändert sich mit dem Inhalt der Version', () => {
    expect(contentHash(parse(stringify({ ...base, difficulty: 3 })))).not.toBe(hash);
    const prompt = {
      ...base,
      translations: { de: { ...base.translations.de, prompt: 'Welches Symbol hat das Gold?' } },
    };
    expect(contentHash(parse(stringify(prompt)))).not.toBe(hash);
    const correct = { ...base, trivia: { ...base.trivia, correct: 'a' } };
    expect(contentHash(parse(stringify(correct)))).not.toBe(hash);
  });
});
