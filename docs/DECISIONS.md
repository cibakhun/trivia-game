# Entscheidungen

Zwei Teile: **Architekturentscheidungen**, die Claude im Rahmen der Entscheidungsautonomie (Brief §20) getroffen hat, und **offene Entscheidungen**, die der Product Owner treffen sollte. Jede Änderung wird hier mit Datum nachgetragen.

## Architekturentscheidungen (ADR)

Status aller ADRs: *angenommen, 2026-11-09, Phase 0*. Revidierbar, solange der jeweilige Teil noch nicht produktiv ist.

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
| ADR-014 | Eigene Sitzungsverwaltung (Token-Hash in DB, Argon2id) | Datenminimierung, keine Drittanbieter-AVV | externer Identity-Provider | mittel |
| ADR-015 | Fragen als YAML in Git, Import als unveränderliche Versionen | Review per PR, Herkunft und Versionierung, Diff-bar | Admin-CMS als einzige Quelle | gering |
| ADR-016 | Regeln als versionierte Daten (`world_rules`), Fristwerte als Snapshot in jeder Belagerung | Balancing ohne Deployment; keine rückwirkenden Änderungen | Umgebungsvariablen, Konstanten im Code | gering |

Status ADR-017 bis ADR-022: *angenommen, 2026-11-09, Schritt 1.0*.

