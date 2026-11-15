import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { QuestionFile } from './schema.ts';

/**
 * Freigabe nach dokumentierter Prüfung durch Claude (ADR-072, Entscheidung des Product Owners
 * 2026-11-13): Eine Frage, deren Fakten Claude gegen eine zweite Quelle (den Artikel der deutschen
 * Wikipedia) geprüft und deren Text Claude gelesen hat, wird `APPROVED`. Die Prüfung steht als
 * FACT- und LANGUAGE-Eintrag mit Prüfer „Claude“ und der Methode in der Datei. Vor einem
 * öffentlichen Start folgt eine menschliche Stichprobe.
 *
 * Die Freigabeliste ist eine JSON-Datei `{ "<Schlüssel>": { "date", "fact", "lang", "prompt", "answer" } }`.
 * Fragetext und richtige Antwort stehen mit darin, damit eine Freigabe nicht stillschweigend
 * für eine geänderte Frage gilt (etwa nach einem neuen Datenabruf): Weicht eins ab, scheitert sie.
 */

export const CLAUDE_REVIEWER = 'Claude';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als JJJJ-MM-TT');

export const approvalEntrySchema = z
  .object({
    date: isoDate,
    /** Wie die Fakten geprüft wurden (Quelle, Abweichung). */
    fact: z.string().trim().min(10),
    /** Wie Text und falsche Antworten geprüft wurden. */
    lang: z.string().trim().min(10),
    /** Der geprüfte Fragetext (Deutsch). */
    prompt: z.string().min(1),
    /** Die geprüfte richtige Antwort: Text der Option oder Schätzwert. */
    answer: z.string().min(1),
  })
  .strict();

export const approvalListSchema = z.record(z.string().min(1), approvalEntrySchema);

export type ApprovalEntry = z.infer<typeof approvalEntrySchema>;
export type ApprovalList = Readonly<Record<string, ApprovalEntry>>;

export async function readApprovalList(file: string): Promise<ApprovalList> {
  return approvalListSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

/** Die richtige Antwort so, wie sie in der Freigabeliste steht. */
export function answerOf(question: QuestionFile): string {
  if (question.kind === 'ESTIMATE') return question.estimate?.answer_value ?? '';
  const correct = question.trivia?.correct;
  return (correct && question.translations.de?.options?.[correct]) ?? '';
}

/**
 * Setzt Status, Übersetzung und die beiden Prüfungen; alles andere bleibt, wie es ist. Wirft,
 * wenn Fragetext oder Antwort nicht mehr dem Geprüften entsprechen.
 */
export function approve(question: QuestionFile, entry: ApprovalEntry): QuestionFile {
  const de = question.translations.de;
  if (!de) throw new Error(`${question.key}: Freigabe ohne deutschen Text`);
  if (de.prompt !== entry.prompt) throw new Error(`${question.key}: Fragetext weicht vom geprüften ab`);
  if (answerOf(question) !== entry.answer) {
    throw new Error(`${question.key}: Antwort „${answerOf(question)}“ statt geprüft „${entry.answer}“`);
  }
  return {
    ...question,
    status: 'APPROVED',
    reviews: [
      { kind: 'FACT', reviewer: CLAUDE_REVIEWER, date: entry.date, note: entry.fact },
      { kind: 'LANGUAGE', locale: 'de', reviewer: CLAUDE_REVIEWER, date: entry.date, note: entry.lang },
    ],
    translations: { ...question.translations, de: { ...de, status: 'APPROVED' } },
  };
}
