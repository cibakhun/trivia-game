import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { validateQuestionText } from '../src/index.ts';
import { flattenBinding } from '../src/wikidata/fetch.ts';
import { generateFromTemplate, pickDistractors, type SnapshotData, type Template } from '../src/wikidata/generate.ts';
import { personName } from '../src/wikidata/de.ts';
import { capitalNamesCountry, currencyNamesCountry, TEMPLATES } from '../src/wikidata/templates.ts';
import { createRng, foldText, spreadPick, yearOf } from '../src/wikidata/util.ts';

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

  it('lost mit Saat je einen aus gleich großen Abschnitten, wiederholbar', () => {
    const ranked = Array.from({ length: 40 }, (_, i) => i);
    const picks = spreadPick(ranked, 4, 40, 'vorlage').map((p) => p.item);
    expect(picks).toEqual(spreadPick(ranked, 4, 40, 'vorlage').map((p) => p.item));
    picks.forEach((item, i) => {
      expect(item).toBeGreaterThanOrEqual(i * 10);
      expect(item).toBeLessThan((i + 1) * 10);
    });
    expect(picks).not.toEqual(spreadPick(ranked, 4, 40, 'andere-vorlage').map((p) => p.item));
  });

  it('kürzt russische Vatersnamen und kennt gebräuchliche Kurzformen', () => {
    expect(personName('Fjodor Michailowitsch Dostojewski')).toBe('Fjodor Dostojewski');
    expect(personName('Pjotr Iljitsch Tschaikowski')).toBe('Pjotr Tschaikowski');
    expect(personName('Joanne K. Rowling')).toBe('J. K. Rowling');
    expect(personName('Johann Wolfgang von Goethe')).toBe('Johann Wolfgang von Goethe');
  });

  it('erkennt Währungen, deren Name das Land verrät', () => {
    expect(currencyNamesCountry('Kap Verde', 'Kap-Verde-Escudo')).toBe(true);
    expect(currencyNamesCountry('Vereinigte Arabische Emirate', 'VAE-Dirham')).toBe(true);
    expect(currencyNamesCountry('Island', 'isländische Krone')).toBe(true);
    expect(currencyNamesCountry('Schweiz', 'Schweizer Franken')).toBe(true);
    expect(currencyNamesCountry('Polen', 'Złoty')).toBe(false);
    expect(currencyNamesCountry('Mongolei', 'Tögrög')).toBe(false);
  });

  it('erkennt Hauptstädte, deren Name das Land verrät', () => {
    expect(capitalNamesCountry('Luxemburg', 'Luxemburg')).toBe(true);
    expect(capitalNamesCountry('Mexiko', 'Mexiko-Stadt')).toBe(true);
    expect(capitalNamesCountry('El Salvador', 'San Salvador')).toBe(true);
    expect(capitalNamesCountry('Guinea-Bissau', 'Bissau')).toBe(true);
    expect(capitalNamesCountry('Dominikanische Republik', 'Santo Domingo')).toBe(false);
    expect(capitalNamesCountry('Brasilien', 'Brasília')).toBe(false);
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

  it('nimmt keine falsche Antwort, die sich nur in Akzenten unterscheidet', () => {
    expect(foldText('Soʻm')).toBe(foldText('Som'));
    const fact = { qid: 'Q265', label: 'Usbekistan', rank: 0, answer: 'Soʻm' };
    const pool = ['Som', 'Tenge', 'Kip', 'Kyat', 'Baht'].map((answer, rank) => ({ answer, rank }));
    expect(pickDistractors(fact, pool, createRng('x'))).not.toContain('Som');
  });

  it('wählt ohne Jahr ähnlich bekannte falsche Antworten', () => {
    const fact = { qid: 'Q1', label: 'X', rank: -100, answer: 'Mitte' };
    const pool = [-300, -290, -110, -105, -95, -90, -20].map((rank, i) => ({ answer: `A${i}`, rank }));
    const picked = pickDistractors(fact, pool, createRng('x'), { shortlist: 4 });
    expect(picked?.every((p) => ['A2', 'A3', 'A4', 'A5'].includes(p))).toBe(true);
  });
});

