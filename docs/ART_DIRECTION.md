# Gestaltung: „Alte Landkarte“

Stilleitfaden für das Aussehen von Reiche des Wissens (ADR-051, angenommen 2026-11-10). Vorbild ist nur der Ablauf des Genres; Name, Karte, Grafik und Look sind eigen (ADR-046). Herkunft und Lizenz jedes Bausteins stehen in [ASSETS.md](ASSETS.md).

## 1. Look

Das Spiel sieht aus wie eine handgezeichnete Fantasy-Karte auf Pergament: Tinte, Aquarellfarben, Gold. Die Partie zeigt die Wendelmark als Insel mit Küste, Meer, Fluss, kleinen Landschaftsmotiven, Burgen und Wappen; die Oberfläche drumherum besteht aus Papierkarten mit feiner Doppellinie, goldenen Knöpfen und Bändern.

Im dunklen Systemmodus wird daraus eine **Nachtkarte**: dunkles Papier, helle Tinte, dieselben Formen. Beide Varianten kommen aus denselben Farbtokens.

## 2. Farben

Alle Farben sind Tokens in `apps/web/src/theme.css`; Komponenten verwenden nur die Tokens.

| Rolle | Token | Tag | Nacht |
|---|---|---|---|
| Seite / Papier | `--bg`, `--surface`, `--surface-2` | Pergament `#ecdfc3`, `#fbf5e6`, `#f3e8cf` | `#18140e`, `#251f17`, `#2e271d` |
| Tinte / Text | `--text`, `--muted` | `#2e2116`, `#6b5640` | `#f0e6d0`, `#bba98a` |
| Gold (Knöpfe, Bänder, Akzent) | `--primary-top`, `--primary-bottom`, `--accent` | `#e6b95c` → `#bf8526`, `#b8862f` | `#e8bd66` → `#c48b2b`, `#e0b155` |
| Fokus | `--focus` | `#1f5fbf` | `#8ab8ff` |
| Sitz 1 / 2 / 3 | `--seat-0`, `--seat-1`, `--seat-2` | Königsblau `#2c59a8`, Zinnober `#b23a24`, Tannengrün `#2e7a46` | `#4f7fd0`, `#d0573f`, `#3f9862` |
| Karte | `--map-*` | Meer `#c7d6cd`, Land `#f2e6c6`, Tinte `#3d2b1a` | Meer `#16252b`, Land `#3b3327`, Tinte `#ecdcbc` |

Kontraste (WCAG, nachgerechnet): Text auf Papier 14:1 (Nacht 13:1), gedämpfter Text mindestens 5,2:1, Links 7,7:1 (Nacht 9:1), dunkler Text auf Goldknopf 5,5:1 (Nacht 6,2:1), Kartentinte auf Land 10,8:1 (Nacht 9,2:1). Weiß auf den Sitzfarben der Tagkarte mindestens 5,2:1; in der Nacht sind die Sitzfarben heller und tragen nur Wappenbilder, keinen Text (Grafik mindestens 3,5:1, Sitzfarbe auf Papier mindestens 4:1).

## 3. Schrift

- **Alegreya** (Überschriften, Kartenbeschriftung, Fragen): kalligrafische Antiqua mit Buchcharakter, Schnitte 500, 700, 800.
- **Alegreya Sans** (Fließtext, Knöpfe, Zahlen): ruhig und gut lesbar, Schnitte 400, 500, 700, 800.
- Zahlen stehen auf einer Linie (`lining-nums`), damit Punkte und Zeiten schnell lesbar sind.

Beide Schriften werden mit dem Spiel ausgeliefert (npm-Pakete `@fontsource/*`), nicht über einen fremden Server geladen.

## 4. Karte der Partie

Die Regeln kennen zwei Karten aus Sechseckfeldern (`packages/game-core/src/match-map.ts`): die Wendelmark mit 24 Feldern für drei Spieler und die Kernmark mit 16 Feldern für zwei, die Mitte der Wendelmark (ADR-052). Die Grafik (`apps/web/src/art/map-art.ts`) macht aus jeder eine Landkarte, **ohne die Nachbarschaft zu ändern**:

1. Jede Ecke des Rasters wird leicht verschoben (innen bis 16 % der Feldgröße); Ecken an der Küste wandern zusätzlich nach außen, entlang einer weichen Wölbung mit Buchten und Landzungen. Eingebuchtete Küstenecken wandern weiter hinaus, das glättet den Sägezahn des Rasters.
2. Jede Kante wird per Mittelpunktverschiebung zur unregelmäßigen Linie (innen 3 Stufen, an der Küste 4 Stufen und rauer). Zwei Nachbarn lesen **dieselbe** Linie, deshalb passen die Grenzen lückenlos aneinander.
3. Der Fluss folgt inneren Grenzen von der Nordküste zur Südküste, nahe der Mittelachse; er trennt nichts, was die Regeln nicht trennen.
4. Alles ist deterministisch (eigener Zufall aus `art/noise.ts`, nie für Spielregeln): gleiche Karte, gleiches Bild auf jedem Gerät.

