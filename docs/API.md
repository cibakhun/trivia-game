# API-Entwurf

Bezug: Brief §12.2, §12.5. REST/JSON für Kommandos und Abfragen, WebSocket für Ereignisse. Alle Schemas liegen als zod-Definitionen in `packages/protocol` und werden von Client und Server gemeinsam genutzt. Präfix: `/api/v1`.

## 1. Konventionen

- **Authentifizierung:** Sitzungscookie `rdw_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, Pfad `/api/v1`, 30 Tage gleitend, höchstens stündlich verlängert). Zustandsändernde Anfragen (`POST`, `PUT`, `PATCH`, `DELETE`) müssen den Header `Origin` mit genau der Herkunft des Clients tragen, sonst `CSRF_ORIGIN_MISMATCH`; ein fehlender Header wird ebenfalls abgelehnt. Kein Double-Submit-Token ([ADR-028](DECISIONS.md)).
- **Idempotenz:** Jede zustandsändernde Anfrage (`POST`, `PATCH`, `DELETE` – Spiel, Inventar, Konto, Mitteilungen, Administration) trägt den Header `Idempotency-Key` (UUID, vom Client erzeugt, bei Wiederholung unverändert); Ausnahmen sind `/auth/guest`, `/auth/login` und `/auth/logout` (nächster Punkt) sowie `POST /challenges/:id/steps/:i/present`, `POST /sieges/:id/defense` und `POST /matches/:id/questions/:seq/present`, die von Natur aus wiederholbar sind (eine Wiederholung liefert dieselbe Frage, [§2.3](#23-kampf), [§2.6](#26-partie), ADR-033, ADR-038). Fehlt er, antwortet der Server mit `IDEMPOTENCY_KEY_REQUIRED`. Der Server speichert je Scope und Schlüssel Endpunkt, Hash der Anfrage und Antwort (`idempotency_keys`, 24 h), in derselben Transaktion wie die Wirkung: Eine Wiederholung liefert dieselbe Antwort ohne erneute Wirkung, derselbe Schlüssel mit anderem Inhalt ergibt `IDEMPOTENCY_KEY_REUSED`. Der Scope ist die Konto-ID der Sitzung beim Eintreffen der Anfrage und ändert sich danach nicht (`idempotency_keys.user_id`, Fremdschlüssel auf `users`). Zustandsändernde Anfragen ohne Sitzung gibt es nur bei den Ausnahmen im nächsten Punkt, die ohne Antwortspeicher auskommen. Spielkritische Tabellen speichern den Schlüssel zusätzlich mit einem Unique-Constraint je Akteur, damit die Garantie auch ohne den Antwortspeicher gilt und gleiche Schlüssel verschiedener Konten sich nicht stören (`sieges`: `(attacker_kingdom_id, idempotency_key)`, `item_usage`: `(user_id, idempotency_key)`, `quiz_answers`: `(participant_id, idempotency_key)`, `match_answers`: `(match_id, seat, idempotency_key)`); bei `quiz_answers` verhindert außerdem `unique(participant_id, step_index)` mit der bedingten Aktualisierung `where status = 'PRESENTED'`, dass ein Schritt ein zweites Mal beantwortet wird. In den Tabellen unten wird der Header nicht wiederholt.
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
| POST | `/auth/guest` | Gastkonto anlegen, Sitzung setzen ([O-03]) |
| POST | `/auth/register` | Gast in gesichertes Konto umwandeln (Benutzername, Passwort, Spielername) |
| POST | `/auth/login`, `/auth/logout` | Anmelden mit Benutzername und Passwort, Abmelden |
| GET | `/me` | Konto, Profil, Einstellungen, aktive Instanzen |
| PATCH | `/me/profile` | Spielername ändern (nur gesicherte Konten) |
| POST | `/me/password` | Passwort ändern (bisheriges Passwort nötig) |
| GET | `/names/player` | fünf freie Spielernamen als Vorschläge |
| PATCH | `/me/settings` | Sprache, Zeitzone, Benachrichtigungen, Auto-Verlängerung |
| POST | `/me/push-subscriptions` | Web-Push-Abonnement registrieren |
| POST | `/me/export` | Datenexport anstoßen (Datenschutz) |
| DELETE | `/me` | Kontolöschung beantragen |

Stand Phase 2 Paket 2 (O-03, O-10, [ADR-043](DECISIONS.md), [ADR-044](DECISIONS.md)): umgesetzt sind `bootstrap`, `guest`, `register`, `login`, `logout`, `GET /me`, `PATCH /me/profile`, `POST /me/password`, `GET /names/player` und `GET /instances/:id/kingdom-names`; Einstellungen, Push, Export und Löschantrag folgen.

- **`POST /auth/register`** (201, mit Gastsitzung und `Idempotency-Key`): Körper `{ username, password, playerName: { adjective, noun, number } }`. Benutzername 3–24 Zeichen aus `A–Z a–z 0–9 Ä Ö Ü ä ö ü ß _ . -`, ohne Rücksicht auf Groß- und Kleinschreibung eindeutig, wird nie öffentlich gezeigt; Passwort 10–128 Zeichen. Konto-ID und Spielstand bleiben, alle Sitzungen des Kontos werden durch eine neue ersetzt. Antwort `{ user: { id, isGuest: false }, serverTime }`. Fehler: `ALREADY_REGISTERED` (409), `USERNAME_TAKEN` (409), `PLAYER_NAME_TAKEN` (409, `details.displayName`), `INVALID_NAME` (422). Ein E-Mail-Feld gibt es noch nicht ([O-03]); ein unbekanntes Feld ergibt `VALIDATION_FAILED`.
- **`POST /auth/login`** (200): Körper `{ username, password }` (nur Längen geprüft). Unbekannter Name, falsches Passwort, Gastkonto und Konto mit Löschantrag antworten gleich mit `INVALID_CREDENTIALS` (401) nach gleichem Aufwand. Nach 10 Fehlversuchen je Benutzername oder 100 je Adresse in 15 min antwortet der Server bis zum Fensterende mit `RATE_LIMITED` (429, `details.retryAfterMs`), auch bei richtigem Passwort. Eine Sitzung, mit der die Anfrage kam, wird beendet (auch die eines anderen Kontos); andere Geräte bleiben angemeldet.
- **`PATCH /me/profile`** (200, mit `Idempotency-Key`): Körper `{ playerName }`; Antwort `{ profile: { displayName, playerName }, serverTime }`, bei Wiederholung das gespeicherte Profil dieser Änderung. Gäste: `GUEST_ACCOUNT` (403).
- **`POST /me/password`** (204, mit `Idempotency-Key`; Passwörter gehen nicht in den Anfrage-Hash): Körper `{ currentPassword, newPassword }`. Falsches bisheriges Passwort: `INVALID_CREDENTIALS` (403), gebremst wie die Anmeldung; Gäste: `GUEST_ACCOUNT` (403). Die Sitzung der Anfrage bleibt, alle anderen des Kontos enden.
- **`GET /me`** enthält zusätzlich `user.username` (nur für den Spieler selbst) und `profile: { displayName, playerName }` (beides `null` bei Gästen).
- **Namensvorschläge:** `GET /names/player` und `GET /instances/:id/kingdom-names` liefern `{ suggestions: [{ parts, name }], serverTime }` mit bis zu fünf Namen, die noch niemand trägt (Spieler) bzw. in der Instanz noch nicht vorkommen (Reiche). Angenommen wird jede gültige Kombination der Bausteine, nicht nur ein gezeigter Vorschlag; andere Werte ergeben `INVALID_NAME`.
- **Passwort vergessen:** Ohne E-Mail setzt die Spielleitung ein neues Passwort mit `pnpm account:reset-password --username=NAME` (Ausgabe einmalig, alle Sitzungen enden; nicht für Konten mit Löschantrag). In Produktion ist der Befehl gesperrt, bis Änderungen an Zugangsdaten mit Akteur und Begründung in `audit_events` protokolliert werden ([§2.5](#25-redaktion-und-administration)).

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

Stand Phase 1 Paket 2 (Schemas in `packages/protocol/src/api.ts`): umgesetzt sind `GET /worlds`, `POST /worlds/:worldId/join`, `map/static`, `map/state`, `regions/:regionId` und `kingdoms/:kingdomId`; alle verlangen eine Sitzung, Kartendaten sind auch ohne Teilnahme lesbar. Regions-IDs sind Dezimaltext (`bigint`), Zeitpunkte ISO-8601 in UTC, abgelaufene Schutzzeiten erscheinen als `null`. Höchstens 64 Chunks je Abfrage. `map/static` liefert je angefragtem Chunk die Regionen (auch leere Chunks) mit `ETag`; `Cache-Control: private, max-age=31536000, immutable` nur, wenn jeder angefragte Chunk Regionen hat, sonst `no-cache`, weil ein neuer Ring ihn noch füllen kann. `map/state` liefert Zustand, beteiligte Reiche und `seq` aus einem Schnappschuss (`repeatable read`); `sinceSeq` wird noch nicht ausgewertet (immer voller Zustand), Deltas kommen mit dem WebSocket in Phase 2; bis dahin lädt der Client alle 30 s neu (ADR-036). `regions/:regionId` enthält seit Paket 3 `attack: { allowed, mode, defenderKind, reason, until }` für den Anfragenden: `reason` ist einer der Ablehnungscodes aus [§5](#5-fehlercodes-auszug) in der Prüfreihenfolge von [GAME_RULES.md §4](GAME_RULES.md), `until` das Schutzende bzw. der nächste freie Versuch. Seit Phase 2 Paket 1 sind Ziele im Spielerbesitz angreifbar (`mode: "PVP"`); `attack.endsOwnProtection` ist `true`, wenn der Angriff den eigenen Anfänger- oder Wiederaufbauschutz beenden würde, damit der Client vorher warnt. Seit Migration 0009 (ADR-037) enthält es `capital: { lives, maxLives, nextLifeAt }`, wenn die Region eine Hauptstadt ist (sonst `null`; erholte Leben eingerechnet, `nextLifeAt` ist `null` bei vollen Leben), und `protectionReason` kennt zusätzlich `CAPITAL_HIT` (Schutz nach einem Treffer auf die Hauptstadt). `join` wählt die Startregion nach [WORLD_SYSTEM.md §4.2](WORLD_SYSTEM.md#42-startregion-für-neue-spieler-e) und liefert Reich, Hauptstadt und `tutorialTargetRegionId`; `/me` liefert dieses Ziel, solange das Reich genau eine Region hat, und seit Paket 4 je Instanz `openChallengeId`: die Herausforderung eines noch offenen eigenen Angriffs oder (seit Phase 2) einer begonnenen Verteidigung (sonst `null`), damit der Client nach einem Reload ins Quiz zurückkehrt, und `incomingSieges`: die Zahl der eröffneten Belagerungen gegen das eigene Reich; vorher löst `/me` fällige Kämpfe des Spielers auf, als Angreifer und als Verteidiger (ADR-034).

Seit Phase 2 Paket 2 nehmen `join` und `respawn` den freiwilligen Körper `{ kingdomName: { prefix, suffix } }` (ein Vorschlag aus `GET /instances/:id/kingdom-names`); ohne Körper zieht der Server den Namen wie bisher. Ein Name außerhalb der Bausteine ergibt `INVALID_NAME`, der Name gehört zum Anfrage-Hash der Idempotenz.

`POST /instances/:id/respawn` (201, mit `Idempotency-Key`, seit Phase 2 Paket 1) gründet nach einem Totalverlust ein neues Reich in einer geeigneten Startregion, mit Wiederaufbauschutz (`protection.respawn`, `protectionReason: "RESPAWN"`) und der nächsten Generation; Antwort wie `join`. Besteht das aktuelle Reich noch: `KINGDOM_ACTIVE`; ohne Teilnahme: `NOT_FOUND`.

### 2.3 Kampf

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/instances/:id/attacks` | `{ targetRegionId }` → `{ siegeId, challengeId, mode }` |
| GET | `/challenges/:id` | aktueller Stand für Wiederaufnahme nach Reload: aktueller Schritt, Frage (falls präsentiert), `remainingMs` |
| POST | `/challenges/:id/steps/:i/present` | Frage ausliefern, `presented_at` setzen (wiederholbar, liefert dieselbe Frage) |
| POST | `/challenges/:id/steps/:i/answer` | `{ optionToken }` bzw. `{ rawInput, locale }` plus `{ clientElapsedMs }` (ganze Millisekunden; `locale` derzeit immer `de`, ADR-023) → Bestätigung; bei Schritt 0 inklusive Schätzfrage, wenn beide Seiten richtig lagen (PvP: immer); nach dem letzten gestellten Schritt die Auflösung (PvP-Angreifer: Belagerung eröffnet, Auflösung später) |
| GET | `/instances/:id/sieges` | Belagerungsübersicht des Spielers: `incoming`, `outgoing`, `recent` |
| POST | `/sieges/:id/defense` | Verteidigung beginnen → `{ siegeId, challengeId, question }` (Fehler `DEADLINE_TOO_CLOSE`, `DEADLINE_PASSED`, `CHALLENGE_IN_PROGRESS`) |
| POST | `/sieges/:id/extend` | `{ itemDefinitionId, expectedNewDeadline }` |

