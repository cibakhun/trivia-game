# Sicherheit, Anti-Cheat, Datenschutz und Recht

Bezug: Brief §12.2, §13, §14. Rechtliche Aussagen in diesem Dokument sind technische Vorbereitung, **keine Rechtsberatung**; vor einer öffentlichen Beta ist eine juristische Prüfung nötig (Brief §14.1 letzter Satz).

## 1. Server-Autorität (Brief §12.2)

| Wert | Wo entschieden | Was der Client darf |
|---|---|---|
| Gebietsbesitz | Auflösungstransaktion | anzeigen |
| Gewinner, Richtigkeit, Abstand | `game-core.resolveDuel` auf dem Server | Ergebnis anzeigen |
| Antwortzeit | Server aus `presented_at`/`received_at`, Client-Wert nur im Fenster `[S − cap, S]` | Zeit melden |
| Fristablauf | DB-Uhr `game_now()` | Restzeit anzeigen (vom Server geliefert) |
| Itemanzahl, Drop, NPC-Ergebnis | Server, Zufallsstrom mit Geheimnis | anzeigen |
| Punkte, Ranglisten | Server-Ableitung | anzeigen |

Der Client erhält nie Daten, die er vor der Auflösung nicht sehen darf (richtige Option, Lösungswert, Gegnerantwort). Das wird durch Vertragstests auf den Antwortschemas abgesichert ([TEST_PLAN.md](TEST_PLAN.md)).

## 2. Anwendungssicherheit [E]

- **Authentifizierung:** Argon2id für Passwörter; Sitzungstoken 256 Bit zufällig, nur als Hash gespeichert; `HttpOnly`, `Secure`, `SameSite=Lax`; Rotation bei Anmeldung; Ablauf 30 Tage gleitend. Admin- und Redaktionskonten zusätzlich mit TOTP-Zweitfaktor.
- **CSRF:** Prüfung von `Origin` plus Double-Submit-Token für zustandsändernde Anfragen.
- **Eingaben:** Jede Anfrage wird per zod-Schema validiert; unbekannte Felder werden verworfen. SQL ausschließlich parametrisiert über Kysely.
- **Header:** strikte Content-Security-Policy (keine Inline-Skripte, keine Fremd-Skripte), HSTS, `X-Content-Type-Options`, `Referrer-Policy`.
- **Rate Limiting:** je Sitzung und IP für Anmeldung, Angriffe, Antworten, Verlängerungen.
- **Secrets:** nur über Umgebungsvariablen/Secret-Store; `.env` in `.gitignore`; Secret-Scanning in CI.
- **Abhängigkeiten:** Lockfile, automatische Update-PRs, `pnpm audit` in CI, Lizenz-Allowlist (§6).
- **Ziel-Standard:** OWASP ASVS Stufe 2; externer Penetrationstest vor öffentlichem Start (Phase 7).

## 3. Anti-Cheat Quiz

