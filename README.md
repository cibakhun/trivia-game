# Reiche des Wissens (Arbeitstitel)

Browserbasiertes Multiplayer-Trivia-Strategiespiel: Spieler erobern mit Quizduellen Gebiete auf einer Hexagon-Karte, bauen Königreiche auf und verteidigen sie asynchron gegen andere Spieler und NPC-Fraktionen. Drei Modi: permanente Eternal-Welt, Tages- und Wochenkarten. Sprache: Deutsch.

## Status

**Phase 1 (Singleplayer-Prototyp) in Arbeit.** Regelkern, Protokoll, Datenbank, Fragenimport, Kartengenerator mit Testwelt und der Server mit Gastkonto, Beitritt, Kartenabfragen und PvE-Kampf (Angriff, Fragen, Antworten, Auflösung) stehen mit Tests, ebenso der Browser-Client (Karte, Regionsdetails, Vollbild-Quiz, Reichsanzeige) mit dem E2E-Test „Erste Eroberung“. Planung in [`docs/`](docs/README.md):

- Anforderungen: [`docs/brief/PRD-0.1.md`](docs/brief/PRD-0.1.md)
- MVP-Definition: [`docs/MVP.md`](docs/MVP.md)
- Architektur: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Offene Entscheidungen: [`docs/DECISIONS.md`](docs/DECISIONS.md#offene-entscheidungen)
- Plan: [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md)

## Aufbau

| Pfad | Inhalt |
|---|---|
| `apps/server` | Server (Rolle `api`, Fastify): Sitzungen, Gastkonto, Welten und Beitritt, Kartenabfragen, PvE-Kampf; Werkzeug `world:create` |
| `apps/web` | Browser-Client (React, Vite, PixiJS): Start als Gast, Karte, Regionsdetails, Vollbild-Quiz mit Auflösung, Reichsanzeige; deutsche Texte über Schlüssel; E2E-Tests mit Playwright |
| `packages/protocol` | zod-Schemas: REST-Schnittstelle (Fehlercodes, Antworten), Regelkonfiguration mit Standardwerten je Modus, Zahlparser (Deutsch), Fragen-Enums |
| `packages/game-core` | reine Spielregeln: Hex-Karte und Chunks, Kartengenerator, Startregion, Reichsnamen, Ränge, Duellauswertung mit verdecktem Gate, Verteidigungspunkte, effektive Antwortzeit, Fristen, Zufall (HMAC + sfc32), Drops, NPC-Antwortmodell |
| `packages/db` | SQL-Migrationen, Migrationsläufer, typisierter Zugriff (Kysely), `game_now()`, Testhelfer |
| `tools/content` | Prüf- und Importwerkzeug für Fragendateien |
| `content/` | Fragen als YAML ([Format](content/README.md)), derzeit 40 Testfragen |

Abhängigkeitsregel: `game-core` und `protocol` laufen in Browser und Server (keine Node-Module, keine Datenbank); `game-core` nutzt von `protocol` nur Typen. ESLint erzwingt das.

## Entwicklung

Voraussetzungen: Node.js ≥ 22.12, pnpm 10 (`corepack enable`), Docker für die lokale Datenbank.

```sh
pnpm install
cp .env.example .env          # POSTGRES_PASSWORD, DATABASE_URL, TEST_DATABASE_URL und RNG_SECRET setzen
docker compose up -d db       # PostgreSQL 16, nur auf 127.0.0.1

pnpm check                    # Lint, Formatierung, Typen, Unit-Tests, Fragenprüfung
pnpm test:integration         # Integrationstests (je Testdatei eine eigene Datenbank)
pnpm db:migrate               # Migrationen auf DATABASE_URL anwenden (--status zeigt nur den Plan)
pnpm db:types                 # Kysely-Typen aus dem migrierten Schema erzeugen (--check: nur vergleichen)
pnpm content:import --fixtures  # Fragen importieren, lokal mit den 40 Testfragen (--dry-run: Probelauf)
pnpm world:create             # Testwelt anlegen (150 Regionen, sechs NPC-Fraktionen)
pnpm api:start                # Server starten (braucht PUBLIC_ORIGIN, RNG_SECRET, RNG_KEY_ID)
pnpm web:dev                  # Client auf http://127.0.0.1:5173, /api geht an 127.0.0.1:3000 (API_ORIGIN)
pnpm e2e                      # E2E-Tests im Browser (eigene Testdatenbank über TEST_DATABASE_URL)
```

Die Befehle lesen `.env` im Hauptordner selbst (`--env-file-if-exists`); gesetzte Umgebungsvariablen haben Vorrang. Der Client läuft unter `http://127.0.0.1:5173` (wie `PUBLIC_ORIGIN` in `.env.example`; `localhost` wäre eine andere Herkunft und wird abgelehnt). Vor dem ersten `pnpm e2e` einmal `pnpm --filter @rdw/web exec playwright install chromium`.

`pnpm db:migrate` bricht mit `APP_ENV=production` ohne `--production-approved` ab: Produktionsmigrationen brauchen eine ausdrückliche Freigabe, ein Backup und einen Probelauf gegen eine Kopie. `pnpm content:import` verlangt in Produktion ebenfalls `--production-approved`, außer beim Probelauf mit `--dry-run`, der nichts übernimmt; Testfragen (`--fixtures`) lehnt der Import außerhalb von `local` und `test` immer ab. `pnpm world:create` legt in Produktion nur mit `--production-approved` eine Welt an.

## Stack

TypeScript-Monorepo (pnpm) · React + Vite + PixiJS · Fastify + WebSocket · PostgreSQL (Zustand, Jobs via pg-boss, autoritative Zeit) · Vitest, fast-check, Playwright. Begründungen: [`docs/DECISIONS.md`](docs/DECISIONS.md#architekturentscheidungen-adr).
