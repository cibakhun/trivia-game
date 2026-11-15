#!/usr/bin/env python3
"""Redaktionsfragen: erzeugt die Fragendateien unter content/questions/redaktion/ aus den
kompakten Listen in listen/*.txt (ADR-072). Nur Python-Standardbibliothek.

Aufruf (aus dem Repo-Wurzelordner):
  python3 tools/content/redaktion/build.py stats
  python3 tools/content/redaktion/build.py titel <titel.json>     Artikelliste für den Abruf
  python3 tools/content/redaktion/build.py write [--entwurf-datum=JJJJ-MM-TT]

`write` schreibt alle Fragen neu und löscht Dateien im Zielordner, die in keiner Liste mehr
stehen (der Ordner wird nur von diesem Skript gepflegt). Fragen in freigabe.json werden
`APPROVED` mit den Prüfungen von Claude; die übrigen bleiben `DRAFT`. Eine Freigabe gilt nur
für den geprüften Wortlaut: Weichen Frage oder richtige Antwort ab, bricht `write` ab.

Zeilenformat der Listen (Felder mit | getrennt, # am Zeilenanfang = Kommentar):
T|KAT|stufe|slug|Frage|Richtig|Falsch1;Falsch2;Falsch3|Quelle (Titel dt. Wikipedia)|Prüfwörter (; getrennt, leer = richtige Antwort)
E|KAT|stufe|slug|Frage|Wert|einheit|Einheitentext|min|max|LINEAR/LOG|scale|Quelle|Prüfwörter
"""
import hashlib, json, random, sys, pathlib, urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
LISTS = HERE / 'listen'
APPROVALS = HERE / 'freigabe.json'
TARGET = HERE.parents[2] / 'content' / 'questions' / 'redaktion'

CATS = {'GES': 'HISTORY', 'GEO': 'GEOGRAPHY', 'NAT': 'SCIENCE', 'TEC': 'TECHNOLOGY', 'MAT': 'MATHEMATICS',
        'LIT': 'LITERATURE', 'KUL': 'ARTS_CULTURE', 'SPO': 'SPORTS', 'POL': 'POLITICS_SOCIETY',
        'TIE': 'NATURE_ANIMALS', 'ALL': 'GENERAL'}
PREFIX = {v: k.lower() for k, v in CATS.items()}


def q(s):
    s = str(s)
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def parse(dirpath=LISTS):
    items = []
    for f in sorted(pathlib.Path(dirpath).glob('*.txt')):
        for n, line in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            p = [x.strip() for x in line.split('|')]
            where = f'{f.name}:{n}'
            if p[0] == 'T':
                if len(p) != 9: sys.exit(f'{where}: {len(p)} Felder statt 9: {line}')
                _, cat, d, slug, prompt, right, wrong, src, check = p
                wrong = [w.strip() for w in wrong.split(';')]
                if len(wrong) != 3 or right in wrong or len(set(wrong)) != 3: sys.exit(f'{where}: falsche Antworten: {line}')
                items.append(dict(kind='T', cat=CATS[cat], d=int(d), slug=slug, prompt=prompt, right=right, wrong=wrong,
                                  src=src, check=[c for c in check.split(';') if c] or [right], where=where))
            elif p[0] == 'E':
                if len(p) != 14: sys.exit(f'{where}: {len(p)} Felder statt 14: {line}')
                _, cat, d, slug, prompt, value, unit, label, lo, hi, st, sc, src, check = p
                if not (float(lo) <= float(value) <= float(hi)): sys.exit(f'{where}: Wert außerhalb: {line}')
                items.append(dict(kind='E', cat=CATS[cat], d=int(d), slug=slug, prompt=prompt, value=value, unit=unit,
                                  label=label, lo=lo, hi=hi, st=st, sc=sc, src=src,
                                  check=[c for c in check.split(';') if c] or [value], where=where))
            else:
                sys.exit(f'{where}: unbekannte Art {p[0]}')
    return items


def key_of(it):
    return f"rd-{PREFIX[it['cat']]}-{it['slug']}"


def answer_of(it):
    return it['right'] if it['kind'] == 'T' else it['value']


