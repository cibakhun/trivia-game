# Reiche des Wissens (Arbeitstitel)

Browserbasiertes Multiplayer-Trivia-Strategiespiel: Spieler erobern mit Quizduellen Gebiete auf einer Hexagon-Karte, bauen Königreiche auf und verteidigen sie asynchron gegen andere Spieler und NPC-Fraktionen. Drei Modi: permanente Eternal-Welt, Tages- und Wochenkarten. Sprache: Deutsch.

## Status

**Schritt 1.0 – Grundlagen umgesetzt.** Regelkern, Protokoll, Datenbankgrundlagen und Fragenformat stehen mit Tests; ein spielbarer Prototyp folgt in Phase 1. Planung in [`docs/`](docs/README.md):

- Anforderungen: [`docs/brief/PRD-0.1.md`](docs/brief/PRD-0.1.md)
- MVP-Definition: [`docs/MVP.md`](docs/MVP.md)
- Architektur: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Offene Entscheidungen: [`docs/DECISIONS.md`](docs/DECISIONS.md#offene-entscheidungen)
- Plan: [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md)

## Aufbau

| Pfad | Inhalt |
|---|---|
| `packages/protocol` | zod-Schemas: Regelkonfiguration mit Standardwerten je Modus, Zahlparser (Deutsch), Fragen-Enums |
| `packages/game-core` | reine Spielregeln: Hex-Karte und Chunks, Ränge, Duellauswertung mit verdecktem Gate, Verteidigungspunkte, effektive Antwortzeit, Fristen, Zufall (HMAC + sfc32), Drops, NPC-Antwortmodell |
| `packages/db` | SQL-Migrationen, Migrationsläufer, `game_now()`, Testhelfer |
| `tools/content` | Prüfwerkzeug für Fragendateien |
| `content/` | Fragen als YAML ([Format](content/README.md)), derzeit 40 Testfragen |

Abhängigkeitsregel: `game-core` und `protocol` laufen in Browser und Server (keine Node-Module, keine Datenbank); `game-core` nutzt von `protocol` nur Typen. ESLint erzwingt das.

## Entwicklung

Voraussetzungen: Node.js ≥ 22.12, pnpm 10 (`corepack enable`), Docker für die lokale Datenbank.

```sh
pnpm install
cp .env.example .env          # POSTGRES_PASSWORD, DATABASE_URL und TEST_DATABASE_URL setzen
docker compose up -d db       # PostgreSQL 16, nur auf 127.0.0.1

pnpm check                    # Lint, Formatierung, Typen, Unit-Tests, Fragenprüfung
pnpm test:integration         # Integrationstests (je Testdatei eine eigene Datenbank)
pnpm db:migrate               # Migrationen auf DATABASE_URL anwenden (--status zeigt nur den Plan)
```

`pnpm db:migrate` bricht mit `APP_ENV=production` ohne `--production-approved` ab: Produktionsmigrationen brauchen eine ausdrückliche Freigabe, ein Backup und einen Probelauf gegen eine Kopie.

## Stack

TypeScript-Monorepo (pnpm) · React + Vite + PixiJS · Fastify + WebSocket · PostgreSQL (Zustand, Jobs via pg-boss, autoritative Zeit) · Vitest, fast-check, Playwright. Begründungen: [`docs/DECISIONS.md`](docs/DECISIONS.md#architekturentscheidungen-adr).
