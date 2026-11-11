import { inCountry, nominative, ofCountry } from './de.ts';
import type { ChoiceFact, ChoiceTemplate, EstimateFact, EstimateTemplate, Template } from './generate.ts';
import { distinct, groupByItem, numberOf, yearOf, type Row } from './util.ts';

/**
 * Vorlagen für Fragen aus Wikidata. Jede Vorlage gehört zu einer Abfrage unter
 * `tools/content/wikidata/queries/<snapshot>.rq`. Die Ausschlusslisten halten fest, was nach
 * Durchsicht nicht taugt (mehrdeutig, zu leicht, fragwürdiger Wert), mit Grund.
 */

/** Gegenstände, die eine Vorlage nie verwendet: Q-Nummer → Grund. */
type Exclusions = Readonly<Record<string, string>>;

const sitelinksOf = (rows: readonly Row[]): number => Math.max(...rows.map((r) => numberOf(r['sitelinks']) ?? 0));
const labelOf = (rows: readonly Row[]): string => rows[0]?.['label'] ?? '';

/** Ein eindeutiger Zahlenwert je Gegenstand; mehrere verschiedene (gerundete) Werte → kein Fakt. */
function singleValueFacts(
  rows: readonly Row[],
  exclude: Exclusions,
  convert: (value: number) => number,
): EstimateFact[] {
  const facts: EstimateFact[] = [];
  for (const [qid, group] of groupByItem(rows)) {
    if (exclude[qid]) continue;
    const values = distinct(
      group.map((r) => numberOf(r['value'])).filter((v): v is number => v !== null).map((v) => Math.round(convert(v))),
    );
    const value = values[0];
    if (values.length !== 1 || value === undefined || value <= 0) continue;
    facts.push({ qid, label: labelOf(group), rank: -sitelinksOf(group), value });
  }
  return facts;
}

/** Neuester Wert mit Stichtag je Gegenstand (Einwohnerzahlen). */
function latestValueFacts(rows: readonly Row[], exclude: Exclusions): EstimateFact[] {
  const facts: EstimateFact[] = [];
  for (const [qid, group] of groupByItem(rows)) {
    if (exclude[qid]) continue;
    const dated = group
      .map((r) => ({ value: numberOf(r['value']), date: r['date'] ?? '' }))
      .filter((d): d is { value: number; date: string } => d.value !== null && d.date !== '');
    const latestDate = dated.map((d) => d.date).sort().at(-1);
    if (!latestDate) continue;
    const values = distinct(dated.filter((d) => d.date === latestDate).map((d) => Math.round(d.value)));
    const value = values[0];
    const asOf = yearOf(latestDate);
    if (values.length !== 1 || value === undefined || asOf === null) continue;
    facts.push({ qid, label: labelOf(group), rank: -sitelinksOf(group), value, asOf });
  }
  return facts;
}

/** Ein eindeutiger Antwortgegenstand je Frage-Gegenstand (Hauptstadt, Autor, Komponist …). */
function singleAnswerFacts(
  rows: readonly Row[],
  exclude: Exclusions,
  options: { onePerAnswer?: boolean; withGroup?: boolean } = {},
): ChoiceFact[] {
  const facts: ChoiceFact[] = [];
  for (const [qid, group] of groupByItem(rows)) {
    if (exclude[qid]) continue;
    const answers = distinct(group.map((r) => r['answer'] ?? ''));
    const first = group[0];
    if (answers.length !== 1 || !first?.['answerLabel']) continue;
    const birthYears = distinct(group.map((r) => yearOf(r['answerBirth'])).filter((y): y is number => y !== null));
    const groups = distinct(group.map((r) => r['continent'] ?? '').filter(Boolean)).sort();
    facts.push({
      qid,
      label: labelOf(group),
      rank: -sitelinksOf(group),
      answer: first['answerLabel'],
      ...(birthYears.length === 1 && birthYears[0] !== undefined ? { year: birthYears[0] } : {}),
      ...(options.withGroup && groups.length > 0 ? { group: groups.join('+') } : {}),
      context: first['answer'] ?? '',
    });
  }
  if (!options.onePerAnswer) return facts;
  // nur das bekannteste Werk je Autor, sonst stellt eine Vorlage fünfmal dieselbe Antwort
  const best = new Map<string, ChoiceFact>();
  for (const fact of facts) {
    const current = best.get(fact.answer);
    if (!current || fact.rank < current.rank) best.set(fact.answer, fact);
  }
  return [...best.values()];
}

// ---------------------------------------------------------------- Schätzfragen