| Bedrohung (Brief §13.1) | Gegenmaßnahme |
|---|---|
| Offenlegung korrekter Antworten | Lösung nie vor Auflösung im Payload; Optionen als Einmal-Token pro Präsentation |
| Manipulierte Client-Timer | Serverzeit maßgeblich; Client-Wert nur im Fenster `[S − 500 ms, S]` ([QUIZ_ENGINE.md §6](QUIZ_ENGINE.md#6-zeitmessung-und-latenzausgleich)) |
| Mehrfache Antwortversuche | `unique(participant_id, step_index)` + bedingte Aktualisierung; abgegebene Antworten per Trigger unveränderlich |
| Fragenwechsel durch Refresh | `present` liefert für einen Schritt immer dieselbe Frage mit ursprünglichem `presented_at` |
| Wiederholung derselben Herausforderung | eine Herausforderung pro Belagerung; Abbruch zählt als Niederlage; Versuchskontingent |
| Vorzeitige Offenlegung der Gegnerantwort | Gegnerdaten erst nach Auflösung; Verteidiger erfährt vor Start nicht einmal die Kategorie |
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
| Konto (E-Mail optional, Passwort-Hash) | Spielbetrieb | Vertrag (Art. 6 Abs. 1 lit. b) | bis Löschung |
| Generierter Anzeigename, Reich, Spielhistorie | Spielbetrieb, Fairness | Vertrag | bis Löschung, danach anonymisiert |
| Antworten und Zeiten | Auswertung, Streitfälle | Vertrag | 12 Monate |
| Sprache, Zeitzone, Einstellungen | Spielbetrieb | Vertrag | bis Löschung |
| Push-Abonnement | Benachrichtigungen | Einwilligung (Browserdialog) | bis Widerruf/Abmeldung |
| IP-Adresse | Sicherheit, Missbrauchsabwehr | berechtigtes Interesse (lit. f) | Logs max. 7 Tage, in DB nur gesalzener Hash |
| Missbrauchssignale | Fairness, Sicherheit | berechtigtes Interesse | 12 Monate |

### 5.2 Umsetzung

- **Cookies/Speicher:** nur technisch notwendiges Sitzungscookie; `localStorage` nur für UI-Einstellungen. Keine Tracking-, Analyse- oder Werbe-Cookies im MVP ⇒ kein Einwilligungsbanner nötig (zu bestätigen bei der Rechtsprüfung). Spätere Produktanalyse nur selbst gehostet und datensparsam.
- **Kontolöschung:** Selbstbedienung; personenbezogene Felder werden sofort entfernt, Reiche erhalten einen anonymen Namen („Vergessenes Reich #…“), damit die Spielhistorie anderer Spieler konsistent bleibt.
- **Auskunft/Export:** maschinenlesbarer Export (JSON) aller personenbezogenen Daten.
- **Auftragsverarbeitung:** Hosting, ggf. E-Mail-Versand und Fehlerüberwachung erfordern AVV; Hosting in der EU bevorzugt ([O-11]).
- **Pflichttexte vor öffentlicher Beta:** Datenschutzerklärung (de/hu/en), Impressum (Anbieterkennzeichnung, sofern geschäftsmäßig), Nutzungsbedingungen. Altersangabe und Jugendschutz: Ohne Chat und ohne frei wählbare öffentliche Texte ist das Risiko gering; die Mindestaltersfrage ist Teil der Rechtsprüfung.
- **Inaktive Konten:** Löschung nach langer Inaktivität (Vorschlag 3 Jahre) mit Vorankündigung – Speicherbegrenzung.

## 6. Geistiges Eigentum und Lizenzen

- Kein Code, keine Grafiken, Sounds, Texte oder Fragen aus anderen Spielen (Brief §14.1). Keine Erwähnung anderer Spielnamen in Marketing, Metadaten oder Store-Texten.
- **Asset-Register:** Mit dem ersten externen Asset entsteht `docs/ASSET_LICENSES.md` (Datei, Herkunft, Autor, Lizenz, Nachweis-Link). CI prüft, dass jedes Asset im Register steht.
- Bevorzugte Lizenzen für Assets: eigene Werke, CC0, OFL (Schriften), MIT/ISC (Icons). Keine Share-Alike-Lizenzen für Fragen-Inhalte.
- **Code-Abhängigkeiten:** Allowlist MIT, ISC, BSD-2/3, Apache-2.0, 0BSD; Copyleft-Lizenzen (GPL/AGPL) nur nach Einzelfallprüfung.
- **Name „Reiche des Wissens“:** Arbeitstitel, Markenrecherche (DPMA, EUIPO, ungarisches Amt) vor öffentlicher Nutzung ([O-12]); ungarischer und englischer Titel ebenfalls prüfen.
- **KI-gestützte Inhalte:** werden gekennzeichnet (`origin`) und vor Freigabe von Menschen geprüft; Nutzungsbedingungen des verwendeten Werkzeugs sind zu beachten.

## 7. Monetarisierungsschutz

Das Datenmodell enthält **keinen** Kaufpfad für spielrelevante Items: `item_definitions` haben keine Preisfelder, Items entstehen nur aus `reward_events`. Spätere kosmetische Monetarisierung wird separat modelliert und rechtlich geprüft (insbesondere keine zufallsbasierten Käufe) (Brief §14.4).

## 8. Administration und Audit

- Rollen `PLAYER`, `EDITOR` (Fragen), `ADMIN` (Welt, Konten); minimale Rechte je Rolle; Admin-Endpunkte getrennt und zusätzlich mit Zweitfaktor.
- Jede administrative Aktion verlangt eine Begründung und erzeugt `audit_events` mit Vorher/Nachher (Brief §13.5); `audit_events` ist nur anhängbar.
- Korrekturen an Produktivdaten nur über protokollierte Werkzeuge, nie über direkte SQL-Sitzungen; Ausnahmen (Notfall) werden nachträglich dokumentiert.
- Staging nutzt eigene Daten; Produktionsdaten werden nicht nach Staging kopiert, außer anonymisiert.
