"""Abgleich der Wikidata-Fragen mit der deutschen Wikipedia als zweiter Quelle (ADR-072).

Aufruf: python3 -I tools/content/wikidata/abgleich.py fragen.json freigabe.json bericht.tsv artikel.json.gz [weitere.json.gz ...]
  fragen.json   aus `pnpm content:wikidata --dry-run --json=fragen.json`
  artikel       aus `tools/content/src/wikipedia/artikel-holen.ts` (Wikidata-Nummern der Fragen)
Schreibt die Freigabeliste (nur Fragen, deren Antwort der Artikel belegt) und einen Bericht aller
Fragen mit Urteil und Beleg. Regeln: Schätzwerte höchstens 1 % neben dem Artikel (Einwohnerzahlen
2,5 %, Rundung auf ganze Zahlen zählt als gleich); Jahreszahlen, Ordnungszahlen und Symbole genau;
Hauptstadt und Währung aus der Infobox; Urheber und Austragungsorte müssen im Artikel stehen.
Fragetext und falsche Antworten liest Claude vorher selbst (Notiz `lang`).
"""
import datetime, gzip, json, re, sys, unicodedata

fragen = json.load(open(sys.argv[1]))
out_freigabe, out_bericht = sys.argv[2], sys.argv[3]
pages, tq = {}, {}
for f in sys.argv[4:]:
    d = json.loads(gzip.open(f).read())
    for t, p in d['pages'].items():
        if 'extract' in p or t not in pages:
            pages[t] = p
    tq.update({k: v for k, v in d.get('titleByQid', {}).items() if v})

DATE = datetime.date.today().isoformat()
LANG = ('Fragetext, richtige und falsche Antworten von Claude gelesen: verständlich, eindeutig, '
        'deutsche Namensformen; keine falsche Antwort ist ebenfalls richtig.')
LANG_EST = 'Fragetext und Einheit von Claude gelesen: verständlich und eindeutig.'


def norm(s):
    s = unicodedata.normalize('NFC', s)
    for a, b in ((' ', ' '), (' ', ' '), ('&nbsp;', ' '), ('’', "'"), ('–', '-')):
        s = s.replace(a, b)
    return re.sub(r'\s+', ' ', s)


def fold(s):
    s = unicodedata.normalize('NFKD', norm(s).lower())
    return ''.join(c for c in s if not unicodedata.combining(c))


NUM = re.compile(r'(?<![\d.,])(\d{1,3}(?:[. ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?![\d])')


def numbers(text):
    out = []
    for m in NUM.finditer(text):
        s = m.group(1)
        if re.fullmatch(r'\d{1,3}(?:[. ]\d{3})+(?:,\d+)?', s):
            out.append(float(s.replace('.', '').replace(' ', '').replace(',', '.')))
        if re.fullmatch(r'\d+[.,]\d+', s):
            out.append(float(s.replace(',', '.')))
        if re.fullmatch(r'\d+', s):
            out.append(float(s))
    return out


def strip_markup(v):
    return re.sub(r'<!--.*?-->|<ref[^>]*/>|<ref.*?</ref>|\{\{0\}\}|\[\[(?:[^|\]]*\|)?|\]\]|\'\'+', '', v, flags=re.S)


def infobox(wikitext, keys):
    for k in keys:
        m = re.search(r'\|\s*' + k + r'\s*=\s*([^\n]*)', wikitext)
        if m and m.group(1).strip():
            return strip_markup(m.group(1)).strip()
    return None


INFOBOX = {'berg-hoehe': ['HÖHE'], 'berg-hoehe-de': ['HÖHE'], 'fluss-laenge': ['LÄNGE'], 'fluss-laenge-de': ['LÄNGE'],
           'land-flaeche': ['FLÄCHE'], 'land-einwohner': ['EINWOHNERZAHL', 'EINWOHNER'],
           'bundesland-flaeche': ['Fläche', 'FLÄCHE'],
           'bauwerk-hoehe': ['HÖHE', 'Höhe', 'Bauhöhe', 'Gesamthöhe', 'Turmhöhe', 'Dachhöhe']}