Unit-Tests (`apps/web/test/map-art.test.ts`) sichern für beide Karten: genau die Nachbarn der Regeln teilen eine Grenze, andere Regionen berühren sich nicht; jede Region umschließt ihren Mittelpunkt; alles liegt im Bild; der Fluss läuft von Küste zu Küste entlang von Grenzen.

**Ebenen** (von unten): Meer mit Wellenzeichen, Küstenringe, Land, Aquarellfarbe des Besitzers mit Wappenmuster und dunklerem Rand, gestrichelte Grenzen, Fluss, Küstenlinie, Motive, Namen und Münzen, Hervorhebungen (wählbar, Duell). Das Meer reicht über den ganzen Bildschirm; Titelschild und Kompass gibt es in der Partie nicht mehr, dort liegen Spielstand und Blatt (ADR-059).

**Landschaft je Region** (`art/terrain.ts`, nur Darstellung): Wald, Nadelwald, Gebirge, Hügel, Felder, Wiese, Moor, See, Fluss, Dorf, für die Wendelmark fest zugeordnet (dieselbe Region sieht auf der Kernmark gleich aus), für neue Karten nach Wortteilen des Namens. Daraus folgen die kleinen Motive über dem Namen und an den unteren Ecken.

**Besitz** ist nie nur Farbe: Jeder Sitz hat Farbe, **Wappenbild** (◆ Raute, ● Kugel, ▲ Spitze) und **Muster** (Schrägstreifen, Punkte, Gitter). Die Münze zeigt den Punktwert, das Schildchen daneben den Besitzer.

**Hauptstadt:** Burg mit Fahne in Sitzfarbe, darunter ein Schild je Leben; verlorene Leben bleiben als gestrichelter Umriss stehen.

**Bühne der Partie im Querformat** (`match/MatchStage.tsx`, `match/stage.css`, ADR-059; Grundregel des Product Owners vom 2026-11-11: Der ganze Bildschirm ist die Karte, das Handy wird quer gehalten, Fragen und Bedienung liegen auf der Karte). Die Karte ist die unterste Ebene und füllt den Bildschirm; alles andere liegt auf dem Meer oder mitten auf der Karte:

| Ort | Inhalt |
|---|---|
| Links auf dem Meer (140 Einheiten) | Band mit Abschnitt und Runde, je Sitz eine Tafel (Wappen, Name, Punkte als Münze mit Zahl, Hauptstadtleben als Schilde, Zahl der Regionen, „am Zug“ mit goldenem Rand), darunter die Zugfolge als Wappenreihe, unten Ton und „Verlassen“ |
| Rechts auf dem Meer (192 Einheiten) | das **Blatt** der Phase (`match/StageBlatt.tsx`): sagt, was geschieht und was zu tun ist. Eigene Wahl mit Restzeit (goldener Rand), fremde Wahl mit dem jüngsten Ereignis, Ansage, bei einer Frage wer gegen wen kämpft und die Regel, bei einer Schätzfrage das Ziffernfeld, in der Auflösung der Ausgang des Duells (Rand in der Farbe des Siegers) |
| Mitten auf der Karte | Fragekarte (`match/StageQuestion.tsx`), Auflösung mit den Antworten aller Sitze, Abrechnung (reicht bis an den rechten Rand, das Blatt entfällt). Darunter legt sich ein leichter Schleier (26 %), die Karte bleibt sichtbar |
| Über der Karte | Band der großen Momente, Fehlerhinweis der Abfrage |

Regeln der Bühne:

