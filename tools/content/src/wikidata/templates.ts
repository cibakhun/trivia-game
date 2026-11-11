import { countryName, hasNominative, inCountry, nominative, ofCountry, personName } from './de.ts';
import type { ChoiceFact, ChoiceTemplate, EstimateFact, EstimateTemplate, Template } from './generate.ts';
import { distinct, foldText, groupByItem, numberOf, yearOf, type Row } from './util.ts';

/**
 * Vorlagen für Fragen aus Wikidata. Jede Vorlage gehört zu einer Abfrage unter
 * `tools/content/wikidata/queries/<snapshot>.rq`. Die Ausschlusslisten halten fest, was nach
 * Durchsicht nicht taugt (mehrdeutig, zu leicht, fragwürdiger Wert), mit Grund.
 */

/** Gegenstände, die eine Vorlage nie verwendet: Q-Nummer → Grund. */
type Exclusions = Readonly<Record<string, string>>;

const sitelinksOf = (rows: readonly Row[]): number => Math.max(...rows.map((r) => numberOf(r['sitelinks']) ?? 0));
const labelOf = (rows: readonly Row[]): string => rows[0]?.['label'] ?? '';

/**
 * Ein eindeutiger Zahlenwert je Gegenstand; mehrere verschiedene (gerundete) Werte → kein Fakt.
 * Mit `named` nur Gegenstände, für die `de.ts` eine geprüfte Form mit Artikel kennt: Namen ohne
 * diese Form ergäben holprige Fragen („der Berg „Berg Olymp““) und sind meist ohnehin abseitig.
 */
function singleValueFacts(
  rows: readonly Row[],
  exclude: Exclusions,
  convert: (value: number) => number,
  options: { named?: boolean; rename?: (label: string) => string } = {},
): EstimateFact[] {
  const facts: EstimateFact[] = [];
  for (const [qid, group] of groupByItem(rows)) {
    if (exclude[qid]) continue;
    if (options.named && !hasNominative(labelOf(group))) continue;
    const values = distinct(
      group.map((r) => numberOf(r['value'])).filter((v): v is number => v !== null).map((v) => Math.round(convert(v))),
    );
    const value = values[0];
    if (values.length !== 1 || value === undefined || value <= 0) continue;
    const label = options.rename ? options.rename(labelOf(group)) : labelOf(group);
    facts.push({ qid, label, rank: -sitelinksOf(group), value });
  }
  return facts;
}

/** Stichtag als Zeitangabe: „Ende 2025“ für den 31. Dezember, sonst „im Jahr 2025“. */
function asOfPhrase(date: string, year: number): string {
  return /^\+?\d+-12-31T/.test(date) ? `Ende ${year}` : `im Jahr ${year}`;
}

/** Neuester Wert mit Stichtag je Gegenstand (Einwohnerzahlen). */
function latestValueFacts(
  rows: readonly Row[],
  exclude: Exclusions,
  rename: (label: string) => string = (label) => label,
): EstimateFact[] {
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
    facts.push({
      qid,
      label: rename(labelOf(group)),
      rank: -sitelinksOf(group),
      value,
      asOf,
      context: asOfPhrase(latestDate, asOf),
    });
  }
  return facts;
}

