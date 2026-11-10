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
| Integration | Vitest + Postgres (Service-Container in CI, lokal Docker oder vorhandenes Postgres) | Server-Module, Transaktionen, Jobs, Migrationen sowie Authentifizierung, Autorisierung, CSRF, Rate Limits, Sicherheits-Header und Löschung/Export | jeder Push |
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
| Schätzbewertung | Rundung auf Präzision mit `ROUND_HALF_UP`, inkl. Grenzfälle x,5 und −x,5; Dezimal statt Float (`0,1 + 0,2`); Zahlparser je Sprache inkl. Mehrdeutigkeiten (`1.234` in de vs. en) |
| Tiebreaker | Tabelle [QUIZ_ENGINE.md §8.1](QUIZ_ENGINE.md#81-beispiele-testfälle) vollständig; Eigenschaft: Ergebnis ist für jede Eingabe definiert; Vertauschen der Rollen bei vollem Gleichstand ändert nur den Sieger zugunsten des Verteidigers |
| Effektive Zeit | `clamp`-Grenzen; `S < cap` ergibt nie eine negative Zeit; Reload-Fall; fehlende, negative oder nicht ganzzahlige Client-Werte werden verworfen |
| NPC-Antwortlogik | gleiche Eingaben ⇒ gleiche Antworten; empirische Trefferquote über 100 000 Ziehungen innerhalb ±1 % von `σ(θ − b)` |
| Item-Drops | gemeinsame Ziehung (Intervalle); Verteilung über 1 Mio. Seeds innerhalb Toleranz; Skalierungsfaktor `f` |
| Maximale Verlängerung | Eigenschaft: `deadline ≤ max_deadline` für jede Folge von Verlängerungen; Kappung; Ablehnung ohne Verbrauch bei erreichter Grenze |
| Königreichsränge | alle Schwellen (4/5, 14/15, …) |
| Weltabschluss | Angriffsschluss-Berechnung; Wertung inkl. Gleichstandsregeln |
| Zustandsmaschine | jeder erlaubte Übergang; jeder unerlaubte wird abgewiesen |
| Verteidigungspunkte | `defensePoints` für alle Kombinationen aus „beide Fragen beantwortet“ und „Trivia richtig“, Spalte Verteidigungspunkte in [QUIZ_ENGINE.md §8.1](QUIZ_ENGINE.md#81-beispiele-testfälle); Eigenschaft: das Ergebnis hängt nie von der Angreiferleistung ab |

## 4. Integrationstests (Brief §17.2)

| Test | Kernprüfung |
|---|---|
| Gebietseroberung PvE | Besitz, `region_count`, Historie, Schutzzeit, Ereignis in `world_events`, Drop-Eintrag |
| PvP-Belagerung | vollständiger Ablauf bis Auflösung, beide Seiten erhalten Ergebnis |
| Fristablauf | Zeit vorstellen → Sweeper (`runDueJobs()`, autoritativer Pfad) → Besitzwechsel; geplanter Job mit umgerechnetem Versatz; Lesezugriff löst ebenfalls auf; alle drei Pfade nutzen `isTimeoutDue` |
| Gleichzeitige Antworten (N4) | Verteidigerantwort und Timeout-Job im selben Moment, 500 Wiederholungen mit zufälligem Versatz um `deadline_at`, Antworttransaktion teils künstlich hinter der Sperre verzögert: immer genau ein Endzustand; rechtzeitige Antwort wird gewertet, auch wenn sie auf die Sperre warten musste oder ihre Auswertung am Sperrzeitlimit scheiterte (dann über Timeout-Pfad oder Wiederholung); verspätete Antwort nie; begonnene, unvollständige Verteidigung führt zum selben Ergebnis, egal ob `challenge.expireStale` oder der Timeout-Pfad zuerst läuft |
| Angriff wiederholt (N3) | `POST /attacks` zweimal mit demselben `Idempotency-Key`, nacheinander und parallel: identische Antwort, genau eine Belagerung, Budget nur einmal belastet; gleicher Schlüssel mit anderem Inhalt ⇒ `IDEMPOTENCY_KEY_REUSED` |
| Gastanmeldung wiederholt | `POST /auth/guest`, Antwort verworfen, Wiederholung mit demselben Bootstrap-Cookie (auch parallel) ⇒ neue Sitzung für dasselbe Gastkonto, kein zweites Konto; nach einer authentifizierten Anfrage dieses Kontos ⇒ `GUEST_BOOTSTRAP_USED`; ohne Cookie ⇒ `GUEST_BOOTSTRAP_REQUIRED`; das Cookie ist `HttpOnly`, und kein Schlüssel oder Token landet in `localStorage` |
| Kontolöschung parallel | Löschjob und gleichzeitige Anfragen, die neue Verweise auf das Konto anlegen (Angriff, Itemverbrauch, Antwort einer laufenden Verteidigung, Einstellungsänderung, die nur einen `idempotency_keys`-Eintrag schreibt), 100 Wiederholungen mit zufälligem Versatz: Jede Anfrage ist entweder vor der Löschung fertig und ihr Verweis zeigt danach auf das Platzhalterkonto, oder sie scheitert; nie bleibt ein Verweis auf die alte ID, nie ist das Konto halb umgestellt |
| Verlängerung gegen Fristablauf (N5) | Verlängerung und Timeout an der Grenze `game_now() = deadline_at`, 500 Wiederholungen mit zufälligem Versatz: entweder Verlängerung wirksam (Item verbraucht, neue Frist, Belagerung offen) oder Timeout (Item **nicht** verbraucht, `ATTACKER_WON_BY_TIMEOUT`) – nie beides, nie Verbrauch ohne Wirkung |
| Parallele Besitzwechsel (N1, N2) | 20 gleichzeitige Angriffe auf dieselbe Region: genau eine Belagerung; Limits gegen ein Reich nie überschritten |
| Itemverbrauch parallel (N6, N7) | dasselbe Item in 10 parallelen Anfragen: genau ein Verbrauch; zwei Items parallel auf eine Belagerung: Obergrenze nie überschritten |
| Verdecktes Gate | Angreifer falsch + keine Verteidigung ⇒ `ATTACK_FAILED`, Gebiet unverändert, keine Punkte; Angreifer falsch + Verteidigung ⇒ `DEFENDER_WON`; Vertragstest: weder Angreifer noch Verteidiger erfahren vor der Auflösung, ob der Angreifer richtig lag |
| Verteidigungspunkte | Punkte genau einmal je Belagerung, auch wenn der Verteidiger das Gebiet verliert; ohne Bonus bei falscher, mit Bonus bei richtiger Trivia-Antwort; nur geöffnete Verteidigung ⇒ keine Punkte; drittes punktbringendes Paar-Duell in 24 h ⇒ keine Punkte; NPC- oder Garnisonsverteidigung ⇒ keine Punkte; Statistik von Reich und Spieler stimmt mit `battle_results.defense_points` überein |
| Regionsreservierung | jeder Endzustand (inkl. `ATTACK_FAILED`, PvE, `CANCELLED`, `EXPIRED_INVALID`) gibt `active_siege_id` frei; Fremdschlüssel lehnt Zeiger auf fremde Region ab |
| Outbox-Verteiler | `LISTEN`-Verbindung während laufender Ereignisse trennen ⇒ nach Wiederverbindung alle Ereignisse in `seq`-Reihenfolge, keine Lücke; parallele Transaktionen erzeugen lückenlose `seq` je Instanz |
| Sicherheit (HTTP) | Rollentrennung (Spieler ↛ Admin, `EDITOR` ↛ Welt-/Kampf-/Missbrauchs-Endpunkte), CSRF-Ablehnung ohne Token bzw. mit fremdem `Origin`, Sicherheits-Header, Rate Limits über zwei `api`-Prozesse, `Idempotency-Key`-Pflicht, Löschkaskade und Export vollständig (Katalogprüfung: jeder Fremdschlüssel auf `users` ist in der Löschkaskade erfasst und indiziert, und es gibt keine Spalte für Konto-IDs ohne Fremdschlüssel; nach der Löschung eines Spieler- und eines Redaktionskontos kommt die alte Konto-ID in keiner Spalte und in keinem JSON-Feld mehr vor, und `reason` von Audit-Einträgen über das Konto ist geschwärzt; bei laufendem Prüfverfahren wird die Löschung vollständig aufgeschoben, nicht teilweise ausgeführt) |
| NPC-Expansion | Tick zweimal ausführen ⇒ identischer Zustand; Grenzen je Fraktion eingehalten |
| Neustart während aktiver Jobs | Worker-Prozess während offener Belagerungen beenden, Zeit über Frist vorstellen, Worker neu starten ⇒ alle Belagerungen korrekt aufgelöst |
| Daily-/Weekly-Abschluss | Angriffsschluss greift (inkl. `settleGrace`); fällige Belagerungen werden vor dem Snapshot aufgelöst, auch wenn der Sweeper noch nicht lief; keine offenen PvP-Belagerungen nach Ende; Wertung korrekt |
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
| E2E-10 Mehrsprachigkeit | – | ruht (nur Deutsch, ADR-023) | erst mit einer zweiten Sprache: dieselbe Fragenversion, unterschiedliche Texte, korrekte Bewertung |
| E2E-11 Keine doppelte Belohnung | 4 | Integration + Browser | Antwort doppelt senden, Auflösung doppelt anstoßen ⇒ genau ein `reward_event` |
| E2E-12 Welttrennung | 6 | Integration | Änderung in Weekly-Instanz ⇒ instanzbezogener Eternal-Spielzustand unverändert (Hash über alle Tabellen mit `instance_id` der Eternal-Instanz); globale Profile/Statistiken separat auf erlaubte Änderungen prüfen |

## 6. Testdaten

- Feste Karten-Seeds und eine Fragen-Fixture (40 Fragen auf Deutsch) im Repository.
- Szenario-Builder in `packages/db/testing` (z. B. `givenKingdom().withRegions(5).underSiege(...)`) statt großer SQL-Dumps.
- Keine Produktionsdaten in Tests.

## 7. Aktueller Stand

**Schritt 1.0 (2026-11-09).** Befehle: `pnpm test` (Unit), `pnpm test:integration` (braucht `TEST_DATABASE_URL`), `pnpm content:validate`, `pnpm lint`, `pnpm typecheck`; CI führt alle aus.

| Bereich aus §3 | Stand |
|---|---|
| Nachbarschaft | umgesetzt: 6 Nachbarn, Symmetrie, Metrik (Dreiecksungleichung), Chunk-Zuordnung stabil inkl. negativer Koordinaten; Abgleich `chunkOf` ↔ SQL-Check `regions_chunk_matches_coordinates` |
| Trivia-Bewertung | umgesetzt (`option_key`, ungültiges Token) |
| Schätzbewertung | umgesetzt: `ROUND_HALF_UP` inkl. ±x,5, Dezimal statt Float (`0,1 + 0,2`), Zahlparser (Deutsch, ADR-023) inkl. `1.234` = 1234 und Ablehnung englischer Schreibweise, Eigenschaftstest über alle Schreibweisen |
| Tiebreaker | umgesetzt: Tabelle [QUIZ_ENGINE.md §8.1](QUIZ_ENGINE.md#81-beispiele-testfälle) vollständig (11 Fälle mit Punkten), Eigenschaften „immer definiert“, „Gate“, „Rollentausch“ |
| Effektive Zeit | umgesetzt: `clamp`-Grenzen, `S < cap`, Reload, fehlende/negative/nicht ganzzahlige Werte, Signal auch nach Reload |
| NPC-Antwortlogik | umgesetzt: Determinismus, Trefferquote über 100 000 Ziehungen ±1 %, Brief-Tabelle, Streuung, Begrenzung, Antwortzeit |
| Item-Drops | umgesetzt: Intervallgrenzen exakt, Verteilung über 1 Mio. Seeds und 20 000 echte HMAC-Seeds, Faktor `f` |
| Maximale Verlängerung | umgesetzt: Eigenschaft `deadline ≤ max_deadline`, Kappung mit verfallendem Rest, Ablehnung ohne Verbrauch, `DEADLINE_CHANGED` |
| Königreichsränge | umgesetzt: alle Schwellen |
| Weltabschluss | teilweise: Angriffsschluss und Saisonende-Prüfung; Wertung folgt mit [O-16] |
| Verteidigungspunkte | umgesetzt: alle Kombinationen, Unabhängigkeit von der Angreiferleistung |
| Angriffsberechtigung, Zustandsmaschine | offen (Phase 1/3) |

Integration (gegen PostgreSQL 16): Migrationsläufer (leere DB, Idempotenz, geänderte/fehlende/kaputte Migrationen mit vollständigem Rollback, parallele Läufe), Kommandozeile als eigener Prozess (Produktionsschutz, `--status`, unbekannte Argumente, fehlendes `APP_ENV`), `game_now()` mit Zeitversatz und Schreibschutz (auch gegen Sitzungs-`SET`, Kalenderversatz und überdeckende temporäre Tabellen), Constraints aus [DATA_MODEL.md §4.1–4.4](DATA_MODEL.md#41-konten-und-profile) inkl. zusammengesetzter Fremdschlüssel und nur anhängbarer Protokolle, und als Katalogprüfungen „jeder Fremdschlüssel ist indiziert“ sowie „jeder Fremdschlüssel auf `users` ist `RESTRICT`“.

**Phase 1, Paket 1 (2026-11-10).** Neu: `pnpm db:types --check` (Drift der Kysely-Typen, auch als CI-Schritt) und `pnpm content:import`.

- Schema 0005–0007 (`packages/db/test/quiz-kampf.int.test.ts`): Wertelisten der Fragentabellen gegen `protocol`; Freigabe nur mit Fakten- und Sprachprüfung und freigegebener Übersetzung, bei Trivia mit ≥ 4 Optionen, genau einer richtigen und Optionstexten für genau diese Optionen, bei Schätzfragen ohne Optionstexte, nie für Testfragen, `approved_at` aus der Datenbank; höchstens eine freigegebene Version je Frage (beim Commit, Umstellen wie im Import); Inhaltsregeln wie im Werkzeug (mindestens eine Quelle, LOG-Skala mit positivem Zielwert, Lizenzhinweis genau bei `LICENSED`, keine leeren Tags); `is_fixture` fest; Unveränderlichkeit freigegebener Versionen samt Optionen, Übersetzungen und Prüfungen (I12), nur `APPROVED → RETIRED`, nicht für die aktuelle Version einer aktiven Frage; aktive Fragen nur mit freigegebener Version; Belagerungen: zusammengesetzte Fremdschlüssel über Instanzgrenzen (I13, auch `region_state` und `region_history`), Fristen (I10), Modus/Verteidiger samt Art des verteidigenden Reichs, keine Verteidigungszustände bei PvE, Ergebnisfelder mit erlaubten Paaren aus Endzustand und Grund, jeder Ausgang von `resolveDuel` samt `battle_results` (auch `EXPIRED_INVALID`/`INSTANCE_CLOSED`), Ergebnis passt zur beendeten Belagerung, eine aktive Belagerung je Region (I2), `active_siege_id` nur für dieselbe Region (I3); Teilnehmer (Mensch oder NPC), Schrittfolge und Fragenart, gestellt werden nur freigegebene Versionen aktiver Fragen oder Testfragen, Herausforderung und Schritte unveränderlich; NPC-Antworten nur mit Audit und nur für NPC-Teilnehmer, Menschen nur präsentiert, `ANSWERED` nur vor der Frist, Antworten nach Abgabe unveränderlich (I11) und nur mit Teilnehmern desselben Kampfes; Outbox: `seq` vom Trigger lückenlos je Instanz (auch nach Rollback und für mehrere Zeilen), vorgegebene `seq` abgelehnt, nur anhängbar, Platzhalter `REDACTED`; NPC-Basisprofile gleich `NPC_BASE_PROFILES` und `garrisonProfile`.
- Drift (`schema-types.int.test.ts`): `schema.generated.ts` gleich dem Schema einer frisch migrierten Datenbank.
- Fragenimport (`tools/content/test/import.int.test.ts`, `import.test.ts`): 40 Testfragen nur mit `includeFixtures`, als Entwurf, zweiter Lauf ohne Änderung; Lebenszyklus Entwurf → Freigabe → nur Metadaten → neue Version (alte zurückgezogen) → neuer Entwurf neben aktiver Version → Entwurf ersetzt; Rückzug per Datei; Datenbank lehnt Freigabe ohne Prüfung ab und nichts wird übernommen; keine Freigabe von Testfragen; kein Zurückstufen, kein Wechsel der Art, getrennte Schlüssel für Testfragen und Bestand; Probelauf; `contentHash` unabhängig von Formatierung, Status, Fragenfeldern (auch Herkunft) und der Reihenfolge von Optionen und Prüfungen. IDs (`packages/db/test/ids.test.ts`): UUIDv7 mit Zeitstempel, sortierbar.
