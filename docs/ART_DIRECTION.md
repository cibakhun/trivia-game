# Gestaltung: „Alte Landkarte“

Stilleitfaden für das Aussehen von Reiche des Wissens (ADR-051). Vorbild ist nur der Ablauf des Genres; Name, Karte, Grafik und Look sind eigen (ADR-046). Herkunft und Lizenz jedes Bausteins stehen in [ASSETS.md](ASSETS.md).

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

Die Regeln kennen die Wendelmark als 24 Sechseckfelder (`packages/game-core/src/match-map.ts`). Die Grafik (`apps/web/src/art/map-art.ts`) macht daraus eine Landkarte, **ohne die Nachbarschaft zu ändern**:

1. Jede Ecke des Rasters wird leicht verschoben (innen bis 16 % der Feldgröße); Ecken an der Küste wandern zusätzlich nach außen, entlang einer weichen Wölbung mit Buchten und Landzungen. Eingebuchtete Küstenecken wandern weiter hinaus, das glättet den Sägezahn des Rasters.
2. Jede Kante wird per Mittelpunktverschiebung zur unregelmäßigen Linie (innen 3 Stufen, an der Küste 4 Stufen und rauer). Zwei Nachbarn lesen **dieselbe** Linie, deshalb passen die Grenzen lückenlos aneinander.
3. Der Fluss folgt inneren Grenzen von der Nordküste zur Südküste, nahe der Mittelachse; er trennt nichts, was die Regeln nicht trennen.
4. Alles ist deterministisch (eigener Zufall aus `art/noise.ts`, nie für Spielregeln): gleiche Karte, gleiches Bild auf jedem Gerät.

Unit-Tests (`apps/web/test/map-art.test.ts`) sichern: genau die Nachbarn der Regeln teilen eine Grenze, andere Regionen berühren sich nicht; jede Region umschließt ihren Mittelpunkt; alles liegt im Bild; der Fluss läuft von Küste zu Küste entlang von Grenzen.

**Ebenen** (von unten): Meer mit Wellenzeichen, Küstenringe, Land, Aquarellfarbe des Besitzers mit Wappenmuster und dunklerem Rand, gestrichelte Grenzen, Fluss, Küstenlinie, Motive, Namen und Münzen, Hervorhebungen (wählbar, Duell), Kompass und Titelschild.

**Landschaft je Region** (`art/terrain.ts`, nur Darstellung): Wald, Nadelwald, Gebirge, Hügel, Felder, Wiese, Moor, See, Fluss, Dorf, für die Wendelmark fest zugeordnet, für neue Karten nach Wortteilen des Namens. Daraus folgen die kleinen Motive über dem Namen und an den unteren Ecken.

**Besitz** ist nie nur Farbe: Jeder Sitz hat Farbe, **Wappenbild** (◆ Raute, ● Kugel, ▲ Spitze) und **Muster** (Schrägstreifen, Punkte, Gitter). Die Münze zeigt den Punktwert, das Schildchen daneben den Besitzer.

**Hauptstadt:** Burg mit Fahne in Sitzfarbe, darunter ein Schild je Leben; verlorene Leben bleiben als gestrichelter Umriss stehen.

**Handy hochkant** (bis 560 px): enger Ausschnitt nur um die Insel, ohne Titelschild und Kompass, größere Namen und Münzen. Beim Wählen steht die Karte vor der Anweisung, beim Fragen die Frage zuerst.

## 5. Bewegung

| Anlass | Bewegung |
|---|---|
| Region erobert | Die neue Farbe breitet sich von der Mitte aus wie Tinte (0,9 s) |
| Region befestigt (Wert steigt) | Die Münze springt kurz |
| Hauptstadt getroffen | Die Burg wackelt, ein Schild kippt weg |
| Du bist dran | Goldenes Band „Du bist dran!“ über der Karte (1,8 s), die Karte der Anweisung leuchtet |
| Wählbare Regionen | Goldener, laufender Strichrand und sanftes Leuchten |
| Duell | Rot pulsierender Rand und gekreuzte Schwerter über der umkämpften Region |
| Punkte ändern sich | Die Zahl zählt hoch (0,7 s) |
| Auflösung | Die Karte rollt sich auf, die richtige Antwort leuchtet grün, Zeilen erscheinen nacheinander |
| Sieg | Lorbeerkranz mit Krone und kreisendem Strahlenkranz |

Regeln:

- **Keine Bewegung, solange die Zeit einer Frage läuft** (ARCHITECTURE §15): Frage und Antworten stehen sofort da, und die Dauerbewegungen der Karte ruhen.
- Beim ersten Aufbau einer Seite laufen keine Änderungsanimationen, nur bei echten Änderungen.
- „Bewegung reduzieren“ im System schaltet alle Animationen ab (CSS `prefers-reduced-motion`, auch die Zählanimation).

## 6. Bausteine im Code

| Datei | Inhalt |
|---|---|
| `apps/web/src/theme.css` | Tokens, Schriften, Seitenhintergrund mit Papierkorn |
| `apps/web/src/styles.css` | Knöpfe, Karten, Formulare, Quiz, Partie-Layout, Bewegungen |
| `apps/web/src/art/map-art.ts` | Geometrie der Landkarte |
| `apps/web/src/art/ArtDefs.tsx` | Motive als SVG-Symbole, Wappenmuster, Papierfilter |
| `apps/web/src/art/map-art.css` | Aussehen und Bewegungen der Karte |
| `apps/web/src/art/SeatCrest.tsx`, `LifeShields.tsx`, `Emblem.tsx`, `HeroMap.tsx`, `CountUp.tsx` | Wappen je Sitz, Hauptstadtleben als Schilde (Spielstand und Abrechnung), Spielwappen, Kartenbild der Startseite, zählende Zahlen |
| `apps/web/src/match/MatchBoard.tsx` | Karte der Partie mit Bedienung |

Neue Grafik entsteht als SVG im Code oder als Datei mit Eintrag in [ASSETS.md](ASSETS.md). Farben nur über Tokens, Bewegungen mit Abschaltung bei „Bewegung reduzieren“.

## 7. Nächste Schritte

- Klänge (selbst erzeugt per Web Audio, abschaltbar).
- Eternal-Karte (PixiJS) im selben Stil.
- Weitere Partiekarten: brauchen nur neue Felder und Namen, die Grafik entsteht automatisch.
