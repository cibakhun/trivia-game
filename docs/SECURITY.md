# Sicherheit, Anti-Cheat, Datenschutz und Recht

Bezug: Brief §12.2, §13, §14. Rechtliche Aussagen in diesem Dokument sind technische Vorbereitung, **keine Rechtsberatung**; vor einer öffentlichen Beta ist eine juristische Prüfung nötig (Brief §14.1 letzter Satz).

## 1. Server-Autorität (Brief §12.2)

| Wert | Wo entschieden | Was der Client darf |
|---|---|---|
| Gebietsbesitz | Auflösungstransaktion | anzeigen |
| Gewinner, Richtigkeit, Abstand | `game-core.resolveDuel` auf dem Server | Ergebnis anzeigen |
| Antwortzeit | Server aus `presented_at`/`received_at`, Client-Wert nur im Fenster `[max(0, S − cap), S]` | Zeit melden |
| Fristablauf | DB-Uhr `game_now()` | Restzeit anzeigen (vom Server geliefert) |
| Itemanzahl, Drop, NPC-Ergebnis | Server, Zufallsstrom mit Geheimnis | anzeigen |
| Punkte, Ranglisten | Server-Ableitung | anzeigen |

Der Client erhält nie Daten, die er vor der Auflösung nicht sehen darf (richtige Option, Lösungswert, Gegnerantwort). Das wird durch Vertragstests auf den Antwortschemas abgesichert ([TEST_PLAN.md](TEST_PLAN.md)).

## 2. Anwendungssicherheit [E]

- **Authentifizierung:** Argon2id für Passwörter (`@node-rs/argon2`, m = 19 MiB, t = 2, p = 1, OWASP-Mindestwert; 10–128 Zeichen); Sitzungstoken 256 Bit zufällig, nur als Hash gespeichert; `HttpOnly`, `Secure`, `SameSite=Lax`; Rotation beim Sichern (alle Sitzungen des Kontos) und bei der Anmeldung (Sitzung der Anfrage), ein Passwortwechsel beendet alle anderen Sitzungen; Ablauf 30 Tage gleitend. Der Benutzername ist privat und erscheint in keiner Antwort an andere Spieler. Unbekannter Name und falsches Passwort ergeben denselben Fehler nach gleichem Aufwand (Vergleich gegen einen Platzhalter-Hash). Admin- und Redaktionskonten zusätzlich mit TOTP-Zweitfaktor ([ADR-043](DECISIONS.md)).
- **CSRF:** Zustandsändernde Anfragen müssen den Header `Origin` mit genau der Herkunft des Clients tragen (fehlt er, wird abgelehnt); einzige Ausnahme sind lesende Anfragen, die fällige Kämpfe auswerten (nächster Punkt). Dazu `SameSite=Lax` für die Sitzung und `SameSite=Strict` für das Bootstrap-Cookie. Kein Double-Submit-Token, weil es ein für Skripte lesbares Cookie bräuchte ([ADR-028](DECISIONS.md)).
- **Eingaben:** Jede Anfrage wird per zod-Schema validiert; unbekannte Felder werden verworfen. SQL ausschließlich parametrisiert über Kysely.
- **Header:** strikte Content-Security-Policy (keine Inline-Skripte, keine Fremd-Skripte), HSTS, `X-Content-Type-Options`, `Referrer-Policy`.
- **Lesende Anfragen mit Auswertung:** `GET /me`, `GET /challenges/:id` und die Regionsdetails werten fällige Kämpfe des anfragenden Spielers aus (Lazy Resolution, gleiche Regeln wie der Aufräumlauf); die Kartenabfragen tun das nicht. Ein von einer fremden Seite ausgelöster GET kann damit nur ein Ergebnis festschreiben, das schon feststeht; Ausgang und Frist ändert er nicht, und die Antwort bekommt die fremde Seite nicht zu sehen (`SameSite=Lax`, kein CORS). Vom PO am 2026-11-10 so akzeptiert.
- **Rate Limiting:** je Sitzung und IP für Anmeldung, Angriffe, Antworten, Verlängerungen. Umgesetzt ist die Anmeldebremse (Phase 2 Paket 2): 10 Fehlversuche je Benutzername und 100 je Adresse in 15 min, danach `RATE_LIMITED` bis zum Fensterende; dieselbe Bremse gilt für das bisherige Passwort beim Passwortwechsel (je Konto). Die Zähler liegen im Speicher des einen `api`-Prozesses, die Datenbank speichert keine IP-Adressen; mit mehreren Prozessen ziehen sie in die Datenbank (Paket 4). Hinter dem Vite-Proxy teilen sich alle Anfragen eine Adresse, deshalb ist die Adressgrenze großzügig. Für `POST /auth/guest` (legt ohne Anmeldung ein Konto an) je IP spätestens vor der ersten öffentlichen Umgebung (PO 2026-11-10); lokal und in Tests ohne.
- **Secrets:** nur über Umgebungsvariablen/Secret-Store; `.env` in `.gitignore`; Secret-Scanning in CI.
- **Abhängigkeiten:** Lockfile, automatische Update-PRs, `pnpm audit` in CI, Lizenz-Allowlist (§6).
- **Ziel-Standard:** OWASP ASVS Stufe 2; externer Penetrationstest vor öffentlichem Start (Phase 7).