/** Ein eindeutiger Antwortgegenstand je Frage-Gegenstand (Hauptstadt, Autor, Komponist …). */
function singleAnswerFacts(
  rows: readonly Row[],
  exclude: Exclusions,
  options: {
    onePerAnswer?: boolean;
    withGroup?: boolean;
    rename?: (label: string) => string;
    answerName?: (label: string) => string;
  } = {},
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
      label: options.rename ? options.rename(labelOf(group)) : labelOf(group),
      rank: -sitelinksOf(group),
      answer: options.answerName ? options.answerName(first['answerLabel']) : first['answerLabel'],
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

// ---------------------------------------------------------------- Ausschlüsse

/**
 * Gebiete, die Wikidata als Land führt, die aber kein allgemein anerkannter souveräner Staat
 * sind oder einen Staat doppelt abbilden. Gilt für alle Fragen über Staaten.
 */
const NOT_SOVEREIGN: Exclusions = {
  Q21203: 'Aruba: Land im Königreich der Niederlande, kein eigener Staat',
  Q25279: 'Curaçao: Land im Königreich der Niederlande, kein eigener Staat',
  Q26273: 'Sint Maarten: Land im Königreich der Niederlande, kein eigener Staat',
  Q29999: 'Königreich der Niederlande: Gesamtstaat, doppelt zu „Niederlande“',
  Q756617: 'Königreich Dänemark: Gesamtstaat, doppelt zu „Dänemark“',
  Q26988: 'Cookinseln: mit Neuseeland assoziiert, kein UN-Mitglied',
  Q34020: 'Niue: mit Neuseeland assoziiert, kein UN-Mitglied',
  Q23681: 'Nordzypern: nur von der Türkei anerkannt',
  Q34754: 'Somaliland: von keinem Staat anerkannt',
  Q219060: 'Palästina: Anerkennung umstritten, von Deutschland nicht anerkannt',
};

const COUNTRY_EXCLUSIONS: Exclusions = {
  ...NOT_SOVEREIGN,
};

const CAPITAL_EXCLUSIONS: Exclusions = {
  ...NOT_SOVEREIGN,
  Q183: 'Deutschland: zu leicht für deutsches Publikum',
  Q801: 'Israel: Hauptstadt Jerusalem international umstritten',
};

// ---------------------------------------------------------------- Schätzfragen

/**
 * Gegenstände, die in Deutschland jeder kennt: Die Bekanntheit in Wikidata (Zahl der
 * Sprachversionen) unterschätzt das, deshalb hier Stufe 2.
 */
const FAMILIAR_IN_GERMANY: ReadonlySet<string> = new Set([
  'Q3375', // Zugspitze
  'Q584', // Rhein
  'Q1653', // Donau
  'Q1644', // Elbe
  'Q1670', // Main
  'Q1667', // Mosel
  'Q552', // Oder
  'Q151356', // Berliner Fernsehturm
]);
const familiar = (fact: EstimateFact): 2 | undefined => (FAMILIAR_IN_GERMANY.has(fact.qid) ? 2 : undefined);

const MOUNTAIN_EXCLUSIONS: Exclusions = {
  Q194215: 'Amsterdam-Insel: Insel, kein Berg',
  Q83497: 'Mount Rushmore: bekannt als Denkmal, die Höhe des Bergs fragt niemand',
  Q205976: 'Ölberg: mehrere Berge dieses Namens (Jerusalem, Siebengebirge)',
  Q377485: 'Sinai: Lage des biblischen Bergs umstritten',
};

const bergHoehe: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'berg-hoehe',
  snapshot: 'berge-hoehe',
  category: 'GEOGRAPHY',
  count: 6,
  window: 40,
  unit: 'm',
  unitLabel: 'Meter',
  inputMin: 1,
  inputMax: 9000,
  scaleType: 'LOG',
  scale: 0.3,
  extract: (rows) => singleValueFacts(rows, MOUNTAIN_EXCLUSIONS, (m) => m, { named: true }),
  prompt: (f) => `Wie hoch ist ${nominative(f.label, 'der Berg')} (in Metern über dem Meeresspiegel)?`,
  difficulty: familiar,
};

const RIVER_EXCLUSIONS: Exclusions = {
  Q8493: 'Amudarja: Länge je nach Quellfluss 1415 oder über 2500 km',
  Q882739: 'Blauer Nil: Länge je nach Zählung 1450 oder 1783 km',
  Q4814791: 'Weißer Nil: Länge je nach Zählung sehr verschieden',
  Q35827: 'Río de la Plata: Mündungstrichter, kein Fluss im üblichen Sinn',
};

