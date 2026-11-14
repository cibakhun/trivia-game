#!/usr/bin/env python3
"""Prüft die Redaktionsfragen gegen die geholten Wikipedia-Artikel (ADR-072).

Aufruf: python3 -I tools/content/redaktion/pruefen.py <artikel.json.gz> [weitere.json.gz ...] > bericht.txt
Die Artikel holt `tools/content/src/wikipedia/artikel-holen.ts` (Liste aus `build.py titel`); sie liegen nicht im Repo.
Je Frage: Artikel vorhanden? Begriffsklärung? Kommen die Prüfwörter und die richtige Antwort im
Artikel vor? Dazu ein Textausschnitt um das erste Prüfwort, damit ein Mensch (oder Claude) den
Beleg lesen kann. Ergebnis je Zeile: OK, PRÜFEN (Antwort nicht wörtlich gefunden) oder FEHLT.
"""
import gzip, json, re, sys, pathlib, unicodedata
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from build import parse, key_of  # noqa: E402

def norm(s):
    s = unicodedata.normalize('NFC', s).replace(' ', ' ').replace(' ', ' ').replace('&nbsp;', ' ')
    s = s.replace('–', '-').replace('—', '-').replace('’', "'").replace('„', '"').replace('“', '"').replace('”', '"')
    return re.sub(r'\s+', ' ', s).lower()

def variants(word):
    w = norm(word)
    out = {w}
    if re.fullmatch(r'[\d.,]+', w):
        out |= {w.replace('.', ''), w.replace('.', ' '), w.replace('.', ','), w.replace(',', '.')}
        digits = w.replace('.', '')
        if digits.isdigit() and len(digits) > 4:
            out.add(f'{int(digits):,}'.replace(',', '.'))
            out.add(f'{int(digits):,}'.replace(',', ' '))
    return out

def find(text, word):
    for v in variants(word):
        i = text.find(v)
        if i >= 0:
            return i
    return -1

def answer_found(text, answer):
    if find(text, answer) >= 0:
        return True
    words = [w for w in re.findall(r"[\wäöüß.'-]+", norm(answer)) if len(w) >= 4]
    return bool(words) and all(find(text, w) >= 0 for w in words)

pages = {}
for f in sys.argv[1:]:
    data = json.loads(gzip.open(f).read())
    pages.update(data['pages'])

items = parse()
counts = {'OK': 0, 'PRÜFEN': 0, 'FEHLT': 0}
for it in items:
    page = pages.get(it['src'])
    key = key_of(it)
    if not page or page.get('missing') or page.get('error'):
        status, note, snippet = 'FEHLT', f"Artikel „{it['src']}“ nicht gefunden", ''
    else:
        extract = norm(page.get('extract', ''))
        wiki = norm(page.get('wikitext', ''))
        text = extract + ' ' + wiki
        notes = []
        if re.search(r'\{\{begriffsklärung\s*(\||\}\})', wiki):
            notes.append('BEGRIFFSKLÄRUNG')
        missing = [c for c in it['check'] if find(text, c) < 0]
        if missing:
            notes.append('Prüfwort fehlt: ' + '; '.join(missing))
        right = it['right'] if it['kind'] == 'T' else it['value']
        if not answer_found(text, right):
            notes.append(f'Antwort „{right}“ nicht wörtlich')
        status = 'PRÜFEN' if notes else 'OK'
        note = ' | '.join(notes)
        first = next((c for c in it['check'] if find(extract, c) >= 0), None)
        snippet = ''
        if first:
            i = find(extract, first)
            snippet = extract[max(0, i - 160): i + 200]
        elif page.get('extract'):
            snippet = norm(page['extract'])[:240]
        if page.get('title') and page['title'] != it['src']:
            note = (note + ' | ' if note else '') + f"Weiterleitung auf „{page['title']}“"
    counts[status] += 1
    print(f"{status}\t{key}\t{it['prompt']} → {it.get('right', it.get('value'))}\t{note}\n\t…{snippet}…")
print(counts, file=sys.stderr)
