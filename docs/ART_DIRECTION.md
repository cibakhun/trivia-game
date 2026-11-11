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

**Ebenen** (von unten): Meer mit Wellenzeichen, Küstenringe, Land, Aquarellfarbe des Besitzers mit Wappenmuster und dunklerem Rand, gestrichelte Grenzen, Fluss, Küstenlinie, Motive, Namen und Münzen, Hervorhebungen (wählbar, Duell), Kompass und Titelschild.

**Landschaft je Region** (`art/terrain.ts`, nur Darstellung): Wald, Nadelwald, Gebirge, Hügel, Felder, Wiese, Moor, See, Fluss, Dorf, für die Wendelmark fest zugeordnet (dieselbe Region sieht auf der Kernmark gleich aus), für neue Karten nach Wortteilen des Namens. Daraus folgen die kleinen Motive über dem Namen und an den unteren Ecken.

**Besitz** ist nie nur Farbe: Jeder Sitz hat Farbe, **Wappenbild** (◆ Raute, ● Kugel, ▲ Spitze) und **Muster** (Schrägstreifen, Punkte, Gitter). Die Münze zeigt den Punktwert, das Schildchen daneben den Besitzer.

**Hauptstadt:** Burg mit Fahne in Sitzfarbe, darunter ein Schild je Leben; verlorene Leben bleiben als gestrichelter Umriss stehen.

**Handy hochkant** (bis 560 px): enger Ausschnitt nur um die Insel, ohne Titelschild und Kompass, größere Namen und Münzen.

**Laufende Partie auf Handy und Tablet hochkant** (bis 900 px breit, ab 500 px hoch): eine feste Bildschirmseite, auf der nichts scrollt und nichts springt. Oben Phase, Spielstand und Zugfolge, in der Mitte die Karte, immer an derselben Stelle und in derselben Größe, unten ein Blatt.

| Zustand | Blatt |
|---|---|
| Wahl (eigene und fremde) | Leiste unter der Karte: Auftrag, Restzeit, beim Warten das letzte Ereignis. Die Karte ist ganz frei |
| Ansage (ADR-053) | dieselbe Leiste, ganz gefüllt und mittig gesetzt: nach einer Wahl ein Satz mit dem Wappen dessen, der gewählt hat; vor einem Duell als Titel, wo angegriffen wird, darunter als Plättchen, wer wen angreift. Die Karte ist ganz frei |
| Frage | festes Blatt über der Karte, von oben gefüllt. Ein Hinweis unter dem Knopf verschiebt nichts |
| Gespeichert, verpasst, zuschauen | niedriges Blatt, die Karte bleibt darüber sichtbar |
| Auflösung | Blatt bis höchstens 78 % der Fläche, so hoch wie sein Inhalt und ohne Scrollen; oben bleibt die Karte sichtbar. Auf dem Handy stehen von den Antwortmöglichkeiten nur die richtige und die gewählten da, die Erklärung entfällt |

Der Spielstand hat feste Höhe (Punkte und Schilde in zwei Zeilen, auch bevor es Schilde gibt), der Verlauf entfällt. Regeln dazu: Was über den Regionen liegt (Ränder, Ringe, Motive, Pfeil), nimmt keine Tipps an; das Blatt bekommt seinen Platz über das Raster, nie über den Seitenlauf. Ein Handy im Querformat ist dafür zu niedrig und behält Karte und Blatt nebeneinander.

Damit die Seite auch am iPhone fest steht (Rückmeldung vom 2026-11-11: die Karte saß zu tief und unter der Leiste, die Seite ließ sich verschieben): Die Karte liegt in einem eigenen Rahmen (`.board-frame`), der sein Rasterfeld füllt, und füllt diesen Rahmen; ein SVG mit `height: 100%` direkt im Raster wird in WebKit so hoch wie das ganze Raster. Solange die Partie läuft, scrollt auch das Dokument nicht (`html.match-playing`), und die Mindesthöhe der Seite rechnet mit dem sichtbaren Bereich (`100dvh`), nicht mit dem Bildschirm hinter der Adressleiste.