const flussLaenge: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'fluss-laenge',
  snapshot: 'fluesse-laenge',
  category: 'GEOGRAPHY',
  count: 6,
  window: 50,
  unit: 'km',
  unitLabel: 'Kilometer',
  inputMin: 1,
  inputMax: 10000,
  scaleType: 'LOG',
  scale: 0.3,
  extract: (rows) =>
    singleValueFacts(rows, RIVER_EXCLUSIONS, (m) => m / 1000, { named: true }).filter((f) => f.value >= 100),
  prompt: (f) => `Wie lang ist ${nominative(f.label, 'der Fluss')} (in Kilometern)?`,
  difficulty: familiar,
};

const landFlaeche: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'land-flaeche',
  snapshot: 'laender-flaeche',
  category: 'GEOGRAPHY',
  count: 5,
  window: 80,
  unit: 'km2',
  unitLabel: 'Quadratkilometer',
  inputMin: 1,
  inputMax: 20000000,
  scaleType: 'LOG',
  scale: 0.4,
  extract: (rows) => singleValueFacts(rows, COUNTRY_EXCLUSIONS, (m2) => m2 / 1_000_000, { rename: countryName }),
  prompt: (f) => `Wie groß ist die Fläche ${ofCountry(f.label)} (in Quadratkilometern)?`,
};

const landEinwohner: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'land-einwohner',
  snapshot: 'laender-einwohner',
  category: 'GEOGRAPHY',
  count: 5,
  window: 80,
  unit: 'count',
  unitLabel: 'Einwohner',
  inputMin: 1000,
  inputMax: 2000000000,
  scaleType: 'LOG',
  scale: 0.4,
  extract: (rows) => latestValueFacts(rows, COUNTRY_EXCLUSIONS, countryName),
  prompt: (f) => `Wie viele Menschen lebten ${f.context ?? ''} ${inCountry(f.label)}?`.replace(/ {2,}/g, ' '),
};

const stadtEinwohner: EstimateTemplate = {
  kind: 'ESTIMATE',
  id: 'stadt-einwohner',
  snapshot: 'staedte-einwohner-de',
  category: 'GEOGRAPHY',
  count: 6,
  window: 60,
  unit: 'count',
  unitLabel: 'Einwohner',
  inputMin: 1000,
  inputMax: 10000000,
  scaleType: 'LOG',
  scale: 0.3,
  extract: (rows) => latestValueFacts(rows, {}),
  prompt: (f) => `Wie viele Einwohner hatte ${f.label} ${f.context ?? ''}?`.replace(/ {2,}/g, ' '),
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
  // nur Bauwerke mit geprüfter deutscher Form: das schließt unfertige (Jeddah Tower) und in
  // Deutschland kaum bekannte Hochhäuser aus; mehrdeutige Höhen (mit/ohne Antenne) fallen ohnehin weg
  extract: (rows) => singleValueFacts(rows, {}, (m) => m, { named: true }),
  prompt: (f) => `Wie hoch ist ${nominative(f.label, 'das Bauwerk')} (in Metern)?`,
  difficulty: familiar,
};

/**
 * Personen für die Geburtsjahr-Frage: nur, wer vor allem als Komponist oder Maler bekannt ist.
 * Die Abfrage liefert jeden mit einem dieser Berufe, darunter Politiker, Popstars und Gelehrte;
 * die Berufsangabe sagt nicht, wofür jemand bekannt ist. Unsichere Geburtsjahre (Botticelli,
 * Tizian, Palestrina) fehlen bewusst.
 */
