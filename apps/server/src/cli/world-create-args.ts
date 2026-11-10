/**
 * Argumente von `pnpm world:create` (eigenes Modul, damit Tests sie prüfen können, ohne das
 * Werkzeug zu starten). Ergebnis: die erkannten Werte oder das erste ungültige Argument.
 */
const FLAGS = new Set(['--production-approved']);
const OPTIONS = new Set(['--slug', '--seed', '--capacity']);

export const WORLD_CREATE_USAGE =
  'erlaubt: --slug=…, --seed=…, --capacity=…, --production-approved';

export function parseWorldCreateArgs(argv: readonly string[]): Map<string, string> | string {
  const result = new Map<string, string>();
  for (const arg of argv) {
    if (FLAGS.has(arg)) {
      result.set(arg, 'true');
      continue;
    }
    // am ersten „=“ trennen: „--slug=a=b“ ergibt den Wert „a=b“ (den die Weltanlage dann prüft)
    const separator = arg.indexOf('=');
    if (separator <= 0) return arg;
    const name = arg.slice(0, separator);
    const value = arg.slice(separator + 1);
    if (!OPTIONS.has(name) || value === '' || result.has(name)) return arg;
    result.set(name, value);
  }
  return result;
}
