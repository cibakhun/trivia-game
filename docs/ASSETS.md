# Assets: Herkunft und Lizenzen

Jede Grafik, Schrift, jeder Klang und jedes Bild im Spiel steht hier mit Herkunft und Lizenz, **bevor** es eingebaut wird (ADR-051). Ziel: rechtlich risikoarm, also nur eigene Werke oder klar lizenzierte freie Werke.

## Regeln

- Erlaubt sind eigene Werke und freie Lizenzen, die kommerzielle Nutzung und Weitergabe erlauben: SIL Open Font License, CC0, CC BY (mit Namensnennung hier und im Spiel), MIT, Apache 2.0.
- Nicht erlaubt: Material aus anderen Spielen, Marken, Logos oder Karten realer Länder als Spielkarte; Bilder aus der Websuche; Lizenzen mit „nicht kommerziell“ (NC) oder „keine Bearbeitung“ (ND).
- KI-erzeugte Bilder oder Klänge nur nach Entscheidung des Product Owners (Rechtslage und Herkunft der Trainingsdaten ungeklärt).
- Schriften und Bibliotheken werden mit dem Spiel ausgeliefert, nicht von fremden Servern geladen (Datenschutz).

## Schriften

| Asset | Urheber | Lizenz | Quelle im Projekt | Hinweis |
|---|---|---|---|---|
| Alegreya, Schnitte 500, 700, 800 (latin) | The Alegreya Project Authors (Juan Pablo del Peral, Huerta Tipográfica) | SIL Open Font License 1.1 | npm `@fontsource/alegreya` 5.3.0 | Lizenztext: `apps/web/public/lizenzen/Alegreya-OFL.txt`, im Spiel unter `/lizenzen/` abrufbar |
| Alegreya Sans, Schnitte 400, 500, 700, 800 (latin) | The Alegreya Sans Project Authors (Juan Pablo del Peral, Huerta Tipográfica) | SIL Open Font License 1.1 | npm `@fontsource/alegreya-sans` 5.3.0 | Lizenztext: `apps/web/public/lizenzen/Alegreya-Sans-OFL.txt` |

Die OFL erlaubt Einbetten, Weitergeben und Verkaufen zusammen mit Software; die Schrift darf nur nicht allein verkauft werden, und der Lizenztext muss beiliegen.

## Grafik (eigene Werke)

Alle Grafiken sind eigene Zeichnungen für dieses Projekt, als SVG im Quelltext; es gibt keine Bilddateien.

| Asset | Datei | Herkunft |
|---|---|---|
| Landkarten der Wendelmark und der Kernmark (Grenzen, Küste, Fluss, Meer bis an den Bildschirmrand) | `apps/web/src/art/map-art.ts`, `match/MatchBoard.tsx` | eigenes Verfahren, aus den Feldern der Regeln erzeugt |
| Motive Baum, Tanne, Berg, Hügel, Feld, Gras, Schilf, See, Haus, Turm, Wellen, Burg, Schild, dazu für die Partie mit Ausbau Dorf, Stadt und Banner der Armeen | `apps/web/src/art/ArtDefs.tsx` | eigene Zeichnungen |
| Wappenbilder ◆ ● ▲ und Wappenmuster | `apps/web/src/art/ArtDefs.tsx`, `art/SeatCrest.tsx` | eigene Zeichnungen, Grundformen |
| Spielwappen (Schild, Buch, Krone) | `apps/web/src/art/Emblem.tsx` | eigene Zeichnung |
| Lorbeerkranz der Siegerseite | `apps/web/src/match/ResultPanel.tsx` | eigene Zeichnung |
| Papierkorn des Hintergrunds | `apps/web/src/theme.css` (SVG-Rauschfilter) | eigenes Verfahren |
| Blockpfeil und Wappenplättchen eines Duells auf der Karte, Schwerter im Blatt der Partie | `apps/web/src/art/attack.ts`, `art/Swords.tsx`, `match/MatchBoard.tsx` | eigene Zeichnungen |
| Tuschezeichen Banner, Schlüssel, Übungsscheibe, Schriftrolle | `apps/web/src/art/Icons.tsx` | eigene Zeichnungen |
| Schilde der Plätze in der Aufstellung, Lautsprecher am Ton-Schalter | `apps/web/src/match/LobbyPanel.tsx`, `components/SoundToggle.tsx` | eigene Zeichnungen |
| Münze am Punktestand, Rücktaste des Ziffernfelds, gedrehtes Handy im Hinweis fürs Hochformat | `apps/web/src/match/SeatList.tsx`, `match/NumPad.tsx`, `match/RotateHint.tsx` | eigene Zeichnungen, Grundformen |
| Tuschezeichen der Partie mit Ausbau: Brot, Baustoff, Armee, Dorf, Stadt, Burg, Tausch, Zug und je eines für die elf Kategorien des Glücksrads (Geschichte, Erdkunde, Naturwissenschaft, Technik, Mathematik, Literatur, Kunst und Kultur, Sport, Politik, Natur und Tiere, Allgemeinwissen) | `apps/web/src/art/RealmIcons.tsx` | eigene Zeichnungen aus Grundformen (ADR-060) |
| Glücksrad (Scheibe mit Feldern je Kategorie, Zeiger, Nabe) | `apps/web/src/match/Wheel.tsx` | eigene Zeichnung, aus den Losen des Duells errechnet |
| Auf der Karte der Partie mit Ausbau: goldenes Plus am geplanten Bau, Pfeile der Züge, Schildchen am Feld eines Duells, Striche der Lose | `apps/web/src/match/RealmBoardArt.tsx`, `match/RealmBlatt.tsx` | eigene Zeichnungen, Grundformen |
| „So geht's“: kleines Glücksrad mit sechs Feldern und Zeiger, Münzen mit dem Wert eines Felds; die übrigen Bilder sind aus den Tuschezeichen, Wappen und Schwertern zusammengesetzt | `apps/web/src/match/HelpSheet.tsx` | eigene Zeichnung aus Grundformen (ADR-063) |
| Zierzeichen ❦ ❧ ✓ | Unicode-Zeichen aus der Schrift | Teil der Schriften bzw. Systemschrift |

