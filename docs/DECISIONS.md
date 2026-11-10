# Entscheidungen

Zwei Teile: **Architekturentscheidungen**, die Claude im Rahmen der Entscheidungsautonomie (Brief §20) getroffen hat, und **offene Entscheidungen**, die der Product Owner treffen sollte. Jede Änderung wird hier mit Datum nachgetragen.

## Architekturentscheidungen (ADR)

Status ADR-001 bis ADR-016: *angenommen, 2026-11-09, Phase 0*. Alle ADRs sind revidierbar, solange der jeweilige Teil noch nicht produktiv ist.

| ID | Entscheidung | Begründung | Verworfene Alternativen | Kosten einer späteren Änderung |
|---|---|---|---|---|
| ADR-001 | Modularer Monolith mit zwei Prozessrollen (`api`, `worker`) | geringe Betriebskomplexität, klare Modulgrenzen, horizontal skalierbar | Microservices (Overhead ohne Nutzen), Single-Process (Jobs blockieren API) | mittel |
| ADR-002 | TypeScript-Monorepo mit pnpm Workspaces | geteilte Typen und Regeln Client/Server, Brief-Präferenz | getrennte Repos | gering |
| ADR-003 | Spielregeln als reine Funktionen in `game-core` | testbar ohne DB, wiederverwendbar für Simulation und Client-Vorschau, reproduzierbar | Regeln in Services/SQL verteilt | hoch (daher früh festlegen) |
| ADR-004 | PostgreSQL als einzige Wahrheitsquelle inkl. Zeit (`game_now()`) und Jobs (pg-boss); kein Redis im MVP | eine Konsistenzgrenze; Job-Anlage transaktional mit Spielzustand; Fristen unabhängig von Server-Uhren | Redis/BullMQ (zweite Konsistenzgrenze), Anwendungsuhr | mittel |
| ADR-005 | Kysely + versionierte SQL-Migrationen | explizite Sperren und Constraints, SQL-nah, gute Typen | Prisma, Drizzle, TypeORM | mittel |
| ADR-006 | React + Vite als SPA, Karte mit PixiJS | Spiel-Client braucht kein SSR; WebGL für große Karten | Next.js, SVG-Karte | mittel |
| ADR-007 | WebSocket + transaktionaler Outbox + Sequenznummern | keine verlorenen oder Geister-Ereignisse; Reconnect mit Nachspielen | Socket.IO, reines Polling, SSE | gering |
| ADR-008 | Zustandstabellen + unveränderliche Protokolle, kein Event Sourcing | Rekonstruktion strittiger Kämpfe ohne Event-Sourcing-Komplexität | volles Event Sourcing | hoch |
| ADR-009 | Jeder Kampf (auch PvE) ist eine `sieges`-Zeile | ein Auswertungs- und Protokollpfad, einheitliche Limits | getrennte PvE-/PvP-Tabellen | mittel |
| ADR-010 | Items als Einzelexemplare statt Stapel | Herkunft und Verbrauch je Item nachvollziehbar (Anti-Farming, Audit) | Mengenzähler pro Typ | mittel |
| ADR-011 | Zufall über HMAC-abgeleitete Seeds + versionierten PRNG | reproduzierbar mit Geheimnis, unvorhersagbar ohne; Retries würfeln nicht neu | `Math.random`, DB-`random()` | gering |
| ADR-012 | Region statisch (`regions`) und dynamisch (`region_state`) getrennt | Kartenlayout unbegrenzt cachebar; heiße Zeilen klein | eine breite Tabelle; separate Ownership-/Protection-Tabellen | mittel |
| ADR-013 | Effektive Antwortzeit `clamp(C, S − cap, S)` | begrenzter Latenzausgleich, Manipulationsvorteil ≤ `cap` | nur Serverzeit (benachteiligt langsame Netze), Client-Zeit (manipulierbar) | gering |
| ADR-014 | Eigene Sitzungsverwaltung (Token-Hash in DB, Argon2id für Passwörter; **präzisiert durch ADR-029:** Sitzungstoken als SHA-256 ohne Pepper) | Datenminimierung, keine Drittanbieter-AVV | externer Identity-Provider | mittel |
| ADR-015 | Fragen als YAML in Git, Import als unveränderliche Versionen | Review per PR, Herkunft und Versionierung, Diff-bar | Admin-CMS als einzige Quelle | gering |
| ADR-016 | Regeln als versionierte Daten (`world_rules`), Fristwerte als Snapshot in jeder Belagerung | Balancing ohne Deployment; keine rückwirkenden Änderungen | Umgebungsvariablen, Konstanten im Code | gering |

Status ADR-017 bis ADR-022: *angenommen, 2026-11-09, Schritt 1.0*. ADR-023 setzt eine Entscheidung des Product Owners um.