## 3. Anti-Cheat Quiz

| Bedrohung (Brief §13.1) | Gegenmaßnahme |
|---|---|
| Offenlegung korrekter Antworten | Lösung nie vor Auflösung im Payload; Optionen als Einmal-Token pro Präsentation |
| Manipulierte Client-Timer | Serverzeit maßgeblich; Client-Wert nur im Fenster `[max(0, S − cap), S]` mit `cap` = 500 ms; fehlende, negative oder nicht ganzzahlige Client-Werte werden verworfen (`effective = S`), negative und nicht ganzzahlige zusätzlich als Signal protokolliert ([QUIZ_ENGINE.md §6](QUIZ_ENGINE.md#6-zeitmessung-und-latenzausgleich)) |
| Mehrfache Antwortversuche | `unique(participant_id, step_index)` + bedingte Aktualisierung; abgegebene Antworten per Trigger unveränderlich |
| Fragenwechsel durch Refresh | `present` liefert für einen Schritt immer dieselbe Frage mit ursprünglichem `presented_at` |
| Wiederholung derselben Herausforderung | eine Herausforderung pro Belagerung; Abbruch zählt als Niederlage; Versuchskontingent |
| Vorzeitige Offenlegung der Gegnerantwort | Gegnerdaten erst nach Auflösung; Verteidiger erfährt vor Start nicht einmal die Kategorie und nie, ob der Angreifer richtig lag (verdecktes Gate); Verteidigungspunkte hängen nur von der eigenen Antwort ab und verraten deshalb nichts; Vertragstest prüft, dass keine Antwort und kein Ereignis vor der Auflösung darauf schließen lässt |
| Manipulation numerischer Antworten | Server parst Rohtext selbst, rundet auf Präzision, prüft Wertebereich |
| Nachschlagen (nicht verhinderbar, Brief §13) | kurze Zeitlimits (20/30 s); Schätzfragen, die schwer zu „googeln“ sind; statistische Erkennung (§4) |
| Fragen-Shopping | Budget wird bei Anzeige der Frage verbraucht |
| Vorauswissen durch Fragenwiederholung | 90-Tage-Ausschluss je Spieler, Expositionsgrenzen, großer Pool |

## 4. Missbrauch, Multiaccounts und Bots

**Signale** (Brief §13.2–13.3), gespeichert als `abuse_signals` mit Punktwert:

- Trefferquote deutlich über dem Erwartungswert aus `σ(θ − b)` über viele Fragen, **kombiniert** mit auffälligem Zeitmuster (z. B. hohe Trefferquote bei schweren Fragen nur mit Antwortzeiten knapp unter dem Limit – typisches Nachschlagemuster).
- Unnatürlich konstante Antwortzeiten (geringe Varianz), dauerhaft `S − C` an der Ausgleichsgrenze.
- Sehr hohe Zahl von Kämpfen, Aktivität rund um die Uhr ohne Pausen.
- Kontopaare mit wiederholten Interaktionen: Timeout-Siege, schnelle Regionswechsel hin und zurück, neue Konten, die bevorzugt gegen ein bestimmtes Konto verlieren.
- Gleiches Gerätemerkmal oder gleiches IP-Präfix bei interagierenden Konten (nur als gesalzener Hash mit rotierendem Salz, kurze Aufbewahrung – Datenminimierung).

**Maßnahmen – verhältnismäßig** (Brief §13.2: gute Spieler nicht allein wegen Leistung sanktionieren):

1. Signal → Prüfliste für Admins, keine automatische Sperre.
2. Bei begründetem Verdacht: Belohnungsberechtigung aussetzen (keine Drops), Ranglisteneintrag markieren.
3. Bestätigter Missbrauch: Rücknahme unrechtmäßiger Items (protokolliert), Ausschluss aus Ranglisten, Sperre.
4. Automatische Sperren nur bei eindeutig technischen Mustern (z. B. Anfragerate weit über menschlichem Maß).

Proof-of-Work oder eine einfache Prüfung beim Registrieren ist einer Fremd-CAPTCHA vorzuziehen (keine Datenweitergabe an Dritte).

## 5. Datenschutz (DSGVO)

### 5.1 Datenbestand (Datenminimierung)

| Daten | Zweck | Rechtsgrundlage (vorläufig) | Aufbewahrung |
|---|---|---|---|
| Konto (Benutzername, Passwort-Hash; E-Mail erst mit Mailversand) | Spielbetrieb | Vertrag (Art. 6 Abs. 1 lit. b) | bis Löschung; Gastkonten 90 Tage nach dem letzten Besuch |
| Gewählter Spielername (aus Bausteinen), Reich, Spielhistorie | Spielbetrieb, Fairness | Vertrag | bis Löschung, danach anonymisiert |
| Antworten und Zeiten | Auswertung, Streitfälle | Vertrag | 12 Monate |
| Sprache, Zeitzone, Einstellungen | Spielbetrieb | Vertrag | bis Löschung |
| Push-Abonnement | Benachrichtigungen | Einwilligung (Browserdialog) | bis Widerruf/Abmeldung |
| IP-Adresse | Sicherheit, Missbrauchsabwehr | berechtigtes Interesse (lit. f) | Logs max. 7 Tage, in DB nur gesalzener Hash |
| Missbrauchssignale | Fairness, Sicherheit | berechtigtes Interesse | 12 Monate |

### 5.2 Umsetzung

- **Cookies/Speicher:** nur technisch notwendige Cookies: das Sitzungscookie und, bis zur ersten erfolgreichen Gast-Anmeldung (höchstens 24 h), das Bootstrap-Cookie `guest_bootstrap`. Beide sind `HttpOnly` und damit für Skripte nicht lesbar. Das Bootstrap-Cookie ist ein Zufallswert ohne Bezug zu Gerät oder Person und verhindert ein doppeltes Gastkonto, wenn die erste Antwort verloren geht; Schutz und Ablauf: [API.md §1](API.md#1-konventionen). `localStorage` nur für UI-Einstellungen, nie für Schlüssel oder Token. Keine Tracking-, Analyse- oder Werbe-Cookies im MVP ⇒ kein Einwilligungsbanner nötig (zu bestätigen bei der Rechtsprüfung). Spätere Produktanalyse nur selbst gehostet und datensparsam.
- **Kontolöschung (Löschkaskade):** Selbstbedienung; ausgeführt von einem Löschjob innerhalb von 24 h. Mit dem Antrag (`users.deletion_requested_at`) werden alle Sitzungen beendet und neue Anmeldungen bis zur Ausführung abgelehnt.
  - **Ablauf ohne Wettlauf:** Der Löschjob arbeitet in einer einzigen Transaktion. Zuerst sperrt er die Kontozeile (`SELECT … FROM users WHERE id = :alt FOR UPDATE`). Jede Transaktion, die einen neuen Verweis auf das Konto anlegen will, wartet damit an der Fremdschlüsselprüfung (sie braucht eine `FOR KEY SHARE`-Sperre auf dieselbe Zeile) und scheitert nach dem Commit, weil die Zeile dann fehlt. Danach legt der Job das Platzhalterkonto an, stellt alle Verweise um, schwärzt die Protokolle und löscht die alte `users`-Zeile. Alle Fremdschlüssel auf `users` sind `ON DELETE RESTRICT`: Bleibt doch ein Verweis übrig, schlägt das Löschen fehl, die Transaktion wird vollständig zurückgerollt und der Job später wiederholt. Ein halb umgestelltes Konto kann es so nicht geben.
  - **Gelöscht:** Konto-Stammdaten (E-Mail, Passwort-Hash), Sitzungen, Push-Abonnements, Einstellungen, Mitteilungen, `player_profiles` (öffentlicher Anzeigename), `player_statistics`, `player_question_exposure`, Freitexte in `question_reports`, `idempotency_keys`. Persönliche `world_events` (mit `user_id`) werden zu Platzhaltern (`type = 'REDACTED'`, leerer `payload`, `user_id` leer), damit die `seq`-Folge lückenlos bleibt; öffentliche Ereignisse enthalten keine Namen, nur IDs. Missbrauchssignale des Kontos werden gelöscht. Läuft für das Konto ein Prüf- oder Sperrverfahren, wird die gesamte Löschung bis zu dessen Abschluss aufgeschoben, höchstens 30 Tage [E, Frist bei der Rechtsprüfung bestätigen]; der Spieler erfährt das bei der Bestätigung des Antrags. Es gibt also keinen Aufbewahrungspfad, der die alte Konto-ID behält. Signale anderer Konten, die dieses Konto als Beteiligten nennen, verweisen über `abuse_signals.related_user_id` (Fremdschlüssel) darauf und werden wie alle Verweise umgestellt.
  - **Anonymisiert:** Spielhistorie, die die Welt anderer Spieler beschreibt (`world_participants`, `season_results`, `siege_participants`, `quiz_answers`, `reward_events`, `player_items`, `item_usage`, `inventory_transactions`, `kingdoms`, `audit_events`, `question_reports.reporter_user_id`) sowie die redaktionelle und administrative Zuordnung von Redaktions- und Admin-Konten (`world_rules.created_by`, `questions.created_by`, `question_versions.approved_by`, `question_translations.translated_by` und `reviewed_by`, `question_reviews.reviewer_id`, `audit_events.actor_user_id`): Der Löschjob legt ein Platzhalterkonto an (neue zufällige ID, `users.deleted_at` gesetzt, keine personenbezogenen Felder, keine Anmeldung), stellt alle Verweise darauf um und löscht danach die ursprüngliche `users`-Zeile. Fremdschlüssel bleiben gültig, eine Zuordnung zwischen alter und neuer ID gibt es nicht. `quiz_answers.raw_input` wird geleert. Reiche erhalten einen anonymen Namen („Vergessenes Reich #…“). Diese Schwärzung ist die einzige erlaubte Änderung an Protokolltabellen und wird selbst protokolliert ([DATA_MODEL.md §1](DATA_MODEL.md#1-grundsätze)). Jede Spalte, die auf ein Konto verweist, ist ein Fremdschlüssel auf `users` und steht in dieser Liste; ein Integrationstest prüft das anhand des Datenbankkatalogs, damit neue Spalten nicht vergessen werden.
  - **`audit_events`:** Das betroffene Konto steht nur in `target_user_id` (Fremdschlüssel, gesetzt bei Kontozielen und bei Zielen, die einem Konto gehören), nie in `target_id` oder im JSON. `before` und `after` enthalten nur IDs von Spiel- und Inhaltsobjekten sowie Spiel- und Inhaltswerte; personenbezogene Felder (E-Mail, Passwort-Hash, IP-Hash, Anzeigename, Push-Daten, Freitexte von Spielern) werden nur als Feldname mit dem Wert `"<geändert>"` vermerkt, nie im Klartext. Bei der Löschung werden `actor_user_id` und `target_user_id` wie alle Fremdschlüssel umgestellt. Bei Einträgen, deren `target_user_id` das gelöschte Konto war, leert der Löschjob zusätzlich `before` und `after` und ersetzt den Freitext `reason` durch `[geschwärzt]`. Erhalten bleiben Akteur, Rolle, Aktion und Zeitpunkt, sodass nachvollziehbar bleibt, wer wann was getan hat.
  - **Backups** laufen nach ihrer Aufbewahrungsfrist aus; nach einer Wiederherstellung wird die Löschliste erneut angewendet.
- **Auskunft/Export:** maschinenlesbarer Export (JSON) aller personenbezogenen Daten.
- **Auftragsverarbeitung:** Hosting, ggf. E-Mail-Versand und Fehlerüberwachung erfordern AVV; Hosting in der EU bevorzugt ([O-11]).
- **Pflichttexte vor öffentlicher Beta:** Datenschutzerklärung (Deutsch, ADR-023), Impressum (Anbieterkennzeichnung, sofern geschäftsmäßig), Nutzungsbedingungen. Altersangabe und Jugendschutz: Ohne Chat und ohne frei wählbare öffentliche Texte ist das Risiko gering; die Mindestaltersfrage ist Teil der Rechtsprüfung.
- **Inaktive Konten:** Fristen nach [O-03](DECISIONS.md#o-03-kontomodell-und-anmeldung). Inaktivität zählt ab `users.last_seen_at`, bei nie benutzten Konten ab `created_at`. Gastkonten werden nach 90 Tagen ohne Anmeldung gelöscht (umgesetzt in Phase 2 Paket 2, [ADR-045](DECISIONS.md)): Die stündliche Kontopflege (bis zum Worker im `api`-Prozess, höchstens 50 Konten je Lauf) wertet offene Kämpfe des Gasts zuerst aus; läuft danach noch eine Frist, wartet die Löschung auf einen späteren Lauf. Gelöscht wird mit derselben Kaskade wie beim Löschantrag. Derselbe Lauf löscht abgelaufene Sitzungen und leert Bootstrap-Hashes nach 24 h. Registrierte Konten nach langer Inaktivität (Vorschlag 3 Jahre) mit Vorankündigung – die genaue Frist bleibt bis zur Rechtsprüfung offen.
- **Stand der Kaskade (Phase 2 Paket 2):** `deleteAccount` (`apps/server/src/modules/identity/deletion.ts`) setzt die Kaskade für die heute vorhandenen Tabellen um; die Liste `ACCOUNT_REFERENCES` nennt jede Spalte mit Konto-ID und ihre Behandlung, ein Integrationstest vergleicht sie mit dem Katalog (inklusive Index je Spalte) und prüft nach einer Löschung, dass die alte ID in keiner Zeile mehr vorkommt, auch nicht in JSON-Feldern. Dabei fiel auf, dass die Prüfspur der Reichsgründung (`kingdom_history`, `spawn.rngEntityId` = Instanz.Konto.Generation) die Konto-ID enthält; die Löschung entfernt dieses Feld (Migration 0011 erlaubt genau diese Änderung). Der Spawn lässt sich danach nicht mehr nachrechnen, die übrigen Felder der Prüfspur bleiben. Tabellen späterer Phasen (Items, Mitteilungen, Meldungen, Audit) kommen mit ihrer Migration in die Liste.

## 6. Geistiges Eigentum und Lizenzen

- Kein Code, keine Grafiken, Sounds, Texte oder Fragen aus anderen Spielen (Brief §14.1). Keine Erwähnung anderer Spielnamen in Marketing, Metadaten oder Store-Texten.
- **Asset-Register:** Mit dem ersten externen Asset entsteht `docs/ASSET_LICENSES.md` (Datei, Herkunft, Autor, Lizenz, Nachweis-Link). CI prüft, dass jedes Asset im Register steht.
- Bevorzugte Lizenzen für Assets: eigene Werke, CC0, OFL (Schriften), MIT/ISC (Icons). Keine Share-Alike-Lizenzen für Fragen-Inhalte.
- **Code-Abhängigkeiten:** Allowlist MIT, ISC, BSD-2/3, Apache-2.0, 0BSD; Copyleft-Lizenzen (GPL/AGPL) nur nach Einzelfallprüfung.
- **Name „Reiche des Wissens“:** Arbeitstitel, Markenrecherche (DPMA, EUIPO, ungarisches Amt) vor öffentlicher Nutzung ([O-12]).
- **KI-gestützte Inhalte:** werden gekennzeichnet (`origin`) und vor Freigabe von Menschen geprüft; Nutzungsbedingungen des verwendeten Werkzeugs sind zu beachten.

## 7. Monetarisierungsschutz

Das Datenmodell enthält **keinen** Kaufpfad für spielrelevante Items: `item_definitions` haben keine Preisfelder, Items entstehen nur aus `reward_events`. Spätere kosmetische Monetarisierung wird separat modelliert und rechtlich geprüft (insbesondere keine zufallsbasierten Käufe) (Brief §14.4).

## 8. Administration und Audit

- Rollen `PLAYER`, `EDITOR` (Fragen), `ADMIN` (Welt, Konten); minimale Rechte je Rolle; Admin-Endpunkte getrennt und zusätzlich mit Zweitfaktor.
- Jede administrative Aktion verlangt eine Begründung und erzeugt `audit_events` mit Vorher/Nachher (Brief §13.5); `audit_events` ist nur anhängbar.
- Korrekturen an Produktivdaten nur über protokollierte Werkzeuge, nie über direkte SQL-Sitzungen; Ausnahmen (Notfall) werden nachträglich dokumentiert.
- Staging nutzt eigene Daten; Produktionsdaten werden nicht nach Staging kopiert, außer anonymisiert.
