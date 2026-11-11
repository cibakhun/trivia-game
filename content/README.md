# Inhalte

| Verzeichnis | Inhalt |
|---|---|
| `questions/` | Fragenbestand für den Spielbetrieb; bisher nur Entwürfe (Beschaffung siehe [O-02](../docs/DECISIONS.md#offene-entscheidungen)) |
| `questions/wikidata/` | Entwürfe aus Wikidata-Fakten (ADR-056), `DRAFT` bis zur Fakten- und Sprachprüfung |
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
- `reviews`: dokumentierte menschliche Prüfungen (`FACT`, `LANGUAGE` je Sprache).

## Freigaberegel (Brief §5.6)

KI-gestützte Fragen (`origin: AI_ASSISTED`) dürfen nicht ungeprüft veröffentlicht werden. Das Prüfwerkzeug lässt `status: APPROVED` nur zu, wenn eine Faktenprüfung und je Sprache eine Sprachprüfung dokumentiert sind und alle Übersetzungen freigegeben sind. Testfragen unter `fixtures/` tragen den Tag `fixture` und können nie freigegeben werden.

Die 40 Testfragen sind von Claude entworfen (`AI_ASSISTED`, `DRAFT`). Fakten und Texte sind noch nicht von Menschen geprüft; die Quellen sind Vorschläge, `accessed` ist dort das Entwurfsdatum. Bis zur Entscheidung über O-02 (vertagt, PO 2026-11-09) laufen Phase 1 und ihre Tests mit diesen Fragen.

## Fragen aus Wikidata (ADR-056)

1. `pnpm content:wikidata:fetch` holt die Abfragen aus `tools/content/wikidata/queries/` und speichert je Abfrage `content/wikidata/<name>.json` (braucht Zugang zu `query.wikidata.org`; das Skript läuft auch allein mit `node tools/content/src/wikidata/fetch.ts`).
2. `pnpm content:wikidata` erzeugt daraus die Entwürfe unter `questions/wikidata/`. Vorhandene Dateien bleiben unverändert (`--force` erzeugt sie neu), `--dry-run` prüft nur, `--report=DATEI` schreibt eine Übersicht zum Gegenlesen.
3. Gegenlesen, Text glätten, dann Fakten- und Sprachprüfung in `reviews` eintragen und freigeben wie jede andere Frage.

Nicht spielbare Gegenstände schließen die Vorlagen in `tools/content/src/wikidata/templates.ts` aus; Namen mit Artikel („die Zugspitze“) stehen in `de.ts`.

Was der erste Datenstand (2026-11-11) gelehrt hat und die Vorlagen deshalb festhalten:

- **Berufe sagen nicht, wofür jemand bekannt ist.** Wikidata führt Leonardo da Vinci auch als Komponist und George W. Bush als Maler. Die Geburtsjahr-Frage nimmt deshalb nur Personen aus einer festen Liste mit passender Bezeichnung („der Komponist“, „die Malerin“).
- **Orte sind oft Stadien.** Bei Olympischen Spielen nennt Wikidata neben der Stadt auch Stadien und Skigebiete, manchmal nur diese. Gefragt wird nur, wenn genau eine bekannte Ausrichterstadt genannt ist; das Jahr kommt aus der Bezeichnung (Tokio 2020 fand 2021 statt).
- **„Land“ heißt nicht „Staat“.** Aruba, die Cookinseln, Somaliland und ähnliche Gebiete fallen weg, ebenso Palästina (Anerkennung umstritten). Wikidata-Bezeichnungen wie „Naoero“ oder „Moldau“ werden zu „Nauru“ und „Republik Moldau“.
- **Nur Namen mit geprüfter deutscher Form.** Berge, Flüsse und Bauwerke ohne Eintrag in `de.ts` werden nicht gefragt; das hält auch abseitige Gegenstände (Hochhäuser in São Paulo, unfertige Türme) heraus.
- **Werke ohne Dichtung.** Die Autor-Frage nimmt nur Autoren ab 1200 (keine religiösen oder antiken Schriften ohne gesicherten Autor), keine Sachbücher, keine Propaganda und keine Titel, in denen der Autor steht.
- **Einwohnerzahlen deutscher Städte** mischen in Wikidata amtliche Zahlen und städtische Melderegister; vor der Freigabe gegen Destatis prüfen.
