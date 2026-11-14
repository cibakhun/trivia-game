# Inhalte

| Verzeichnis | Inhalt |
|---|---|
| `questions/` | Fragenbestand für den Spielbetrieb (Beschaffung und Prüfung: [O-02](../docs/DECISIONS.md#offene-entscheidungen), ADR-056, ADR-072) |
| `questions/wikidata/` | Fragen aus Wikidata-Fakten (ADR-056); von Claude gegen die deutsche Wikipedia geprüfte sind `APPROVED` (ADR-072), die übrigen `DRAFT` |
| `questions/redaktion/` | Eigene Fragen von Claude (ADR-072), erzeugt aus `tools/content/redaktion/listen/`; geprüfte `APPROVED`, die übrigen `DRAFT`. Nicht von Hand ändern |
| `wikidata/` | Datenstände der Wikidata-Abfragen (JSON, CC0), aus denen der Generator die Entwürfe erzeugt |
| `fixtures/questions/` | 40 Testfragen (25 Trivia, 15 Schätzung) für Tests und Prototyp – **nie für den Spielbetrieb** |

Prüfen: `pnpm content:validate` (läuft auch in der CI).
Importieren: `pnpm content:import` (Testfragen nur lokal und in Tests mit `--fixtures`; Regeln in [DATA_MODEL.md §4.6](../docs/DATA_MODEL.md#46-quiz) und ADR-026).

## Format

Eine Frage je YAML-Datei, Dateiname = `key`. Feldnamen folgen dem Datenmodell
([QUIZ_ENGINE.md §2–3](../docs/QUIZ_ENGINE.md), [DATA_MODEL.md §4.6](../docs/DATA_MODEL.md#46-quiz)),
das Schema steht in `tools/content/src/schema.ts`.

- `kind`: `TRIVIA` (Abschnitt `trivia` mit mindestens 4 Optionsschlüsseln und genau einer richtigen Option) oder `ESTIMATE` (Abschnitt `estimate`).
- Dezimalwerte (`answer_value`, `input_min`, `input_max`) stehen in Anführungszeichen, z. B. `"9.8"`, damit YAML sie nicht als Gleitkommazahl liest.
- `translations` enthält genau `de` (gespielt wird nur auf Deutsch, ADR-023); bei Trivia die Optionstexte je Schlüssel, bei Schätzfragen `unit_label`. Die Sprachkennung bleibt, damit später eine weitere Sprache ergänzt werden kann.
- `sources`: mindestens eine überprüfbare Quelle über https.
- `reviews`: dokumentierte Prüfungen (`FACT`, `LANGUAGE` je Sprache), von Menschen oder nach ADR-072 von Claude mit zweiter Quelle (`reviewer: Claude`, Methode in `note`).

## Freigaberegel (Brief §5.6)

KI-gestützte Fragen (`origin: AI_ASSISTED`) dürfen nicht ungeprüft veröffentlicht werden. Das Prüfwerkzeug lässt `status: APPROVED` nur zu, wenn eine Faktenprüfung und je Sprache eine Sprachprüfung dokumentiert sind und alle Übersetzungen freigegeben sind. Testfragen unter `fixtures/` tragen den Tag `fixture` und können nie freigegeben werden.

Seit ADR-072 (Product Owner, 2026-11-13) darf Claude diese Prüfung übernehmen, abweichend von Brief §5.6: Die Fakten werden mit dem Artikel der deutschen Wikipedia abgeglichen, Fragetext und falsche Antworten liest Claude selbst. Die Prüfung steht mit `reviewer: Claude` und der Methode in der Datei. Vor einem öffentlichen Start prüft ein Mensch eine Stichprobe. Spielbar sind nur freigegebene Fragen; nach dem Merge braucht die Datenbank `pnpm content:import`.

Die 40 Testfragen sind von Claude entworfen (`AI_ASSISTED`, `DRAFT`). Fakten und Texte sind noch nicht von Menschen geprüft; die Quellen sind Vorschläge, `accessed` ist dort das Entwurfsdatum. Bis zur Entscheidung über O-02 (vertagt, PO 2026-11-09) laufen Phase 1 und ihre Tests mit diesen Fragen.

## Fragen aus Wikidata (ADR-056)

1. `pnpm content:wikidata:fetch` holt die Abfragen aus `tools/content/wikidata/queries/` und speichert je Abfrage `content/wikidata/<name>.json` (braucht Zugang zu `query.wikidata.org`; das Skript läuft auch allein mit `node tools/content/src/wikidata/fetch.ts`).
2. `pnpm content:wikidata` erzeugt daraus die Entwürfe unter `questions/wikidata/`. Vorhandene Dateien bleiben unverändert (`--force` erzeugt sie neu), `--dry-run` prüft nur, `--report=DATEI` schreibt eine Übersicht zum Gegenlesen.
3. Prüfen (ADR-072): `pnpm content:wikidata --dry-run --json=fragen.json` listet alle Fragen; `node tools/content/src/wikipedia/artikel-holen.ts` holt die Artikel zu ihren Wikidata-Nummern (Eingabe `[{"qid": "Q…"}]`, braucht Zugang zu Wikipedia); `python3 -I tools/content/wikidata/abgleich.py fragen.json tools/content/wikidata/freigabe.json bericht.tsv artikel.json.gz` gleicht ab und schreibt die Freigabeliste. Abweichungen im Bericht lesen und in `templates.ts` ausschließen oder mit dem Wert der deutschen Wikipedia setzen, dann wiederholen.
4. `pnpm content:wikidata --force --freigabe=tools/content/wikidata/freigabe.json` schreibt die Dateien; die gelisteten sind freigegeben. Weicht eine Frage vom geprüften Wortlaut ab, bricht der Lauf ab.

## Redaktionsfragen (ADR-072)

Eigene Fragen von Claude für Themen ohne gute Wikidata-Daten (Bräuche, Geschichte, Sport, Technik …). Eine Zeile je Frage in `tools/content/redaktion/listen/*.txt` mit Quelle (Titel in der deutschen Wikipedia) und Prüfwörtern; das Format steht in `build.py`.

1. `python3 tools/content/redaktion/build.py titel titel.json` listet die Artikel, `node tools/content/src/wikipedia/artikel-holen.ts titel.json artikel.json.gz` holt sie.
2. `python3 -I tools/content/redaktion/pruefen.py artikel.json.gz > bericht.txt` sucht Antwort und Prüfwörter im Artikel und zeigt den Beleg; was nicht wörtlich steht, liest Claude nach und entscheidet.
3. Geprüfte Fragen kommen mit Fragetext und Antwort in `tools/content/redaktion/freigabe.json`; `python3 tools/content/redaktion/build.py write` schreibt `questions/redaktion/` neu.

Regeln beim Schreiben: nichts, was sich seit Mitte 2025 ändern konnte (laufende Rekorde, kommende Turniere), keine strittigen „Erfinder“ und „Ersten“, keine Frage verrät die Antwort einer anderen, keine Doppelungen mit den Wikidata-Vorlagen.

Nicht spielbare Gegenstände schließen die Vorlagen in `tools/content/src/wikidata/templates.ts` aus; Namen mit Artikel („die Zugspitze“) stehen in `de.ts`.

Was der erste Datenstand (2026-11-11) gelehrt hat und die Vorlagen deshalb festhalten:

- **Berufe sagen nicht, wofür jemand bekannt ist.** Wikidata führt Leonardo da Vinci auch als Komponist und George W. Bush als Maler. Die Geburtsjahr-Frage nimmt deshalb nur Personen aus einer festen Liste mit passender Bezeichnung („der Komponist“, „die Malerin“).
- **Orte sind oft Stadien.** Bei Olympischen Spielen nennt Wikidata neben der Stadt auch Stadien und Skigebiete, manchmal nur diese. Gefragt wird nur, wenn genau eine bekannte Ausrichterstadt genannt ist; das Jahr kommt aus der Bezeichnung (Tokio 2020 fand 2021 statt).
- **„Land“ heißt nicht „Staat“.** Aruba, die Cookinseln, Somaliland und ähnliche Gebiete fallen weg, ebenso Palästina (Anerkennung umstritten). Wikidata-Bezeichnungen wie „Naoero“ oder „Moldau“ werden zu „Nauru“ und „Republik Moldau“.
- **Nur Namen mit geprüfter deutscher Form.** Berge, Flüsse und Bauwerke ohne Eintrag in `de.ts` werden nicht gefragt; das hält auch abseitige Gegenstände (Hochhäuser in São Paulo, unfertige Türme) heraus.
- **Werke ohne Dichtung.** Die Autor-Frage nimmt nur Autoren ab 1200 (keine religiösen oder antiken Schriften ohne gesicherten Autor), keine Sachbücher, keine Propaganda und keine Titel, in denen der Autor steht.
- **Einwohnerzahlen deutscher Städte** mischen in Wikidata amtliche Zahlen und städtische Melderegister; freigegeben wird nur, was höchstens 1 % neben einer Zahl im Artikel der deutschen Wikipedia liegt (ADR-072).
- **Zahlen weichen zwischen den Quellen ab** (Abgleich 2026-11-13): Flusslängen je nach Messung, Flächen mit oder ohne Gewässer, Einwohnerzahlen aus verschiedenen Jahren oder Schätzungen. Solche Gegenstände schließen die Vorlagen mit Grund aus; bei Flüssen gilt der Wert der deutschen Wikipedia (`RIVER_LENGTHS_DE`). Einwohnerzahlen von Staaten werden nur ab Stand 2020 gefragt.
- **Operetten sind keine Opern** (Die Fledermaus, Die lustige Witwe), der Ring des Nibelungen ist ein Zyklus; Opern heißen wie in Deutschland üblich („Der Barbier von Sevilla“, „Der Bajazzo“). Währungen und Hauptstädte stehen in der Schreibweise der deutschen Wikipedia („Sol“, „Chișinău“).
