# Definition des ersten spielbaren MVP

Bezug: Brief §16, §20 „Erste konkrete Lieferung“, §21. Dieses Dokument legt fest, was „spielbar“ an welchem Meilenstein bedeutet und was ausdrücklich **nicht** dazugehört.

## 1. Drei Meilensteine

| Meilenstein | Nach | Für wen | Beweist |
|---|---|---|---|
| **M1 – Spielbarer Prototyp** | Phase 1 | Product Owner, intern | Der Kern-Loop „Frage beantworten → Gebiet erobern → Reich wächst“ macht Spaß und ist verständlich |
| **M2 – Multiplayer-Kern** | Phase 2 | intern, 2–5 Tester | Zwei Menschen kämpfen fair und konsistent auf derselben Karte |
| **M3 – Erstes spielbares MVP (Closed Beta)** | Schritt 4.5 | 20–100 eingeladene Spieler | Eternal mit 24-h-Belagerungen, Items und NPCs trägt über mehrere Wochen |

„Erstes spielbares MVP“ im Sinne des Briefs ist **M3**: das kleinste Produkt, das die Kernfantasie (Brief §1.1) vollständig erlebbar macht – inklusive asynchroner Verteidigung und Zeit-Items.

**Kurswechsel 2026-11-10 (ADR-046):** Vor M3 kommt die rundenbasierte **Partie** als erstes fertiges Spiel (§5). Das erste MVP, das Spieler von außen ausprobieren, ist damit die Partie; die Meilensteine der Eternal-Welt bleiben, verschieben sich aber um die Partie-Pakete M1–M5. Die Pakete der Partie heißen ebenfalls M1–M5 ([DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md#partie--rundenbasiertes-hauptspiel-adr-046)); gemeint sind dort Pakete, hier Meilensteine.

## 2. M1 – Spielbarer Prototyp (Phase 1)

**Enthalten:** eine Testwelt mit ≈ 150 Regionen; neutrale Regionen und 2–3 statische NPC-Reiche (leicht/mittel/schwer); Gastkonto mit dauerhafter Sitzung; Startregion und Hauptstadt; PvE-Eroberung mit Trivia + Schätzfrage, Gate und Tiebreakern; sofortige Auflösung mit Erklärung; Schutzzeit; Reichsanzeige mit Rang; Oberfläche auf Deutsch (ADR-023); 150 geprüfte Fragen (bis zur Entscheidung über [O-02] die 40 Testfragen).

**Nicht enthalten:** PvP, Items, NPC-Expansion, Benachrichtigungen, Registrierung.

**Abnahme:** Brief Phase 1 + E2E-01 + Median „Erstbesuch → zweite Region“ < 3 Minuten im eigenen Test.

## 3. M2 – Multiplayer-Kern (Phase 2)

**Enthalten:** alles aus M1; Registrierung/Anmeldung nach [O-03] und generierte öffentliche Namen ([O-10]); PvP-Belagerungen mit verdecktem Gate, Verteidigung, Verteidigungspunkten und Auflösung, Fristen für Tests kurz konfiguriert (Minuten statt 24 h); Echtzeit-Aktualisierung der Karte per WebSocket mit `resume`/Snapshot; Schutz gegen gleichzeitige Angriffe auf dieselbe Region; Testumgebung für 2–5 Tester (Staging nach [O-11], sonst lokales Netz).

**Nicht enthalten:** 24-h-Fristen mit Timeout-Jobs und Neustartfestigkeit, Web Push, vollständige Limits und Schutzzeiten (Phase 3), Items (Phase 4) sowie alles aus §4.2.

**Abnahme:** Brief Phase 2 (zwei echte Spieler kämpfen auf derselben Karte ohne inkonsistente Besitzverhältnisse) + E2E-02, -03, -04, -09 (E2E-10 ruht, ADR-023) + Invariantenjob ohne Verstoß nach einer internen Testsitzung mit 2–5 Spielern.

## 4. M3 – Erstes spielbares MVP (Closed Beta)

### 4.1 Enthalten

| Bereich | Umfang |
|---|---|
| Welt | **eine Eternal-Instanz**, Kern aus 3 × 3 Chunks (≈ 2 000 spielbare Regionen), feste Größe |
| NPCs | 6–10 Fraktionen (leicht/mittel/schwer), verteidigen ihre Gebiete, **keine** Expansion und **keine** Angriffe auf Spieler |
| Konten | Gast + Upgrade auf Konto ([O-03]); generierte Anzeigenamen; Sprache Deutsch; Kontolöschung, Datenexport |
| Einstieg | Tutorial (3 Schritte), fairer Startplatz, Anfängerschutz |
| PvE | sofortige Kämpfe gegen Garnisonen und NPC-Reiche |
| PvP | asynchrone Belagerungen mit verdecktem Gate und Verteidigungspunkten, 24-h-Frist, automatischer Verlust bei Zeitablauf, Angriffs- und Versuchskontingente, max. 4 offene Belagerungen pro Reich, Schutzzeiten, Rangabstandsschutz |
| Reich | Hauptstadt mit drei Leben, Übernahme des ganzen Reichs mit dem letzten Leben (ADR-037), Totalverlust mit Neustart, Statistik, Ränge |
| Items | drei Zeit-Items, Drops mit Anti-Farming, Inventar + Ablage, **manuelle** Verlängerung bis 48 h |
| UI | Karte (Desktop + Mobil), Regionsdetails, Quiz, Belagerungs-Dashboard, Inventar, Mitteilungen, Ranglisten (Regionen, Verteidigung) |
| Benachrichtigung | In-App + Web Push ([O-04]) |
| Inhalte | ≈ 400 Trivia + 250 Schätzfragen, geprüft, Fehlermeldefunktion |
| Betrieb | Staging + Beta-Umgebung ([O-11]), tägliche Backups mit getesteter Wiederherstellung, Monitoring und Alarme, Invariantenjob, Admin-Grundwerkzeuge (Kampf-Rekonstruktion, Belagerung abbrechen, Frage suspendieren, Missbrauchsliste) |
| Recht | Entwurf Datenschutzerklärung und Impressum, Nutzungsbedingungen, Asset-Register |

### 4.2 Bewusst nicht enthalten

Daily/Weekly (Phase 6) · automatische Itemverwendung (Phase 4b) · NPC-Expansion, NPC-Angriffe, dynamische NPC-Anpassung (Phase 5) · dynamisches Kartenwachstum (Phase 5) · Inaktivitätsverfall (Phase 5) · Provinzen, Versorgungswege, Diplomatie, Weltereignisse · Chat und frei wählbare Namen · Live-Duelle · Monetarisierung · native Apps.

### 4.3 Abnahmekriterien M3

1. Alle Abnahmekriterien der Phasen 1–4 und E2E-01 bis -11 grün (ohne das ruhende E2E-10).
2. 7 Tage Staging-Testlauf mit simulierten Spielern (Bots über die öffentliche API) ohne Invariantenverletzung.
3. Wiederherstellung aus Backup erfolgreich geprobt.
4. Kampf-Rekonstruktion für eine zufällige Stichprobe von 20 Kämpfen nachvollziehbar.
5. Freigabe des Product Owners für Hosting, Kosten und Einladung von Testern.

### 4.4 Was die Beta messen soll

Siehe Indikatoren in [PRODUCT_VISION.md §5](PRODUCT_VISION.md#5-erfolgskriterien-und-messbare-indikatoren). Besonders wichtig für die Entscheidungen danach:

- Anteil durch Zeitablauf verlorener Belagerungen und Rückmeldungen dazu → Push-Wirkung, Urlaubsmodus ([O-06]).
- Wie oft entscheidet die Geschwindigkeit, und wie fair fühlt sich das an → `cap`, Schätzfragen-Redaktion.
- Itemfüllstände → Tageskontingent für Drops.
- Verteilung der Reichsgrößen nach 2–4 Wochen → Belagerungskapazität ([O-05]), Rangabstand ([O-07]).

## 5. Partie – erstes fertiges Spiel (ADR-046)

**Enthalten:** Partie mit Freunden per Einladungscode, zwei oder drei Spieler, freie Plätze auf Wunsch mit Bots (ADR-052); Testpartie als Werkzeug zum Testen, nicht in Produktion (ADR-048); Karte nach Spielerzahl (Wendelmark zu dritt, Kernmark zu zweit); Anzeige der Zugfolge; Hauptstadtwahl, Landnahme mit Schätzfragen, vier Feldzugrunden mit Duellen, Abrechnung nach Regionswerten ([MATCH_RULES.md](MATCH_RULES.md)); Timer, die der Server führt, auch über einen Neustart hinweg; gleichzeitige Fragen per WebSocket; Gast und gesichertes Konto mit Spielernamen (ADR-043, ADR-044); Ergebnis in der Spielerstatistik; genug Fragen, damit sich in den ersten fünf Partien eines Spielers keine wiederholt (nach E2 nur lokal, KI-Entwürfe nie ungeprüft veröffentlicht).

**Nicht enthalten:** Warteschlange mit Fremden und Rangliste mit Wertungszahl (brauchen einen erreichbaren Server, [O-11]), Items, Chat, freie Namen, Monetarisierung.

**Abnahme:** Simulation von je 1 000 Partien zu dritt und zu zweit ohne Verstoß (M1); Integrationstest einer ganzen Partie mit Neustart (M2); drei Testclients sehen jede Frage gleichzeitig (M3); E2E ganze Testpartie gegen zwei Bots und normale Partie mit zwei Browsern (M4); Spieltest des Product Owners auf seinem Rechner; Standardwerte danach bestätigt oder nachjustiert (E3).
