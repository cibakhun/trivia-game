# API-Entwurf

Bezug: Brief §12.2, §12.5. REST/JSON für Kommandos und Abfragen, WebSocket für Ereignisse. Alle Schemas liegen als zod-Definitionen in `packages/protocol` und werden von Client und Server gemeinsam genutzt. Präfix: `/api/v1`.

## 1. Konventionen

- **Authentifizierung:** Sitzungscookie (`HttpOnly`, `Secure`, `SameSite=Lax`). Zustandsändernde Anfragen zusätzlich mit CSRF-Schutz (Double-Submit-Token oder Prüfung des `Origin`-Headers).
- **Idempotenz:** Jedes Kommando, das Spielzustand verändert, trägt `idempotencyKey` (UUID, vom Client erzeugt). Wiederholte Anfragen mit demselben Schlüssel liefern dieselbe Antwort ohne erneute Wirkung.
- **Zeit:** Antworten enthalten `serverTime`; Restzeiten werden als `remainingMs` geliefert, damit Client-Uhren keine Rolle spielen.
- **Sprache:** aus den Spielereinstellungen; übersteuerbar per `Accept-Language` für nicht angemeldete Seiten.
- **Fehler:** `{ "error": { "code": "REGION_UNDER_SIEGE", "message": "…", "details": {…} } }` mit stabilen, dokumentierten Codes; Nachrichten lokalisiert der Client anhand des Codes.
- **Rate Limiting:** je Sitzung und IP (gleitendes Fenster, im MVP im Prozessspeicher, später Redis).

## 2. Endpunkte

### 2.1 Konto

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/auth/guest` | Gastkonto anlegen, Sitzung setzen (Modell offen: [O-03]) |
| POST | `/auth/register` | Gast in vollwertiges Konto umwandeln |
| POST | `/auth/login`, `/auth/logout` | |
| GET | `/me` | Profil, Einstellungen, aktive Instanzen |
| PATCH | `/me/settings` | Sprache, Zeitzone, Benachrichtigungen, Auto-Verlängerung |
| POST | `/me/push-subscriptions` | Web-Push-Abonnement registrieren |
| POST | `/me/export` | Datenexport anstoßen (Datenschutz) |
| DELETE | `/me` | Kontolöschung beantragen |

### 2.2 Welten und Karte

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/worlds` | verfügbare Welten und Instanzen (Kapazität, Restlaufzeit) |
| POST | `/worlds/:worldId/join` | Instanz beitreten, Startregion zuweisen, Reich gründen |
| POST | `/instances/:id/respawn` | nach Totalverlust neues Reich gründen |
| GET | `/instances/:id/map/static?chunks=x:y,…` | unveränderliche Chunk-Daten (Koordinaten, Biom, Stufe), lange cachebar (`ETag`, `Cache-Control: immutable`) |
| GET | `/instances/:id/map/state?chunks=…&sinceSeq=…` | dynamischer Zustand je Chunk: Besitzer, Hauptstadt, Schutz bis, Belagerung ja/nein; mit `sinceSeq` nur Änderungen |
| GET | `/instances/:id/regions/:regionId` | Details inkl. berechneter Angriffsberechtigung für den Anfragenden |
| GET | `/instances/:id/kingdoms/:kingdomId` | öffentliches Reichsprofil |
| GET | `/instances/:id/leaderboard?type=regions` | Rangliste (abgeleitet, bis 60 s verzögert) |

### 2.3 Kampf

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/instances/:id/attacks` | `{ targetRegionId, idempotencyKey }` → `{ siegeId, challengeId, mode }` |
| GET | `/challenges/:id` | aktueller Stand für Wiederaufnahme nach Reload: aktueller Schritt, Frage (falls präsentiert), `remainingMs` |
| POST | `/challenges/:id/steps/:i/present` | Frage ausliefern, `presented_at` setzen (wiederholbar, liefert dieselbe Frage) |
| POST | `/challenges/:id/steps/:i/answer` | `{ optionToken }` bzw. `{ rawInput, locale }` plus `{ clientElapsedMs, idempotencyKey }` → Bestätigung; bei Schritt 0 inklusive Schätzfrage; nach Schritt 1 ggf. Auflösung |
| GET | `/sieges?role=defender&status=open` | Belagerungs-Dashboard |
| GET | `/sieges?role=attacker&status=open` | eigene laufende Angriffe |
| GET | `/sieges/:id` | Details; nach Auflösung inkl. vollständiger Auflösung beider Seiten |
| POST | `/sieges/:id/defense` | Verteidigung beginnen → `challengeId` (Fehler `DEADLINE_TOO_CLOSE`) |
| POST | `/sieges/:id/extend` | `{ itemDefinitionId, expectedNewDeadline, idempotencyKey }` |

### 2.4 Inventar und Mitteilungen

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/instances/:id/inventory` | verfügbare Items, Ablage (mit Ablaufzeit) |
| POST | `/instances/:id/inventory/pending/:itemId/claim` | Item aus der Ablage übernehmen (wenn Platz) |
| POST | `/instances/:id/inventory/:itemId/discard` | Item bewusst verwerfen (mit Bestätigung) |
| GET | `/notifications?unread=true` | |
| POST | `/notifications/read` | `{ ids }` |

