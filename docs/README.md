# Dokumentation – Reiche des Wissens (Arbeitstitel)

Stand: Schritt 1.0 (Grundlagen) umgesetzt, 2026-11-09; Spiel nur auf Deutsch (ADR-023). Planung aus Phase 0; Code unter `packages/`, `tools/`, `content/`.
Anforderungsbasis: [`brief/PRD-0.1.md`](brief/PRD-0.1.md) (Original-Briefing des Product Owners, unverändert).

## Lesereihenfolge

| # | Dokument | Inhalt |
|---|---|---|
| 1 | [REPO_AUDIT.md](REPO_AUDIT.md) | Ausgangslage: Repository, vorhandene Infrastruktur, Werkzeuge |
| 2 | [PRODUCT_VISION.md](PRODUCT_VISION.md) | Vision, Prinzipien, Nicht-Ziele, Erfolgskriterien |
| 3 | [MVP.md](MVP.md) | **Definition des ersten spielbaren MVP** und der Zwischenmeilensteine |
| 4 | [GAME_RULES.md](GAME_RULES.md) | Regelwerk mit Kennzeichnung (verbindlich / Annahme / Empfehlung / offen) und Parametertabelle |
| 4a | [MATCH_RULES.md](MATCH_RULES.md) | **Regelwerk der rundenbasierten Partie** (Hauptspiel seit 2026-11-10, ADR-046) mit Parametertabelle und Simulationswerten; Ausbau mit Burgen, Dörfern und Armeen in §11 (ADR-057, Server ADR-058) |
| 5 | [ARCHITECTURE.md](ARCHITECTURE.md) | Architekturübersicht, Stack, Diagramme, Modulgrenzen, Zeit- und Zufallsmodell |
| 5a | [ART_DIRECTION.md](ART_DIRECTION.md) | **Gestaltung „Alte Landkarte“**: Farben, Schriften, Karte, Bewegung (ADR-051); Herkunft und Lizenzen aller Assets in [ASSETS.md](ASSETS.md) |
| 6 | [DATA_MODEL.md](DATA_MODEL.md) | Konsistentes Datenmodell, Constraints, Indizes, Migrationsstrategie |
| 7 | [API.md](API.md) | HTTP-API- und Echtzeit-Entwurf |
| 8 | [QUIZ_ENGINE.md](QUIZ_ENGINE.md) | Fragenmodell, Mehrsprachigkeit, Herausforderungsprotokoll, Zeitmessung, Duellauswertung |
| 9 | [SIEGE_SYSTEM.md](SIEGE_SYSTEM.md) | Belagerungsprotokoll, Zustandsmaschine, Fristen, Nebenläufigkeit, Limits |
| 10 | [WORLD_SYSTEM.md](WORLD_SYSTEM.md) | Eternal/Daily/Weekly, Karte, Chunks, Skalierungsstrategie, Einstieg, Inaktivität |
| 11 | [NPC_SYSTEM.md](NPC_SYSTEM.md) | NPC-Fraktionen, Antwortmodell, dynamische Schwierigkeit, Expansion |
| 12 | [ITEM_SYSTEM.md](ITEM_SYSTEM.md) | Itemökonomie inkl. Simulation, Inventar, Anti-Farming, Auto-Verlängerung |
| 13 | [SECURITY.md](SECURITY.md) | Server-Autorität, Anti-Cheat, Missbrauch, Datenschutz, Recht |
| 14 | [TEST_PLAN.md](TEST_PLAN.md) | Teststrategie, Testebenen, Zuordnung der E2E-Fälle |
| 15 | [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) | Schrittweiser Implementierungsplan mit Abnahmekriterien |
| 16 | [DECISIONS.md](DECISIONS.md) | Architekturentscheidungen (ADR) und **priorisierte offene PO-Entscheidungen** |
| 17 | [RISKS.md](RISKS.md) | Risikoanalyse mit Gegenmaßnahmen |

## Kennzeichnung von Regeln

Für die Spielregeln (zusammengefasst in [GAME_RULES.md](GAME_RULES.md), ausgeführt in den Teilsystem-Dokumenten) gelten folgende Kennzeichnungen, damit bestätigte Vorgaben nicht mit Vorschlägen verwechselt werden. Technische Festlegungen in Architektur, API und Datenmodell sind über die ADRs in [DECISIONS.md](DECISIONS.md) begründet und nicht einzeln markiert.

| Marke | Bedeutung | Änderbar durch |
|---|---|---|
| **[V]** | Verbindlich – vom Product Owner festgelegt (Brief §2 „VERBINDLICH“ oder §12.4) | nur Product Owner |
| **[A]** | Annahme – Designvorschlag aus dem Brief, für den Prototyp verwendet, konfigurierbar | Konfiguration / PO |
| **[E]** | Empfehlung – von Claude ergänzte Präzisierung oder neue Regel, als Standard umgesetzt, leicht änderbar | Konfiguration / PO |
| **[O-xx]** | Offene Entscheidung – benötigt PO-Entscheidung, siehe [DECISIONS.md](DECISIONS.md#offene-entscheidungen) | Product Owner |
| **[V-nah]** | Eng am verbindlichen Brief-Text ausgelegt: Der Inhalt stammt aus einer Vorgabe, die Formulierung als Regel ist eine Präzisierung (Quelle steht dabei) | Präzisierung: PO |

Kombinationen: `[V/E]` oder `[V Grundsatz, E Umsetzung]` – der Grundsatz ist verbindlich, die konkrete Ausgestaltung eine Empfehlung. `[A, Brief §x]` bzw. `[E, [O-xx]]` – Marke plus Quelle bzw. zugehörige offene Entscheidung. In Parametertabellen gilt `A / E / E` je Spalte (Eternal / Weekly / Daily).

## Pflege

- Jede Änderung an Regeln oder Architektur aktualisiert das betroffene Dokument **und** [DECISIONS.md](DECISIONS.md).
- Parameter, die in der Spielkonfiguration (`world_rules`) landen, stehen gesammelt in [GAME_RULES.md §10](GAME_RULES.md#10-parametertabelle).
- Code-Bezeichner (Tabellen, Typen, Zustände) sind englisch, die Dokumentation ist deutsch.
