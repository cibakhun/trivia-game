# Itemsystem und Itemökonomie

Bezug: Brief §8, §13.3, §15.3, §19 F. Kennzeichnung siehe [README](README.md#kennzeichnung-von-regeln).

## 1. Ziele

- Items geben **taktische Zeit**, nie Wissen: Sie erzeugen keine Antworten und lösen keine Fragen [V].
- Nur erspielbar, nicht kaufbar, nicht handelbar [V/A].
- „Wertvoll, aber nicht zwingend notwendig“ (Brief §21.7): Wer täglich spielt, braucht sie selten; wer ein Wochenende weg ist, kann damit Verluste vermeiden.
- Jede Erzeugung und jeder Verbrauch ist einzeln nachvollziehbar [V].

## 2. Itemdefinitionen [A]

| ID | Name (de) | Seltenheit | Effekt | Modi |
|---|---|---|---|---|
| `hourglass_small` | Kleine Sanduhr | gewöhnlich | +6 h auf eine offene Belagerung | Eternal |
| `chronos_seal` | Chronos-Siegel | selten | +12 h | Eternal |
| `time_crystal` | Königlicher Zeitkristall | episch | +24 h | Eternal |

Obergrenze: Frist ≤ Eröffnung + 48 h [A]. Würde ein Item darüber hinausgehen, wird gekappt; die Oberfläche zeigt vor der Bestätigung die tatsächliche neue Frist und den verfallenden Rest („+12 h, davon 4 h wirksam“) [E, W-9]. Ist die Grenze bereits erreicht, wird abgelehnt, ohne das Item zu verbrauchen (E2E-07).

## 3. Drops

- **Wann:** nach jeder **qualifizierten Eroberung** (§5) ein Wurf für den Sieger [A].
- **Wie:** eine gemeinsame gewichtete Ziehung `u ∈ [0, 1)` aus dem Zufallsstrom `drop:{siege_id}` [V-nah, Brief §8.4]:

| Ergebnis | Gewicht | Intervall |
|---|---:|---|
| kein Item | 79 % | `u < 0,79` |
| Kleine Sanduhr | 15 % | `0,79 ≤ u < 0,94` |
| Chronos-Siegel | 5 % | `0,94 ≤ u < 0,99` |
| Zeitkristall | 1 % | `0,99 ≤ u` |

- Weil der Seed aus der Kampf-ID abgeleitet ist, liefert eine erneute Verarbeitung denselben Wurf; `unique(reward_events.source_id, user_id)` verhindert eine zweite Belohnung (E2E-11).
- Reduzierte Berechtigung (§5) skaliert die Item-Gewichte mit Faktor `f` und erhöht „kein Item“ entsprechend: `none = 1 − f · 0,21`.

## 4. Ökonomie-Analyse

### 4.1 Erwartungswerte pro qualifizierter Eroberung

| Größe | Wert |
|---|---|
| Wahrscheinlichkeit für irgendein Item | 21 % |
| Erwartete Verlängerungsstunden | 0,15·6 + 0,05·12 + 0,01·24 = **1,74 h** |
| Ø Wert eines erhaltenen Items | 1,74 / 0,21 ≈ **8,3 h** |

### 4.2 Simulation

Monte Carlo, 20 000 Spieler je Szenario, Inventargrenze 10, keine Itemnutzung.

| Qualifizierte Eroberungen pro Tag | Items/Tag | Stunden/Tag | Inventar voll nach (Median, 10.–90. Perzentil) | P(≥ 1 Kristall in 7 Tagen) | P(≥ 1 Kristall in 30 Tagen) |
|---:|---:|---:|---|---:|---:|
| 3 | 0,63 | 5,2 | 16 Tage (11–22) | 19 % | 60 % |
| 6 | 1,26 | 10,4 | 8 Tage (6–11) | 35 % | 84 % |
| 10 | 2,10 | 17,4 | 5 Tage (4–7) | 50 % | 95 % |

Das Skript liegt künftig unter `tools/sim/items` (Phase 4); die Zahlen hier stammen aus einem vorläufigen Lauf in Phase 0.

### 4.3 Bedarf: Welche Abwesenheit können Items abdecken?

Eine während der Abwesenheit eröffnete Belagerung mit Eröffnung `t` Stunden nach Abreise benötigt `max(0, A − t − 24)` Stunden Verlängerung, höchstens 24 h. Bei angenommen 1,5 eingehenden Belagerungen pro Tag:

| Abwesenheit A | betroffene Belagerungen | Bedarf gesamt | entspricht etwa |
|---|---|---|---|
| ≤ 24 h | keine | 0 h | – |
| 36 h | ≈ 0,75 | ≈ 4,5 h | 1 Sanduhr |
| 48 h | ≈ 1,5 | ≈ 18 h | 2–3 Items |
| > 48 h | ab hier nicht vollständig abdeckbar | – | Verluste begrenzt durch Belagerungskappung (≤ 4 pro 24 h) bzw. Urlaubsmodus ([O-06]) |

### 4.4 Schlussfolgerungen und Empfehlung

1. Mit **10** qualifizierten Eroberungen pro Tag wäre das Inventar nach etwa 5 Tagen dauerhaft voll – Items wären Massenware, nicht „wertvoll“. Mit **6** pro Tag reicht ein volles Inventar (≈ 83 h) für mehrere Wochenenden; Kristalle bleiben selten (35 % in der ersten Woche). **Empfehlung: `items.dropEligibleConquestsPerDay = 6`** [E].
2. **„Item-Mauer“ großer Reiche:** Wer jede Belagerung auf 48 h streckt, halbiert die maximale Verlustrate (4 Slots / 48 h = 2 pro Tag). Dafür bräuchte ein Reich im Dauerbetrieb ≈ 6 Items pro Tag, erhält aber nur ≈ 1,3. Die begrenzte Zufuhr verhindert diese Strategie auf Dauer; kurzfristig ist sie gewollt (taktische Zeit).
3. Die Dropraten aus dem Brief sind als Ausgangspunkt stimmig. Die Stellschrauben sind das Tageskontingent und die Inventargrenze, nicht die Einzelwahrscheinlichkeiten.
4. Vor der Beta werden die Werte mit einer Simulation verschiedener Spielertypen (täglich, Wochenende, Vielspieler, Multiaccount-Farmer) gegen die Belagerungslimits geprüft (Phase 4, Brief §19 F).

## 5. Anti-Farming

Eine Eroberung ist **qualifiziert**, wenn alle Bedingungen gelten [E, Brief §8.5]:

| # | Regel | Standard |
|---|---|---|
| Q1 | Der Spieler hat die Region erobert (Angreifersieg). Verteidigungen erzeugen keine Drops – sonst könnte ein Zweitkonto absichtlich verlieren. | – |
| Q2 | Die Region gehörte in den letzten 24 h nicht dem erobernden Reich (kein Hin-und-her). | 24 h |
| Q3 | Tageskontingent qualifizierter Eroberungen (gleitend 24 h) nicht erschöpft. | 6 |
| Q4 | PvE: Spielstärke-Abstand. Ist `θ_spieler − θ_eff(Verteidiger) > 1,5`, gilt `f = 0,25`; über 2,5 keine Berechtigung. | – |
| Q5 | Neulingsregel: Die ersten 20 Eroberungen eines Spielers sind von Q4 ausgenommen (Brief §8.5: Anfänger nicht bestrafen). | 20 |
| Q6 | PvP: höchstens 2 belohnte Siege gegen denselben Gegnerspieler pro 24 h. | 2 |
| Q7 | PvP-Sieg durch Zeitablauf: halbes Gewicht `f = 0,5` (Vorschlag zu [O-09]); vollständig, wenn der Verteidiger mindestens 7 Tage aktiv und nicht verdächtig verknüpft ist. | 0,5 |

Jede Prüfung wird mit Ergebnis in `reward_events.eligibility` gespeichert (Brief §8.5 „verdächtige Transaktionen protokollieren“). Zusätzlich erzeugen auffällige Muster Missbrauchssignale ([SECURITY.md §4](SECURITY.md#4-missbrauch-multiaccounts-und-bots)): wiederholte Timeout-Siege gegen dieselben Konten, Regionen, die schnell zwischen zwei Konten wechseln, neue Konten, die überwiegend gegen ein bestimmtes Konto verlieren.

## 6. Inventar

- Inventar ist pro Spieler und Instanz (Eternal) [E]; es überlebt den Totalverlust des Reichs.
- Höchstens 10 verfügbare Zeit-Items [A]. Jedes Item ist ein eigener Datensatz (`player_items`) mit Herkunft (`reward_event_id`).
- **Voll:** Neue Items landen in der **Belohnungsablage** (`status = PENDING`, max. 10, Ablauf nach 7 Tagen) mit deutlicher Mitteilung. Der Spieler kann übernehmen (wenn Platz), ein anderes Item bewusst verwerfen oder ablaufen lassen [E, W-8]. Sind Inventar **und** Ablage voll, wird das Ergebnis als `NOT_GRANTED_FULL` protokolliert und dem Spieler ausdrücklich angezeigt – nie still.
- Keine Weitergabe, kein Handel, keine Übertragung zwischen Konten [A].

## 7. Verwendung

Ablauf und Prüfungen: [SIEGE_SYSTEM.md §6](SIEGE_SYSTEM.md#6-fristen-und-verlängerungen). Kernpunkte:

- Eine Transaktion: Item `AVAILABLE → CONSUMED` (bedingte Aktualisierung), `item_usage`, `inventory_transactions`, neue Frist, Ereignisse [V-nah, Brief §8.8].
- Doppelter Verbrauch ist ausgeschlossen durch Statusvergleich, `unique(item_usage.item_id)` und Idempotenzschlüssel (Brief §8.8).
- Der Client sendet die vorher angezeigte neue Frist mit; weicht sie ab, wird nichts verbraucht.

## 8. Automatische Verwendung (Phase 4b) [A/E]

- Standardmäßig aus; in den Einstellungen aktivierbar [A].
- Job alle 5 Minuten: für jede unverteidigte Belagerung mit Restzeit ≤ 6 h (konfigurierbar) [A].
- **Itemwahl:** kleinstes verfügbares Item zuerst (Sanduhr), damit seltene Items erhalten bleiben; erneute Prüfung beim nächsten 6-h-Fenster; höchstens bis zur 48-h-Grenze [E].
- **Priorität bei knappen Items** [A]: Hauptstadt → strategische Region → Region mit hohem Wert → übrige; innerhalb gleicher Priorität die früheste Frist. Eigene Prioritäten später.
- Optionales Tageslimit für automatische Verwendung (Standard: unbegrenzt bis Inventar leer).
- Jede automatische Verwendung ist eine normale `item_usage` mit `auto = true` und erzeugt eine Mitteilung (Push).
- Automatische Verwendung erzeugt **niemals** Quizantworten [V-nah, Brief §8.7].

## 9. Messgrößen

- Drop-Verteilung je Item gegen Sollwerte (statistischer Test, Alarm bei Abweichung) (Brief §18).
- Inventar-Füllstand (Verteilung), Anteil Spieler mit vollem Inventar.
- Anteil verlängerter Belagerungen, Ø Verlängerung, Anteil Kappungen.
- Verfallene Items in der Ablage (Indikator für zu hohe Zufuhr).
- Anteil durch Zeitablauf verlorener Belagerungen, obwohl Items verfügbar waren (UX-Indikator).