const PEOPLE: Readonly<Record<string, { role: string; name?: string }>> = {
  Q255: { role: 'der Komponist' }, // Ludwig van Beethoven
  Q254: { role: 'der Komponist' }, // Wolfgang Amadeus Mozart
  Q1339: { role: 'der Komponist' }, // Johann Sebastian Bach
  Q1511: { role: 'der Komponist' }, // Richard Wagner
  Q1268: { role: 'der Komponist' }, // Frédéric Chopin
  Q7315: { role: 'der Komponist' }, // Pjotr Iljitsch Tschaikowski
  Q7317: { role: 'der Komponist' }, // Giuseppe Verdi
  Q7312: { role: 'der Komponist' }, // Franz Schubert
  Q1340: { role: 'der Komponist' }, // Antonio Vivaldi
  Q7314: { role: 'der Komponist' }, // Igor Strawinsky
  Q7294: { role: 'der Komponist' }, // Johannes Brahms
  Q7302: { role: 'der Komponist' }, // Georg Friedrich Händel
  Q7349: { role: 'der Komponist' }, // Joseph Haydn
  Q7304: { role: 'der Komponist' }, // Gustav Mahler
  Q7298: { role: 'der Komponist' }, // Antonín Dvořák
  Q7311: { role: 'der Komponist' }, // Giacomo Puccini
  Q1151: { role: 'der Komponist' }, // Hector Berlioz
  Q4700: { role: 'der Komponist' }, // Claude Debussy
  Q7351: { role: 'der Komponist' }, // Robert Schumann
  Q41309: { role: 'der Komponist' }, // Franz Liszt
  Q46096: { role: 'der Komponist' }, // Felix Mendelssohn Bartholdy
  Q9726: { role: 'der Komponist' }, // Gioachino Rossini
  Q80621: { role: 'der Komponist' }, // Edvard Grieg
  Q1178: { role: 'der Komponist' }, // Maurice Ravel
  Q80135: { role: 'der Komponist' }, // Dmitri Schostakowitsch
  Q45682: { role: 'der Komponist' }, // Jean Sibelius
  Q56158: { role: 'der Komponist' }, // Georges Bizet
  Q41555: { role: 'der Komponist' }, // Jacques Offenbach
  Q83326: { role: 'der Komponist' }, // Béla Bartók
  Q762: { role: 'der Maler' }, // Leonardo da Vinci
  Q5582: { role: 'der Maler' }, // Vincent van Gogh
  Q5592: { role: 'der Maler und Bildhauer' }, // Michelangelo
  Q5577: { role: 'der Maler' }, // Salvador Dalí
  Q5598: { role: 'der Maler' }, // Rembrandt van Rijn
  Q5588: { role: 'die Malerin' }, // Frida Kahlo
  Q5597: { role: 'der Maler' }, // Raffael
  Q5432: { role: 'der Maler' }, // Francisco de Goya
  Q5589: { role: 'der Maler' }, // Henri Matisse
  Q5603: { role: 'der Pop-Art-Künstler' }, // Andy Warhol
  Q5586: { role: 'der Maler' }, // Katsushika Hokusai
  Q5599: { role: 'der Maler' }, // Peter Paul Rubens
  Q297: { role: 'der Maler' }, // Diego Velázquez
  Q296: { role: 'der Maler' }, // Claude Monet
  Q35548: { role: 'der Maler' }, // Paul Cézanne
  Q37693: { role: 'der Maler' }, // Paul Gauguin
  Q33477: { role: 'der Maler' }, // Eugène Delacroix
  Q41406: { role: 'der Maler' }, // Edvard Munch
  Q46373: { role: 'der Maler' }, // Edgar Degas
  Q37571: { role: 'der Maler' }, // Jackson Pollock
  Q40599: { role: 'der Maler' }, // Édouard Manet
  Q42207: { role: 'der Maler', name: 'Caravaggio' }, // Michelangelo Merisi da Caravaggio
  Q41264: { role: 'der Maler' }, // Jan Vermeer
  Q301: { role: 'der Maler' }, // El Greco
  Q39931: { role: 'der Maler' }, // Pierre-Auguste Renoir
  Q34661: { role: 'der Maler' }, // Gustav Klimt
  Q152384: { role: 'der Maler' }, // Joan Miró
  Q93284: { role: 'der Maler' }, // Marc Chagall
  Q61064: { role: 'der Maler' }, // Wassily Kandinsky
};

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
      const person = PEOPLE[qid];
      const years = distinct(group.map((r) => yearOf(r['birth'])).filter((y): y is number => y !== null));
      const year = years[0];
      if (!person || years.length !== 1 || year === undefined || year < 1000) continue;
      facts.push({
        qid,
        label: person.name ?? personName(labelOf(group)),
        rank: -sitelinksOf(group),
        value: year,
        context: person.role,
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
      facts.push({
        qid,
        label: personName(labelOf(group)),
        rank: -sitelinksOf(group),
        value: year,
        keySuffix: prize.slug,
        context: prize.name,
      });
    }
    // Rang innerhalb des eigenen Preises, abwechselnd über die Preise: sonst stellen die vielen
    // bekannten Literaturpreisträger alle Fragen
    const order = Object.values(NOBEL).map((p) => p.slug);
    const byPrize = new Map<string, EstimateFact[]>();
    for (const fact of facts) byPrize.set(fact.keySuffix ?? '', [...(byPrize.get(fact.keySuffix ?? '') ?? []), fact]);
    return [...byPrize].flatMap(([slug, list]) =>
      [...list]
        .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'de'))
        .map((fact, i) => ({ ...fact, rank: i * order.length + order.indexOf(slug) })),
    );
  },
  // „Für welches Jahr“: Wikidata führt das Preisjahr; manche Preise wurden erst im Folgejahr
  // überreicht (Einstein: Preis für 1921, verliehen 1922)
  prompt: (f) => `Für welches Jahr erhielt ${f.label} ${f.context ?? 'den Nobelpreis'}?`,
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