Stand Phase 2 Paket 1 (Schemas in `packages/protocol/src/combat.ts`): umgesetzt sind alle Zeilen außer `extend` (Items, Phase 4). Statt der geplanten `GET /sieges?role=…` und `GET /sieges/:id` gibt es eine Übersicht je Instanz; Details und Auflösung liefert `GET /challenges/:id`, weil Angreifer und Verteidiger dieselbe Herausforderung teilen (ADR-041).

- **`POST /instances/:id/attacks`** (201) prüft die Berechtigung nach [GAME_RULES.md §4](GAME_RULES.md) und legt Belagerung, Herausforderung und beide Schritte an; im PvE entstehen dabei die Antworten der Garnison bzw. des NPC-Reichs und sind versiegelt, bevor die erste Frage gezeigt wird (ADR-032). Antwort: `{ instanceId, siegeId, challengeId, mode, targetRegionId, defender: { kind, kingdom }, steps: [{ index, kind, timeLimitMs }], serverTime }`. Ein PvP-Angriff beendet den eigenen Anfänger- bzw. Wiederaufbauschutz sofort (GAME_RULES §7).
- **PvP-Ablauf** (SIEGE_SYSTEM §3–§4, ADR-038): Der Angreifer beantwortet beide Fragen wie im PvE; nach seiner letzten Antwort ist `resolution` `null` und die Belagerung `AWAITING_DEFENSE` mit Frist (`GET /challenges/:id` liefert `deadlineAt`). Seine Antworten sind mit `ATTACK_SUBMITTED` samt SHA-256-Commitment versiegelt. Verpasst er die Wissensfrage, endet der Angriff als `ATTACK_FAILED`/`ABANDONED` ohne Belagerung. Beide Seiten erhalten `siege.opened`. Der Verteidiger sieht die Belagerung erst ab der Eröffnung (vorher antworten Herausforderung und `defense` mit 404, verdecktes Gate).
- **`POST /sieges/:id/defense`** (200, ohne `Idempotency-Key`) setzt die Belagerung auf `DEFENDING` und stellt in derselben Transaktion die Wissensfrage des Verteidigers; die Antwort enthält sie direkt, damit sie nicht als Reload zählt. Nur vor der Frist und mit genug Restzeit für beide Fragen plus `startBuffer` (sonst `DEADLINE_TOO_CLOSE`, nach Fristende `DEADLINE_PASSED`; abgelaufene eigene Kämpfe löst der Server vorher auf), und nur ohne andere laufende Herausforderung des Verteidigers (`CHALLENGE_IN_PROGRESS`). Eine Wiederholung liefert dieselbe Frage (als Reload protokolliert). Danach antwortet der Verteidiger über `answer` derselben Herausforderung; nach Schritt 1 enthält die Antwort die Auflösung. Der Angreifer erhält `siege.updated`.
- **`GET /instances/:id/sieges`** löst fällige Kämpfe des Spielers zuerst auf und liefert `{ incoming, outgoing, recent, serverTime }` mit Einträgen `{ siegeId, challengeId, mode, role, status, regionId, region: { q, r, biome, tier, isCapital }, attacker, defender, createdAt, openedAt, deadlineAt, remainingMs, defenseStartedAt, canDefend, defendBlockedBy, resolvedAt, winner, reason, defensePoints }`: eröffnete Belagerungen gegen den Spieler (dringendste zuerst, `canDefend` bzw. `defendBlockedBy` `DEADLINE_TOO_CLOSE`/`DEADLINE_PASSED`/`CHALLENGE_IN_PROGRESS`), eigene offene Angriffe und die höchstens zehn zuletzt entschiedenen Kämpfe der letzten 24 Stunden.
- **`present`** braucht keinen `Idempotency-Key`: Schritt 0 wird beim ersten Aufruf gestellt (ab dann zählt der Angriffsversuch), jeder weitere Aufruf liefert dieselbe Frage mit denselben Optionstoken und dem ursprünglichen `presentedAt`, protokolliert `STEP_RELOADED` und wertet die Antwort dieses Schritts danach nur mit Serverzeit. Schritt 1 wird mit der Antwort auf Schritt 0 gestellt; `present` für Schritt 1 liefert ihn nur nach einem Reload erneut. Antwort: `{ question, serverTime }`, siehe [§3](#3-beispiel-antwort-auf-present-trivia).
- **`answer`** speichert die Antwort mit Eingangszeit und bestätigt nur „gespeichert“ (`status: "ANSWERED"`), ohne Richtigkeit. Nach Schritt 0 enthält `next` im PvE die Schätzfrage, wenn beide Seiten die Trivia-Frage richtig haben (Tiebreaker, GAME_RULES §5.1); sonst ist `next` `null` und `resolution` enthält sofort die Auflösung. Im PvP (ab Phase 2) enthält `next` nach Schritt 0 immer die Schätzfrage, ohne Hinweis darauf, ob sie zählt ([O-19](DECISIONS.md#o-19-schätzfrage-als-tiebreaker-im-pvp)). Nach Schritt 1 enthält `resolution` die vollständige Auflösung beider Seiten (Fragen, richtige Option, Schätzwert, Antworten, Abstände, Zeiten, Ergebnis); eine nie gestellte Schätzfrage fehlt darin (`estimate: null`), und `GET /challenges/:id` meldet den Schritt als `SKIPPED`. Nach einem Sieg über eine Hauptstadt enthält die Auflösung `capital: { livesLeft, maxLives, takenOver, regionsTaken, protectedUntil }` (sonst `null`): Mit verbleibenden Leben bleibt die Region beim Verteidiger (`conquered: false`, Status trotzdem `ATTACKER_WON`), mit dem letzten Leben übernimmt der Angreifer das Reich (`conquered: true`, `takenOver: true`, `livesLeft: 0`, `regionsTaken` samt Hauptstadt, `protectedUntil: null`). Ohne Übernahme ist `regionsTaken` `null` und `protectedUntil` der Schutz, den dieser Treffer gab (mit dem Ergebnis gespeichert, ändert sich durch spätere Treffer nicht). Das persönliche Ereignis `siege.resolved` trägt dazu `capitalLivesLeft` und `kingdomTakenOver`; ein durch eine Übernahme abgebrochener Angriff meldet `CANCELLED`. Idempotenz über `quiz_answers.idempotency_key`: gleicher Schlüssel und gleiche Antwort liefern denselben Stand, gleicher Schlüssel mit anderer Antwort `IDEMPOTENCY_KEY_REUSED`, ein schon beantworteter Schritt wird nie überschrieben.
- **`GET /challenges/:id`** liefert Rolle (`role`: `ATTACKER` oder im PvP `DEFENDER`), Gegner (`opponent`, `null` bei Garnisonen), Status, Frist (`deadlineAt`, nur PvP ab Eröffnung), Schritte mit Status (`PENDING`, `PRESENTED`, `ANSWERED`, `TIMED_OUT`, `SKIPPED` = beendet, ohne gestellt worden zu sein), die offene Frage mit `remainingMs` und nach dem Ende die Auflösung. Die Auflösung zeigt nur Fragen, die tatsächlich gestellt wurden, und enthält `mode` und `defensePoints` (Verteidigungspunkte dieses Kampfes, im PvE immer 0). Herausforderungen ohne eigene Beteiligung antworten mit 404.
- Fällige Kämpfe werden beim Lesen aufgelöst (Herausforderung, Regionsdetails, Belagerungsübersicht, neuer Angriff, Verteidigungsbeginn) und zusätzlich minütlich im `api`-Prozess, im PvP auch der Fristablauf (ADR-034).

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

### 2.6 Partie

Rundenbasierte Partie für zwei oder drei Spieler ([MATCH_RULES.md](MATCH_RULES.md), ADR-046 bis ADR-050, ADR-052; mit Ausbau ADR-057 und ADR-058). Schemas in `packages/protocol/src/match-api.ts`, `match-events.ts` und `match-realm.ts`, Server in `apps/server/src/modules/match/`, Browser unter `/partie` (`apps/web/src/match/`). Stand Paket A3: alle Zeilen umgesetzt und im Browser bedient, auch die Spielart `REALM` mit `favorites` und `orders` (ADR-060); der Client fragt `GET /matches/:id` bis zum WebSocket (M3) in der Aufstellung alle 1,5 s und im Spiel alle 0,75 s ab (ADR-050).

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/matches` | Aufstellung anlegen: `{ kind: "STANDARD", rules?, mode? }` oder `{ kind: "TEST", rules?, mode?, seats, botStrengths }` → 201 `{ matchId, serverTime }` |
| POST | `/matches/join` | `{ inviteCode }` → `{ matchId, serverTime }` |
| POST | `/matches/:id/leave` | Aufstellung verlassen; verlässt der Gastgeber sie, fällt die Partie aus |
| POST | `/matches/:id/seats/:joinOrder/bot` | nur Gastgeber, nur normale Partie: `{ strength }` mit `EASY`, `MEDIUM` oder `HARD` setzt einen Bot auf den freien Platz 0 bis 2 oder ändert seine Stärke, `null` macht den Platz frei (ADR-052) |
| POST | `/matches/:id/favorites` | nur mit Ausbau, in der Aufstellung: `{ categories }` legt die Lieblingskategorien des eigenen Platzes fest (ADR-058) |
| POST | `/matches/:id/start` | nur Gastgeber: Karte nach Spielerzahl festlegen, Bots einsetzen (Testpartie), Zugreihenfolge losen, erste Wahl beginnen |
| GET | `/matches` | offene und zuletzt gespielte Partien des Kontos (mit `mode`), `testMatchesEnabled`, `realmMatchesEnabled` |
| GET | `/matches/:id?after=n` | Ansicht: Teilnehmer, Brett mit Zugfolge, Phase mit Frist, wählbare Regionen, laufende Frage, Ereignisse nach `n` |
| POST | `/matches/:id/pick` | `{ region }`: Hauptstadt, Region der Landnahme oder Angriffsziel |
| POST | `/matches/:id/orders` | nur mit Ausbau, in der Rüstzeit: `{ orders }` gibt die Befehle des eigenen Reichs ab oder ersetzt sie (ADR-058) |
| POST | `/matches/:id/questions/:seq/present` | Frage abholen (ohne `Idempotency-Key`, wiederholbar) |
| GET | `/matches/:id/questions/:seq/watch` | laufende Frage mitlesen, für alle, die nicht gefragt sind (ADR-065) |
| POST | `/matches/:id/questions/:seq/answer` | `{ optionToken }` bzw. `{ rawInput, locale }` plus `{ clientElapsedMs }` → `{ status: "ANSWERED" }` |

- **Aufstellung.** `rules` ist `DEFAULT` oder `PLAYTEST` (verkürzte Zeiten). Der Einladungscode hat sechs Zeichen ohne 0, O, 1 und I; die Eingabe ist unabhängig von Groß- und Kleinschreibung und Leerzeichen. Jedes Konto ist in höchstens einer offenen Partie (`ALREADY_IN_MATCH` mit `details.matchId`); ein zweiter Beitritt zur selben Partie bleibt ohne Wirkung. Eine normale Partie nimmt drei Spieler auf, eine Testpartie `seats` (`MATCH_FULL`); sitzt in einer vollen normalen Partie ein Bot, weicht der auf dem hintersten Platz dem beitretenden Menschen (`PLAYER_LEFT`, dann `PLAYER_JOINED`). Testpartien gibt es nicht in Produktion (`TEST_MATCHES_DISABLED`, ADR-048). Nicht gestartete Aufstellungen verfallen nach zwei Stunden (`MATCH_ABANDONED` mit `reason: "LOBBY_EXPIRED"`).
- **Einladungslink** (ADR-052). `/partie/beitreten/<Code>` ist eine Seite des Browsers, kein eigener Endpunkt: Mit Sitzung ruft sie sofort `POST /matches/join` mit dem Code aus dem Pfad auf (Groß- und Kleinschreibung egal) und wechselt in die Aufstellung; Fehler wie `INVITE_CODE_UNKNOWN`, `MATCH_FULL` oder `ALREADY_IN_MATCH` zeigt sie an. Ohne Sitzung legt erst ein Tipp das Gastkonto an (`POST /auth/guest`), danach folgt der Beitritt. Der Link, den die Aufstellung kopiert, entsteht aus der Adresse, unter der das Spiel gerade läuft.
- **Bots in der Aufstellung** (ADR-052). `POST /matches/:id/seats/:joinOrder/bot` gilt nur für den Gastgeber (`NOT_HOST`), nur in der Aufstellung (`MATCH_NOT_IN_LOBBY`) und nur für Plätze einer normalen Partie, auf denen kein Mensch sitzt (`SEAT_NOT_AVAILABLE`, auch für jede Testpartie). Dieselbe Stärke noch einmal oder `null` auf einem freien Platz bleibt ohne Wirkung. Ein gesetzter Bot erscheint in `players` wie ein Mitspieler (`isBot`, `botStrength`) und als Ereignis `PLAYER_JOINED` mit `bot`, ein entfernter als `PLAYER_LEFT` mit `bot`. Partien mit mindestens einem Bot zählen nicht in der Statistik.
- **Start.** Nur der Gastgeber (`NOT_HOST`), nur aus der Aufstellung (`MATCH_NOT_IN_LOBBY`). Eine normale Partie braucht zwei oder drei Mitspieler, Menschen und gesetzte Bots zusammen (`NOT_ENOUGH_PLAYERS`); in einer Testpartie füllen Bots die freien Plätze, die Stärken aus `botStrengths` von vorn. Die Spielerzahl legt Karte und Landnahme fest (`matchRulesForSeats`: zu zweit `KERNMARK`, zu dritt `WENDELMARK`). Fehlt eine Frageart im Bestand, startet die Partie nicht (`NO_QUESTION_AVAILABLE`). Die Zugreihenfolge wird aus dem Strom `match` gelost; dann beginnt die Wahl der ersten Hauptstadt.
- **Ansicht.** `GET /matches/:id` holt fällige Schritte zuerst nach. Sie enthält `match` (Art, Status, Code nur in der Aufstellung, Plätze, Zeiten `timers` einschließlich `announceMs` und `pickShowMs`, 0 in Partien von vor ADR-053), `players` (Name, Sitz, Bot und Stärke, Gastgeber, ich), `mySeat`, `board` (Karte `map`; Regionen mit Besitzer, Wert, Hauptstadt, Befestigungen; Sitze mit Punkten, Regionen, Hauptstadtleben; aktueller Schritt; Zugfolge `turns` als Liste `{ seat, status }` mit `DONE`, `NOW` oder `NEXT`, [MATCH_RULES.md §3](MATCH_RULES.md#zugfolge)), `phase` (`PICK`, `QUESTION`, `REVEAL` oder `ANNOUNCE` mit `deadline` und `remainingMs`), `legalRegions` (nur für den, der gerade wählt), `question` (laufende oder zuletzt aufgelöste Frage ohne Inhalt: `seq`, Art, Zweck `LAND`/`DUEL_TRIVIA`/`DUEL_ESTIMATE`, mit Ausbau auch `START`, Sitze, `answered`, `closesAt`, `resolved`, `myStatus`) und `events` nach `after` (höchstens 200) mit `lastEventSeq`. Wer nicht teilnimmt, bekommt 404.
- **Wahl.** Nur wer dran ist (`NOT_YOUR_TURN`), nur erlaubte Regionen (`INVALID_REGION`), nur in Phase `PICK` (`STEP_NOT_AVAILABLE`). Bis zur Frist (`pickMs` + Latenzpuffer); danach wählt der Server zufällig eine erlaubte Region (`AUTO_PICKED`). Bots wählen sofort.
- **Ansage** (ADR-053). Phase `ANNOUNCE` nimmt keine Eingabe an (`pick` antwortet `STEP_NOT_AVAILABLE`) und endet von selbst. Sie folgt auf jede Wahl, solange diese das jüngste Ereignis ist (`CAPITAL_CHOSEN` oder `REGION_CLAIMED`, Dauer `pickShowMs`), außer derselbe Mensch wählt gleich noch einmal; vor der Wissensfrage eines Duells steht sie mit dem Schritt `DUEL_TRIVIA`, in dem Angreifer, Verteidiger und Region schon feststehen (jüngstes Ereignis `TARGET_CHOSEN`, Dauer `announceMs`). Die Frage wird erst danach geöffnet, ihre Zeit läuft also nicht während der Ansage. Auf die Auflösung der Wissensfrage folgt das Stechen ohne weitere Ansage.
- **Frage.** Eine Frage gilt für die Sitze des Schritts (Landnahme: alle lebenden, Duell: Angreifer und Verteidiger; mit Ausbau beim Angriff auf ein freies Feld der Angreifer allein, `seats` hat dann einen Eintrag) und ist für alle gleich, auch die Reihenfolge der Optionen. Das erste `present` hält `presentedAt` fest; die eigene Frist ist Zeitlimit + Latenzpuffer, höchstens bis `closesAt` (Öffnen + Zeitlimit + Latenzpuffer + 2 s zum Abholen). Ein weiteres `present` liefert dieselbe Frage mit derselben Frist und wertet die Antwort danach nur mit Serverzeit. Nach `closesAt` ist die Frage geschlossen (`STEP_EXPIRED`); wer sie nie abgeholt hat, hat sie verpasst. Andere Sitze bekommen `STEP_NOT_AVAILABLE`; sie lesen mit (nächster Punkt).
- **Mitlesen** (ADR-065, [O-38] Auswahl A). `GET /matches/:id/questions/:seq/watch` liefert die laufende Frage jedem Mitglied der Partie, das an ihr nicht gefragt ist, auch einem gefallenen Reich: `{ question, serverTime }` in derselben Form wie `present` (Frage, bei einer Wissensfrage die Antworten mit denselben Token in derselben Reihenfolge, bei einer Schätzfrage Einheit und Genauigkeit). Die Route liest nur: keine Zeile in `match_answers`, kein eigener Zeitlauf, beliebig oft wiederholbar. `presentedAt` ist das Öffnen der Frage, `remainingMs` der Rest des Zeitlimits von da an (ohne Latenzpuffer, nie negativ); sind nur Bots gefragt, zählt `remainingMs` nur bis zum Ende ihrer Bedenkzeit, mit dem die Frage endet. Wann eine Frage an Menschen wirklich endet, sagt weiter die Ansicht. Sie nennt nie die Lösung und nie, was ein Sitz gewählt hat; die Token taugen für Zuschauer zu nichts, `answer` lehnt sie ab. Wer gefragt ist, bekommt `STEP_NOT_AVAILABLE` (seine Zeit beginnt erst mit `present`), nach der Auflösung und für jede frühere Frage gibt es `STEP_EXPIRED` (alles steht dann in `QUESTION_RESOLVED`), wer nicht zur Partie gehört oder eine unbekannte Frage nennt, bekommt 404. Auch eine Frage, an der nur Bots gefragt sind, ist mitzulesen: Sie bleibt offen, bis die Bedenkzeit der Bots um ist ([O-43] Auswahl A, nächster Punkt).
- **Antwort.** Speichert mit Eingangszeit vor jeder Sperre und bestätigt nur „gespeichert“, ohne Richtigkeit (QUIZ_ENGINE §7.2). Haben alle Menschen der Frage geantwortet, löst der Server sofort auf, sonst bei `closesAt` + 1 s. Ist kein Mensch gefragt, endet die Frage, sobald der letzte gefragte Bot fertig ist (seine Bedenkzeit, siehe unten; höchstens das Zeitlimit): `phase.deadline` nennt diese Frist, `question.closesAt` bleibt wie bei jeder Frage, und `present` gibt es für niemanden (ADR-065, [O-43] Auswahl A). Sofort aufgelöst wird eine solche Frage nur, wenn kein Mensch zur Partie gehört. Die Auflösung steht für alle zugleich im Ereignis `QUESTION_RESOLVED` (Lösung, Erklärung, je Sitz Antwort, richtig, Abstand, Zeit); Bot-Antworten stehen beim Öffnen fest und erscheinen erst dort. Vorher sagt `question.answered` nur, wessen Antwort schon da ist (ADR-060): die Sitze der Frage, aufsteigend, ohne Antwort, Richtigkeit oder Zeit. Ein Mensch steht darin, sobald seine Antwort gespeichert ist (Abholen allein zählt nicht), ein Bot nach seiner Bedenkzeit: bei der Schätzfrage die Zeit seiner Antwort, bei der Wissensfrage 20 bis 55 % des Zeitlimits, fest je Partie, Frage und Sitz (`botThinkMs`). Nach der Auflösung stehen alle darin, die geantwortet haben. Danach bleibt die Auflösung `revealMs` lang stehen (Phase `REVEAL`), auch nach der letzten Frage der Partie (ADR-055, [MATCH_RULES.md §5](MATCH_RULES.md#letzte-auflösung)): Dann steht der Schritt schon auf `FINISHED` (mit `finishReason` und `round`, der Feldzugrunde, in der Schluss war; `null` in Partien von vor ADR-055), `MATCH_FINISHED` ist das jüngste Ereignis, der Status bleibt `RUNNING`, und `turns` nennt die Sitze der letzten Runde als `DONE`. Erst nach Ablauf wechselt der Status auf `FINISHED`, `phase` wird `null` und `turns` leer; ein weiteres Ereignis gibt es dabei nicht. Idempotenz wie bei Herausforderungen über `match_answers.idempotency_key`.
- **Partie mit Ausbau** (ADR-058, [MATCH_RULES.md §11](MATCH_RULES.md#11-ausbau-burgen-dörfer-armeen)). `mode` beim Anlegen ist `CLASSIC` (Standard, alles wie oben) oder `REALM`. Die Spielart steht mit der Aufstellung fest (`match.mode`, auch in der Liste und im Ereignis `MATCH_CREATED`). `REALM` gibt es nicht in Produktion, bis der Spieltest sie freigibt (der Browser zeigt sie seit ADR-060) (`REALM_MATCHES_DISABLED` beim Anlegen und beim Start, `realmMatchesEnabled` in `GET /matches`). Beitritt, Einladungslink, Bots in der Aufstellung, Testpartie, Wahl, Frage, Antwort, letzte Auflösung und Ablaufsteuerung gelten unverändert; die Regeln sind `DEFAULT_REALM_RULES` oder `PLAYTEST_REALM_RULES`, zu zweit auf der Kernmark. Was abweicht, steht in den nächsten vier Punkten.
- **Lieblingskategorien** (nur `REALM`). `POST /matches/:id/favorites` gilt für den eigenen Platz und nur in der Aufstellung (`MATCH_NOT_IN_LOBBY`); ohne Ausbau antwortet es mit `STEP_NOT_AVAILABLE`. Gültig sind genau `realm.favoritesCount` (4) verschiedene Kategorien aus `realm.categories`, sonst `INVALID_FAVORITES` mit `details.count` und `details.categories`. `realm.categories` sind die Kategorien des Glücksrads: jede mit mindestens so vielen Wissensfragen, die sich den Spielern der Aufstellung stellen lassen, wie `REALM_MIN_CATEGORY_QUESTIONS` verlangt (Standard 20, lokal und im Test 1). Das Konto merkt sich die Wahl und bringt sie in die nächste Aufstellung mit. `players[].favorites` zeigt in der Aufstellung nur eine Wahl, die gerade gilt, sonst `null`. Beim Start lost der Server für Bots und für jeden Platz ohne gültige Wahl (Strom `match`); ab dann stehen die Lieblingskategorien aller Sitze in `players[].favorites`, in `realm.board.seats[].favorites` und im Ereignis `MATCH_STARTED`. Stehen weniger Kategorien auf dem Rad als `favoritesCount`, startet die Partie nicht (`NOT_ENOUGH_CATEGORIES` mit `details.categories`, `needed`, `minQuestions`).
- **Ansicht mit Ausbau.** `board` ist `null`, stattdessen steht `realm` (in Partien ohne Ausbau `null`): `categories`, `favoritesCount`, `campaignRounds`, `economy` (Regelwerte des Ausbaus: Kosten, Erträge, Lose, Zeiten), `myOrders` und ab dem Start `board`. Das Brett nennt `map`, `regions` (Besitzer, Wert, Befestigungen, Gebäude `NONE`, `VILLAGE`, `TOWN` oder `CASTLE`, `castleLivesLeft`, `startCastleOf`, `armies`), `seats` (Lieblingskategorien, Brot, Baustoff, Einkommen je Runde nach heutigem Stand, Startburg, Zahl der Burgen und ihre Leben, ausgeschieden, Punkte, Felder), `order` (Reihenfolge aus der Startfrage), `step`, `turns`, `questions` und `duels`. `step` trägt je nach Schritt Runde, Angreifer, Verteidiger, Region, Kategorie, Rad und `finishReason`; beim Angriff auf ein freies Feld ist `defender` `null`, obwohl Angreifer und Region gesetzt sind (ADR-062). `economy.landGrabRounds` nennt die Runden der Landnahme und fehlt in Partien, die vor ADR-062 gestartet wurden. Eine Region mit `owner: null` gibt es seitdem auch im Feldzug; Schritte sind `START_ESTIMATE`, `CASTLE_PICK`, `VILLAGE_PICK`, `LAND_ESTIMATE`, `LAND_PICK`, `PREPARE`, `CAMPAIGN_TARGET`, `DUEL_TRIVIA`, `DUEL_ESTIMATE` und `FINISHED`. `DUEL_WHEEL` steht seit ADR-071 als Ansage in der Ansicht (`phase` = `ANNOUNCE`): Angreifer, Verteidiger, Region und Rad sind gesetzt, `category` ist noch `null`, `legalRegions` ist leer; in Partien ohne `timers.announceMs` kommt der Schritt in keiner Ansicht vor. `phase` kennt zusätzlich `PREPARE`, `question.purpose` zusätzlich `START` (Startfrage). `legalRegions` gilt für Burg, Startdorf, Landnahme und Angriffsziel; als Angriffsziel stehen dort auch freie Felder am eigenen Land. Seit ADR-064 nennt `economy.attackNeedsArmy` (`ALWAYS` oder `RIVALS`; fehlt in Partien, die vor ADR-064 gestartet wurden), ob ein Angriffsziel eine eigene Armee auf einem Nachbarfeld braucht ([MATCH_RULES.md §11.4](MATCH_RULES.md#114-armeen-und-rüstzeit)): `legalRegions` enthält dann nur solche Felder, und ein anderes Feld an der Grenze lehnt `pick` mit `INVALID_REGION` ab. Ein Reich ohne Ziel bekommt keine Wahl: Sein Angriff fällt aus (`ATTACK_SKIPPED`), und der Nächste ist dran.
- **Rüstzeit** (Phase `PREPARE`, nur `REALM`). Nach dem Einkommen jeder Feldzugrunde (`INCOME`) rüsten alle lebenden Reiche gleichzeitig; die Frist ist `economy.timers.prepareMs` + Latenzpuffer. Bots geben sofort ab. `POST /matches/:id/orders` mit `{ orders }` (höchstens 200 Befehle `BUILD`, `RECRUIT`, `MOVE`, `TRADE`, [MATCH_RULES.md §11.4](MATCH_RULES.md#114-armeen-und-rüstzeit)) gibt die Befehle des eigenen Reichs ab; eine weitere Abgabe ersetzt die vorige, eine leere Liste heißt „fertig, ohne etwas zu tun“. Außerhalb der Rüstzeit und ohne Ausbau antwortet es mit `STEP_NOT_AVAILABLE`, für ein ausgeschiedenes Reich mit `NOT_YOUR_TURN`. Der Server prüft die ganze Liste gegen den Stand vom Beginn der Rüstzeit und lehnt sie als Ganzes ab (`INVALID_ORDERS` mit `details.reason` und `details.index`, der Stelle des ersten unmöglichen Befehls); dann bleibt die vorige Abgabe stehen. Bis zum Aufdecken sieht jeder nur die eigenen Befehle (`realm.myOrders`) und wer fertig ist (`turns` mit `DONE`, Ereignis `ORDERS_SUBMITTED` ohne Inhalt); Vorräte, Gebäude und Armeen ändern sich in der Ansicht erst beim Aufdecken. Haben alle abgegeben, deckt der Server sofort auf, sonst nach der Frist (`PREPARE_CLOSED` mit `missing`; wer fehlt, tut in dieser Runde nichts). Aufgedeckt wird je Reich mit `ORDERS_REVEALED` (Befehle, Zusammenfassung, Vorräte danach); das bleibt `economy.timers.ordersRevealMs` lang als `ANNOUNCE` stehen, dann wählt der erste Angreifer. Fielen alle Angriffe der Runde aus (ADR-064), steht hinter dem Aufdecken schon `ATTACK_SKIPPED` je Reich und `INCOME` der nächsten Runde oder `REALM_MATCH_FINISHED`, und `step` der Ansicht ist während dieser Ansage schon `PREPARE` der nächsten Runde oder `FINISHED` (Status weiter `RUNNING`); danach beginnt die Rüstzeit oder die Abrechnung. `pick` antwortet in der Rüstzeit mit `STEP_NOT_AVAILABLE`.
- **Glücksrad** (nur `REALM`). Steht ein Angriffsziel fest, sagt der Server den Angriff erst `timers.announceMs` lang an (Schritt `DUEL_WHEEL`, ADR-071) und dreht das Rad danach (Strom `match`); ohne `announceMs` dreht er es in derselben Anfrage. `TARGET_CHOSEN` trägt das Rad (`wheel`: Lose beider Seiten und freie, je Kategorie ganzzahlige Teile; bei einem freien Feld ist `defender` `null` und `defenderLots` 0, [MATCH_RULES.md §11.5](MATCH_RULES.md#115-glücksrad)), `WHEEL_SPUN` die Kategorie. Danach steht die Ansage `economy.timers.wheelMs` lang mit Schritt `DUEL_TRIVIA`, Kategorie und Rad in `realm.board.step`; dann öffnet die Wissensfrage aus dieser Kategorie (`QUESTION_OPENED.category`). Kategorien des Rads ohne ungestellte Wissensfrage können nicht gezogen werden (`WHEEL_SPUN.exhausted`). Hat keine Kategorie des Rads mehr eine, gilt das ganze Rad, und die Frage kommt aus dem übrigen Bestand; erst wenn es gar keine ungestellte mehr gibt, wiederholt sich eine.
- **Ereignisse** (`match_events`, fortlaufend je Partie, nennen Sitze statt Konten): `MATCH_CREATED`, `PLAYER_JOINED`, `PLAYER_LEFT`, `MATCH_STARTED`, `CAPITAL_CHOSEN`, `QUESTION_OPENED`, `QUESTION_RESOLVED`, `LAND_RANKED`, `REGION_CLAIMED`, `AUTO_PICKED`, `TARGET_CHOSEN`, `DUEL_RESOLVED`, `KINGDOM_ELIMINATED`, `MATCH_FINISHED` (mit Endstand), `MATCH_ABANDONED` (`reason`: `HOST_LEFT`, `LOBBY_EXPIRED`, `NO_QUESTION_AVAILABLE`, `INTERNAL_ERROR`). Den Inhalt je Typ beschreibt `matchEventPayloadSchemas` in `packages/protocol/src/match-events.ts`; `parseMatchEvent` liefert ein geprüftes Ereignis oder `null` für unbekannte Typen und unpassenden Inhalt, sodass ein älterer Client neue Ereignisse überspringt. Zusätzliche Felder wie der Zufallsnachweis `rng` stehen im Protokoll, gehören aber nicht zum Schema. Tests halten Server und Schema gleich (ganze Partien in `match.int.test.ts`, 200 simulierte Partien in `match-simulation.test.ts`). Die Partie mit Ausbau schreibt dieselben Ereignisse, wo der Inhalt passt, mit zusätzlichen Feldern, die im Schema optional sind (`mode`, `categories` und `favorites` in `MATCH_STARTED`, `category` in `QUESTION_OPENED`, `wheel` in `TARGET_CHOSEN`, `bread` und `material` in `KINGDOM_ELIMINATED`), und eigene: `START_RANKED`, `CASTLE_CHOSEN`, `VILLAGE_CHOSEN`, `INCOME`, `ORDERS_SUBMITTED`, `PREPARE_CLOSED`, `ORDERS_REVEALED`, `ATTACK_SKIPPED` (`round`, `attacker`: Der Angriff dieses Reichs fällt in dieser Runde aus, weil keine eigene Armee neben einem Ziel steht, ADR-064), `WHEEL_SPUN`, `REALM_DUEL_RESOLVED` (mit Kategorie, Wirkung, Gebäude, Burgleben und verlorener Armee; `effect` ist `CONQUERED`, `BUILDING_DAMAGED`, `CASTLE_HIT`, `CASTLE_DESTROYED`, `TAKEOVER`, `FORTIFIED` oder beim Angriff auf ein freies Feld `CLAIMED` und `UNCLAIMED`, dann mit `defender: null`, ohne verlorene Armee und bei `UNCLAIMED` mit `winner: 'NONE'`) und `REALM_MATCH_FINISHED` (Endstand mit Burgleben). `CAPITAL_CHOSEN`, `DUEL_RESOLVED` und `MATCH_FINISHED` kommen dort nicht vor. Ganze Partien mit Ausbau prüft `realm-match.int.test.ts` gegen das Schema.
- **Ablaufsteuerung.** Fristen arbeitet der `api`-Prozess etwa zweimal je Sekunde ab, zusätzlich jede Ansicht, Wahl und Antwort. Alles steht in der Datenbank; nach einem Neustart macht der erste Lauf weiter, neue Fristen zählen ab dann (ADR-049).

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
| `CAPITAL_HIT_COOLDOWN` | Angreifer hat diese Spielerhauptstadt kürzlich getroffen (`details.until`, [O-20] B) |
| `ATTACKER_SIEGE_LIMIT`, `ATTACKER_ATTEMPT_LIMIT` | Angreiferbudgets erschöpft (`details.resetAt`) |
| `DEFENDER_SIEGE_LIMIT` | Verteidiger hat maximale Zahl offener Belagerungen |
| `CHALLENGE_IN_PROGRESS` | Spieler hat bereits eine laufende Herausforderung (eigener Angriff in Vorbereitung oder begonnene Verteidigung) |
| `KINGDOM_ACTIVE` | Neugründung, obwohl das aktuelle Reich noch besteht (409) |
| `NO_QUESTION_AVAILABLE` | keine Frage der benötigten Art im Bestand (`details.kind`) (409) |
| `STEP_EXPIRED` | Antwort nach Zeitlimit des Schritts (`details.deadline`) |
| `STEP_NOT_AVAILABLE` | Schritt noch nicht gestellt oder schon abgeschlossen |
| `CHALLENGE_CLOSED` | Herausforderung ist beendet (`details.status`) |
| `INVALID_OPTION_TOKEN` | Token gehört nicht zur Präsentation dieses Schritts (422) |
| `INVALID_NUMBER_INPUT`, `ANSWER_OUT_OF_RANGE` | Schätzung nicht lesbar (`details.reason`) bzw. außerhalb des Eingabebereichs (422) |
| `DEADLINE_PASSED` | Verteidigung nach Fristende (`details.deadlineAt`) |
| `DEADLINE_TOO_CLOSE` | Restzeit reicht nicht für die Herausforderung (`details.deadlineAt`) |
| `EXTENSION_LIMIT_REACHED` | Frist bereits am Maximum |
| `DEADLINE_CHANGED` | erwartete neue Frist stimmt nicht mehr (Client zeigt neuen Wert) |
| `ITEM_NOT_AVAILABLE` | Item existiert nicht, gehört nicht dem Spieler oder ist verbraucht |
| `INSTANCE_NOT_ACTIVE`, `PVP_CUTOFF_REACHED` | Weltinstanz bzw. Saisonphase erlaubt keine Angriffe |
| `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED` | Header fehlt bzw. Schlüssel mit anderem Anfrageinhalt wiederverwendet |
| `GUEST_BOOTSTRAP_REQUIRED`, `GUEST_BOOTSTRAP_USED` | `/auth/guest` ohne Bootstrap-Cookie bzw. Wiederholung, nachdem das Gastkonto bereits benutzt wurde ([§1](#1-konventionen)) |
| `INVITE_CODE_UNKNOWN` | keine offene Aufstellung mit diesem Einladungscode (404) |
| `MATCH_FULL` | alle Plätze der Partie belegt (409, `details.seats`) |
| `MATCH_NOT_IN_LOBBY`, `MATCH_NOT_RUNNING` | Partie schon gestartet bzw. nicht mehr laufend (409, `details.status`) |
| `ALREADY_IN_MATCH` | Konto ist schon in einer offenen Partie (409, `details.matchId`) |
| `NOT_HOST` | nur der Gastgeber startet und besetzt Plätze mit Bots (403) |
| `NOT_ENOUGH_PLAYERS` | normale Partie mit weniger als zwei Mitspielern, Menschen und Bots zusammen (409) |
| `SEAT_NOT_AVAILABLE` | Platz lässt sich nicht mit einem Bot besetzen: Testpartie oder ein Mensch sitzt dort (409, `details.joinOrder`) |
| `TEST_MATCHES_DISABLED` | Testpartie in Produktion (403) |
| `REALM_MATCHES_DISABLED` | Partie mit Ausbau, wo der Server sie nicht anbietet (403) |
| `NOT_ENOUGH_CATEGORIES` | Start mit Ausbau, aber zu wenige Kategorien mit genug Wissensfragen für das Glücksrad (409, `details.categories`, `details.needed`, `details.minQuestions`) |
| `INVALID_FAVORITES` | Lieblingskategorien nicht genau so viele verschiedene vom Glücksrad wie verlangt (422, `details.count`, `details.categories`) |
| `INVALID_ORDERS` | Befehle der Rüstzeit so nicht möglich (422, `details.reason`, `details.index`) |
| `NOT_YOUR_TURN`, `INVALID_REGION` | Wahl durch einen anderen Sitz bzw. Region nicht wählbar (409, 422) |
| `VALIDATION_FAILED` | Pfad, Abfrage oder Körper ungültig (`details.issues`) (400) |
| `INVALID_CREDENTIALS` | Anmeldung: Benutzername oder Passwort falsch (401); Passwortwechsel: bisheriges Passwort falsch (403) |
| `RATE_LIMITED` | zu viele Fehlversuche; erneut ab `details.retryAfterMs` (429) |
| `ALREADY_REGISTERED` | Konto ist bereits gesichert (409) |
| `GUEST_ACCOUNT` | nur für gesicherte Konten (403) |
| `USERNAME_TAKEN`, `PLAYER_NAME_TAKEN` | Benutzer- bzw. Spielername vergeben (409) |
| `INVALID_NAME` | Name nicht aus den erlaubten Bausteinen (422) |
| `UNAUTHENTICATED` | keine gültige Sitzung (401) |
| `CSRF_ORIGIN_MISMATCH` | zustandsändernde Anfrage ohne passenden `Origin` (403) |
| `NOT_FOUND` | unbekannter Pfad, unbekannte Welt, Instanz, Region oder unbekanntes Reich (404) |
| `ALREADY_JOINED` | Spieler nimmt an der laufenden Instanz schon teil (`details.instanceId`) (409) |
| `INSTANCE_FULL` | Kapazität der Instanz erreicht (409) |
| `NO_START_REGION` | keine Region erfüllt die Startkriterien (409) |
| `CONCURRENT_UPDATE` | gleichzeitige Änderung; dieselbe Anfrage darf wiederholt werden (409) |
| `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR` | technische Fehler (415, 413, 500) |

Fachliche Fehler werden nicht im Antwortspeicher abgelegt: Sie hatten keine Wirkung, eine Wiederholung mit demselben `Idempotency-Key` prüft neu. `IDEMPOTENCY_KEY_REUSED` antwortet mit 422, eine wiederholte Antwort trägt den Header `Idempotency-Replayed: true`.