- **Die Karte steht fest.** Der Ausschnitt (`art/stage-frame.ts`, `match/useStageFrame.ts`) legt das Land genau in die freie Fläche zwischen Spielstand und Blatt, mittig und so groß wie möglich. Er hängt nur an der Größe des Bildschirms, nie am Zustand der Partie; beide Ränder sind in jedem Zustand gleich breit. Nichts scrollt (`html.match-playing`).
- **Ein Maß für alle Geräte.** Alle Maße der Bühne rechnen in der Einheit `--u` = kleinerer Wert aus Breite / 844 und Höhe / 340, begrenzt auf 0,7 bis 1,6 px; auch die Schriftgröße der Seite folgt ihr, solange die Bühne steht. Das Grundmaß 844 × 340 ist ein iPhone quer in Safari mit Adressleiste. Kleinere Handys bekommen dasselbe Bild kleiner, Tablets und Rechner größer, ohne eigene Aufteilung.
- **Ränder des Geräts:** Links und rechts hält die Bühne den sicheren Bereich frei (`env(safe-area-inset-*)`, Kerbe und Ecken des iPhones), mindestens 8 Einheiten.
- **Was über den Regionen liegt, nimmt keine Tipps an** (Band, Schleier, Ringe, Motive, die Aufstellung eines Duells). Blätter liegen nie über einer Region, die gerade wählbar ist: Solange gewählt wird, ist die Mitte frei.
- **Fragekarte:** Art der Frage als Band, Restzeit als Zahl und Lunte, die Frage, bei einer Wissensfrage vier Antworten in zwei Spalten mit Buchstaben. Lange Fragen und Antworten bekommen eine kleinere Schrift, die Karte wächst nicht über den Bildschirm. Nach der eigenen Antwort bleibt sie stehen, die gewählte Antwort ist markiert: Bis zur Auflösung springt nichts.
- **Schätzfrage:** Die Zahl steht groß in der Fragekarte, getippt wird auf dem Ziffernfeld im Blatt (`match/NumPad.tsx`: zwölf Tasten, darunter „Antwort abgeben“). Die Tastatur des Handys bleibt zu; mit einer echten Tastatur gehen Ziffern, Komma, Rücktaste und Enter. Ohne Nachkommastellen ist das Komma aus; ab fünf Stellen gliedert die Anzeige mit Punkten.
- **Hochformat am Handy** (bis 600 px Breite): Über der Karte steht nur die Bitte „Bitte dreh dein Handy quer“ (`match/RotateHint.tsx`) mit dem Hinweis auf die Ausrichtungssperre. Die Partie läuft weiter; zurück im Querformat steht alles wie vorher. Tablets und Fenster im Hochformat behalten die Bühne, nur mit mehr Meer.
- **Vor dem Start und nach einem Abbruch** gibt es noch keine Karte der Partie: Dann liegt die Aufstellung (oder der Abbruch) als Blatt vor der Wendelmark als Schmuckbild.

Geprüft mit Bildern aller Zustände bei 844 × 340 und der wichtigsten bei 844 × 390, 667 × 375, 568 × 320 und 1280 × 720, Tag- und Nachtkarte.