| ID | Entscheidung | Begründung | Verworfene Alternativen | Kosten einer späteren Änderung |
|---|---|---|---|---|
| ADR-017 | Workspace-Pakete ohne Build-Schritt: Pakete exportieren TypeScript-Quellen (`exports: ./src/index.ts`), Vitest, tsx und Vite laden sie direkt; `tsc --noEmit` prüft je Paket, `game-core` und `protocol` zusätzlich ohne Node-Typen | keine veralteten Build-Stände, schnelle Tests, Laufzeitneutralität von `game-core`/`protocol` wird vom Compiler geprüft | Build je Paket mit Project References | gering (Build für den Server-Container später ergänzbar) |
| ADR-018 | Zufall konkret: HMAC-SHA256 über WebCrypto, `sfc32` aus den ersten 16 Byte (vier Wörter, Big Endian), 12 verworfene Startwerte, Gleitkommawert = `uint32 / 2^32`, Normalverteilung per Box-Muller mit genau zwei Werten; Entitäts-IDs nur ASCII `[A-Za-z0-9._-]`; `RNG_VERSION = 1` | läuft unverändert in Browser und Node, keine Abhängigkeit, feste Ziehungsreihenfolge | Node-`crypto` (nicht im Browser), Mersenne Twister, xoshiro128** | gering bis zu Produktionsdaten, danach nur als neue `rng_version` |
| ADR-019 | Exakte Dezimalarithmetik in `game-core` mit BigInt (`units / 10^scale`); Eingaben kommen als kanonische Zeichenkette aus dem Zahlparser in `protocol`; Gleitkomma → Dezimal (nur NPC-Modell) über `toFixed`, das laut Spezifikation den exakten Binärwert „Hälfte von null weg“ rundet | exakte Abstände und Rundung ohne Bibliothek; `protocol` braucht `game-core` nicht | decimal.js / big.js | gering |
| ADR-020 | Schreibschutz von `game_clock`: Ein Versatz ≠ 0 ist nur erlaubt, wenn die Datenbank selbst `rdw.allow_game_clock_offset = on` trägt (`ALTER DATABASE … SET`, ab PostgreSQL 15 nur Superuser). Der Trigger liest den Katalog, ein `SET` in der Sitzung genügt nicht | Produktion ist ohne Zutun geschützt; Test und Staging schalten den Versatz einmalig frei | Umgebungsvariable der Anwendung (umgehbar), eigene Funktion je Umgebung | gering |
| ADR-021 | Fragendateien: eine Frage je YAML-Datei, Dateiname = stabiler Schlüssel `key`, Feldnamen wie die Tabellenspalten, Dezimalwerte als Zeichenkette, dokumentierte Prüfungen (`reviews`) in der Datei; Testfragen nur unter `content/fixtures/` mit Tag `fixture`, nie freigebbar | Review per Pull Request, Freigaberegel (Brief §5.6) maschinell prüfbar | eine Datei je Kategorie, Datenbank als Quelle | gering |
| ADR-022 | Eigener Migrationsläufer (`pg`): Prüfsumme je Datei, Advisory-Sperre, eine Transaktion je Datei, lückenlose Nummerierung, Abbruch in Produktion ohne `--production-approved` | genau die Regeln aus [DATA_MODEL.md §6](DATA_MODEL.md#6-migrationsstrategie) in wenigen Zeilen | node-pg-migrate, Kysely-Migrator (TypeScript statt SQL) | gering |

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

**Frage:** Wer erstellt und prüft die Fragen in drei Sprachen, und in welchem Umfang?
**Empfehlung:** KI-gestützte Entwürfe durch Claude in YAML, faktische Prüfung mit Quelle, muttersprachliche Prüfung für hu und de durch den Product Owner oder beauftragte Personen; en durch eine zweite Person. Ziel 150 Fragen für Phase 1, ≈ 650 für die Closed Beta ([QUIZ_ENGINE.md §9](QUIZ_ENGINE.md#9-inhaltspipeline-und-umfang)). Zu klären: Wer prüft, gibt es ein Budget für externe Lektorate?

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
**Empfehlung:** Generierte Spieler- und Reichsnamen aus Bausteinen (de/hu/en), auswählbar aus Vorschlägen. Freie Namen erst mit Melde- und Moderationsprozess.

### O-11 Hosting und Staging (kostenpflichtig)

**Priorität:** P2 (Phase 2 für echte Tester, spätestens Closed Beta) · **Wirkung:** Kosten, Betrieb · **Brief:** §20
**Empfehlung:** Ein EU-Server (VPS) mit Docker für `api` + `worker` + Postgres, tägliche verschlüsselte Backups außerhalb des Servers; Größenordnung niedriger zweistelliger Eurobetrag pro Monat. Alternativ verwaltetes Postgres (z. B. Supabase oder Anbieter mit EU-Region) + kleiner App-Server. Serverlose Plattformen nur für den statischen Client. **Benötigt Freigabe** – vorher wird nichts angelegt.

### O-12 Markenname

**Priorität:** P2 (vor öffentlicher Nutzung des Namens) · **Wirkung:** Recht, Marke · **Brief:** Kopf, §14.1
**Empfehlung:** Markenrecherche für „Reiche des Wissens“ und die ungarische/englische Entsprechung vor Domainkauf und öffentlicher Beta; bis dahin Arbeitstitel nur intern.

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

## Änderungsprotokoll

| Datum | Änderung |
|---|---|
| 2026-11-09 | Phase 0: ADR-001 bis ADR-016 angenommen, O-01 bis O-17 erfasst |
| 2026-11-09 | Schritt 1.0: ADR-017 bis ADR-022 angenommen (Pakete ohne Build, Zufall, Dezimalarithmetik, Schreibschutz der Spielzeit, Fragendateien, Migrationsläufer) |
| 2026-11-09 | O-01 entschieden (PO): verdecktes Angreifer-Gate mit Verteidigungspunkten; O-18 neu erfasst |
| 2026-11-09 | O-18 teilweise entschieden (PO): Punkte für jede eigene Verteidigung, mehr bei richtiger Trivia-Antwort, auch bei Gebietsverlust |
| 2026-11-09 | O-18 Richtung (PO): Punkte voraussichtlich für Kosmetik oder Emojis an andere Spieler, kein Spielvorteil |
| 2026-11-09 | O-18 Empfehlung ergänzt: Ausgeben nur aus eigenem Guthaben mit Buchungsprotokoll, Ranglistenwert sinkt nie; Emojis nur aus fester Auswahl; Punkte nicht gegen Echtgeld (Brief §14.4) |
| 2026-11-09 | Weitere Review-Korrekturen in PR #1: Gast-Anmeldung über `HttpOnly`-Bootstrap-Cookie, Kontolöschung in einer gesperrten Transaktion mit `ON DELETE RESTRICT`, Aufschub der Löschung bei laufendem Prüfverfahren [E] |
| 2026-11-09 | Review-Korrekturen in PR #1: einheitliche Fristgrenze mit Abwicklungspuffer, Regionsreservierung, lückenlose Ereignisfolge, `Idempotency-Key` für alle Kommandos, Rollen je Admin-Endpunkt, Löschkaskade; O-06 auf P3 (nach Beta) verschoben; O-01-Schalter auf Optionen A/B präzisiert |