const bergHoehe: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'berg-hoehe',
  snapshot: 'berge-hoehe',
  category: 'GEOGRAPHY',
  count: 6,
  window: 40,
  unit: 'm',
  unitLabel: 'Meter',
  inputMin: 0,
  inputMax: 9000,
  scaleType: 'LOG',
  scale: 0.3,
  extract: (rows) => singleValueFacts(rows, {}, (m) => m),
  prompt: (f) => `Wie hoch ist ${nominative(f.label, 'der Berg')} (in Metern über dem Meeresspiegel)?`,
};

const flussLaenge: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'fluss-laenge',
  snapshot: 'fluesse-laenge',
  category: 'GEOGRAPHY',
  count: 6,
  window: 40,
  unit: 'km',
  unitLabel: 'Kilometer',
  inputMin: 1,
  inputMax: 10000,
  scaleType: 'LOG',
  scale: 0.3,
  extract: (rows) => singleValueFacts(rows, {}, (m) => m / 1000).filter((f) => f.value >= 100),
  prompt: (f) => `Wie lang ist ${nominative(f.label, 'der Fluss')} (in Kilometern)?`,
};

const landFlaeche: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'land-flaeche',
  snapshot: 'laender-flaeche',
  category: 'GEOGRAPHY',
  count: 5,
  window: 60,
  unit: 'km2',
  unitLabel: 'Quadratkilometer',
  inputMin: 1,
  inputMax: 20000000,
  scaleType: 'LOG',
  scale: 0.4,
  extract: (rows) => singleValueFacts(rows, {}, (m2) => m2 / 1_000_000),
  prompt: (f) => `Wie groß ist die Fläche ${ofCountry(f.label)} (in Quadratkilometern)?`,
};

const landEinwohner: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'land-einwohner',
  snapshot: 'laender-einwohner',
  category: 'GEOGRAPHY',
  count: 5,
  window: 60,
  unit: 'count',
  unitLabel: 'Einwohner',
  inputMin: 1000,
  inputMax: 2000000000,
  scaleType: 'LOG',
  scale: 0.4,
  extract: (rows) => latestValueFacts(rows, {}),
  prompt: (f) => `Wie viele Menschen lebten ${f.asOf ?? ''} ${inCountry(f.label)}?`.replace(/ {2,}/g, ' '),
};

const stadtEinwohner: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'stadt-einwohner',
  snapshot: 'staedte-einwohner-de',
  category: 'GEOGRAPHY',
  count: 6,
  window: 40,
  unit: 'count',
  unitLabel: 'Einwohner',
  inputMin: 1000,
  inputMax: 10000000,
  scaleType: 'LOG',
  scale: 0.3,
  extract: (rows) => latestValueFacts(rows, {}),
  prompt: (f) => `Wie viele Einwohner hatte ${f.label} im Jahr ${f.asOf ?? ''}?`,
};

const bauwerkHoehe: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'bauwerk-hoehe',
  snapshot: 'bauwerke-hoehe',
  category: 'TECHNOLOGY',
  count: 6,
  window: 40,
  unit: 'm',
  unitLabel: 'Meter',
  inputMin: 1,
  inputMax: 1000,
  scaleType: 'LOG',
  scale: 0.3,
  extract: (rows) => singleValueFacts(rows, {}, (m) => m),
  prompt: (f) => `Wie hoch ist ${nominative(f.label, 'das Bauwerk')} (in Metern)?`,
};

const COMPOSER = 'Q36834';
const geburtsjahr: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'geburtsjahr',
  snapshot: 'personen-geburt',
  category: 'ARTS_CULTURE',
  count: 6,
  window: 60,
  unit: 'year',
  unitLabel: 'Jahr',
  inputMin: 1000,
  inputMax: 2026,
  scaleType: 'LINEAR',
  scale: 40,
  extract: (rows) => {
    const facts: EstimateFact[] = [];
    for (const [qid, group] of groupByItem(rows)) {
      const years = distinct(group.map((r) => yearOf(r['birth'])).filter((y): y is number => y !== null));
      const year = years[0];
      if (years.length !== 1 || year === undefined || year < 1000) continue;
      const composer = group.some((r) => r['occupation'] === COMPOSER);
      facts.push({
        qid,
        label: labelOf(group),
        rank: -sitelinksOf(group),
        value: year,
        context: composer ? 'der Komponist' : 'der Maler',
      });
    }
    return facts;
  },
  prompt: (f) => `In welchem Jahr wurde ${f.context ?? ''} ${f.label} geboren?`.replace(/ {2,}/g, ' '),
};

const NOBEL: Readonly<Record<string, { slug: string; name: string; literature: boolean }>> = {
  Q37922: { slug: 'literatur', name: 'den Nobelpreis für Literatur', literature: true },
  Q38104: { slug: 'physik', name: 'den Nobelpreis für Physik', literature: false },
  Q44585: { slug: 'chemie', name: 'den Nobelpreis für Chemie', literature: false },
  Q80061: { slug: 'medizin', name: 'den Nobelpreis für Physiologie oder Medizin', literature: false },
};