def to_yaml(it, accessed, approval=None):
    key = key_of(it)
    url = 'https://de.wikipedia.org/wiki/' + urllib.parse.quote(it['src'].replace(' ', '_'), safe='_(),:\'-')
    status = 'APPROVED' if approval else 'DRAFT'
    header = ('# Redaktionell von Claude erstellt (KI-gestützt) für deutsche Spieler; von Claude gegen die genannte '
              'Quelle geprüft und freigegeben (ADR-072), vor dem Start folgt eine Stichprobe.'
              if approval else
              '# Redaktionell von Claude erstellt (KI-gestützt) für deutsche Spieler; Faktenprüfung steht aus.')
    lines = [
        header,
        'schema_version: 1', f'key: {key}', f"kind: {'TRIVIA' if it['kind'] == 'T' else 'ESTIMATE'}",
        f"category: {it['cat']}", f"difficulty: {it['d']}", 'origin: AI_ASSISTED', 'license_note: null',
        f'status: {status}', 'tags:', '  - quelle:redaktion', 'sources:',
        f"  - title: {q('Wikipedia: ' + it['src'])}", f'    url: {url}', f'    accessed: {accessed}',
    ]
    if approval:
        lines += ['reviews:',
                  '  - kind: FACT', '    reviewer: "Claude"', f"    date: {approval['date']}", f"    note: {q(approval['fact'])}",
                  '  - kind: LANGUAGE', '    locale: de', '    reviewer: "Claude"', f"    date: {approval['date']}",
                  f"    note: {q(approval['lang'])}"]
    else:
        lines.append('reviews: []')
    if it['kind'] == 'T':
        # feste, aber je Frage andere Reihenfolge der Antworten
        rng = random.Random(int(hashlib.sha256(key.encode()).hexdigest(), 16))
        texts = [it['right']] + it['wrong']
        rng.shuffle(texts)
        keys = 'abcd'
        correct = keys[texts.index(it['right'])]
        lines += ['trivia:', '  options:', '    - a', '    - b', '    - c', '    - d', f'  correct: {correct}',
                  'translations:', '  de:', f'    status: {status}', f"    prompt: {q(it['prompt'])}", '    options:']
        lines += [f'      {k}: {q(t)}' for k, t in zip(keys, texts)]
    else:
        lines += ['estimate:', f"  answer_value: {q(it['value'])}", '  answer_precision: 0', f"  answer_unit: {it['unit']}",
                  f"  input_min: {q(it['lo'])}", f"  input_max: {q(it['hi'])}", f"  scale_type: {it['st']}", f"  scale: {it['sc']}",
                  'translations:', '  de:', f'    status: {status}', f"    prompt: {q(it['prompt'])}", f"    unit_label: {q(it['label'])}"]
    return key, '\n'.join(lines) + '\n'


def load_approvals():
    if not APPROVALS.exists():
        return {}
    data = json.loads(APPROVALS.read_text(encoding='utf-8'))
    for key, a in data.items():
        missing = {'date', 'fact', 'lang', 'prompt', 'answer'} - set(a)
        if missing: sys.exit(f'freigabe.json, {key}: es fehlt {sorted(missing)}')
    return data


def main():
    items = parse()
    keys = [key_of(i) for i in items]
    dup = {k for k in keys if keys.count(k) > 1}
    if dup: sys.exit(f'doppelte Schlüssel: {dup}')
    prompts = [i['prompt'] for i in items]
    dupp = {p for p in prompts if prompts.count(p) > 1}
    if dupp: sys.exit(f'doppelte Fragen: {dupp}')
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'titel' and len(sys.argv) > 2:
        titles = sorted({i['src'] for i in items})
        pathlib.Path(sys.argv[2]).write_text(json.dumps([{'title': t} for t in titles], ensure_ascii=False), encoding='utf-8')
        print(len(items), 'Fragen,', len(titles), 'Artikel')
    elif cmd == 'stats':
        from collections import Counter
        approvals = load_approvals()
        for cat, n in sorted(Counter(i['cat'] for i in items).items()):
            ok = sum(1 for i in items if i['cat'] == cat and key_of(i) in approvals)
            print(f'{cat:18} {n:4} Fragen, {ok:4} freigegeben')
        print(len(items), 'Fragen insgesamt,', sum(1 for k in keys if k in approvals), 'freigegeben')
    elif cmd == 'write':
        draft_date = next((a.split('=', 1)[1] for a in sys.argv[2:] if a.startswith('--entwurf-datum=')), '2026-11-12')
        approvals = load_approvals()
        unknown = set(approvals) - set(keys)
        if unknown: sys.exit(f'freigabe.json nennt Fragen, die in keiner Liste stehen: {sorted(unknown)}')
        TARGET.mkdir(parents=True, exist_ok=True)
        written = set()
        for it in items:
            key = key_of(it)
            a = approvals.get(key)
            if a and (a['prompt'] != it['prompt'] or a['answer'] != answer_of(it)):
                sys.exit(f'{key} ({it["where"]}): Frage oder Antwort weicht vom Geprüften ab, Freigabe neu prüfen')
            key, text = to_yaml(it, a['date'] if a else draft_date, a)
            (TARGET / f'{key}.yaml').write_text(text, encoding='utf-8')
            written.add(f'{key}.yaml')
        stale = [f for f in TARGET.glob('*.yaml') if f.name not in written]
        for f in stale:
            f.unlink()
        print(f'{len(written)} Dateien nach {TARGET} geschrieben ({sum(1 for k in keys if k in approvals)} freigegeben), '
              f'{len(stale)} alte entfernt')
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
