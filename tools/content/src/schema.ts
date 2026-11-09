import {
  canonicalDecimalSchema,
  difficultySchema,
  estimateScaleTypeSchema,
  LOCALES,
  questionCategorySchema,
  questionKindSchema,
  questionOriginSchema,
  questionVersionStatusSchema,
  translationStatusSchema,
} from '@rdw/protocol';
import { z } from 'zod';

/**
 * Format einer Fragendatei (YAML, eine Frage je Datei, Dateiname = `key`), docs/QUIZ_ENGINE.md
 * §2–4 und §9. Feldnamen folgen den Tabellenspalten aus docs/DATA_MODEL.md §4.6.
 * Zahlen mit Nachkommastellen stehen als Zeichenkette, damit YAML sie nicht als Float liest.
 */

export const QUESTION_FILE_SCHEMA_VERSION = 1;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');
const nonEmpty = z.string().trim().min(1);

export const questionKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Schlüssel: Kleinbuchstaben, Ziffern, Bindestriche')
  .max(80);

export const optionKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,15}$/, 'Optionsschlüssel wie a, b, c');

export const sourceSchema = z
  .object({
    title: nonEmpty,
    url: z.string().url().refine((u) => u.startsWith('https://'), 'Quelle über https'),
    accessed: isoDate,
  })
  .strict();

/** Dokumentierte menschliche Prüfung (Brief §5.6): Fakten oder Sprache (dann mit Sprache). */
export const reviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FACT'), reviewer: nonEmpty, date: isoDate, note: z.string().optional() }).strict(),
  z
    .object({
      kind: z.literal('LANGUAGE'),
      locale: z.enum(LOCALES),
      reviewer: nonEmpty,
      date: isoDate,
      note: z.string().optional(),
    })
    .strict(),
]);

export const translationSchema = z
  .object({
    status: translationStatusSchema,
    prompt: z.string().trim().min(10).max(300),
    /** Nur Trivia: `option_key → Text`. */
    options: z.record(optionKeySchema, z.string().trim().min(1).max(120)).optional(),
    /** Nur Schätzfragen: Einheit in der Sprache („Meter“). */
    unit_label: z.string().trim().min(1).max(40).optional(),
    explanation: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const triviaSchema = z
  .object({
    options: z.array(optionKeySchema).min(4).max(6),
    correct: optionKeySchema,
  })
  .strict();

export const estimateSchema = z
  .object({
    answer_value: canonicalDecimalSchema,
    answer_precision: z.number().int().min(0).max(6),
    answer_unit: z.string().regex(/^[a-z0-9/_]+$/, 'Einheit als Kürzel, z. B. m, km, year, count'),
    input_min: canonicalDecimalSchema,
    input_max: canonicalDecimalSchema,
    scale_type: estimateScaleTypeSchema,
    scale: z.number().positive(),
  })
  .strict();

export const questionFileSchema = z
  .object({
    schema_version: z.literal(QUESTION_FILE_SCHEMA_VERSION),
    key: questionKeySchema,
    kind: questionKindSchema,
    category: questionCategorySchema,
    difficulty: difficultySchema,
    origin: questionOriginSchema,
    license_note: z.string().trim().min(1).nullable().default(null),
    status: questionVersionStatusSchema,
    tags: z.array(z.string().regex(/^[a-z]+(:[A-Za-z0-9_-]+)?$/, 'Tag wie fixture oder region:HU')).default([]),
    sources: z.array(sourceSchema).min(1, 'mindestens eine überprüfbare Quelle (Brief §5.2)'),
    reviews: z.array(reviewSchema).default([]),
    trivia: triviaSchema.optional(),
    estimate: estimateSchema.optional(),
    translations: z.record(z.enum(LOCALES), translationSchema),
  })
  .strict();

export type QuestionFile = z.infer<typeof questionFileSchema>;
