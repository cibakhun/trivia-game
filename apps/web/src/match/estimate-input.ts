/**
 * Eingabe einer Schätzung über das eigene Ziffernfeld der Partie (ADR-059): Im Querformat würde
 * die Tastatur des Handys die Karte und die Frage verdecken. Die Eingabe ist ein Text aus Ziffern
 * und höchstens einem Komma, genau so, wie ihn der Server als deutsche Zahl liest.
 */

export const ESTIMATE_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  ',',
  '0',
  'back',
] as const;
export type EstimateKey = (typeof ESTIMATE_KEYS)[number];

/** Längste Zahl vor dem Komma: mehr Stellen hat keine Schätzfrage, und die Anzeige bleibt lesbar. */
export const ESTIMATE_MAX_WHOLE = 12;

/**
 * Eingabe nach einem Tastendruck. `precision` sind die gewerteten Nachkommastellen der Frage: Ohne
 * sie gibt es kein Komma, und mehr Stellen nimmt das Feld nicht an.
 */
export function pressEstimateKey(value: string, key: EstimateKey, precision: number): string {
  if (key === 'back') return value.slice(0, -1);
  const [whole = '', fraction] = value.split(',');
  if (key === ',') {
    return precision > 0 && fraction === undefined && whole !== '' ? `${value},` : value;
  }
  if (fraction !== undefined) return fraction.length < precision ? value + key : value;
  // Keine führenden Nullen: Die nächste Ziffer ersetzt eine einzelne Null
  if (whole === '0') return key;
  return whole.length < ESTIMATE_MAX_WHOLE ? value + key : value;
}

/** Taste einer echten Tastatur als Taste des Ziffernfelds; `null` für alles andere. */
export function estimateKeyOf(key: string): EstimateKey | null {
  if (/^\d$/.test(key)) return key as EstimateKey;
  if (key === ',' || key === '.') return ',';
  if (key === 'Backspace' || key === 'Delete') return 'back';
  return null;
}

/** Anzeige der Eingabe: ab fünf Stellen mit Punkten gegliedert („12.500“), Jahreszahlen bleiben glatt. */
export function showEstimate(value: string): string {
  const [whole = '', fraction] = value.split(',');
  const grouped = whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : whole;
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

/** Was an den Server geht: ohne ein Komma, hinter dem nichts mehr steht. `null`, solange nichts dasteht. */
export function estimateToSend(value: string): string | null {
  const text = value.replace(/,$/, '');
  return /^\d+(,\d+)?$/.test(text) ? text : null;
}