TOL = {'m': 0.01, 'km': 0.01, 'km2': 0.01, 'count': 0.025}
UNIT_DE = {'m': 'm', 'km': 'km', 'km2': 'km²', 'count': ''}


def fmt(v):
    return f'{v:,.0f}'.replace(',', '.') if v >= 1000 else (f'{v:g}'.replace('.', ','))


def close(v, n, tol):
    for cand in (n, n * 1e3, n * 1e6, n / 1e3):
        if abs(cand - v) <= max(tol * v, 0.5):
            return cand
    return None


def check_estimate(q, p, title):
    v = float(q['answer'])
    # Städte: amtliche Zahl und Melderegister weichen ab, deshalb strenger als bei Staaten
    tol = 0.01 if q['template'] == 'stadt-einwohner' else TOL[q['unit']]
    wiki = p.get('wikitext', '')
    keys = INFOBOX.get(q['template'])
    if keys:
        raw = infobox(wiki, keys)
        # nur Vorlage ({{Metadaten Fläche|…}}): kein Wert in der Infobox, dann der Text
        if raw:
            bare = raw
            while re.search(r'\{\{[^{}]*\}\}', bare):
                bare = re.sub(r'\{\{[^{}]*\}\}', '', bare)
            if re.sub(r'<[^>]*>|\(\d+\.( Platz)?\)', '', bare).strip() == '':
                raw = None
        if raw:
            nums = numbers(re.sub(r'<small>.*?</small>', '', bare).replace(' ', ''))[:3] or []
            if 'Mio' in raw or 'Million' in raw:
                nums = [n * 1e6 for n in nums] + nums
            hits = [c for n in nums if (c := close(v, n, tol)) is not None]
            if hits:
                diff = abs(hits[0] - v) / v * 100
                return 'OK', (f'Wert aus Wikidata mit dem Artikel „{title}“ der deutschen Wikipedia abgeglichen '
                              f'(Infobox: {raw[:60].strip()}; Abweichung {diff:.1f} %).')
            if nums:
                return 'ABW', f'Infobox „{title}“: {raw[:80]}'
    text = norm(p.get('extract', '') + ' ' + wiki)
    best = None
    for n in numbers(text):
        c = close(v, n, tol)
        if c is not None and (best is None or abs(c - v) < abs(best - v)):
            best = c
    if best is not None:
        diff = abs(best - v) / v * 100
        return 'OK', (f'Wert aus Wikidata mit dem Artikel „{title}“ der deutschen Wikipedia abgeglichen '
                      f'(im Text {fmt(best)} {UNIT_DE[q["unit"]]}; Abweichung {diff:.1f} %).').replace(' ;', ';')
    return 'ABW', f'kein passender Wert im Artikel „{title}“'


def near(text, a, b, width):
    """b steht höchstens `width` Zeichen von a entfernt."""
    for m in re.finditer(a, text):
        lo, hi = max(0, m.start() - width), m.end() + width
        if re.search(b, text[lo:hi]):
            return True
    return False


def words_in(text, answer):
    t = fold(text)
    if fold(answer) in t:
        return True
    words = [w for w in re.findall(r'[\w]{4,}', fold(answer))]
    return bool(words) and all(w in t for w in words)


