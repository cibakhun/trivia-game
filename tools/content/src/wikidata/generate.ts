import type { EstimateScaleType, QuestionCategory } from '@rdw/protocol';
import type { QuestionFile } from '../schema.ts';
import { createRng, difficultyFromShare, foldText, qidKey, shuffle, spreadPick, type Row } from './util.ts';

/**
 * Erzeugt Fragenentwürfe aus Wikidata-Datenständen (docs/QUIZ_ENGINE.md §9.1). Wikidata liefert
 * nur Fakten (CC0); Fragetext und falsche Antworten entstehen hier. Alle Entwürfe sind
 * `AI_ASSISTED` und `DRAFT`: Freigeben kann sie erst eine dokumentierte Fakten- und
 * Sprachprüfung (Brief §5.6). Gleiche Datenstände ergeben gleiche Fragen.
 */

export interface SnapshotData {
  readonly name: string;
  readonly fetchedAt: string;
  readonly rows: readonly Row[];
}

/** Ein Fakt für eine Schätzfrage. */
export interface EstimateFact {
  readonly qid: string;
  readonly label: string;
  readonly rank: number;
  readonly value: number;
  /** Stichjahr (Einwohnerzahlen). */
  readonly asOf?: number;
  /** Teil des Schlüssels, wenn ein Gegenstand mehrere Fragen derselben Vorlage trägt. */
  readonly keySuffix?: string;
  readonly context?: string;
}

export interface EstimateTemplate {
  readonly kind: 'ESTIMATE';
  readonly id: string;
  readonly snapshot: string;
  readonly category: QuestionCategory | ((fact: EstimateFact) => QuestionCategory);
  readonly count: number;
  /** Aus wie vielen der bekanntesten Kandidaten gleichmäßig gewählt wird. */
  readonly window: number;
  readonly unit: string;
  readonly unitLabel: string;
  readonly inputMin: number;
  readonly inputMax: number;
  readonly scaleType: EstimateScaleType;
  readonly scale: number;
  readonly extract: (rows: readonly Row[]) => EstimateFact[];
  readonly prompt: (fact: EstimateFact) => string;
  /** Feste Schwierigkeit statt der aus der Bekanntheit (undefined: aus der Bekanntheit). */
  readonly difficulty?: (fact: EstimateFact) => 2 | 3 | 4 | undefined;
}

/** Ein Fakt für eine Auswahlfrage. */
export interface ChoiceFact {
  readonly qid: string;
  readonly label: string;
  readonly rank: number;
  readonly answer: string;
  /** Gruppe für plausible falsche Antworten (z. B. Kontinent). */
  readonly group?: string;
  /** Jahr für plausible falsche Antworten (z. B. Geburtsjahr des Autors). */
  readonly year?: number;
  readonly context?: string;
}

export interface ChoiceTemplate {
  readonly kind: 'TRIVIA';
  readonly id: string;
  readonly snapshot: string;
  readonly category: QuestionCategory;
  readonly count: number;
  readonly window: number;
  readonly extract: (rows: readonly Row[]) => ChoiceFact[];
  readonly prompt: (fact: ChoiceFact) => string;
  /** Kandidaten für falsche Antworten; Standard: andere Antworten derselben Vorlage. */
  readonly distractorPool?: (fact: ChoiceFact, facts: readonly ChoiceFact[], rows: readonly Row[]) => string[];
  /** Feste Schwierigkeit statt der aus der Bekanntheit. */
  readonly difficulty?: (fact: ChoiceFact) => 2 | 3 | 4;
  /** Aus wie vielen der besten Kandidaten die drei falschen Antworten gelost werden (Standard 6). */
  readonly shortlist?: number;
}

export type Template = EstimateTemplate | ChoiceTemplate;

export interface GeneratedQuestion {
  readonly template: string;
  readonly question: QuestionFile;
  readonly sourceLabel: string;
}

const OPTION_KEYS = ['a', 'b', 'c', 'd'] as const;

function accessedDate(snapshot: SnapshotData): string {
  return snapshot.fetchedAt.slice(0, 10);
}

function baseQuestion(
  template: Template,
  key: string,
  category: QuestionCategory,
  difficulty: number,
  qid: string,
  label: string,
  accessed: string,
): Omit<QuestionFile, 'translations'> {
  return {
    schema_version: 1,
    key,
    kind: template.kind,
    category,
    difficulty,
    origin: 'AI_ASSISTED',
    license_note: null,
    status: 'DRAFT',
    tags: ['quelle:wikidata', `vorlage:${template.id}`],
    sources: [{ title: `Wikidata: ${label} (${qid})`, url: `https://www.wikidata.org/wiki/${qid}`, accessed }],
    reviews: [],
  };
}

function formatInteger(value: number): string {
  return String(Math.round(value));
}

export function buildEstimate(
  template: EstimateTemplate,
  fact: EstimateFact,
  difficulty: number,
  accessed: string,
): QuestionFile {
  const key = ['wd', template.id, fact.keySuffix, qidKey(fact.qid)].filter(Boolean).join('-');
  const category = typeof template.category === 'function' ? template.category(fact) : template.category;
  return {
    ...baseQuestion(template, key, category, difficulty, fact.qid, fact.label, accessed),
    estimate: {
      answer_value: formatInteger(fact.value),
      answer_precision: 0,
      answer_unit: template.unit,
      input_min: formatInteger(template.inputMin),
      input_max: formatInteger(template.inputMax),
      scale_type: template.scaleType,
      scale: template.scale,
    },
    translations: { de: { status: 'DRAFT', prompt: template.prompt(fact), unit_label: template.unitLabel } },
  };
}

