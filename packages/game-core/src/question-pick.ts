import { DIFFICULTY_CLASS_B, difficultyClass, type DifficultyClass } from './npc.ts';
import type { Rng } from './rng.ts';

/**
 * Fragenauswahl (docs/QUIZ_ENGINE.md §5) aus dem Zufallsstrom `question-pick`. Die Werte sind
 * Startwerte [E] für den Prototyp; die Expositionsbegrenzung (§5 Punkt 5) kommt mit den
 * Fragenstatistiken.
 */

const DAY_MS = 86_400_000;

/** Ausschlussfenster „schon gesehen“ in Tagen; danach die am längsten nicht gesehene Frage. */
export const QUESTION_EXCLUSION_WINDOWS_DAYS = [90, 30, 7] as const;

/** Wie viele der zuletzt gestellten Kategorien abgewertet werden. */
export const RECENT_CATEGORY_COUNT = 3;
/** Gewicht einer zuletzt gestellten Kategorie (sonst 1). */
export const RECENT_CATEGORY_WEIGHT = 0.4;

export type DifficultyWeights = Readonly<Record<DifficultyClass, number>>;

const DIFFICULTY_CLASSES: readonly DifficultyClass[] = ['EASY', 'MEDIUM', 'HARD'];

/**
 * Zielschwierigkeit aus der Regionsstufe (QUIZ_ENGINE §5.1): Stufe 0–2 überwiegend leicht,
 * 3–6 gemischt, 7–10 überwiegend schwer. Die erste Eroberung (Tutorial, NPC_SYSTEM §4) bekommt
 * nur leichte Fragen, solange es welche gibt.
 */
export function difficultyWeights(tier: number, tutorial = false): DifficultyWeights {
  if (!Number.isInteger(tier) || tier < 0 || tier > 10) {
    throw new RangeError(`Regionsstufe muss 0–10 sein: ${tier}`);
  }
  if (tutorial) return { EASY: 1, MEDIUM: 0, HARD: 0 };
  if (tier <= 2) return { EASY: 0.7, MEDIUM: 0.25, HARD: 0.05 };
  if (tier <= 6) return { EASY: 0.3, MEDIUM: 0.4, HARD: 0.3 };
  return { EASY: 0.05, MEDIUM: 0.25, HARD: 0.7 };
}

/** Erwartete Schwierigkeit `b` der Auswahl; wird mit der Herausforderung gespeichert. */
export function targetDifficulty(weights: DifficultyWeights): number {
  const total = weights.EASY + weights.MEDIUM + weights.HARD;
  if (!(total > 0)) throw new RangeError('Gewichte müssen positiv sein');
  const b =
    (weights.EASY * DIFFICULTY_CLASS_B.EASY +
      weights.MEDIUM * DIFFICULTY_CLASS_B.MEDIUM +
      weights.HARD * DIFFICULTY_CLASS_B.HARD) /
    total;
  return Math.round(b * 1000) / 1000;
}

export interface QuestionCandidate {
  /** ID der Fragenversion (gestellt wird immer eine Version). */
  readonly versionId: string;
  readonly questionId: string;
  readonly category: string;
  /** Redaktionelle Schwierigkeit 1–5. */
  readonly difficulty: number;
  /** Zuletzt einem der menschlichen Beteiligten gezeigt (ms), `null` = nie. */
  readonly lastSeenAt: number | null;
}

export interface QuestionPick {
  readonly candidate: QuestionCandidate;
  /**
   * Genutzte Rückfallstufe: 0–2 = Index in `QUESTION_EXCLUSION_WINDOWS_DAYS`, 3 = alle Fragen
   * kürzlich gesehen, die am längsten nicht gesehene genommen. Jede Stufe > 0 ist eine Metrik.
   */
  readonly fallback: number;
  readonly poolSize: number;
}

export interface PickOptions {
  readonly now: number;
  readonly weights: DifficultyWeights;
  /** Die zuletzt gestellten Kategorien des Angreifers (neueste zuerst). */
  readonly recentCategories: readonly string[];
}

