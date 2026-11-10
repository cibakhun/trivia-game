import { z } from 'zod';

/**
 * Spielsprache: nur Deutsch (PO-Entscheidung 2026-11-09, ADR-023; der Brief sah de/hu/en vor).
 * Daten und Schnittstellen behalten die Sprachkennung, damit eine weitere Sprache später ohne
 * Umbau ergänzt werden kann.
 */
export const LOCALES = ['de'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;
export const DEFAULT_LOCALE: Locale = 'de';
