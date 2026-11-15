/**
 * Holt Artikel der deutschen Wikipedia (Klartext und Wikitext) als zweite Quelle für die
 * Faktenprüfung (ADR-072). Nur lesend; das Ergebnis dient dem Abgleich und gehört nicht ins Repo
 * (Wikipedia-Texte stehen unter CC BY-SA, docs/ASSETS.md).
 *
 * Bewusst ohne Abhängigkeiten außer Node (≥ 22.18 entfernt die Typen selbst), damit es auf einem
 * Rechner läuft, dessen Netz Wikipedia erreicht. Langsam, damit Wikipedia nicht mit „zu viele
 * Anfragen“ (HTTP 429) antwortet; dann wartet es länger und versucht es erneut.
 *
 * Aufruf: `node tools/content/src/wikipedia/artikel-holen.ts <eingabe.json> <ausgabe.json.gz> [--pause=MS]`
 * eingabe.json: `[{ "qid": "Q64" } | { "title": "Berliner Mauer" }, …]` (Wikidata-Nummern werden
 * über die Sprachlinks in Titel übersetzt). Ausgabe: `{ fetchedAt, titleByQid, pages }` mit gzip.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

/** Allgemeine Kennung ohne Personen- oder Projektdaten. */
const USER_AGENT = 'quiz-fact-check/0.1 (Node.js; read-only, low volume)';

interface Item {
  readonly qid?: string;
  readonly title?: string;
}

export interface Page {
  readonly error?: string;
  readonly missing?: boolean;
  readonly title?: string;
  readonly pageid?: number;
  readonly qid?: string | null;
  readonly revid?: number | null;
  readonly timestamp?: string | null;
  readonly extract?: string;
  readonly wikitext?: string;
}

interface ApiPage {
  readonly title: string;
  readonly pageid: number;
  readonly missing?: boolean;
  readonly extract?: string;
  readonly pageprops?: { readonly wikibase_item?: string };
  readonly revisions?: readonly {
    readonly revid: number;
    readonly timestamp: string;
    readonly slots?: { readonly main?: { readonly content?: string } };
  }[];
}

interface ApiResponse {
  readonly error?: unknown;
  readonly entities?: Readonly<Record<string, { readonly sitelinks?: { readonly dewiki?: { readonly title: string } } }>>;
  readonly query?: { readonly pages?: readonly ApiPage[] };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(host: string, params: Record<string, string>): Promise<ApiResponse> {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      if (res.status === 429) {
        if (attempt >= 8) return { error: 'HTTP 429' };
        await sleep(Number(res.headers.get('retry-after')) * 1000 || 15_000 * attempt);
        continue;
      }
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return (await res.json()) as ApiResponse;
    } catch (error) {
      if (attempt >= 5) return { error: String(error) };
      await sleep(3000 * attempt);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [inFile, outFile] = args.filter((a) => !a.startsWith('--'));
  if (!inFile || !outFile) throw new Error('Aufruf: artikel-holen.ts <eingabe.json> <ausgabe.json.gz> [--pause=MS]');
  const pause = Number(args.find((a) => a.startsWith('--pause='))?.slice('--pause='.length)) || 400;
  const items = JSON.parse(await readFile(inFile, 'utf8')) as Item[];

  // 1) Wikidata-Nummer → Titel des deutschen Artikels
  const qids = [...new Set(items.flatMap((i) => (i.qid && !i.title ? [i.qid] : [])))];
  const titleByQid: Record<string, string | null> = {};
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const r = await api('www.wikidata.org', {
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'sitelinks',
      sitefilter: 'dewiki',
    });
    for (const id of batch) titleByQid[id] = r.entities?.[id]?.sitelinks?.dewiki?.title ?? null;
    await sleep(300);
  }
  console.log(`Titel: ${Object.values(titleByQid).filter(Boolean).length} von ${qids.length} Wikidata-Nummern`);

  // 2) Titel → Artikel
  const titles = [...new Set(items.flatMap((i) => i.title ?? (i.qid ? titleByQid[i.qid] : null) ?? []))];
  const pages: Record<string, Page> = {};
  let n = 0;
  for (const title of titles) {
    const r = await api('de.wikipedia.org', {
      action: 'query',
      prop: 'extracts|revisions|pageprops',
      explaintext: '1',
      exsectionformat: 'plain',
      rvprop: 'ids|timestamp|content',
      rvslots: 'main',
      ppprop: 'wikibase_item',
      redirects: '1',
      titles: title,
    });
    const p = r.query?.pages?.[0];
    const revision = p?.revisions?.[0];
    pages[title] = r.error
      ? { error: typeof r.error === 'string' ? r.error : JSON.stringify(r.error) }
      : !p || p.missing
        ? { missing: true }
        : {
            title: p.title,
            pageid: p.pageid,
            qid: p.pageprops?.wikibase_item ?? null,
            revid: revision?.revid ?? null,
            timestamp: revision?.timestamp ?? null,
            extract: p.extract ?? '',
            wikitext: revision?.slots?.main?.content ?? '',
          };
    if (++n % 50 === 0) console.log(`Artikel ${n}/${titles.length}`);
    await sleep(pause);
  }
  const failed = Object.values(pages).filter((p) => p.error ?? p.missing).length;
  await writeFile(outFile, gzipSync(JSON.stringify({ fetchedAt: new Date().toISOString(), titleByQid, pages })));
  console.log(`fertig: ${titles.length} Artikel, ${failed} fehlen oder Fehler -> ${outFile}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