const hauptstadt: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'hauptstadt',
  snapshot: 'laender-hauptstadt',
  category: 'GEOGRAPHY',
  count: 8,
  window: 100,
  extract: (rows) =>
    singleAnswerFacts(rows, CAPITAL_EXCLUSIONS, { withGroup: true, rename: countryName }).filter((f) => {
      // „Luxemburg – Luxemburg“, „Mexiko – Mexiko-Stadt“: Antwort steckt in der Frage
      const country = f.label.toLocaleLowerCase('de');
      const capital = f.answer.toLocaleLowerCase('de');
      return !capital.includes(country) && !country.includes(capital);
    }),
  prompt: (f) => `Wie heißt die Hauptstadt ${ofCountry(f.label)}?`,
};

/**
 * Währung, deren Name das Land verrät: „Schweizer Franken“ zu „Schweiz“, „Kap-Verde-Escudo“ zu
 * „Kap Verde“, „VAE-Dirham“ zu „Vereinigte Arabische Emirate“.
 */
export function currencyNamesCountry(country: string, currency: string): boolean {
  const words = (text: string) =>
    text
      .split(/[\s-]+/)
      .map(foldText)
      .filter((w) => w.length > 0);
  const currencyWords = words(currency);
  const countryWords = words(country);
  const initials = countryWords.map((w) => w[0]).join('');
  if (countryWords.length >= 2 && currencyWords.includes(initials)) return true;
  return countryWords
    .filter((w) => w.length >= 3)
    .some((w) => currencyWords.some((c) => c.startsWith(w.slice(0, 4))));
}