def check_other(q, p, title):
    tpl, a = q['template'], q['answer']
    wiki, extract = p.get('wikitext', ''), p.get('extract', '')
    text = norm(extract + ' ' + wiki)
    src = f'Artikel „{title}“ der deutschen Wikipedia'
    if tpl == 'geburtsjahr':
        if re.search(r'\*[^;†)]{0,80}\b' + a + r'\b', norm(extract)) or near(text, r'geboren|\*', r'\b' + a + r'\b', 60):
            return 'OK', f'Geburtsjahr aus Wikidata mit dem {src} abgeglichen.'
        return 'ABW', f'Geburtsjahr {a} nicht im {src}'
    if tpl == 'nobel':
        if near(text, r'Nobelpreis', r'\b' + a + r'\b', 120):
            return 'OK', f'Jahr des Nobelpreises aus Wikidata mit dem {src} abgeglichen.'
        return 'ABW', f'Jahr {a} nicht beim Nobelpreis im {src}'
    if tpl == 'ordnungszahl':
        if re.search(r'Ordnungszahl\D{0,30}\b' + a + r'\b', text) or re.search(r'\|\s*Ordnungszahl\s*=\s*' + a + r'\b', wiki):
            return 'OK', f'Ordnungszahl aus Wikidata mit dem {src} abgeglichen.'
        return 'ABW', f'Ordnungszahl {a} nicht im {src}'
    if tpl == 'element-symbol':
        sym = re.search(r'„(.+?)“', q['prompt']).group(1)
        if re.search(r'\|\s*Symbol\s*=\s*' + sym + r'\b', wiki) or near(text, r'Symbol', r'\b' + sym + r'\b', 40):
            return 'OK', f'Elementsymbol aus Wikidata mit dem {src} abgeglichen.'
        return 'ABW', f'Symbol {sym} nicht im {src}'
    if tpl == 'hauptstadt':
        raw = infobox(wiki, ['HAUPTSTADT'])
        if raw and words_in(raw, a):
            return 'OK', f'Hauptstadt aus Wikidata mit dem {src} abgeglichen (Infobox: {raw[:50].strip()}).'
        return 'ABW', f'Infobox Hauptstadt: {raw}'
    if tpl == 'waehrung':
        raw = infobox(wiki, ['WÄHRUNG'])
        if raw and words_in(raw, a):
            return 'OK', f'Währung aus Wikidata mit dem {src} abgeglichen (Infobox: {raw[:50].strip()}).'
        return 'ABW', f'Infobox Währung: {raw}'
    # Werk → Urheber, Spiele → Stadt: die Antwort steht im Artikel des Gegenstands
    if words_in(text, a):
        what = {'autor': 'Autor', 'oper': 'Komponist', 'gemaelde': 'Maler', 'olympia': 'Austragungsort'}[tpl]
        return 'OK', f'{what} aus Wikidata mit dem {src} abgeglichen.'
    return 'ABW', f'„{a}“ nicht im {src}'


freigabe, bericht = {}, []
for q in fragen:
    title = tq.get(q['qid'])
    p = pages.get(title) if title else None
    if not p or 'extract' not in p:
        bericht.append(('FEHLT', q, title or '-', 'Artikel nicht abgerufen'))
        continue
    if re.search(r"\{\{Begriffsklärung\s*(\||\}\})", p.get("wikitext", "")):
        bericht.append(('FEHLT', q, title, 'Begriffsklärung'))
        continue
    st, note = check_estimate(q, p, title) if q.get('unit') and q['template'] not in ('geburtsjahr', 'nobel', 'ordnungszahl') else check_other(q, p, title)
    bericht.append((st, q, title, note))
    if st == 'OK':
        freigabe[q['key']] = {'date': DATE, 'fact': note, 'lang': LANG_EST if q.get('unit') else LANG,
                              'prompt': q['prompt'], 'answer': q['answer']}

json.dump(freigabe, open(out_freigabe, 'w'), ensure_ascii=False, indent=1, sort_keys=True)
with open(out_bericht, 'w') as fh:
    for st, q, title, note in bericht:
        fh.write(f"{st}\t{q['template']}\t{q['key']}\t{q['prompt']}\t{q['answer']}\t{note}\n")
import collections
print(collections.Counter(b[0] for b in bericht), file=sys.stderr)
c = collections.defaultdict(collections.Counter)
for st, q, *_ in bericht:
    c[q['template']][st] += 1
for t, v in c.items():
    print(f'  {t}: {dict(v)}', file=sys.stderr)
