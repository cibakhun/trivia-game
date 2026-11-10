# API-Entwurf

Bezug: Brief §12.2, §12.5. REST/JSON für Kommandos und Abfragen, WebSocket für Ereignisse. Alle Schemas liegen als zod-Definitionen in `packages/protocol` und werden von Client und Server gemeinsam genutzt. Präfix: `/api/v1`.

## 1. Konventionen

- **Authentifizierung:** Sitzungscookie `rdw_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, Pfad `/api/v1`, 30 Tage gleitend, höchstens stündlich verlängert). Zustandsändernde Anfragen (`POST`, `PUT`, `PATCH`, `DELETE`) müssen den Header `Origin` mit genau der Herkunft des Clients tragen, sonst `CSRF_ORIGIN_MISMATCH`; ein fehlender Header wird ebenfalls abgelehnt. Kein Double-Submit-Token ([ADR-028](DECISIONS.md)).
- **Idempotenz:** Jede zustandsändernde Anfrage (`POST`, `PATCH`, `DELETE` – Spiel, Inventar, Konto, Mitteilungen, Administration) trägt den Header `Idempotency-Key` (UUID, vom Client erzeugt, bei Wiederholung unverändert); Ausnahmen sind `/auth/guest`, `/auth/login` und `/auth/logout` (nächster Punkt) sowie `POST /challenges/:id/steps/:i/present`, das von Natur aus wiederholbar ist ([§2.3](#23-kampf), ADR-033). Fehlt er, antwortet der Server mit `IDEMPOTENCY_KEY_REQUIRED`. Der Server speichert je Scope und Schlüssel Endpunkt, Hash der Anfrage und Antwort (`idempotency_keys`, 24 h), in derselben Transaktion wie die Wirkung: Eine Wiederholung liefert dieselbe Antwort ohne erneute Wirkung, derselbe Schlüssel mit anderem Inhalt ergibt `IDEMPOTENCY_KEY_REUSED`. Der Scope ist die Konto-ID der Sitzung beim Eintreffen der Anfrage und ändert sich danach nicht (`idempotency_keys.user_id`, Fremdschlüssel auf `users`). Zustandsändernde Anfragen ohne Sitzung gibt es nur bei den Ausnahmen im nächsten Punkt, die ohne Antwortspeicher auskommen. Spielkritische Tabellen speichern den Schlüssel zusätzlich mit einem Unique-Constraint je Akteur, damit die Garantie auch ohne den Antwortspeicher gilt und gleiche Schlüssel verschiedener Konten sich nicht stören (`sieges`: `(attacker_kingdom_id, idempotency_key)`, `item_usage`: `(user_id, idempotency_key)`, `quiz_answers`: `(participant_id, idempotency_key)`); bei `quiz_answers` verhindert außerdem `unique(participant_id, step_index)` mit der bedingten Aktualisierung `where status = 'PRESENTED'`, dass ein Schritt ein zweites Mal beantwortet wird. In den Tabellen unten wird der Header nicht wiederholt.
- **Idempotenz bei Anmeldung:** Sitzungstoken werden nie im Antwortspeicher abgelegt.
  - **`/auth/guest`** nutzt statt eines `Idempotency-Key` ein Bootstrap-Cookie, damit kein Wiederholungsgeheimnis für Skripte lesbar ist. `GET /auth/bootstrap` setzt ohne Sitzung das Cookie `guest_bootstrap` (128 bit Zufall, `HttpOnly`, `Secure`, `SameSite=Strict`, Pfad `/api/v1/auth`, Laufzeit 24 h), sofern es noch fehlt. `POST /auth/guest` verlangt dieses Cookie (sonst `GUEST_BOOTSTRAP_REQUIRED`) und legt je Cookie-Wert höchstens ein Gastkonto an (`users.guest_bootstrap_hash`, SHA-256, unique). Geht die Antwort verloren, findet eine Wiederholung – auch nach Neuladen oder Absturz – dieses Konto und stellt eine neue Sitzung aus, solange zu diesem Konto noch keine authentifizierte Anfrage eingegangen ist (`users.last_seen_at` leer); danach antwortet der Server mit `GUEST_BOOTSTRAP_USED` und legt kein weiteres Konto an. Jede erfolgreiche Antwort löscht das Cookie; ein Aufräumjob leert `guest_bootstrap_hash` nach 24 h, wenn auch das Cookie abgelaufen ist. Ein dennoch doppelt angelegtes Gastkonto (etwa weil Cookies gelöscht wurden) bleibt ungenutzt und wird nach der Inaktivitätsfrist gelöscht ([SECURITY.md §5.2](SECURITY.md#52-umsetzung)).
  - **`/auth/register`** läuft mit der Gastsitzung (Scope = Konto-ID). Der Antwortspeicher hält nur die Konto-ID; eine Wiederholung stellt für dieses Konto eine neue Sitzung aus. Hat die Umwandlung die Gastsitzung bereits ersetzt und ging die Antwort verloren, meldet sich der Spieler mit den gerade gewählten Zugangsdaten über `/auth/login` an.
  - **`/auth/login` und `/auth/logout`** sind von Natur aus wiederholbar und nutzen keinen Antwortspeicher: Eine Wiederholung prüft die Anmeldedaten erneut und stellt eine neue Sitzung aus bzw. beendet eine schon beendete Sitzung ohne Fehler.
- **Zeit:** Antworten enthalten `serverTime`; Restzeiten werden als `remainingMs` geliefert, damit Client-Uhren keine Rolle spielen.
- **Sprache:** aus den Spielereinstellungen; übersteuerbar per `Accept-Language` für nicht angemeldete Seiten.
- **Fehler:** `{ "error": { "code": "REGION_UNDER_SIEGE", "message": "…", "details": {…} } }` mit stabilen, dokumentierten Codes; Nachrichten lokalisiert der Client anhand des Codes.
- **Rate Limiting:** je Sitzung und IP (gleitendes Fenster). Bei genau einem `api`-Prozess im Prozessspeicher; sobald mehrere laufen, mit gemeinsamen Zählern (PostgreSQL oder Load Balancer, später Redis), damit die Grenzen nicht pro Knoten gelten.

## 2. Endpunkte

### 2.1 Konto

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/auth/bootstrap` | Anmeldestatus; ohne Sitzung setzt es das Cookie `guest_bootstrap` ([§1](#1-konventionen)) |
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

Stand Phase 1 Paket 2 (Schemas in `packages/protocol/src/api.ts`): umgesetzt sind `GET /worlds`, `POST /worlds/:worldId/join`, `map/static`, `map/state`, `regions/:regionId` und `kingdoms/:kingdomId`; alle verlangen eine Sitzung, Kartendaten sind auch ohne Teilnahme lesbar. Regions-IDs sind Dezimaltext (`bigint`), Zeitpunkte ISO-8601 in UTC, abgelaufene Schutzzeiten erscheinen als `null`. Höchstens 64 Chunks je Abfrage. `map/static` liefert je angefragtem Chunk die Regionen (auch leere Chunks) mit `ETag`; `Cache-Control: private, max-age=31536000, immutable` nur, wenn jeder angefragte Chunk Regionen hat, sonst `no-cache`, weil ein neuer Ring ihn noch füllen kann. `map/state` liefert Zustand, beteiligte Reiche und `seq` aus einem Schnappschuss (`repeatable read`); `sinceSeq` wird noch nicht ausgewertet (immer voller Zustand), Deltas kommen mit dem WebSocket in Phase 2; bis dahin lädt der Client alle 30 s neu (ADR-036). `regions/:regionId` enthält seit Paket 3 `attack: { allowed, mode, defenderKind, reason, until }` für den Anfragenden: `reason` ist einer der Ablehnungscodes aus [§5](#5-fehlercodes-auszug) in der Prüfreihenfolge von [GAME_RULES.md §4](GAME_RULES.md), `until` das Schutzende bzw. der nächste freie Versuch; ein Ziel im Spielerbesitz zeigt `mode: "PVP"` mit `reason: "PVP_NOT_AVAILABLE"` (PvP folgt in Phase 2). Seit Migration 0009 (ADR-037) enthält es `capital: { lives, maxLives, nextLifeAt }`, wenn die Region eine Hauptstadt ist (sonst `null`; erholte Leben eingerechnet, `nextLifeAt` ist `null` bei vollen Leben), und `protectionReason` kennt zusätzlich `CAPITAL_HIT` (Schutz nach einem Treffer auf die Hauptstadt). `join` wählt die Startregion nach [WORLD_SYSTEM.md §4.2](WORLD_SYSTEM.md#42-startregion-für-neue-spieler-e) und liefert Reich, Hauptstadt und `tutorialTargetRegionId`; `/me` liefert dieses Ziel, solange das Reich genau eine Region hat, und seit Paket 4 je Instanz `openChallengeId`: die Herausforderung eines noch offenen eigenen Angriffs (sonst `null`), damit der Client nach einem Reload ins Quiz zurückkehrt; vorher löst `/me` fällige Kämpfe des Spielers auf (ADR-034).

### 2.3 Kampf

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/instances/:id/attacks` | `{ targetRegionId }` → `{ siegeId, challengeId, mode }` |
| GET | `/challenges/:id` | aktueller Stand für Wiederaufnahme nach Reload: aktueller Schritt, Frage (falls präsentiert), `remainingMs` |
| POST | `/challenges/:id/steps/:i/present` | Frage ausliefern, `presented_at` setzen (wiederholbar, liefert dieselbe Frage) |
| POST | `/challenges/:id/steps/:i/answer` | `{ optionToken }` bzw. `{ rawInput, locale }` plus `{ clientElapsedMs }` (ganze Millisekunden; `locale` derzeit immer `de`, ADR-023) → Bestätigung; bei Schritt 0 inklusive Schätzfrage, wenn beide Seiten richtig lagen; nach dem letzten gestellten Schritt im PvE die Auflösung |
| GET | `/sieges?role=defender&status=open` | Belagerungs-Dashboard |
| GET | `/sieges?role=attacker&status=open` | eigene laufende Angriffe |
| GET | `/sieges/:id` | Details; nach Auflösung inkl. vollständiger Auflösung beider Seiten |
| POST | `/sieges/:id/defense` | Verteidigung beginnen → `challengeId` (Fehler `DEADLINE_TOO_CLOSE`) |
| POST | `/sieges/:id/extend` | `{ itemDefinitionId, expectedNewDeadline }` |

Stand Phase 1 Paket 3 (Schemas in `packages/protocol/src/combat.ts`): umgesetzt sind die vier oberen Zeilen für PvE; die `/sieges`-Endpunkte folgen mit PvP.

- **`POST /instances/:id/attacks`** (201) prüft die Berechtigung nach [GAME_RULES.md §4](GAME_RULES.md) und legt Belagerung, Herausforderung und beide Schritte an; die Antworten der Garnison bzw. des NPC-Reichs entstehen dabei und sind versiegelt, bevor die erste Frage gezeigt wird (ADR-032). Antwort: `{ instanceId, siegeId, challengeId, mode, targetRegionId, defender: { kind, kingdom }, steps: [{ index, kind, timeLimitMs }], serverTime }`. Ein Ziel im Spielerbesitz wird in Phase 1 mit `PVP_NOT_AVAILABLE` abgelehnt.
- **`present`** braucht keinen `Idempotency-Key`: Schritt 0 wird beim ersten Aufruf gestellt (ab dann zählt der Angriffsversuch), jeder weitere Aufruf liefert dieselbe Frage mit denselben Optionstoken und dem ursprünglichen `presentedAt`, protokolliert `STEP_RELOADED` und wertet die Antwort dieses Schritts danach nur mit Serverzeit. Schritt 1 wird mit der Antwort auf Schritt 0 gestellt; `present` für Schritt 1 liefert ihn nur nach einem Reload erneut. Antwort: `{ question, serverTime }`, siehe [§3](#3-beispiel-antwort-auf-present-trivia).
- **`answer`** speichert die Antwort mit Eingangszeit und bestätigt nur „gespeichert“ (`status: "ANSWERED"`), ohne Richtigkeit. Nach Schritt 0 enthält `next` im PvE die Schätzfrage, wenn beide Seiten die Trivia-Frage richtig haben (Tiebreaker, GAME_RULES §5.1); sonst ist `next` `null` und `resolution` enthält sofort die Auflösung. Im PvP (ab Phase 2) enthält `next` nach Schritt 0 immer die Schätzfrage, ohne Hinweis darauf, ob sie zählt ([O-19](DECISIONS.md#o-19-schätzfrage-als-tiebreaker-im-pvp)). Nach Schritt 1 enthält `resolution` die vollständige Auflösung beider Seiten (Fragen, richtige Option, Schätzwert, Antworten, Abstände, Zeiten, Ergebnis); eine nie gestellte Schätzfrage fehlt darin (`estimate: null`), und `GET /challenges/:id` meldet den Schritt als `SKIPPED`. Nach einem Sieg über eine Hauptstadt enthält die Auflösung `capital: { livesLeft, maxLives, takenOver, regionsTaken, protectedUntil }` (sonst `null`): Mit verbleibenden Leben bleibt die Region beim Verteidiger (`conquered: false`, Status trotzdem `ATTACKER_WON`), mit dem letzten Leben übernimmt der Angreifer das Reich (`conquered: true`, `takenOver: true`, `livesLeft: 0`, `regionsTaken` samt Hauptstadt, `protectedUntil: null`). Ohne Übernahme ist `regionsTaken` `null` und `protectedUntil` der Schutz, den dieser Treffer gab (mit dem Ergebnis gespeichert, ändert sich durch spätere Treffer nicht). Das persönliche Ereignis `siege.resolved` trägt dazu `capitalLivesLeft` und `kingdomTakenOver`; ein durch eine Übernahme abgebrochener Angriff meldet `CANCELLED`. Idempotenz über `quiz_answers.idempotency_key`: gleicher Schlüssel und gleiche Antwort liefern denselben Stand, gleicher Schlüssel mit anderer Antwort `IDEMPOTENCY_KEY_REUSED`, ein schon beantworteter Schritt wird nie überschrieben.
- **`GET /challenges/:id`** liefert Status, Schritte mit Status (`PENDING`, `PRESENTED`, `ANSWERED`, `TIMED_OUT`, `SKIPPED` = beendet, ohne gestellt worden zu sein), die offene Frage mit `remainingMs` und nach dem Ende die Auflösung. Die Auflösung zeigt nur Fragen, die tatsächlich gestellt wurden. Herausforderungen anderer Spieler antworten mit 404.
- Fällige Kämpfe werden beim Lesen aufgelöst (Herausforderung, Regionsdetails, neuer Angriff) und zusätzlich minütlich im `api`-Prozess (ADR-034).

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
  "question": {
    "challengeId": "01933b6e-…",
    "step": 0,
    "kind": "TRIVIA",
    "prompt": "Welches chemische Element besitzt die Ordnungszahl 79?",
    "options": [
      { "token": "k7Qp0aZ1b2c", "text": "Platin" },
      { "token": "Zx2m9YtR4q0", "text": "Gold" },
      { "token": "aa9T_x81LmQ", "text": "Kupfer" },
      { "token": "Lr0e-Pc7wE3", "text": "Silber" }
    ],
    "timeLimitMs": 20000,
    "remainingMs": 20500,
    "presentedAt": "2026-11-09T18:00:00.000Z"
  },
  "serverTime": "2026-11-09T18:00:00.000Z"
}
```

Die Antwort enthält weder `option_key`s noch einen Hinweis auf die richtige Option. Optionstoken sind 8 Byte Zufall (Base64url) und gelten nur für diese Präsentation; `remainingMs` reicht bis zur Antwortgrenze (Zeitlimit + `quiz.latencyAllowanceCapMs`). Eine Schätzfrage trägt statt `options` die Felder `unitLabel` und `answerPrecision`.

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
| `NO_ACTIVE_KINGDOM` | Spieler hat in dieser Instanz kein aktives Reich (403) |
| `OWN_REGION` | Zielregion gehört dem Spieler selbst |
| `NOT_ADJACENT` | Zielregion grenzt an keine eigene Region |
| `REGION_UNDER_SIEGE` | aktive Belagerung auf der Region |
| `REGION_PROTECTED` | Schutzzeit der Region aktiv (`details.until`) |
| `KINGDOM_PROTECTED` | Anfänger-/Wiederaufbauschutz des Ziels |
| `RANK_GAP` | Rangabstandsschutz |
| `ATTACKER_SIEGE_LIMIT`, `ATTACKER_ATTEMPT_LIMIT` | Angreiferbudgets erschöpft (`details.resetAt`) |
| `DEFENDER_SIEGE_LIMIT` | Verteidiger hat maximale Zahl offener Belagerungen |
| `CHALLENGE_IN_PROGRESS` | Spieler hat bereits eine laufende Herausforderung |
| `PVP_NOT_AVAILABLE` | Ziel gehört einem Spielerreich; PvP folgt in Phase 2 |
| `NO_QUESTION_AVAILABLE` | keine Frage der benötigten Art im Bestand (`details.kind`) (409) |
| `STEP_EXPIRED` | Antwort nach Zeitlimit des Schritts (`details.deadline`) |
| `STEP_NOT_AVAILABLE` | Schritt noch nicht gestellt oder schon abgeschlossen |
| `CHALLENGE_CLOSED` | Herausforderung ist beendet (`details.status`) |
| `INVALID_OPTION_TOKEN` | Token gehört nicht zur Präsentation dieses Schritts (422) |
| `INVALID_NUMBER_INPUT`, `ANSWER_OUT_OF_RANGE` | Schätzung nicht lesbar (`details.reason`) bzw. außerhalb des Eingabebereichs (422) |
| `DEADLINE_PASSED` | Verteidigung nach Fristende |
| `DEADLINE_TOO_CLOSE` | Restzeit reicht nicht für die Herausforderung |
| `EXTENSION_LIMIT_REACHED` | Frist bereits am Maximum |
| `DEADLINE_CHANGED` | erwartete neue Frist stimmt nicht mehr (Client zeigt neuen Wert) |
| `ITEM_NOT_AVAILABLE` | Item existiert nicht, gehört nicht dem Spieler oder ist verbraucht |
| `INSTANCE_NOT_ACTIVE`, `PVP_CUTOFF_REACHED` | Weltinstanz bzw. Saisonphase erlaubt keine Angriffe |
| `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED` | Header fehlt bzw. Schlüssel mit anderem Anfrageinhalt wiederverwendet |
| `GUEST_BOOTSTRAP_REQUIRED`, `GUEST_BOOTSTRAP_USED` | `/auth/guest` ohne Bootstrap-Cookie bzw. Wiederholung, nachdem das Gastkonto bereits benutzt wurde ([§1](#1-konventionen)) |
| `VALIDATION_FAILED` | Pfad, Abfrage oder Körper ungültig (`details.issues`) (400) |
| `UNAUTHENTICATED` | keine gültige Sitzung (401) |
| `CSRF_ORIGIN_MISMATCH` | zustandsändernde Anfrage ohne passenden `Origin` (403) |
| `NOT_FOUND` | unbekannter Pfad, unbekannte Welt, Instanz, Region oder unbekanntes Reich (404) |
| `ALREADY_JOINED` | Spieler nimmt an der laufenden Instanz schon teil (`details.instanceId`) (409) |
| `INSTANCE_FULL` | Kapazität der Instanz erreicht (409) |
| `NO_START_REGION` | keine Region erfüllt die Startkriterien (409) |
| `CONCURRENT_UPDATE` | gleichzeitige Änderung; dieselbe Anfrage darf wiederholt werden (409) |
| `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR` | technische Fehler (415, 413, 500) |

Fachliche Fehler werden nicht im Antwortspeicher abgelegt: Sie hatten keine Wirkung, eine Wiederholung mit demselben `Idempotency-Key` prüft neu. `IDEMPOTENCY_KEY_REUSED` antwortet mit 422, eine wiederholte Antwort trägt den Header `Idempotency-Replayed: true`.
