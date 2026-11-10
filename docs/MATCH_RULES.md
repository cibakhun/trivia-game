# Regelwerk der Partie

Bezug: PO-Entscheidung vom 2026-11-10 („das Spiel soll rundenbasiert sein … erst das rundenbasierte Spiel, dann Eternal“), Plan „Rundenbasierte Partie“ vom selben Tag, ADR-046 und ADR-047. Kennzeichnung wie in [README.md](README.md#kennzeichnung-von-regeln).

Die Partie ist das rundenbasierte Hauptspiel: drei Reiche auf einer kleinen festen Karte, alle beantworten dieselbe Frage gleichzeitig, eine Partie dauert höchstens etwa 18 Minuten. Vorbild ist nur der Ablauf des Genres (gleichzeitige Fragen, Landnahme, Feldzug) **[V, PO 2026-11-10]**; Name, Karte, Grafik, Abschnittsnamen, Punktwerte und Fragen sind eigene. Die Eternal-Welt ([GAME_RULES.md](GAME_RULES.md)) bleibt im Code und spielbar, wird aber erst weiter ausgebaut, wenn die Partie fertig ist **[V, PO 2026-11-10]**.

Code: Regeln als reine Funktionen in `packages/game-core/src/match.ts` (Zustandsmaschine), `match-map.ts` (Karte) und `match-bots.ts` (Bots); Regelwerte in `packages/protocol/src/match-rules.ts` (`matchRulesSchema`, `DEFAULT_MATCH_RULES`, `PLAYTEST_MATCH_RULES`). Alle Zahlen dieses Dokuments sind Standardwerte **[E]** aus dem Plan und lassen sich ohne Umbau ändern.

## 1. Begriffe

| Begriff | Bedeutung |
|---|---|
| Partie | ein Spiel von der Hauptstadtwahl bis zur Abrechnung |
| Sitz | einer der drei Plätze; Sitz 0, 1, 2 ist zugleich die Zugreihenfolge |
| Runde n | beginnt bei Sitz (n − 1) mod 3; so wechselt, wer zuerst angreift und wer bei völligem Gleichstand vorn liegt |
| Region | ein Feld der Karte mit Besitzer und Punktwert |
| Hauptstadt | die erste Region eines Reichs, mit drei Leben |

## 2. Karte

Eine feste, eigene Karte **Wendelmark** mit 24 Regionen in fünf Reihen (4, 5, 6, 5, 4 Felder), symmetrisch zur Mitte **[E]**. Jede Region ist ein Hexfeld; benachbart sind Regionen, deren Felder sich berühren (wie [GAME_RULES.md §2](GAME_RULES.md#2-karte-und-nachbarschaft)). Drei Hauptstädte plus 21 Regionen ergeben bei 2 + 1 Wahlen je Landnahmerunde genau sieben Runden.

## 3. Ablauf

1. **Aufstellung** (Server, ab M2): „Partie gegen Bots“ startet sofort, „Partie mit Freunden“ über einen Einladungscode mit 6 Zeichen. Freie Plätze füllen Bots. Die Sitze werden gelost (`drawSeatOrder`, Strom `match`) **[E]**.
2. **Hauptstadtwahl:** Sitz 0, 1, 2 wählen nacheinander eine freie Region mit mindestens `capital.minDistance` = 2 Feldern Abstand zu jeder gewählten Hauptstadt (ein Feld dazwischen). Die Hauptstadt ist 300 wert **[E]**.
3. **Landnahme:** Jede Runde stellt allen dieselbe Schätzfrage. Rangfolge nach Abstand, bei gleichem Abstand nach effektiver Antwortzeit, bei völligem Gleichstand nach der Reihenfolge der Runde **[E]**. Nicht beantwortet zählt als unendlicher Abstand und unendliche Zeit. Der Erste wählt zwei freie Regionen, der Zweite eine, der Dritte keine (`landGrab.picksByPlace` = 2, 1, 0) **[E]**; gewählt wird nacheinander, erst beide Regionen des Ersten. Wählbar ist eine freie Region am eigenen Gebiet, gibt es keine, jede freie. Die Runden laufen, bis alle Regionen vergeben sind (auf der Wendelmark sieben).
4. **Feldzug:** `campaign.rounds` = 4 Runden; in jeder greift jedes lebende Reich einmal an, in der Reihenfolge der Runde **[E]**. Der Angreifer wählt eine gegnerische Region an seinem Gebiet (gibt es keine, jede gegnerische); dann folgt das Duell (§4).
5. **Abrechnung:** Schluss nach der vierten Feldzugrunde oder sobald nur ein Reich übrig ist; Wertung nach §6.

## 4. Duell

Angreifer und Verteidiger beantworten gleichzeitig dieselbe Wissensfrage **[E]**:

| Wissensfrage | Ausgang | Grund |
|---|---|---|
| nur einer richtig | er gewinnt | `TRIVIA` |
| beide falsch | der Verteidiger hält | `BOTH_WRONG` |
| beide richtig | eine Schätzfrage an beide entscheidet: kleinerer Abstand, dann kürzere Zeit, sonst hält der Verteidiger | `ESTIMATE`, `SPEED`, `FULL_TIE` |

Nicht beantwortet zählt als falsch bzw. als unendlicher Abstand. Die Schätzfrage wertet dieselbe Funktion aus wie das Eternal-Duell (`resolveDuel`, [QUIZ_ENGINE.md §8](QUIZ_ENGINE.md)).

**Folgen** **[E]**:

- Angreifer gewinnt gegen eine gewöhnliche Region: Sie gehört ihm mit ihrem Wert (`CONQUERED`).
- Angreifer gewinnt gegen eine Hauptstadt: Sie verliert ein Leben und bleibt beim Reich (`CAPITAL_HIT`). Der Sieg, der das letzte Leben nimmt, übernimmt das ganze Reich (`TAKEOVER`, wie ADR-037): Alle Regionen gehen an den Angreifer, die eroberte Hauptstadt wird eine gewöhnliche Region mit ihrem Wert, das Reich scheidet aus und greift nicht mehr an. Leben kehren in der Partie nicht zurück.
- Verteidiger gewinnt: Die Region wird befestigt und ist `values.defenseBonus` = 50 mehr wert (`FORTIFIED`), auch eine Hauptstadt.

## 5. Zeiten und Zeitablauf

| Schritt | Zeit **[E]** | Nach Ablauf |
|---|---|---|
| Wahl (Hauptstadt, Region, Angriffsziel) | 10 s | der Server wählt zufällig eine wählbare Region (`autoPickRegion`), bewusst nicht mit den Bot-Regeln, damit Abwarten keinen Vorteil bringt |
| Wissensfrage | 15 s | nicht beantwortet = falsch |
| Schätzfrage | 20 s | nicht beantwortet = unendlicher Abstand |
| Auflösung nach jeder Frage | 5 s | – |

Zeitmessung und Latenzausgleich wie [QUIZ_ENGINE.md §6.2](QUIZ_ENGINE.md) (`cap` = 500 ms). Wer die Verbindung verliert, bleibt in der Partie; verpasste Fragen und Wahlen behandelt der Server wie oben. `PLAYTEST_MATCH_RULES` verkürzt die Zeiten auf 8 s, 10 s, 5 s und 2 s, sonst gleiche Regeln.

## 6. Wertung

Punkte = Summe der Werte der eigenen Regionen (Region 100, Hauptstadt 300, je Befestigung +50) **[E]**. Rangfolge: Punkte; ein ausgeschiedenes Reich liegt hinter jedem lebenden, ein später ausgeschiedenes vor einem früher ausgeschiedenen; dann mehr Regionen, dann mehr Hauptstadtleben. Wer in allem gleich liegt, teilt sich den Platz (1, 1, 3). Das Ergebnis geht ab M2 in die Spielerstatistik.

## 7. Bots und Zufall

- **Antworten:** NPC-Antwortmodell wie im PvE, versiegelt vor der Frage (Strom `npc-answer`). Stärke leicht, mittel, schwer = Archetyp LIGHT, MEDIUM, HEAVY ([NPC_SYSTEM.md §2](NPC_SYSTEM.md)) **[E]**. Für reine Schätzfragen gibt es `generateNpcEstimate` mit derselben Ziehungsfolge.
- **Wahlen** **[E]**: Hauptstadt möglichst weit weg von den anderen (bis 3 Felder zählt), dann viele Nachbarn; Landnahme mit vielen eigenen, dann vielen freien Nachbarn; Angriffsziel mit dem größten unmittelbaren Gewinn (Regionswert; eine Hauptstadt mit letztem Leben bringt das ganze Reich, sonst zählt sie halb). Gleichstände entscheidet der Strom `match`. Die Stärke wirkt nur auf die Antworten.
- **Zufall:** neuer Zweck `match` im auditierbaren Zufall ([ARCHITECTURE.md §9](ARCHITECTURE.md)) für Sitzverteilung, Wahlen nach Zeitablauf und Bot-Wahlen. Die Zustandsmaschine selbst würfelt nie; Gleichstände entscheidet die Reihenfolge der Runde.

## 8. Parametertabelle

| Schlüssel (`matchRulesSchema`) | Standard | Bedeutung |
|---|---|---|
| `map` | `WENDELMARK` | feste Karte |
| `seats` | 3 | Reiche je Partie, Bots füllen auf |
| `capital.lives` | 3 | Leben der Hauptstadt |
| `capital.minDistance` | 2 | Mindestabstand zweier Hauptstädte in Feldern |
| `landGrab.picksByPlace` | 2, 1, 0 | Wahlen je Platz in der Landnahme |
| `campaign.rounds` | 4 | Feldzugrunden |
| `values.region` / `capital` / `defenseBonus` | 100 / 300 / 50 | Punktwerte |
| `timers.triviaMs` / `estimateMs` / `pickMs` / `revealMs` | 15 000 / 20 000 / 10 000 / 5 000 | Zeiten in ms |
| `timers.latencyAllowanceCapMs` | 500 | Latenzausgleich |

Nachjustieren nach dem ersten Spieltest (Entscheidung E3 im Plan).

## 9. Abnahme M1 und Messwerte

Unit-Tests je Regel (`packages/game-core/test/match.test.ts`, `packages/protocol/test/match-rules.test.ts`) und eine Simulation von 1 000 Bot-Partien (`match-simulation.test.ts`, ein Sitz verpasst 15 % der Fragen und Wahlen). Nach jedem Schritt gilt: jede Region hat höchstens einen Besitzer, im Feldzug genau einen; jedes lebende Reich hält genau eine Hauptstadt mit weniger als drei Treffern; ausgeschiedene Reiche besitzen nichts; jeder Regionswert ist Grundwert plus Befestigungen. Jede Partie endet, die Punkte ergeben die Summe aller Regionswerte, die Wiederholung mit denselben Strömen ist bitgleich.

Auswertung über 5 000 simulierte Partien (2026-11-10, mit voll ausgeschöpften Wahlzeiten und Fragen, die bis zum Ende laufen):

| Messwert | Ergebnis |
|---|---|
| Fragen je Partie | 16 bis 30, im Mittel rund 23 (Plan: 20 bis 31) |
| Dauer bei voll ausgeschöpften Timern | 11 bis 18 Minuten, im Mittel 14 bis 15 (Plan: 12 bis 18) |
| Duelle, die die Schätzfrage entscheidet | rund 40 % |
| Angreifer gewinnt ein Duell | rund 40 % |
| Partien mit Übernahme eines Reichs | 37 % bei gleich starken, 54 % bei gemischten Bots; nur rund 1 % enden vorzeitig mit einem Reich |
| Siegquote nach Bot-Stärke (gemischt) | leicht 8 %, mittel 27 %, schwer 65 % |
| Siegquote nach Sitz bei gleich starken Bots | Sitz 0: 35,7 %, Sitz 1: 33,6 %, Sitz 2: 31,1 % |

Der Vorteil von Sitz 0 kommt vor allem aus der ersten Hauptstadtwahl (Gegenprobe mit umgekehrter Wahlreihenfolge: der zuerst wählende Sitz gewinnt 38 %). Weil die Sitze gelost werden, ist das über viele Partien fair, in einer einzelnen aber spürbar; nach den ersten Spieltests prüfen (§10).

## 10. Offen

- Standardwerte bestätigen oder nachjustieren (E3, nach dem ersten Spieltest).
- Vorteil der ersten Hauptstadtwahl beobachten; mögliche Ausgleiche: Hauptstadtwahl in umgekehrter Reihenfolge der letzten Feldzugrunde, oder der letzte Hauptstadtwähler beginnt die Landnahme.
- Fragenquelle für mehr als eine Partie ohne Wiederholung (E2, Paket M5).
- Partien mit Fremden über eine Warteschlange und eine Rangliste brauchen einen erreichbaren Server ([O-11]).
