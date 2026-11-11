# Regelwerk der Partie

Bezug: PO-Entscheidungen vom 2026-11-10 („das Spiel soll rundenbasiert sein … erst das rundenbasierte Spiel, dann Eternal“; „wenn es runden basiert ist brauchen wir an sich keine bots“; „wir brauchen aber bot spieler um zu testen“), Plan „Rundenbasierte Partie“ vom selben Tag, ADR-046 bis ADR-048; Wunsch des Product Owners vom 2026-11-11 nach der ersten Partie am Handy (freie Plätze mit Bots füllen, Karte je nach Spielerzahl, Anzeige, wer wann dran ist), ADR-052. Kennzeichnung wie in [README.md](README.md#kennzeichnung-von-regeln).

Die Partie ist das rundenbasierte Hauptspiel: zwei oder drei Spieler auf einer kleinen eigenen Karte, deren Größe sich nach der Spielerzahl richtet (§2), alle beantworten dieselbe Frage gleichzeitig, eine Partie dauert höchstens etwa 18 Minuten (zu zweit 13). Freie Plätze kann der Gastgeber mit Bots besetzen **[V, PO 2026-11-11, ADR-052]**; die Testpartie bleibt als Werkzeug **[V, PO 2026-11-10, ADR-048]**. Vorbild ist nur der Ablauf des Genres (gleichzeitige Fragen, Landnahme, Feldzug) **[V, PO 2026-11-10]**; Name, Karte, Grafik, Abschnittsnamen, Punktwerte und Fragen sind eigene. Als Nächstes bekommt die Partie einen Ausbau mit Rohstoffen, Burgen, Dörfern, Armeen und einem Glücksrad für die Kategorie des Duells; die Regeln stehen in §11, gespielt wird er erst mit dem nächsten Schritt **[V, PO 2026-11-11, ADR-057]**. Die Eternal-Welt ([GAME_RULES.md](GAME_RULES.md)) bleibt im Code und spielbar, wird aber erst weiter ausgebaut, wenn die Partie fertig ist **[V, PO 2026-11-10]**.

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

Zeitmessung und Latenzausgleich wie [QUIZ_ENGINE.md §6.2](QUIZ_ENGINE.md) (`cap` = 500 ms). Jeder Sitz holt die Frage selbst ab; seine Zeit läuft ab dem Abholen (Zeitlimit + `cap`), höchstens bis die Frage schließt: Zeitlimit + `cap` + 2 s zum Abholen ab dem Öffnen **[E]**. Haben alle Menschen geantwortet, wird sofort aufgelöst, sonst 1 s nach dem Schließen, damit eine rechtzeitig eingegangene Antwort nicht an einer Sperre verloren geht **[E]** (ADR-049). Wer die Verbindung verliert, bleibt in der Partie; verpasste Fragen und Wahlen behandelt der Server wie oben. Der Browser holt eine Frage ohne Klick ab, sobald sie an den eigenen Sitz geht, und zeigt die Restzeit aus `remainingMs` (ADR-050). `PLAYTEST_MATCH_RULES` verkürzt die Zeiten auf 8 s, 10 s, 5 s und 2 s, die Ansagen auf 0,3 s und 0,6 s, sonst gleiche Regeln.

### Ansage

Damit jeder mitbekommt, was geschieht, hält die Partie nach jeder Wahl und vor jedem Duell kurz an **[V, PO 2026-11-11: die Partie war „zu hektisch“; Dauer und Einzelheiten E, ADR-053, [O-24]]**. In dieser Zeit gibt es nichts zu tun und keine Eingabe:

- **Gezeigte Wahl:** Eine gewählte Hauptstadt oder Region bleibt `timers.pickShowMs` lang stehen, bevor ein anderer Sitz wählt oder die nächste Schätzfrage kommt. Das gilt für Bots wie für Menschen und für eine Wahl des Servers nach Zeitablauf. Wählt derselbe Mensch gleich noch einmal (der Erste der Landnahme), geht es ohne Pause weiter. Ein Bot wählt weiterhin ohne Bedenkzeit, aber seine Wahlen erscheinen einzeln nacheinander.
- **Ansage eines Duells:** Hat der Angreifer sein Ziel gewählt, steht `timers.announceMs` lang fest, wer wen in welcher Region angreift. Erst danach wird die Wissensfrage geöffnet; ihre Zeit läuft nicht während der Ansage. Das Stechen folgt ohne weitere Ansage auf die Auflösung der Wissensfrage.

Die Ansage ist eine Phase des Servers (`ANNOUNCE`), kein Schritt der Regeln: Die Zustandsmaschine in game-core, die Simulationen und die Wiederholbarkeit aus den Eingaben bleiben unberührt. Alle Mitspieler sehen denselben Stand zur selben Zeit, auch nach einem Neuladen. Partien, die vor ADR-053 gestartet wurden, kennen die beiden Zeiten nicht und laufen ohne Ansage zu Ende.

### Letzte Auflösung

Das Duell, das die Partie entscheidet, ist ihr Höhepunkt. Seine Auflösung steht deshalb `timers.revealMs` lang wie jede andere, mit dem Ausgang auf der Karte und den Antworten; erst danach erscheint die Abrechnung **[V, PO 2026-11-11; Dauer E, ADR-055, [O-24]]**. Bis ADR-055 endete die Partie im selben Augenblick, in dem die letzte Frage aufgelöst war: Niemand sah, wie das letzte Duell ausging und wer was geantwortet hatte.

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
- Fragenquelle für mehr als eine Partie ohne Wiederholung (E2, Paket M5). Bis dahin wiederholt sich innerhalb einer Partie keine Frage, solange der Bestand andere hat; mit den 40 Testfragen kommen in langen Partien Wiederholungen vor.
- Laufende Partie verlassen oder aufgeben: heute nicht vorgesehen; wer geht, verpasst alle weiteren Fragen und Wahlen, die Partie läuft bis zum Ende weiter. Ob es ein Aufgeben gibt und wie es zählt, entscheidet der Product Owner nach dem Spieltest.
- Partien mit Fremden über eine Warteschlange und eine Rangliste brauchen einen erreichbaren Server ([O-11]).

## 11. Ausbau: Burgen, Dörfer, Armeen

Bezug: Wunsch des Product Owners vom 2026-11-11, die Partie mit einem Aufbau-Minispiel zu verbinden (Rohstoffe aus dem Gebiet, Gebäude mit mehr Leben, Armeen, die die Kategorien im Duell verschieben, 10 bis 15 Minuten je Partie), seine zwei handschriftlichen Zettel vom selben Tag und das daraus erarbeitete Spielkonzept, das er am 2026-11-11 mit allen Empfehlungen freigegeben hat ([O-25] bis [O-35], ADR-057). Vorbild sind nur allgemeine Mechaniken; Namen, Begriffe und Bilder sind eigene **[V, PO 2026-11-11]**.

**Stand:** Regeln, Bots und Simulation stehen im Spielkern; Server und Browser folgen in eigenen Schritten. Gespielt wird bis dahin die Partie aus §1 bis §10. Eine Partie spielt den Ausbau genau dann, wenn ihre Regeln den Abschnitt `economy` haben (`DEFAULT_REALM_RULES`); ohne ihn gilt alles wie bisher.

Code: `packages/game-core/src/realm.ts` (Zustandsmaschine `createRealm`, `applyRealmInput`), `realm-state.ts` (Zustand und Abfragen), `realm-orders.ts` (Rüstzeit), `realm-wheel.ts` (Glücksrad), `realm-resources.ts` (Rohstoff je Region), `realm-bots.ts` (Bots); Regelwerte in `packages/protocol/src/match-rules.ts` (`matchEconomySchema`, `DEFAULT_MATCH_ECONOMY`, `DEFAULT_REALM_RULES`, `PLAYTEST_REALM_RULES`). Die bisherige Zustandsmaschine `match.ts` bleibt unverändert. Wie dort liegen Zeit und Zufall beim Aufrufer: Die Zustandsmaschine würfelt nie, auch das Glücksrad dreht der Aufrufer (`spinRealmWheel`, Strom `match`) und meldet die Kategorie als Eingabe.

### 11.1 Ablauf

1. **Aufstellung:** Jeder hat vier Lieblingskategorien (`economy.favorites`) **[V, Zettel]**. Bots wählen zufällig (`chooseRealmFavoritesForBot`); dass das Spiel sie sich je Konto merkt und wer nicht wählt vier zufällige bekommt, regelt der Server **[E]**.
2. **Startfrage** (`START_ESTIMATE`): eine Schätzfrage an alle; ihre Rangfolge ist die Reihenfolge der Partie (`order`): Abstand, dann effektive Antwortzeit, bei völligem Gleichstand die geloste Sitznummer **[V, Zettel; Gleichstand E]**. Sie ersetzt die geloste Reihenfolge der Sitze für Burgen, Dörfer und Runden.
3. **Burgen setzen** (`CASTLE_PICK`): in der Reihenfolge der Startfrage je eine Burg auf ein freies Feld, mindestens `capital.minDistance` = 2 Felder von jeder anderen Burg. Die Startburg ist 300 wert wie die Hauptstadt und beginnt mit `economy.startArmies` = 3 Armeen **[V, [O-26]]**.
4. **Dörfer setzen** (`VILLAGE_PICK`): in umgekehrter Reihenfolge je ein Dorf auf ein weiteres freies Feld, mindestens `economy.villageMinDistance` = 2 Felder von fremden Gebäuden **[V, Zettel]**. Wer bei der Burg zuletzt wählen durfte, setzt das Dorf zuerst. Gibt es für Burg oder Dorf keinen Platz mit Abstand, ist jedes freie Feld wählbar.
5. **Landnahme** wie §3 **[V, [O-30]]**; wählbar ist ein freies Feld am eigenen Land, also auch an Burg und Dorf. Zu dritt bleiben 18 freie Felder (sechs Runden), zu zweit 12 (vier Runden).
6. **Feldzug**, `campaign.rounds` = 5 Runden **[V, [O-31]]**. Jede Runde: **Einkommen** (§11.2) → **Rüstzeit** (§11.4) → **Aufdecken** → **Angriffe**: jedes lebende Reich einmal, in der Reihenfolge der Runde (§1); nur in der letzten Runde greift zuerst an, wer nach Punkten vorn liegt, wer hinten liegt, zuletzt, bei gleichen Punkten in der Reihenfolge der Runde (`realmAttackOrder`) **[V, [O-35]]**. Die Reihenfolge der Angreifer steht zu Beginn der Angriffe fest. Ein Angriff: Ziel wählen (eine gegnerische Region am eigenen Land, gibt es keine, jede gegnerische), Glücksrad (§11.5), Wissensfrage, bei Gleichstand die Schätzfrage, Auflösung (§11.7).
7. **Abrechnung** nach der fünften Runde oder sobald nur noch ein Reich lebt (§11.7).

Zeiten: Wahl, Fragen, Auflösung und gezeigte Wahl wie §5. Die Ansage eines Duells dauert hier `economy.timers.wheelMs` = 3 s statt `announceMs`, weil sich in ihr das Glücksrad dreht. Die Rüstzeit dauert höchstens `economy.timers.prepareMs` = 40 s, das Aufdecken `economy.timers.ordersRevealMs` = 2 s **[V, [O-32]; Längen E]**. Die Abfrage `realmStepTimeLimitMs` liefert das Zeitlimit jedes Schritts, `realmTurnOrder` die Zugfolge für die Anzeige wie §3.

### 11.2 Rohstoffe

Zwei Rohstoffe, **Brot** und **Baustoff** **[V, [O-25], [O-33]]**. Jedes Feld liefert genau einen, und man sieht ihn an der Landschaft der Karte: Felder, Wiesen, Flüsse, Seen und Dörfer geben Brot, Wälder, Kiefern, Berge, Hügel und Moore Baustoff. Die Wendelmark hat 11 Brot- und 13 Baustofffelder, die Kernmark 9 und 7 (`realm-resources.ts`; ein Test in `apps/web/test/realm-resources.test.ts` hält Regeln und Kartenbild deckungsgleich). Welche Frage gestellt wird, hat mit dem Rohstoff nichts zu tun.

Zu Beginn jeder Feldzugrunde bekommt jedes lebende Reich das Einkommen aller eigenen Felder (`realmIncome`, Ereignis `INCOME`) **[E]**:

| Feld | Ertrag je Runde |
|---|---|
| ohne Gebäude | 1 seines Rohstoffs |
| mit Dorf | 2 seines Rohstoffs |
| mit Stadt | 3 seines Rohstoffs |
| mit Burg | 2 Brot und 2 Baustoff, gleich welche Landschaft |

Vorräte bleiben für spätere Runden. In der Rüstzeit gibt es für `economy.tradeRate` = 3 eines Rohstoffs 1 vom anderen **[E]**.

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

**Rüstzeit** (`PREPARE`) **[V, [O-32]]**: alle lebenden Reiche gleichzeitig und verdeckt. Jeder Sitz gibt seine Befehle als Liste ab (`SUBMIT_ORDERS`) und kann sie bis zum Ende ersetzen; sobald alle abgegeben haben, geht es weiter, sonst schließt der Aufrufer die Rüstzeit nach Ablauf (`CLOSE_PREPARE`), und wer nichts abgegeben hat, tut in dieser Runde nichts. Die Befehle werden in der abgegebenen Reihenfolge ausgeführt, höchstens 200 je Runde (`checkRealmOrders`):

| Befehl | Wirkung | Abgelehnt mit |
|---|---|---|
| `BUILD` Feld | nächste Stufe auf einem eigenen Feld | `NOT_OWN_REGION`, `ALREADY_BUILT` (diese Runde schon ausgebaut), `MAX_LEVEL`, `CASTLE_LIMIT`, `TOO_EXPENSIVE` |
| `RECRUIT` Burg, Anzahl | neue Armeen in einer eigenen Burg | `NOT_OWN_REGION`, `NOT_A_CASTLE`, `TOO_EXPENSIVE` |
| `MOVE` von, nach, Anzahl | Armeen ein Feld weit auf ein benachbartes eigenes Feld | `NOT_OWN_REGION`, `NOT_NEIGHBORS`, `NOT_ENOUGH_ARMIES` |
| `TRADE` Rohstoff, Anzahl | gibt das Dreifache des einen, bekommt die Anzahl des anderen | `TOO_EXPENSIVE` |

Ziehen dürfen nur Armeen, die zu Beginn der Runde auf dem Feld standen; jede höchstens ein Feld weit, neu gekaufte erst in der nächsten Runde. Die Grenze von 6 Armeen je Feld gilt nach allen Befehlen. Ungültige Befehle lehnt die Zustandsmaschine mit `INVALID_ORDERS`, dem Fehler und der Stelle in der Liste ab; dann bleibt die vorige Abgabe stehen. Weil jeder Befehl nur eigene Felder und eigene Vorräte betrifft, gelten alle gegen den Stand vom Beginn der Rüstzeit und hängen nicht voneinander ab.

**Aufdecken:** Alle Befehle werden in der Reihenfolge der Runde ausgeführt und je Reich als Ereignis `ORDERS_REVEALED` mit Befehlen, Zusammenfassung (gebaut, gekauft, gezogen, getauscht) und neuem Vorrat gemeldet. Erst dann sehen die anderen, was sich geändert hat.

### 11.5 Glücksrad

Vor der Wissensfrage jedes Duells bestimmt ein Glücksrad ihre Kategorie (`realmWheel`, Ereignisse `TARGET_CHOSEN` mit dem Rad, `WHEEL_SPUN` mit der Kategorie) **[V, Zettel, [O-27]; Lose E]**. Jede Seite bringt Lose mit:

- **Angreifer:** 1 Los je eigene Armee in Reichweite des angegriffenen Felds.
- **Verteidiger:** 1 Los je eigene Armee in Reichweite, dazu das Gebäude auf dem Feld (`economy.lots`: Dorf 2, Stadt 3, Burg 4).
- **Frei:** `economy.lots.free` = 2 Lose.

Die Lose einer Seite verteilen sich gleich auf ihre Lieblingskategorien, die freien auf alle Kategorien des Rads. Lieblingskategorien, die nicht auf dem Rad stehen, zählen nicht; hat eine Seite keine auf dem Rad, werden ihre Lose frei. Gibt es gar keine Lose, sind alle Kategorien gleich wahrscheinlich. Die Gewichte sind ganze Zahlen (ein Los = Kategorien · Lieblingskategorien des Angreifers · Lieblingskategorien des Verteidigers Teile, gekürzt), damit Server und Browser ohne Rundung dasselbe Rad zeigen. Beispiel: Der Angreifer hat 3 Armeen an der Grenze, der Verteidiger ein Dorf und eine Armee: Die Frage kommt zu 37,5 % aus den Lieblingskategorien des Angreifers, zu 37,5 % aus denen des Verteidigers und zu 25 % frei. Die Schätzfrage im Stechen, die Startfrage und die Fragen der Landnahme haben keine Kategorie vom Rad.

### 11.6 Kategorien und Fragen

Auf dem Rad stehen nur Kategorien mit genug Wissensfragen (`categories` beim Anlegen); nur sie lassen sich als Lieblingskategorien wählen. Bedarf **[E]**: mindestens 20 Fragen je Kategorie, für den ersten Spieltest 10. Heute hat jede Kategorie 1 bis 3. Hat die vom Rad gewählte Kategorie keine ungestellte Frage mehr, kommt die Frage aus einer anderen Kategorie des Rads, und das Rad zeigt das (Server, nächster Schritt). Neue Fragen hängen an der Fragenbeschaffung (E2, Paket M5).

### 11.7 Duell, Folgen und Wertung

Das Duell selbst ist §4: Wissensfrage, bei zwei richtigen Antworten die Schätzfrage. **Folgen** **[V, Zettel; Einzelheiten E]** (Ereignis `DUEL_RESOLVED`):

| Ziel | Angreifer gewinnt | Verteidiger gewinnt |
|---|---|---|
| Feld ohne Gebäude | erobert mit seinem Wert, die Armeen darauf sind verloren (`CONQUERED`) | befestigt, +50 (`FORTIFIED`) |
| Dorf, Stadt | fällt eine Stufe zurück, das Feld bleibt beim Verteidiger (`BUILDING_DAMAGED`) | befestigt, +50 |
| Burg mit mehr als einem Leben | verliert ein Leben (`CASTLE_HIT`), Leben kehren nicht zurück | befestigt, +50 |
| Burg mit letztem Leben, das Reich hat noch eine | zerstört: Das Feld geht ohne Gebäude und ohne Armeen an den Angreifer und behält seinen Wert (`CASTLE_DESTROYED`) | befestigt, +50 |
| letzte Burg mit letztem Leben | Das ganze Reich geht an den Angreifer, mit allen Gebäuden und Vorräten; seine Armeen lösen sich auf, es scheidet aus (`TAKEOVER`, Ereignis `KINGDOM_ELIMINATED`) | befestigt, +50 |

Dazu verliert der Verlierer eine Armee (§11.4). **Wertung** wie §6, nur aus Land: jedes Feld 100, die Startburg 300, jede gehaltene Verteidigung +50; Vorräte, Gebäude und Armeen zählen nicht **[V, [O-28]]**. Rangfolge: Punkte; ein gefallenes Reich hinter jedem lebenden, ein später gefallenes vor einem früher gefallenen; dann mehr Felder, dann mehr Burgleben; sonst geteilter Platz (`realmStandings`). Die Partie endet sofort, wenn nur noch ein Reich lebt (`LAST_KINGDOM`), sonst nach der letzten Runde (`ROUNDS_COMPLETE`).

### 11.8 Bots

Wie §7 antworten Bots über das NPC-Modell ihrer Stärke; in ihren Lieblingskategorien eine Stufe besser (`REALM_FAVORITE_THETA_BONUS` = 0,7, ein mittlerer Bot trifft eine mittelschwere Frage dort zu rund 75 % statt 60 %) **[E]**. Ihre Regeln (`realm-bots.ts`) **[E]**:

- **Wahlen:** Burg möglichst weit weg von den anderen Burgen (bis 3 Felder zählt), dann viele Nachbarn; Dorf etwa zwei Felder von der eigenen Burg, dann viele freie Nachbarn; Landnahme wie §7; Angriffsziel mit dem größten erwarteten Gewinn: Siegchance aus dem Glücksrad mal Punkte je nötigem Sieg (eine Burg mit letztem Leben bringt als letzte das ganze Reich).
- **Rüstzeit:** erst Armeen hinter der Grenze ein Feld Richtung Grenze; dann ein Ausbau je Runde, die höchste erreichbare Stufe (Burg vor Stadt vor Dorf) auf dem Feld mit den wenigsten gegnerischen Nachbarn, wenn nötig nach einem Tausch; mit dem übrigen Brot Armeen in der Burg mit den wenigsten.

Gleichstände entscheidet der Strom `match`. Die Stärke wirkt nur auf die Antworten.

### 11.9 Simulation und Messwerte

Unit-Tests je Regel (`packages/game-core/test/realm.test.ts`, `packages/protocol/test/match-rules.test.ts`) und eine Simulation von je 1 000 Partien zu dritt (Wendelmark) und zu zweit (Kernmark) mit Bots gemischter Stärke, Sitz 0 verpasst 15 % der Fragen, Wahlen und Rüstzeiten (`realm-simulation.test.ts`, Partien aus `realm-sim.ts`). Nach jedem Schritt gilt: Besitzer gültig, im Feldzug hat jedes Feld einen; Armeen zwischen 0 und 6 und nur auf besetzten Feldern; Vorräte nie negativ; höchstens zwei Burgen je Reich, jedes lebende Reich hat ab der Landnahme mindestens eine; gefallene Reiche besitzen nichts und haben keine Vorräte; jeder Regionswert ist Grundwert plus Befestigungen. Jede Partie endet, die Punkte ergeben die Summe aller Regionswerte, die Wiederholung mit denselben Strömen ist bitgleich, stärkere Bots gewinnen öfter. Bänder für die Spielbalance aus je 400 Partien gleich starker Bots: zweite Burg bei 30 bis 80 % der Spieler, ein Reich fällt in weniger als 5 % der Partien, der Angreifer gewinnt 35 bis 55 % der Duelle, typische Dauer im Mittel höchstens 15,5 Minuten (zu zweit 11,5), zu zweit gewinnt der Erste der Startfrage seltener als 60 %.

Rechnerische Obergrenze, wenn jede Zeit ganz ausläuft und jedes Duell bis zur Schätzfrage geht: zu dritt 26,0 Minuten und 37 Fragen, zu zweit 18,7 Minuten und 25 Fragen (der Test prüft sie). Messwerte über je 2 000 Partien gleich starker mittlerer Bots ohne verpasste Fragen (2026-11-11, `corepack pnpm exec tsx packages/game-core/test/realm-measure.ts`; „typisch“ mit den Annahmen Wahl 5 s, Wissensfrage 8 s, Schätzfrage 11 s, Rüstzeit 25 s, die Pausen voll):

| Messwert | zu dritt (Wendelmark) | zu zweit (Kernmark) |
|---|---|---|
| Fragen je Partie | 29,7 | 20,1 |
| Duelle, davon Eroberungen | 15,0, davon 6,5 | 10,0, davon 4,1 |
| Angreifer gewinnt ein Duell | 44 % | 44 % |
| Duelle, die die Schätzfrage entscheidet | 51 % | 51 % |
| Frage aus Lieblingskategorien Angreifer / Verteidiger / frei | 39 / 28 / 33 % | 34 / 40 / 26 % |
| Einkommen je Runde und Reich, Brot / Baustoff | 6,7 / 7,3 | 7,5 / 6,5 |
| je Spieler gebaut: Dörfer / Städte | 2,0 / 2,4 | 2,0 / 2,6 |
| Spieler, die eine zweite Burg bauen | 61 % | 40 % |
| Armeen gekauft je Spieler | 8,9 | 10,8 |
| Rüstzeiten mit Tausch | 12 % | 15 % |
| Partien, in denen ein Reich fällt | 0,9 % (gemischte Bots 6,3 %) | 1,2 % (gemischte Bots 3,3 %) |
| Dauer typisch, Mittel (90 % der Partien kürzer als) | 14,4 min (15,0) | 10,4 min (11,0) |
| Dauer, wenn jeder jede Zeit ausreizt: Mittel, höchstens | 22,8 min, 25,6 min | 16,5 min, 18,7 min |
| Sieg nach Platz der Startfrage | 34 / 35 / 31 % | 56 / 44 % |
| Siegquote nach Stärke (gemischt) | leicht 5 %, mittel 27 %, schwer 69 % | leicht 21 %, mittel 48 %, schwer 82 % |

Gegenproben mit 4 und 6 Runden (je 2 000 Partien): Die zweite Burg bauen dann zu dritt 27 und 74 %, zu zweit 9 und 60 % der Spieler; typisch dauert die Partie zu dritt 12,4 und 16,4 Minuten, zu zweit 9,0 und 11,9. Fünf Runden treffen das Ziel des Konzepts („etwa jeder Zweite schafft die zweite Burg“) zu dritt knapp darüber, zu zweit knapp darunter. Das Startdorf in umgekehrter Reihenfolge senkt den Vorteil des Ersten zu zweit von rund 60 zu 39 (§9) auf 56 zu 44.

### 11.10 Parametertabelle

| Schlüssel (`economy`) | Standard **[E]** | Bedeutung |
|---|---|---|
| `favorites` | 4 | Lieblingskategorien je Spieler |
| `startArmies` | 3 | Armeen jeder Startburg |
| `villageMinDistance` | 2 | Mindestabstand des Startdorfs zu fremden Gebäuden |
| `yields.plain` / `village` / `town` | 1 / 2 / 3 | Ertrag je Runde im Rohstoff des Felds |
| `yields.castleBread` / `castleMaterial` | 2 / 2 | Ertrag einer Burg |
| `tradeRate` | 3 | so viel eines Rohstoffs kostet 1 vom anderen |
| `costs.village` / `town` / `castle` / `army` | 1 + 3 / 2 + 6 / 8 + 16 / 2 + 0 | Brot + Baustoff |
| `maxCastles` | 2 | Burgen je Reich mit der Startburg |
| `armyCap` | 6 | Armeen je Feld |
| `lots.village` / `town` / `castle` / `free` | 2 / 3 / 4 / 2 | Lose im Glücksrad |
| `timers.prepareMs` / `ordersRevealMs` / `wheelMs` | 40 000 / 2 000 / 3 000 | Rüstzeit, Aufdecken, Glücksrad in ms |

Dazu `campaign.rounds` = 5 statt 4 **[V, [O-31]]**; alles Übrige wie §8. `PLAYTEST_REALM_RULES` verkürzt die Zeiten wie `PLAYTEST_MATCH_RULES`, die Rüstzeit auf 15 s, das Aufdecken auf 0,5 s und das Rad auf 1 s. Zu zweit über `matchRulesForSeats`, das den Ausbau übernimmt.

### 11.11 Offen

- Server (nächster Schritt): neue Abschnitte Startfrage, Burgen, Dörfer, Rüstzeit und Aufdecken, Lieblingskategorien in der Aufstellung, Ausweichen bei leeren Kategorien, eine Migration; laufende Partien der bisherigen Art spielen zu Ende.
- Browser erst nach Bildentwürfen zur Freigabe und nach dem Strang „Partie am Handy ruhiger machen“.
- Fragen: Das Rad lässt sich erst sinnvoll spielen, wenn jede wählbare Kategorie genug Fragen hat (§11.6).
- Alle Zahlen sind Standardannahmen **[E]** bis zum ersten Spieltest; besonders Burgpreis, Rundenzahl und Länge der Rüstzeit.
