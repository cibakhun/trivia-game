/**
 * Deutsche Formen für Namen aus Wikidata. Wikidata liefert nur die Bezeichnung („Schweiz“,
 * „Zugspitze“); Artikel und Fall braucht der Fragetext aber selbst. Fehlt ein Name hier, nimmt
 * der Generator eine Formulierung ohne Artikel (z. B. „der Berg „X““), die die Sprachprüfung
 * dann glättet.
 */

interface CountryForms {
  /** „die Hauptstadt …“: Genitiv mit Artikel oder „von …“. */
  readonly of: string;
  /** „Mit welcher Währung bezahlt man …“: Ortsangabe. */
  readonly in: string;
}

const feminine = (name: string): CountryForms => ({ of: `der ${name}`, in: `in der ${name}` });
const masculine = (name: string): CountryForms => ({ of: `des ${name}`, in: `im ${name}` });
const plural = (genitive: string, dative: string, preposition = 'in'): CountryForms => ({
  of: `der ${genitive}`,
  in: `${preposition} den ${dative}`,
});

/** Staaten, die im Deutschen mit Artikel stehen (Bezeichnung wie in Wikidata). */
const COUNTRY_FORMS: Readonly<Record<string, CountryForms>> = {
  Schweiz: feminine('Schweiz'),
  Türkei: feminine('Türkei'),
  Slowakei: feminine('Slowakei'),
  Mongolei: feminine('Mongolei'),
  Ukraine: feminine('Ukraine'),
  Elfenbeinküste: feminine('Elfenbeinküste'),
  Vatikanstadt: feminine('Vatikanstadt'),
  'Volksrepublik China': feminine('Volksrepublik China'),
  'Republik Moldau': feminine('Republik Moldau'),
  'Republik Kongo': feminine('Republik Kongo'),
  'Demokratische Republik Kongo': { of: 'der Demokratischen Republik Kongo', in: 'in der Demokratischen Republik Kongo' },
  'Zentralafrikanische Republik': { of: 'der Zentralafrikanischen Republik', in: 'in der Zentralafrikanischen Republik' },
  'Dominikanische Republik': { of: 'der Dominikanischen Republik', in: 'in der Dominikanischen Republik' },
  Irak: masculine('Irak'),
  Iran: masculine('Iran'),
  Libanon: masculine('Libanon'),
  Sudan: masculine('Sudan'),
  Südsudan: masculine('Südsudan'),
  Jemen: masculine('Jemen'),
  Tschad: masculine('Tschad'),
  Niger: masculine('Niger'),
  Senegal: masculine('Senegal'),
  Oman: masculine('Oman'),
  Kosovo: masculine('Kosovo'),
  'Vereinigtes Königreich': { of: 'des Vereinigten Königreichs', in: 'im Vereinigten Königreich' },
  Niederlande: plural('Niederlande', 'Niederlanden'),
  'Vereinigte Staaten': plural('Vereinigten Staaten', 'Vereinigten Staaten'),
  'Vereinigte Arabische Emirate': plural('Vereinigten Arabischen Emirate', 'Vereinigten Arabischen Emiraten'),
  'Föderierte Staaten von Mikronesien': plural('Föderierten Staaten von Mikronesien', 'Föderierten Staaten von Mikronesien'),
  Philippinen: plural('Philippinen', 'Philippinen', 'auf'),
  Bahamas: plural('Bahamas', 'Bahamas', 'auf'),
  Malediven: plural('Malediven', 'Malediven', 'auf'),
  Seychellen: plural('Seychellen', 'Seychellen', 'auf'),
  Komoren: plural('Komoren', 'Komoren', 'auf'),
  Salomonen: plural('Salomonen', 'Salomonen', 'auf'),
  Marshallinseln: plural('Marshallinseln', 'Marshallinseln', 'auf'),
};

/**
 * Bezeichnungen aus Wikidata, die im Fragetext anders heißen müssen: „Naoero“ ist die
 * Eigenbezeichnung von Nauru, „Moldau“ allein ist auch der Fluss.
 */
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  Naoero: 'Nauru',
  Moldau: 'Republik Moldau',
};

/** Gebräuchlicher deutscher Name eines Staates. */
export function countryName(label: string): string {
  return COUNTRY_NAMES[label] ?? label;
}

