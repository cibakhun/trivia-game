# Repository- und Infrastruktur-Audit

Stand: 2026-11-09 · Brief §1.3, §16 Phase 0, §20 Arbeitsweise 1–2

## 1. Repository `cibakhun/trivia-game`

| Prüfpunkt | Befund |
|---|---|
| Commits | 1 („Initial commit“, 2026-11-09) |
| Inhalt | nur `README.md` mit dem Text „AgencyOS Project: Trivia Game“ |
| Branches | `main` (Standard), `claude/project-thread-qv87rx` (Arbeitsbranch dieser Phase) |
| Quellcode, Build, Abhängigkeiten | keine |
| CI/CD (`.github/workflows`) | keine |
| Infrastruktur-Konfiguration (Docker, IaC, Deploy) | keine |
| Datenbank, Migrationen, Seeds | keine |
| Secrets/Umgebungsdateien | keine (gut – nichts zu bereinigen) |
| Issues / Pull Requests | keine |
| PR-Vorlage | keine |
| Lizenzdatei | keine – **Hinweis:** ohne Lizenzdatei ist der Code „all rights reserved“. Für ein kommerzielles, eigenständiges Produkt ist das passend; vor einer Veröffentlichung von Teilen als Open Source wäre eine Entscheidung nötig. |

**Schlussfolgerung:** Es gibt keine bestehende Architektur, auf die Rücksicht genommen werden muss, und keine Konflikte mit vorhandenem Code. Der Stack kann frei nach den Anforderungen gewählt werden (siehe [ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md)).

## 2. Bestehende Projekte und Abgrenzung

- Ein separates, bereits begonnenes Projektverzeichnis für dieses Spiel wurde nicht gefunden. Geprüft wurden das Repository und auf dem verbundenen Entwicklungsrechner ausschließlich Ordner**namen** (keine Inhalte geöffnet).
- VerseBase und alle anderen Projekte wurden **nicht** gelesen oder verändert (Brief §1.3).
- Es wurden keine Datenbanken, Cloud-Projekte oder Deployments angelegt oder verändert.

## 3. Verfügbare Werkzeuge in der Entwicklungsumgebung

Die Cloud-Entwicklungsumgebung (Ubuntu 24.04), in der Claude Code arbeitet, stellt bereit:

| Werkzeug | Version | Nutzen |
|---|---|---|
| Node.js | 22.23 (LTS) | Laufzeit für Server, Tools, Tests |
| pnpm | 10.28 | Monorepo-Workspaces |
| npm | 10.9 | Fallback |
| PostgreSQL | 16.15 | lokale Integrationstests gegen echtes Postgres |
| Redis | 7.0 | optional, im MVP nicht benötigt |
| Docker | 29.9 | Testcontainer, lokale Compose-Umgebung |
| Chromium + Playwright | vorinstalliert | E2E-Tests |

Damit lassen sich alle Testebenen (Unit, Integration gegen echtes Postgres, E2E im Browser) **ohne kostenpflichtige Infrastruktur** ausführen. GitHub Actions bietet für private Repositories ein begrenztes Freikontingent; ein Postgres-Service-Container in CI ist kostenlos nutzbar (siehe [TEST_PLAN.md](TEST_PLAN.md)).

## 4. Verfügbare, aber bewusst nicht genutzte Dienste

In der Arbeitsumgebung sind Konnektoren zu gehosteten Diensten (u. a. Supabase, Vercel) vorhanden. Sie wurden **nicht** verwendet:

- Brief §20: kostenpflichtige Infrastrukturentscheidungen und produktive Veröffentlichung benötigen gesonderte Freigabe.
- Fachlich: Das Spiel braucht langlebige Prozesse (WebSockets, Hintergrund-Worker für Fristen und NPC-Ticks). Serverlose Funktionsplattformen eignen sich dafür nur eingeschränkt; ein gehostetes Postgres (z. B. Supabase) wäre dagegen eine mögliche Option für später. Die Hosting-Frage ist als offene Entscheidung [O-11] erfasst.

## 5. Fehlende Voraussetzungen

| Fehlend | Wann nötig | Verweis |
|---|---|---|
| Fragendatenbank (DE/HU/EN, geprüft) | Phase 1 (≈150 Fragen), MVP (≈650) | [QUIZ_ENGINE.md §9](QUIZ_ENGINE.md#9-inhaltspipeline-und-umfang), [O-02] |
| Visuelle Identität (Farben, Typo, Icons, Karte) | ab Phase 1 (Platzhalter genügen) | [SECURITY.md §6](SECURITY.md#6-geistiges-eigentum-und-lizenzen) |
| Hosting/Staging-Umgebung | Phase 2–3 (Mehrspielertest) | [O-11] |
| Markenprüfung des Namens | vor öffentlicher Beta | [O-12] |
| Datenschutzerklärung, Impressum | vor öffentlicher Beta | [SECURITY.md §5](SECURITY.md#5-datenschutz-dsgvo) |
