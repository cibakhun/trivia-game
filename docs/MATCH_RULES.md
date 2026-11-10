# Regelwerk der Partie

Bezug: PO-Entscheidungen vom 2026-11-10 („das Spiel soll rundenbasiert sein … erst das rundenbasierte Spiel, dann Eternal“; „wenn es runden basiert ist brauchen wir an sich keine bots“), Plan „Rundenbasierte Partie“ vom selben Tag, ADR-046 bis ADR-048. Kennzeichnung wie in [README.md](README.md#kennzeichnung-von-regeln).

Die Partie ist das rundenbasierte Hauptspiel: zwei oder drei Menschen auf einer kleinen festen Karte, alle beantworten dieselbe Frage gleichzeitig, eine Partie dauert höchstens etwa 18 Minuten (zu zweit 15). Bots gibt es nicht **[V, PO 2026-11-10, ADR-048]**. Vorbild ist nur der Ablauf des Genres (gleichzeitige Fragen, Landnahme, Feldzug) **[V, PO 2026-11-10]**; Name, Karte, Grafik, Abschnittsnamen, Punktwerte und Fragen sind eigene. Die Eternal-Welt ([GAME_RULES.md](GAME_RULES.md)) bleibt im Code und spielbar, wird aber erst weiter ausgebaut, wenn die Partie fertig ist **[V, PO 2026-11-10]**.

Code: Regeln als reine Funktionen in `packages/game-core/src/match.ts` (Zustandsmaschine) und `match-map.ts` (Karte); Regelwerte in `packages/protocol/src/match-rules.ts` (`matchRulesSchema`, `DEFAULT_MATCH_RULES`, `PLAYTEST_MATCH_RULES`, `matchRulesForSeats`). Testspieler für Tests und Simulation liegen bei den Tests (`packages/game-core/test/match-test-players.ts`), nicht im Spielcode. Alle Zahlen dieses Dokuments sind Standardwerte **[E]** aus dem Plan und lassen sich ohne Umbau ändern.

## 1. Begriffe

| Begriff | Bedeutung |
|---|---|
| Partie | ein Spiel von der Hauptstadtwahl bis zur Abrechnung |
| Sitz | einer der zwei oder drei Plätze; Sitz 0, 1 (, 2) ist zugleich die Zugreihenfolge |
| Runde n | beginnt bei Sitz (n − 1) mod Spielerzahl; so wechselt, wer zuerst angreift und wer bei völligem Gleichstand vorn liegt |
| Region | ein Feld der Karte mit Besitzer und Punktwert |
| Hauptstadt | die erste Region eines Reichs, mit drei Leben |

## 2. Karte

Eine feste, eigene Karte **Wendelmark** mit 24 Regionen in fünf Reihen (4, 5, 6, 5, 4 Felder), symmetrisch zur Mitte **[E]**. Jede Region ist ein Hexfeld; benachbart sind Regionen, deren Felder sich berühren (wie [GAME_RULES.md §2](GAME_RULES.md#2-karte-und-nachbarschaft)). Zu dritt ergeben drei Hauptstädte plus 21 Regionen bei 2 + 1 Wahlen je Landnahmerunde genau sieben Runden; zu zweit bleiben 22 Regionen, also sieben volle Runden und eine achte, in der der Erste die letzte Region bekommt.

## 3. Ablauf

1. **Aufstellung** (Server, ab M2): Wer eine Partie anlegt, bekommt einen Einladungscode mit 6 Zeichen; mit zwei oder drei Spielern startet er die Partie **[E]**. Allein startet keine Partie, Plätze füllt niemand auf **[V, ADR-048]**. Die Sitze werden gelost (`drawSeatOrder`, Strom `match`) **[E]**.
2. **Hauptstadtwahl:** Die Sitze wählen nacheinander eine freie Region mit mindestens `capital.minDistance` = 2 Feldern Abstand zu jeder gewählten Hauptstadt (ein Feld dazwischen). Die Hauptstadt ist 300 wert **[E]**.
3. **Landnahme:** Jede Runde stellt allen dieselbe Schätzfrage. Rangfolge nach Abstand, bei gleichem Abstand nach effektiver Antwortzeit, bei völligem Gleichstand nach der Reihenfolge der Runde **[E]**. Nicht beantwortet zählt als unendlicher Abstand und unendliche Zeit. Zu dritt wählt der Erste zwei freie Regionen, der Zweite eine, der Dritte keine (`landGrab.picksByPlace` = 2, 1, 0); zu zweit der Erste zwei, der Zweite eine (2, 1) **[E]**; gewählt wird nacheinander, erst beide Regionen des Ersten. Wählbar ist eine freie Region am eigenen Gebiet, gibt es keine, jede freie. Die Runden laufen, bis alle Regionen vergeben sind (auf der Wendelmark zu dritt sieben, zu zweit acht).
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
| Wahl (Hauptstadt, Region, Angriffsziel) | 10 s | der Server wählt zufällig eine wählbare Region (`autoPickRegion`), bewusst ohne Strategie, damit Abwarten keinen Vorteil bringt |
| Wissensfrage | 15 s | nicht beantwortet = falsch |
| Schätzfrage | 20 s | nicht beantwortet = unendlicher Abstand |
| Auflösung nach jeder Frage | 5 s | – |

Zeitmessung und Latenzausgleich wie [QUIZ_ENGINE.md §6.2](QUIZ_ENGINE.md) (`cap` = 500 ms). Wer die Verbindung verliert, bleibt in der Partie; verpasste Fragen und Wahlen behandelt der Server wie oben. `PLAYTEST_MATCH_RULES` verkürzt die Zeiten auf 8 s, 10 s, 5 s und 2 s, sonst gleiche Regeln.

## 6. Wertung

Punkte = Summe der Werte der eigenen Regionen (Region 100, Hauptstadt 300, je Befestigung +50) **[E]**. Rangfolge: Punkte; ein ausgeschiedenes Reich liegt hinter jedem lebenden, ein später ausgeschiedenes vor einem früher ausgeschiedenen; dann mehr Regionen, dann mehr Hauptstadtleben. Wer in allem gleich liegt, teilt sich den Platz (zu dritt 1, 1, 3; zu zweit 1, 1). Das Ergebnis geht ab M2 in die Spielerstatistik.

## 7. Zufall und Testspieler

- **Keine Bots im Spiel** **[V, PO 2026-11-10, ADR-048]**: Eine Partie spielen nur Menschen. Wer eine Frage verpasst oder nicht wählt, wird wie in §5 behandelt; niemand übernimmt seinen Platz.
- **Zufall:** neuer Zweck `match` im auditierbaren Zufall ([ARCHITECTURE.md §9](ARCHITECTURE.md)) für Sitzverteilung und Wahlen nach Zeitablauf. Die Zustandsmaschine selbst würfelt nie; Gleichstände entscheidet die Reihenfolge der Runde.
- **Testspieler (nur Tests):** Unit-Tests und Simulation spielen mit Testspielern (`match-test-players.ts`). Sie antworten über das NPC-Antwortmodell (leicht, mittel, schwer = LIGHT, MEDIUM, HEAVY aus [NPC_SYSTEM.md §2](NPC_SYSTEM.md); `generateNpcEstimate` für reine Schätzfragen) und wählen mit festen Regeln: Hauptstadt möglichst weit weg von den anderen (bis 3 Felder zählt), dann viele Nachbarn; Landnahme mit vielen eigenen, dann vielen freien Nachbarn; Angriffsziel mit dem größten unmittelbaren Gewinn (Regionswert; eine Hauptstadt mit letztem Leben bringt das ganze Reich, sonst zählt sie halb).

## 8. Parametertabelle

| Schlüssel (`matchRulesSchema`) | Standard | Bedeutung |
|---|---|---|
| `map` | `WENDELMARK` | feste Karte |
| `seats` | 3 | Spieler je Partie, 2 oder 3, nur Menschen; zu zweit über `matchRulesForSeats` |
| `capital.lives` | 3 | Leben der Hauptstadt |
| `capital.minDistance` | 2 | Mindestabstand zweier Hauptstädte in Feldern |
| `landGrab.picksByPlace` | 2, 1, 0 (zu zweit 2, 1) | Wahlen je Platz in der Landnahme; Länge = Spielerzahl |
| `campaign.rounds` | 4 | Feldzugrunden |
| `values.region` / `capital` / `defenseBonus` | 100 / 300 / 50 | Punktwerte |
| `timers.triviaMs` / `estimateMs` / `pickMs` / `revealMs` | 15 000 / 20 000 / 10 000 / 5 000 | Zeiten in ms |
| `timers.latencyAllowanceCapMs` | 500 | Latenzausgleich |

Nachjustieren nach dem ersten Spieltest (Entscheidung E3 im Plan).

## 9. Abnahme M1 und Messwerte

Unit-Tests je Regel (`packages/game-core/test/match.test.ts`, `packages/protocol/test/match-rules.test.ts`) und eine Simulation von je 1 000 Partien zu dritt und zu zweit mit Testspielern (`match-simulation.test.ts`, Sitz 0 verpasst 15 % der Fragen und Wahlen). Nach jedem Schritt gilt: jede Region hat höchstens einen Besitzer, im Feldzug genau einen; jedes lebende Reich hält genau eine Hauptstadt mit weniger als drei Treffern; ausgeschiedene Reiche besitzen nichts; jeder Regionswert ist Grundwert plus Befestigungen. Jede Partie endet, die Punkte ergeben die Summe aller Regionswerte, die Wiederholung mit denselben Strömen ist bitgleich.

Auswertung über je 5 000 simulierte Partien, Sitzvorteil über je 10 000 Partien gleich starker Testspieler ohne verpasste Fragen (2026-11-10, mit voll ausgeschöpften Wahlzeiten und Fragen, die bis zum Ende laufen):

| Messwert | zu dritt | zu zweit |
|---|---|---|
| Fragen je Partie | 16 bis 30, im Mittel rund 23 (Plan: höchstens 31) | 13 bis 24, im Mittel rund 18 (Plan: höchstens 24) |
| Dauer bei voll ausgeschöpften Timern | 11 bis 18 Minuten, im Mittel 14 bis 15 | 10 bis 15 Minuten, im Mittel rund 12 |
| Duelle, die die Schätzfrage entscheidet | rund 38 % | rund 36 % |
| Angreifer gewinnt ein Duell | rund 40 % | rund 39 % |
| Partien mit Übernahme eines Reichs | 39 % bei gleich starken, 54 % bei gemischten Testspielern; nur rund 1 % enden vorzeitig mit einem Reich | 12 % bei gleich starken, 23 % bei gemischten; jede Übernahme beendet die Partie |
| Siegquote nach Stärke (gemischt) | leicht 8 %, mittel 27 %, schwer 65 % | leicht 22 %, mittel 49 %, schwer 79 % |
| Siegquote nach Sitz bei gleich Starken | Sitz 0: 35,0 %, Sitz 1: 32,9 %, Sitz 2: 32,1 % | Sitz 0: 57,3 %, Sitz 1: 42,7 % |

Der Sitzvorteil kommt aus der ersten Hauptstadtwahl: Wer zuerst wählt, nimmt die Mitte der Karte. Gegenproben: Wählt Sitz 1 bzw. 2 zuerst, gewinnt er zu dritt 39 % und zu zweit 56 %; eine andere Angriffsreihenfolge ändert zu zweit fast nichts (56 %). Nach der Landnahme liegen zu zweit beide gleich oft vorn, der Vorsprung entsteht im Feldzug. Mit festen, spiegelbildlichen Hauptstädten (zum Beispiel links und rechts in der Mitte) gewinnt zu zweit jeder Sitz rund 50 %. Weil die Sitze gelost werden, ist das über viele Partien fair, in einer einzelnen aber spürbar, zu zweit deutlich; die Testspieler wählen nach festen Regeln, Menschen womöglich anders. Nach den ersten Spieltests entscheiden (§10).

## 10. Offen

- Standardwerte bestätigen oder nachjustieren (E3, nach dem ersten Spieltest).
- Vorteil der ersten Hauptstadtwahl (§9), zu zweit rund 57 zu 43: im Spieltest beobachten. Mögliche Ausgleiche: zu zweit feste, spiegelbildliche Hauptstädte (gemessen 50 zu 50, aber ohne eigene Wahl); Hauptstadtwahl nach einer Schätzfrage statt nach Sitz; ein Ausgleich für den später Wählenden.
- Fragenquelle für mehr als eine Partie ohne Wiederholung (E2, Paket M5).
- Partien mit Fremden über eine Warteschlange und eine Rangliste brauchen einen erreichbaren Server ([O-11]).
