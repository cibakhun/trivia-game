# Dokumentation – Reiche des Wissens (Arbeitstitel)

Stand: Phase 0 (Analyse und Architektur), 2026-11-09.
Anforderungsbasis: [`brief/PRD-0.1.md`](brief/PRD-0.1.md) (Original-Briefing des Product Owners, unverändert).

## Lesereihenfolge

| # | Dokument | Inhalt |
|---|---|---|
| 1 | [REPO_AUDIT.md](REPO_AUDIT.md) | Ausgangslage: Repository, vorhandene Infrastruktur, Werkzeuge |
| 2 | [PRODUCT_VISION.md](PRODUCT_VISION.md) | Vision, Prinzipien, Nicht-Ziele, Erfolgskriterien |
| 3 | [MVP.md](MVP.md) | **Definition des ersten spielbaren MVP** und der Zwischenmeilensteine |
| 4 | [GAME_RULES.md](GAME_RULES.md) | Regelwerk mit Kennzeichnung (verbindlich / Annahme / Empfehlung / offen) und Parametertabelle |
| 5 | [ARCHITECTURE.md](ARCHITECTURE.md) | Architekturübersicht, Stack, Diagramme, Modulgrenzen, Zeit- und Zufallsmodell |
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

Alle Regeln in diesen Dokumenten tragen eine Kennzeichnung, damit bestätigte Vorgaben nicht mit Vorschlägen verwechselt werden:

| Marke | Bedeutung | Änderbar durch |
|---|---|---|
| **[V]** | Verbindlich – vom Product Owner festgelegt (Brief §2 „VERBINDLICH“ oder §12.4) | nur Product Owner |
| **[A]** | Annahme – Designvorschlag aus dem Brief, für den Prototyp verwendet, konfigurierbar | Konfiguration / PO |
| **[E]** | Empfehlung – von Claude ergänzte Präzisierung oder neue Regel, als Standard umgesetzt, leicht änderbar | Konfiguration / PO |
| **[O-xx]** | Offene Entscheidung – benötigt PO-Entscheidung, siehe [DECISIONS.md](DECISIONS.md#offene-entscheidungen) | Product Owner |

## Pflege

- Jede Änderung an Regeln oder Architektur aktualisiert das betroffene Dokument **und** [DECISIONS.md](DECISIONS.md).
- Parameter, die in der Spielkonfiguration (`world_rules`) landen, stehen gesammelt in [GAME_RULES.md §10](GAME_RULES.md#10-parametertabelle).
- Code-Bezeichner (Tabellen, Typen, Zustände) sind englisch, die Dokumentation ist deutsch.
