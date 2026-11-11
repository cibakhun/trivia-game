import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { validateQuestionText } from '../src/index.ts';
import { flattenBinding } from '../src/wikidata/fetch.ts';
import { generateFromTemplate, pickDistractors, type SnapshotData, type Template } from '../src/wikidata/generate.ts';
import { TEMPLATES } from '../src/wikidata/templates.ts';
import { createRng, spreadPick, yearOf } from '../src/wikidata/util.ts';

const fetchedAt = '2026-11-11T12:00:00.000Z';
const snap = (name: string, rows: Record<string, string>[]): SnapshotData => ({ name, fetchedAt, rows });
const template = (id: string): Template => {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Vorlage ${id} fehlt`);
  return t;
};

function expectValid(questions: ReturnType<typeof generateFromTemplate>): void {
  for (const { question } of questions) {
    const file = `content/questions/wikidata/${question.key}.yaml`;
    const { issues } = validateQuestionText(stringify(question), { file, fixture: false });
    expect(issues, question.key).toEqual([]);
    expect(question.origin).toBe('AI_ASSISTED');
    expect(question.status).toBe('DRAFT');
    expect(question.sources[0]?.url).toMatch(/^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/);
    expect(question.sources[0]?.accessed).toBe('2026-11-11');
  }
}

describe('Wikidata-Hilfen', () => {
  it('flacht SPARQL-Zeilen ab und kürzt Entitäten auf die Q-Nummer', () => {
    expect(
      flattenBinding({
        item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q3375' },
        label: { type: 'literal', value: 'Zugspitze' },
      }),
    ).toEqual({ item: 'Q3375', label: 'Zugspitze' });
  });

  it('liest Jahre aus xsd:dateTime', () => {
    expect(yearOf('1756-01-27T00:00:00Z')).toBe(1756);
    expect(yearOf('-0500-01-01T00:00:00Z')).toBe(-500);
    expect(yearOf(undefined)).toBeNull();
  });

  it('wählt gleichmäßig über das Fenster und ist deterministisch', () => {
    const ranked = Array.from({ length: 30 }, (_, i) => i);
    expect(spreadPick(ranked, 4, 30).map((p) => p.item)).toEqual([0, 10, 19, 29]);
    expect(spreadPick(ranked.slice(0, 3), 4, 30).map((p) => p.item)).toEqual([0, 1, 2]);
    const a = createRng('seed');
    const b = createRng('seed');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('nimmt keine richtige Antwort und keine Dubletten als falsche Antwort', () => {
    const fact = { qid: 'Q1', label: 'X', rank: 0, answer: 'Bern', group: 'Europa' };
    const pool = ['Bern', 'Wien', 'wien', 'Rom', 'Paris', 'Lima'].map((answer, rank) => ({
      answer,
      rank,
      group: answer === 'Lima' ? 'Amerika' : 'Europa',
    }));
    const picked = pickDistractors(fact, pool, createRng('x'));
    expect(picked).toHaveLength(3);
    expect(new Set(picked?.map((p) => p.toLowerCase())).size).toBe(3);
    expect(picked).not.toContain('Bern');
    expect(picked).not.toContain('Lima'); // andere Gruppe, solange die eigene reicht
    expect(pickDistractors(fact, pool.slice(0, 3), createRng('x'))).toBeNull();
  });
});

describe('Schätzfragen', () => {
  it('Berghöhe: gerundet, mehrdeutige Werte fallen weg, mit Artikel wo bekannt', () => {
    const rows = [
      { item: 'Q3375', label: 'Zugspitze', sitelinks: '90', value: '2962.06' },
      { item: 'Q1', label: 'Doppelberg', sitelinks: '80', value: '1000' },
      { item: 'Q1', label: 'Doppelberg', sitelinks: '80', value: '1200' },
      { item: 'Q2', label: 'Unbekannter Gipfel', sitelinks: '70', value: '3000' },
    ];
    const questions = generateFromTemplate(template('berg-hoehe'), snap('berge-hoehe', rows));
    expectValid(questions);
    expect(questions.map((q) => q.question.key)).toEqual(['wd-berg-hoehe-q3375', 'wd-berg-hoehe-q2']);
    expect(questions[0]?.question.estimate?.answer_value).toBe('2962');
    expect(questions[0]?.question.translations.de?.prompt).toBe(
      'Wie hoch ist die Zugspitze (in Metern über dem Meeresspiegel)?',
    );
    expect(questions[1]?.question.translations.de?.prompt).toContain('der Berg „Unbekannter Gipfel“');
  });

  it('Einwohner: neuester Stichtag, Jahr steht in der Frage', () => {
    const rows = [
      { item: 'Q1726', label: 'München', sitelinks: '200', value: '1488202', date: '2022-12-31T00:00:00Z' },
      { item: 'Q1726', label: 'München', sitelinks: '200', value: '1512491', date: '2023-12-31T00:00:00Z' },
    ];
    const [q] = generateFromTemplate(template('stadt-einwohner'), snap('staedte-einwohner-de', rows));
    expect(q?.question.estimate?.answer_value).toBe('1512491');
    expect(q?.question.translations.de?.prompt).toBe('Wie viele Einwohner hatte München im Jahr 2023?');
  });

  it('Länder: Artikel und Präposition richtig', () => {
    const area = generateFromTemplate(
      template('land-flaeche'),
      snap('laender-flaeche', [{ item: 'Q39', label: 'Schweiz', sitelinks: '300', value: '41285000000' }]),
    );
    expect(area[0]?.question.translations.de?.prompt).toBe('Wie groß ist die Fläche der Schweiz (in Quadratkilometern)?');
    expect(area[0]?.question.estimate?.answer_value).toBe('41285');
    const people = generateFromTemplate(
      template('land-einwohner'),
      snap('laender-einwohner', [
        { item: 'Q928', label: 'Philippinen', sitelinks: '300', value: '109035343', date: '2020-05-01T00:00:00Z' },
      ]),
    );
    expect(people[0]?.question.translations.de?.prompt).toBe('Wie viele Menschen lebten 2020 auf den Philippinen?');
    expectValid([...area, ...people]);
  });

  it('Nobelpreis: je Preis eine Frage, doppelte Preisträger desselben Preises fallen weg', () => {
    const rows = [
      { item: 'Q7186', label: 'Marie Curie', sitelinks: '300', prize: 'Q38104', date: '1903-01-01T00:00:00Z' },
      { item: 'Q7186', label: 'Marie Curie', sitelinks: '300', prize: 'Q44585', date: '1911-01-01T00:00:00Z' },
      { item: 'Q9', label: 'Zweimal Physik', sitelinks: '200', prize: 'Q38104', date: '1956-01-01T00:00:00Z' },
      { item: 'Q9', label: 'Zweimal Physik', sitelinks: '200', prize: 'Q38104', date: '1972-01-01T00:00:00Z' },
    ];
    const questions = generateFromTemplate(template('nobel'), snap('nobelpreise', rows));
    expectValid(questions);
    expect(questions.map((q) => q.question.key).sort()).toEqual(['wd-nobel-chemie-q7186', 'wd-nobel-physik-q7186']);
  });
});

describe('Auswahlfragen', () => {
  const capitals = [
    ['Q39', 'Schweiz', 'Bern', 'Q46'],
    ['Q40', 'Österreich', 'Wien', 'Q46'],
    ['Q38', 'Italien', 'Rom', 'Q46'],
    ['Q142', 'Frankreich', 'Paris', 'Q46'],
    ['Q32', 'Luxemburg', 'Luxemburg', 'Q46'],
    ['Q183', 'Deutschland', 'Berlin', 'Q46'],
    ['Q419', 'Peru', 'Lima', 'Q18'],
  ].map(([item, label, answerLabel, continent], i) => ({
    item: item ?? '',
    label: label ?? '',
    sitelinks: String(300 - i),
    answer: `A${i}`,
    answerLabel: answerLabel ?? '',
    continent: continent ?? '',
  }));

  it('Hauptstadt: gültig, ohne Deutschland und ohne Antwort in der Frage', () => {
    const questions = generateFromTemplate(template('hauptstadt'), snap('laender-hauptstadt', capitals));
    expectValid(questions);
    const keys = questions.map((q) => q.question.key);
    expect(keys).not.toContain('wd-hauptstadt-q183');
    expect(keys).not.toContain('wd-hauptstadt-q32');
    const swiss = questions.find((q) => q.question.key === 'wd-hauptstadt-q39')?.question;
    expect(swiss?.translations.de?.prompt).toBe('Wie heißt die Hauptstadt der Schweiz?');
    const correct = swiss?.trivia?.correct ?? '';
    expect(swiss?.translations.de?.options?.[correct]).toBe('Bern');
  });

  it('Währung: keine gemeinsamen Währungen und keine, deren Name das Land verrät', () => {
    const rows = [
      { item: 'Q36', label: 'Polen', sitelinks: '300', answer: 'C1', answerLabel: 'Złoty', continent: 'Q46' },
      { item: 'Q28', label: 'Ungarn', sitelinks: '290', answer: 'C2', answerLabel: 'Forint', continent: 'Q46' },
      { item: 'Q39', label: 'Schweiz', sitelinks: '280', answer: 'C3', answerLabel: 'Schweizer Franken', continent: 'Q46' },
      { item: 'Q142', label: 'Frankreich', sitelinks: '270', answer: 'EUR', answerLabel: 'Euro', continent: 'Q46' },
      { item: 'Q38', label: 'Italien', sitelinks: '260', answer: 'EUR', answerLabel: 'Euro', continent: 'Q46' },
      { item: 'Q17', label: 'Japan', sitelinks: '250', answer: 'C4', answerLabel: 'Yen', continent: 'Q48' },
      { item: 'Q155', label: 'Brasilien', sitelinks: '240', answer: 'C5', answerLabel: 'Real', continent: 'Q18' },
    ];
    const questions = generateFromTemplate(template('waehrung'), snap('laender-waehrung', rows));
    expectValid(questions);
    const keys = questions.map((q) => q.question.key);
    expect(keys).toContain('wd-waehrung-q36');
    expect(keys).not.toContain('wd-waehrung-q39');
    expect(keys).not.toContain('wd-waehrung-q142');
  });

  it('Elementsymbol: nur Symbole, die nicht mit dem Namen beginnen; falsche Antworten mit gleichem Anfang', () => {
    const elements = [
      ['Q897', 'Gold', 'Au', '79'],
      ['Q677', 'Eisen', 'Fe', '26'],
      ['Q650', 'Fluor', 'F', '9'],
      ['Q671', 'Francium', 'Fr', '87'],
      ['Q1096', 'Fermium', 'Fm', '100'],
      ['Q753', 'Kupfer', 'Cu', '29'],
      ['Q623', 'Kohlenstoff', 'C', '6'],
      ['Q1094', 'Silber', 'Ag', '47'],
      ['Q560', 'Aluminium', 'Al', '13'],
      ['Q1090', 'Argon', 'Ar', '18'],
    ].map(([item, label, symbol, number]) => ({
      item: item ?? '',
      label: label ?? '',
      symbol: symbol ?? '',
      number: number ?? '',
      sitelinks: '200',
    }));
    const questions = generateFromTemplate(template('element-symbol'), snap('elemente', elements));
    expectValid(questions);
    const prompts = questions.map((q) => q.question.translations.de?.prompt);
    expect(prompts).toContain('Welches chemische Element hat das Symbol „Fe“?');
    expect(prompts.some((p) => p?.includes('„F“'))).toBe(false); // Fluor beginnt mit F
    const iron = questions.find((q) => q.question.key === 'wd-element-symbol-q677')?.question;
    const texts = Object.values(iron?.translations.de?.options ?? {});
    expect(texts).toContain('Eisen');
    expect(texts.filter((t) => t.startsWith('F')).length).toBeGreaterThanOrEqual(2);
  });

  it('Olympia: abgesagte und künftige Spiele fallen weg, Schwierigkeit nach Alter', () => {
    const games = [
      ['Q8438', '1972', 'München', 'Q135976384'],
      ['Q8577', '2012', 'London', 'Q135976384'],
      ['Q8470', '1936', 'Berlin', 'Q135976384'],
      ['Q1', '1940', 'Tokio', 'Q135976384'],
      ['Q2', '2032', 'Brisbane', 'Q135976384'],
      ['Q8567', '1964', 'Tokio', 'Q135976384'],
      ['Q8613', '2000', 'Sydney', 'Q135976384'],
    ].map(([item, year, city, type]) => ({
      item: item ?? '',
      label: `Olympische Sommerspiele ${year}`,
      type: type ?? '',
      answer: `C-${city}`,
      answerLabel: city ?? '',
      start: `${year}-07-01T00:00:00Z`,
    }));
    const questions = generateFromTemplate(template('olympia'), snap('olympia', games));
    expectValid(questions);
    const keys = questions.map((q) => q.question.key);
    expect(keys).not.toContain('wd-olympia-q1');
    expect(keys).not.toContain('wd-olympia-q2');
    const munich = questions.find((q) => q.question.key === 'wd-olympia-q8438')?.question;
    expect(munich?.translations.de?.prompt).toBe('In welcher Stadt fanden die Olympischen Sommerspiele 1972 statt?');
    expect(munich?.difficulty).toBe(3);
  });

  it('gleiche Daten ergeben dieselben Fragen', () => {
    const a = generateFromTemplate(template('hauptstadt'), snap('laender-hauptstadt', capitals));
    const b = generateFromTemplate(template('hauptstadt'), snap('laender-hauptstadt', [...capitals].reverse()));
    expect(stringify(a.map((q) => q.question))).toBe(stringify(b.map((q) => q.question)));
  });
});

describe('Vorlagen', () => {
  it('haben eindeutige Kennungen und gehören zu einer Abfrage', async () => {
    const { readdir } = await import('node:fs/promises');
    const queries = (await readdir(new URL('../wikidata/queries/', import.meta.url))).map((f) => f.replace(/\.rq$/, ''));
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) expect(queries, t.id).toContain(t.snapshot);
  });
});
