# Reiche des Wissens (Arbeitstitel)

Browserbasiertes Multiplayer-Trivia-Strategiespiel: Spieler erobern mit Quizduellen Gebiete auf einer Hexagon-Karte, bauen Königreiche auf und verteidigen sie asynchron gegen andere Spieler und NPC-Fraktionen. Drei Modi: permanente Eternal-Welt, Tages- und Wochenkarten. Sprache: Deutsch.

## Status

**Phase 1 (Singleplayer-Prototyp) abgeschlossen, Phase 2 (echter Multiplayer) in Arbeit.** Regelkern, Protokoll, Datenbank, Fragenimport, Kartengenerator mit Testwelt und der Server mit Gastkonto, Beitritt, Kartenabfragen und PvE-Kampf (Angriff, Fragen, Antworten, Auflösung) stehen mit Tests, ebenso der Browser-Client (Karte, Regionsdetails, Vollbild-Quiz, Reichsanzeige) mit dem E2E-Test „Erste Eroberung“. Seit Phase 2 Paket 1 gibt es PvP: Belagerungen mit Verteidigungsfrist, Verteidigung, Belagerungsübersicht und Neugründung nach dem Fall, mit den E2E-Tests „Trivia-Sieg“ und „Schätzfrage“. Seit Paket 2 lassen sich Gastkonten mit Benutzername und Passwort sichern; Spieler- und Reichsnamen werden aus Vorschlägen gewählt, inaktive Gäste nach 90 Tagen gelöscht. Hauptspiel ist jetzt die rundenbasierte Partie ([Regeln](docs/MATCH_RULES.md)): zwei oder drei Spieler auf der Wendelmark, im Browser unter „Partie spielen“ mit Einladungscode oder als Testpartie gegen Bots; der WebSocket (M3) und eigene Fragen (M5) folgen. Planung in [`docs/`](docs/README.md):

- Anforderungen: [`docs/brief/PRD-0.1.md`](docs/brief/PRD-0.1.md)
- MVP-Definition: [`docs/MVP.md`](docs/MVP.md)
- Architektur: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Offene Entscheidungen: [`docs/DECISIONS.md`](docs/DECISIONS.md#offene-entscheidungen)
- Plan: [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md)

## Aufbau

| Pfad | Inhalt |
|---|---|
| `apps/server` | Server (Rolle `api`, Fastify): Sitzungen, Gast- und gesicherte Konten, Namensvorschläge, Kontopflege, Welten und Beitritt, Kartenabfragen, PvE- und PvP-Kampf, Neugründung; Werkzeuge `world:create` und `account:reset-password` |
| `apps/web` | Browser-Client (React, Vite, PixiJS): Start als Gast, Karte, Regionsdetails, Vollbild-Quiz mit Auflösung, Reichsanzeige, Belagerungsübersicht mit Verteidigung; deutsche Texte über Schlüssel; E2E-Tests mit Playwright |
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
pnpm world:create --slug=spieltest --rules=playtest  # zweite Welt mit 10 min Verteidigungsfrist für PvP-Tests
pnpm api:start                # Server starten (braucht PUBLIC_ORIGIN, RNG_SECRET, RNG_KEY_ID)
pnpm web:dev                  # Client auf http://127.0.0.1:5173, /api geht an 127.0.0.1:3000 (API_ORIGIN)
pnpm e2e                      # E2E-Tests im Browser (eigene Testdatenbank über TEST_DATABASE_URL)
pnpm account:reset-password --username=NAME  # neues Passwort für ein gesichertes Konto (einmal angezeigt)
```

`pnpm db:migrate`, `pnpm db:types`, `pnpm content:import`, `pnpm world:create`, `pnpm api:start` und `pnpm web:dev` (nur `API_ORIGIN`) lesen `.env` im Hauptordner selbst; gesetzte Umgebungsvariablen haben Vorrang. `pnpm check`, `pnpm test:integration` und `pnpm e2e` lesen `.env` nicht: Für die beiden letzten `TEST_DATABASE_URL` in der Shell setzen, z. B. `export TEST_DATABASE_URL=postgres://rdw:…@127.0.0.1:5432/postgres` (PowerShell: `$env:TEST_DATABASE_URL = "…"`). Mit `APP_ENV=local` oder `test` verweigern die Befehle eine Datenbank, die nicht auf diesem Rechner liegt; so hebt eine liegengebliebene Entwickler-`.env` auf einem Server die Freigabeschutze nicht auf. Der Client läuft unter `http://127.0.0.1:5173` (wie `PUBLIC_ORIGIN` in `.env.example`; `localhost` wäre eine andere Herkunft und wird abgelehnt). Vor dem ersten `pnpm e2e` einmal `pnpm --filter @rdw/web exec playwright install chromium`.

`pnpm db:migrate` bricht mit `APP_ENV=production` ohne `--production-approved` ab: Produktionsmigrationen brauchen eine ausdrückliche Freigabe, ein Backup und einen Probelauf gegen eine Kopie. `pnpm content:import` verlangt in Produktion ebenfalls `--production-approved`, außer beim Probelauf mit `--dry-run`, der nichts übernimmt; Testfragen (`--fixtures`) lehnt der Import außerhalb von `local` und `test` immer ab. `pnpm world:create` legt in Produktion nur mit `--production-approved` eine Welt an; Spieltest-Regeln (`--rules=playtest`) gibt es nur mit `APP_ENV=local` oder `test`.

**PvP lokal ausprobieren:** Spieltest-Welt wie oben anlegen, Server und Client starten und das Spiel in zwei Browserfenstern öffnen, eines davon privat (eigenes Konto; ein privates Fenster teilt keine Cookies mit dem normalen). Beide treten der Welt „spieltest“ bei; wer schon in einer anderen Welt spielt, kommt über „Welten“ oben rechts auf der Karte zur Weltwahl. Die Startregionen liegen meist 3 bis 8 Felder auseinander: Beide erobern zuerst ein paar neutrale Regionen aufeinander zu (nach 2 Minuten endet ohnehin der Anfängerschutz). Sobald die Reiche aneinandergrenzen, greift einer eine Region des anderen an und beantwortet beide Fragen. Der andere sieht die Belagerung in der Seitenleiste und hat 10 Minuten zum Verteidigen. Wer sein Reich verliert, gründet über „Neues Reich gründen“ neu.

**Konto sichern:** Wer als Gast spielt, sichert sein Konto über „Konto sichern“ oben rechts mit Benutzername, Passwort und einem Spielernamen aus Vorschlägen; danach meldet er sich auf jedem Gerät mit Benutzername und Passwort an und findet seine Reiche wieder. Gastkonten werden nach 90 Tagen ohne Besuch gelöscht, ihre Reiche bleiben als „Vergessenes Reich“ auf der Karte. Ein vergessenes Passwort setzt die Spielleitung mit `pnpm account:reset-password --username=NAME` zurück (in Produktion nur mit `--production-approved`); eine Wiederherstellung per E-Mail gibt es noch nicht.

## Stack

TypeScript-Monorepo (pnpm) · React + Vite + PixiJS · Fastify + WebSocket · PostgreSQL (Zustand, Jobs via pg-boss, autoritative Zeit) · Vitest, fast-check, Playwright. Begründungen: [`docs/DECISIONS.md`](docs/DECISIONS.md#architekturentscheidungen-adr).