describe('Schätzfragen', () => {
  it('Berghöhe: gerundet, mehrdeutige Werte und Namen ohne deutsche Form fallen weg', () => {
    const rows = [
      { item: 'Q3375', label: 'Zugspitze', sitelinks: '90', value: '2962.06' },
      { item: 'Q80344', label: 'Berg Olymp', sitelinks: '85', value: '2918' },
      { item: 'Q1', label: 'Doppelberg', sitelinks: '80', value: '1000' },
      { item: 'Q1', label: 'Doppelberg', sitelinks: '80', value: '1200' },
      { item: 'Q2', label: 'Unbekannter Gipfel', sitelinks: '70', value: '3000' },
      { item: 'Q194215', label: 'Amsterdam-Insel', sitelinks: '60', value: '867' },
    ];
    const questions = generateFromTemplate(template('berg-hoehe'), snap('berge-hoehe', rows));
    expectValid(questions);
    expect(questions.map((q) => q.question.key)).toEqual(['wd-berg-hoehe-q3375', 'wd-berg-hoehe-q80344']);
    expect(questions[0]?.question.estimate?.answer_value).toBe('2962');
    expect(questions[0]?.question.translations.de?.prompt).toBe(
      'Wie hoch ist die Zugspitze (in Metern über dem Meeresspiegel)?',
    );
    expect(questions[0]?.question.difficulty).toBe(2); // in Deutschland bekannt
    expect(questions[1]?.question.translations.de?.prompt).toBe(
      'Wie hoch ist der Olymp (in Metern über dem Meeresspiegel)?',
    );
  });

  it('Einwohner: neuester Stichtag, Stichtag steht in der Frage', () => {
    const rows = [
      { item: 'Q1726', label: 'München', sitelinks: '200', value: '1488202', date: '2022-12-31T00:00:00Z' },
      { item: 'Q1726', label: 'München', sitelinks: '200', value: '1512491', date: '2023-12-31T00:00:00Z' },
    ];
    const [q] = generateFromTemplate(template('stadt-einwohner'), snap('staedte-einwohner-de', rows));
    expect(q?.question.estimate?.answer_value).toBe('1512491');
    expect(q?.question.translations.de?.prompt).toBe('Wie viele Einwohner hatte München Ende 2023?');
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
    expect(people[0]?.question.translations.de?.prompt).toBe(
      'Wie viele Menschen lebten im Jahr 2020 auf den Philippinen?',
    );
    expectValid([...area, ...people]);
    const renamed = generateFromTemplate(
      template('land-flaeche'),
      snap('laender-flaeche', [
        { item: 'Q697', label: 'Naoero', sitelinks: '300', value: '21000000' },
        { item: 'Q34754', label: 'Somaliland', sitelinks: '200', value: '177000000000' },
      ]),
    );
    expect(renamed.map((q) => q.question.translations.de?.prompt)).toEqual([
      'Wie groß ist die Fläche von Nauru (in Quadratkilometern)?',
    ]);
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
    expect(questions.map((q) => q.question.translations.de?.prompt)).toContain(
      'Für welches Jahr erhielt Marie Curie den Nobelpreis für Physik?',
    );
  });

  it('Geburtsjahr: nur ausgewählte Komponisten und Maler, mit passender Bezeichnung', () => {
    const rows = [
      { item: 'Q1339', label: 'Johann Sebastian Bach', sitelinks: '259', occupation: 'Q36834', birth: '1685-03-31T00:00:00Z' },
      { item: 'Q5588', label: 'Frida Kahlo', sitelinks: '200', occupation: 'Q1028181', birth: '1907-07-06T00:00:00Z' },
      { item: 'Q207', label: 'George W. Bush', sitelinks: '282', occupation: 'Q1028181', birth: '1946-07-06T00:00:00Z' },
      { item: 'Q762', label: 'Leonardo da Vinci', sitelinks: '307', occupation: 'Q36834', birth: '1452-04-24T00:00:00Z' },
      { item: 'Q762', label: 'Leonardo da Vinci', sitelinks: '307', occupation: 'Q1028181', birth: '1452-04-24T00:00:00Z' },
    ];
    const questions = generateFromTemplate(template('geburtsjahr'), snap('personen-geburt', rows));
    expectValid(questions);
    expect(questions.map((q) => q.question.translations.de?.prompt)).toEqual([
      'In welchem Jahr wurde der Maler Leonardo da Vinci geboren?',
      'In welchem Jahr wurde der Komponist Johann Sebastian Bach geboren?',
      'In welchem Jahr wurde die Malerin Frida Kahlo geboren?',
    ]);
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

  it('Olympia: nur Ausrichterstädte, abgesagte und künftige Spiele fallen weg, Jahr aus der Bezeichnung', () => {
    const summer = 'Q135976384';
    const games = [
      ['Q8438', 'Olympische Sommerspiele 1972', 'Q131610', 'Olympiastadion München', '1972'],
      ['Q8577', 'Olympische Sommerspiele 2012', 'Q84', 'London', '2012'],
      ['Q8150', 'Olympische Sommerspiele 1936', 'Q64', 'Berlin', '1936'],
      ['Q8368', 'Olympische Sommerspiele 1940', 'Q1490', 'Tokio', '1940'],
      ['Q31039462', 'Olympische Sommerspiele 2032', 'Q34932', 'Brisbane', '2032'],
      ['Q8420', 'Olympische Sommerspiele 1964', 'Q1490', 'Tokio', '1964'],
      ['Q8544', 'Olympische Sommerspiele 2000', 'Q3130', 'Sydney', '2000'],
      ['Q181278', 'Olympische Sommerspiele 2020', 'Q1490', 'Tokio', '2021'],
      ['Q699653', 'Winter-Paralympics 1988', 'Q1735', 'Innsbruck', '1988'],
    ].map(([item, label, answer, answerLabel, year]) => ({
      item: item ?? '',
      label: label ?? '',
      type: summer,
      answer: answer ?? '',
      answerLabel: answerLabel ?? '',
      start: `${year}-07-01T00:00:00Z`,
    }));
    // London 2012 nennt zusätzlich ein Stadion: das ändert die Antwort nicht
    games.push({ ...games[1]!, answer: 'Q1', answerLabel: 'Olympiastadion London' });
    const questions = generateFromTemplate(template('olympia'), snap('olympia', games));
    expectValid(questions);
    const keys = questions.map((q) => q.question.key).sort();
    expect(keys).toEqual(['wd-olympia-q181278', 'wd-olympia-q8150', 'wd-olympia-q8420', 'wd-olympia-q8544', 'wd-olympia-q8577']);
    const tokyo = questions.find((q) => q.question.key === 'wd-olympia-q8420')?.question;
    expect(tokyo?.translations.de?.prompt).toBe('In welcher Stadt fanden die Olympischen Sommerspiele 1964 statt?');
    expect(tokyo?.difficulty).toBe(3);
    const london = questions.find((q) => q.question.key === 'wd-olympia-q8577')?.question;
    expect(Object.values(london?.translations.de?.options ?? {})).not.toContain('Olympiastadion London');
    const recent = questions.find((q) => q.question.key === 'wd-olympia-q181278')?.question;
    expect(recent?.translations.de?.prompt).toContain('Sommerspiele 2020');
  });

  it('Autor: keine antiken Schriften, keine ausgeschlossenen Werke, kein Autor im Titel', () => {
    const works = [
      ['Q480', 'Don Quijote', 'Q5682', 'Miguel de Cervantes', '1547'],
      ['Q8275', 'Ilias', 'Q6691', 'Homer', '-0900'],
      ['Q26193', 'Protokolle der Weisen von Zion', 'Q924927', 'Matwei Wassiljewitsch Golowinski', '1865'],
      ['Q6911', 'Das Tagebuch der Anne Frank', 'Q4583', 'Anne Frank', '1929'],
      ['Q165318', 'Schuld und Sühne', 'Q991', 'Fjodor Michailowitsch Dostojewski', '1821'],
      ['Q29478', 'Faust', 'Q5879', 'Johann Wolfgang von Goethe', '1749'],
      ['Q174596', 'Moby-Dick', 'Q4985', 'Herman Melville', '1819'],
      ['Q92640', 'Alice im Wunderland', 'Q38082', 'Lewis Carroll', '1832'],
    ].map(([item, label, answer, answerLabel, year], i) => ({
      item: item ?? '',
      label: label ?? '',
      sitelinks: String(200 - i),
      answer: answer ?? '',
      answerLabel: answerLabel ?? '',
      answerBirth: `${year}-01-01T00:00:00Z`,
    }));
    const questions = generateFromTemplate(template('autor'), snap('literatur-werke', works));
    expectValid(questions);
    const keys = questions.map((q) => q.question.key);
    for (const banned of ['q8275', 'q26193', 'q6911']) expect(keys).not.toContain(`wd-autor-${banned}`);
    const crime = questions.find((q) => q.question.key === 'wd-autor-q165318')?.question;
    const correct = crime?.trivia?.correct ?? '';
    expect(crime?.translations.de?.options?.[correct]).toBe('Fjodor Dostojewski');
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
