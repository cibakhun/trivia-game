import { z } from 'zod';

/** Unterstützte Sprachen (Brief §5.5). */
export const LOCALES = ['de', 'hu', 'en'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;