const nobelJahr: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'nobel',
  snapshot: 'nobelpreise',
  category: (f) => (f.keySuffix === 'literatur' ? 'LITERATURE' : 'SCIENCE'),
  count: 5,
  window: 40,
  unit: 'year',
  unitLabel: 'Jahr',
  inputMin: 1901,
  inputMax: 2026,
  scaleType: 'LINEAR',
  scale: 15,
  extract: (rows) => {
    const byItemPrize = new Map<string, Row[]>();
    for (const row of rows) {
      const key = `${row['item']}|${row['prize']}`;
      byItemPrize.set(key, [...(byItemPrize.get(key) ?? []), row]);
    }
    const facts: EstimateFact[] = [];
    for (const [key, group] of byItemPrize) {
      const [qid = '', prizeId = ''] = key.split('|');
      const prize = NOBEL[prizeId];
      const years = distinct(group.map((r) => yearOf(r['date'])).filter((y): y is number => y !== null));
      const year = years[0];
      if (!prize || years.length !== 1 || year === undefined) continue;
      facts.push({ qid, label: labelOf(group), rank: -sitelinksOf(group), value: year, keySuffix: prize.slug, context: prize.name });
    }
    return facts;
  },
  prompt: (f) => `In welchem Jahr erhielt ${f.label} ${f.context ?? 'den Nobelpreis'}?`,
};

function elementRows(rows: readonly Row[]): { qid: string; label: string; symbol: string; number: number; sitelinks: number }[] {
  return [...groupByItem(rows)].flatMap(([qid, group]) => {
    const symbols = distinct(group.map((r) => r['symbol'] ?? ''));
    const numbers = distinct(group.map((r) => numberOf(r['number'])).filter((n): n is number => n !== null));
    const symbol = symbols[0];
    const number = numbers[0];
    if (symbols.length !== 1 || numbers.length !== 1 || !symbol || number === undefined) return [];
    return [{ qid, label: labelOf(group), symbol, number, sitelinks: sitelinksOf(group) }];
  });
}

const ordnungszahl: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'ordnungszahl',
  snapshot: 'elemente',
  category: 'SCIENCE',
  count: 5,
  window: 40,
  unit: 'count',
  unitLabel: 'Ordnungszahl',
  inputMin: 1,
  inputMax: 118,
  scaleType: 'LINEAR',
  scale: 8,
  extract: (rows) =>
    elementRows(rows)
      .filter((e) => e.number > 10 && e.number <= 92)
      .map((e) => ({ qid: e.qid, label: e.label, rank: -e.sitelinks, value: e.number })),
  prompt: (f) => `Welche Ordnungszahl hat ${f.label} im Periodensystem der Elemente?`,
};

// ---------------------------------------------------------------- Auswahlfragen

/** Deutschland ist für ein deutsches Publikum keine Frage. */
const COUNTRY_EXCLUSIONS: Exclusions = { Q183: 'zu leicht für deutsches Publikum' };

const hauptstadt: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'hauptstadt',
  snapshot: 'laender-hauptstadt',
  category: 'GEOGRAPHY',
  count: 8,
  window: 80,
  extract: (rows) =>
    singleAnswerFacts(rows, COUNTRY_EXCLUSIONS, { withGroup: true }).filter((f) => {
      // „Luxemburg – Luxemburg“, „Mexiko – Mexiko-Stadt“: Antwort steckt in der Frage
      const country = f.label.toLocaleLowerCase('de');
      const capital = f.answer.toLocaleLowerCase('de');
      return !capital.includes(country) && !country.includes(capital);
    }),
  prompt: (f) => `Wie heißt die Hauptstadt ${ofCountry(f.label)}?`,
};

/** Währung, deren Name das Land verrät („Schweizer Franken“ zu „Schweiz“). */
function currencyNamesCountry(country: string, currency: string): boolean {
  const stem = country.slice(0, 4).toLocaleLowerCase('de');
  return currency
    .toLocaleLowerCase('de')
    .split(/\s+/)
    .some((word) => word.startsWith(stem));
}

const waehrung: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'waehrung',
  snapshot: 'laender-waehrung',
  category: 'POLITICS_SOCIETY',
  count: 6,
  window: 80,
  extract: (rows) => {
    const facts = singleAnswerFacts(rows, COUNTRY_EXCLUSIONS, { withGroup: true });
    // gemeinsame Währungen (Euro, CFA-Franc, US-Dollar …) sind mehrdeutig oder zu leicht
    const countriesPerCurrency = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = countriesPerCurrency.get(row['answer'] ?? '') ?? new Set<string>();
      set.add(row['item'] ?? '');
      countriesPerCurrency.set(row['answer'] ?? '', set);
    }
    return facts.filter(
      (f) => (countriesPerCurrency.get(f.context ?? '')?.size ?? 0) === 1 && !currencyNamesCountry(f.label, f.answer),
    );
  },
  prompt: (f) => `Mit welcher Währung bezahlt man ${inCountry(f.label)}?`,
};

