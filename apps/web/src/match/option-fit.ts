import { useEffect, useState } from 'react';

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
 * einschließlich des Strichs („Mecklenburg-“, „Vorpommern“), denn dort bricht der Browser um. Ein
 * geschütztes Leerzeichen (auch das schmale in „10 000“) trennt nicht: Dort bricht er nicht um.
 */
export function unbreakable(text: string): string[] {
  return text
    .split(/[^\S\u00a0\u2007\u202f]+/)
    .flatMap((word) => word.match(/[^-‐–]+[-‐–]*|[-‐–]+/g) ?? [])
    .filter((part) => part.length > 0);
}

/** Breite eines Textstücks in em der Antwortschrift. */
export type MeasureEm = (text: string) => number;

/** Schrift der Antworten in 100 px: Gemessen wird in Hundertsteln, also in em. */
const ANSWER_FONT = '600 100px "Alegreya Sans", system-ui, sans-serif';

let context: CanvasRenderingContext2D | null | undefined;

/**
 * Misst in der Schrift der Antworten (Alegreya Sans, halbfett). Ohne Zeichenfläche (Tests ohne
 * Browser) schätzt sie nach der Zahl der Zeichen; das ist eher zu breit als zu schmal. Die Schrift
 * wird bei jeder Messung neu gesetzt: Ist sie inzwischen geladen, misst die Zeichenfläche dann sie
 * statt der Ersatzschrift.
 */
export const measureAnswerEm: MeasureEm = (text) => {
  if (context === undefined) {
    context =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!context) return text.length * 0.52;
  context.font = ANSWER_FONT;
  return context.measureText(text).width / 100;
};

/** Ob die Antwortschrift schon geladen ist; ohne Schriftverwaltung (Tests) gilt sie als geladen. */
function answerFontReady(): boolean {
  return typeof document === 'undefined' || !document.fonts || document.fonts.check(ANSWER_FONT);
}

/**
 * Rendert die Karte noch einmal, sobald die Antwortschrift geladen ist: Erscheint eine Frage vor
 * ihr (Seite eben neu geladen), maß die Zeichenfläche die Ersatzschrift, und die Stufe stimmte
 * für die echte Schrift nicht. Der Rückgabewert ist nur dafür da, dass sich die Karte neu rechnet.
 */
export function useAnswerFont(): boolean {
  const [ready, setReady] = useState(answerFontReady);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void document.fonts.load(ANSWER_FONT).then(
      () => {
        if (live) setReady(true);
      },
      () => {
        // Lädt die Schrift nicht, bleibt die Ersatzschrift und mit ihr die Messung
      },
    );
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

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
