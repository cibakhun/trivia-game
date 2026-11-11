# Regelwerk der Partie

Bezug: PO-Entscheidungen vom 2026-11-10 („das Spiel soll rundenbasiert sein … erst das rundenbasierte Spiel, dann Eternal“; „wenn es runden basiert ist brauchen wir an sich keine bots“; „wir brauchen aber bot spieler um zu testen“), Plan „Rundenbasierte Partie“ vom selben Tag, ADR-046 bis ADR-048; Wunsch des Product Owners vom 2026-11-11 nach der ersten Partie am Handy (freie Plätze mit Bots füllen, Karte je nach Spielerzahl, Anzeige, wer wann dran ist), ADR-052. Kennzeichnung wie in [README.md](README.md#kennzeichnung-von-regeln).

Die Partie ist das rundenbasierte Hauptspiel: zwei oder drei Spieler auf einer kleinen eigenen Karte, deren Größe sich nach der Spielerzahl richtet (§2), alle beantworten dieselbe Frage gleichzeitig, eine Partie dauert höchstens etwa 18 Minuten (zu zweit 13). Freie Plätze kann der Gastgeber mit Bots besetzen **[V, PO 2026-11-11, ADR-052]**; die Testpartie bleibt als Werkzeug **[V, PO 2026-11-10, ADR-048]**. Vorbild ist nur der Ablauf des Genres (gleichzeitige Fragen, Landnahme, Feldzug) **[V, PO 2026-11-10]**; Name, Karte, Grafik, Abschnittsnamen, Punktwerte und Fragen sind eigene. Die Eternal-Welt ([GAME_RULES.md](GAME_RULES.md)) bleibt im Code und spielbar, wird aber erst weiter ausgebaut, wenn die Partie fertig ist **[V, PO 2026-11-10]**.

Code: Regeln als reine Funktionen in `packages/game-core/src/match.ts` (Zustandsmaschine), `match-map.ts` (Karten) und `match-bots.ts` (Bots); Regelwerte in `packages/protocol/src/match-rules.ts` (`matchRulesSchema`, `DEFAULT_MATCH_RULES`, `PLAYTEST_MATCH_RULES`, `matchRulesForSeats`, `MATCH_MAP_BY_SEATS`). Alle Zahlen dieses Dokuments sind Standardwerte **[E]** aus dem Plan und lassen sich ohne Umbau ändern.

## 1. Begriffe

| Begriff | Bedeutung |
|---|---|
| Partie | ein Spiel von der Hauptstadtwahl bis zur Abrechnung |
| Sitz | einer der zwei oder drei Plätze; Sitz 0, 1 (, 2) ist zugleich die Zugreihenfolge |
| Runde n | beginnt bei Sitz (n − 1) mod Spielerzahl; so wechselt, wer zuerst angreift und wer bei völligem Gleichstand vorn liegt |
| Region | ein Feld der Karte mit Besitzer und Punktwert |
| Hauptstadt | die erste Region eines Reichs, mit drei Leben |

## 2. Karte

Die Karte richtet sich nach der Spielerzahl beim Start (`MATCH_MAP_BY_SEATS`) **[V, PO 2026-11-11; Größen E, ADR-052]**. Auf jedes Reich kommen im Schnitt acht Regionen, zu zweit wie zu dritt; wie viele ein Reich wirklich bekommt, entscheidet die Landnahme (§3):

| Spieler | Karte | Regionen | Reihen | Landnahme bei 2 + 1 Wahlen |
|---|---|---|---|---|
| 3 | **Wendelmark** | 24 | 4, 5, 6, 5, 4 | 21 freie Regionen: sieben Runden |
| 2 | **Kernmark** | 16 | 5, 6, 5 | 14 freie Regionen: vier volle Runden und eine fünfte, in der der Erste die letzten beiden bekommt |

Beide Karten sind eigene Karten und symmetrisch zur Mitte. Die Kernmark ist die Mitte der Wendelmark, ihre drei mittleren Reihen mit denselben Namen und derselben Landschaft: zwei Ringe aus je sieben Regionen um Hagelstein und Lindenhof und zwei Regionen dazwischen. Jede Region ist ein Hexfeld; benachbart sind Regionen, deren Felder sich berühren (wie [GAME_RULES.md §2](GAME_RULES.md#2-karte-und-nachbarschaft)). Eine weitere Karte ist ein Eintrag in `match-map.ts` und in `MATCH_MAP_IDS`; das Kartenbild entsteht aus dem Raster ([ART_DIRECTION.md §4](ART_DIRECTION.md#4-karte-der-partie)).

## 3. Ablauf

1. **Aufstellung** (Server, ab M2, [API.md §2.6](API.md#26-partie)): Wer eine Partie anlegt, bekommt einen Einladungscode mit 6 Zeichen und einen Einladungslink mit diesem Code (`/partie/beitreten/<Code>`). Wer den Link öffnet, tritt der Aufstellung bei: mit Konto in diesem Browser ohne weiteren Schritt, ohne Konto nach einem Tipp auf „Als Gast beitreten“ **[V, PO 2026-11-11; der eine Tipp ebenfalls V, [O-23] A]**. Der Gastgeber kann freie Plätze mit Bots besetzen (leicht, mittel, schwer; vorbelegt ist mittel), ihre Stärke ändern und sie wieder entfernen **[V, PO 2026-11-11; Einzelheiten E, ADR-052]**. Er startet die Partie mit zwei oder drei Mitspielern, Menschen und Bots zusammengezählt; allein ohne Bot startet keine **[E]**. Tritt ein Mensch bei und ist kein Platz frei, weicht ihm der Bot auf dem hintersten Platz **[E]**. Die Spielerzahl beim Start bestimmt die Karte (§2). Jedes Konto ist höchstens in einer offenen Partie; eine nicht gestartete Aufstellung verfällt nach zwei Stunden, verlässt der Gastgeber sie, fällt sie aus **[E]**. In einer **Testpartie** stehen Plätze und Bots schon beim Anlegen fest (§7). Die Sitze werden gelost (`drawSeatOrder`, Strom `match`) **[E]**.
2. **Hauptstadtwahl:** Die Sitze wählen nacheinander eine freie Region mit mindestens `capital.minDistance` = 2 Feldern Abstand zu jeder gewählten Hauptstadt (ein Feld dazwischen). Die Hauptstadt ist 300 wert **[E]**.
3. **Landnahme:** Jede Runde stellt allen dieselbe Schätzfrage. Rangfolge nach Abstand, bei gleichem Abstand nach effektiver Antwortzeit, bei völligem Gleichstand nach der Reihenfolge der Runde **[E]**. Nicht beantwortet zählt als unendlicher Abstand und unendliche Zeit. Zu dritt wählt der Erste zwei freie Regionen, der Zweite eine, der Dritte keine (`landGrab.picksByPlace` = 2, 1, 0); zu zweit der Erste zwei, der Zweite eine (2, 1) **[E]**; gewählt wird nacheinander, erst beide Regionen des Ersten. Wählbar ist eine freie Region am eigenen Gebiet, gibt es keine, jede freie. Die Runden laufen, bis alle Regionen vergeben sind (zu dritt auf der Wendelmark sieben, zu zweit auf der Kernmark fünf).
4. **Feldzug:** `campaign.rounds` = 4 Runden; in jeder greift jedes lebende Reich einmal an, in der Reihenfolge der Runde **[E]**. Der Angreifer wählt eine gegnerische Region an seinem Gebiet (gibt es keine, jede gegnerische); dann folgt das Duell (§4).
5. **Abrechnung:** Schluss nach der vierten Feldzugrunde oder sobald nur ein Reich übrig ist; Wertung nach §6.

### Zugfolge

Mit dem Spielstand schickt der Server die Zugfolge des laufenden Abschnitts (`board.turns`, berechnet von `turnOrder` in `match.ts`); der Browser zeigt sie als Zeile über der Karte, damit jeder sieht, wer wann dran ist **[V, PO 2026-11-11; Darstellung E, ADR-052]**. Jeder Eintrag nennt einen Sitz und ob er schon dran war (`DONE`), dran ist (`NOW`) oder noch kommt (`NEXT`):

| Abschnitt | Einträge |
|---|---|
| Hauptstadtwahl | alle Sitze in Zugreihenfolge |
| Schätzfrage der Landnahme | alle Sitze, alle zugleich dran |
| Wahl der Landnahme | ein Eintrag je Wahl in der Rangfolge der Schätzfrage; wer zweimal wählt, steht zweimal da |
| Feldzug | die Angreifer der Runde in ihrer Reihenfolge, auch während des Duells; ausgeschiedene Reiche entfallen |

Nach der Abrechnung ist die Liste leer.

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
| Auflösung nach jeder Frage | 6 s | – |
| Gezeigte Wahl (Ansage) | 1,2 s | – |
| Ansage eines Duells | 2,5 s | – |

Zeitmessung und Latenzausgleich wie [QUIZ_ENGINE.md §6.2](QUIZ_ENGINE.md) (`cap` = 500 ms). Jeder Sitz holt die Frage selbst ab; seine Zeit läuft ab dem Abholen (Zeitlimit + `cap`), höchstens bis die Frage schließt: Zeitlimit + `cap` + 2 s zum Abholen ab dem Öffnen **[E]**. Haben alle Menschen geantwortet, wird sofort aufgelöst, sonst 1 s nach dem Schließen, damit eine rechtzeitig eingegangene Antwort nicht an einer Sperre verloren geht **[E]** (ADR-049). Wer die Verbindung verliert, bleibt in der Partie; verpasste Fragen und Wahlen behandelt der Server wie oben. Der Browser holt eine Frage ohne Klick ab, sobald sie an den eigenen Sitz geht, und zeigt die Restzeit aus `remainingMs` (ADR-050). `PLAYTEST_MATCH_RULES` verkürzt die Zeiten auf 8 s, 10 s, 5 s und 2 s, die Ansagen auf 0,3 s und 0,6 s, sonst gleiche Regeln.

### Ansage

Damit jeder mitbekommt, was geschieht, hält die Partie nach jeder Wahl und vor jedem Duell kurz an **[V, PO 2026-11-11: die Partie war „zu hektisch“; Dauer und Einzelheiten E, ADR-053, [O-24]]**. In dieser Zeit gibt es nichts zu tun und keine Eingabe:

- **Gezeigte Wahl:** Eine gewählte Hauptstadt oder Region bleibt `timers.pickShowMs` lang stehen, bevor ein anderer Sitz wählt oder die nächste Schätzfrage kommt. Das gilt für Bots wie für Menschen und für eine Wahl des Servers nach Zeitablauf. Wählt derselbe Mensch gleich noch einmal (der Erste der Landnahme), geht es ohne Pause weiter. Ein Bot wählt weiterhin ohne Bedenkzeit, aber seine Wahlen erscheinen einzeln nacheinander.
- **Ansage eines Duells:** Hat der Angreifer sein Ziel gewählt, steht `timers.announceMs` lang fest, wer wen in welcher Region angreift. Erst danach wird die Wissensfrage geöffnet; ihre Zeit läuft nicht während der Ansage. Das Stechen folgt ohne weitere Ansage auf die Auflösung der Wissensfrage.

Die Ansage ist eine Phase des Servers (`ANNOUNCE`), kein Schritt der Regeln: Die Zustandsmaschine in game-core, die Simulationen und die Wiederholbarkeit aus den Eingaben bleiben unberührt. Alle Mitspieler sehen denselben Stand zur selben Zeit, auch nach einem Neuladen. Partien, die vor ADR-053 gestartet wurden, kennen die beiden Zeiten nicht und laufen ohne Ansage zu Ende.

## 6. Wertung

Punkte = Summe der Werte der eigenen Regionen (Region 100, Hauptstadt 300, je Befestigung +50) **[E]**. Rangfolge: Punkte; ein ausgeschiedenes Reich liegt hinter jedem lebenden, ein später ausgeschiedenes vor einem früher ausgeschiedenen; dann mehr Regionen, dann mehr Hauptstadtleben. Wer in allem gleich liegt, teilt sich den Platz (zu dritt 1, 1, 3; zu zweit 1, 1). Das Ergebnis geht ab M2 in die Spielerstatistik; Testpartien und Partien mit Bots zählen nicht (§7).

## 7. Bots und Zufall

- **Normale Partie** **[V, PO 2026-11-11; Einzelheiten E, ADR-052]**: Der Gastgeber setzt in der Aufstellung Bots auf freie Plätze (§3), sodass auch ein einzelner Mensch spielen kann. Eine Partie mit mindestens einem Bot zählt nicht in der Spielerstatistik **[E]**, sonst ließen sich Siege gegen leichte Bots sammeln; Aufstellung und Abrechnung sagen das. Bots gibt es in jeder Umgebung, auch in Produktion **[E]**. Heißen zwei Bots gleich, werden sie nummeriert („Bot 1 (mittel)“, „Bot 2 (mittel)“). Wer eine Frage verpasst oder nicht wählt, wird wie in §5 behandelt; kein Bot übernimmt seinen Platz.
- **Testpartie** **[V, PO 2026-11-10; Einzelheiten E]**: Wer sie anlegt, wählt zwei oder drei Plätze und für jeden freien Platz einen Bot (leicht, mittel, schwer); weitere Menschen können über den Einladungscode statt eines Bots beitreten. Testpartien gibt es lokal, in Tests und auf Staging; in Produktion sind sie ausgeschaltet. Sie zählen nicht in der Spielerstatistik. Seit es Bots in der normalen Partie gibt, ist die Testpartie nur noch ein Werkzeug für Tests (§10).
- **Antworten der Bots:** NPC-Antwortmodell wie im PvE, versiegelt vor der Frage (Strom `npc-answer`). Stärke leicht, mittel, schwer = Archetyp LIGHT, MEDIUM, HEAVY ([NPC_SYSTEM.md §2](NPC_SYSTEM.md)) **[E]**. Für reine Schätzfragen gibt es `generateNpcEstimate` mit derselben Ziehungsfolge.
- **Wahlen der Bots** **[E]**: Hauptstadt möglichst weit weg von den anderen (bis 3 Felder zählt), dann viele Nachbarn; Landnahme mit vielen eigenen, dann vielen freien Nachbarn; Angriffsziel mit dem größten unmittelbaren Gewinn (Regionswert; eine Hauptstadt mit letztem Leben bringt das ganze Reich, sonst zählt sie halb). Die Stärke wirkt nur auf die Antworten.
- **Zufall:** neuer Zweck `match` im auditierbaren Zufall ([ARCHITECTURE.md §9](ARCHITECTURE.md)) für Sitzverteilung, Wahlen nach Zeitablauf und Bot-Wahlen. Die Zustandsmaschine selbst würfelt nie; Gleichstände entscheidet die Reihenfolge der Runde.

## 8. Parametertabelle

| Schlüssel (`matchRulesSchema`) | Standard | Bedeutung |
|---|---|---|
| `map` | `WENDELMARK` (zu zweit `KERNMARK`) | Karte; `matchRulesForSeats` wählt sie nach der Spielerzahl (`MATCH_MAP_BY_SEATS`) |
| `seats` | 3 | Plätze je Partie, 2 oder 3; zu zweit über `matchRulesForSeats`; freie Plätze besetzt der Gastgeber mit Bots |
| `capital.lives` | 3 | Leben der Hauptstadt |
| `capital.minDistance` | 2 | Mindestabstand zweier Hauptstädte in Feldern |
| `landGrab.picksByPlace` | 2, 1, 0 (zu zweit 2, 1) | Wahlen je Platz in der Landnahme; Länge = Spielerzahl |
| `campaign.rounds` | 4 | Feldzugrunden |
| `values.region` / `capital` / `defenseBonus` | 100 / 300 / 50 | Punktwerte |
| `timers.triviaMs` / `estimateMs` / `pickMs` / `revealMs` | 15 000 / 20 000 / 10 000 / 6 000 | Zeiten in ms |
| `timers.pickShowMs` / `announceMs` | 1 200 / 2 500 | gezeigte Wahl und Ansage eines Duells in ms (§5, ADR-053); 0 oder nicht gesetzt schaltet sie ab |
| `timers.latencyAllowanceCapMs` | 500 | Latenzausgleich |

Nachjustieren nach dem ersten Spieltest (Entscheidung E3 im Plan).

## 9. Abnahme M1 und Messwerte

Unit-Tests je Regel (`packages/game-core/test/match.test.ts`, `packages/protocol/test/match-rules.test.ts`) und eine Simulation von je 1 000 Partien zu dritt (Wendelmark) und zu zweit (Kernmark) mit Bots (`match-simulation.test.ts`, Sitz 0 verpasst 15 % der Fragen und Wahlen). Nach jedem Schritt gilt: jede Region hat höchstens einen Besitzer, im Feldzug genau einen; jedes lebende Reich hält genau eine Hauptstadt mit weniger als drei Treffern; ausgeschiedene Reiche besitzen nichts; jeder Regionswert ist Grundwert plus Befestigungen. Jede Partie endet, die Punkte ergeben die Summe aller Regionswerte, die Wiederholung mit denselben Strömen ist bitgleich.

Auswertung über je 5 000 simulierte Partien, Sitzvorteil über je 10 000 Partien gleich starker Bots ohne verpasste Fragen (zu dritt 2026-11-10, zu zweit auf der Kernmark 2026-11-11; mit voll ausgeschöpften Wahlzeiten und Fragen, die bis zum Ende laufen):

| Messwert | zu dritt (Wendelmark) | zu zweit (Kernmark) |
|---|---|---|
| Fragen je Partie | 16 bis 30, im Mittel rund 23 (Plan: höchstens 31) | 10 bis 21, im Mittel rund 15 (Plan: höchstens 21) |
| Dauer bei voll ausgeschöpften Timern | 11 bis 18 Minuten, im Mittel 14 bis 15 | 7 bis 12 Minuten, im Mittel rund 10 |
| Duelle, die die Schätzfrage entscheidet | rund 38 % | rund 35 % |
| Angreifer gewinnt ein Duell | rund 40 % | rund 40 % |
| Partien mit Übernahme eines Reichs | 39 % bei gleich starken, 54 % bei gemischten Bots; nur rund 1 % enden vorzeitig mit einem Reich | 10 % bei gleich starken, 24 % bei gemischten; jede Übernahme beendet die Partie |
| Siegquote nach Stärke (gemischt) | leicht 8 %, mittel 27 %, schwer 65 % | leicht 24 %, mittel 50 %, schwer 78 % |
| Siegquote nach Sitz bei gleich Starken | Sitz 0: 35,0 %, Sitz 1: 32,9 %, Sitz 2: 32,1 % | Sitz 0: 59,8 %, Sitz 1: 38,7 %, geteilter erster Platz 1,4 % |

Die Dauern der Tabelle stammen aus der Zeit vor ADR-053. Seit die Auflösung 6 s steht und Wahlen und Duelle angesagt werden (§5), kommt je Frage 1 s, je Wahl 1,2 s und je Duell 2,5 s dazu: Die rechnerische Obergrenze steigt zu dritt von 17,9 auf 19,4 Minuten und zu zweit von 12,1 auf 13,1 Minuten (`match-simulation.test.ts` prüft sie); die Spannen und Mittelwerte sind nicht neu gemessen.

Der Sitzvorteil kommt aus der ersten Hauptstadtwahl: Wer zuerst wählt, nimmt die Mitte der Karte. Gegenproben vom 2026-11-10, zu zweit damals noch auf der Wendelmark (dort Sitz 0: 57,3 %): Wählt Sitz 1 bzw. 2 zuerst, gewinnt er zu dritt 39 % und zu zweit 56 %; eine andere Angriffsreihenfolge ändert zu zweit fast nichts (56 %). Nach der Landnahme liegen zu zweit beide gleich oft vorn, der Vorsprung entsteht im Feldzug. Mit festen, spiegelbildlichen Hauptstädten (zum Beispiel links und rechts in der Mitte) gewinnt zu zweit jeder Sitz rund 50 %. Weil die Sitze gelost werden, ist das über viele Partien fair, in einer einzelnen aber spürbar, zu zweit deutlich; die Bots wählen nach festen Regeln, Menschen womöglich anders. Nach den ersten Spieltests entscheiden (§10).

Kartengröße zu zweit (je 4 000 Partien gleich starker Bots, 2026-11-11): Der Vorteil des zuerst Wählenden hängt kaum an der Größe. Gemessen wurden Ausschnitte der Wendelmark mit 24, 20, 19, 17, 16, 14 und 13 Regionen: 57 zu 41, 63 zu 36, 64 zu 36, 66 zu 34, 60 zu 39, 62 zu 35 und 66 zu 34, bei 8, 6, 6, 5, 5, 4 und 4 Landnahmerunden. Mit zufällig gesetzten Hauptstädten gewinnt auf jeder Größe jeder Sitz etwa gleich oft (rund 50 zu 48). Die Kernmark mit 16 Regionen ist unter den kleineren Karten die ausgeglichenste, verkürzt die Landnahme von acht auf fünf Runden und lässt wie zu dritt im Schnitt acht Regionen je Reich (wie viele ein Reich wirklich bekommt, entscheidet die Landnahme).

## 10. Offen

- Standardwerte bestätigen oder nachjustieren (E3, nach dem ersten Spieltest).
- Tempo: Die Pausen (gezeigte Wahl 1,2 s, Ansage eines Duells 2,5 s, Auflösung 6 s) sind Standardannahmen **[E]**; ob sie zu kurz oder zu lang sind, entscheidet der Product Owner nach dem nächsten Spiel ([O-24]).
- Vorteil der ersten Hauptstadtwahl (§9), zu zweit auf der Kernmark rund 60 zu 39: im Spieltest beobachten. Mögliche Ausgleiche: zu zweit feste, spiegelbildliche Hauptstädte (gemessen 50 zu 50, aber ohne eigene Wahl); Hauptstadtwahl nach einer Schätzfrage statt nach Sitz; ein Ausgleich für den später Wählenden.
- Kartengröße zu zweit: 16 Regionen **[E]** (§2, §9). Alternativen: 14 Regionen (vier Landnahmerunden, noch kürzer) oder weiter die ganze Wendelmark (acht Runden).
- Partien mit Bots: Sie zählen nicht in der Statistik und es gibt sie überall **[E]** (§7). Der Product Owner entscheidet, ob das so bleibt, zum Beispiel ob Siege gegen schwere Bots zählen sollen.
- Testpartie: Seit Bots in der normalen Partie sitzen können, braucht sie kein Spieler mehr. Vorschlag: nur noch für Tests behalten und von der Seite „Partie spielen“ nehmen.
- Fragenquelle für mehr als eine Partie ohne Wiederholung (E2, Paket M5). Bis dahin wiederholt sich innerhalb einer Partie keine Frage, solange der Bestand andere hat; mit den 40 Testfragen kommen in langen Partien Wiederholungen vor.
- Laufende Partie verlassen oder aufgeben: heute nicht vorgesehen; wer geht, verpasst alle weiteren Fragen und Wahlen, die Partie läuft bis zum Ende weiter. Ob es ein Aufgeben gibt und wie es zählt, entscheidet der Product Owner nach dem Spieltest.
- Partien mit Fremden über eine Warteschlange und eine Rangliste brauchen einen erreichbaren Server ([O-11]).
