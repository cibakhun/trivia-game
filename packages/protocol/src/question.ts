import { z } from 'zod';

/** Fragenarten (docs/QUIZ_ENGINE.md §2–3). */
export const QUESTION_KINDS = ['TRIVIA', 'ESTIMATE'] as const;
export const questionKindSchema = z.enum(QUESTION_KINDS);
export type QuestionKind = z.infer<typeof questionKindSchema>;

/** Die elf Kategorien aus Brief §5.6, als sprachunabhängige Schlüssel. */
export const QUESTION_CATEGORIES = [
  'HISTORY', // Geschichte
  'GEOGRAPHY', // Geografie
  'SCIENCE', // Naturwissenschaften
  'TECHNOLOGY', // Technik
  'MATHEMATICS', // Mathematik
  'LITERATURE', // Literatur
  'ARTS_CULTURE', // Kunst und Kultur
  'SPORTS', // Sport
  'POLITICS_SOCIETY', // Politik und Gesellschaft
  'NATURE_ANIMALS', // Tiere und Natur
  'GENERAL', // Allgemeinwissen
] as const;
export const questionCategorySchema = z.enum(QUESTION_CATEGORIES);
export type QuestionCategory = z.infer<typeof questionCategorySchema>;

/** Herkunft (Brief §5.6): KI-gestützte Fragen sind nur nach menschlicher Prüfung freigebbar. */
export const QUESTION_ORIGINS = ['EDITORIAL', 'AI_ASSISTED', 'LICENSED'] as const;
export const questionOriginSchema = z.enum(QUESTION_ORIGINS);
export type QuestionOrigin = z.infer<typeof questionOriginSchema>;

/** Status einer Fragenversion (`question_versions.status`). */
export const QUESTION_VERSION_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED'] as const;
export const questionVersionStatusSchema = z.enum(QUESTION_VERSION_STATUSES);
export type QuestionVersionStatus = z.infer<typeof questionVersionStatusSchema>;

/** Status einer Übersetzung (`question_translations.status`). */
export const TRANSLATION_STATUSES = ['DRAFT', 'REVIEWED', 'APPROVED'] as const;
export const translationStatusSchema = z.enum(TRANSLATION_STATUSES);
export type TranslationStatus = z.infer<typeof translationStatusSchema>;

/** Skala des NPC-Schätzmodells (docs/NPC_SYSTEM.md §3.2). */
export const ESTIMATE_SCALE_TYPES = ['LINEAR', 'LOG'] as const;
export const estimateScaleTypeSchema = z.enum(ESTIMATE_SCALE_TYPES);
export type EstimateScaleType = z.infer<typeof estimateScaleTypeSchema>;

/** Redaktionelle Schwierigkeit 1 (sehr leicht) bis 5 (sehr schwer). */
export const difficultySchema = z.number().int().min(1).max(5);
export type Difficulty = z.infer<typeof difficultySchema>;