const autor: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'autor',
  snapshot: 'literatur-werke',
  category: 'LITERATURE',
  count: 8,
  window: 60,
  extract: (rows) => singleAnswerFacts(rows, {}, { onePerAnswer: true }),
  prompt: (f) => `Wer schrieb „${f.label}“?`,
};

const oper: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'oper',
  snapshot: 'opern',
  category: 'ARTS_CULTURE',
  count: 6,
  window: 40,
  extract: (rows) => singleAnswerFacts(rows, {}, { onePerAnswer: true }),
  prompt: (f) => `Wer komponierte die Oper „${f.label}“?`,
};

const gemaelde: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'gemaelde',
  snapshot: 'gemaelde',
  category: 'ARTS_CULTURE',
  count: 8,
  window: 50,
  extract: (rows) => singleAnswerFacts(rows, {}, { onePerAnswer: true }),
  prompt: (f) => `Wer malte das Gemälde „${f.label}“?`,
};

const elementSymbol: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'element-symbol',
  snapshot: 'elemente',
  category: 'SCIENCE',
  count: 6,
  window: 30,
  // nur Symbole, die nicht mit dem deutschen Namen beginnen (Fe, Au, Hg …), sonst errät man es
  extract: (rows) =>
    elementRows(rows)
      .filter((e) => e.number <= 92 && e.symbol[0]?.toLocaleLowerCase('de') !== e.label[0]?.toLocaleLowerCase('de'))
      .map((e) => ({ qid: e.qid, label: e.symbol, rank: -e.sitelinks, answer: e.label, context: e.symbol })),
  prompt: (f) => `Welches chemische Element hat das Symbol „${f.label}“?`,
  shortlist: 4,
  // falsche Antworten: Elemente, deren deutscher Name mit dem Anfangsbuchstaben des Symbols beginnt
  distractorPool: (fact, _facts, rows) => {
    const letter = fact.label[0]?.toLocaleLowerCase('de') ?? '';
    const all = elementRows(rows)
      .filter((e) => e.number <= 103)
      .sort((a, b) => b.sitelinks - a.sitelinks);
    const sameInitial = all.filter((e) => e.label[0]?.toLocaleLowerCase('de') === letter).map((e) => e.label);
    const sameSymbolLetter = all.filter((e) => e.symbol[0]?.toLocaleLowerCase('de') === letter).map((e) => e.label);
    return distinct([...sameInitial, ...sameSymbolLetter, ...all.map((e) => e.label)]);
  },
};

const SUMMER = 'Q159821';
const CANCELLED_GAMES = new Set([1916, 1940, 1944]);

const olympia: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'olympia',
  snapshot: 'olympia',
  category: 'SPORTS',
  count: 8,
  window: 50,
  extract: (rows) => {
    const facts: ChoiceFact[] = [];
    for (const [qid, group] of groupByItem(rows)) {
      const answers = distinct(group.map((r) => r['answer'] ?? ''));
      const first = group[0];
      if (answers.length !== 1 || !first?.['answerLabel']) continue;
      const year =
        yearOf(first['date']) ?? yearOf(first['start']) ?? numberOf(/\b(18|19|20)\d\d\b/.exec(first['label'] ?? '')?.[0]);
      if (year === null || year > 2026 || CANCELLED_GAMES.has(year)) continue;
      const summer = first['type'] === SUMMER;
      facts.push({
        qid,
        label: `Olympischen ${summer ? 'Sommerspiele' : 'Winterspiele'} ${year}`,
        // ohne Bekanntheitswert: jüngere Spiele zuerst, damit die Auswahl über die Jahrzehnte streut
        rank: -year,
        answer: first['answerLabel'],
        group: summer ? 'sommer' : 'winter',
        year,
      });
    }
    return facts;
  },
  prompt: (f) => `In welcher Stadt fanden die ${f.label} statt?`,
  difficulty: (f) => ((f.year ?? 0) >= 1990 ? 2 : (f.year ?? 0) >= 1950 ? 3 : 4),
};

export const TEMPLATES: readonly Template[] = [
  bergHoehe,
  flussLaenge,
  landFlaeche,
  landEinwohner,
  stadtEinwohner,
  bauwerkHoehe,
  geburtsjahr,
  nobelJahr,
  ordnungszahl,
  hauptstadt,
  waehrung,
  autor,
  oper,
  gemaelde,
  elementSymbol,
  olympia,
];