/** „die Hauptstadt der Schweiz“, „die Fläche von Kanada“. */
export function ofCountry(label: string): string {
  return COUNTRY_FORMS[label]?.of ?? `von ${label}`;
}

/** „in der Schweiz“, „im Irak“, „auf den Philippinen“, „in Polen“. */
export function inCountry(label: string): string {
  return COUNTRY_FORMS[label]?.in ?? `in ${label}`;
}

/** Gebräuchliche Kurzform, wo Wikidata den vollen Namen führt. */
const PERSON_NAMES: Readonly<Record<string, string>> = {
  'Joanne K. Rowling': 'J. K. Rowling',
  'Lyman Frank Baum': 'L. Frank Baum',
  'Elwyn Brooks White': 'E. B. White',
  'Samuel Phillips Huntington': 'Samuel P. Huntington',
};

/**
 * Name einer Person für Antwortmöglichkeiten: Kurzform aus der Liste oder russischer Name ohne
 * Vatersnamen („Fjodor Michailowitsch Dostojewski“ → „Fjodor Dostojewski“), damit die Knöpfe
 * auf dem Handy nicht umbrechen.
 */
export function personName(label: string): string {
  const known = PERSON_NAMES[label];
  if (known) return known;
  const parts = label.split(' ');
  if (parts.length === 3 && /(?:owitsch|ewitsch|itsch|owna|ewna|ichna)$/.test(parts[1] ?? '')) {
    return `${parts[0]} ${parts[2]}`;
  }
  return label;
}

/**
 * Nominativ mit Artikel für Berge, Flüsse und Bauwerke, die in der Auswahl vorkommen
 * (Bezeichnung wie in Wikidata → „die Zugspitze“). Ergänzt nach Durchsicht der Daten.
 */
