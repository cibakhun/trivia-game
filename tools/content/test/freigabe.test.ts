import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { validateQuestionText } from '../src/index.ts';
import { answerOf, approvalListSchema, approve, CLAUDE_REVIEWER, type ApprovalEntry } from '../src/freigabe.ts';
import { generateFromTemplate, type Template } from '../src/wikidata/generate.ts';
import { TEMPLATES } from '../src/wikidata/templates.ts';

const template = (id: string): Template => {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Vorlage ${id} fehlt`);
  return t;
};

const [zugspitze] = generateFromTemplate(template('berg-hoehe'), {
  name: 'berge-hoehe',
  fetchedAt: '2026-11-13T01:00:00.000Z',
  rows: [{ item: 'Q3375', label: 'Zugspitze', sitelinks: '90', value: '2962.06' }],
});
const question = zugspitze!.question;

const entry: ApprovalEntry = {
  date: '2026-11-13',
  fact: 'Wert aus Wikidata mit dem Artikel „Zugspitze“ der deutschen Wikipedia abgeglichen (Infobox: 2962; Abweichung 0.0 %).',
  lang: 'Fragetext und Einheit von Claude gelesen: verständlich und eindeutig.',
  prompt: 'Wie hoch ist die Zugspitze (in Metern über dem Meeresspiegel)?',
  answer: '2962',
};

describe('Freigabe durch Claude (ADR-072)', () => {
  it('macht eine geprüfte Frage freigabefähig, mit beiden Prüfungen', () => {
    const approved = approve(question, entry);
    expect(approved.status).toBe('APPROVED');
    expect(approved.translations.de?.status).toBe('APPROVED');
    expect(approved.reviews).toEqual([
      { kind: 'FACT', reviewer: CLAUDE_REVIEWER, date: '2026-11-13', note: entry.fact },
      { kind: 'LANGUAGE', locale: 'de', reviewer: CLAUDE_REVIEWER, date: '2026-11-13', note: entry.lang },
    ]);
    const { issues } = validateQuestionText(stringify(approved), {
      file: `content/questions/wikidata/${approved.key}.yaml`,
      fixture: false,
    });
    expect(issues).toEqual([]);
    // das Original bleibt ein Entwurf
    expect(question.status).toBe('DRAFT');
  });

  it('gilt nur für den geprüften Wortlaut', () => {
    expect(answerOf(question)).toBe('2962');
    expect(() => approve(question, { ...entry, answer: '2963' })).toThrow(/Antwort/);
    expect(() => approve(question, { ...entry, prompt: 'Wie hoch ist die Zugspitze?' })).toThrow(/Fragetext/);
  });

  it('verlangt Datum, Notizen, Fragetext und Antwort in der Liste', () => {
    expect(approvalListSchema.safeParse({ 'wd-berg-hoehe-q3375': entry }).success).toBe(true);
    const withoutAnswer: Partial<ApprovalEntry> = { ...entry };
    delete withoutAnswer.answer;
    expect(approvalListSchema.safeParse({ 'wd-berg-hoehe-q3375': withoutAnswer }).success).toBe(false);
    expect(approvalListSchema.safeParse({ 'wd-berg-hoehe-q3375': { ...entry, date: '13.11.2026' } }).success).toBe(false);
  });
});
