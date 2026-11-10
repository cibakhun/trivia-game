# Belagerungs- und Kampfsystem

Bezug: Brief §5.1, §6.5, §7, §8.8, §12.4, §13.4, §15.2–15.4. Kennzeichnung siehe [README](README.md#kennzeichnung-von-regeln).

## 1. Kampfarten

| Art | Angreifer | Verteidiger | Auswertung | Phase |
|---|---|---|---|---|
| PvE | Spieler | neutrale Garnison oder NPC-Reich | sofort, NPC-Antwort vorab versiegelt | 1 |
| PvP | Spieler | Spieler | Belagerung mit Frist | 2–3 (Ablauf seit Phase 2 Paket 1) |
| NPC → Spieler | NPC | Spieler | Belagerung mit Frist (Eternal 24 h) | 5 |
| NPC → NPC / neutral | NPC | NPC / neutral | sofort im Worker | 5 |

Alle Arten nutzen dieselbe Tabelle `sieges`, dieselbe Herausforderung (`quiz_challenges`) und dieselbe Auswertungsfunktion `resolveDuel` ([QUIZ_ENGINE.md §8](QUIZ_ENGINE.md#8-duellauswertung)).

## 2. Ablauf PvE (sofortige Auswertung)

1. `POST /attacks` → Berechtigung prüfen, `siege(PREPARING)` anlegen und die Region in derselben Transaktion reservieren ([§3.1](#31-regionsreservierung-e)), Herausforderung auswählen, **NPC-Antworten erzeugen und speichern** (`status = GENERATED`).
2. Spieler beantwortet Trivia und Schätzung.
3. Mit der letzten Antwort wertet der Server in derselben Transaktion aus: Gate → Trivia → Schätzung → Zeit.
4. Bei Sieg: Besitzwechsel, Schutzzeit, Drop-Wurf, Ereignisse. Bei Niederlage: Region bleibt, nichts weiter.

Dass die NPC-Antwort *vor* der Spielerantwort feststeht, ist im Ereignisprotokoll belegbar und schließt jeden Verdacht eines „reagierenden“ NPCs aus [E].

Stand Phase 1 Paket 3 (ADR-032 bis ADR-034): umgesetzt ohne Drop-Wurf (Phase 4). Die NPC-Antworten tragen im Ereignis `NPC_ANSWERS_SEALED` ein SHA-256-Commitment. Die Auswertung (Schritt 3) läuft in einer eigenen Transaktion direkt nach dem Speichern der letzten Antwort, mit den Sperren aus §5.1 und der Prüfung N12. Bei Sieg kommen Regionshistorie (`CONQUEST_PVE`), Regionenzahl, Ende des Anfängerschutzes ab `untilRegions`, Rangwechsel, Hauptstadt-Leben bzw. Übernahme des Verteidigerreichs (§8, seit Migration 0009, ADR-037; Fraktion ruht) und Statistiken hinzu. Bei Niederlage wird die Reservierung gelöst. Outbox-Ereignisse: `region.changed`, `kingdom.changed` und persönlich `siege.resolved`. Dynamische NPC-Stärke ([NPC_SYSTEM.md](NPC_SYSTEM.md)) und Spielstärkewert folgen mit der Kalibrierung.

## 3. Zustandsmaschine

```mermaid
stateDiagram-v2
  [*] --> PREPARING: Angriff gestartet (Region reserviert)
  PREPARING --> ATTACK_FAILED: Abbruch / nie begonnen / Saison-Cutoff
  PREPARING --> ATTACKER_WON: PvE, Angreifer gewinnt
  PREPARING --> DEFENDER_WON: PvE, Verteidiger gewinnt
  PREPARING --> AWAITING_DEFENSE: PvP, Angreifer fertig, Leistung versiegelt (Frist startet)
  AWAITING_DEFENSE --> DEFENDING: Verteidiger beginnt (nur bei ausreichender Restzeit)
  AWAITING_DEFENSE --> ATTACKER_WON_BY_TIMEOUT: Frist abgelaufen, Angreifer richtig
  AWAITING_DEFENSE --> ATTACK_FAILED: Frist abgelaufen, Angreifer falsch (verdecktes Gate)
  DEFENDING --> ATTACKER_WON: Auswertung (verpasste Schritte zählen als falsch)
  DEFENDING --> DEFENDER_WON: Auswertung (verpasste Schritte zählen als falsch)
  AWAITING_DEFENSE --> CANCELLED: Admin / Angreiferreich aufgelöst
  DEFENDING --> CANCELLED: Admin / Angreiferreich aufgelöst
  PREPARING --> EXPIRED_INVALID: Instanz geschlossen
  AWAITING_DEFENSE --> EXPIRED_INVALID: Saisonende ohne Abschlussregel (sollte nie eintreten)
```

| Zustand | Bedeutung | Aktiv? | Brief §7.3 |
|---|---|---|---|
| `PREPARING` | Angreifer bearbeitet die Herausforderung; Region ist reserviert | ja | `ATTACK_PREPARING` |
| – (Ereignis) | Angreifer hat abgegeben | – | `ATTACK_SUBMITTED` – als Ereignis im Protokoll, kein eigener Zustand, da der Übergang atomar ist |
| `ATTACK_FAILED` | Angriff vor Eröffnung abgebrochen (bzw. Saison-Cutoff), **oder** Frist ohne Verteidigung abgelaufen und der Angreifer lag bei der Trivia-Frage falsch (verdecktes Gate, [O-01]); Gebiet bleibt, keine Punkte | nein | **neu** (W-3) |
| `AWAITING_DEFENSE` | Frist läuft, Verteidiger hat noch nicht begonnen | ja | `WAITING_FOR_DEFENDER` |
| `DEFENDING` | Verteidiger bearbeitet die Herausforderung | ja | **neu** (W-3) |
| – (Ereignis) | Verteidiger hat abgegeben | – | `DEFENDER_SUBMITTED` – Auswertung erfolgt in derselben Transaktion |
| `RESOLVING` | reserviert; im MVP nie persistiert, da die Auflösung eine einzige Transaktion ist | ja | `RESOLVING` |
| `ATTACKER_WON`, `DEFENDER_WON`, `ATTACKER_WON_BY_TIMEOUT` | Ergebnisse; jede eigene, vollständige Verteidigung bringt Verteidigungspunkte, auch wenn das Gebiet verloren geht ([GAME_RULES.md §5.5](GAME_RULES.md#55-verteidigungspunkte-v-grundsatz-e-werte-o-18)) | nein | gleichnamig |
| `CANCELLED` | durch Admin oder weil das Angreiferreich nicht mehr aktiv ist; Budget wird erstattet | nein | gleichnamig |
| `EXPIRED_INVALID` | technisches Ende ohne Wertung (Instanz geschlossen) | nein | gleichnamig |

Jeder Übergang ist eine bedingte Aktualisierung (`update sieges set status = :neu, version = version + 1 where id = :id and status = :alt`) und erzeugt einen Eintrag in `battle_events`. Damit ist jeder Übergang höchstens einmal wirksam (Idempotenz, Brief §7.3).

### 3.1 Regionsreservierung [E]

- **Setzen:** Die Transaktion, die die Belagerung in `PREPARING` anlegt, setzt auch `region_state.active_siege_id = :siege` – bedingt mit `… where region_id = :target and active_siege_id is null`. Trifft die Bedingung nicht zu, wird die ganze Transaktion verworfen (`REGION_UNDER_SIEGE`). Der partielle Unique-Index auf `sieges` (N1) bleibt die zweite Absicherung.
- **Freigeben:** Jeder Übergang in einen Endzustand (`ATTACK_FAILED`, `ATTACKER_WON`, `DEFENDER_WON`, `ATTACKER_WON_BY_TIMEOUT`, `CANCELLED`, `EXPIRED_INVALID`) setzt in derselben Transaktion `active_siege_id = NULL`, bedingt auf `active_siege_id = :siege`. Das gilt ausdrücklich auch für PvE-Ergebnisse und für Abbrüche aus `PREPARING` (nie begonnene Herausforderung über `challenge.expireStale`, Abbruch, Saison-Cutoff, Instanzschluss).
- **Prüfung:** Ein Fremdschlüssel stellt sicher, dass der Zeiger auf eine existierende Belagerung genau dieser Region verweist; dass diese Belagerung aktiv ist und jede aktive Belagerung einen Zeiger hat, prüfen Transaktion und Invariantenjob (I3, [DATA_MODEL.md §5](DATA_MODEL.md#5-invarianten)).

## 4. Ablauf PvP-Belagerung

```mermaid
sequenceDiagram
  participant A as Angreifer
  participant S as Server (api)
  participant DB as PostgreSQL
  participant W as Worker
  participant B as Verteidiger
  A->>S: POST /attacks
  S->>DB: Sperren, Berechtigung, siege PREPARING, Herausforderung
  A->>S: Trivia + Schätzung beantworten
  S->>DB: Angreiferleistung versiegeln (auch bei falscher Antwort) → AWAITING_DEFENSE, opened_at, base/deadline/max_deadline
  S->>DB: Job siege.resolveTimeout @ deadline_at + settleGrace, Mitteilungen, world_events
  S-->>B: Push + In-App „Region X wird belagert, Frist bis …“
  opt Verlängerung
    B->>S: POST /sieges/:id/extend {item, expectedNewDeadline}
    S->>DB: Item verbrauchen + deadline_at erhöhen (eine Transaktion), Job neu planen
  end
  alt Verteidiger antwortet rechtzeitig
    B->>S: POST /sieges/:id/defense (Restzeit ≥ ~60 s)
    S->>DB: DEFENDING, Herausforderung präsentieren
    B->>S: Trivia + Schätzung
    S->>DB: Antwort speichern (received_at), dann unter Sperre resolveDuel (Gate zuerst) → Ergebnis, Besitz, Drops, Verteidigungspunkte
  else Frist läuft ab
    W->>DB: resolveTimeout: game_now() ≥ deadline_at + settleGrace, keine Verteidigung begonnen → Angreifer richtig: ATTACKER_WON_BY_TIMEOUT, sonst ATTACK_FAILED
  end
  S-->>A: Ergebnis (Push + In-App)
  S-->>B: Ergebnis (Push + In-App)
```

Stand Phase 2 Paket 1 (ADR-038 bis ADR-042): umgesetzt ohne Worker, Push und Verlängerung.

- **Eröffnung:** Die letzte Antwort des Angreifers eröffnet in der Auswertungstransaktion (Sperren wie §5.1). Fristen kommen aus dem PvP-Abschnitt der Regelkopie (`snapshot.pvp`). `ATTACK_SUBMITTED` trägt ein SHA-256-Commitment über die Angreiferantworten, `siege.opened` geht persönlich an beide Seiten. Läuft schon die erste Frage des Angreifers ab, endet der Angriff `ATTACK_FAILED` und wird nie eröffnet.
- **Sichtbarkeit:** Vor `opened_at` existiert die Belagerung für den Verteidiger nicht (Herausforderung und Verteidigung 404, nicht in der Übersicht). Auch danach erfährt er bis zur Auflösung nichts über die Angreiferleistung.
- **Verteidigung:** `POST /sieges/:id/defense` (§6.2) stellt die Wissensfrage in derselben Transaktion; die Schätzfrage kommt im PvP immer und zählt nur bei Gleichstand ([O-19] A).
- **Fristablauf:** Statt des Jobs `siege.resolveTimeout` löst der minütliche Aufräumlauf im `api`-Prozess fällige Belagerungen auf (ADR-034), zusätzlich jede Leseanfrage des Spielers (Übersicht, Herausforderung, Regionsdetails, neuer Angriff). Abgelaufene Einzelfragen des Verteidigers werden `TIMED_OUT` und zählen als falsch.
- **Mitteilungen:** nur in der App über die Belagerungsübersicht (§9), die der Client alle 30 s und bei geänderter Zahl eingehender Belagerungen (`/me.incomingSieges`) neu lädt. Echtzeit über WebSocket folgt in Phase 2 Paket 3, Web Push mit [O-04] in Phase 3, Verlängerung durch Items in Phase 4.
- **Besitzwechsel:** Regionshistorie `CONQUEST_PVP`, bei Sieg durch Zeitablauf `TIMEOUT`. Verteidigungspunkte nach §7 und [GAME_RULES.md §5.5](GAME_RULES.md#55-verteidigungspunkte-v-grundsatz-e-werte-o-18).

## 5. Nebenläufigkeit und Sperrreihenfolge

### 5.1 Feste Sperrreihenfolge [E]

Jede Transaktion, die mehrere dieser Zeilen verändert, sperrt sie **in genau dieser Reihenfolge** – das verhindert Deadlocks:

1. `kingdoms` (alle beteiligten, aufsteigend nach `id`)
2. `region_state` (aufsteigend nach `region_id`)
3. `sieges`
4. `world_participants` (Inventar-Sperre je Spieler)
5. `player_items`

Ein gemeinsamer Transaktions-Wrapper wiederholt bei Serialisierungs- oder Deadlock-Fehlern (`40001`, `40P01`) bis zu dreimal mit zufälliger Wartezeit; alle Kommandos sind dafür idempotent.

### 5.2 Kritische Wettläufe und ihre Auflösung

| # | Szenario | Auflösung |
|---|---|---|
| N1 | Zwei Angreifer greifen gleichzeitig dieselbe Region an | partieller Unique-Index `sieges_one_active_per_region` – der zweite erhält `REGION_UNDER_SIEGE` |
| N2 | Mehrere Angreifer gegen ein Reich mit 3 offenen Belagerungen | Sperre auf das Verteidigerreich, Zählung inklusive `PREPARING` unter Sperre – der zweite erhält `DEFENDER_SIEGE_LIMIT` (Brief §13.4) |
| N3 | Doppelklick oder Netzwiederholung beim Angriff | `unique(attacker_kingdom_id, idempotency_key)` auf `sieges` – gleiche Antwort, keine zweite Belagerung |
| N4 | **Verteidigerantwort gleichzeitig mit Fristablauf** (Brief §12.4) | Einheitliche Fristgrenze ([§6.1](#61-fristgrenze--eine-regel-für-alle-pfade-e)): `received_at` wird beim Eintreffen der Anfrage erfasst, **bevor** auf Sperren gewartet wird; rechtzeitig heißt `received_at < answer_deadline_at` (liegt immer vor `deadline_at`, §6.2). Die Antwort wird in einem ersten, kurzen Schritt **ohne Belagerungssperre** gespeichert (bedingte Aktualisierung der eigenen `quiz_answers`-Zeile), erst danach wird unter Sperre ausgewertet. Scheitert die Auswertung, etwa am Sperrzeitlimit, bleibt die Antwort gespeichert und gültig. Der Timeout-Pfad (ab `deadline_at + settleGrace`) wertet eine begonnene Verteidigung immer mit den gespeicherten Antworten aus; nur offene, abgelaufene Schritte zählen als `TIMED_OUT`. Eine rechtzeitig eingetroffene Antwort geht also nie verloren, eine verspätete wird nie gewertet. Alle Übergänge sind bedingt; der zweite Pfad sieht einen Endzustand und tut nichts. |
| N5 | Itemverlängerung gleichzeitig mit Fristablauf | Verlängerung nur bei `game_now() < deadline_at` unter Sperre; danach ist der alte Timeout-Job wirkungslos (Frist liegt in der Zukunft) und ein neuer wird geplant |
| N6 | Zwei Verlängerungen auf dieselbe Belagerung | Sperre; die zweite rechnet mit der neuen Frist, wird ggf. gekappt oder abgelehnt (ohne Itemverbrauch) |
| N7 | Dasselbe Item gleichzeitig für zwei Belagerungen | bedingte Aktualisierung `player_items.status AVAILABLE → CONSUMED` + `unique(item_usage.item_id)` – eine Anfrage scheitert mit `ITEM_NOT_AVAILABLE` |
| N8 | Timeout-Job läuft doppelt | Statusvergleich – zweiter Lauf ohne Wirkung |
| N9 | Server-Neustart während laufender Belagerung (E2E-08) | Zustand liegt in Postgres; pg-boss-Jobs sind dauerhaft; Sweeper löst überfällige Belagerungen jede Minute auf; jede Leseanfrage auf eine überfällige Belagerung löst sie ebenfalls auf |
| N10 | Angreiferreich fällt während der Belagerung | Bei Auflösung `CANCELLED`, Region bleibt beim Verteidiger [E] |
| N11 | Admin will eine Region mit aktiver Belagerung ändern | Admin-Werkzeug bricht die Belagerung zuerst ab (`CANCELLED`, protokolliert) |
| N12 | Region wechselt während der Belagerung den Besitzer auf anderem Weg | ausgeschlossen: andere Besitzwechsel prüfen `active_siege_id is null`; Auflösung prüft `owner_kingdom_id IS NOT DISTINCT FROM` erwarteter Verteidiger (neutral: beide `NULL`) |

### 5.3 Auflösungstransaktion

```sql
BEGIN;
-- 1. Sperren in fester Reihenfolge (neutrales Ziel: :def ist NULL, gesperrt wird nur das Angreiferreich)
SELECT id, status, region_count FROM kingdoms WHERE id IN (:att, :def) ORDER BY id FOR UPDATE;
SELECT * FROM region_state WHERE region_id = :target FOR UPDATE;
SELECT * FROM sieges WHERE id = :siege FOR UPDATE;

-- 2. Vorbedingungen (Anwendungscode, bei Nichterfüllung: COMMIT ohne Änderung = idempotentes No-op)
--    PvE: status = PREPARING und beide Schritte des Angreifers abgeschlossen
--    PvP: status ∈ {AWAITING_DEFENSE, DEFENDING}
--    Auslöser DEFENSE: beide Schritte des Verteidigers abgeschlossen (rechtzeitig ANSWERED oder TIMED_OUT)
--    Auslöser TIMEOUT: game_now() ≥ deadline_at + settleGrace (sonst wurde verlängert);
--                      Status DEFENDING: offene Schritte sind abgelaufen → TIMED_OUT, dann Auswertung wie DEFENSE
--                      Status AWAITING_DEFENSE: keine Verteidigung begonnen → resolveDuel(att, 'NO_DEFENSE')
--    region_state.owner_kingdom_id IS NOT DISTINCT FROM sieges.defender_kingdom_id  (neutral: beide NULL)
--    region_state.active_siege_id = :siege

-- 3. Entscheidung: game-core.resolveDuel(...)

-- 4. Wirkungen
UPDATE sieges SET status = :final, outcome = :winner, outcome_reason = :reason,
       resolved_at = game_now(), version = version + 1
 WHERE id = :siege AND version = :v;
INSERT INTO battle_results (...);  INSERT INTO battle_events (...);
--   Hauptstadt (§8): capital_lives_left, regions_taken, capital_protected_until
-- falls Angreifer gewinnt, genau einer der drei Fälle:
-- (a) Ziel ist keine Hauptstadt: Eroberung
UPDATE region_state SET owner_kingdom_id = :att, is_capital = false, owned_since = game_now(),
       protected_until = game_now() + :protection, protection_reason = 'CONQUEST',
       active_siege_id = NULL, version = version + 1, updated_at = game_now()
 WHERE region_id = :target AND owner_kingdom_id IS NOT DISTINCT FROM :def AND active_siege_id = :siege;
UPDATE kingdoms SET region_count = region_count + 1 WHERE id = :att;
-- nur wenn :def nicht NULL (Ziel gehörte einem Reich, nicht neutral):
UPDATE kingdoms SET region_count = region_count - 1 WHERE id = :def;
INSERT INTO region_history (...);   -- from_kingdom_id = :def (NULL bei neutralem Ziel)
--     :def ohne Regionen → FALLEN
-- (b) Hauptstadt von :def, danach noch Leben übrig: kein Besitzwechsel
UPDATE region_state SET active_siege_id = NULL, protected_until = :capital_protected_until,
       protection_reason = 'CAPITAL_HIT', version = version + 1, updated_at = game_now()
 WHERE region_id = :target AND active_siege_id = :siege;
UPDATE kingdoms SET capital_hits = :hits, capital_hit_at = game_now() WHERE id = :def;
INSERT INTO kingdom_history (...);  -- CAPITAL_HIT
-- (c) Hauptstadt von :def, letztes Leben: Übernahme des ganzen Reichs (:n = region_count von :def)
--     Hauptstadt wie (a) erobert, alle übrigen Regionen von :def an :att (cause TAKEOVER,
--     Eroberungsschutz), offene Angriffe Dritter darauf CANCELLED
UPDATE kingdoms SET region_count = region_count + :n WHERE id = :att;
UPDATE kingdoms SET region_count = 0, status = 'FALLEN' WHERE id = :def;
INSERT INTO kingdom_history (...);  -- TAKEOVER bei :att, FALLEN bei :def
--   in (a) und (c): Drop-Wurf → reward_events (+ player_items)
-- falls Verteidiger gewinnt (DEFENDER_WON) oder Angriff am verdeckten Gate scheitert (ATTACK_FAILED):
UPDATE region_state SET active_siege_id = NULL, version = version + 1
 WHERE region_id = :target AND active_siege_id = :siege;
-- Verteidigungspunkte, unabhängig vom Ausgang: nur wenn :points = game-core.defensePoints(...) > 0,
--   der Verteidiger ein Spielerreich ist, das Paarlimit nicht erreicht und die Konten nicht verdächtig verknüpft sind:
UPDATE kingdom_statistics SET defense_points = defense_points + :points WHERE kingdom_id = :def;
UPDATE player_statistics  SET defense_points = defense_points + :points WHERE user_id = :defender_user;
-- immer:
INSERT INTO notifications (...);
-- zuletzt: alle Ereignisse der Transaktion in einer Anweisung; seq vergibt der Trigger
-- world_events_seq aus world_instances.event_seq (ARCHITECTURE.md §10, ADR-027)
INSERT INTO world_events (instance_id, chunk_x, chunk_y, user_id, type, payload) VALUES (...), (...);
COMMIT;
```

Erst nach dem Commit werden Push-Benachrichtigungen versendet (eigener Job, liest `notifications`). Fällt der Versand aus, bleibt der Spielzustand korrekt.

## 6. Fristen und Verlängerungen

Bei Eröffnung werden die Fristwerte aus der Regelkonfiguration in die Belagerung kopiert (`rules_snapshot`), damit spätere Regeländerungen nicht rückwirkend wirken [E]:

```
opened_at        = game_now()
base_deadline_at = opened_at + defense.baseDeadline            // 24 h [V]
deadline_at      = base_deadline_at
max_deadline_at  = opened_at + defense.maxDeadline             // 48 h [A]
```

### 6.1 Fristgrenze – eine Regel für alle Pfade [E]

- **Exklusive Grenze:** Eine Verteidigerantwort ist rechtzeitig genau dann, wenn `received_at < deadline_at`. Dieselbe Regel gilt für das Zeitlimit jeder Einzelfrage (`received_at < answer_deadline_at`, [QUIZ_ENGINE.md §7](QUIZ_ENGINE.md#7-herausforderungsprotokoll)). Verlängern und Verteidigung beginnen sind nur bei `game_now() < deadline_at` erlaubt.
- **Eingangszeit vor der Sperre:** `received_at` wird als erste Anweisung der Anfrage gesetzt (`game_now()`), bevor auf Zeilensperren gewartet wird, und mit der Antwort gespeichert. Interne Wiederholungen nach `40001`/`40P01` verwenden denselben Wert. Wartezeit auf Sperren geht so nie zulasten des Spielers.
- **Erst speichern, dann auswerten:** Eine Antwort wird zuerst in einer eigenen kurzen Transaktion ohne Belagerungssperre gespeichert und erst danach unter Sperre ausgewertet. Antwort-Endpunkte haben eine harte Laufzeitgrenze (`lock_timeout`/`statement_timeout`, gesamt ≤ 3 s). Läuft die Auswertung in diese Grenze, bleibt die gespeicherte Antwort gültig; eine Wiederholung mit demselben `Idempotency-Key`, der Timeout-Job oder der Sweeper wertet sie aus.
- **Abwicklungspuffer:** Ein Timeout wirkt erst, wenn `game_now() ≥ deadline_at + defense.settleGrace` (Standard 5 s). Ebenso setzen Timeout-Pfad und `challenge.expireStale` einen Schritt erst ab `answer_deadline_at + settleGrace` auf `TIMED_OUT`, damit eine Antwort, die kurz vor ihrer Grenze eintraf, noch gespeichert werden kann. Eine begonnene Verteidigung wird immer mit ihren gespeicherten Antworten ausgewertet, auch wenn der Timeout-Pfad sie auslöst.
- **Ein Prädikat:** Timeout-Job, Sweeper und Auflösung beim Lesen verwenden dieselbe Funktion `isTimeoutDue(siege, now) = now ≥ deadline_at + settleGrace` aus `game-core`.
- Die Oberfläche zeigt immer `deadline_at`. `settleGrace` ist nur ein technischer Puffer und verlängert die Frist für niemanden.

### 6.2 Verteidigung beginnen

**Verteidigung beginnen** ist nur erlaubt, wenn `deadline_at − game_now() ≥ Σ(Zeitlimits + cap) + startBuffer` (≈ 61 s) [E]. Sonst erhält der Spieler `DEADLINE_TOO_CLOSE` und – falls vorhanden – den Hinweis, dass ein Item die Frist noch verlängern kann.

Umsetzung (ADR-038): Zuerst wird eine fällige Belagerung aufgelöst (Fristablauf, N10), dann gesperrt: Reiche → Region → Belagerung. Nach der Frist folgt `DEADLINE_PASSED`, während einer eigenen offenen Herausforderung `CHALLENGE_IN_PROGRESS` (höchstens eine je Spieler, GAME_RULES §7). Der Beginn setzt `DEFENDING` und `defense_started_at`, stellt die Wissensfrage in derselben Transaktion und gibt sie in der Antwort zurück (`DEFENSE_STARTED`, `siege.updated` an den Angreifer). Eine Wiederholung liefert dieselbe Frage mit derselben Präsentationszeit und zählt als Reload (`STEP_RELOADED` mit `role: DEFENDER`); kein `Idempotency-Key` nötig.

### 6.3 Verlängerung

**Verlängerung** (`POST /sieges/:id/extend`), alles in einer Transaktion [V-nah, Brief §8.8]:

1. Sperren: Verteidigerreich → Region → Belagerung → Teilnehmerzeile des Spielers → Item.
2. Prüfen: Belagerung `AWAITING_DEFENSE` oder `DEFENDING`; `game_now() < deadline_at` (abgelaufen kann nicht wieder geöffnet werden); Spieler ist Besitzer des Verteidigerreichs; Region gehört noch dem Verteidigerreich; Item gehört dem Spieler, Status `AVAILABLE`, Typ zulässig in diesem Modus; Idempotenzschlüssel unbekannt.
3. Berechnen: `neu = min(deadline_at + effect, max_deadline_at)`. Ist `neu = deadline_at` (Obergrenze erreicht) → `EXTENSION_LIMIT_REACHED`, **kein Itemverbrauch** (E2E-07).
4. Vergleich mit `expectedNewDeadline` aus der Anfrage (der Client hat dem Spieler diesen Wert vor der Bestätigung gezeigt, Brief §15.3). Abweichung → `DEADLINE_CHANGED`, kein Verbrauch, Client zeigt neuen Vorschlag.
5. Schreiben: Item `CONSUMED`, `item_usage`, `inventory_transactions`, `sieges.deadline_at = neu`, `battle_events`, `world_events`; Timeout-Job auf neue Frist planen.

## 7. Limits und Schutz – Zählregeln

| Limit | Zählweise |
|---|---|
| PvP-Belagerungen pro Angreifer | Belagerungen mit `mode = PVP`, `attacker_kingdom_id` eines Reichs des Spielers in dieser Instanz (auch eines früheren, damit eine Neugründung nichts zurücksetzt), `opened_at > game_now() − 24 h` (gleitend); jeder abgeschlossene Angriff eröffnet eine Belagerung, auch bei falscher Antwort |
| PvP-Versuche pro Angreifer | wie oben, aber `attack_presented_at` statt `opened_at` (auch gescheiterte) |
| Offene Belagerungen gegen ein Reich | Status `PREPARING`, `AWAITING_DEFENSE`, `DEFENDING` mit `defender_kingdom_id` des Reichs – **über alle Angreifer** einschließlich NPCs (Brief §7.4 letzter Punkt; NPC-Kontingent zusätzlich nach [O-13]) |
| Schutz nach Eroberung | `region_state.protected_until`; gilt gegen alle, auch den Vorbesitzer |
| Anfänger-/Wiederaufbauschutz | `kingdoms.protected_until`; endet vorzeitig, sobald das Reich selbst einen Spieler angreift (UI warnt vorher) |
| Rangabstand | geprüft beim Angriffsstart mit `region_count` beider Reiche |
| Sperre je Angreifer auf eine Spielerhauptstadt | letzter `battle_results`-Eintrag mit `capital_lives_left` für dieselbe Hauptstadt und dasselbe angreifende Reich; neuer Angriff erst nach `capital.hitCooldownPerAttacker` (12 h, Daily 2 h, [O-20] B), sonst `CAPITAL_HIT_COOLDOWN` mit `until` |
| Punktbringende Verteidigungen je Paar | `battle_results` mit `defense_points > 0` für dasselbe Paar aus Angreifer- und Verteidigerreich in den letzten 24 h (gleitend), Grenze `defense.pointsPairLimitPerDay` |

Alle Zählungen erfolgen unter Sperre des betroffenen Reichs; parallele Anfragen können Limits nicht umgehen (Brief §13.4).

## 8. Hauptstadt und Totalverlust in der Auflösung

Regeln: [GAME_RULES.md §3](GAME_RULES.md#3-königreich-hauptstadt-ränge-totalverlust) Punkt 3 und 4, Umsetzung `settle.ts` mit `hitCapital` aus game-core (ADR-037).

- **Treffer:** Gewinnt der Angreifer gegen eine Hauptstadt, die danach noch Leben hat, bleibt sie beim Verteidiger. Gespeichert werden die nicht erholten Treffer (`kingdoms.capital_hits`) und der Zeitpunkt (`capital_hit_at`), die Region bekommt den Schutz `CAPITAL_HIT` (`capital.protectionAfterHit`), `kingdom_history` den Eintrag `CAPITAL_HIT`. Die Belagerung endet trotzdem als `ATTACKER_WON`; `battle_results.capital_lives_left` hält die verbleibenden Leben, die Auflösung meldet `conquered: false` und `capital`.
- **Übernahme:** Nimmt der Sieg das letzte Leben, wird die Hauptstadt erobert wie jede Region (`CONQUEST_PVE` bzw. `CONQUEST_PVP`), und alle übrigen Regionen des Reichs gehen in derselben Transaktion an den Angreifer (`region_history.cause = TAKEOVER`, Eroberungsschutz). Offene Belagerungen Dritter auf diese Regionen werden mit `CANCELLED` beendet (Ergebnis, Kampfprotokoll, `siege.resolved` an den Angreifer). Das Reich fällt (`kingdom_history` `FALLEN` mit `cause: TAKEOVER`), der Angreifer erhält `TAKEOVER`; `battle_results.capital_lives_left = 0`, `regions_taken` = Zahl der Regionen. Gesperrt sind beide Reiche; wer Regionen eines Reichs ändert, sperrt zuerst das Reich (§5.1), deshalb brauchen die übernommenen Regionen keine eigene Sperre.
- Sinkt `region_count` ohne Übernahme auf 0 (nur bei Daten ohne Hauptstadt): Reich `FALLEN`, offene ausgehende Belagerungen des Reichs werden bei ihrer Auflösung `CANCELLED`, Spieler erhält eine Niederlagenmeldung mit Rückblick (größte Ausdehnung, gewonnene Kämpfe) und den Button „Neues Reich gründen“ (Brief §15.4).
- **Spielerreiche (seit Phase 2 Paket 1):** Ein Leben einer Spielerhauptstadt kostet nur ein Sieg in einer eröffneten PvP-Belagerung, also mit voller Verteidigungsfrist; dasselbe angreifende Reich darf erst nach der Sperre aus §7 erneut angreifen. Fällt ein Spielerreich, bricht die Auflösung seine offenen eigenen Angriffe ab (N10, `CANCELLED` mit `siege.resolved` an beide Seiten, sobald die Belagerung eröffnet war). Der Spieler sieht auf der Karte „Neues Reich gründen“; `POST /instances/:id/respawn` gründet ein Reich der nächsten Generation mit Wiederaufbauschutz (`RESPAWN`, ADR-042). Rückblick in der Niederlagenmeldung folgt.

## 9. Belagerungs-Dashboard

- Liste aller offenen eingehenden Belagerungen, sortiert nach verbleibender Zeit (dringendste zuerst, Brief §11.4); Hauptstadt und strategisch wertvolle Regionen hervorgehoben.
- Je Eintrag: Region, angreifendes Reich, Restzeit (Server-basiert), Status, Buttons „Verteidigen“ und „Item verwenden“ mit Vorschau der neuen Frist.
- Darunter: kürzlich abgeschlossene Konflikte mit Ergebnis und Link zur Auflösung.
- Mobil: eigener Tab in der unteren Navigationsleiste mit Zähler-Badge.

Stand Phase 2 Paket 1 (ADR-041): Die Übersicht steht als Karte in der Seitenleiste der Kartenansicht (`GET /instances/:id/sieges`): eingehende Belagerungen ab Eröffnung mit Frist und „Verteidigen“ (oder dem Grund, warum es nicht mehr geht), eigene offene Angriffe und die in den letzten 24 h entschiedenen Kämpfe (höchstens 10) mit Link zur Auflösung. Noch ohne Restzeit-Countdown, Hervorhebung der Hauptstadt über den Namen hinaus, „Item verwenden“ (Phase 4) und mobilen Tab.

## 10. Benachrichtigungen

| Ereignis | In-App | Web Push ([O-04]) |
|---|---|---|
| Belagerung gegen mich eröffnet | ✓ | ✓ sofort |
| Frist endet in 6 h (bzw. konfigurierbar) und noch keine Verteidigung | ✓ | ✓ |
| Frist endet in 1 h | ✓ | ✓ |
| Frist verlängert (manuell oder automatisch) | ✓ | ✓ bei automatischer Verlängerung |
| Belagerung aufgelöst (beide Seiten) | ✓ | ✓ |
| Item erhalten / Ablage läuft ab | ✓ | – |

Ruhezeiten pausieren nur Benachrichtigungen, **nie** Fristen. Dies wird in den Einstellungen deutlich erklärt.

## 11. Admin-Eingriffe

- Belagerung abbrechen (`CANCELLED`, Begründung Pflicht, Budget erstattet, beide Seiten informiert).
- Fehlerhafte Frage in laufender Belagerung: Abbruch wie oben; Frage wird suspendiert.
- Fehlerhafte Frage in abgeschlossenem Kampf: Ergebnis bleibt bestehen; Rückabwicklung nur in begründeten Einzelfällen über ein eigenes, protokolliertes Werkzeug, das einen Gegen-Besitzwechsel mit Ursache `ADMIN` schreibt (nie Protokolle löschen).
- Alle Eingriffe erzeugen `audit_events` (Brief §13.5).
