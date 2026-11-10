/**
 * Landschaft je Region, nur für die Darstellung: Sie bestimmt die kleinen Motive auf der Karte
 * (Bäume, Berge, Felder …), nicht die Regeln. Feste Zuordnung für die Wendelmark, sonst nach
 * Wortteilen des Namens.
 */

export const TERRAINS = [
  'forest',
  'pines',
  'mountains',
  'hills',
  'fields',
  'meadow',
  'marsh',
  'lake',
  'river',
  'village',
] as const;
export type Terrain = (typeof TERRAINS)[number];

const WENDELMARK: Readonly<Record<string, Terrain>> = {
  Eschenhain: 'forest',
  Falkenwacht: 'hills',
  Graufurt: 'river',
  Hirschgrund: 'forest',
  Ackerbrunn: 'fields',
  Birkental: 'forest',
  Dornfeld: 'fields',
  Eisenhang: 'mountains',
  Fuchsmoor: 'marsh',
  Goldwiese: 'meadow',
  Hagelstein: 'mountains',
  Immenau: 'meadow',
  Kranichsee: 'lake',
  Lindenhof: 'village',
  Mühlbach: 'river',
  Nebelsenke: 'marsh',
  Otterbruch: 'marsh',
  Quellheim: 'village',
  Rabenfels: 'hills',
  Salzweide: 'meadow',
  Tannenruh: 'pines',
  Uferland: 'fields',
  Wolfsklamm: 'mountains',
  Zinnberg: 'mountains',
};

const BY_PART: readonly (readonly [RegExp, Terrain])[] = [
  [/tann|fichte|kiefer/i, 'pines'],
  [/wald|hain|forst|birk|esch|eich|buch/i, 'forest'],
  [/berg|stein|fels|hang|klamm|zinn|eisen/i, 'mountains'],
  [/höh|hügel|wacht|kuppe/i, 'hills'],
  [/see|teich/i, 'lake'],
  [/bach|furt|fluss|quell|ufer/i, 'river'],
  [/moor|bruch|senke|sumpf|ried/i, 'marsh'],
  [/acker|feld|korn/i, 'fields'],
  [/wiese|weide|au$|aue|anger/i, 'meadow'],
];

export function terrainOf(name: string): Terrain {
  const fixed = WENDELMARK[name];
  if (fixed) return fixed;
  for (const [pattern, terrain] of BY_PART) if (pattern.test(name)) return terrain;
  return 'village';
}