const NOMINATIVE: Readonly<Record<string, string>> = {
  // Berge und Vulkane
  'Mount Everest': 'der Mount Everest',
  K2: 'der K2',
  Kilimandscharo: 'der Kilimandscharo',
  'Mont Blanc': 'der Mont Blanc',
  Matterhorn: 'das Matterhorn',
  Zugspitze: 'die Zugspitze',
  Fuji: 'der Fuji',
  Vesuv: 'der Vesuv',
  Ätna: 'der Ätna',
  Elbrus: 'der Elbrus',
  Aconcagua: 'der Aconcagua',
  Denali: 'der Denali',
  Kangchendzönga: 'der Kangchendzönga',
  Olymp: 'der Olymp',
  Ararat: 'der Ararat',
  Großglockner: 'der Großglockner',
  Eiger: 'der Eiger',
  Brocken: 'der Brocken',
  Montblanc: 'der Montblanc',
  Popocatépetl: 'der Popocatépetl',
  Chimborazo: 'der Chimborazo',
  'Mauna Kea': 'der Mauna Kea',
  Teide: 'der Teide',
  Triglav: 'der Triglav',
  Annapurna: 'die Annapurna',
  'Nanga Parbat': 'der Nanga Parbat',
  Lhotse: 'der Lhotse',
  Makalu: 'der Makalu',
  'Mount Kenya': 'der Mount Kenya',
  'Mount Rainier': 'der Mount Rainier',
  'Mount St. Helens': 'der Mount St. Helens',
  'Pico de Orizaba': 'der Pico de Orizaba',
  Citlaltépetl: 'der Pico de Orizaba (Citlaltépetl)',
  'Berg Olymp': 'der Olymp',
  Kailash: 'der Kailash',
  Dhaulagiri: 'der Dhaulagiri',
  'Mount-Kenya-Massiv': 'der Mount Kenya',
  'Mount Kosciuszko': 'der Mount Kosciuszko',
  'Cho Oyu': 'der Cho Oyu',
  Manaslu: 'der Manaslu',
  Merapi: 'der Merapi',
  'Ben Nevis': 'der Ben Nevis',
  Shishapangma: 'der Shishapangma',
  'Carstensz-Pyramide': 'die Carstensz-Pyramide',
  'Broad Peak': 'der Broad Peak',
  Paektusan: 'der Paektusan',
  'Mount Logan': 'der Mount Logan',
  Tambora: 'der Tambora',
  Tafelberg: 'der Tafelberg bei Kapstadt',
  'Nevado Ojos del Salado': 'der Ojos del Salado',
  'Tai Shan': 'der Tai Shan',
  Kinabalu: 'der Kinabalu',
  'Hidden Peak': 'der Hidden Peak',
  Pinatubo: 'der Pinatubo',
  Mayon: 'der Mayon',
  'Gasherbrum II': 'der Gasherbrum II',
  'Mount Erebus': 'der Mount Erebus',
  'Mount Cook': 'der Mount Cook',
  Aragaz: 'der Aragaz',
  Hermon: 'der Hermon',
  Parnass: 'der Parnass',
  Cotopaxi: 'der Cotopaxi',
  'Khan Tengri': 'der Khan Tengri',
  'Gangkhar Puensum': 'der Gangkhar Puensum',
  Kasbek: 'der Kasbek',
  // Flüsse
  Nil: 'der Nil',
  Amazonas: 'der Amazonas',
  Rhein: 'der Rhein',
  Donau: 'die Donau',
  Elbe: 'die Elbe',
  Wolga: 'die Wolga',
  Themse: 'die Themse',
  Seine: 'die Seine',
  Loire: 'die Loire',
  Rhone: 'die Rhone',
  Rhône: 'die Rhône',
  Po: 'der Po',
  Tiber: 'der Tiber',
  Weichsel: 'die Weichsel',
  Oder: 'die Oder',
  Main: 'der Main',
  Mosel: 'die Mosel',
  Weser: 'die Weser',
  Dnepr: 'der Dnepr',
  Don: 'der Don',
  Ural: 'der Ural',
  Mississippi: 'der Mississippi',
  Missouri: 'der Missouri',
  Jangtsekiang: 'der Jangtsekiang',
  Jangtse: 'der Jangtse',
  'Gelber Fluss': 'der Gelbe Fluss',
  'Huang He': 'der Huang He',
  Ganges: 'der Ganges',
  Indus: 'der Indus',
  Mekong: 'der Mekong',
  Euphrat: 'der Euphrat',
  Tigris: 'der Tigris',
  Jordan: 'der Jordan',
  Kongo: 'der Kongo',
  Niger: 'der Niger',
  Sambesi: 'der Sambesi',
  Ob: 'der Ob',
  Jenissei: 'der Jenissei',
  Lena: 'die Lena',
  Amur: 'der Amur',
  'Río de la Plata': 'der Río de la Plata',
  Paraná: 'der Paraná',
  Orinoco: 'der Orinoco',
  Colorado: 'der Colorado',
  'Colorado River': 'der Colorado River',
  'Rio Grande': 'der Rio Grande',
  'Sankt-Lorenz-Strom': 'der Sankt-Lorenz-Strom',
  Yukon: 'der Yukon',
  Tajo: 'der Tajo',
  Ebro: 'der Ebro',
  Garonne: 'die Garonne',
  Dnister: 'der Dnister',
  Theiß: 'die Theiß',
  Drau: 'die Drau',
  Save: 'die Save',
  Inn: 'der Inn',
  Isar: 'die Isar',
  Neckar: 'der Neckar',
  Spree: 'die Spree',
  Havel: 'die Havel',
  Saale: 'die Saale',
  Ems: 'die Ems',
  Ruhr: 'die Ruhr',
  Moldau: 'die Moldau',
  Newa: 'die Newa',
  Kama: 'die Kama',
  Irtysch: 'der Irtysch',
  Syrdarja: 'der Syrdarja',
  Amudarja: 'der Amudarja',
  Brahmaputra: 'der Brahmaputra',
  Irrawaddy: 'der Irrawaddy',
  Limpopo: 'der Limpopo',
  Oranje: 'der Oranje',
  Senegal: 'der Senegal',
  Volta: 'der Volta',
  Murray: 'der Murray',
  'Murray River': 'der Murray',
  Dnipro: 'der Dnipro',
  Yamuna: 'die Yamuna',
  'Yukon River': 'der Yukon',
  Düna: 'die Düna',
  Maas: 'die Maas',
  'Columbia River': 'der Columbia River',
  'Hudson River': 'der Hudson River',
  'Ohio River': 'der Ohio',
  Douro: 'der Douro',
  'Rio Paraná': 'der Paraná',
  Godavari: 'die Godavari',
  Moskwa: 'die Moskwa',
  'Río Uruguay': 'der Uruguay',
  'Senegal-Strom': 'der Senegal',
  Angara: 'die Angara',
  Gambia: 'der Gambia',
  Krishna: 'die Krishna',
  'Rio Negro': 'der Rio Negro',
  'Río Paraguay': 'der Paraguay',
  Oka: 'die Oka',
  Aras: 'der Aras',
  // Bauwerke
  Eiffelturm: 'der Eiffelturm',
  'Burj Khalifa': 'der Burj Khalifa',
  'Berliner Fernsehturm': 'der Berliner Fernsehturm',
  'CN Tower': 'der CN Tower',
  'Empire State Building': 'das Empire State Building',
  'Tokyo Skytree': 'der Tokyo Skytree',
  'Tokyo Tower': 'der Tokyo Tower',
  'Kölner Dom': 'der Kölner Dom',
  'Ulmer Münster': 'das Ulmer Münster',
  'Schiefer Turm von Pisa': 'der Schiefe Turm von Pisa',
  'Big Ben': 'der Big Ben',
  'Elizabeth Tower': 'der Elizabeth Tower',
  'Petronas Towers': 'die Petronas Towers',
  'Taipei 101': 'der Taipei 101',
  'Shanghai Tower': 'der Shanghai Tower',
  'One World Trade Center': 'das One World Trade Center',
  'Chrysler Building': 'das Chrysler Building',
  'Willis Tower': 'der Willis Tower',
  'Space Needle': 'die Space Needle',
  'Ostankino-Turm': 'der Ostankino-Turm',
  'Oriental Pearl Tower': 'der Oriental Pearl Tower',
  'Canton Tower': 'der Canton Tower',
  'Notre-Dame de Paris': 'die Kathedrale Notre-Dame de Paris',
  'Sagrada Família': 'die Sagrada Família',
  'Petersdom': 'der Petersdom',
  'Stephansdom': 'der Stephansdom',
  'Frauenkirche': 'die Frauenkirche',
  'Kathedrale von Chartres': 'die Kathedrale von Chartres',
  'Straßburger Münster': 'das Straßburger Münster',
  'Mailänder Dom': 'der Mailänder Dom',
  'Westminster Abbey': 'die Westminster Abbey',
  'Lotte World Tower': 'der Lotte World Tower',
  'The Shard': 'das Hochhaus The Shard in London',
  'Messeturm': 'der Messeturm',
  'Commerzbank Tower': 'der Commerzbank Tower',
  'Olympiaturm': 'der Olympiaturm',
  'Sears-Tower': 'der Willis Tower (früher Sears Tower) in Chicago',
  'Kathedrale von Florenz': 'der Dom von Florenz mit seiner Kuppel',
  'Tokio-Turm': 'der Tokyo Tower',
  'Shanghai World Financial Center': 'das Shanghai World Financial Center',
  'Fernsehturm Ostankino': 'der Fernsehturm Ostankino in Moskau',
  Galataturm: 'der Galataturm in Istanbul',
  Kulturpalast: 'der Kulturpalast in Warschau',
  'Grande Arche': 'die Grande Arche in Paris',
  '30 St Mary Axe': 'das Londoner Hochhaus 30 St Mary Axe („die Gurke“)',
  'Tour Montparnasse': 'der Tour Montparnasse in Paris',
  'Bank of China Tower': 'der Bank of China Tower in Hongkong',
  'Woolworth Building': 'das Woolworth Building in New York',
  'Turning Torso': 'der Turning Torso in Malmö',
  'Lakhta Center': 'das Lakhta Center in Sankt Petersburg',
};

/** „die Zugspitze“ oder, falls unbekannt, „<Gattung> „<Name>““ (z. B. „der Berg „Zugspitze““). */
export function nominative(label: string, fallbackNoun: string): string {
  return NOMINATIVE[label] ?? `${fallbackNoun} „${label}“`;
}

/** Ob für den Namen eine geprüfte Form mit Artikel vorliegt. */
export function hasNominative(label: string): boolean {
  return label in NOMINATIVE;
}
