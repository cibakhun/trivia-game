"""Nur vorübergehend im Zweig (wird vor dem Pull Request gelöscht): sucht in den geholten Artikeln
nach Belegen für einzelne Fragen und schreibt kurze Textausschnitte.

Aufruf: python -X utf8 -I suche.py suche.json ausgabe.txt artikel.json.gz [weitere.json.gz ...]
suche.json: [{"key": "...", "titles": ["Titel", ...], "patterns": ["regex", ...]}, ...]
"""
import gzip, json, re, sys, unicodedata

spec_file, out_file = sys.argv[1:3]
pages = {}
for f in sys.argv[3:]:
    for t, p in json.loads(gzip.open(f).read())['pages'].items():
        if 'extract' in p or t not in pages:
            pages[t] = p
by_title = {p['title']: p for p in pages.values() if p.get('title') and 'extract' in p}


def norm(s):
    s = unicodedata.normalize('NFC', s).replace(' ', ' ').replace(' ', ' ').replace('&nbsp;', ' ')
    return re.sub(r'\s+', ' ', s)


with open(out_file, 'w', encoding='utf-8') as out:
    for item in json.load(open(spec_file, encoding='utf-8')):
        out.write(f"=== {item['key']}\n")
        for title in item['titles']:
            p = pages.get(title) or by_title.get(title)
            if not p or 'extract' not in p:
                out.write(f"  [{title}] fehlt\n")
                continue
            wiki = p.get('wikitext', '')
            bkl = bool(re.search(r'\{\{Begriffsklärung\s*(\||\}\})', wiki))
            out.write(f"  [{title}] -> „{p.get('title')}“{' BEGRIFFSKLÄRUNG' if bkl else ''}\n")
            extract, wtext = norm(p.get('extract', '')), norm(wiki)
            for pat in item['patterns']:
                hits = []
                for src, text in (('Text', extract), ('Quelltext', wtext)):
                    for m in re.finditer(pat, text, re.I):
                        hits.append(f"{src}: …{text[max(0, m.start() - 130): m.end() + 130]}…")
                        if len(hits) >= 2:
                            break
                    if hits:
                        break
                out.write(f"    /{pat}/ " + ('\n      '.join(hits) if hits else 'kein Treffer') + '\n')
print('fertig:', out_file)