function byVersionId(a: QuestionCandidate, b: QuestionCandidate): number {
  return a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0;
}

/**
 * Wählt eine Frage. Ergebnis hängt nur von der Kandidatenmenge und dem Zufallsstrom ab, nicht von
 * der Reihenfolge der Kandidaten. Verbraucht genau einen Wert des Stroms, wenn gezogen wird.
 *
 * Schwierigkeiten mit Gewicht 0 (Tutorial: nur leicht) scheiden vor den Ausschlussfenstern aus,
 * solange es Fragen der gewünschten Schwierigkeit gibt; die Fenster und der Rückfall auf die am
 * längsten nicht gesehene Frage gelten dann innerhalb dieser Menge. Erst ohne jede passende Frage
 * wird aus allen gewählt (lieber eine andere Schwierigkeit als keine Frage).
 */
export function pickQuestion(
  candidates: readonly QuestionCandidate[],
  options: PickOptions,
  rng: Rng,
): QuestionPick | null {
  if (candidates.length === 0) return null;
  const all = [...candidates].sort(byVersionId);
  const wanted = all.filter((c) => options.weights[difficultyClass(c.difficulty)] > 0);
  const sorted = wanted.length > 0 ? wanted : all;
  for (const [level, days] of QUESTION_EXCLUSION_WINDOWS_DAYS.entries()) {
    const since = options.now - days * DAY_MS;
    const pool = sorted.filter((c) => c.lastSeenAt === null || c.lastSeenAt < since);
    if (pool.length > 0) {
      return {
        candidate: weightedPick(pool, options, rng),
        fallback: level,
        poolSize: pool.length,
      };
    }
  }
  // Alles kürzlich gesehen: die am längsten nicht gesehene Frage, bei Gleichstand die kleinste ID.
  const oldest = sorted.reduce((best, c) =>
    (c.lastSeenAt ?? 0) < (best.lastSeenAt ?? 0) ? c : best,
  );
  return {
    candidate: oldest,
    fallback: QUESTION_EXCLUSION_WINDOWS_DAYS.length,
    poolSize: sorted.length,
  };
}

/**
 * Zweistufig mit einem einzigen Zufallswert: erst die Schwierigkeitsklasse nach ihrem Gewicht
 * (nur Klassen, die im Pool vorkommen), dann die Frage innerhalb der Klasse, wobei zuletzt
 * gestellte Kategorien abgewertet werden. So entspricht die Klassenmischung den Gewichten und
 * damit der gespeicherten Zielschwierigkeit, egal wie viele Fragen eine Klasse hat.
 */
function weightedPick(
  pool: readonly QuestionCandidate[],
  options: PickOptions,
  rng: Rng,
): QuestionCandidate {
  const recent = new Set(options.recentCategories.slice(0, RECENT_CATEGORY_COUNT));
  let u = rng.nextFloat();

  const present = new Set(pool.map((c) => difficultyClass(c.difficulty)));
  const classes = DIFFICULTY_CLASSES.filter((k) => present.has(k) && options.weights[k] > 0);
  let members = pool;
  // Ohne Klasse mit positivem Gewicht entscheidet allein die Kategorie über den ganzen Pool.
  if (classes.length > 0) {
    const total = classes.reduce((sum, k) => sum + options.weights[k], 0);
    let x = u * total;
    let chosen = classes[classes.length - 1] as DifficultyClass;
    let rest = 1 - Number.EPSILON; // Rundungsrest: letzte Klasse, letzte Frage
    for (const k of classes) {
      const w = options.weights[k];
      if (x < w) {
        chosen = k;
        rest = x / w;
        break;
      }
      x -= w;
    }
    u = rest;
    members = pool.filter((c) => difficultyClass(c.difficulty) === chosen);
  }

  const weights = members.map((c) => (recent.has(c.category) ? RECENT_CATEGORY_WEIGHT : 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let y = u * total;
  for (const [i, candidate] of members.entries()) {
    y -= weights[i] ?? 0;
    if (y < 0) return candidate;
  }
  return members[members.length - 1] as QuestionCandidate;
}