| ID | Entscheidung | Begründung | Verworfene Alternativen | Kosten einer späteren Änderung |
|---|---|---|---|---|
| ADR-017 | Workspace-Pakete ohne Build-Schritt: Pakete exportieren TypeScript-Quellen (`exports: ./src/index.ts`), Vitest, tsx und Vite laden sie direkt; `tsc --noEmit` prüft je Paket, `game-core` und `protocol` zusätzlich ohne Node-Typen | keine veralteten Build-Stände, schnelle Tests, Laufzeitneutralität von `game-core`/`protocol` wird vom Compiler geprüft | Build je Paket mit Project References | gering (Build für den Server-Container später ergänzbar) |
| ADR-018 | Zufall konkret: HMAC-SHA256 über WebCrypto, `sfc32` aus den ersten 16 Byte (vier Wörter, Big Endian), 12 verworfene Startwerte, Gleitkommawert = `uint32 / 2^32`, Normalverteilung per Box-Muller mit genau zwei Werten; Entitäts-IDs nur ASCII `[A-Za-z0-9._-]`; `RNG_VERSION = 1` | läuft unverändert in Browser und Node, keine Abhängigkeit, feste Ziehungsreihenfolge; ganze Zahlen und `nextFloat` sind bitgenau gleich, Normalwerte nur bis auf Rundung (ECMAScript legt `Math.log`/`Math.cos` nicht bitgenau fest), daher rechnet und protokolliert der Server | Node-`crypto` (nicht im Browser), Mersenne Twister, xoshiro128** | gering bis zu Produktionsdaten, danach nur als neue `rng_version` |
| ADR-019 | Exakte Dezimalarithmetik in `game-core` mit BigInt (`units / 10^scale`); Eingaben kommen als kanonische Zeichenkette aus dem Zahlparser in `protocol`; Gleitkomma → Dezimal (nur NPC-Modell) über `toFixed`, das laut Spezifikation den exakten Binärwert „Hälfte von null weg“ rundet | exakte Abstände und Rundung ohne Bibliothek; `protocol` braucht `game-core` nicht | decimal.js / big.js | gering |
| ADR-020 | Schreibschutz von `game_clock`: Ein Versatz ≠ 0 ist nur erlaubt, wenn die Datenbank selbst `rdw.allow_game_clock_offset = on` trägt (`ALTER DATABASE … SET`; für diese nicht registrierte Einstellung nur Superuser oder wer per `GRANT SET ON PARAMETER` berechtigt wurde, nicht der Datenbankbesitzer, geprüft mit PostgreSQL 16). Der Trigger liest den Katalog, ein `SET` in der Sitzung genügt nicht; Funktionen lösen Namen schemaqualifiziert auf, damit temporäre Tabellen den Katalog oder `game_clock` nicht überdecken, und der Versatz wird über die Textform verglichen (`1 month -30 days` gilt sonst als 0) | Produktion ist ohne Zutun geschützt; Test und Staging schalten den Versatz einmalig frei | Umgebungsvariable der Anwendung (umgehbar), eigene Funktion je Umgebung | gering |
| ADR-021 | Fragendateien: eine Frage je YAML-Datei, Dateiname = stabiler Schlüssel `key`, Feldnamen wie die Tabellenspalten, Dezimalwerte als Zeichenkette, dokumentierte Prüfungen (`reviews`) in der Datei; Testfragen nur unter `content/fixtures/` mit Tag `fixture`, nie freigebbar | Review per Pull Request, Freigaberegel (Brief §5.6) maschinell prüfbar | eine Datei je Kategorie, Datenbank als Quelle | gering |
| ADR-022 | Eigener Migrationsläufer (`pg`): Prüfsumme je Datei, Advisory-Sperre, eine Transaktion je Datei, lückenlose Nummerierung, Abbruch in Produktion ohne `--production-approved`, `APP_ENV` ohne Standardwert, unbekannte Argumente brechen ab | setzt die Läuferregeln aus [DATA_MODEL.md §6](DATA_MODEL.md#6-migrationsstrategie) um (nummeriert, nur vorwärts, Prüfsumme, Produktionsfreigabe); die Schema-Drift-Prüfung (§6.2) folgt mit den Kysely-Typen in Phase 1, Referenzdaten, Backup und Partitionierung (§6.3, §6.5, §6.6) sind Betriebsregeln außerhalb des Läufers | node-pg-migrate, Kysely-Migrator (TypeScript statt SQL) | gering |
| ADR-023 | **Nur Deutsch** (PO-Entscheidung 2026-11-09): Oberfläche, Fragen und Zahleneingabe nur auf Deutsch. `LOCALES = ['de']`; Sprachkennung bleibt in Fragendateien, `player_settings.locale`, API und Zahlparser; mehrsprachige Regeln ([QUIZ_ENGINE.md §4](QUIZ_ENGINE.md#4-mehrsprachigkeit-und-sprach-fairness)) ruhen | weniger Redaktionsaufwand (keine Übersetzungen und muttersprachlichen Prüfungen), keine Sprach-Fairness-Probleme in Duellen; eine weitere Sprache bleibt eine Erweiterung statt ein Umbau | Sprachkennung ganz entfernen (spätere Sprache wäre ein Schema-Umbau); de/hu/en wie im Brief | gering, solange die Sprachkennung bleibt |

Status ADR-024 bis ADR-027: *angenommen, 2026-11-10, Phase 1 Paket 1*.

| ID | Entscheidung | Begründung | Verworfene Alternativen | Kosten einer späteren Änderung |
|---|---|---|---|---|
| ADR-024 | **I13 strukturell:** Verweise auf Regionen, Reiche, NPC-Fraktionen und Belagerungen sind zusammengesetzte Fremdschlüssel über `(…, instance_id)` (Ziele mit `unique(id, instance_id)`); die einfachen Fremdschlüssel aus 0004 sind ersetzt. Kampftabellen ohne `instance_id` hängen über `siege_id` an einer Belagerung, `quiz_answers` trägt dafür `siege_id`. `siege_participants` hat kein `kingdom_id` (steht in `sieges`) | Welttrennung (E2E-12) wird von der Datenbank erzwungen statt von Anwendung und Invariantenjob; Kosten: eine Spalte mehr in einigen Indizes, die Tabellen waren in allen Umgebungen leer. Die in [DATA_MODEL.md §5](DATA_MODEL.md#5-invarianten) offene Messung entfällt damit | nur Anwendungslogik + Invariantenjob; Trigger je Tabelle | mittel |
| ADR-025 | **Eigener Typgenerator** für Kysely (`packages/db/src/codegen.ts`): liest den Katalog einer migrierten Datenbank und schreibt `schema.generated.ts` mit `ColumnType<Lesen, Einfügen, Ändern>` passend zu den Typparsern von `createPool` (`int8`/`numeric` als Zeichenkette, `date` als `JJJJ-MM-TT`, `jsonb` schreiben als JSON-Text). Drift-Prüfung per Integrationstest und `pnpm db:types --check` in der CI | eine Abhängigkeit weniger; die Typen folgen genau den Parsern (z. B. kein `Date` für `date`), deterministische Ausgabe; Kysely-Hilfstypen wie `Generated<ColumnType<…>>` packen verschachtelte Typen nicht aus | kysely-codegen (andere Typzuordnung, zusätzliche Laufzeitabhängigkeit), handgeschriebene Typen | gering |
| ADR-026 | **Fragenimport** (`pnpm content:import`): Dateien sind die Quelle, eine Transaktion mit Advisory-Sperre; Fragen, die in den Dateien fehlen, und freigegebene Versionen bleiben erhalten, nur Optionen, Übersetzungen und Prüfungen eines Entwurfs werden beim Ersetzen gelöscht und neu geschrieben. `content_hash` über den kanonischen Inhalt der Version (ohne Status und Fragenfelder wie Kategorie und Tags; die Reihenfolge von Optionen und Prüfungen zählt nicht, weil die Datenbank sie nicht speichert); IDs als UUIDv7 (`newId` aus `@rdw/db`); Entwürfe werden ersetzt, geänderter Inhalt einer freigegebenen Version wird eine neue Version; höchstens eine freigegebene Version je Frage, sie ist aktuell und die Frage `ACTIVE` (außer `SUSPENDED`). Einfügen immer als Entwurf, Freigabe per `UPDATE`, damit der Datenbank-Trigger die Regeln aus Brief §5.6 noch einmal prüft. Testfragen nur mit `--fixtures` in `local`/`test`; Produktion nur mit `--production-approved`; `--dry-run` rollt zurück | doppelte Prüfung (Werkzeug und Datenbank) der Freigaberegel; Formatierung und Kommentare erzeugen keine Versionen; Kämpfe referenzieren Versionen, deshalb kein Löschen | Import als Upsert ohne Versionen; Freigabe nur im Werkzeug geprüft | gering |
| ADR-027 | **Outbox-Nummern per Trigger:** `world_events.seq` vergibt der Trigger `world_events_seq` beim Einfügen (`world_instances.event_seq + 1` je Zeile, in Einfügereihenfolge); die Anwendung lässt `seq` weg, ein mitgegebener Wert wird abgelehnt. Ersetzt den CTE aus [ARCHITECTURE.md §10](ARCHITECTURE.md#10-echtzeit-und-synchronisation) | Lücken und Doppelungen sind ausgeschlossen, egal welcher Code schreibt; die Sperre auf der Instanzzeile hält wie beim CTE bis zum Commit, Ereignisse werden weiterhin zuletzt geschrieben | CTE in jeder schreibenden Transaktion; Prüfung der übergebenen Nummer im Trigger (verlangt eine Sperre vor dem Lesen des Zählers) | gering |

Status ADR-028 bis ADR-031: *angenommen, 2026-11-10, Phase 1 Paket 2*.

| ID | Entscheidung | Begründung | Verworfene Alternativen | Kosten einer späteren Änderung |
|---|---|---|---|---|
| ADR-028 | **CSRF über strenge `Origin`-Prüfung:** Jede zustandsändernde Anfrage muss `Origin` gleich `PUBLIC_ORIGIN` tragen, ein fehlender Header wird abgelehnt; dazu `SameSite=Lax` (Sitzung) und `SameSite=Strict` (Bootstrap). Kein Double-Submit-Token | Browser senden `Origin` bei jedem `POST`; ein Double-Submit-Token bräuchte ein für Skripte lesbares Cookie, [SECURITY.md §5](SECURITY.md#5-datenschutz-dsgvo) sieht nur zwei `HttpOnly`-Cookies vor. Löst den Widerspruch zwischen API.md §1 („oder“) und SECURITY.md §2 („plus“) | Double-Submit-Token; eigener Header ohne Origin-Prüfung | gering |
| ADR-029 | **Server-Grundgerüst:** Fastify 5 mit `@fastify/cookie`; Eingaben werden in den Routen mit den zod-Schemas aus `protocol` geprüft (keine JSON-Schemas in Fastify); ein Fehlerformat auch für Fehler von Fastify und für wiederholbare Datenbankfehler (`40001`/`40P01` → `CONCURRENT_UPDATE`); Zeitpunkte nur aus `game_now()`; Idempotenz als Beratungssperre auf (Konto, Schlüssel) plus Antwortspeicher in derselben Transaktion, fachliche Fehler werden nicht gespeichert; Sitzungstoken 256 bit, gespeichert als SHA-256 ohne Pepper | ein Schema für Client, Server und Tests; Testzeitversatz wirkt überall; gleichzeitige Wiederholungen warten und liefern dieselbe Antwort; ein Token mit 256 bit Zufall braucht keinen langsamen Hash und keinen Pepper | `fastify-type-provider-zod` (weitere Abhängigkeit), JSON-Schemas doppelt pflegen, Fehler im Antwortspeicher, Anwendungsuhr | gering |
| ADR-030 | **Beitritt und Startregion:** Der Beitritt sperrt die Instanzzeile und wählt über einen Schnappschuss der ganzen Instanz (genügt für die Testwelt; große Eternal-Welten brauchen die Kandidatenliste aus WORLD_SYSTEM §3.2 Schritt 5). Zufallsstrom `spawn` je `{instance}.{user}.{generation}` für Gleichstand, Name und Farbe in dieser Reihenfolge; Prüfspur (Kandidaten, Punktwert, Schlüssel-ID, `RNG_VERSION`) in `kingdom_history`. Die Startregion wird bedingt übernommen (noch neutral, keine Belagerung), sonst `CONCURRENT_UPDATE`. NPC-Namen und -Farben aus dem öffentlichen Welt-Seed | gleichzeitige Beitritte können sich nicht dieselbe Region oder zu nahe Hauptstädte zuteilen; jede Wahl ist mit dem Geheimnis nachrechenbar (Test vorhanden); Welterzeugung braucht kein Geheimnis | Zeilensperren auf allen Kandidaten; Zufall aus der Datenbank | gering (Kandidatenliste kommt mit der Chunk-Freischaltung) |
| ADR-031 | **Kartenversion je Instanz:** `world_instances.mapgen_version` (Migration 0008, ohne Standardwert). Welten entstehen über `pnpm world:create` (Testwelt als Eternal-Welt, Produktion nur mit `--production-approved`); die Ausgangslage steht nicht in `region_history` | spätere Ringe müssen mit derselben Generatorversion entstehen; die Historie beginnt mit der ersten Änderung | Version nur im Code; Ausgangslage als Historieneinträge | gering |

Status ADR-032 bis ADR-035: *angenommen, 2026-11-10, Phase 1 Paket 3*.

| ID | Entscheidung | Begründung | Verworfene Alternativen | Kosten einer späteren Änderung |
|---|---|---|---|---|
| ADR-032 | **Angriff in einer Transaktion mit versiegelten Gegenantworten:** `POST /attacks` läuft im Idempotenz-Wrapper (ADR-029); Berechtigung wird vor und nach den Sperren (Reiche aufsteigend → `region_state` → Belagerung, [SIEGE_SYSTEM.md §5.1](SIEGE_SYSTEM.md#51-feste-sperrreihenfolge-e)) gelesen, eine Abweichung ergibt `CONCURRENT_UPDATE`. Belagerung mit Regelschnappschuss, Reservierung, Teilnehmer, Fragen und beide Schritte entstehen zusammen; die Antworten von Garnison (`GARRISON_START` bis Stufe 2, sonst `GARRISON_Txx`) bzw. NPC-Reich (Profil der Fraktion) werden sofort aus dem Strom `npc-answer:{challengeId}` erzeugt, als `GENERATED` gespeichert und mit `NPC_ANSWERS_SEALED` samt SHA-256-Commitment protokolliert. Ziele im Spielerbesitz lehnt Phase 1 mit `PVP_NOT_AVAILABLE` ab | Gegenantworten stehen nachweisbar vor der ersten Frage fest ([SIEGE_SYSTEM.md §2](SIEGE_SYSTEM.md#2-ablauf-pve-sofortige-auswertung)); doppelte Prüfung schließt Wettläufe zwischen Lesen und Sperren aus, ohne die Sperren lange zu halten | NPC-Antwort erst bei der Auswertung erzeugen (nicht belegbar), Prüfung nur unter Sperre (längere Sperrzeit) | gering |
| ADR-033 | **Herausforderungsprotokoll:** `present` braucht keinen `Idempotency-Key` (wiederholbar: dieselbe Frage, dieselben Token, ursprüngliches `P`, Ereignis `STEP_RELOADED`, danach zählt nur die Serverzeit); Schritt 0 setzt `attack_presented_at` (ab da zählt der Versuch), Schritt 1 wird in der Antwort auf Schritt 0 gestellt. `answer` liest die Eingangszeit vor jeder Sperre und arbeitet in zwei Transaktionen: A speichert unter Zeilensperre der Antwort mit bedingtem Wechsel `PRESENTED → ANSWERED` (Idempotenz über `quiz_answers.idempotency_key`), B wertet mit `settleSiege` unter den Sperren aus. Ein verpasster Schritt wird erst ab Frist + `settleGrace` `TIMED_OUT`; ein verpasster Schritt 0 beendet den Kampf ohne Schätzfrage. Wer 120 s nach dem Angriff nichts geöffnet hat, verliert den Angriff ohne Versuch (`ATTACK_FAILED`/`NEVER_STARTED`) | Speichern blockiert nie auf der Auswertung; Reload kann die Frist nicht verlängern und keine neue Frage erzwingen; die Auswertung ist idempotent und kann von Antwort, Lesezugriff und Aufräumlauf gleichermaßen angestoßen werden | eine Transaktion für Speichern und Auswerten (längere Sperren), `Idempotency-Key` auch für `present` (zusätzliches Geheimnis ohne Nutzen) | gering |
| ADR-034 | **Aufräumlauf im `api`-Prozess bis zum Worker:** `expireStaleChallenges` läuft minütlich (höchstens 100 Kämpfe je Lauf, kein überlappender Lauf) und wird beim Beenden gestoppt; zusätzlich lösen Herausforderung lesen, `present`, Regionsdetails und ein neuer Angriff die fälligen Kämpfe des Spielers auf. Mit dem Worker (Phase 3) zieht der Lauf als Job `challenge.expireStale` um | liegen gebliebene Reservierungen blockieren Regionen; der Worker ist erst für PvP-Fristen nötig | Worker schon jetzt (zweiter Prozess ohne weiteren Nutzen), nur Auflösung beim Lesen (verwaiste Kämpfe ohne Leser bleiben offen) | gering |
| ADR-035 | **Fragenauswahl konkret:** Strom `question-pick:{siegeId}`; Schwierigkeitsklassen gewichtet nach Regionsstufe (0–2: 0,7/0,25/0,05, 3–6: 0,3/0,4/0,3, 7–10: 0,05/0,25/0,7), erste Eroberung nur leicht; die drei zuletzt gestellten Kategorien mit Gewicht 0,4; Ausschlussfenster 90 → 30 → 7 Tage, dann die am längsten nicht gesehene Frage; Auswahl unabhängig von der Reihenfolge der Kandidaten; Exposition wird beim Stellen gespeichert; Testfragen nur in `local` und `test`. Expositionsbegrenzung (§5 Punkt 5) folgt mit den Fragenstatistiken | reproduzierbar mit dem Geheimnis, abwechslungsreich auch mit 40 Testfragen | Auswahl per Datenbank-`random()` (nicht nachvollziehbar) | gering |
| ADR-036 | **Schlanker Client für Phase 1:** eigenes typisiertes Übersetzungsmodul (`apps/web/src/i18n`: Schlüssel als Pfade in `de.ts`, Tippfehler sind Compilerfehler, Pluralformen über `Intl.PluralRules`, Zahlen und Zeiten über `Intl`) statt i18next; ein kleiner eigener Router für drei Routen statt React Router; Serverzustand in React-Zustand und kleinen Hooks statt TanStack Query/Zustand; Vite ohne React-Plugin (JSX über oxc, ohne Fast Refresh). Kein WebSocket in Phase 1: die Karte lädt alle 30 s und nach eigenen Aktionen neu, Ereignisse folgen mit PvP in Phase 2. Ein offener Kampf steht in `/me` (`openChallengeId`), damit der Client nach einem Reload ins Quiz zurückkehrt. E2E-Tests starten Testdatenbank, `api` und den gebauten Client (`vite preview`) in einem Prozess; nur der Test liest die richtigen Antworten aus der Datenbank | mit nur Deutsch (ADR-023) und ohne Gegenspieler bringen die Bibliotheken keinen Nutzen, aber Abhängigkeiten; geprüfte Schlüssel und ein Vollständigkeitstest gegen alle Fehlercodes ersetzen die Laufzeitprüfung von i18next; ohne Gegenspieler ändert sich die Karte fast nur durch eigene Aktionen | i18next/react-i18next (ARCHITECTURE §2, vertagt bis zur zweiten Sprache: die Schlüssel bleiben gleich), React Router, TanStack Query, WebSocket schon in Phase 1 | gering (Schlüssel und Komponenten bleiben; Austausch der Hilfsfunktionen) |

## Offene Entscheidungen

Priorisiert nach Dringlichkeit (P1 = vor/in Phase 1–2, P2 = vor Phase 3–4 bzw. Closed Beta, P3 = später) und Wirkung. Jede Entscheidung hat eine Empfehlung; bis zur Entscheidung wird die Empfehlung als konfigurierbare Standardannahme umgesetzt.

### O-01 Angreifer-Gate statt Fall D

**Status: entschieden am 2026-11-09 durch den Product Owner – Option A als verdecktes Gate.** Der Angreifer muss die Trivia-Frage richtig beantworten, sonst scheitert der Angriff. Die Belagerung wird trotzdem eröffnet, damit der Verteidiger sich verteidigen kann; verteidigt er sich, erhält er Punkte. Verteidigt er sich nicht und läuft die Frist ab, ist der Angriff fehlgeschlagen, wenn der Angreifer falsch lag. Umsetzung: [GAME_RULES.md §5.2 und §5.5](GAME_RULES.md#52-entscheidungsreihenfolge), Wert und Nutzen der Punkte: [O-18].

**Priorität:** P1 · **Wirkung:** Fairness, Kernmechanik · **Brief:** §5.1 Schritt 7, §5.3 Fall D

**Frage:** Muss der Angreifer die Trivia-Frage richtig beantworten, damit sein Angriff weitergeht?

| Option | Beschreibung | Bewertung |
|---|---|---|
| **A (gewählt): verdecktes Gate** | Angreifer falsch → Angriff scheitert, Verteidiger behält das Gebiet; im PvP wird die Belagerung trotzdem eröffnet, und niemand erfährt vor der Auflösung, dass der Angreifer falsch lag | voll asynchron, nur 2 Fragen pro Kampf, Fall D entfällt, jede Eroberung setzt Wissen voraus (Prinzip 1), kein „unverdienter“ Timeout-Sieg; falsche Angriffe belegen bis zur Auflösung Belagerungsplätze ([RISKS.md](RISKS.md) R-01) |
| B: Schätzfrage auch bei „beide falsch“ | Gleiches Trivia-Ergebnis (beide richtig *oder* beide falsch) → Schätzfrage → Zeit | asynchron, aber Angreifer kann ohne richtige Antwort erobern (auch per Timeout) |
| C: Brief-Vorschlag (bis zu 3 Runden) | beide falsch → neue Trivia-Runde, max. 3, dann Besitzer | in PvP nur möglich, wenn der Angreifer vorab bis zu 3 Trivia-Fragen + Schätzfrage beantwortet (mehr Aufwand, mehr Fragenverbrauch) oder zurückkehren muss |

**Empfehlung (umgesetzt):** A als verdecktes Gate, für alle Modi einheitlich (siehe Status). `resolveDuel` implementiert das Gate fest, ohne Schalter ([QUIZ_ENGINE.md §8](QUIZ_ENGINE.md#8-duellauswertung)).

### O-02 Fragenbeschaffung und Redaktion

**Priorität:** P1 · **Wirkung:** Qualität, Fairness, größter laufender Aufwand · **Brief:** §5.6, §19 J

**Status: vertagt am 2026-11-09 durch den Product Owner.** Phase 1 läuft mit den 40 KI-Testfragen (DRAFT, nie veröffentlichbar); wer echte Fragen erstellt und prüft, wird vor der Beta geklärt. Gespielt wird nur auf Deutsch (ADR-023), Übersetzungen entfallen.

**Frage:** Wer erstellt und prüft die Fragen, und in welchem Umfang?
**Empfehlung:** KI-gestützte Entwürfe durch Claude in YAML, faktische Prüfung mit Quelle und sprachliche Prüfung auf Deutsch durch den Product Owner oder beauftragte Personen. Ziel 150 Fragen für den Abschluss von Phase 1, ≈ 650 für die Closed Beta ([QUIZ_ENGINE.md §9](QUIZ_ENGINE.md#9-inhaltspipeline-und-umfang)). Zu klären: Wer prüft, gibt es ein Budget für externes Lektorat?

### O-03 Kontomodell und Anmeldung

**Priorität:** P1 · **Wirkung:** Einstieg, Datenschutz · **Brief:** §14.2, §15.1
**Empfehlung:** Sofort spielbar als Gast (dauerhafte Sitzung); Upgrade auf Konto mit Benutzername + Passwort, E-Mail optional (für Wiederherstellung und spätere E-Mail-Hinweise). OAuth-Anbieter und Magic Links erst später (Anbieter-AVV, Kosten). Gastkonten ohne Aktivität werden nach 90 Tagen gelöscht.

### O-04 Benachrichtigungskanäle

**Priorität:** P2 (vor Phase 3) · **Wirkung:** Fairness der 24-h-Frist · **Brief:** §7.1, §16 Phase 3
**Empfehlung:** Web Push (kostenlos, ohne Drittanbieter-Konto) ab Phase 3; Installation als PWA auf iOS erklären, da Safari Push nur für installierte Web-Apps erlaubt. E-Mail-Hinweise erst mit Versanddienst (Kosten, AVV) nach der Closed Beta.

### O-05 Belagerungskapazität großer Reiche

**Priorität:** P2 · **Wirkung:** Balance, Prinzip 4 · **Brief:** §7.4, §7.5, §19 A
**Frage:** Bleibt die Zahl gleichzeitig offener Belagerungen pro Reich fest bei 4 oder wächst sie mit der Reichsgröße?
**Empfehlung:** Für die Beta fest 4. Simulation in Phase 3 mit größenabhängiger Variante (z. B. `3 + floor(Regionen / 25)`, max. 8). Entscheidung nach Beta-Daten.

### O-06 Urlaubsmodus und kontrollierte Maximalverluste

**Priorität:** P3 (nach Closed Beta, mit Beta-Daten zu Timeout-Verlusten) · **Wirkung:** Prinzip 3, Bindung · **Brief:** §19 E
**Frage:** Soll es einen Urlaubsmodus geben?
**Empfehlung:** Ja, nach der Beta: aktivierbar nur ohne offene Belagerungen, mindestens 3 Tage Vorlaufzeit bis zur Wirkung, Dauer 3–21 Tage, danach Abklingzeit; während des Urlaubs keine Angriffe gegen und durch das Reich. Bis dahin begrenzt die Kappung nur die Zahl gleichzeitig offener Belagerungen (4), nicht die Gesamtzahl möglicher Verluste: Verteidigte Belagerungen geben ihren Platz vor Fristablauf frei. Bei völliger Abwesenheit ergibt sie im Mittel höchstens ≈ 4 Timeout-Verluste je 24 h.

### O-07 Neulings- und Rangabstandsschutz

**Priorität:** P2 · **Wirkung:** Einstieg, Fairness · **Brief:** §7.4, §10.1
**Empfehlung:** Anfängerschutz 72 h oder bis 10 Regionen oder bis zum eigenen ersten PvP-Angriff; Rangabstandsschutz (≥ 4× größer darf < 15 Regionen nicht angreifen). Werte in der Beta beobachten.

### O-08 PvE-Expansionstempo

**Priorität:** P2 · **Wirkung:** Progression, Kartenverbrauch
**Frage:** Sollen PvE-Angriffe pro Tag begrenzt sein?
**Empfehlung:** Ja, 50 Versuche pro 24 h. Sonst können Vielspieler in wenigen Tagen große Kartenteile besetzen, und der Abstand zu Gelegenheitsspielern wird zu groß. Wert in der Beta justieren.

### O-09 Drops bei Siegen durch Zeitablauf

**Priorität:** P2 (vor Phase 4) · **Wirkung:** Anti-Farming · **Brief:** §8.5, §13.3
**Empfehlung:** halbe Drop-Gewichte bei Timeout-Siegen; volle nur bei Verteidigern, die mindestens 7 Tage aktiv und nicht verdächtig verknüpft sind ([ITEM_SYSTEM.md §5](ITEM_SYSTEM.md#5-anti-farming), Q7); höchstens 2 belohnte Siege gegen denselben Gegner pro 24 h.

### O-10 Öffentliche Namen

**Priorität:** P2 (vor Phase 2) · **Wirkung:** Moderation, Recht · **Brief:** §14.3
**Empfehlung:** Generierte Spieler- und Reichsnamen aus deutschen Bausteinen (ADR-023), auswählbar aus Vorschlägen. Freie Namen erst mit Melde- und Moderationsprozess.

### O-11 Hosting und Staging (kostenpflichtig)

**Priorität:** P2 (Phase 2 für echte Tester, spätestens Closed Beta) · **Wirkung:** Kosten, Betrieb · **Brief:** §20
**Empfehlung:** Ein EU-Server (VPS) mit Docker für `api` + `worker` + Postgres, tägliche verschlüsselte Backups außerhalb des Servers; Größenordnung niedriger zweistelliger Eurobetrag pro Monat. Alternativ verwaltetes Postgres (z. B. Supabase oder Anbieter mit EU-Region) + kleiner App-Server. Serverlose Plattformen nur für den statischen Client. **Benötigt Freigabe** – vorher wird nichts angelegt.

### O-12 Markenname

**Priorität:** P2 (vor öffentlicher Nutzung des Namens) · **Wirkung:** Recht, Marke · **Brief:** Kopf, §14.1
**Empfehlung:** Markenrecherche für „Reiche des Wissens“ vor Domainkauf und öffentlicher Beta; bis dahin Arbeitstitel nur intern.

### O-13 NPC-Angriffe auf Spieler

**Priorität:** P3 (Phase 5) · **Brief:** §6.4, §7.4
**Empfehlung:** max. 1 offene NPC-Belagerung pro Reich, max. 1 neue pro 24 h, nur wenn ≤ 2 Belagerungen offen; bevorzugt gegen größere Reiche ([NPC_SYSTEM.md §5.3](NPC_SYSTEM.md#53-schutz-der-spieler-vor-npc-druck-vorschlag-zu-o-13-e)).

### O-14 Provinzverteidigung

**Priorität:** P3 · **Brief:** §7.5 (offene PO-Entscheidung)
**Empfehlung:** Einzelverteidigung mit Kappung für MVP und Beta. Provinzen später als **Verwaltungs**einheit (Priorisierung, gemeinsame Item-Nutzung); gebündelte Verteidigung nur, wenn Beta-Daten zeigen, dass große Reiche überfordert sind. Datenmodell ist vorbereitet (`regions.province_id`).

### O-15 Inaktivität und Verfall

**Priorität:** P3 (Phase 5) · **Brief:** §3.1, §19 C
**Empfehlung:** Stufenmodell ruhend (7 d) → verfallend (30 d, eine Randregion pro Tag) → aufgelöst (180 d), Konto bleibt ([WORLD_SYSTEM.md §5](WORLD_SYSTEM.md#5-inaktivität-und-rückführung-vorschlag-zu-o-15)).

### O-16 Daily/Weekly: Wertung und Angriffsschluss

**Priorität:** P3 (Phase 6) · **Brief:** §3.2, §3.3
**Empfehlung:** PvP-Angriffsschluss = Saisonende − maximale Frist − maximale Angriffsdauer, bei Eröffnung erneut geprüft; Punkte aus gehaltenen Regionen, Hauptstadt und PvP-Siegen ([WORLD_SYSTEM.md §6](WORLD_SYSTEM.md#6-daily-und-weekly)).

### O-17 Live-Duelle

**Priorität:** P3 · **Brief:** §3.2
**Empfehlung:** Nach Phase 6 als eigenes Feature mit Matchmaking; Daily funktioniert bis dahin mit 15-min-Asynchronfrist.

### O-18 Verteidigungspunkte: Wert, Nutzen, Absprachenschutz

**Priorität:** P2 (vor Phase 2) · **Wirkung:** Progression, Fairness, Anti-Farming · **Herkunft:** PO-Entscheidung zu O-01
**Teilweise entschieden (PO, 2026-11-09):** Jede eigene Verteidigung bringt Punkte dafür, dass der Verteidiger das Quiz gemacht hat; wer die Trivia-Frage richtig beantwortet hat, bekommt mehr. Die Punkte gibt es auch, wenn das Gebiet trotzdem verloren geht.
**Richtung für den Nutzen (PO, 2026-11-09, noch nicht entschieden):** eher für Kosmetik oder dafür, anderen Spielern Emojis zu schicken; kein Spielvorteil.
**Noch offen:** genaue Werte, genauer Nutzen, und wie Absprachen verhindert werden (ein befreundeter Angreifer greift an oder antwortet absichtlich falsch, damit der Verteidiger Punkte erhält).
**Empfehlung:** Eternal 5 Verteidigungspunkte für die Teilnahme, +5 bei richtiger Trivia-Antwort (höchstens 10), nur Ansehen (Reichs- und Spielerprofil, Rangliste „Verteidiger“), kein spielmechanischer Vorteil; Daily/Weekly 2 Saisonpunkte, +3 bei richtiger Antwort (höchstens 5 wie eine Eroberung). Die Punkte hängen nur von der eigenen Leistung des Verteidigers ab, nicht vom Ausgang, und verraten deshalb nichts über die Angreiferleistung. Höchstens 2 punktbringende Verteidigungen je Paar und 24 h, keine Punkte bei verdächtig verknüpften Konten ([GAME_RULES.md §5.5](GAME_RULES.md#55-verteidigungspunkte-v-grundsatz-e-werte-o-18)). Werden Punkte ausgegeben, dann aus einem eigenen Guthaben mit nur anhängbarem Buchungsprotokoll und atomarer Abbuchung (Prüfung `Guthaben ≥ Betrag` in derselben Anweisung); der Ranglisten- bzw. Saisonwert ist davon getrennt und sinkt nie. Ausgearbeitet wird das, sobald der Nutzen entschieden ist. Emojis nur aus einer festen Auswahl ohne Freitext, mit Ratenbegrenzung und Abschaltmöglichkeit für den Empfänger. Punkte sind nicht gegen Echtgeld erhältlich: Das Spiel startet ohne Monetarisierung, und kosmetische Monetarisierung bräuchte eine eigene Produkt- und Rechtsprüfung (Brief §14.4).

### O-19 Schätzfrage als Tiebreaker im PvP

**Priorität:** P1 (vor Phase 2) · **Wirkung:** Ablauf, Fairness, verdecktes Gate · **Herkunft:** PO-Entscheidung 2026-11-10
**Entschieden (PO, 2026-11-10):** Die Schätzfrage kommt nur, wenn beide Seiten die Trivia-Frage richtig haben; Angreifer richtig und Verteidiger falsch erobert, Angreifer falsch scheitert ([GAME_RULES.md §5.1](GAME_RULES.md#51-ablauf-einer-herausforderung-ve)). Im PvE umgesetzt: Die Verteidigung steht dort vorab versiegelt fest.
**Offen für PvP:** Der Angreifer antwortet zuerst, der Verteidiger erst innerhalb der Frist. Beim Angreifer steht noch nicht fest, ob der Verteidiger richtig liegt; beim Verteidiger würde das Erscheinen der Schätzfrage verraten, dass der Angreifer richtig lag (verdecktes Gate, [O-01]).
- **A:** Im PvP beantworten beide weiterhin beide Fragen; die Schätzung zählt nur bei Gleichstand (Auswertung wie heute, Oberfläche sagt „zählt nur, wenn ihr beide richtig liegt“). Verrät nichts, kostet aber 30 s für eine oft unnötige Frage.
- **B:** Nur wer selbst richtig liegt, bekommt die Schätzfrage. Verrät jedem Teilnehmer sofort die eigene Richtigkeit und dem Verteidiger nichts über den Angreifer; widerspricht aber „keine Rückmeldung zur eigenen Trivia-Antwort“ (QUIZ_ENGINE §7.2).
- **C:** Schätzfrage als eigene dritte Runde nach der Verteidigung, nur bei Gleichstand, mit neuer Frist für beide. Genau wie gewünscht, aber jeder knappe Kampf dauert eine weitere Frist.
**Empfehlung:** A für PvP (verdecktes Gate bleibt vollständig, kein zusätzlicher Rückweg), PvE wie entschieden.

## Änderungsprotokoll

| Datum | Änderung |
|---|---|
| 2026-11-09 | Phase 0: ADR-001 bis ADR-016 angenommen, O-01 bis O-17 erfasst |
| 2026-11-09 | Schritt 1.0: ADR-017 bis ADR-022 angenommen (Pakete ohne Build, Zufall, Dezimalarithmetik, Schreibschutz der Spielzeit, Fragendateien, Migrationsläufer) |
| 2026-11-09 | PO: Spiel nur auf Deutsch (ADR-023); O-02 vertagt, Phase 1 mit Testfragen |
| 2026-11-09 | Review-Korrekturen in PR #2: Spieluhr-Schutz gegen Kalenderversatz und überdeckende temporäre Tabellen, `APP_ENV` Pflicht, Transaktionsprüfung des Migrationsläufers über die ganze Datei, zusammengesetzte Fremdschlüssel (Welt, Region), Protokolle ohne UPDATE, TRUNCATE-Schutz, alle Fremdschlüssel indiziert |
| 2026-11-09 | O-01 entschieden (PO): verdecktes Angreifer-Gate mit Verteidigungspunkten; O-18 neu erfasst |
| 2026-11-09 | O-18 teilweise entschieden (PO): Punkte für jede eigene Verteidigung, mehr bei richtiger Trivia-Antwort, auch bei Gebietsverlust |
| 2026-11-09 | O-18 Richtung (PO): Punkte voraussichtlich für Kosmetik oder Emojis an andere Spieler, kein Spielvorteil |
| 2026-11-09 | O-18 Empfehlung ergänzt: Ausgeben nur aus eigenem Guthaben mit Buchungsprotokoll, Ranglistenwert sinkt nie; Emojis nur aus fester Auswahl; Punkte nicht gegen Echtgeld (Brief §14.4) |
| 2026-11-09 | Weitere Review-Korrekturen in PR #1: Gast-Anmeldung über `HttpOnly`-Bootstrap-Cookie, Kontolöschung in einer gesperrten Transaktion mit `ON DELETE RESTRICT`, Aufschub der Löschung bei laufendem Prüfverfahren [E] |
| 2026-11-09 | Review-Korrekturen in PR #1: einheitliche Fristgrenze mit Abwicklungspuffer, Regionsreservierung, lückenlose Ereignisfolge, `Idempotency-Key` für alle Kommandos, Rollen je Admin-Endpunkt, Löschkaskade; O-06 auf P3 (nach Beta) verschoben; O-01-Schalter auf Optionen A/B präzisiert |
| 2026-11-10 | Phase 1 Paket 1: ADR-024 bis ADR-027 angenommen (I13 über zusammengesetzte Fremdschlüssel, eigener Typgenerator, Fragenimport, Outbox-Nummern per Trigger) |
| 2026-11-10 | Phase 1 Paket 2: ADR-028 bis ADR-031 angenommen (CSRF über Origin-Prüfung, Server-Grundgerüst, Beitritt und Startregion, Kartenversion je Instanz) |
| 2026-11-10 | Phase 1 Paket 3: ADR-032 bis ADR-035 angenommen (Angriff mit versiegelten Gegenantworten, Herausforderungsprotokoll, Aufräumlauf im `api`-Prozess, Fragenauswahl) |
| 2026-11-10 | Phase 1 Paket 4: ADR-036 angenommen (schlanker Client ohne i18next, Router- und Query-Bibliothek, ohne WebSocket in Phase 1) |
| 2026-11-10 | ADR-014 durch ADR-029 präzisiert: Sitzungstoken mit 256 bit Zufall als SHA-256 ohne Pepper (Argon2id bleibt für Passwörter) |
| 2026-11-10 | PO: Schätzfrage nur als Tiebreaker, wenn beide Seiten die Trivia-Frage richtig haben; im PvE umgesetzt, O-19 (Ablauf im PvP) neu erfasst |
