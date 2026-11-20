import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyColorScheme, NIGHT_MAP_ENABLED } from '../src/color-scheme.ts';

const WEB = join(import.meta.dirname, '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

/** Inhalt jedes `@media (prefers-color-scheme: dark) { … }`, Klammern mitgezählt. */
function darkBlocks(css: string): string[] {
  const blocks: string[] = [];
  const head = /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{/g;
  for (let match = head.exec(css); match; match = head.exec(css)) {
    let depth = 1;
    let i = head.lastIndex;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    blocks.push(css.slice(head.lastIndex, i - 1));
  }
  return blocks;
}

/** Selektoren der obersten Regeln eines Blocks. */
function selectorsOf(block: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < block.length; i++) {
    if (block[i] === '{') {
      if (depth === 0)
        out.push(
          block
            .slice(start, i)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .trim(),
        );
      depth++;
    } else if (block[i] === '}') {
      depth--;
      if (depth === 0) start = i + 1;
    }
  }
  return out;
}

/** Ein Dokument, das nur festhält, was gesetzt wird. */
function fakeDocument() {
  const dataset: Record<string, string> = {};
  const meta = { content: 'only light' };
  const doc = {
    documentElement: { dataset },
    querySelector: (selector: string) =>
      selector === 'meta[name="color-scheme"]'
        ? {
            setAttribute: (name: string, value: string) => {
              if (name === 'content') meta.content = value;
            },
          }
        : null,
  } as unknown as Document;
  return { doc, dataset, meta };
}

describe('Nur Tagkarte (ADR-073)', () => {
  it('ist abgeschaltet und lässt die Seite beim Start unberührt', () => {
    expect(NIGHT_MAP_ENABLED).toBe(false);
    const { doc, dataset, meta } = fakeDocument();
    applyColorScheme(doc);
    expect(dataset).toEqual({});
    expect(meta.content).toBe('only light');
  });

  it('folgt eingeschaltet wieder dem dunklen Systemmodus', () => {
    const { doc, dataset, meta } = fakeDocument();
    applyColorScheme(doc, true);
    expect(dataset).toEqual({ night: 'auto' });
    expect(meta.content).toBe('light dark');
  });

  it('meldet dem Browser nur hell, auch gegen erzwungene Abdunklung', () => {
    const html = readFileSync(join(WEB, 'index.html'), 'utf8');
    expect(html).toMatch(/<meta name="color-scheme" content="only light" \/>/);
    const theme = readFileSync(join(WEB, 'src', 'theme.css'), 'utf8');
    expect(theme).toMatch(/:root \{[^}]*color-scheme: only light;/);
  });

  it('hält die Farben der Nacht vorrätig, aber nur unter data-night="auto"', () => {
    const files = cssFiles(join(WEB, 'src'));
    const selectors = files.flatMap((file) =>
      darkBlocks(readFileSync(file, 'utf8')).flatMap(selectorsOf),
    );
    // Die Nachtkarte ist nicht gelöscht: Papier und Hintergrund der Nacht stehen noch da
    expect(selectors).toEqual([":root[data-night='auto']", "html[data-night='auto']"]);
  });
});
