/**
 * Schriftgröße der Antwortfelder einer Wissensfrage (Fragekarte, Karte zum Mitlesen und ihre
 * Rückseite, die Auflösung): Lange Antworten bekommen eine kleinere Schrift, damit die Karte nicht
 * wächst, und ein langes Wort eine so kleine, dass es in seinem Feld auf eine Zeile passt
 * („Weißkopfseeadler“, „Bundesverfassungsgericht“). Vorher brach es mitten im Wort um, weil nur
 * die Länge der ganzen Antwort zählte. Beide Seiten der Karte rechnen hiermit, damit die Auflösung
 * Feld auf Feld auf der Frage liegt.
 */

/** Stufen von groß nach klein; die Klasse steht an der Karte (stage.css). */
export type OptionDensity = '' | ' options-mid' | ' options-long' | ' options-tight';

interface Level {
  readonly density: OptionDensity;
  /** Längste Antwort in Zeichen, die diese Stufe noch nimmt (mehrere Wörter dürfen umbrechen). */
  readonly chars: number;
  /**
   * Platz für die Antwort in ihrem Feld, in der Schriftgröße der Stufe gemessen (em): Feld ohne
   * Rand, Münze und ihren Abstand. Gemessen am Prüfstand, in jeder Fenstergröße gleich, weil alle
   * Maße der Bühne an `--u` hängen. Ändern sich Schrift, Münze oder Rand in stage.css, hier mit.
   */
  readonly roomEm: number;
}

const LEVELS: readonly Level[] = [
  { density: '', chars: 16, roomEm: 7.11 },
  { density: ' options-mid', chars: 34, roomEm: 8.62 },
  { density: ' options-long', chars: Infinity, roomEm: 10 },
  { density: ' options-tight', chars: Infinity, roomEm: 11.5 },
];

/**
 * So knapp darf ein Wort an den Rand: Andere Browser messen dieselbe Schrift um wenige Prozent
 * anders (WebKit auf dem iPhone), und das Wort soll dort genauso auf seine Zeile passen.
 */
const SAFETY = 0.97;

/**
 * Teile einer Antwort, die nicht umbrechen können: Wörter, und bei Bindestrichen die Stücke bis
 * einschließlich des Strichs („Mecklenburg-“, „Vorpommern“), denn dort bricht der Browser um.
 */
export function unbreakable(text: string): string[] {
  return text
    .split(/\s+/)
    .flatMap((word) => word.match(/[^-‐–]+[-‐–]*|[-‐–]+/g) ?? [])
    .filter((part) => part.length > 0);
}

/** Breite eines Textstücks in em der Antwortschrift. */
export type MeasureEm = (text: string) => number;

let context: CanvasRenderingContext2D | null | undefined;

/**
 * Misst in der Schrift der Antworten (Alegreya Sans, halbfett). Ohne Zeichenfläche (Tests ohne
 * Browser) schätzt sie nach der Zahl der Zeichen; das ist eher zu breit als zu schmal.
 */
export const measureAnswerEm: MeasureEm = (text) => {
  if (context === undefined) {
    context =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (context) context.font = '600 100px "Alegreya Sans", system-ui, sans-serif';
  }
  return context ? context.measureText(text).width / 100 : text.length * 0.52;
};

/**
 * Stufe für eine Wissensfrage: die größte, in der die längste Antwort nach der Zahl ihrer Zeichen
 * passt und jedes Wort auf eine Zeile. Passt ein Wort nicht einmal in die kleinste, bricht es dort
 * wie bisher am Rand um.
 */
export function optionDensity(
  options: readonly (string | null)[],
  measure: MeasureEm = measureAnswerEm,
): OptionDensity {
  const texts = options.filter((text): text is string => text !== null);
  const longest = Math.max(0, ...texts.map((text) => text.length));
  const widest = Math.max(0, ...texts.flatMap(unbreakable).map(measure));
  const level =
    LEVELS.find((l) => longest <= l.chars && widest <= l.roomEm * SAFETY) ?? LEVELS.at(-1);
  return level?.density ?? '';
}

/** Lange Fragen bekommen eine kleinere Schrift. */
export function promptDensity(prompt: string): '' | ' prompt-long' {
  return prompt.length > 110 ? ' prompt-long' : '';
}
