import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ClientBase } from 'pg';
import { format, resolveConfig } from 'prettier';
import { generateSchemaTypes } from './codegen.ts';

/** Eingecheckter Typ-Stand des Schemas. */
export const SCHEMA_TYPES_FILE = fileURLToPath(new URL('./schema.generated.ts', import.meta.url));

/** Erzeugt die Typen und formatiert sie wie das Repository (Prettier), damit der Vergleich stabil ist. */
export async function renderSchemaTypes(client: ClientBase): Promise<string> {
  const source = await generateSchemaTypes(client);
  const config = (await resolveConfig(SCHEMA_TYPES_FILE)) ?? {};
  return format(source, { ...config, filepath: SCHEMA_TYPES_FILE });
}

export async function readSchemaTypes(): Promise<string> {
  return readFile(SCHEMA_TYPES_FILE, 'utf8');
}
