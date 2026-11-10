import type { z } from 'zod';
import { ApiError } from './errors.ts';

/** Prüft Pfad-, Abfrage- oder Körperdaten; Verstöße ergeben `VALIDATION_FAILED` mit Fundstellen. */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Ungültige Anfrage', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
