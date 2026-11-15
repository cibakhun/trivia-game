import { fxParticles, type FxParticle } from '../art/fx/fx.ts';

/**
 * Zeitplan der Abrechnung (docs/ART_DIRECTION.md §5): Was wann erscheint, wenn die Seite das Ende
 * der Partie miterlebt. Alle Zeiten in ms ab dem Erscheinen des Blatts. Reine Ableitung, damit
 * sie prüfbar ist; CSS bekommt die Zeiten als Variablen (`ResultPanel`).
 *
 * Der Takt kommt vom Klang (`sound-cues.ts`, `audio/sound.ts`): Er beginnt 400 ms nach dem
 * Erscheinen. Die Fanfare des Siegs steigt in drei Tönen zum Akkord, die Tabelle baut sich dazu
 * vom letzten Platz zum ersten auf, und auf dem Akkord setzt das Siegel auf. Die Folge der
 * Niederlage fällt in ruhigen Schritten, die Tabelle füllt sich dazu von oben nach unten.
 */

/** Sieg (Platz 1, auch geteilt), ein anderer Platz, oder ohne eigenen Sitz. */
export type ResultTone = 'victory' | 'placed' | 'neutral';

/** Beginn des Klangs: 400 ms Abstand (`cuesFor`) und 10 ms Vorlauf beim Abspielen (`playSound`). */
export const RESULT_CUE_MS = 410;
/** Fanfare (`victory`): Abstand der drei steigenden Töne und Einsatz des Akkords. */
const FANFARE_STEP_MS = 140;
const FANFARE_CHORD_MS = 420;
/** Niederlage (`defeat`): Abstand der fallenden Töne. */
const LAMENT_STEP_MS = 350;

/** So lange zählen die Punkte einer Zeile hoch; die des Siegers etwas länger. */
const COUNT_MS = 450;
const COUNT_WINNER_MS = 650;
/**
 * Die Punkte beginnen zu zählen, während die Zeile erscheint (sie braucht 150 ms bis zu ihrem
 * Platz, `stage.css`): So steht nie eine Null da und wartet.
 */
export const TALLY_LEAD_MS = 110;
/** Nach dem Aufsetzen des Siegels laufen die Strahlen noch so lange aus. */
export const SEAL_SETTLE_MS = 1400;

export interface ResultTiming {
  /** Je Zeile der Tabelle (in ihrer Reihenfolge): wann sie steht und ihre Punkte zu zählen beginnen. */
  readonly rows: readonly number[];
  /** Je Zeile: wie lange ihre Punkte zählen. */
  readonly counts: readonly number[];
  /** Wann das Siegel aufsetzt; `null` ohne Sieg. */
  readonly seal: number | null;
  /** Ab hier steht alles still. */
  readonly rest: number;
}

/**
 * Zeitplan für die Plätze der Tabelle (von oben nach unten, wie sie dasteht). Gleiche Plätze
 * erscheinen zusammen. Beim Sieg steht der erste Platz zuletzt, einen Ton vor dem Siegel; sonst
 * füllt sich die Tabelle von oben.
 */
export function resultTiming(places: readonly number[], tone: ResultTone): ResultTiming {
  // Rang der Zeile unter den vergebenen Plätzen: 0 für den besten
  const distinct = [...new Set(places)].sort((a, b) => a - b);
  const ranks = places.map((place) => distinct.indexOf(place));
  if (tone === 'victory') {
    // Drei Töne: Der erste Platz steht auf dem letzten, die Plätze dahinter je einen Ton früher
    const last = RESULT_CUE_MS + 2 * FANFARE_STEP_MS;
    const seal = RESULT_CUE_MS + FANFARE_CHORD_MS;
    return {
      rows: ranks.map((rank) => Math.max(RESULT_CUE_MS, last - rank * FANFARE_STEP_MS)),
      counts: ranks.map((rank) => (rank === 0 ? COUNT_WINNER_MS : COUNT_MS)),
      seal,
      rest: seal + SEAL_SETTLE_MS,
    };
  }
  const rows = ranks.map((rank) => RESULT_CUE_MS + rank * LAMENT_STEP_MS);
  return {
    rows,
    counts: ranks.map(() => COUNT_MS),
    seal: null,
    rest: Math.max(RESULT_CUE_MS, ...rows) + COUNT_MS,
  };
}

/**
 * Stand einer hochzählenden Zahl `elapsedMs` nach ihrem Beginn: von 0 zum Wert, zum Ende hin
 * langsamer. `null`, sobald der Wert erreicht ist (dann steht nur noch die Zahl selbst da).
 */
export function tallyAt(elapsedMs: number, durationMs: number, value: number): number | null {
  if (value <= 0 || durationMs <= 0 || elapsedMs >= durationMs) return null;
  const progress = Math.max(0, elapsedMs / durationMs);
  return Math.min(value, Math.round(value * (1 - (1 - progress) ** 3)));
}

/** Größe des Siegels in Einheiten der Bühne (`--u`); daran hängen Funken und Ringe. */
export const SEAL_SIZE = 44;

/**
 * Goldene Funken, die beim Aufsetzen des Siegels rundum davonsprühen: dieselben fest gewürfelten
 * Teilchen wie über der Karte (`art/fx`), hier in Einheiten der Bühne statt der Karte.
 */
export function sealSparks(atMs: number): FxParticle[] {
  return fxParticles({
    key: 'result-seal-sparks',
    kind: 'sparks',
    x: 0,
    y: 0,
    size: SEAL_SIZE,
    atMs,
    count: 14,
    power: 1.2,
  });
}

/**
 * Ein Glanzpunkt am Siegel: Ort in Einheiten seiner Zeichnung (Mitte der Krone bei 0 0, Bildfeld
 * -60 -52 120 96), Größe in `--u`, Beginn nach dem Aufsetzen.
 */
export interface SealGlint {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly afterMs: number;
  readonly durationMs: number;
  readonly rot: number;
}

/**
 * Glanzpunkte, die nach dem Aufsetzen nacheinander an Krone und Kranz aufblitzen: von Hand
 * gesetzt, damit sie auf Gold sitzen und keinen Text treffen. Der letzte ist verglommen, bevor
 * die Strahlen stehen.
 */
export const SEAL_GLINTS: readonly SealGlint[] = [
  { x: 0, y: -28, size: 20, afterMs: 60, durationMs: 520, rot: 0 },
  { x: -21, y: -18, size: 12, afterMs: 200, durationMs: 460, rot: 20 },
  { x: 22, y: -17, size: 13, afterMs: 320, durationMs: 480, rot: -15 },
  { x: -36, y: 6, size: 11, afterMs: 450, durationMs: 460, rot: 30 },
  { x: 37, y: 2, size: 12, afterMs: 580, durationMs: 480, rot: 10 },
  { x: 8, y: -7, size: 15, afterMs: 720, durationMs: 520, rot: -25 },
];
