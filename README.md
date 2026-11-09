# Reiche des Wissens (Arbeitstitel)

Browserbasiertes Multiplayer-Trivia-Strategiespiel: Spieler erobern mit Quizduellen Gebiete auf einer Hexagon-Karte, bauen Königreiche auf und verteidigen sie asynchron gegen andere Spieler und NPC-Fraktionen. Drei Modi: permanente Eternal-Welt, Tages- und Wochenkarten. Sprachen: Deutsch, Ungarisch, Englisch.

## Status

**Phase 0 – Analyse und Architektur.** Noch kein lauffähiger Code. Die vollständige Planung liegt in [`docs/`](docs/README.md):

- Anforderungen: [`docs/brief/PRD-0.1.md`](docs/brief/PRD-0.1.md)
- MVP-Definition: [`docs/MVP.md`](docs/MVP.md)
- Architektur: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Offene Entscheidungen: [`docs/DECISIONS.md`](docs/DECISIONS.md#offene-entscheidungen)
- Plan: [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md)

## Geplanter Stack

TypeScript-Monorepo (pnpm) · React + Vite + PixiJS · Fastify + WebSocket · PostgreSQL (Zustand, Jobs via pg-boss, autoritative Zeit) · Vitest, Playwright. Begründungen: [`docs/DECISIONS.md`](docs/DECISIONS.md#architekturentscheidungen-adr).