### 2.5 Redaktion und Administration (Rolle `EDITOR`/`ADMIN`)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/admin/sieges/:id/reconstruction` | vollständiges Kampfprotokoll inkl. RNG-Werten |
| POST | `/admin/sieges/:id/cancel` | `{ reason }` |
| POST | `/admin/questions/:id/suspend` | Frage aus dem Pool nehmen |
| GET | `/admin/abuse-signals` | Prüfliste |
| POST | `/admin/instances/:id/npc/pause` | NPC-Aktivität drosseln/stoppen |
| GET | `/admin/invariants` | Ergebnis des letzten Invariantenlaufs |

Alle Admin-Kommandos verlangen eine Begründung und erzeugen `audit_events`.

## 3. Beispiel: Antwort auf `present` (Trivia)

```json
{
  "challengeId": "01933b6e-…",
  "step": 0,
  "kind": "TRIVIA",
  "prompt": "Welches chemische Element besitzt die Ordnungszahl 79?",
  "options": [
    { "token": "k7Qp", "text": "Platin" },
    { "token": "Zx2m", "text": "Gold" },
    { "token": "aa9T", "text": "Kupfer" },
    { "token": "Lr0e", "text": "Silber" }
  ],
  "timeLimitMs": 20000,
  "remainingMs": 20000,
  "serverTime": "2026-11-09T18:00:00.000Z"
}
```

Die Antwort enthält weder `option_key`s noch einen Hinweis auf die richtige Option.

## 4. WebSocket-Protokoll

Verbindung: `wss://…/api/v1/ws` (Sitzungscookie). Nachrichten sind JSON mit `type`.

**Client → Server**

| Typ | Inhalt |
|---|---|
| `subscribe` | `{ instanceId, chunks: ["x:y", …] }` – ersetzt das bisherige Chunk-Abo (Viewport) |
| `resume` | `{ instanceId, lastSeq }` – nach Reconnect |
| `ping` | `{ t }` – Latenzmessung, Lebenszeichen |

**Server → Client** (jedes Ereignis mit `seq`)

| Typ | Inhalt | Kanal |
|---|---|---|
| `region.changed` | `{ regionId, ownerKingdomId, isCapital, protectedUntil, underSiege }` | Chunk |
| `siege.opened` | Belagerung gegen mich / von mir eröffnet | persönlich |
| `siege.updated` | Frist verlängert, Verteidigung begonnen | persönlich |
| `siege.resolved` | Ergebnis-Zusammenfassung + Link | persönlich |
| `inventory.changed` | neue Items, Ablage, Verbrauch | persönlich |
| `notification.created` | neue Mitteilung | persönlich |
| `kingdom.changed` | Regionenzahl, Rang, Hauptstadt | persönlich + Chunk |
| `npc.expanded` | NPC hat Region übernommen (gebündelt) | Chunk |
| `season.ending` / `season.ended` | Saisonhinweise | Instanz |
| `resync.required` | `lastSeq` zu alt → Client lädt Snapshot per REST | persönlich |
| `pong` | `{ t, serverTime }` | – |

Ereignisse sind **Hinweise auf Zustandsänderungen**, nicht die einzige Quelle: Der Client wendet sie auf seinen Cache an und kann jederzeit per REST den autoritativen Zustand nachladen (Brief §12.5).

## 5. Fehlercodes (Auszug)

| Code | Bedeutung |
|---|---|
| `NOT_ADJACENT` | Zielregion grenzt an keine eigene Region |
| `REGION_UNDER_SIEGE` | aktive Belagerung auf der Region |
| `REGION_PROTECTED` | Schutzzeit der Region aktiv (`details.until`) |
| `KINGDOM_PROTECTED` | Anfänger-/Wiederaufbauschutz des Ziels |
| `RANK_GAP` | Rangabstandsschutz |
| `ATTACKER_SIEGE_LIMIT`, `ATTACKER_ATTEMPT_LIMIT` | Angreiferbudgets erschöpft (`details.resetAt`) |
| `DEFENDER_SIEGE_LIMIT` | Verteidiger hat maximale Zahl offener Belagerungen |
| `CHALLENGE_IN_PROGRESS` | Spieler hat bereits eine laufende Herausforderung |
| `STEP_EXPIRED` | Antwort nach Zeitlimit des Schritts |
| `DEADLINE_PASSED` | Verteidigung nach Fristende |
| `DEADLINE_TOO_CLOSE` | Restzeit reicht nicht für die Herausforderung |
| `EXTENSION_LIMIT_REACHED` | Frist bereits am Maximum |
| `DEADLINE_CHANGED` | erwartete neue Frist stimmt nicht mehr (Client zeigt neuen Wert) |
| `ITEM_NOT_AVAILABLE` | Item existiert nicht, gehört nicht dem Spieler oder ist verbraucht |
| `INSTANCE_NOT_ACTIVE`, `PVP_CUTOFF_REACHED` | Weltinstanz bzw. Saisonphase erlaubt keine Angriffe |