**Ansage** (`match/AnnouncePanel.tsx`, [MATCH_RULES.md §5](MATCH_RULES.md#ansage)): Die Partie hält nach jeder Wahl und vor jedem Duell kurz an, damit man sieht, was geschieht, bevor das Nächste kommt. Die Karte zeigt es, die Leiste sagt es in einem Satz. Nach einer Wahl zieht sich ein Ring in der Farbe des Sitzes um die gewählte Region. Vor einem Duell steht der Pfeil des Angreifers auf der umkämpften Region; der Titel ist aus der eigenen Sicht geschrieben („Du wirst in Fuchsmoor angegriffen!“ in Rot, „Dein Angriff auf …“, sonst „Angriff auf …“) und nennt die Hauptstadt, wenn sie das Ziel ist. Darunter steht mit Wappen, wer wen angreift. Es gibt nichts zu tun: Die Zeit läuft nur als schmaler Strich ohne Zahl.

**Auflösung** (`match/RevealPanel.tsx`): oben in einem Satz, was daraus folgt, mit dem Wappen des Siegers und einem Rand in seiner Farbe, klein darunter der Grund. Darunter die Frage und **wer was geantwortet hat**: Bei einer Wissensfrage steht jeder Sitz als Plättchen (Wappen und Name, `match/SeatChip.tsx`) an der Antwort, die er gewählt hat; die richtige Antwort ist grün mit Haken, eine gewählte falsche rot mit Kreuz, wer nicht geantwortet hat, steht darunter. Bei einer Schätzfrage stehen die Sitze in der Rangfolge untereinander, mit Schätzung, Abstand und Zeit, in der Landnahme daneben, wie viele Regionen der Platz wählt. Der Angriffspfeil bleibt auf der Karte, bis es weitergeht. Richtig und falsch stehen nie nur in der Farbe (Haken, Kreuz, für Vorleseprogramme „richtig“).

**Zugfolge** (`match/TurnOrder.tsx`, [MATCH_RULES.md §3](MATCH_RULES.md#zugfolge)): eine Zeile zwischen Spielstand und Karte, auf jedem Gerät. Je Zug ein Plättchen mit Nummer, Wappen und Name; der eigene Sitz heißt „Du“. Wer dran ist, ist golden hervorgehoben; wer dran war, trägt einen Haken und einen gestrichelten Rand; wer noch kommt, bleibt schlicht. Bei der Schätzfrage der Landnahme sind alle zugleich dran und stehen ohne Nummer nebeneinander. Der Zustand steht nie nur in der Farbe (Haken, Nummer, für Vorleseprogramme „war dran“, „ist dran“, „kommt noch“). Die Zeile hat feste Höhe und bewegt sich nicht: Lange Namen werden gekürzt, am Handy entfällt die Überschrift, nach der Abrechnung die ganze Zeile.

**Aufstellung** (`match/LobbyPanel.tsx`): Der Einladungscode steht in einer Zeile, die Plättchen schrumpfen mit der Breite, darunter der Knopf „Link kopieren“ (darf der Browser nicht kopieren, steht der Link zum Markieren da). Die Seite hinter dem Link (`screens/JoinScreen.tsx`) zeigt denselben Code und einen einzigen großen Knopf; keine Seite der Partie ist breiter als der Bildschirm (geprüft von 320 bis 430 px). Die Plätze stehen untereinander: Wappen und Name, beim Gastgeber auf freien Plätzen „Bot dazu“, bei Bots die Stärke und „Entfernen“. Darunter Hinweise zu Bots, zur Karte je Spielerzahl und zu den Zeiten.

## 5. Bewegung

| Anlass | Bewegung |
|---|---|
| Region erobert | Die neue Farbe breitet sich von der Mitte aus wie Tinte (0,9 s) |
| Region befestigt (Wert steigt) | Die Münze springt kurz |
| Hauptstadt getroffen | Die Burg wackelt, ein Schild kippt weg |
| Du bist dran | Goldenes Band „Du bist dran!“ über der Karte (1,5 s, höchstens bis die eigene Wahl getroffen ist; es steht nie über der Ansage eines anderen), die Karte der Anweisung leuchtet |
| Wählbare Regionen | Goldener, laufender Strichrand und sanftes Leuchten |
| Duell | Rot pulsierender Rand um die umkämpfte Region; ein Pfeil in der Farbe des Angreifers zeichnet sich aus seiner angrenzenden Region (nahe seiner Hauptstadt) hinein, das Siegel mit gekreuzten Schwertern sitzt auf der Grenze. Pfeil und Siegel suchen sich eine Lage, die keine Namen, Münzen und Burgen verdeckt, und liegen über den Landschaftsmotiven, aber unter Namen und Münzen, damit ein Name auch im engsten Fall lesbar bleibt. Im Fragekopf stehen sich die Wappen von Angreifer und Verteidiger gegenüber (ohne Bewegung) |
| Große Momente | Band über der Karte (1,5 s): „Die Landnahme beginnt“, „Der Feldzug beginnt“, „Runde 2 von 4“ (letzte Runde mit Hinweis), Tintenband; „Ein Reich fällt!“ in der Farbe und mit dem Wappen des Siegers. Ankündigungen erst, wenn gewählt wird; mehrere nacheinander. Während gewählt wird und in der Handy-Ansicht steht das Band schmal am oberen Kartenrand, damit die Regionen frei bleiben; Tipps gehen durch das Band hindurch |
| Punkte ändern sich | Die Zahl zählt hoch (0,7 s) |
| Gezeigte Wahl (Ansage) | Ein Ring in der Farbe des Sitzes zieht sich um die gewählte Region (0,5 s) und bleibt stehen, bis es weitergeht |
| Auflösung | Die Karte rollt sich auf, die richtige Antwort leuchtet grün, Zeilen erscheinen nacheinander |
| Sieg | Lorbeerkranz mit Krone und kreisendem Strahlenkranz |

Regeln:

- **Keine Bewegung, solange die Zeit einer Frage läuft** (ARCHITECTURE §15): Frage und Antworten stehen sofort da, und die Dauerbewegungen der Karte ruhen.
- Beim ersten Aufbau einer Seite laufen keine Änderungsanimationen, nur bei echten Änderungen.
- „Bewegung reduzieren“ im System schaltet alle Animationen ab (CSS `prefers-reduced-motion`, auch die Zählanimation).

## 5a. Klänge

Elf kurze Klänge, im Browser erzeugt (Web Audio, keine Dateien, `apps/web/src/audio/sound.ts`, Liste in [ASSETS.md](ASSETS.md)): Horn, Federstrich, Holzklick, Glocke, dumpfer Schlag, Trommel, Schildklang, Donner, fallende Folge, Fanfare. Regeln:

- Schalter „Ton“ in der Kopfzeile der Partie; die Wahl bleibt im Browser gespeichert, Standard ist an.
- Ton erst nach der ersten Berührung oder Taste (Regel der Browser), nichts beim ersten Aufbau einer Seite.
- Während einer laufenden Frage nur der Klick der eigenen Antwort; Ergebnis und Folgen klingen in der Auflösung, die eigene Antwort zuerst, die Folge des Duells kurz danach.

## 6. Bausteine im Code

| Datei | Inhalt |
|---|---|
| `apps/web/src/theme.css` | Tokens, Schriften, Seitenhintergrund mit Papierkorn |
| `apps/web/src/styles.css` | Knöpfe, Karten, Formulare, Quiz, Partie-Layout, Bewegungen |
| `apps/web/src/art/map-art.ts` | Geometrie der Landkarte |
| `apps/web/src/art/ArtDefs.tsx` | Motive als SVG-Symbole, Wappenmuster, Papierfilter |
| `apps/web/src/art/map-art.css` | Aussehen und Bewegungen der Karte |
| `apps/web/src/art/SeatCrest.tsx`, `LifeShields.tsx`, `Emblem.tsx`, `HeroMap.tsx`, `CountUp.tsx` | Wappen je Sitz, Hauptstadtleben als Schilde (Spielstand und Abrechnung), Spielwappen, Kartenbild der Startseite, zählende Zahlen |
| `apps/web/src/match/MatchBoard.tsx`, `art/attack.ts` | Karte der Partie mit Bedienung, Angriffspfeil |
| `apps/web/src/match/moments.ts`, `useMoments.ts`, `DuelHeader.tsx` | Große Momente als Band, Fragekopf im Duell |
| `apps/web/src/match/AnnouncePanel.tsx`, `RevealPanel.tsx`, `SeatChip.tsx` | Ansage (gezeigte Wahl, Duell), Auflösung mit den Antworten aller Sitze, Sitz als Plättchen |
| `apps/web/src/match/TurnOrder.tsx` | Zugfolge über der Karte |
| `apps/web/src/audio/sound.ts`, `match/sound-cues.ts`, `components/SoundToggle.tsx` | Klänge, ihre Anlässe, Ton-Schalter |
| `apps/web/src/art/Icons.tsx`, `match/LobbyPanel.tsx` | Tuschezeichen der Partie-Seite, Aufstellung mit Code-Plättchen und Platzzeilen, Bots setzen |

Neue Grafik entsteht als SVG im Code oder als Datei mit Eintrag in [ASSETS.md](ASSETS.md). Farben nur über Tokens, Bewegungen mit Abschaltung bei „Bewegung reduzieren“.

## 7. Nächste Schritte

- Eternal-Karte (PixiJS) im selben Stil, sobald Eternal weitergeht (ruht seit 2026-11-10).
- Weitere Partiekarten: brauchen nur neue Felder und Namen, die Grafik entsteht automatisch (so entstand die Kernmark).
