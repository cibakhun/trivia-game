# Definition des ersten spielbaren MVP

Bezug: Brief §16, §20 „Erste konkrete Lieferung“, §21. Dieses Dokument legt fest, was „spielbar“ an welchem Meilenstein bedeutet und was ausdrücklich **nicht** dazugehört.

## 1. Drei Meilensteine

| Meilenstein | Nach | Für wen | Beweist |
|---|---|---|---|
| **M1 – Spielbarer Prototyp** | Phase 1 | Product Owner, intern | Der Kern-Loop „Frage beantworten → Gebiet erobern → Reich wächst“ macht Spaß und ist verständlich |
| **M2 – Multiplayer-Kern** | Phase 2 | intern, 2–5 Tester | Zwei Menschen kämpfen fair und konsistent auf derselben Karte |
| **M3 – Erstes spielbares MVP (Closed Beta)** | Schritt 4.5 | 20–100 eingeladene Spieler | Eternal mit 24-h-Belagerungen, Items und NPCs trägt über mehrere Wochen |

„Erstes spielbares MVP“ im Sinne des Briefs ist **M3**: das kleinste Produkt, das die Kernfantasie (Brief §1.1) vollständig erlebbar macht – inklusive asynchroner Verteidigung und Zeit-Items.

## 2. M1 – Spielbarer Prototyp (Phase 1)

**Enthalten:** eine Testwelt mit ≈ 150 Regionen; neutrale Regionen und 2–3 statische NPC-Reiche (leicht/mittel/schwer); Gastkonto mit dauerhafter Sitzung; Startregion und Hauptstadt; PvE-Eroberung mit Trivia + Schätzfrage, Gate und Tiebreakern; sofortige Auflösung mit Erklärung; Schutzzeit; Reichsanzeige mit Rang; Oberfläche in de/hu/en; 150 geprüfte Fragen.

**Nicht enthalten:** PvP, Items, NPC-Expansion, Benachrichtigungen, Registrierung.

**Abnahme:** Brief Phase 1 + E2E-01 + Median „Erstbesuch → zweite Region“ < 3 Minuten im eigenen Test.

## 3. M3 – Erstes spielbares MVP (Closed Beta)

### 3.1 Enthalten

| Bereich | Umfang |
|---|---|
| Welt | **eine Eternal-Instanz**, Kern aus 3 × 3 Chunks (≈ 2 000 spielbare Regionen), feste Größe |
| NPCs | 6–10 Fraktionen (leicht/mittel/schwer), verteidigen ihre Gebiete, **keine** Expansion und **keine** Angriffe auf Spieler |
| Konten | Gast + Upgrade auf Konto ([O-03]); generierte Anzeigenamen; Sprache de/hu/en; Kontolöschung, Datenexport |
| Einstieg | Tutorial (3 Schritte), fairer Startplatz, Anfängerschutz |
| PvE | sofortige Kämpfe gegen Garnisonen und NPC-Reiche |
| PvP | asynchrone Belagerungen mit Gate, 24-h-Frist, automatischer Verlust bei Zeitablauf, Angriffs- und Versuchskontingente, max. 4 offene Belagerungen pro Reich, Schutzzeiten, Rangabstandsschutz |
| Reich | Hauptstadt, Hauptstadtwechsel, Totalverlust mit Neustart, Statistik, Ränge |
| Items | drei Zeit-Items, Drops mit Anti-Farming, Inventar + Ablage, **manuelle** Verlängerung bis 48 h |
| UI | Karte (Desktop + Mobil), Regionsdetails, Quiz, Belagerungs-Dashboard, Inventar, Mitteilungen, Rangliste (Regionen) |
| Benachrichtigung | In-App + Web Push ([O-04]) |
| Inhalte | ≈ 400 Trivia + 250 Schätzfragen, dreisprachig geprüft, Fehlermeldefunktion |
| Betrieb | Staging + Beta-Umgebung ([O-11]), tägliche Backups mit getesteter Wiederherstellung, Monitoring und Alarme, Invariantenjob, Admin-Grundwerkzeuge (Kampf-Rekonstruktion, Belagerung abbrechen, Frage suspendieren, Missbrauchsliste) |
| Recht | Entwurf Datenschutzerklärung und Impressum, Nutzungsbedingungen, Asset-Register |

### 3.2 Bewusst nicht enthalten

Daily/Weekly (Phase 6) · automatische Itemverwendung (Phase 4b) · NPC-Expansion, NPC-Angriffe, dynamische NPC-Anpassung (Phase 5) · dynamisches Kartenwachstum (Phase 5) · Inaktivitätsverfall (Phase 5) · Provinzen, Versorgungswege, Diplomatie, Weltereignisse · Chat und frei wählbare Namen · Live-Duelle · Monetarisierung · native Apps.

### 3.3 Abnahmekriterien M3

1. Alle Abnahmekriterien der Phasen 1–4 und E2E-01 bis -11 grün.
2. 7 Tage Staging-Testlauf mit simulierten Spielern (Bots über die öffentliche API) ohne Invariantenverletzung.
3. Wiederherstellung aus Backup erfolgreich geprobt.
4. Kampf-Rekonstruktion für eine zufällige Stichprobe von 20 Kämpfen nachvollziehbar.
5. Freigabe des Product Owners für Hosting, Kosten und Einladung von Testern.

### 3.4 Was die Beta messen soll

Siehe Indikatoren in [PRODUCT_VISION.md §5](PRODUCT_VISION.md#5-erfolgskriterien-und-messbare-indikatoren). Besonders wichtig für die Entscheidungen danach:

- Anteil durch Zeitablauf verlorener Belagerungen und Rückmeldungen dazu → Push-Wirkung, Urlaubsmodus ([O-06]).
- Wie oft entscheidet die Geschwindigkeit, und wie fair fühlt sich das an → `cap`, Schätzfragen-Redaktion.
- Itemfüllstände → Tageskontingent für Drops.
- Verteilung der Reichsgrößen nach 2–4 Wochen → Belagerungskapazität ([O-05]), Rangabstand ([O-07]).