const waehrung: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'waehrung',
  snapshot: 'laender-waehrung',
  category: 'POLITICS_SOCIETY',
  count: 6,
  window: 80,
  extract: (rows) => {
    const facts = singleAnswerFacts(rows, COUNTRY_EXCLUSIONS, { withGroup: true, rename: countryName });
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

/**
 * Werke, nach deren Autor die Vorlage nicht fragt. Religiöse und antike Schriften fallen schon
 * durch die Regel „Autor ab 1200 geboren“ weg (meist ohne Autor oder mit legendärem).
 */
const WORK_EXCLUSIONS: Exclusions = {
  Q48244: 'NS-Propaganda, kein Quizstoff',
  Q26193: 'antisemitische Fälschung, kein Quizstoff',
  Q36393: 'Propagandaschrift, Autor steht im Titel',
  Q58784: 'Sachbuch; die Vorlage fragt nach Romanen, Dramen und Gedichten',
  Q205921: 'Sachbuch; die Vorlage fragt nach Romanen, Dramen und Gedichten',
  Q471726: 'Sachbuch; die Vorlage fragt nach Romanen, Dramen und Gedichten',
  Q193034: 'Sachbuch; die Vorlage fragt nach Romanen, Dramen und Gedichten',
  Q245265: 'Sachbuch; die Vorlage fragt nach Romanen, Dramen und Gedichten',
  Q235193: 'Sachbuch; die Vorlage fragt nach Romanen, Dramen und Gedichten',
  Q131719: 'Sachbuch; die Vorlage fragt nach Romanen, Dramen und Gedichten',
  Q200306: 'Fachbuch, Autor steht im Titel',
  Q651532: 'Volksmärchen; Halliwell-Phillipps hat es nur gesammelt',
  Q11831: 'Volksmärchen; die Brüder Grimm haben es gesammelt',
  Q45735: 'deutscher Titel kaum bekannt (auch „Schweinchen Wilbur“)',
  Q8265: 'chinesischer Klassiker, in Deutschland kaum bekannt',
  Q70784: 'chinesischer Klassiker, in Deutschland kaum bekannt',
  Q70806: 'chinesischer Klassiker, in Deutschland kaum bekannt',
  Q70827: 'chinesischer Klassiker, in Deutschland kaum bekannt',
  Q212180: 'Handschrift ohne Autor',
};

/** Gebräuchlicher deutscher Titel, wo Wikidata den Originaltitel führt. */
const WORK_TITLES: Readonly<Record<string, string>> = {
  "L'Étranger": 'Der Fremde',
};

/** Ob ein Teil des Autorennamens im Titel steht („Das Tagebuch der Anne Frank“). */
function authorInTitle(title: string, author: string): boolean {
  const folded = foldText(title);
  return author
    .split(/\s+/)
    .map(foldText)
    .some((part) => part.length >= 4 && folded.includes(part));
}

const autor: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'autor',
  snapshot: 'literatur-werke',
  category: 'LITERATURE',
  count: 8,
  window: 60,
  extract: (rows) =>
    singleAnswerFacts(rows, WORK_EXCLUSIONS, {
      onePerAnswer: true,
      answerName: personName,
      rename: (title) => WORK_TITLES[title] ?? title,
    }).filter(
      (f) => f.year !== undefined && f.year >= 1200 && !authorInTitle(f.label, f.answer),
    ),
  prompt: (f) => `Wer schrieb „${f.label}“?`,
};

const oper: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'oper',
  snapshot: 'opern',
  category: 'ARTS_CULTURE',
  count: 6,
  window: 40,
  extract: (rows) =>
    singleAnswerFacts(rows, { Q242667: 'Rockoper, eher Musical' }, { onePerAnswer: true, answerName: personName }),
  prompt: (f) => `Wer komponierte die Oper „${f.label}“?`,
};

const gemaelde: ChoiceTemplate = {
  kind: 'TRIVIA',
  id: 'gemaelde',
  snapshot: 'gemaelde',
  category: 'ARTS_CULTURE',
  count: 8,
  window: 50,
  extract: (rows) => singleAnswerFacts(rows, {}, { onePerAnswer: true, answerName: personName }),
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
  // falsche Antworten: zuerst Elemente, deren deutscher Name mit dem Buchstaben des Symbols
  // beginnt (Au → Aluminium, Arsen), dann solche mit dem Anfangsbuchstaben der richtigen Antwort
  // (O → Schwefel, Stickstoff für Sauerstoff), damit keine Möglichkeit offensichtlich abfällt
  distractorPool: (fact, _facts, rows) => {
    const initial = (text: string) => text[0]?.toLocaleLowerCase('de') ?? '';
    const letter = initial(fact.label);
    const answerLetter = initial(fact.answer);
    const all = elementRows(rows)
      .filter((e) => e.number <= 103)
      .sort((a, b) => b.sitelinks - a.sitelinks);
    const sameInitial = all.filter((e) => initial(e.label) === letter).map((e) => e.label);
    const sameAnswerInitial = all.filter((e) => initial(e.label) === answerLetter).map((e) => e.label);
    const sameSymbolLetter = all.filter((e) => initial(e.symbol) === letter).map((e) => e.label);
    return distinct([...sameInitial, ...sameAnswerInitial, ...sameSymbolLetter, ...all.map((e) => e.label)]);
  },
};

