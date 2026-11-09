# API-Entwurf

Bezug: Brief §12.2, §12.5. REST/JSON für Kommandos und Abfragen, WebSocket für Ereignisse. Alle Schemas liegen als zod-Definitionen in `packages/protocol` und werden von Client und Server gemeinsam genutzt. Präfix: `/api/v1`.

## 1. Konventionen

- **Authentifizierung:** Sitzungscookie (`HttpOnly`, `Secure`, `SameSite=Lax`). Zustandsändernde Anfragen zusätzlich mit CSRF-Schutz (Double-Submit-Token oder Prüfung des `Origin`-Headers).
- **Idempotenz:** Jede zustandsändernde Anfrage (`POST`, `PATCH`, `DELETE` – Spiel, Inventar, Konto, Mitteilungen, Administration) trägt den Header `Idempotency-Key` (UUID, vom Client erzeugt, bei Wiederholung unverändert). Fehlt er, antwortet der Server mit `IDEMPOTENCY_KEY_REQUIRED`. Der Server speichert je Scope und Schlüssel Endpunkt, Hash der Anfrage und Antwort (`idempotency_keys`, 24 h), in derselben Transaktion wie die Wirkung: Eine Wiederholung liefert dieselbe Antwort ohne erneute Wirkung, derselbe Schlüssel mit anderem Inhalt ergibt `IDEMPOTENCY_KEY_REUSED`. Der Scope wird beim Eintreffen der Anfrage festgelegt und ändert sich danach nicht: mit Sitzung die Konto-ID, ohne Sitzung `anon:` + SHA-256 des Schlüssels. Spielkritische Tabellen speichern den Schlüssel zusätzlich mit einem Unique-Constraint je Akteur, damit die Garantie auch ohne den Antwortspeicher gilt und gleiche Schlüssel verschiedener Konten sich nicht stören (`sieges`: `(attacker_kingdom_id, idempotency_key)`, `item_usage`: `(user_id, idempotency_key)`, `quiz_answers`: `(participant_id, idempotency_key)`); bei `quiz_answers` verhindert außerdem `unique(participant_id, step_index)` mit der bedingten Aktualisierung `where status = 'PRESENTED'`, dass ein Schritt ein zweites Mal beantwortet wird. In den Tabellen unten wird der Header nicht wiederholt.
- **Idempotenz bei Anmeldung:** Sitzungstoken werden nie im Antwortspeicher abgelegt. Für Endpunkte, die eine Sitzung ausstellen und ein Konto anlegen oder ändern (`/auth/guest`, `/auth/register`), speichert der Antwortspeicher nur die Konto-ID; eine Wiederholung stellt für dieses Konto eine neue Sitzung aus, statt ein zweites Konto anzulegen. Diese Garantie gilt für das Wiederholungsfenster von 24 h; der Client erzeugt den Schlüssel für `/auth/guest` einmal beim ersten Start und verwirft ihn nach der ersten erfolgreichen Antwort. Ein dennoch doppelt angelegtes Gastkonto bleibt ungenutzt und wird nach der Inaktivitätsfrist gelöscht ([SECURITY.md §5.2](SECURITY.md#52-umsetzung)). `/auth/login` und `/auth/logout` sind von Natur aus wiederholbar und nutzen keinen Antwortspeicher: Eine Wiederholung prüft die Anmeldedaten erneut und stellt eine neue Sitzung aus bzw. beendet eine schon beendete Sitzung ohne Fehler.
- **Zeit:** Antworten enthalten `serverTime`; Restzeiten werden als `remainingMs` geliefert, damit Client-Uhren keine Rolle spielen.
- **Sprache:** aus den Spielereinstellungen; übersteuerbar per `Accept-Language` für nicht angemeldete Seiten.
- **Fehler:** `{ "error": { "code": "REGION_UNDER_SIEGE", "message": "…", "details": {…} } }` mit stabilen, dokumentierten Codes; Nachrichten lokalisiert der Client anhand des Codes.
- **Rate Limiting:** je Sitzung und IP (gleitendes Fenster). Bei genau einem `api`-Prozess im Prozessspeicher; sobald mehrere laufen, mit gemeinsamen Zählern (PostgreSQL oder Load Balancer, später Redis), damit die Grenzen nicht pro Knoten gelten.

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
| GET | `/instances/:id/leaderboard?type=regions\|defense` | Ranglisten nach Regionen bzw. Verteidigungspunkten (abgeleitet, bis 60 s verzögert) |

### 2.3 Kampf

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/instances/:id/attacks` | `{ targetRegionId }` → `{ siegeId, challengeId, mode }` |
| GET | `/challenges/:id` | aktueller Stand für Wiederaufnahme nach Reload: aktueller Schritt, Frage (falls präsentiert), `remainingMs` |
| POST | `/challenges/:id/steps/:i/present` | Frage ausliefern, `presented_at` setzen (wiederholbar, liefert dieselbe Frage) |
| POST | `/challenges/:id/steps/:i/answer` | `{ optionToken }` bzw. `{ rawInput, locale }` plus `{ clientElapsedMs }` → Bestätigung; bei Schritt 0 inklusive Schätzfrage; nach Schritt 1 ggf. Auflösung |
| GET | `/sieges?role=defender&status=open` | Belagerungs-Dashboard |
| GET | `/sieges?role=attacker&status=open` | eigene laufende Angriffe |
| GET | `/sieges/:id` | Details; nach Auflösung inkl. vollständiger Auflösung beider Seiten |
| POST | `/sieges/:id/defense` | Verteidigung beginnen → `challengeId` (Fehler `DEADLINE_TOO_CLOSE`) |
| POST | `/sieges/:id/extend` | `{ itemDefinitionId, expectedNewDeadline }` |

### 2.4 Inventar und Mitteilungen

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/instances/:id/inventory` | verfügbare Items, Ablage (mit Ablaufzeit) |
| POST | `/instances/:id/inventory/pending/:itemId/claim` | Item aus der Ablage übernehmen (wenn Platz) |
| POST | `/instances/:id/inventory/:itemId/discard` | Item bewusst verwerfen (mit Bestätigung) |
| GET | `/notifications?unread=true` | |
| POST | `/notifications/read` | `{ ids }` |

### 2.5 Redaktion und Administration

Jeder Endpunkt ist genau den genannten Rollen erlaubt (minimale Rechte, [SECURITY.md §8](SECURITY.md#8-administration-und-audit)); `EDITOR` hat keinen Zugriff auf Welt-, Kampf-, Konto- oder Missbrauchsdaten.

| Methode | Pfad | Rolle | Zweck |
|---|---|---|---|
| POST | `/admin/questions/:id/suspend` | `EDITOR`, `ADMIN` | `{ reason }` – Frage aus dem Pool nehmen |
| GET | `/admin/sieges/:id/reconstruction` | `ADMIN` | vollständiges Kampfprotokoll inkl. RNG-Werten |
| POST | `/admin/sieges/:id/cancel` | `ADMIN` | `{ reason }` |
| GET | `/admin/abuse-signals` | `ADMIN` | Prüfliste |
| POST | `/admin/instances/:id/npc/pause` | `ADMIN` | `{ mode, reason }` mit `mode` = `THROTTLE` oder `STOP` – NPC-Aktivität drosseln/stoppen |
| GET | `/admin/invariants` | `ADMIN` | Ergebnis des letzten Invariantenlaufs |

Alle Admin-Kommandos verlangen `reason` (Pflichtfeld) und den Header `Idempotency-Key` und erzeugen `audit_events` mit Akteur, Rolle, Ziel, Vorher/Nachher und Begründung.

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
| `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED` | Header fehlt bzw. Schlüssel mit anderem Anfrageinhalt wiederverwendet |