## Klänge

Alle Klänge entstehen beim Spielen im Browser (Web Audio: Oszillatoren, gefiltertes Rauschen mit festem Startwert), es gibt keine Tondateien. Rezepte in `apps/web/src/audio/sound.ts`, eigene Werke.

| Klang | Anlass |
|---|---|
| Horn (zwei Töne) | Du bist dran |
| Federstrich | Eine Region oder Hauptstadt wird gewählt (mit Ausbau auch: Burg oder Dorf gesetzt, Befehle aufgedeckt) |
| Holzklick | Eigene Antwort abgegeben |
| Glocke (Dreiklang) / dumpfer Schlag | Eigene Antwort richtig / falsch |
| Trommel mit steigendem Dreiklang | Region erobert (mit Ausbau auch: Burg zerstört) |
| Schildklang | Region gehalten (befestigt) |
| Donner | Treffer auf eine Hauptstadt (mit Ausbau: Treffer auf Dorf, Stadt oder Burg, auch wenn damit ein Reich fällt) |
| fallende Moll-Folge | Ein Reich fällt |
| Fanfare / leise fallende Folge | Sieg / anderer Platz |

## Bibliotheken mit sichtbarem Anteil

Bibliotheken stehen in den `package.json`-Dateien; sie bringen keine Grafiken ins Spiel.

## Datenquellen für Fragen

Fakten sind nicht urheberrechtlich geschützt, Formulierungen schon, und in der EU schützt das Datenbankrecht zusätzlich das Abschöpfen großer Teile einer fremden Sammlung. Deshalb nutzen wir nur Quellen, deren Lizenz die Übernahme auch großer Teile für ein kommerzielles Spiel erlaubt, und formulieren die Fragen selbst ([QUIZ_ENGINE.md §9.1](QUIZ_ENGINE.md#91-pipeline-e), ADR-056). Jede neue Quelle kommt hier hinein, **bevor** ein Generator sie abfragt.

| Quelle | Lizenz | Nutzung im Projekt | Nachweis |
|---|---|---|---|
| Wikidata | CC0 1.0 (gemeinfrei; keine Namensnennung nötig, Verzicht auch auf das Datenbankrecht) | Abfragen `tools/content/wikidata/queries/`, Datenstände `content/wikidata/`, Entwürfe `content/questions/wikidata/`; je Frage die Wikidata-Seite als Quelle | [Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing) |
| Deutsche Wikipedia (nur zum Nachprüfen) | Texte CC BY-SA 4.0; übernommen wird nichts, nur einzelne Fakten werden nachgeschlagen (Fakten sind nicht geschützt) | Zweite Quelle für die Prüfung durch Claude (ADR-072): Artikel werden zum Abgleich geholt (`tools/content/src/wikipedia/artikel-holen.ts`), nicht gespeichert und nicht ins Repo gelegt; Redaktionsfragen nennen den Artikel als Quelle, Text und falsche Antworten sind selbst formuliert | [Wikipedia:Lizenzbestimmungen](https://de.wikipedia.org/wiki/Wikipedia:Lizenzbestimmungen) |

Geprüft am 2026-11-11 und für spätere Schätzfragen geeignet, aber noch nicht genutzt: Destatis GENESIS-Online (Datenlizenz Deutschland – Namensnennung 2.0, Quellenvermerk und Hinweis auf Änderungen), Eurostat (Wiederverwendung mit Quellenangabe; Daten zu Ländern außerhalb von EU und EFTA nicht kommerziell), Weltbank (CC BY 4.0, je Datensatz prüfen).

Ausgeschlossen: Open Trivia DB und OpenTriviaQA (CC BY-SA 4.0, Share-Alike), The Trivia API (CC BY-NC 4.0, kommerziell nur im Abo), Qukkiz-Questions (GPL-3.0), Fragen aus Quizsendungen, Quizbüchern und Quizseiten (geschützt), Wikipedia-Texte (als Fragentext oder Datensammlung; das Nachschlagen einzelner Fakten zur Prüfung ist erlaubt, siehe oben), DBpedia und OpenStreetMap als Datenquelle (Share-Alike).
