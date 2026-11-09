# Teststrategie

Bezug: Brief §17, §16 (Abnahmekriterien), §18. Automatisierte Tests sind Teil jeder Phase; eine Phase gilt erst als abgeschlossen, wenn ihre Abnahmetests grün in CI laufen.

## 1. Grundsätze

1. **Regeln testen ohne Datenbank:** Alle Spielregeln liegen in `game-core` als reine Funktionen und werden dort vollständig getestet (schnell, deterministisch).
2. **Nebenläufigkeit testen gegen echtes Postgres:** Sperren, Constraints und Transaktionsisolation lassen sich nicht sinnvoll mocken. Integrationstests laufen gegen eine echte, pro Testlauf frische Datenbank.
3. **Zeit ist steuerbar:** `game_now()` mit Testversatz und eine injizierbare `Clock` erlauben 24-h-Fristen in Millisekunden ([ARCHITECTURE.md §8](ARCHITECTURE.md#8-zeitmodell)).
4. **Zufall ist reproduzierbar:** Tests verwenden ein festes RNG-Geheimnis; jedes Ergebnis ist exakt vorhersagbar.
5. **Spoiler-Freiheit ist testbar:** Vertragstests prüfen, dass Antworten vor der Auflösung keine verbotenen Felder enthalten.

## 2. Testebenen und Werkzeuge

| Ebene | Werkzeug | Umfang | Wann in CI |
|---|---|---|---|
| Unit | Vitest | `game-core`, `protocol` (Parser, Schemas) | jeder Push |
| Property-basiert | fast-check | Hex-Mathematik, Duellauswertung, Fristberechnung, Drop-Verteilung | jeder Push |
| Integration | Vitest + Postgres (Service-Container in CI, lokal Docker oder vorhandenes Postgres) | Server-Module, Transaktionen, Jobs, Migrationen | jeder Push |
| Nebenläufigkeit | eigener Harness: N Verbindungen, Barriere, gleichzeitiger Start | Besitzwechsel, Limits, Itemverbrauch | jeder Push |
| Vertrag/Spoiler | Vitest gegen laufenden Server | verbotene Felder in Antworten und WS-Ereignissen | jeder Push |
| End-to-End | Playwright (Chromium; WebKit/Firefox vor Beta) | Nutzerreisen, E2E-01…12 | PR auf `main` |
| Barrierefreiheit | axe-core in Playwright | Quiz, Dashboard, Karte (Bedienelemente) | PR auf `main` |
| Simulation | `tools/sim` | Itemökonomie, Limits, NPC-Balancing; Berichte mit Schwellwerten | nächtlich / manuell |
| Last | k6 (oder vergleichbar) gegen Staging | Lastprofile aus [WORLD_SYSTEM.md §4.3](WORLD_SYSTEM.md#43-kapazitätsabschätzung-hypothese-durch-lasttests-zu-bestätigen) | Phase 7 |
| Inhalte | Schema-Validierung der Fragen-YAML | jede Inhaltsänderung | PR |

Abdeckungsziele: `game-core` ≥ 95 % Zeilen und Zweige; Server-Module ≥ 80 %. Abdeckung ist ein Hinweis, kein Selbstzweck – kritisch ist, dass jeder Zustandsübergang und jeder Fehlercode einen Test hat.

## 3. Unit-Tests (Brief §17.1)

| Bereich | Beispiele / Eigenschaften |
|---|---|
| Angriffsberechtigung | jede Ablehnungsregel einzeln; Reihenfolge der Fehlercodes; Rangabstand; Schutzzeiten an der Grenze (`now = protected_until`) |
| Nachbarschaft | genau 6 Nachbarn; Symmetrie (`a` Nachbar von `b` ⇔ `b` Nachbar von `a`); Distanz erfüllt Dreiecksungleichung; Chunk-Zuordnung stabil |
| Trivia-Bewertung | Vergleich über `option_key`, unabhängig von Reihenfolge und Sprache; ungültiges Token |
| Schätzbewertung | Rundung auf Präzision; Dezimal statt Float (`0,1 + 0,2`); Zahlparser je Sprache inkl. Mehrdeutigkeiten (`1.234` in de vs. en) |
| Tiebreaker | Tabelle [QUIZ_ENGINE.md §8.1](QUIZ_ENGINE.md#81-beispiele-testfälle) vollständig; Eigenschaft: Ergebnis ist für jede Eingabe definiert; Vertauschen der Rollen bei vollem Gleichstand ändert nur den Sieger zugunsten des Verteidigers |
| Effektive Zeit | `clamp`-Grenzen; Reload-Fall; negative/unsinnige Client-Werte |
| NPC-Antwortlogik | gleiche Eingaben ⇒ gleiche Antworten; empirische Trefferquote über 100 000 Ziehungen innerhalb ±1 % von `σ(θ − b)` |
| Item-Drops | gemeinsame Ziehung (Intervalle); Verteilung über 1 Mio. Seeds innerhalb Toleranz; Skalierungsfaktor `f` |
| Maximale Verlängerung | Eigenschaft: `deadline ≤ max_deadline` für jede Folge von Verlängerungen; Kappung; Ablehnung ohne Verbrauch bei erreichter Grenze |
| Königreichsränge | alle Schwellen (4/5, 14/15, …) |
| Weltabschluss | Angriffsschluss-Berechnung; Wertung inkl. Gleichstandsregeln |
| Zustandsmaschine | jeder erlaubte Übergang; jeder unerlaubte wird abgewiesen |

## 4. Integrationstests (Brief §17.2)

| Test | Kernprüfung |
|---|---|
| Gebietseroberung PvE | Besitz, `region_count`, Historie, Schutzzeit, Ereignis in `world_events`, Drop-Eintrag |
| PvP-Belagerung | vollständiger Ablauf bis Auflösung, beide Seiten erhalten Ergebnis |
| Fristablauf | Zeit vorstellen → Timeout-Job → Besitzwechsel; ohne Job: Sweeper; ohne beides: Lesezugriff löst auf |
| Gleichzeitige Antworten (N4) | Verteidigerantwort und Timeout-Job im selben Moment, 500 Wiederholungen mit zufälligem Versatz: immer genau ein Endzustand, Antwort nach Frist nie gewertet |
| Parallele Besitzwechsel (N1, N2) | 20 gleichzeitige Angriffe auf dieselbe Region: genau eine Belagerung; Limits gegen ein Reich nie überschritten |
| Itemverbrauch parallel (N6, N7) | dasselbe Item in 10 parallelen Anfragen: genau ein Verbrauch; zwei Items parallel auf eine Belagerung: Obergrenze nie überschritten |
| NPC-Expansion | Tick zweimal ausführen ⇒ identischer Zustand; Grenzen je Fraktion eingehalten |
| Neustart während aktiver Jobs | Worker-Prozess während offener Belagerungen beenden, Zeit über Frist vorstellen, Worker neu starten ⇒ alle Belagerungen korrekt aufgelöst |
| Daily-/Weekly-Abschluss | Angriffsschluss greift; keine offenen PvP-Belagerungen nach Ende; Wertung korrekt |
| Migrationen | alle Migrationen auf leerer DB; Schema-Drift-Prüfung |
| Invarianten | Invariantenjob nach jedem Integrationstest-Szenario ohne Befund |

## 5. End-to-End-Tests (Brief §17.3)

| Fall | Phase | Ebene | Umsetzung |
|---|---|---|---|
| E2E-01 Erste Eroberung | 1 | Browser | Gast startet, Tutorial-Garnison, besitzt danach 2 Regionen; nach Reload unverändert |
| E2E-02 Trivia-Sieg | 2 | Browser, 2 Kontexte | Angreifer richtig, Verteidiger falsch |
| E2E-03 Schätzfrage | 2 | Browser, 2 Kontexte | beide richtig, nähere Schätzung gewinnt |
| E2E-04 Zeit-Tiebreaker | 2 | Integration + Browser | gleiche Schätzung; Zeiten über Test-Uhr gesteuert, damit deterministisch |
| E2E-05 Keine Verteidigung | 3 | Browser + Zeitversatz | 24 h vorstellen, Gebiet übertragen, beide Seiten informiert |
| E2E-06 Itemverlängerung | 4 | Browser | 24 → 36 h mit Chronos-Siegel; Vorschau vor Bestätigung |
| E2E-07 Verlängerungsgrenze | 4 | Browser + Integration | Kristall bei 30 h Frist → Kappung auf 48 h mit Hinweis; bei 48 h Ablehnung ohne Verbrauch |
| E2E-08 Neustart | 3 | Integration (Prozess-Neustart) | siehe §4 |
| E2E-09 Parallelität | 2 | Integration (Nebenläufigkeits-Harness) | siehe §4 – im Browser nicht deterministisch prüfbar |
| E2E-10 Mehrsprachigkeit | 2 | Browser, Kontexte `de` und `hu` | dieselbe Fragenversion, unterschiedliche Texte, korrekte Bewertung |
| E2E-11 Keine doppelte Belohnung | 4 | Integration + Browser | Antwort doppelt senden, Auflösung doppelt anstoßen ⇒ genau ein `reward_event` |
| E2E-12 Welttrennung | 6 | Integration | Änderung in Weekly-Instanz ⇒ Eternal unverändert (Vergleich vollständiger Zustands-Hashes) |

## 6. Testdaten

- Feste Karten-Seeds und eine Fragen-Fixture (z. B. 40 Fragen in drei Sprachen) im Repository.
- Szenario-Builder in `packages/db/testing` (z. B. `givenKingdom().withRegions(5).underSiege(...)`) statt großer SQL-Dumps.
- Keine Produktionsdaten in Tests.

## 7. Aktueller Stand (Phase 0)

- Es existiert noch kein Code; daher wurden keine Software-Tests ausgeführt.
- Ausgeführt wurden: eine vorläufige Monte-Carlo-Simulation der Itemökonomie ([ITEM_SYSTEM.md §4.2](ITEM_SYSTEM.md#42-simulation)), eine Anpassung des NPC-Antwortmodells an die Brief-Tabelle ([NPC_SYSTEM.md §3.1](NPC_SYSTEM.md#31-trivia)) und eine automatische Prüfung aller internen Links und Anker dieser Dokumentation.
- Mit den Grundlagen (Roadmap Schritt 1.0) entstehen CI, Unit-Tests für `game-core` und der Integrations-Harness.
