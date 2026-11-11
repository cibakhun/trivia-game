/**
 * Holt die Wikidata-Abfragen (`tools/content/wikidata/queries/*.rq`) vom öffentlichen
 * SPARQL-Endpunkt und speichert je Abfrage einen Datenstand unter `content/wikidata/<name>.json`.
 * Wikidata steht unter CC0 (gemeinfrei); die Fragen formuliert der Generator selbst
 * (docs/QUIZ_ENGINE.md §9.1).
 *
 * Bewusst ohne Abhängigkeiten außer Node: Das Skript läuft auch außerhalb des Workspace mit
 * `node fetch.ts` (Node ≥ 22.18 entfernt die Typen selbst), etwa auf einem Rechner, dessen Netz
 * Wikidata erreicht.
 *
 * Aufruf: `node tools/content/src/wikidata/fetch.ts [--only=name1,name2] [--queries=DIR] [--out=DIR]`
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://query.wikidata.org/sparql';
/** Allgemeine Kennung ohne Personen- oder Projektdaten. */
const USER_AGENT = 'quiz-content-generator/0.1 (Node.js; one-off batch, few requests)';
const TIMEOUT_MS = 90_000;
const PAUSE_MS = 2_000;

export interface Snapshot {
  readonly name: string;
  readonly fetchedAt: string;
  readonly endpoint: string;
  readonly license: string;
  readonly query: string;
  readonly rowCount: number;
  readonly rows: readonly Record<string, string>[];
}

interface SparqlBinding {
  readonly type: string;
  readonly value: string;
}
interface SparqlResult {
  readonly head: { readonly vars: readonly string[] };
  readonly results: { readonly bindings: readonly Record<string, SparqlBinding>[] };
}

const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';

/** Flacht eine SPARQL-Zeile ab: Entitäten als Q-Nummer, alles andere als Zeichenkette. */
export function flattenBinding(binding: Record<string, SparqlBinding>): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [key, cell] of Object.entries(binding)) {
    row[key] =
      cell.type === 'uri' && cell.value.startsWith(ENTITY_PREFIX) ? cell.value.slice(ENTITY_PREFIX.length) : cell.value;
  }
  return row;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runQuery(query: string): Promise<SparqlResult> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({ query }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return (await response.json()) as SparqlResult;
    const retryable = response.status === 429 || response.status >= 500;
    const text = (await response.text()).slice(0, 600);
    if (!retryable || attempt >= 2) throw new Error(`HTTP ${response.status}: ${text}`);
    const retryAfter = Number(response.headers.get('retry-after')) || 30;
    await sleep(retryAfter * 1000);
  }
}

function parseArgs(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z]+)=(.*)$/.exec(arg);
    if (!match?.[1] || match[2] === undefined) throw new Error(`Unbekanntes Argument: ${arg}`);
    args.set(match[1], match[2]);
  }
  return args;
}

async function main(): Promise<number> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2));
  const queriesDir = path.resolve(args.get('queries') ?? path.join(here, '../../wikidata/queries'));
  const outDir = path.resolve(args.get('out') ?? path.join(here, '../../../../content/wikidata'));
  const only = args.get('only')?.split(',').filter(Boolean);

  const files = (await readdir(queriesDir)).filter((f) => f.endsWith('.rq')).sort();
  const names = files.map((f) => f.slice(0, -3)).filter((n) => !only || only.includes(n));
  if (names.length === 0) throw new Error(`Keine Abfragen gefunden in ${queriesDir}`);
  await mkdir(outDir, { recursive: true });

  let failed = 0;
  for (const [index, name] of names.entries()) {
    if (index > 0) await sleep(PAUSE_MS);
    const query = await readFile(path.join(queriesDir, `${name}.rq`), 'utf8');
    const started = Date.now();
    try {
      const result = await runQuery(query);
      const rows = result.results.bindings.map(flattenBinding);
      const snapshot: Snapshot = {
        name,
        fetchedAt: new Date().toISOString(),
        endpoint: ENDPOINT,
        license: 'CC0 1.0 (Wikidata, https://www.wikidata.org/wiki/Wikidata:Licensing)',
        query,
        rowCount: rows.length,
        rows,
      };
      await writeFile(path.join(outDir, `${name}.json`), `${JSON.stringify(snapshot, null, 1)}\n`, 'utf8');
      console.log(`ok     ${name}: ${rows.length} Zeilen in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (err) {
      failed++;
      console.log(`FEHLER ${name}: ${(err as Error).message}`);
    }
  }
  console.log(`${names.length - failed} von ${names.length} Abfragen gespeichert in ${outDir}`);
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error((err as Error).message);
      process.exit(2);
    },
  );
}