**Ansage** (`match/AnnouncePanel.tsx`, [MATCH_RULES.md §5](MATCH_RULES.md#ansage)): Die Partie hält nach jeder Wahl und vor jedem Duell kurz an, damit man sieht, was geschieht, bevor das Nächste kommt. Die Karte zeigt es, das Blatt rechts sagt es in einem Satz. Nach einer Wahl zieht sich ein Ring in der Farbe des Sitzes um die gewählte Region. Vor einem Duell stellt die Karte es auf (siehe „Duell auf der Karte“); der Titel ist aus der eigenen Sicht geschrieben („Du wirst in Fuchsmoor angegriffen!“ in Rot, „Dein Angriff auf …“, sonst „Angriff auf …“) und nennt die Hauptstadt, wenn sie das Ziel ist. Darunter steht mit Wappen, wer wen angreift. Es gibt nichts zu tun: Die Zeit läuft nur als schmaler Strich ohne Zahl.

**Auflösung** (`match/RevealPanel.tsx`): Blatt mitten auf der Karte mit der Frage und **wer was geantwortet hat**, aufgebaut wie die Fragekarte (Antworten in zwei Spalten an derselben Stelle). Was daraus folgt, steht nach einem Duell im Blatt rechts (Wappen des Siegers, Rand in seiner Farbe, klein darunter der Grund), sonst als Satz über der Frage. Bei einer Wissensfrage steht jeder Sitz als Plättchen (Wappen und Name, `match/SeatChip.tsx`) an der Antwort, die er gewählt hat; die richtige Antwort ist grün mit Haken, eine gewählte falsche rot mit Kreuz, wer nicht geantwortet hat, steht darunter. Bei einer Schätzfrage stehen die Sitze in der Rangfolge untereinander, mit Schätzung, Abstand und Zeit, in der Landnahme daneben, wie viele Regionen der Platz wählt. Die umkämpfte Region behält bis zum nächsten Zug einen Rand in der Farbe des Siegers. Richtig und falsch stehen nie nur in der Farbe (Haken, Kreuz, für Vorleseprogramme „richtig“).

**Duell auf der Karte** (`match/MatchBoard.tsx`, `art/attack.ts`, ADR-054; Wunsch des Product Owners vom 2026-11-11: gut erkennbar und direkt auf der Karte, wer wen wo angreift, und nach dem Angriff erst kurz der Ausgang). Ein Duell spielt auf der Karte in vier Bildern; das Blatt rechts sagt dasselbe in Worten.

1. **Aufmarsch** (Ansage): Alles außer den beiden beteiligten Regionen tritt unter einem dunklen Schleier zurück (`--map-veil`). In der Mitte der Region, aus der angegriffen wird, erscheint das Wappen des Angreifers als Plättchen; ein Blockpfeil in seiner Farbe schießt über die gemeinsame Grenze; in der Mitte der umkämpften Region stellt sich das Wappen des Verteidigers dagegen. Wo ein Plättchen steht, weichen Name, Münze und Motive. Ist das Ziel eine Hauptstadt, steht ihre Burg für den Verteidiger: Es gibt kein zweites Plättchen, der Pfeil endet kurz hinter der Grenze, und nur der Name weicht, damit Burg und Leben frei bleiben. Die Regeln sagen nicht, von wo angegriffen wird; das Bild nimmt die angrenzende eigene Region, die der Hauptstadt des Angreifers am nächsten liegt, bei Gleichstand die mit der kleineren Nummer.
2. **Stand** (Frage): Dasselbe Bild steht ruhig, solange die Frage läuft. Für den, der antwortet, liegt die Fragekarte mit dem Schleier darüber; das Blatt rechts nennt beide Seiten (`match/DuelHeader.tsx`). Wer zuschaut, sieht das Duell frei auf der Karte.
3. **Ausgang** (erster Takt der Auflösung): Bevor die Antworten erscheinen, zeigt die Karte, wie es ausging (Bewegungen in §5). Im Blatt rechts steht dazu ein Satz aus der eigenen Sicht mit dem Wappen des Siegers (`match/OutcomePanel.tsx`); er bleibt stehen, bis die Auflösung endet: „Du eroberst Hagelstein!“, „Du hältst Graufurt!“, „Dein Angriff auf Graufurt scheitert.“, „Du verlierst Hagelstein.“, für Zuschauer „… erobert …“ oder „… hält …“; ein eigener Sieg steht in Grün, ein eigener Verlust in Rot, nie nur in der Farbe (der Satz sagt es). Vorleseprogramme bekommen hier schon den ganzen Satz der Auflösung.
4. **Danach** (Rest der Auflösung): Der Schleier hebt sich, die Namen stehen wieder, die umkämpfte Region trägt einen Rand in der Farbe des Siegers, das Blatt mit den Antworten erscheint mitten auf der Karte.

Der erste Takt gehört zur Auflösung des Servers und verlängert die Partie nicht: Er dauert ein Viertel der Auflösung, höchstens 1,5 s (`outcomeBeatMs`, `match/useOutcomeBeat.ts`), und entfällt, wenn von der Auflösung weniger als das Doppelte übrig ist (Seite mitten in der Auflösung neu geladen). Endet eine Wissensfrage unentschieden, bleibt die Aufstellung über der Auflösung stehen, bis die Schätzfrage das Duell entscheidet. Steht ein Duell in der oberen Hälfte der Karte, weicht ein Band („Runde 2 von 4“, „Ein Reich fällt!“) an den unteren Kartenrand, damit es Wappen und Burg nicht verdeckt.

**Zugfolge** (`match/TurnOrder.tsx`, [MATCH_RULES.md §3](MATCH_RULES.md#zugfolge)): eine schmale Zeile unter dem Spielstand. Je Zug Nummer und Wappen; die Namen stehen direkt darüber auf den Tafeln und hier nur für Vorleseprogramme (der eigene Sitz heißt „Du“). Wer dran ist, ist golden hervorgehoben; wer dran war, trägt einen Haken und tritt zurück; wer noch kommt, bleibt schlicht. Bei der Schätzfrage der Landnahme sind alle zugleich dran und stehen ohne Nummer nebeneinander. Der Zustand steht nie nur in der Farbe (Haken, Nummer, für Vorleseprogramme „war dran“, „ist dran“, „kommt noch“). Die Zeile hat feste Höhe und bewegt sich nicht; nach der Abrechnung entfällt sie.

**Aufstellung** (`match/LobbyPanel.tsx`): ein Blatt in zwei Spalten. Links die Plätze untereinander (Wappen und Name, beim Gastgeber auf freien Plätzen „Bot dazu“, bei Bots die Stärke und „Entfernen“) und die Hinweise zu Bots, zur Karte je Spielerzahl und zu den Zeiten; rechts der Einladungscode als Plättchen mit „Link kopieren“ (darf der Browser nicht kopieren, steht der Link zum Markieren da), darunter „Partie starten“ und „Partie absagen“. Das Blatt passt ohne Scrollen auf ein quer gehaltenes Handy. Die Seite hinter dem Link (`screens/JoinScreen.tsx`) zeigt denselben Code und einen einzigen großen Knopf; sie und die Übersicht der Partien bleiben hochkant bedienbar und sind nie breiter als der Bildschirm (geprüft von 320 bis 430 px).

**Partie mit Ausbau** (`match/RealmStage.tsx`, `match/realm.css`, ADR-060, [MATCH_RULES.md §11](MATCH_RULES.md#11-ausbau-burgen-dörfer-armeen); nach den am 2026-11-11 freigegebenen Bildentwürfen). Die Bühne ist dieselbe wie ohne Ausbau: Karte im Vollbild, links die Reiche, rechts das Blatt, Fragen mitten auf der Karte. Neu ist, was darauf steht:

| Ort | Inhalt |
|---|---|
| Karte (`match/RealmBoardArt.tsx`) | Dorf und Stadt als Zeichnung mit Fahne in der Farbe des Reichs, die Burg wie bisher die Hauptstadt mit einem Schild je Leben, Armeen als Banner mit Zahl. In der Rüstzeit treten fremde Felder zurück, das gewählte Feld trägt einen goldenen Rand, mögliche Ziele eines Zugs einen gestrichelten; ein geplanter Bau steht blass mit goldenem Plus, ein geplanter Kauf als goldenes „+2“ am Banner, ein Zug als Pfeil mit Zahl. Nach einem Duell steht am Feld ein Schildchen mit dem, was sich geändert hat |
| Links (`match/RealmSeatList.tsx`) | je Reich eine Tafel: Wappen, Name, Punkte als Münze mit Zahl, daneben die Leben der Burgen als Schilde (ab vier Leben ein Schild mit Zahl), darunter Brot und Baustoff als Zeichen mit Zahl. In der Rüstzeit steht im Fuß „✓ fertig“ oder „rüstet“, bei einer Wahl „am Zug“ mit goldenem Rand |
| Rechts, Rüstzeit (`match/PreparePanel.tsx`) | oben der Vorrat, wie er nach den geplanten Befehlen bliebe, daneben der Tausch („3:1“); in der Mitte das angetippte Feld mit Name, Ertrag und immer denselben drei Knöpfen **Bauen, Kaufen, Ziehen** (was auf dem Feld nicht geht, ist ausgegraut) und darunter, was der gewählte Knopf anbietet, mit Preis; unten die eigenen Befehle als Plättchen (ein Tipp nimmt einen zurück) und „Fertig“. Nach der Abgabe stehen die Befehle fest da mit „Befehle ändern“ |
| Rechts, übrige Phasen (`match/RealmBlatt.tsx`) | Burg, Dorf oder Feld setzen mit Restzeit; **Angriff in zwei Schritten**: Ein Tipp auf ein markiertes Feld zeigt das Ziel, die Lose beider Seiten im Glücksrad und was ein Sieg bewirkt, erst „Angreifen“ schickt die Wahl; „Aufgedeckt“ mit einer Zeile je Reich; Glücksrad mit beiden Seiten, ihren Losen und am Ende der Kategorie; während einer Frage, wer gegen wen kämpft und **wer schon geantwortet hat**; Ausgang des Duells mit den Folgen als Liste und dem, was als Nächstes kommt |
| Mitten auf der Karte | Glücksrad als runde Scheibe (`match/Wheel.tsx`), Fragekarte mit Zeichen und Name der Kategorie, Auflösung, Abrechnung mit der Spalte „Burgen“ |
| Vor dem Start (`match/RealmLobby.tsx`) | erst das Blatt „Deine Lieblingskategorien“ (Kacheln mit Zeichen, Zähler „3 von 4 gewählt“, Kategorien ohne genug Fragen ausgegraut; daneben die Mitspieler mit „hat gewählt“ oder „wählt noch“ und „Partie starten“), dahinter das Blatt mit Plätzen, Einladungslink und Bots wie ohne Ausbau |

Regeln des Ausbaus:

- **Zeichen statt Wörter, wo der Platz knapp ist** (`art/RealmIcons.tsx`, eigene Tuschezeichnungen, [ASSETS.md](ASSETS.md)): Brot, Baustoff, Armee, Dorf, Stadt, Burg, Tausch, Zug und je Kategorie des Glücksrads eines. Jedes Zeichen hat für Vorleseprogramme einen Namen; der Vorrat heißt dort „Vorrat“, sichtbar stehen nur Zeichen und Zahl, damit zweistellige Vorräte in die Zeile passen.
- **Das Glücksrad** zeigt jede Kategorie als Feld, so breit wie ihre Chance; die Farbe am Rand eines Felds zeigt, wessen Lieblingskategorie es ist (Angreifer, Verteidiger, beide), der Rest ist frei. Kategorien ohne ungestellte Frage fehlen. Was gezogen wurde, sagt immer auch das Blatt in Worten, samt „liegt dir“, „liegt euch beiden“ oder „liegt keinem von beiden“.
- **Geplant ist blass, beschlossen ist kräftig.** Was der Spieler in der Rüstzeit einstellt, steht sofort als Vorschau auf der Karte und im Vorrat; gerechnet wird mit den Regeln des Servers (`planRealmOrders`), entschieden wird erst dort. Fällt mit einem zurückgenommenen Befehl ein späterer weg, sagt das Blatt es in einem Satz.
- **Alle Blätter rechts sind gleich groß**, auch das der Rüstzeit: Ab fünf Befehlen zeigen Bauten nur noch ihr Zeichen, damit alle in zwei Zeilen passen. Die Karte rückt in keiner Phase.
- **Tipps:** In der Rüstzeit sind nur eigene Felder antippbar, beim Angriff nur die markierten Ziele. Gebäude, Banner, Pläne, Pfeile und das Rad nehmen keine Tipps an.

Abweichungen von den Bildentwürfen, alle aus Platzgründen bei 844 × 340: Das Wort „Vorrat“ entfällt sichtbar; Burgleben stehen neben den Punkten und der Stand der Rüstzeit im Fuß der Tafel; der Tausch steht als Plättchen „6 → 2“; „Streichen“ statt „Zurücknehmen“; die Aufstellung hat zwei Blätter statt einem. Geprüft mit Bildern aller 28 Phasen bei 844 × 340, 844 × 390 und 667 × 375, Tag- und Nachtkarte.

## 5. Bewegung

| Anlass | Bewegung |
|---|---|
| Region erobert | Die neue Farbe breitet sich von der Mitte aus wie Tinte (0,9 s); nach einem Duell läuft sie von der Grenze her ein, über die der Angreifer kam, und die alte Farbe bleibt darunter stehen, bis sie überdeckt ist |
| Region befestigt (Wert steigt) | Die Münze springt kurz (nach einem Duell erst, wenn die Beschriftung wieder steht) |
| Hauptstadt getroffen | Die Burg wackelt, ein Schild kippt weg (nach einem Duell in dem Augenblick, in dem der Schlag sitzt) |
| Du bist dran | Goldenes Band „Du bist dran!“ über der Karte (1,5 s, höchstens bis die eigene Wahl getroffen ist; es steht nie über der Ansage eines anderen); das Blatt und die eigene Tafel tragen einen goldenen Rand, ohne Bewegung |
| Wählbare Regionen | Goldener, laufender Strichrand und sanftes Leuchten |
| Duell: Aufmarsch (Ansage, 1,2 s) | Der Schleier legt sich über die übrige Karte (0,35 s); das Wappen des Angreifers stempelt sich in seine Region (ab 0,12 s), der Pfeil schießt über die Grenze (ab 0,45 s), der Verteidiger stellt sich dagegen (ab 0,7 s). Danach drängen Angreifer und Pfeil im Takt des rot pulsierenden Rands gegen die umkämpfte Region, der Verteidiger gibt leicht nach. Im Blatt rechts stehen sich die Wappen von Angreifer und Verteidiger gegenüber (ohne Bewegung) |
| Duell: Ausgang, Region erobert | Das Wappen des Angreifers rückt in die Mitte der Region vor, das des Verteidigers kippt weg; ein Ring schlägt am Ziel aus, die Farbe des Siegers läuft von der Grenze her ein; nach 0,9 s steht die neue Beschriftung, das Wappen geht |
| Duell: Ausgang, Hauptstadt getroffen | Das Wappen des Angreifers stößt bis zur Burg vor und kehrt zurück; die Burg wackelt, ein Schild kippt weg, der Ring schlägt in Warnrot aus |
| Duell: Ausgang, Reich fällt | Wie eine Eroberung; die Burg stürzt, und die Farbe des Siegers läuft von der Hauptstadt aus Region um Region durch das Reich (0,12 s je Feld Abstand) |
| Duell: Ausgang, Verteidigung hält | Der Pfeil prallt ab und verblasst, das Wappen des Angreifers wird zurückgeworfen und verblasst, das des Verteidigers richtet sich auf; danach springt die Münze mit dem neuen Wert |
| Große Momente | Band über der Karte (1,5 s): „Die Landnahme beginnt“, „Der Feldzug beginnt“, „Runde 2 von 4“ (letzte Runde mit Hinweis), Tintenband; „Ein Reich fällt!“ in der Farbe und mit dem Wappen des Siegers. Ankündigungen erst, wenn gewählt wird; mehrere nacheinander. Das Band steht schmal am oberen Kartenrand zwischen Spielstand und Blatt, damit die Regionen frei bleiben; Tipps gehen durch das Band hindurch |
| Punkte ändern sich | Die Zahl zählt hoch (0,7 s) |
| Gezeigte Wahl (Ansage) | Ein Ring in der Farbe des Sitzes zieht sich um die gewählte Region (0,5 s) und bleibt stehen, bis es weitergeht |
| Auflösung | Das Blatt erscheint mitten auf der Karte (0,3 s), die richtige Antwort ist grün mit Haken; der Ausgang im Blatt rechts stempelt sich ein |
| Sieg | Lorbeerkranz mit Krone und kreisendem Strahlenkranz |
| Glücksrad (mit Ausbau) | Die Scheibe dreht drei Umdrehungen und läuft unter dem Zeiger aus; das dauert 65 % der Ansage (`wheelMs`), danach steht sie mit goldenem Rand um das gezogene Feld, und das Blatt nennt die Kategorie. Wird die Seite mitten in der Ansage geladen, läuft das Rad von der Stelle weiter, an der es wäre |
| Aufgedeckt (mit Ausbau) | Ohne Bewegung: Was eben gebaut, gekauft oder gezogen wurde, trägt einen goldenen Schein, Züge stehen als Pfeil mit Zahl, solange das Blatt „Aufgedeckt“ steht |
| Ausgang mit Ausbau | Wie ohne Ausbau; dazu steht am Feld ein Schildchen in der Farbe des Siegers („erobert“, „Dorf zerstört“, „Stadt wird Dorf“, „Burg getroffen“, „Burg zerstört“, „Reich fällt“, „gehalten“) |

Regeln:

- **Keine Bewegung, solange die eigene Antwortzeit läuft** (ARCHITECTURE §15): Frage und Antworten stehen sofort da; auf der Karte springen laufende Änderungen auf ihr Endbild, und Dauerbewegungen ruhen. Das gilt für den Zustand, in dem dieser Spieler antwortet. Wer schon geantwortet hat oder zuschaut, wird bei nichts gestört: Dort drängen die Wappen des Duells weiter leicht gegeneinander und zeigen, dass es läuft. Die Animationen werden dafür auf einen Durchlauf ohne Dauer gestellt und nicht abgeschaltet: Mit `animation: none` liefen nach der Frage alle noch einmal an, und die ganze Karte färbte sich unter dem Ausgang des Duells neu ein.
- Der Grundzustand jedes Elements ist sein Endbild; die Bewegung führt nur dorthin. So stimmt das Bild auch ohne Bewegung (Frage, „Bewegung reduzieren“).
- Eine Animation, die an einem dauerhaften Zustand hängt (Farbe einer Region, getroffene Burg), behält ihren Namen, solange der Zustand gilt; Ursprung und Takt ändern sich über Variablen. Ein anderer Name ließe sie neu anlaufen.
- Bewegte Teile der Karte sind Gruppen (`<g>` mit `transform-box: fill-box`), nie `<use>`, und tragen keinen CSS-Filter (Schatten als eigene Form): Beides ruckelt oder verrutscht in WebKit.
- Beim ersten Aufbau einer Seite laufen keine Änderungsanimationen, nur bei echten Änderungen.
- „Bewegung reduzieren“ im System schaltet alle Animationen ab (CSS `prefers-reduced-motion`, auch die Zählanimation).

## 5a. Klänge

Elf kurze Klänge, im Browser erzeugt (Web Audio, keine Dateien, `apps/web/src/audio/sound.ts`, Liste in [ASSETS.md](ASSETS.md)): Horn, Federstrich, Holzklick, Glocke, dumpfer Schlag, Trommel, Schildklang, Donner, fallende Folge, Fanfare. Regeln:

- Schalter „Ton“ links unten auf dem Meer neben „Verlassen“; die Wahl bleibt im Browser gespeichert, Standard ist an.
- Ton erst nach der ersten Berührung oder Taste (Regel der Browser), nichts beim ersten Aufbau einer Seite.
- Während einer laufenden Frage nur der Klick der eigenen Antwort; Ergebnis und Folgen klingen in der Auflösung, die eigene Antwort zuerst, die Folge des Duells kurz danach.
- Sieg oder Niederlage klingen erst, wenn die Abrechnung erscheint, nicht schon in der Auflösung des letzten Duells (ADR-055): Dort gehört der Klang dem Ausgang auf der Karte.

## 6. Bausteine im Code

| Datei | Inhalt |
|---|---|
| `apps/web/src/theme.css` | Tokens, Schriften, Seitenhintergrund mit Papierkorn |
| `apps/web/src/styles.css` | Knöpfe, Karten, Formulare, Quiz, Bausteine der Partie (Ansage, Ausgang, Auflösung, Abrechnung, Aufstellung), Bewegungen |
| `apps/web/src/match/stage.css` | Bühne der Partie im Querformat: Maßeinheit `--u`, Ränder, Blatt, Fragekarte, Ziffernfeld, Hinweis im Hochformat (ADR-059) |
| `apps/web/src/art/map-art.ts` | Geometrie der Landkarte |
| `apps/web/src/art/ArtDefs.tsx` | Motive als SVG-Symbole, Wappenmuster, Papierfilter |
| `apps/web/src/art/map-art.css` | Aussehen und Bewegungen der Karte |
| `apps/web/src/art/SeatCrest.tsx`, `LifeShields.tsx`, `Emblem.tsx`, `HeroMap.tsx`, `CountUp.tsx` | Wappen je Sitz, Hauptstadtleben als Schilde (Spielstand und Abrechnung), Spielwappen, Kartenbild der Startseite, zählende Zahlen |
| `apps/web/src/match/MatchStage.tsx`, `StageBlatt.tsx`, `StageQuestion.tsx`, `NumPad.tsx`, `estimate-input.ts`, `RotateHint.tsx` | Bühne der Partie, Blatt der Phase, Fragekarte, Ziffernfeld der Schätzfrage und seine Eingaberegeln, Hinweis im Hochformat |
| `apps/web/src/art/stage-frame.ts`, `match/useStageFrame.ts` | Ausschnitt der Karte: Land zwischen Spielstand und Blatt |
| `apps/web/src/match/SeatList.tsx` | Spielstand als Tafeln links auf dem Meer |
| `apps/web/src/match/MatchBoard.tsx`, `art/attack.ts` | Karte der Partie mit Bedienung, Aufstellung und Ausgang eines Duells |
| `apps/web/src/match/OutcomePanel.tsx`, `useOutcomeBeat.ts` | Ausgang eines Duells im Blatt, erster Takt der Auflösung |
| `apps/web/src/match/moments.ts`, `useMoments.ts`, `DuelHeader.tsx` | Große Momente als Band, wer gegen wen im Duell |
| `apps/web/src/match/AnnouncePanel.tsx`, `RevealPanel.tsx`, `SeatChip.tsx` | Ansage (gezeigte Wahl, Duell), Auflösung mit den Antworten aller Sitze, Sitz als Plättchen |
| `apps/web/src/match/TurnOrder.tsx` | Zugfolge unter dem Spielstand |
| `apps/web/src/audio/sound.ts`, `match/sound-cues.ts`, `components/SoundToggle.tsx` | Klänge, ihre Anlässe, Ton-Schalter |
| `apps/web/src/match/RealmStage.tsx`, `realm.css`, `realm-model.ts`, `realm-text.ts`, `realm-layer.ts` | Bühne der Partie mit Ausbau, ihr Aussehen, Ableitungen aus den Regeln (was auf einem Feld geht, Entwurf der Befehle), Texte, Ebene der Karte (ADR-060) |
| `apps/web/src/match/PreparePanel.tsx`, `RealmBlatt.tsx`, `RealmSeatList.tsx`, `RealmLobby.tsx`, `Wheel.tsx`, `RealmBoardArt.tsx` | Blatt der Rüstzeit, Blatt der übrigen Phasen, Tafeln mit Vorrat, Aufstellung mit Lieblingskategorien, Glücksrad, Gebäude, Armeen und Pläne auf der Karte |
| `apps/web/src/art/RealmIcons.tsx`, `match/Answers.tsx` | Zeichen des Ausbaus (Rohstoffe, Gebäude, Armee, Tausch, Zug, Kategorien); Liste, wer schon geantwortet hat (beide Spielarten) |
| `apps/web/src/art/Icons.tsx`, `match/LobbyPanel.tsx` | Tuschezeichen der Partie-Seite, Aufstellung mit Code-Plättchen und Platzzeilen, Bots setzen |

Neue Grafik entsteht als SVG im Code oder als Datei mit Eintrag in [ASSETS.md](ASSETS.md). Farben nur über Tokens, Bewegungen mit Abschaltung bei „Bewegung reduzieren“.

## 7. Nächste Schritte

- Eternal-Karte (PixiJS) im selben Stil, sobald Eternal weitergeht (ruht seit 2026-11-10).
- Weitere Partiekarten: brauchen nur neue Felder und Namen, die Grafik entsteht automatisch (so entstand die Kernmark).
