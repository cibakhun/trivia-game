# Regelwerk der Partie

Bezug: PO-Entscheidungen vom 2026-11-10 („das Spiel soll rundenbasiert sein … erst das rundenbasierte Spiel, dann Eternal“; „wenn es runden basiert ist brauchen wir an sich keine bots“; „wir brauchen aber bot spieler um zu testen“), Plan „Rundenbasierte Partie“ vom selben Tag, ADR-046 bis ADR-048; Wunsch des Product Owners vom 2026-11-11 nach der ersten Partie am Handy (freie Plätze mit Bots füllen, Karte je nach Spielerzahl, Anzeige, wer wann dran ist), ADR-052. Kennzeichnung wie in [README.md](README.md#kennzeichnung-von-regeln).

Die Partie ist das rundenbasierte Hauptspiel: zwei oder drei Spieler auf einer kleinen eigenen Karte, deren Größe sich nach der Spielerzahl richtet (§2), alle beantworten dieselbe Frage gleichzeitig, eine Partie dauert höchstens etwa 18 Minuten (zu zweit 13). Freie Plätze kann der Gastgeber mit Bots besetzen **[V, PO 2026-11-11, ADR-052]**; die Testpartie bleibt als Werkzeug **[V, PO 2026-11-10, ADR-048]**. Vorbild ist nur der Ablauf des Genres (gleichzeitige Fragen, Landnahme, Feldzug) **[V, PO 2026-11-10]**; Name, Karte, Grafik, Abschnittsnamen, Punktwerte und Fragen sind eigene. Als Nächstes bekommt die Partie einen Ausbau mit Rohstoffen, Burgen, Dörfern, Armeen und einem Glücksrad für die Kategorie des Duells; die Regeln stehen in §11, der Server spielt ihn als eigene Spielart (ADR-058), im Browser folgt er mit dem nächsten Schritt **[V, PO 2026-11-11, ADR-057]**. Die Eternal-Welt ([GAME_RULES.md](GAME_RULES.md)) bleibt im Code und spielbar, wird aber erst weiter ausgebaut, wenn die Partie fertig ist **[V, PO 2026-11-10]**.

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
5. **Abrechnung:** Schluss nach der vierten Feldzugrunde oder sobald nur ein Reich übrig ist; Wertung nach §6. Auch die Auflösung des letzten Duells steht wie jede andere; die Abrechnung kommt erst danach ([§5](#letzte-auflösung)).

### Zugfolge

Mit dem Spielstand schickt der Server die Zugfolge des laufenden Abschnitts (`board.turns`, berechnet von `turnOrder` in `match.ts`); der Browser zeigt sie als Zeile über der Karte, damit jeder sieht, wer wann dran ist **[V, PO 2026-11-11; Darstellung E, ADR-052]**. Jeder Eintrag nennt einen Sitz und ob er schon dran war (`DONE`), dran ist (`NOW`) oder noch kommt (`NEXT`):

| Abschnitt | Einträge |
|---|---|
| Hauptstadtwahl | alle Sitze in Zugreihenfolge |
| Schätzfrage der Landnahme | alle Sitze, alle zugleich dran |
| Wahl der Landnahme | ein Eintrag je Wahl in der Rangfolge der Schätzfrage; wer zweimal wählt, steht zweimal da |
| Feldzug | die Angreifer der Runde in ihrer Reihenfolge, auch während des Duells; ausgeschiedene Reiche entfallen |

Steht nach dem letzten Duell noch die Auflösung (§5), bleibt die Zeile der letzten Runde stehen, alle Einträge `DONE`, damit die Karte im entscheidenden Moment nicht springt. Nach der Abrechnung ist die Liste leer.

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
| Auflösung nach jeder Frage, auch nach der letzten | 6 s | – |
| Gezeigte Wahl (Ansage) | 1,2 s | – |
| Ansage eines Duells | 2,5 s | – |

Zeitmessung und Latenzausgleich wie [QUIZ_ENGINE.md §6.2](QUIZ_ENGINE.md) (`cap` = 500 ms). Jeder Sitz holt die Frage selbst ab; seine Zeit läuft ab dem Abholen (Zeitlimit + `cap`), höchstens bis die Frage schließt: Zeitlimit + `cap` + 2 s zum Abholen ab dem Öffnen **[E]**. Haben alle Menschen geantwortet, wird sofort aufgelöst, sonst 1 s nach dem Schließen, damit eine rechtzeitig eingegangene Antwort nicht an einer Sperre verloren geht **[E]** (ADR-049). Ist an einer Frage kein Mensch gefragt, bleibt sie offen, bis die Bedenkzeit der gefragten Bots um ist (bei 15 s Zeitlimit 3 bis 8 s, bei der Schätzfrage die Zeit ihrer Antwort), damit Zuschauer mitlesen können ([O-43], entschieden: A, ADR-065). Wer die Verbindung verliert, bleibt in der Partie; verpasste Fragen und Wahlen behandelt der Server wie oben. Der Browser holt eine Frage ohne Klick ab, sobald sie an den eigenen Sitz geht, und zeigt die Restzeit aus `remainingMs` (ADR-050). `PLAYTEST_MATCH_RULES` verkürzt die Zeiten auf 8 s, 10 s, 5 s und 2 s, die Ansagen auf 0,3 s und 0,6 s, sonst gleiche Regeln.

### Ansage

Damit jeder mitbekommt, was geschieht, hält die Partie nach jeder Wahl und vor jedem Duell kurz an **[V, PO 2026-11-11: die Partie war „zu hektisch“; Dauer und Einzelheiten E, ADR-053, [O-24]]**. In dieser Zeit gibt es nichts zu tun und keine Eingabe:

- **Gezeigte Wahl:** Eine gewählte Hauptstadt oder Region bleibt `timers.pickShowMs` lang stehen, bevor ein anderer Sitz wählt oder die nächste Schätzfrage kommt. Das gilt für Bots wie für Menschen und für eine Wahl des Servers nach Zeitablauf. Wählt derselbe Mensch gleich noch einmal (der Erste der Landnahme), geht es ohne Pause weiter. Ein Bot wählt weiterhin ohne Bedenkzeit, aber seine Wahlen erscheinen einzeln nacheinander.
- **Ansage eines Duells:** Hat der Angreifer sein Ziel gewählt, steht `timers.announceMs` lang fest, wer wen in welcher Region angreift. Erst danach wird die Wissensfrage geöffnet; ihre Zeit läuft nicht während der Ansage. Das Stechen folgt ohne weitere Ansage auf die Auflösung der Wissensfrage.

Die Ansage ist eine Phase des Servers (`ANNOUNCE`), kein Schritt der Regeln: Die Zustandsmaschine in game-core, die Simulationen und die Wiederholbarkeit aus den Eingaben bleiben unberührt. Alle Mitspieler sehen denselben Stand zur selben Zeit, auch nach einem Neuladen. Partien, die vor ADR-053 gestartet wurden, kennen die beiden Zeiten nicht und laufen ohne Ansage zu Ende.

### Letzte Auflösung

Das Duell, das die Partie entscheidet, ist ihr Höhepunkt. Seine Auflösung steht deshalb `timers.revealMs` lang wie jede andere, mit den Antworten und danach dem Ausgang auf der Karte (ADR-069); erst danach erscheint die Abrechnung **[V, PO 2026-11-11; Dauer E, ADR-055, [O-24]]**. Bis ADR-055 endete die Partie im selben Augenblick, in dem die letzte Frage aufgelöst war: Niemand sah, wie das letzte Duell ausging und wer was geantwortet hatte.

In dieser Zeit ist die Partie entschieden, aber noch nicht abgerechnet: Die Zustandsmaschine steht schon im Schritt `FINISHED` (er merkt sich die Feldzugrunde, in der Schluss war), `MATCH_FINISHED` mit dem Endstand ist das jüngste Ereignis, der Status der Partie bleibt `RUNNING`. Zu wählen oder zu beantworten gibt es nichts mehr. Mit dem Ende der Auflösung wechselt der Status auf `FINISHED`, und die Partie zählt in der Statistik (§7). Eine Partie dauert dadurch 6 s länger.

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
- Fragenquelle für mehr als eine Partie ohne Wiederholung (E2, Paket M5). Quelle entschieden (PO 2026-11-11): Wikidata-Fakten mit eigener Formulierung (ADR-056); spielbar werden die Entwürfe erst nach der Prüfung. Bis dahin wiederholt sich innerhalb einer Partie keine Frage, solange der Bestand andere hat; mit den 40 Testfragen kommen in langen Partien Wiederholungen vor.
- Laufende Partie verlassen oder aufgeben: heute nicht vorgesehen; wer geht, verpasst alle weiteren Fragen und Wahlen, die Partie läuft bis zum Ende weiter. Ob es ein Aufgeben gibt und wie es zählt, entscheidet der Product Owner nach dem Spieltest.
- Partien mit Fremden über eine Warteschlange und eine Rangliste brauchen einen erreichbaren Server ([O-11]).

## 11. Ausbau: Burgen, Dörfer, Armeen

Bezug: Wunsch des Product Owners vom 2026-11-11, die Partie mit einem Aufbau-Minispiel zu verbinden (Rohstoffe aus dem Gebiet, Gebäude mit mehr Leben, Armeen, die die Kategorien im Duell verschieben, 10 bis 15 Minuten je Partie), seine zwei handschriftlichen Zettel vom selben Tag und das daraus erarbeitete Spielkonzept, das er am 2026-11-11 mit allen Empfehlungen freigegeben hat ([O-25] bis [O-35], ADR-057). Vorbild sind nur allgemeine Mechaniken; Namen, Begriffe und Bilder sind eigene **[V, PO 2026-11-11]**.

**Stand:** Regeln, Bots und Simulation stehen im Spielkern, der Server spielt ganze Partien mit Ausbau (ADR-058, §11.11), und der Browser zeigt und bedient sie auf derselben Bühne im Querformat wie die Partie aus §1 bis §10 (ADR-060, [ART_DIRECTION.md §4](ART_DIRECTION.md#4-karte-der-partie)). Eine Partie spielt den Ausbau, wenn sie in der Spielart `REALM` angelegt wurde; ihre Regeln haben dann den Abschnitt `economy` (`DEFAULT_REALM_RULES`). Ohne ihn gilt alles wie bisher. In Produktion ist die Spielart gesperrt, bis der Spieltest sie freigibt **[E]**. Seit ADR-062 (Rückmeldung des Product Owners nach dem ersten Spieltest am 2026-11-12) endet die Landnahme nach zwei Runden; die übrigen Felder bleiben frei und werden im Feldzug mit einer Wissensfrage genommen ([O-37], Auswahl A), und Dorf und Stadt bringen mehr Ertrag ([O-41], offen). Seit ADR-064 (Rückmeldung des Product Owners vom 2026-11-12: „man kann immer noch überall angreifen nicht nur da wo man armeen hat“) ist ein Angriffsziel nur, was neben einer eigenen Armee liegt; wer keines hat, setzt in der Runde aus (§11.4, [O-42], Auswahl A).

Code: `packages/game-core/src/realm.ts` (Zustandsmaschine `createRealm`, `applyRealmInput`), `realm-state.ts` (Zustand und Abfragen), `realm-orders.ts` (Rüstzeit), `realm-wheel.ts` (Glücksrad), `realm-resources.ts` (Rohstoff je Region), `realm-bots.ts` (Bots); Regelwerte in `packages/protocol/src/match-rules.ts` (`matchEconomySchema`, `DEFAULT_MATCH_ECONOMY`, `DEFAULT_REALM_RULES`, `PLAYTEST_REALM_RULES`). Die bisherige Zustandsmaschine `match.ts` bleibt unverändert. Die Regeln der Rüstzeit (`planRealmOrders`) und der Lose (`realmWheelOn`) brauchen nur einen Ausschnitt des Bretts: Der Server prüft damit seinen Zustand (`checkRealmOrders`, `realmWheel`), der Browser plant damit auf seiner Ansicht (`apps/web/src/match/realm-model.ts`), ohne die Regeln zu wiederholen. Wie dort liegen Zeit und Zufall beim Aufrufer: Die Zustandsmaschine würfelt nie, auch das Glücksrad dreht der Aufrufer (`spinRealmWheel`, Strom `match`) und meldet die Kategorie als Eingabe.

### 11.1 Ablauf

1. **Aufstellung:** Jeder hat vier Lieblingskategorien (`economy.favorites`) **[V, Zettel]**. Bots wählen zufällig (`chooseRealmFavoritesForBot`). Menschen wählen in der Aufstellung; das Konto merkt sich die Wahl für die nächste Partie, und wer beim Start keine gültige Wahl hat, bekommt vier zufällige (§11.11) **[E]**.
2. **Startfrage** (`START_ESTIMATE`): eine Schätzfrage an alle; ihre Rangfolge ist die Reihenfolge der Partie (`order`): Abstand, dann effektive Antwortzeit, bei völligem Gleichstand die geloste Sitznummer **[V, Zettel; Gleichstand E]**. Sie ersetzt die geloste Reihenfolge der Sitze für Burgen, Dörfer und Runden.
3. **Burgen setzen** (`CASTLE_PICK`): in der Reihenfolge der Startfrage je eine Burg auf ein freies Feld, mindestens `capital.minDistance` = 2 Felder von jeder anderen Burg. Die Startburg ist 300 wert wie die Hauptstadt und beginnt mit `economy.startArmies` = 3 Armeen **[V, [O-26]]**.
4. **Dörfer setzen** (`VILLAGE_PICK`): in umgekehrter Reihenfolge je ein Dorf auf ein weiteres freies Feld, mindestens `economy.villageMinDistance` = 2 Felder von fremden Gebäuden **[V, Zettel]**. Wer bei der Burg zuletzt wählen durfte, setzt das Dorf zuerst. Gibt es für Burg oder Dorf keinen Platz mit Abstand, ist jedes freie Feld wählbar.
5. **Landnahme** wie §3 **[V, [O-30]]**, aber nur `economy.landGrabRounds` = 2 Runden **[V, PO 2026-11-12: „nur für 2 Runden, damit es noch genug neutrale Felder gibt“]**; wählbar ist ein freies Feld am eigenen Land, also auch an Burg und Dorf. Nach Burgen und Startdörfern sind zu dritt 18 Felder frei, zu zweit 12; jede Runde vergibt drei. Zu Beginn des Feldzugs sind damit zu dritt 12 von 24 Feldern frei, zu zweit 6 von 16, und ein Reich hält im Mittel 4 Felder (zu zweit 5). Fehlt `landGrabRounds` in den Regeln einer Partie (vor ADR-062 angelegt), läuft die Landnahme wie bisher, bis alles vergeben ist.
6. **Feldzug**, `campaign.rounds` = 5 Runden **[V, [O-31]]**. Jede Runde: **Einkommen** (§11.2) → **Rüstzeit** (§11.4) → **Aufdecken** → **Angriffe**: jedes lebende Reich einmal, in der Reihenfolge der Runde (§1); nur in der letzten Runde greift zuerst an, wer nach Punkten vorn liegt, wer hinten liegt, zuletzt, bei gleichen Punkten in der Reihenfolge der Runde (`realmAttackOrder`) **[V, [O-35]]**. Die Reihenfolge der Angreifer steht zu Beginn der Angriffe fest. Ein Angriff: Ziel wählen (ein gegnerisches oder freies Feld am eigenen Land, neben dem eine eigene Armee steht, §11.4 „Angriff nur mit Armee“; wer kein solches Ziel hat, setzt in dieser Runde aus), Glücksrad (§11.5), Wissensfrage, bei Gleichstand die Schätzfrage, Auflösung (§11.7). Ein freies Feld greift man wie ein gegnerisches mit dem Angriff der Runde an; die Wissensfrage beantwortet der Angreifer dann allein, eine Schätzfrage gibt es nicht (§11.7) **[V, [O-37] A]**.
7. **Abrechnung** nach der fünften Runde oder sobald nur noch ein Reich lebt (§11.7).

Zeiten: Wahl, Fragen, Auflösung und gezeigte Wahl wie §5. Die Ansage eines Duells dauert hier `economy.timers.wheelMs` = 3 s statt `announceMs`, weil sich in ihr das Glücksrad dreht. Die Rüstzeit dauert höchstens `economy.timers.prepareMs` = 40 s, das Aufdecken `economy.timers.ordersRevealMs` = 2 s **[V, [O-32]; Längen E]**. Die Abfrage `realmStepTimeLimitMs` liefert das Zeitlimit jedes Schritts, `realmTurnOrder` die Zugfolge für die Anzeige wie §3.

### 11.2 Rohstoffe

Zwei Rohstoffe, **Brot** und **Baustoff** **[V, [O-25], [O-33]]**. Jedes Feld liefert genau einen, und man sieht ihn an der Landschaft der Karte: Felder, Wiesen, Flüsse, Seen und Dörfer geben Brot, Wälder, Kiefern, Berge, Hügel und Moore Baustoff. Die Wendelmark hat 11 Brot- und 13 Baustofffelder, die Kernmark 9 und 7 (`realm-resources.ts`; ein Test in `apps/web/test/realm-resources.test.ts` hält Regeln und Kartenbild deckungsgleich). Welche Frage gestellt wird, hat mit dem Rohstoff nichts zu tun.

Zu Beginn jeder Feldzugrunde bekommt jedes lebende Reich das Einkommen aller eigenen Felder (`realmIncome`, Ereignis `INCOME`) **[E]**:

| Feld | Ertrag je Runde |
|---|---|
| ohne Gebäude | 1 seines Rohstoffs |
| mit Dorf | 3 seines Rohstoffs |
| mit Stadt | 4 seines Rohstoffs |
| mit Burg | 2 Brot und 2 Baustoff, gleich welche Landschaft |

Ein freies Feld bringt niemandem etwas. Bis ADR-062 brachten Dorf und Stadt 2 und 3: Ein Dorf kostet 4 Rohstoffe und trug sie mit 1 mehr je Runde in fünf Runden kaum wieder ein, und mit zwei Runden Landnahme beginnt jedes Reich mit halb so vielen Feldern. Mit 3 und 4 hat sich ein Dorf nach zwei Runden bezahlt. Die Zahlen gelten als Standardannahme, bis der Product Owner entscheidet ([O-41], Messwerte in §11.9). Vorräte bleiben für spätere Runden. In der Rüstzeit gibt es für `economy.tradeRate` = 3 eines Rohstoffs 1 vom anderen **[E]**.

### 11.3 Gebäude

| Stufe | Kosten **[E]** | Siege bis zur Eroberung | Lose des Verteidigers im Rad |
|---|---|---|---|
| Feld ohne Gebäude | – | 1 | 0 |
| Dorf | 1 Brot + 3 Baustoff | 2 | 2 |
| Stadt (Ausbau eines Dorfs) | 2 Brot + 6 Baustoff | 3 | 3 |
| Burg (Ausbau einer Stadt) | 8 Brot + 16 Baustoff | 3 Leben, dann nur das Feld (zweite Burg) oder das ganze Reich (letzte Burg) | 4 |

- Gebaut wird in der Rüstzeit auf jedem eigenen Feld, auch hinter der Grenze; je Feld höchstens eine Stufe je Runde (vom Startdorf zur zweiten Burg also mindestens zwei Runden) **[E]**.
- Höchstens `economy.maxCastles` = 2 Burgen je Reich, die Startburg mitgezählt **[V, [O-29]]**. Wird eine Burg zerstört, darf das Reich wieder eine bauen.
- Eine gebaute Burg hat 3 Leben wie die Startburg und ist 100 wert wie jedes Feld; nur die Startburg zählt 300. Gebäude bringen keine Punkte **[V, [O-28]]**.
- Verlorene Stufen lassen sich neu bauen.

### 11.4 Armeen und Rüstzeit

**Armeen** **[V, [O-26]; Zahlen E]**: eine einzige Art. Eine Armee kostet 2 Brot und entsteht in einer eigenen Burg; auf einem Feld stehen höchstens `economy.armyCap` = 6. Sie kämpft nicht selbst, sondern bringt Lose ins Glücksrad: Sie zählt bei jedem Duell um ihr eigenes Feld und um jedes Nachbarfeld, für Angreifer wie Verteidiger (`armiesInRange`). Wer ein Duell verliert, verliert eine beteiligte Armee: der Verteidiger zuerst eine vom angegriffenen Feld, sonst (wie der Angreifer) eine vom eigenen Nachbarfeld mit den meisten Armeen, bei Gleichstand vom Feld mit der kleineren ID; hat er keine in Reichweite, verliert er keine. Wird ein Feld erobert, sind die Armeen darauf verloren; fällt ein Reich, lösen sich seine Armeen auf.

**Angriff nur mit Armee** (`economy.attackNeedsArmy`, ADR-064) **[V, PO 2026-11-12: „man kann immer noch überall angreifen nicht nur da wo man armeen hat“; Ausprägung `ALWAYS` gewählt am 2026-11-13, [O-42]]**: Ein Feld ist nur dann ein Angriffsziel, wenn es ans eigene Land grenzt und auf einem eigenen Nachbarfeld des Ziels mindestens eine eigene Armee steht (`realmTargetsOf`, dieselbe Reichweite wie die Lose im Glücksrad: `armiesInRange` > 0). Der Wert `ALWAYS` (Vorgabe) verlangt das für jedes Ziel, `RIVALS` nur für Felder anderer Reiche; freie Felder genügen dann wie bisher an der Grenze. Fehlt der Wert (Partien, die vor ADR-064 gestartet wurden), gilt die alte Regel: Die Grenze genügt, und grenzt kein Ziel ans eigene Land, ist jedes gegnerische Feld wählbar. Es zählt der Stand in dem Augenblick, in dem das Reich an der Reihe ist: Armeen, die in dieser Rüstzeit gezogen sind, zählen schon; neu gekaufte stehen in der Burg und zählen dort. Hat ein Reich kein Ziel, fällt sein Angriff in dieser Runde aus (Ereignis `ATTACK_SKIPPED` mit Runde und Sitz), und der Nächste der Runde ist dran; das kann gleich nach dem Aufdecken geschehen oder mitten in der Runde, wenn ein Duell davor die letzte Armee an der Grenze gekostet hat. Fallen alle Angriffe einer Runde aus, folgt auf das Aufdecken das Einkommen der nächsten Runde, nach der letzten Runde die Abrechnung. Verteidigen kann ein Reich immer, auch ohne Armee. Die Startburg hat 3 Armeen und grenzt fast immer an fremdes oder freies Land: In der ersten Runde hat deshalb praktisch jedes Reich ein Ziel; wer sein Land ausdehnt, muss Armeen nachziehen (ein Feld je Runde) oder an der Grenze eine zweite Burg bauen.

**Rüstzeit** (`PREPARE`) **[V, [O-32]]**: alle lebenden Reiche gleichzeitig und verdeckt. Jeder Sitz gibt seine Befehle als Liste ab (`SUBMIT_ORDERS`) und kann sie bis zum Ende ersetzen; sobald alle abgegeben haben, geht es weiter, sonst schließt der Aufrufer die Rüstzeit nach Ablauf (`CLOSE_PREPARE`), und wer nichts abgegeben hat, tut in dieser Runde nichts. Die Befehle werden in der abgegebenen Reihenfolge ausgeführt, höchstens 200 je Runde (`checkRealmOrders`):

| Befehl | Wirkung | Abgelehnt mit |
|---|---|---|
| `BUILD` Feld | nächste Stufe auf einem eigenen Feld | `NOT_OWN_REGION`, `ALREADY_BUILT` (diese Runde schon ausgebaut), `MAX_LEVEL`, `CASTLE_LIMIT`, `TOO_EXPENSIVE` |
| `RECRUIT` Burg, Anzahl | neue Armeen in einer eigenen Burg | `NOT_OWN_REGION`, `NOT_A_CASTLE`, `TOO_EXPENSIVE` |
| `MOVE` von, nach, Anzahl | Armeen ein Feld weit auf ein benachbartes eigenes Feld | `NOT_OWN_REGION`, `NOT_NEIGHBORS`, `NOT_ENOUGH_ARMIES` |
| `TRADE` Rohstoff, Anzahl | gibt das Dreifache des einen, bekommt die Anzahl des anderen | `TOO_EXPENSIVE` |

Ziehen dürfen nur Armeen, die zu Beginn der Runde auf dem Feld standen; jede höchstens ein Feld weit, neu gekaufte erst in der nächsten Runde. Die Grenze von 6 Armeen je Feld gilt nach allen Befehlen. Ungültige Befehle lehnt die Zustandsmaschine mit `INVALID_ORDERS`, dem Fehler und der Stelle in der Liste ab; dann bleibt die vorige Abgabe stehen. Innerhalb der Liste eines Sitzes wirkt jeder Befehl auf die folgenden: Wer erst Brot tauscht, kann danach mit dem Baustoff bauen, und eine neue Stufe zählt im selben Zug schon als gebaut. Zwischen den Sitzen gibt es keine Abhängigkeit: Jede Liste wird gegen den Stand vom Beginn der Rüstzeit geprüft und betrifft nur eigene Felder und eigene Vorräte, deshalb ist gleich, in welcher Reihenfolge die Reiche aufgedeckt werden.

**Aufdecken:** Alle Befehle werden in der Reihenfolge der Runde ausgeführt und je Reich als Ereignis `ORDERS_REVEALED` mit Befehlen, Zusammenfassung (gebaut, gekauft, gezogen, getauscht) und neuem Vorrat gemeldet. Erst dann sehen die anderen, was sich geändert hat.

### 11.5 Glücksrad

Vor der Wissensfrage jedes Duells bestimmt ein Glücksrad ihre Kategorie (`realmWheel`, Ereignisse `TARGET_CHOSEN` mit dem Rad, `WHEEL_SPUN` mit der Kategorie) **[V, Zettel, [O-27]; Lose E]**. Jede Seite bringt Lose mit:

- **Angreifer:** 1 Los je eigene Armee in Reichweite des angegriffenen Felds.
- **Verteidiger:** 1 Los je eigene Armee in Reichweite, dazu das Gebäude auf dem Feld (`economy.lots`: Dorf 2, Stadt 3, Burg 4).
- **Frei:** `economy.lots.free` = 2 Lose.
- **Angriff auf ein freies Feld:** Der Angreifer bringt seine Lose wie sonst mit, einen Verteidiger gibt es nicht (`defenderLots` = 0); dazu kommen die freien Lose. Mit 3 Armeen in Reichweite kommt die Frage zu 60 % aus den Lieblingskategorien des Angreifers und zu 40 % frei.

Die Lose einer Seite verteilen sich gleich auf ihre Lieblingskategorien, die freien auf alle Kategorien des Rads. Lieblingskategorien, die nicht auf dem Rad stehen, zählen nicht; hat eine Seite keine auf dem Rad, werden ihre Lose frei. Gibt es gar keine Lose, sind alle Kategorien gleich wahrscheinlich. Die Gewichte sind ganze Zahlen (ein Los = Kategorien · Lieblingskategorien des Angreifers · Lieblingskategorien des Verteidigers Teile, gekürzt), damit Server und Browser ohne Rundung dasselbe Rad zeigen. Beispiel: Der Angreifer hat 3 Armeen an der Grenze, der Verteidiger ein Dorf und eine Armee: Die Frage kommt zu 37,5 % aus den Lieblingskategorien des Angreifers, zu 37,5 % aus denen des Verteidigers und zu 25 % frei. Die Schätzfrage im Stechen, die Startfrage und die Fragen der Landnahme haben keine Kategorie vom Rad.

### 11.6 Kategorien und Fragen

Auf dem Rad stehen nur Kategorien mit genug Wissensfragen (`categories` beim Anlegen); nur sie lassen sich als Lieblingskategorien wählen. Bedarf **[E]**: mindestens 20 Fragen je Kategorie, für den ersten Spieltest 10 (`REALM_MIN_CATEGORY_QUESTIONS`; lokal und im Test 1, weil die Testfragen nur wenige sind). Heute hat jede Kategorie 1 bis 3. Stehen weniger als vier Kategorien auf dem Rad, startet die Partie nicht.

Keine Wissensfrage kommt in einer Partie zweimal, solange es ungestellte gibt. Deshalb zieht das Rad nur aus Kategorien, die noch eine ungestellte Frage haben: Die Teile der übrigen fallen aus der Ziehung, und das Ereignis nennt sie (`WHEEL_SPUN.exhausted`), damit der Browser sie aus dem Rad nehmen kann. Hat keine Kategorie des Rads mehr eine ungestellte Frage, gilt das ganze Rad, und die Frage kommt aus dem übrigen Bestand; erst wenn es gar keine ungestellte mehr gibt, wiederholt sich eine **[E]**. Mit 20 Fragen je Kategorie kommt das nicht vor (höchstens 15 Duelle je Partie). Neue Fragen hängen an der Fragenbeschaffung (E2, Paket M5).

### 11.7 Duell, Folgen und Wertung

Das Duell selbst ist §4: Wissensfrage, bei zwei richtigen Antworten die Schätzfrage. **Folgen** **[V, Zettel; Einzelheiten E]** (Ereignis `DUEL_RESOLVED`):

| Ziel | Angreifer gewinnt | Verteidiger gewinnt |
|---|---|---|
| freies Feld (kein Verteidiger) | Der Angreifer beantwortet die Wissensfrage richtig: Das Feld gehört ihm mit seinem Wert, ohne Gebäude und ohne Armeen (`CLAIMED`) | Falsch oder nicht beantwortet: Das Feld bleibt frei, niemand verliert etwas (`UNCLAIMED`, Sieger `NONE`) |
| Feld ohne Gebäude | erobert mit seinem Wert, die Armeen darauf sind verloren (`CONQUERED`) | befestigt, +50 (`FORTIFIED`) |
| Dorf, Stadt | fällt eine Stufe zurück, das Feld bleibt beim Verteidiger (`BUILDING_DAMAGED`) | befestigt, +50 |
| Burg mit mehr als einem Leben | verliert ein Leben (`CASTLE_HIT`), Leben kehren nicht zurück | befestigt, +50 |
| Burg mit letztem Leben, das Reich hat noch eine | zerstört: Das Feld geht ohne Gebäude und ohne Armeen an den Angreifer und behält seinen Wert (`CASTLE_DESTROYED`) | befestigt, +50 |
| letzte Burg mit letztem Leben | Das ganze Reich geht an den Angreifer, mit allen Gebäuden und Vorräten; seine Armeen lösen sich auf, es scheidet aus (`TAKEOVER`, Ereignis `KINGDOM_ELIMINATED`) | befestigt, +50 |

Dazu verliert der Verlierer eine Armee (§11.4). **Freies Feld** **[V, [O-37] A; Einzelheiten E]**: Der Angriff ist der Angriff der Runde und zählt als Duell der Partie (Glücksrad, Kategorie, Bot-Zuschlag wie sonst). Gefragt wird nur der Angreifer; es gibt keine Schätzfrage, keine Befestigung und keinen Armeeverlust, auch nicht bei falscher Antwort. Ein genommenes Feld ist danach ein Feld wie jedes andere: Es bringt ab der nächsten Runde Ertrag, lässt sich bebauen und angreifen. Was am Ende frei ist, zählt für niemanden. **Wertung** wie §6, nur aus Land: jedes Feld 100, die Startburg 300, jede gehaltene Verteidigung +50; Vorräte, Gebäude und Armeen zählen nicht **[V, [O-28]]**. Rangfolge: Punkte; ein gefallenes Reich hinter jedem lebenden, ein später gefallenes vor einem früher gefallenen; dann mehr Felder, dann mehr Burgleben; sonst geteilter Platz (`realmStandings`). Die Partie endet sofort, wenn nur noch ein Reich lebt (`LAST_KINGDOM`), sonst nach der letzten Runde (`ROUNDS_COMPLETE`).

### 11.8 Bots

Wie §7 antworten Bots über das NPC-Modell ihrer Stärke; bei einer Wissensfrage aus ihren Lieblingskategorien eine Stufe besser (`REALM_FAVORITE_THETA_BONUS` = 0,7, ein mittlerer Bot trifft eine mittelschwere Frage dort zu rund 75 % statt 60 %) **[E]**. Die Schätzfrage im Stechen hat keine Kategorie vom Rad und bekommt den Zuschlag nicht; beide Antworten eines Duells stehen wie im PvE vorab fest (`generateRealmBotAnswer`, Ziehungsfolge wie `generateNpcAnswer`). Ihre Regeln (`realm-bots.ts`) **[E]**:

- **Wahlen:** Burg möglichst weit weg von den anderen Burgen (bis 3 Felder zählt), dann viele Nachbarn; Dorf etwa zwei Felder von der eigenen Burg, dann viele freie Nachbarn; Landnahme wie §7; Angriffsziel mit dem größten erwarteten Gewinn: Siegchance aus dem Glücksrad mal Punkte je nötigem Sieg (eine Burg mit letztem Leben bringt als letzte das ganze Reich). Bei einem freien Feld ist die Siegchance die eigene Trefferquote in der gezogenen Kategorie und der Gewinn der Wert des Felds; was einem Gegner abgenommen wird, zählt 1,6-fach (`REALM_RIVAL_GAIN_WEIGHT`), weil es dem Gegner zugleich fehlt. Gemessen gehen so gut die Hälfte der Angriffe auf freie Felder. Gewählt wird nur unter den erlaubten Zielen (`realmTargetsOf`), also neben einer eigenen Armee (ADR-064).
- **Rüstzeit:** erst Armeen hinter der Grenze ein Feld Richtung Grenze (grenzt das Reich an keinen Gegner, zählt der Rand zum freien Land); das hält die Bots auch unter ADR-064 fast immer angriffsfähig, ohne dass ihre Regeln geändert wurden (§11.9); dann ein Ausbau je Runde, die höchste erreichbare Stufe (Burg vor Stadt vor Dorf) auf dem Feld mit den wenigsten gegnerischen Nachbarn, wenn nötig nach einem Tausch; mit dem übrigen Brot Armeen in der Burg mit den wenigsten.

Gleichstände entscheidet der Strom `match`. Die Stärke wirkt nur auf die Antworten.

### 11.9 Simulation und Messwerte

Unit-Tests je Regel (`packages/game-core/test/realm.test.ts`, `packages/protocol/test/match-rules.test.ts`) und eine Simulation von je 1 000 Partien zu dritt (Wendelmark) und zu zweit (Kernmark) mit Bots gemischter Stärke, Sitz 0 verpasst 15 % der Schätzfragen, Wahlen, Rüstzeiten und Duelle, ein verpasstes Duell mit beiden Fragen wie in `match-simulation.test.ts` (`realm-simulation.test.ts`, Partien aus `realm-sim.ts`); dazu 200 Partien zu dritt nach den Regeln vor ADR-062 (ohne `landGrabRounds` und ohne `attackNeedsArmy`), damit gespeicherte Partien spielbar bleiben. Nach jedem Schritt gilt: Besitzer gültig; ein freies Feld hat weder Gebäude noch Armeen noch Befestigung; Armeen zwischen 0 und 6 und nur auf besetzten Feldern; Vorräte nie negativ; höchstens zwei Burgen je Reich, jedes lebende Reich hat ab der Landnahme mindestens eine; gefallene Reiche besitzen nichts und haben keine Vorräte; jeder Regionswert ist Grundwert plus Befestigungen; jedes Angriffsziel liegt in Reichweite einer Armee des Angreifers (ADR-064), und je Runde ergeben Duelle und ausgefallene Angriffe zusammen die Zahl der lebenden Reiche (ohne den Regelwert fällt keiner aus). Jede Partie endet; die Landnahme vergibt genau sechs Felder, und am Ende ist frei, was danach niemand genommen hat; die Punkte ergeben die Summe der Werte aller vergebenen Felder; die Wiederholung mit denselben Strömen ist bitgleich, stärkere Bots gewinnen öfter. Bänder für die Spielbalance aus je 400 Partien gleich starker Bots: zweite Burg bei 30 bis 80 % der Spieler, ein Reich fällt in weniger als 5 % der Partien, der Angreifer gewinnt 35 bis 55 % der Duelle gegen ein Reich, 33 bis 75 % der Angriffe gehen auf freie Felder und 60 bis 85 % davon gelingen, im Mittel bleibt mehr als ein Feld frei, weniger als 2 % der Angriffe fallen aus, typische Dauer im Mittel höchstens 12 Minuten (zu zweit 9,5), zu zweit gewinnt der Erste der Startfrage seltener als 60 %.

Rechnerische Obergrenze, wenn jede Zeit ganz ausläuft und jedes Duell bis zur Schätzfrage geht: zu dritt 22,0 Minuten und 33 Fragen, zu zweit 16,7 Minuten und 23 Fragen (der Test prüft sie). Messwerte über je 2 000 Partien gleich starker mittlerer Bots ohne verpasste Fragen (2026-11-12, mit der Regel aus ADR-064 neu erhoben, `corepack pnpm exec tsx packages/game-core/test/realm-measure.ts 2000`; „typisch“ mit den Annahmen Wahl 5 s, Wissensfrage 8 s, Schätzfrage 11 s, Rüstzeit 25 s, die Pausen voll). Daneben die Werte der Regeln vor ADR-062 (Landnahme, bis alles vergeben ist; Dorf 2, Stadt 3), neu gemessen mit demselben Werkzeug:

| Messwert | zu dritt (Wendelmark) | zu zweit (Kernmark) | vor ADR-062, zu dritt / zu zweit |
|---|---|---|---|
| Felder je Reich zu Beginn des Feldzugs, Mittel (kleinstes bis größtes) | 4,0 (2,8 bis 5,2) | 5,0 (4,5 bis 5,5) | 8,0 / 8,0 |
| Fragen je Partie | 21,3 | 15,4 | 29,7 / 20,1 |
| Angriffe auf freie Felder, davon genommen | 8,4, davon 72 % | 5,2, davon 72 % | – |
| freie Felder am Ende | 6,0 von 24 | 2,3 von 16 | 0 |
| Duelle gegen ein Reich, davon Eroberungen | 6,6, davon 2,8 | 4,8, davon 1,8 | 15,0, davon 6,4 / 10,0, davon 4,2 |
| ausgefallene Angriffe je Partie, weil keine Armee neben einem Ziel stand (ADR-064); Partien mit mindestens einem | 0,07 von 15; 5,3 % | 0,03 von 10; 2,4 % | – |
| Angreifer gewinnt ein Duell gegen ein Reich | 44 % | 44 % | 44 % / 44 % |
| Duelle, die die Schätzfrage entscheidet | 51 % | 51 % | 51 % / 51 % |
| Frage aus Lieblingskategorien Angreifer / Verteidiger / frei (Duelle gegen ein Reich) | 42 / 38 / 20 % | 40 / 42 / 18 % | 39 / 28 / 33 % und 34 / 40 / 26 % |
| Einkommen je Reich nach Runde (Brot + Baustoff) | 9,0 / 10,9 / 12,9 / 14,3 / 16,3 | 10,0 / 12,1 / 14,1 / 15,4 / 17,5 | 12 / 13 / 14 / 15 / 16 |
| Einkommen je Runde und Reich im Mittel, Brot / Baustoff | 6,1 / 6,6 | 6,7 / 7,1 | 6,7 / 7,3 und 7,5 / 6,5 |
| je Spieler gebaut: Dörfer / Städte | 1,9 / 2,4 | 2,0 / 2,4 | 2,0 / 2,4 und 2,0 / 2,6 |
| Spieler, die eine zweite Burg bauen | 40 % | 64 % | 60 % / 40 % |
| Armeen gekauft je Spieler | 8,1 | 9,6 | 8,9 / 10,7 |
| Rüstzeiten mit Tausch | 19 % | 11 % | 12 % / 15 % |
| Vorrat am Ende je Spieler, Brot / Baustoff | 1,6 / 6,0 | 1,6 / 4,4 | 2,6 / 6,1 und 3,6 / 4,6 |
| Das Reich mit den meisten Feldern zu Beginn gewinnt | 51 % | 60 % | 54 % / 61 % |
| Partien, in denen ein Reich fällt | 0,1 % (gemischte Bots, Stand ADR-062: 1,2 %) | 0,1 % (gemischte Bots, Stand ADR-062: 0,8 %) | 1,3 % / 1,4 % |
| Dauer typisch, Mittel (90 % der Partien kürzer als) | 10,8 min (11,5) | 8,5 min (9,2) | 14,4 min / 10,4 min |
| Dauer allein gegen Bots (erhoben am 2026-11-13; nur Sitz 0 ein Mensch, sonst wie „typisch“; Fragen nur an Bots stehen deren Bedenkzeit lang offen, [O-43]): Mittel (90 % der Partien kürzer als); zum Vergleich mit sofortiger Auflösung | 9,0 min (9,8); 8,0 min | 7,5 min (8,2); 7,3 min | – |
| Dauer, wenn jeder jede Zeit ausreizt: Mittel, höchstens | 17,0 min, 20,7 min | 13,4 min, 15,8 min | 22,8 min, 25,6 min / 16,5 min, 18,7 min |
| Sieg nach Platz der Startfrage | 35 / 34 / 30 % | 58 / 42 % | 34 / 35 / 30 % und 57 / 43 % |
| Siegquote nach Stärke (gemischt, ohne den Sitz, der Fragen verpasst; Stand ADR-062) | leicht 12 %, mittel 38 %, schwer 71 % | leicht 36 %, mittel 62 %, schwer 88 % | leicht 5 %, mittel 27 %, schwer 69 % und leicht 21 %, mittel 48 %, schwer 82 % (Stand 2026-11-11) |

**Was die Zahlen sagen.** Die Partie wird zu dritt rund dreieinhalb Minuten kürzer, zu zweit knapp zwei; unter dem Ziel des Konzepts von 10 bis 15 Minuten liegt nur die Partie zu zweit (8,5 Minuten). Gut die Hälfte der Angriffe geht auf freie Felder, und am Ende ist noch Land frei. Es gibt deshalb nur noch halb so viele Duelle gegen ein Reich, und Stärke entscheidet etwas weniger: Leichte Bots gewinnen öfter als zuvor. Der Vorteil des Ersten der Startfrage liegt zu zweit bei 58 zu 42; ohne die Regel aus ADR-064 waren es mit demselben Werkzeug 55 zu 45 (`REALM_ECONOMY='{"attackNeedsArmy":null}'`). Gut zwei Punkte Unterschied liegen am Rand der Streuung von 2 000 Partien (rund ±2 Punkte); die Prüfgrenze von 60 % hält, ein Spieltest zu zweit soll darauf achten. Wer allein gegen Bots spielt, ist kürzer dran als eine Runde aus Menschen, weil Bots sofort wählen und rüsten; seit [O-43] wartet er bei Fragen nur an Bots deren Bedenkzeit ab (bei der Wissensfrage im Mittel 37,5 % des Zeitlimits bei einem gefragten Bot, 43 % beim langsameren von zweien; bei der Schätzfrage die Zeit der langsameren Antwort). Das macht zu dritt eine Minute je Partie aus und zu zweit 0,2 Minuten; die Messung rechnet dafür dieselben Partien so, als wäre nur Sitz 0 ein Mensch (`realm-sim.ts`, `solo` und `soloInstant`).

**Angriff nur mit Armee (ADR-064).** Gegen dieselbe Messung ohne die Regel (Werte wie nach ADR-062) ändert sie mit Bots wenig: etwas mehr Angriffe auf freie Felder (8,4 statt 8,1) und etwas weniger Duelle gegen ein Reich (6,6 statt 6,9), Dauer, zweite Burg und Armeekäufe bleiben gleich. Die Bots ziehen ihre Armeen ohnehin an die Grenze; ihr Angriff fällt zu dritt etwa bei jedem 200. Mal aus, zu zweit bei jedem 300., am ehesten in den letzten Runden. Weil der Angreifer jetzt immer mindestens eine Armee am Ziel hat, kommt die Frage etwas öfter aus seinen Lieblingskategorien (zu dritt 42 statt 39 %, zu zweit 40 statt 34 %). Menschen, die ihre Armeen in der Burg lassen, trifft die Regel härter als die Bots: Das zeigt erst ein Spieltest. Gegenprobe mit `RIVALS` (`REALM_ECONOMY='{"attackNeedsArmy":"RIVALS"}'`, je 2 000 Partien): kein ausgefallener Angriff zu dritt, einer in tausend Partien zu zweit; Angriffe auf freie Felder 8,6 und 5,4, Duelle 6,4 und 4,6, zweite Burg 40 und 65 %, Dauer 10,8 und 8,5 Minuten, Sieg des Ersten zu zweit 57 zu 43. Der Product Owner hat sich am 2026-11-13 für `ALWAYS` entschieden ([O-42], Auswahl A).

**Vorräte.** Ziel aus dem Plan nach dem Spieltest: Das Einkommen einer Runde reicht für ein Gebäude oder zwei Armeen, nicht für beides, und wer eine zweite Burg will, muss dafür spürbar auf anderes verzichten. Gegenproben mit je 2 000 Partien (zweite Burg zu dritt / zu zweit; Armeen je Spieler zu dritt):

| Zahlen | zweite Burg | Armeen | Vorrat am Ende, Brot / Baustoff (zu dritt) |
|---|---|---|---|
| alte Erträge (Dorf 2, Stadt 3), alte Preise | 7 % / 10 % | 7,0 | 1,2 / 6,2 |
| **Dorf 3, Stadt 4, alte Preise (umgesetzt)** | 39 % / 65 % | 8,0 | 1,6 / 6,0 |
| wie umgesetzt, Armee 3 Brot | 41 % / 61 % | 5,3 | 1,4 / 5,9 |
| wie umgesetzt, Dorf 2 + 2, Stadt 4 + 4, Burg 10 + 14 | 50 % / 76 % | 5,9 | 1,2 / 7,8 |
| alte Erträge, Burg 6 + 12 | 39 % / 62 % | 6,6 | 1,1 / 3,7 |
| wie umgesetzt, Burg 10 + 20 | 9 % / 11 % | 8,5 | 2,0 / 10,2 |

Mit den umgesetzten Zahlen reicht das Einkommen der ersten Runde (im Mittel gut 4 Brot und knapp 5 Baustoff) für ein Dorf und eine Armee oder für zwei Armeen; ab der dritten Runde reicht es für ein Gebäude und zwei Armeen, wenn man nicht auf die zweite Burg spart. Das Ziel ist damit am Anfang getroffen, später nur zum Teil: Gebäude kosten fast nur Baustoff, Armeen nur Brot, beide stehen sich kaum im Weg. Die zweite Burg (24 Rohstoffe, rund zwei Runden Einkommen) baut zu dritt gut jeder Dritte, zu zweit zwei von drei. Die Bots sparen nicht gezielt auf die Burg; Menschen können es. Welche Zahlen gelten sollen, entscheidet der Product Owner ([O-41]).

**Wahlen der Landnahme zu dritt.** Mit 2, 1 und 0 Wahlen je Runde (wie §3) kann ein Reich nach zwei Runden mit 2 Feldern dastehen und ein anderes mit 6. Gegenprobe mit 2, 1 und 1 (`REALM_PICKS='[2,1,1]'`): Felder zu Beginn 4,7 (4,0 bis 5,3), zu Beginn des Feldzugs sind 10 statt 12 Felder frei, das größte Reich gewinnt zu 41 statt 49 %, die zweite Burg bauen 51 %, die Partie dauert 11,3 Minuten. Es bleibt bei 2, 1, 0 **[V, PO 2026-11-12, [O-41] Teil 2]**.

**Sechs Runden** (Gegenprobe, je 2 000 Partien): zu dritt 12,7 Minuten und zweite Burg bei 63 %, zu zweit 9,9 Minuten und 82 %; frei bleiben am Ende 5,7 und 2,0 Felder. Es bleibt bei fünf Runden **[V, [O-31]]**.

### 11.10 Parametertabelle

| Schlüssel (`economy`) | Standard **[E]** | Bedeutung |
|---|---|---|
| `favorites` | 4 | Lieblingskategorien je Spieler |
| `startArmies` | 3 | Armeen jeder Startburg |
| `villageMinDistance` | 2 | Mindestabstand des Startdorfs zu fremden Gebäuden |
| `landGrabRounds` | 2 **[V, PO 2026-11-12]** | Runden der Landnahme, 1 bis 10; fehlt der Wert (Partien vor ADR-062), läuft sie, bis alles vergeben ist |
| `attackNeedsArmy` | `ALWAYS` ([O-42]) | Angriffsziel nur neben einer eigenen Armee: `ALWAYS` für jedes Ziel, `RIVALS` nur für Felder anderer Reiche; fehlt der Wert (Partien vor ADR-064), genügt die Grenze |
| `yields.plain` / `village` / `town` | 1 / 3 / 4 ([O-41]) | Ertrag je Runde im Rohstoff des Felds |
| `yields.castleBread` / `castleMaterial` | 2 / 2 | Ertrag einer Burg |
| `tradeRate` | 3 | so viel eines Rohstoffs kostet 1 vom anderen |
| `costs.village` / `town` / `castle` / `army` | 1 + 3 / 2 + 6 / 8 + 16 / 2 + 0 | Brot + Baustoff |
| `maxCastles` | 2 | Burgen je Reich mit der Startburg |
| `armyCap` | 6 | Armeen je Feld |
| `lots.village` / `town` / `castle` / `free` | 2 / 3 / 4 / 2 | Lose im Glücksrad |
| `timers.prepareMs` / `ordersRevealMs` / `wheelMs` | 40 000 / 2 000 / 3 000 | Rüstzeit, Aufdecken, Glücksrad in ms |

Dazu `campaign.rounds` = 5 statt 4 **[V, [O-31]]**; alles Übrige wie §8. `PLAYTEST_REALM_RULES` verkürzt die Zeiten wie `PLAYTEST_MATCH_RULES`, die Rüstzeit auf 15 s, das Aufdecken auf 0,5 s und das Rad auf 1 s. Zu zweit über `matchRulesForSeats`, das den Ausbau übernimmt.

### 11.11 Ablauf am Server

Seit ADR-058 spielt der Server die Partie mit Ausbau als eigene Spielart (`matches.mode = 'REALM'`, [API.md §2.6](API.md#26-partie)); Partien der bisherigen Art laufen unverändert weiter und zu Ende. Code: `apps/server/src/modules/match/realm-run.ts` (Ablauf), `engine.ts` (gemeinsamer Teil: Fristen, Fragen, Antworten, Speicherung), `classic-run.ts` (bisherige Partie). Was die Regeln oben offenlassen, legt der Server so fest **[E]**:

- **Lieblingskategorien:** wählbar in der Aufstellung, genau vier verschiedene vom Rad. Das Konto merkt sich die letzte Wahl und bringt sie in die nächste Aufstellung mit. Beim Start gilt eine Wahl nur, wenn sie dann noch auf dem Rad steht; sonst und für Bots lost der Server vier (Strom `match`).
- **Zeiten:** Jede Wahl (Burg, Startdorf, Landnahme) bleibt wie §5 `pickShowMs` stehen, außer derselbe Sitz wählt gleich noch einmal (letzte Burg und erstes Startdorf). Ein Angriffsziel führt sofort zum Glücksrad: Ziel, Rad und Kategorie stehen `wheelMs` lang, dann kommt die Wissensfrage. Das Aufgedeckte steht `ordersRevealMs` lang.
- **Rüstzeit:** Bots geben zu Beginn ab, Menschen bis `prepareMs` plus Latenzpuffer. Wer fertig ist, wartet auf die anderen; sobald alle abgegeben haben, wird aufgedeckt, eine Partie allein gegen Bots also mit der eigenen Abgabe. Bis dahin sieht jeder nur die eigenen Befehle und wer fertig ist.
- **Ausgefallener Angriff (ADR-064):** Hat ein Reich kein Ziel, wenn es an der Reihe ist, schreibt der Server `ATTACK_SKIPPED` ins Protokoll und geht ohne Pause zum Nächsten; eine Wahl oder eine Frist gibt es für dieses Reich nicht. Fallen gleich nach dem Aufdecken alle aus, steht das Aufgedeckte trotzdem `ordersRevealMs` lang als Ansage; die Zustandsmaschine ist dann schon in der Rüstzeit der nächsten Runde (das Einkommen steht schon im Protokoll) oder am Ende, und danach beginnt diese Rüstzeit regulär (Bots geben ab, Menschen bekommen die Frist) oder die Abrechnung. Ob aufgedeckt ist, erkennt der Server deshalb an Schritt und Runde, nicht am Schritt allein.
- **Freies Feld:** Die Wissensfrage geht an einen einzigen Sitz (`match_questions.seats` mit einem Eintrag, nur für `DUEL_TRIVIA` erlaubt, Migration 0015). Mit der Antwort des Angreifers oder dem Ablauf seiner Frist ist sie entschieden; die Antwort eines Bots steht beim Öffnen fest, die Frage bleibt aber seine Bedenkzeit lang offen ([O-43], entschieden: A). Die anderen Reiche sehen währenddessen, wer welches freie Feld angreift, und lesen die Frage wie bei jedem fremden Duell mit; was der Angreifer gewählt hat, zeigt erst die Auflösung ([O-38], entschieden: A, ADR-065).
- **Glücksrad:** dreht der Server, Kategorien ohne ungestellte Frage ausgenommen (§11.6). Das Rad und die gezogene Kategorie stehen im Protokoll, mit Zufallsnachweis wie jede Ziehung.
- **Bots** antworten in der Wissensfrage eines Duells aus ihren Lieblingskategorien besser (§11.8); maßgeblich ist die Kategorie vom Rad.
- **Letzte Auflösung** und Wiederanlauf wie §5: Auch hier bleibt die letzte Auflösung stehen, bevor abgerechnet wird, und nach einem Neustart macht der Server in jedem Abschnitt weiter, auch mitten in der Rüstzeit.
- **Statistik:** Partien mit Ausbau zählen wie die bisherigen, also nur normale Partien ohne Bots.

### 11.12 Offen

- Erster Spieltest mit dem Product Owner am 2026-11-12; die Rückmeldung wird in Schritten umgesetzt (ADR-061, ADR-062, ADR-063 für Rüstzeit und Verständlichkeit, ADR-064 für den Angriff nur mit Armee, ADR-065 für die Zuschauer, ADR-066 für Karte und Übersicht, ADR-067 für die Bewegungen, ADR-068 für das Blatt der Rüstzeit auf niedriger Bühne, ADR-069 für die Reihenfolge der Auflösung). Erst danach wird die Spielart in Produktion freigegeben. Im Browser gilt bis dahin: Ein offener Entwurf der Rüstzeit wird kurz vor Fristende von selbst abgegeben, und das Aufgedeckte steht 2 s ([O-36]).
- Zahlen der Vorräte: Standardannahme, bis der Product Owner entscheidet ([O-41] Teil 1). Die Wahlen der Landnahme zu dritt bleiben 2, 1, 0 (entschieden 2026-11-12).
- Angriff nur mit Armee ([O-42], entschieden: `ALWAYS`): Offen bleibt, ob Menschen zu oft aussetzen; das zeigt der nächste Spieltest. Der Wert ist ein Regelwert, ein Wechsel zu `RIVALS` braucht keine Migration.
- Zuschauer ([O-38], entschieden: A, ADR-065): Wer nicht gefragt wird, liest die Frage mit und sieht, wer schon geantwortet hat; was jemand gewählt hat, zeigt erst die Auflösung, dort in den Farben der Spieler. Das ändert keine Regel und keine Wertung. Auch eine Frage, an der nur Bots gefragt sind, bleibt dafür offen, bis deren Bedenkzeit um ist ([O-43], entschieden: A); eine Partie mit Ausbau allein gegen zwei Bots dauert damit gemessen 9,0 statt 8,0 Minuten, allein gegen einen 7,5 statt 7,3 (§11.9).
- Die Partie zu zweit dauert typisch 8,5 Minuten und liegt damit unter den 10 bis 15 Minuten des Konzepts ([O-41]).
- Fragen: Das Rad lässt sich erst sinnvoll spielen, wenn jede wählbare Kategorie genug Fragen hat (§11.6). Mit freien Feldern bleibt es bei höchstens 15 Wissensfragen aus dem Rad je Partie.
- Alle Zahlen sind Standardannahmen **[E]**; besonders Burgpreis, Rundenzahl und Länge der Rüstzeit.
