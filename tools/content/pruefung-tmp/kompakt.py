"""Nur vorübergehend im Zweig (wird vor dem Pull Request gelöscht): verdichtet die Prüfberichte,
damit sie als kleine Textdateien vom PC zurückkommen.

Aufruf: python -X utf8 -I kompakt.py bericht-wd.tsv bericht-red.txt staedte-je-staat.json <ausgabeordner>
"""
import base64, gzip, pathlib, sys

wd_in, red_in, staedte, out = sys.argv[1:5]
o = pathlib.Path(out)
o.mkdir(parents=True, exist_ok=True)

with open(wd_in, encoding='utf-8') as f, open(o / 'wd-kurz.tsv', 'w', encoding='utf-8') as g:
    for line in f:
        st, _tpl, key, _prompt, _answer, note = line.rstrip('\n').split('\t')
        g.write(f'{key}\t{st}\t{note}\n')

lines = open(red_in, encoding='utf-8').read().split('\n')
with open(o / 'red-kurz.txt', 'w', encoding='utf-8') as g:
    for i in range(0, len(lines) - 1, 2):
        head, snippet = lines[i], lines[i + 1]
        parts = head.split('\t')
        if parts[0] == 'OK':
            g.write(f'OK\t{parts[1]}\t{parts[3] if len(parts) > 3 else ""}\n')
        else:
            g.write(head + '\n' + snippet + '\n')

raw = gzip.compress(open(staedte, 'rb').read(), 9)
text = base64.b64encode(raw).decode('ascii')
with open(o / 'staedte.b64.txt', 'w', encoding='ascii') as g:
    for i in range(0, len(text), 100):
        g.write(text[i:i + 100] + '\n')
print('fertig:', o)
