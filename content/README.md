# Inhalte

| Verzeichnis | Inhalt |
|---|---|
| `questions/` | Fragenbestand für den Spielbetrieb (noch leer; Beschaffung siehe [O-02](../docs/DECISIONS.md#offene-entscheidungen)) |
| `fixtures/questions/` | 40 Testfragen (25 Trivia, 15 Schätzung) für Tests und Prototyp – **nie für den Spielbetrieb** |

Prüfen: `pnpm content:validate` (läuft auch in der CI).

## Format

Eine Frage je YAML-Datei, Dateiname = `key`. Feldnamen folgen dem Datenmodell
([QUIZ_ENGINE.md §2–3](../docs/QUIZ_ENGINE.md), [DATA_MODEL.md §4.6](../docs/DATA_MODEL.md#46-quiz)),
das Schema steht in `tools/content/src/schema.ts`.

- `kind`: `TRIVIA` (Abschnitt `trivia` mit mindestens 4 Optionsschlüsseln und genau einer richtigen Option) oder `ESTIMATE` (Abschnitt `estimate`).
- Dezimalwerte (`answer_value`, `input_min`, `input_max`) stehen in Anführungszeichen, z. B. `"9.8"`, damit YAML sie nicht als Gleitkommazahl liest.
- `translations` enthält immer `de`, `hu` und `en`; bei Trivia die Optionstexte je Schlüssel, bei Schätzfragen `unit_label`.
- `sources`: mindestens eine überprüfbare Quelle über https.
- `reviews`: dokumentierte menschliche Prüfungen (`FACT`, `LANGUAGE` je Sprache).

## Freigaberegel (Brief §5.6)

KI-gestützte Fragen (`origin: AI_ASSISTED`) dürfen nicht ungeprüft veröffentlicht werden. Das Prüfwerkzeug lässt `status: APPROVED` nur zu, wenn eine Faktenprüfung und je Sprache eine Sprachprüfung dokumentiert sind und alle Übersetzungen freigegeben sind. Testfragen unter `fixtures/` tragen den Tag `fixture` und können nie freigegeben werden.

Die 40 Testfragen sind von Claude entworfen (`AI_ASSISTED`, `DRAFT`). Fakten und Übersetzungen, vor allem Ungarisch, sind noch nicht von Menschen geprüft.