/**
 * Falsche Antworten: nur aus der gleichen Gruppe, solange sie mindestens drei bietet. Mit Jahr
 * (z. B. Geburtsjahr des Autors) zählt der Jahresabstand, dann die Bekanntheit; ohne Jahr die
 * ähnliche Bekanntheit (Hauptstädte ähnlich bekannter Staaten) oder, mit `keepOrder`, die
 * Reihenfolge des Vorrats. Drei werden aus den `shortlist` besten gelost. Antworten, die sich
 * von der richtigen oder voneinander nur in Akzenten oder Satzzeichen unterscheiden („Som“ und
 * „Soʻm“), fallen weg.
 */
export function pickDistractors(
  fact: ChoiceFact,
  candidates: readonly { answer: string; group?: string; year?: number; rank: number }[],
  rng: () => number,
  options: { shortlist?: number; keepOrder?: boolean } = {},
): string[] | null {
  const seen = new Set<string>([foldText(fact.answer)]);
  const unique: { answer: string; score: number; sameGroup: boolean }[] = [];
  for (const c of candidates) {
    const norm = foldText(c.answer);
    if (norm === '' || seen.has(norm)) continue;
    seen.add(norm);
    let score: number;
    if (fact.year !== undefined) {
      score = (c.year !== undefined ? Math.abs(c.year - fact.year) : 500) + c.rank * 0.01;
    } else {
      score = (options.keepOrder ? c.rank : Math.abs(c.rank - fact.rank)) * 0.01;
    }
    unique.push({ answer: c.answer, score, sameGroup: fact.group === undefined || c.group === fact.group });
  }
  const sameGroup = unique.filter((c) => c.sameGroup);
  const usable = sameGroup.length >= 3 ? sameGroup : unique;
  if (usable.length < 3) return null;
  usable.sort((a, b) => a.score - b.score || a.answer.localeCompare(b.answer, 'de'));
  const shortlist = usable.slice(0, Math.max(3, Math.min(options.shortlist ?? 6, usable.length)));
  return shuffle(shortlist, rng)
    .slice(0, 3)
    .map((c) => c.answer);
}

export function buildChoice(
  template: ChoiceTemplate,
  fact: ChoiceFact,
  distractors: readonly string[],
  difficulty: number,
  accessed: string,
): QuestionFile {
  const key = ['wd', template.id, qidKey(fact.qid)].join('-');
  const rng = createRng(`${key}:order`);
  const texts = shuffle([fact.answer, ...distractors.slice(0, 3)], rng);
  const options: Record<string, string> = {};
  let correct = 'a';
  texts.forEach((text, i) => {
    const optionKey = OPTION_KEYS[i] ?? 'a';
    options[optionKey] = text;
    if (text === fact.answer) correct = optionKey;
  });
  return {
    ...baseQuestion(template, key, template.category, difficulty, fact.qid, fact.label, accessed),
    trivia: { options: [...OPTION_KEYS], correct },
    translations: { de: { status: 'DRAFT', prompt: template.prompt(fact), options } },
  };
}

function ranked<T extends { rank: number; label: string }>(facts: readonly T[]): T[] {
  return [...facts].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'de'));
}

/** Erzeugt die Fragen einer Vorlage aus ihrem Datenstand. */
export function generateFromTemplate(template: Template, snapshot: SnapshotData): GeneratedQuestion[] {
  const accessed = accessedDate(snapshot);
  if (template.kind === 'ESTIMATE') {
    const facts = ranked(template.extract(snapshot.rows)).filter(
      (f) => f.value >= template.inputMin && f.value <= template.inputMax,
    );
    return spreadPick(facts, template.count, template.window, template.id).map(({ item, share }) => ({
      template: template.id,
      sourceLabel: item.label,
      question: buildEstimate(template, item, template.difficulty?.(item) ?? difficultyFromShare(share), accessed),
    }));
  }
  const facts = ranked(template.extract(snapshot.rows));
  const result: GeneratedQuestion[] = [];
  for (const { item, share } of spreadPick(facts, template.count, template.window, template.id)) {
    const rng = createRng(`wd-${template.id}-${item.qid}:distractors`);
    const pool = template.distractorPool
      ? template.distractorPool(item, facts, snapshot.rows).map((answer, rank) => ({ answer, rank }))
      : facts.filter((f) => f.qid !== item.qid);
    const distractors = pickDistractors(item, pool, rng, {
      ...(template.shortlist !== undefined ? { shortlist: template.shortlist } : {}),
      keepOrder: template.distractorPool !== undefined,
    });
    if (!distractors) continue;
    const difficulty = template.difficulty?.(item) ?? difficultyFromShare(share);
    result.push({
      template: template.id,
      sourceLabel: item.label,
      question: buildChoice(template, item, distractors, difficulty, accessed),
    });
  }
  return result;
}
