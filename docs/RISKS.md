# Risikoanalyse

Bezug: Brief §19, §13, §14. Bewertung: Wahrscheinlichkeit (W) und Auswirkung (A) jeweils niedrig/mittel/hoch. Sortiert nach Gesamtrisiko.

| ID | Risiko | W | A | Gegenmaßnahmen | Phase / Entscheidung |
|---|---|---|---|---|---|
| R-01 | **Verteidigungsdruck:** Das Spiel fühlt sich wie Anwesenheitspflicht an; Spieler verlieren Gebiete im Schlaf oder Urlaub und hören auf. | hoch | hoch | 24-h-Frist, Items bis 48 h, Kappung offener Belagerungen, Schutzzeiten, Web Push, Dashboard, Urlaubsmodus nach Beta; Beta-Kennzahl „Timeout-Quote“ | Ph. 3–4, [O-04], [O-06] |
| R-02 | **Kaltstart:** Zu wenige Spieler für lebendiges PvP. | hoch | hoch | NPCs und neutrale Regionen von Beginn an; Closed Beta mit eingeladener Gruppe; Daily als niedrigschwelliger Einstieg später | Ph. 1, 5, 6 |
| R-03 | **Fragendatenbank:** Umfang, Richtigkeit und Übersetzungsqualität in drei Sprachen sind teuer; Fehler zerstören Vertrauen. | hoch | hoch | Redaktionspipeline mit Pflichtprüfung, Quellen, Fehlermeldefunktion, DIF-Monitoring, Suspendieren mit einem Klick, Pool-Kennzahlen | [O-02] |
| R-04 | **Benachrichtigungen erreichen Spieler nicht** (iOS nur mit installierter PWA, abgelehnte Berechtigung) – Fristen wirken dann unfair. | hoch | hoch | PWA-Installationshilfe, In-App-Hinweis beim Start, später E-Mail; Kennzahl Push-Zustellrate | [O-04] |
| R-05 | **Nachschlagen und Bots** verfälschen Duelle. | hoch | mittel | kurze Zeitlimits, schwer recherchierbare Schätzfragen, statistische Signale, verhältnismäßige Maßnahmen | Ph. 2–3, 7 |
| R-06 | **Große Reiche:** Schneeballeffekt oder faktische Unangreifbarkeit durch Kappung und Items. | mittel | hoch | jede Region einzeln eroberbar, NPC-Druck auf große Reiche, Simulation, größenabhängige Kapazität als Option | [O-05], Ph. 5 |
| R-07 | **Neue Spieler in reifer Eternal-Welt** finden keinen fairen Platz. | mittel | hoch | Chunk-Ringe, Startkandidaten-Kriterien, Anfänger- und Rangabstandsschutz, Inaktivitätsverfall | Ph. 5, [O-07], [O-15] |
| R-08 | **Rechtliche Nähe zu bestehenden Spielen** (Marke, Gestaltung). | mittel | hoch | eigenständige Gestaltung, keine Namensnennung im Marketing, Markenrecherche, Asset-Register, juristische Prüfung vor Start | [O-12], Ph. 7 |
| R-09 | **Wahrgenommene Unfairness der Zeitentscheidung** bei Latenzunterschieden. | mittel | mittel | Latenzausgleich bis `cap`, Redaktionsregel gegen Exakt-Jahreszahlen, transparente Auflösung mit Zeiten, Kennzahl Speed-Entscheidungen | Ph. 2 |
| R-10 | **Multiaccount-Farming** von Items. | mittel | mittel | Q1–Q7, Paar-Limits, Signale, keine Belohnung für Verteidigung | Ph. 4, [O-09] |
| R-11 | **Balancing-Wechselwirkungen** zwischen Limits, Items und NPCs. | hoch | mittel | alle Werte als Konfiguration, Simulationen in `tools/sim`, Beta-Kennzahlen, Regelversionen mit Snapshot | laufend |
| R-12 | **Nebenläufigkeitsfehler** beim Besitzwechsel. | niedrig | hoch | DB-Constraints, feste Sperrreihenfolge, Idempotenz, Nebenläufigkeits-Harness, stündlicher Invariantenjob | Ph. 2–3 |
| R-13 | **Mobile Leistung** bei großen Karten. | mittel | mittel | PixiJS, Chunk-Laden, LOD; Leistungsbudget und Tests auf Mittelklasse-Geräten | Ph. 1, 7 |
| R-14 | **Sprachliche/kulturelle Verzerrung** in Fragen. | mittel | mittel | `region:`-Tags, Ausschluss in gemischtsprachigen Duellen, DIF-Monitoring | Ph. 2 |
| R-15 | **Überarchitektur oder Scope Creep** verzögern den spielbaren Kern. | mittel | mittel | Phasen mit Abnahmekriterien, MVP-Abgrenzung, modularer Monolith | laufend |
| R-16 | **Betriebsaufwand und Kosten** für ein kleines Team. | mittel | mittel | ein Host im MVP, Postgres-only, Managed-Optionen geprüft, Monitoring von Anfang an | [O-11] |
| R-17 | **Datenschutzmängel** (z. B. zu lange Log-Aufbewahrung, fehlende Pflichttexte). | niedrig | mittel | Datenminimierung im Entwurf, Aufbewahrungsjobs, Prüfung vor Beta | Ph. 4.5 |

## Annahmen, deren Widerlegung den Plan ändern würde

1. Ein Postgres-Knoten trägt eine Eternal-Welt mit mehreren tausend aktiven Spielern (Lasttest Phase 7).
2. 20/30 s Zeitlimits fühlen sich fair an und schrecken Nachschlagen ausreichend ab (Beta-Umfrage, Zeitverteilungen).
3. Spieler akzeptieren asynchrone Duelle mit 24-h-Frist als „fair“, wenn sie zuverlässig benachrichtigt werden (Beta).
4. Drei Sprachen lassen sich mit vertretbarem Aufwand redaktionell gleichwertig halten ([O-02]).