/** „Austragung der Olympischen Sommerspiele“ (frühere Klasse Q159821 hat keine Instanzen mehr). */
const SUMMER = 'Q135976384';
const CANCELLED_GAMES = new Set([1916, 1940, 1944]);

/**
 * Ausrichterstädte. Wikidata nennt als Ort (P276) auch Stadien und Skigebiete, bei manchen
 * Spielen nur diese (1952 Bislett-Stadion statt Oslo, 1972 Olympiastadion statt München). Eine
 * Frage entsteht nur, wenn genau eine dieser Städte als Ort genannt ist; Spiele mit zwei
 * Ausrichtern (2026 Mailand und Cortina) fallen damit weg.
 */
const HOST_CITIES: ReadonlySet<string> = new Set([
  'Q1524', // Athen
  'Q90', // Paris
  'Q38022', // St. Louis
  'Q84', // London
  'Q1754', // Stockholm
  'Q12892', // Antwerpen
  'Q83236', // Chamonix-Mont-Blanc
  'Q727', // Amsterdam
  'Q68986', // St. Moritz
  'Q192700', // Lake Placid
  'Q65', // Los Angeles
  'Q127043', // Garmisch-Partenkirchen
  'Q64', // Berlin
  'Q1757', // Helsinki
  'Q41158', // Cortina d’Ampezzo
  'Q3141', // Melbourne
  'Q220', // Rom
  'Q1490', // Tokio
  'Q1735', // Innsbruck
  'Q1489', // Mexiko-Stadt
  'Q1289', // Grenoble
  'Q37951', // Sapporo
  'Q340', // Montreal
  'Q649', // Moskau
  'Q11194', // Sarajevo
  'Q8684', // Seoul
  'Q36312', // Calgary
  'Q159469', // Albertville
  'Q1492', // Barcelona
  'Q23556', // Atlanta
  'Q128849', // Nagano
  'Q3130', // Sydney
  'Q23337', // Salt Lake City
  'Q495', // Turin
  'Q956', // Peking
  'Q24639', // Vancouver
  'Q39420', // Sotschi
  'Q8678', // Rio de Janeiro
]);

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
      const first = group[0];
      // nur Olympische Spiele (die Abfrage liefert auch die Winter-Paralympics 1988)
      if (!first?.['label']?.startsWith('Olympische ')) continue;
      const cities = distinct(group.filter((r) => HOST_CITIES.has(r['answer'] ?? '')).map((r) => r['answerLabel'] ?? ''));
      const city = cities[0];
      if (cities.length !== 1 || !city) continue;
      // das Jahr aus der Bezeichnung: Tokio 2020 fand 2021 statt, heißt aber „Sommerspiele 2020“
      const year =
        numberOf(/\b(18|19|20)\d\d\b/.exec(first['label'])?.[0]) ?? yearOf(first['date']) ?? yearOf(first['start']);
      if (year === null || year > 2026 || CANCELLED_GAMES.has(year)) continue;
      const summer = first['type'] === SUMMER;
      facts.push({
        qid,
        label: `Olympischen ${summer ? 'Sommerspiele' : 'Winterspiele'} ${year}`,
        // ohne Bekanntheitswert: jüngere Spiele zuerst, damit die Auswahl über die Jahrzehnte streut
        rank: -year,
        answer: city,
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
