# PROJECT BRIEF: REICHE DES WISSENS
## Multiplayer Trivia Strategy Browser Game

> **Hinweis:** Dies ist das unveränderte Original-Briefing des Product Owners (Version 0.1, übergeben am 2026-11-09).
> Es ist die Anforderungsbasis für alle Dokumente in `docs/`. Änderungen am Briefing erfolgen nur durch den Product Owner
> und werden als neue Version abgelegt. Abschnittsverweise in anderen Dokumenten (z. B. „Brief §5.3“) beziehen sich auf diese Datei.

**Dokumenttyp:** Product Requirements Document (PRD) + Technical Design Brief  
**Version:** 0.1 – Initial Game Design  
**Status:** Konzeptphase / Entwicklungsgrundlage  
**Projektname:** Arbeitstitel, noch nicht markenrechtlich geprüft  
**Zielgruppe:** Claude Code – Projektleiter, Architekt und Entwicklungsagent

---

# 1. Projektauftrag

Entwickle ein eigenständiges, langfristig skalierbares Multiplayer-Browserspiel, das Quizwissen mit territorialer Strategie, Königreichsentwicklung und persistenten Multiplayer-Welten kombiniert.

Die Grundidee orientiert sich spielmechanisch an klassischen wissensbasierten Gebietseroberungsspielen wie Honfoglaló/Triviador. Es soll jedoch ein eigenständiges Produkt mit eigener Marke, eigener visueller Identität, eigener Architektur, eigenen Inhalten und zusätzlichen Spielmechaniken entstehen.

Das Spiel muss vollständig im Browser spielbar sein, ohne Installation, und auf Desktop sowie Mobilgeräten funktionieren.

## 1.1 Kernfantasie

Ein Spieler beginnt mit einem kleinen Territorium in einer großen Welt.

Durch das korrekte Beantworten von Wissensfragen erobert er benachbarte Gebiete, besiegt computergesteuerte Königreiche, kämpft gegen andere Spieler und erweitert schrittweise sein Reich.

Langfristig entwickelt sich aus einer einzelnen Siedlung ein Königreich oder sogar ein Imperium.

Andere Spieler können Gebiete angreifen. Der Besitzer hat in der permanenten Welt grundsätzlich 24 Stunden Zeit, sich der Herausforderung zu stellen.

Nicht beantwortete Angriffe führen automatisch zum Gebietsverlust. Durch erspielbare Items lässt sich die Antwortfrist verlängern.

Neben der persistenten Welt existieren separate Tages- und Wochenwelten mit begrenzter Laufzeit und regelmäßigen Neustarts.

## 1.2 Produktprinzipien

1. Wissen ist die primäre Voraussetzung für erfolgreiche Eroberungen.
2. Strategische Entscheidungen bestimmen, welche Regionen angegriffen und verteidigt werden.
3. Langfristige Aktivität soll belohnt werden, ohne Offlinezeiten vollständig zu bestrafen.
4. Große Königreiche dürfen mächtig, aber nicht unangreifbar werden.
5. Das Spiel muss auch mit wenigen aktiven Spielern funktionieren.
6. NPC-Gegner sollen die Spielwelt lebendig halten.
7. Faire Multiplayer-Duelle haben Vorrang vor Monetarisierung.
8. Gameplay-Vorteile dürfen nicht durch Echtgeldkäufe entstehen.
9. Sämtliche kritischen Spielentscheidungen werden serverseitig validiert.
10. Die Architektur muss mehrere eigenständige Weltinstanzen unterstützen.

## 1.3 Eigenständiges Projekt

Dies ist ein separates Spielprojekt. Bestehende Projekte, insbesondere VerseBase, dürfen nicht ungefragt verändert werden.

Vor Entwicklungsbeginn:

- Repository und vorhandene Infrastruktur untersuchen.
- Prüfen, ob bereits ein Projektverzeichnis existiert.
- Geeignete technische Architektur empfehlen.
- Fehlende Anforderungen und Konflikte dokumentieren.
- Einen priorisierten Implementierungsplan erstellen.
- Keine Änderungen an produktiven Datenbanken ohne ausdrückliche Freigabe durchführen.

---

# 2. Verbindliche Entscheidungen und Vorschläge

Die folgenden Anforderungen gelten als vom Product Owner festgelegt:

**VERBINDLICH**

- Browserbasiertes Multiplayer-Strategiespiel.
- Quizfragen sind das zentrale Eroberungssystem.
- Start mit einem kleinen Territorium.
- Expansion bis zum eigenen Königreich.
- Viele menschliche Spieler auf derselben Karte.
- NPC-Gegner unterschiedlicher Stärke.
- NPC-Schwierigkeit entwickelt sich passend zum Spielfortschritt.
- Trivia-Duelle mit anschließenden Schätzfragen als Tiebreaker.
- Bei Gleichstand in der Schätzfrage entscheidet die Antwortgeschwindigkeit.
- Permanente Eternal-Welt.
- Separate Tages- und Wochenkarten.
- In Eternal grundsätzlich 24 Stunden Verteidigungsfrist.
- Erfolgt keine Verteidigungsantwort, geht das angegriffene Gebiet verloren.
- Bei Eroberungen können Items als Belohnung erhalten werden.
- Bestimmte Items verlängern die Verteidigungsfrist.

**VORLÄUFIGE DESIGNVORSCHLÄGE**

- Hexagonales Kartensystem.
- 48 Stunden maximale Verteidigungsfrist inklusive Items.
- Seltenheitsstufen und konkrete Item-Werte.
- Angriffslimits, Schutzzeiten und Cooldowns.
- Königreichsränge und Gebietsschwellen.
- Versorgungswege und Provinzsysteme.
- Automatische Itemverwendung als optionale Einstellung.
- Konkrete Teilnehmerzahlen für Tages- und Wochenwelten.
- Technologiestack und Datenbankarchitektur.

Diese Vorschläge sind keine endgültigen Produktentscheidungen. Sie dürfen für einen Prototyp verwendet werden, müssen aber konfigurierbar bleiben.

---

# 3. Spielwelten

Die Spielengine soll drei Weltarten unterstützen. Sie teilen sich grundlegende Mechaniken, besitzen jedoch unterschiedliche Zeitregeln und Fortschrittsmodelle.

## 3.1 Eternal World – permanente Welt

Die Eternal-Welt ist der zentrale Langzeitmodus.

Eigenschaften:

- Permanenter Weltzustand.
- Keine regelmäßigen globalen Resets.
- Große, mit der Spielerzahl wachsende Karte.
- Viele menschliche Königreiche.
- Neutrale und NPC-kontrollierte Gebiete.
- Asynchrone Angriffe und Verteidigungen.
- Dauerhaftes Königreich.
- Langfristige Ranglisten und Statistiken.
- Inventar mit erspielbaren Items.
- Dynamische territoriale Konflikte.

Spieler können sich jederzeit anmelden und ihre Entwicklung fortsetzen.

Der Besitz von Gebieten ist nicht dauerhaft garantiert. Andere Spieler und NPCs können Regionen erobern.

Die Welt muss ein Gleichgewicht zwischen Expansion, Verteidigung und territorialem Verfall ermöglichen.

### Problem: begrenzter Kartenplatz

Eine vollständig persistente Welt kann durch frühe Spieler vollständig besetzt werden.

Deshalb muss die Welt dynamisch erweiterbar sein.

**Vorschlag:** Eine hexagonale Karte, deren Regionen in Chunks organisiert werden. Neue Chunks werden anhand von Spielerzahl, vorhandenen freien Regionen und Weltaktivität freigeschaltet.

Neue Spieler erhalten einen fairen Einstieg in geeigneten Startregionen.

Zusätzlich sollen länger inaktive Königreiche kontrolliert in den Spielkreislauf zurückgeführt werden können.

Dabei dürfen Spieler nicht aufgrund kurzer Offlinezeiten ihren gesamten Fortschritt verlieren.

## 3.2 Daily World – Tageskarte

Die Tageskarte ist ein kompetitiver Kurzzeitmodus.

Vorgeschlagene Eigenschaften:

- Laufzeit: 24 Stunden.
- Unabhängige Weltinstanz.
- Etwa 20–50 Spieler pro Instanz.
- Kleine bis mittelgroße Karte.
- Gleichberechtigte Startbedingungen.
- NPC-Gegner füllen ungenutzte Regionen.
- Häufigere Eroberungen.
- Eigene Rangliste.
- Automatischer Abschluss und Reset.

Wichtig: Die Verteidigungsfristen der Eternal-Welt dürfen nicht unverändert übernommen werden.

Eine Tageswelt mit 24 Stunden Laufzeit und 24 Stunden Antwortfrist wäre spielmechanisch widersprüchlich.

**Vorschlag:** Schnelle Live-Duelle und asynchrone Verteidigungen mit maximal 15 Minuten Antwortfrist.

Nach Ablauf der Tageswelt werden alle offenen Konflikte anhand definierter Regeln abgeschlossen.

Sieger werden durch ein transparentes Punktesystem bestimmt.

## 3.3 Weekly World – Wochenkarte

Die Wochenkarte ist der mittelfristige strategische Modus.

Vorgeschlagene Eigenschaften:

- Laufzeit: sieben Tage.
- Etwa 100–300 Spieler pro Instanz.
- Größere Karte als Daily.
- Eigene Königreiche innerhalb der Saison.
- NPC-Fraktionen.
- Temporäre Allianzen als spätere Erweiterung.
- Saisonrangliste.
- Automatischer Reset nach Saisonende.

**Vorschlag:** Vier Stunden Antwortfrist bei PvP-Angriffen.

Konflikte dürfen nicht mit einem Fälligkeitsdatum nach dem Saisonende angelegt werden, sofern dafür keine eindeutige Abschlussregel existiert.

## 3.4 Trennung der Welten

Jede Welt besitzt unabhängig:

- Kartenlayout.
- Regionen und Gebietseigentümer.
- Spielerfortschritt innerhalb der Welt.
- NPCs.
- Konflikte.
- Regeln.
- Zeitlimits.
- Ranglisten.

Globale Profile und kosmetische Errungenschaften können weltübergreifend bestehen.

Eternal-Items dürfen nicht automatisch kompetitive Vorteile in Daily oder Weekly bringen.

---

# 4. Karte und Gebiete

## 4.1 Kartenmodell

Empfehlung: hexagonale Regionen mit axialen Koordinaten.

Jede Region besitzt bis zu sechs direkte Nachbarn.

Die Karte besteht aus logisch zusammenhängenden territorialen Einheiten.

Jede Region enthält mindestens:

- Eindeutige Region-ID.
- Welt-ID.
- Position beziehungsweise Koordinaten.
- Gelände- oder Biomtyp.
- Aktueller Eigentümer.
- Ursprüngliche beziehungsweise aktuelle Fraktionszugehörigkeit.
- Regionstyp.
- Status aktiver Belagerungen.
- Schutzzeit und Cooldowns.
- Optional strategischer Wert.
- Optional Hauptstadt- oder Provinzzuordnung.

Die Karte muss performant mit einer großen Zahl von Regionen umgehen können.

## 4.2 Regionstypen

**Neutrale Region**

Noch keinem menschlichen Spieler zugeordnet. Kann durch ein Quiz gegen einen leichten NPC beziehungsweise neutralen Verteidiger erobert werden.

**NPC-Region**

Gehört zu einem computergesteuerten Königreich.

**Spielerregion**

Gehört zu einem menschlichen Königreich und kann durch PvP erobert werden.

**Hauptstadt**

Zentrales Gebiet eines Königreichs mit besonderer visueller und strategischer Bedeutung.

**Strategische Region**

Besonderer Gebietstyp für spätere Features wie Handelswege, Provinzboni oder Ressourcenpunkte.

Für das MVP sind neutrale Regionen, NPC-Regionen, Spielerregionen und eine Hauptstadtmarkierung ausreichend.

## 4.3 Regeln der Expansion

Ein Spieler darf zunächst ausschließlich Gebiete angreifen, die an mindestens eine eigene Region angrenzen.

Ausnahmen können später durch besondere strategische Mechaniken entstehen.

Eine erfolgreiche Eroberung:

1. Ändert den Eigentümer.
2. Aktualisiert die Gebietszählung.
3. Aktualisiert die Karte.
4. Berechnet mögliche Belohnungen.
5. Aktualisiert relevante Ranglisten.
6. Schreibt einen Eintrag ins Ereignisprotokoll.

Eigentumswechsel müssen atomar und serverseitig erfolgen.

## 4.4 Königreiche

Ein Königreich besteht aus den vom Spieler kontrollierten Regionen.

Jeder Spieler besitzt zunächst ein Hauptkönigreich pro Eternal-Welt.

Vorgeschlagene Entwicklung:

| Gebiete | Rang |
|---|---|
| 1–4 | Siedlung |
| 5–14 | Dorfverbund |
| 15–39 | Fürstentum |
| 40–99 | Königreich |
| 100–249 | Großreich |
| 250+ | Imperium |

Diese Titel sind vorerst kosmetisch und dürfen nicht automatisch zu besseren Quizfähigkeiten führen.

## 4.5 Hauptstädte

Jedes Königreich benötigt eine Hauptstadt.

Die Hauptstadt ist beim Spielstart die erste beanspruchte Region.

Wird sie verloren, muss es einen eindeutig geregelten Übergang geben.

**Vorschlag für Version 1:**

Die Hauptstadt kann angegriffen werden, sofern sie nicht unter einem speziellen Anfänger- oder Wiederaufbauschutz steht.

Verliert ein Spieler seine Hauptstadt, aber besitzt noch andere Regionen, wird automatisch eine neue Hauptstadt ausgewählt.

Verliert ein Spieler sämtliche Regionen, bleibt sein Konto bestehen und er erhält einen fairen Neustart in einer anderen geeigneten Region.

Ein vollständiger Gebietsverlust darf nicht zur Löschung seines Accounts, seines kosmetischen Fortschritts oder seiner historischen Statistiken führen.

---

# 5. Quiz- und Kampfsystem

Das Quizsystem ist die wichtigste Komponente des gesamten Spiels.

Es muss fair, reproduzierbar, sicher und für menschliche Spieler wie NPCs verwendbar sein.

## 5.1 Grundablauf eines Angriffs

1. Spieler A wählt ein angrenzendes Zielgebiet.
2. Der Server validiert die Angriffsberechtigung.
3. Spieler A beginnt die Trivia-Herausforderung.
4. Spieler A beantwortet eine Wissensfrage.
5. Die Antwort und die serverseitig erfasste Antwortzeit werden gespeichert.
6. Falls erforderlich, beantwortet er zusätzlich eine numerische Schätzfrage.
7. Bei einem menschlichen Verteidiger wird nach erfolgreichem Abschluss der Angreifer-Herausforderung die Belagerung eröffnet.
8. Spieler B erhält die Möglichkeit zur Verteidigung.
9. Spieler B absolviert dieselbe logische Herausforderung.
10. Der Server wertet den Kampf aus.
11. Der Sieger erhält oder behält das Gebiet.

Die Antworten des Angreifers bleiben bis zur Konfliktauflösung geheim.

Die Fragen müssen in allen unterstützten Sprachen semantisch gleichwertig sein.

## 5.2 Trivia-Fragen

Grundsätzlich Multiple Choice.

Beispiel:

> Welches chemische Element besitzt die Ordnungszahl 79?

Antwortmöglichkeiten:

- Silber
- Gold
- Platin
- Kupfer

Jede Frage muss besitzen:

- Eindeutige ID.
- Fragentext.
- Vier oder mehr geeignete Antwortoptionen.
- Genau definierte korrekte Antwort.
- Schwierigkeitsstufe.
- Kategorie.
- Sprachversionen.
- Quellen- oder Verifikationsinformationen.
- Status der Qualitätsprüfung.
- Versionsnummer.

Die Antwortreihenfolge darf pro Spieler variieren. Verglichen wird die semantische Antwort-ID, nicht die Position der Option.

## 5.3 Entscheidung eines Duells

### Fall A: Nur ein Spieler antwortet richtig

Dieser Spieler gewinnt.

Es ist kein Tiebreaker notwendig.

### Fall B: Beide beantworten die Frage richtig

Das Duell wird durch eine Schätzfrage entschieden.

Beispiel:

> In welchem Jahr wurde die Universität Heidelberg gegründet?

Beide Spieler geben eine Zahl ein.

Derjenige mit dem kleineren absoluten Abstand zur tatsächlichen Antwort gewinnt.

### Fall C: Beide Schätzungen haben denselben Abstand

Die Antwortgeschwindigkeit entscheidet.

Maßgeblich ist die für die Schätzfrage serverseitig erfasste Reaktionszeit.

Beispiel:

- Spieler A antwortet nach 5,2 Sekunden.
- Spieler B antwortet nach 6,8 Sekunden.
- Beide haben denselben Abstand zur korrekten Antwort.

Spieler A gewinnt.

Dies gilt auch, wenn beide exakt die richtige Zahl angegeben haben.

### Fall D: Beide beantworten die erste Trivia-Frage falsch

**Designvorschlag:** Eine neue Trivia-Frage wird gestellt, bis ein unterschiedliches Ergebnis entsteht, jedoch höchstens drei Runden.

Kommt es weiterhin zu keiner Entscheidung, gewinnt der bisherige Gebietsbesitzer.

Diese Regel ist noch nicht vom Product Owner bestätigt.

## 5.4 Asynchrone Fairness

Eternal-Duelle finden häufig zeitversetzt statt.

Der Angreifer beantwortet eine Frage heute, der Verteidiger möglicherweise erst morgen.

Deshalb:

- Beide erhalten dieselbe versionierte logische Frage.
- Antworten werden serverseitig gespeichert.
- Lösungen werden vor Konfliktende nicht angezeigt.
- Die Antwortzeit wird je Spieler relativ zur eigenen Präsentation gemessen.
- Serverzeit ist maßgeblich für Fristen.
- Der Client darf keine Punktzahl oder Gewinnerentscheidung selbst festlegen.
- Antworten werden nach Einreichung gesperrt.
- Fragen dürfen während einer laufenden Herausforderung nicht verändert werden.

Ein serverseitiger Zeitmessmechanismus mit begrenzter Latenzberücksichtigung ist zu entwerfen.

Es muss dokumentiert werden, welche unvermeidbaren Unterschiede zwischen Netzverbindungen bestehen.

## 5.5 Wichtiger Sonderfall bei Tiebreakern

Da der Angreifer nicht wissen darf, ob der Verteidiger richtig antworten wird, kann er nicht erst nach dessen Antwort zur Schätzfrage aufgefordert werden.

**Vorgeschlagene Lösung:**

Die Schätzfrage gehört zu jeder begonnenen Herausforderung.

Nach der Trivia-Frage beantwortet der Spieler unmittelbar auch die Schätzfrage.

Die Schätzung wird später nur berücksichtigt, wenn beide Trivia-Antworten richtig waren.

Dadurch bleibt der Kampf vollständig asynchron und spoilerfrei.

Die Oberfläche darf bei dieser Konstruktion nicht fälschlich behaupten, beide Spieler hätten bereits richtig geantwortet.

## 5.6 Fragenkategorien

Geplante Kategorien:

- Geschichte
- Geografie
- Naturwissenschaften
- Technik
- Mathematik
- Literatur
- Kunst und Kultur
- Sport
- Politik und Gesellschaft
- Tiere und Natur
- Allgemeinwissen

Die Schwierigkeit darf sich zwischen verschiedenen Kategorien unterscheiden, muss aber fair kalibriert werden.

Alle Fragen benötigen eine zuverlässige Qualitätskontrolle.

KI-generierte Fragen dürfen nicht ungeprüft veröffentlicht werden.

---

# 6. NPC-System

NPCs müssen von Anfang an Bestandteil des Spiels sein.

Sie sollen die Welt unabhängig von der Anzahl gleichzeitig aktiver Spieler lebendig machen.

## 6.1 NPC-Fraktionen

NPCs kontrollieren eigene Regionen und können zusammenhängende Königreiche bilden.

Drei grundsätzliche Schwierigkeitsklassen:

**Leicht**

- Kleine Territorien.
- Häufig falsche Antworten.
- Langsame simulierte Reaktionen.
- Geringe Expansionsaktivität.
- Für Einsteiger geeignet.

**Mittel**

- Größere Gebiete.
- Durchschnittliche Quizleistung.
- Regelmäßige Expansion.
- Strategische Grenzangriffe.

**Schwer**

- Große NPC-Königreiche.
- Hohe Antwortgenauigkeit.
- Häufigere strategische Angriffe.
- Anspruchsvolle Herausforderungen für erfahrene Spieler.

Zusätzliche interne Schwierigkeitsstufen können stufenlos verwendet werden.

## 6.2 Dynamische Schwierigkeit

Die NPC-Schwierigkeit soll sich an verschiedenen Faktoren orientieren:

- Bisherige Quizleistung.
- Anzahl absolvierter Kämpfe.
- Spielererfahrung.
- Durchschnittliche Erfolgsquote.
- Schwierigkeit der Weltregion.
- Entwicklungsstand des Königreichs.

Die Anzahl kontrollierter Gebiete darf nicht der einzige Faktor sein.

Andernfalls könnten erfahrene Spieler absichtlich wenige Gebiete besitzen und weiterhin ausschließlich schwache NPCs bekämpfen.

## 6.3 NPC-Antwortlogik

NPCs dürfen keine unkontrollierten Sprachmodellantworten zur Entscheidung eines Duells verwenden.

Stattdessen sollte das System mit nachvollziehbaren Antwortwahrscheinlichkeiten arbeiten.

Beispiel:

| NPC | Leichte Frage | Mittlere Frage | Schwere Frage |
|---|---:|---:|---:|
| Leicht | 65 % | 40 % | 15 % |
| Mittel | 85 % | 65 % | 35 % |
| Schwer | 97 % | 85 % | 65 % |

Alle Werte sind Balancing-Platzhalter.

Die NPC-Leistung muss auditierbar und anhand kontrollierter Zufallsentscheidungen reproduzierbar sein.

## 6.4 NPC-Expansion

NPC-Königreiche dürfen:

- Neutrale Regionen erobern.
- Benachbarte NPC-Reiche angreifen.
- Menschliche Königreiche angreifen.
- Ihre Territorien verlieren.
- Nach Niederlagen wieder expandieren.

Die Häufigkeit muss kontrolliert werden, damit Spieler nicht permanent von computergesteuerten Gegnern angegriffen werden.

NPC-Angriffe gegen menschliche Eternal-Spieler unterliegen grundsätzlich ebenfalls dem 24-Stunden-Verteidigungssystem.

## 6.5 NPC-PvE-Kämpfe

Wenn ein Spieler einen NPC angreift, wird der Kampf normalerweise unmittelbar ausgewertet.

Es ist nicht notwendig, 24 Stunden auf einen NPC zu warten.

Der NPC erzeugt seine Antwort anhand seiner Schwierigkeit und der relevanten Frage.

Der menschliche Spieler absolviert die normale Trivia- und Schätzfragen-Herausforderung.

---

# 7. Eternal-Verteidigungssystem

## 7.1 Grundregel

Jede gültige Belagerung einer menschlichen Region startet einen Verteidigungszeitraum.

**Standardfrist: 24 Stunden.**

Der Besitzer erhält eine Benachrichtigung und kann jederzeit innerhalb dieser Frist die Herausforderung beantworten.

Wenn keine gültige Verteidigungsantwort vor Fristende eingeht, gewinnt der Angreifer automatisch.

Diese Regel gilt auch dann, wenn der Besitzer grundsätzlich stärkere Quizfähigkeiten besitzt.

## 7.2 Ablauf einer Belagerung

Beispiel:

Montag, 18:00 Uhr:

Spieler A startet eine gültige Belagerung auf eine Region von Spieler B.

Fristende:

Dienstag, 18:00 Uhr.

Spieler B kann bis zum Ablauf antworten.

Wenn B antwortet:

- Duelldaten werden verglichen.
- Der Sieger wird bestimmt.
- Eigentum und Ereignisprotokoll werden aktualisiert.

Wenn B nicht antwortet:

- Die Belagerung wird nach Fristende serverseitig beendet.
- Spieler A gewinnt automatisch.
- Das Gebiet wechselt den Besitzer.
- Die Region erhält den vorgesehenen Eroberungsschutz.

## 7.3 Belagerungsstatus

Vorgeschlagenes Zustandsmodell:

- `ATTACK_PREPARING`
- `ATTACK_SUBMITTED`
- `WAITING_FOR_DEFENDER`
- `DEFENDER_SUBMITTED`
- `RESOLVING`
- `ATTACKER_WON`
- `DEFENDER_WON`
- `ATTACKER_WON_BY_TIMEOUT`
- `CANCELLED`
- `EXPIRED_INVALID`

Jede Zustandsänderung muss serverseitig protokolliert werden.

Die Verarbeitung muss idempotent sein.

Ein Gebiet darf nicht gleichzeitig mehreren abgeschlossenen Konflikten zugeordnet werden.

## 7.4 Angriffsbegrenzungen

Ohne Begrenzungen könnten große Königreiche oder koordinierte Gruppen einzelne Spieler mit sehr vielen Angriffen überfordern.

Deshalb sind Schutzmechanismen notwendig.

Vorgeschlagene Ausgangswerte:

- Drei neu eröffnete PvP-Belagerungen pro Angreifer innerhalb von 24 Stunden.
- Maximal vier gleichzeitig offene Belagerungen gegen ein Königreich.
- Maximal eine aktive Belagerung pro Region.
- Sechs Stunden erneuter Angriffsschutz nach einer Eroberung.
- Neue Spieler erhalten zeitlich begrenzten Einstiegsschutz.
- Angriffslimits gelten auch für mehrere Angreifer gegen denselben Verteidiger.

Alle Werte müssen serverseitig konfigurierbar sein.

Die konkrete Kombination der Limits ist durch Simulation zu prüfen.

## 7.5 Große Königreiche

Ein Spieler mit 100 Gebieten darf nicht gezwungen sein, täglich 100 einzelne Trivia-Duelle zu absolvieren.

Für das MVP gilt als **vorläufige Arbeitsannahme**:

- Jedes Gebiet ist einzeln eroberbar.
- Eingehende Angriffe sind auf Königreichsebene begrenzt.
- Es gibt ein übersichtliches Belagerungs-Dashboard.
- Wichtige Gebiete werden hervorgehoben.
- Der Spieler kann offene Verteidigungen priorisieren.

Später kann ein Provinzsystem folgen, bei dem mehrere Regionen zu Verwaltungs- und Verteidigungseinheiten zusammengefasst werden.

**Offene Product-Owner-Entscheidung:** Langfristig individuelle Gebietsverteidigung oder gebündelte Provinzverteidigung?

Die Datenarchitektur soll beide Konzepte später zulassen.

---

# 8. Items und Verlängerungen

## 8.1 Ziel des Itemsystems

Items werden durch erfolgreiche Eroberungen verdient.

Sie bieten taktische Möglichkeiten, insbesondere bei der zeitlichen Verteidigungsplanung.

Sie dürfen keine richtigen Antworten erzeugen oder Quizfragen automatisch lösen.

Items werden nicht durch Echtgeldkäufe verfügbar gemacht.

## 8.2 Zeit-Items

Vorgeschlagenes System:

| Item | Seltenheit | Effekt |
|---|---|---|
| Kleine Sanduhr | Gewöhnlich | +6 Stunden |
| Chronos-Siegel | Selten | +12 Stunden |
| Königlicher Zeitkristall | Episch | +24 Stunden |

Die Effekte gelten jeweils für eine einzelne offene Belagerung.

## 8.3 Maximale Verteidigungsfrist

Vorgeschlagene Obergrenze: 48 Stunden.

Ausgangsfrist: 24 Stunden.

Maximale Verlängerung: +24 Stunden.

Beispiele:

- Keine Items: 24 Stunden.
- Eine kleine Sanduhr: 30 Stunden.
- Zwei Chronos-Siegel: 48 Stunden.
- Ein Zeitkristall: 48 Stunden.
- Mehrere Items: insgesamt niemals mehr als 48 Stunden.

Wichtig: Die Verlängerung bezieht sich auf die ursprüngliche Frist.

Ein Item darf eine bereits abgelaufene Belagerung nicht wieder öffnen.

## 8.4 Drop-System

Nach einer erfolgreichen qualifizierten Eroberung kann ein Item erscheinen.

Vorgeschlagene Wahrscheinlichkeiten:

| Ergebnis | Wahrscheinlichkeit |
|---|---:|
| Kein Item | 79 % |
| Kleine Sanduhr | 15 % |
| Chronos-Siegel | 5 % |
| Zeitkristall | 1 % |

Es handelt sich um eine gemeinsame gewichtete Zufallsauswahl, nicht um drei unabhängige Würfe.

Die Dropberechnung muss serverseitig erfolgen.

## 8.5 Anti-Farming

Spieler dürfen nicht durch dauerhaftes Farmen schwacher NPCs unbegrenzt seltene Items erzeugen.

Mögliche Regeln:

- Nur qualifizierte Eroberungen erzeugen Drops.
- Wiederholte Eroberungen derselben Region innerhalb eines Zeitfensters sind nicht erneut belohnungsberechtigt.
- Wiederholte Kämpfe gegen dieselben Accounts können überprüft werden.
- Sehr leichte NPCs haben begrenzte Belohnungsberechtigung.
- Tageslimits für Dropberechtigungen sind konfigurierbar.
- Verdächtige Item-Transaktionen werden protokolliert.

Drop-Schutz darf legitime Anfänger nicht unnötig bestrafen.

## 8.6 Inventar

Vorschlag:

- Maximal zehn Zeit-Items im aktiven Inventar.
- Itemanzahl und Itemtyp serverseitig gespeichert.
- Jede Verwendung erzeugt eine nachvollziehbare Transaktion.
- Items sind zunächst nicht handelbar.
- Kein Echtgeldhandel.
- Keine direkte Übertragung zwischen Accounts im MVP.

Bei vollem Inventar muss das Belohnungssystem eindeutig reagieren und den Spieler informieren. Es darf keine stillschweigende Belohnungsvernichtung geben.

## 8.7 Automatische Itemverwendung

Optionale Funktion, standardmäßig deaktiviert.

Ein Spieler kann erlauben, dass das System verfügbare Zeit-Items automatisch zur Verlängerung bedrohter Gebiete verwendet.

Beispiel:

- Verteidigung läuft in sechs Stunden ab.
- Spieler hat noch nicht geantwortet.
- Auto-Verlängerung ist aktiviert.
- Ein passendes Item wird verwendet.
- Die neue Frist wird gespeichert.
- Der Spieler erhält eine entsprechende Benachrichtigung.

Mögliche Priorisierung:

1. Hauptstadt.
2. Strategisch wichtige Region.
3. Gebiete mit hoher Punktzahl.
4. Sonstige Regionen.

Der Spieler soll später eigene Prioritäten festlegen können.

Wichtig:

Automatische Itemverwendung darf niemals automatisch Quizantworten erzeugen.

## 8.8 Technische Sicherheitsanforderungen

Itemverbrauch und Fristverlängerung müssen in einer atomaren Datenbanktransaktion stattfinden.

Bei parallelen Requests darf kein Item doppelt verbraucht werden.

Der Server muss prüfen:

- Gehört das Item dem Spieler?
- Ist die Belagerung noch aktiv?
- Gehört das verteidigte Gebiet tatsächlich zum betroffenen Königreich?
- Wurde die maximale Verlängerung erreicht?
- Ist genügend Inventar vorhanden?
- Wurde dieselbe Anfrage bereits verarbeitet?

---

# 9. Fortschritt und Langzeitmotivation

## 9.1 Spielerprogression

Spieler sollen langfristig Fortschritt aufbauen können durch:

- Eroberte Gebiete.
- Gewonnene Quizduelle.
- Erfolgreiche Verteidigungen.
- Besiegte NPC-Reiche.
- Errungenschaften.
- Entdeckte Regionen.
- Teilnahme an Tages- und Wochenwelten.
- Historische Königreichsrekorde.

## 9.2 Königreichsprogression

Zusätzlich zum persönlichen Profil wird die Entwicklung eines Königreichs gespeichert.

Mögliche Statistiken:

- Aktuelle Gebietsanzahl.
- Historisch größte Ausdehnung.
- Anzahl eroberter NPC-Regionen.
- Gewonnene PvP-Schlachten.
- Erfolgreiche Verteidigungen.
- Längste territoriale Verbindung.
- Hauptstadtgeschichte.
- Historische Rangpositionen.

## 9.3 Strategische Erweiterungen

Folgende Features sind nicht Bestandteil des frühen MVP, sollen jedoch architektonisch berücksichtigt werden:

**Provinzen**

Zusammenhängende Gebiete können Verwaltungsregionen bilden.

**Versorgungswege**

Zusammenhängende territoriale Verbindungen können Punkteboni erzeugen.

**Diplomatie**

Spieler können Nichtangriffspakte oder Allianzen schließen.

**Weltereignisse**

Zeitlich begrenzte Ereignisse verändern strategische Ziele.

**NPC-Imperien**

Große computergesteuerte Fraktionen bieten Herausforderungen für mehrere menschliche Königreiche.

Keine dieser Erweiterungen darf das grundlegende Wissensprinzip verdrängen.

---

# 10. Multiplayer und Matchmaking

## 10.1 Eternal

Neue Spieler erhalten eine geeignete Startregion.

Das System berücksichtigt:

- Verfügbarkeit freier Regionen.
- Nähe zu angemessen starken NPCs.
- Dichte aktiver Spieler.
- Vorhandene Großreiche.
- Schutz vor unmittelbarer Übermacht.
- Technische Kartenkapazität.

Große Königreiche dürfen Anfängergebiete nicht unmittelbar vollständig kontrollieren.

## 10.2 Daily und Weekly

Spieler werden in passende Weltinstanzen aufgenommen.

Zu berücksichtigen:

- Maximale Spieleranzahl.
- Aktuelle Kapazität.
- Verbleibende Saisonzeit.
- Aktivität.
- Optional Spielstärke.
- Fairer Einstieg.

Neue Spieler sollten nicht in eine fast beendete Saison eingeteilt werden, ohne dass dies deutlich kommuniziert wird.

## 10.3 Mehrsprachigkeit

Die Plattform soll mindestens unterstützen:

- Deutsch (`de`)
- Ungarisch (`hu`)
- Englisch (`en`)

Weitere Sprachen müssen später ohne grundlegende Architekturänderung hinzugefügt werden können.

Zentraler Grundsatz:

**Spieler können innerhalb derselben Welt und desselben Quizduells unterschiedliche Sprachen verwenden.**

Ein deutscher Spieler sieht die Frage auf Deutsch, ein ungarischer Spieler auf Ungarisch.

Die zugrunde liegende Frage, richtige Antwort und Bewertung sind identisch.

Es darf keine sprachabhängige Bevorzugung entstehen.

---

# 11. Benutzeroberfläche

## 11.1 Designrichtung

Das Spiel soll modern, übersichtlich und strategisch wirken.

Keine direkte visuelle Kopie von Honfoglaló oder Triviador.

Eigenständige:

- Farbpalette.
- Weltkarte.
- Regionendarstellung.
- Symbolik.
- Animationen.
- Menüs.
- Quizdialoge.
- Typografie.
- Sounds.
- Branding.

Die Benutzeroberfläche muss auch bei vielen gleichzeitig sichtbaren Gebieten flüssig bleiben.

## 11.2 Hauptansicht

Die Kartenansicht enthält:

- Interaktive Weltkarte.
- Eigene Gebiete.
- Fremde Spielergebiete.
- NPC-Gebiete.
- Neutrale Gebiete.
- Hauptstadt.
- Aktive Belagerungen.
- Aktuell ausgewähltes Gebiet.
- Königreichsinformationen.
- Inventar.
- Benachrichtigungen.

Ein Klick auf ein Gebiet öffnet Informationen und verfügbare Aktionen.

## 11.3 Gebietsdetails

Bei eigenen Gebieten:

- Name.
- Regionstyp.
- Zugehörigkeit.
- Aktive Angriffe.
- Verbleibende Verteidigungszeit.
- Verlängerungsoptionen.
- Gegebenenfalls strategischer Wert.

Bei fremden Gebieten:

- Besitzer.
- Königreich.
- Regionstyp.
- Angriffsberechtigung.
- Schutzzeit.
- Angriff starten.

## 11.4 Belagerungs-Dashboard

Separate Übersicht für eingehende Angriffe.

Anzeigen:

- Angegriffenes Gebiet.
- Angreifendes Königreich.
- Verbleibende Antwortfrist.
- Verfügbare Items.
- Verteidigung starten.
- Item verwenden.
- Ergebnis bereits abgeschlossener Konflikte.

Die dringendsten Konflikte erscheinen zuerst.

Auf Mobilgeräten muss diese Übersicht ohne komplizierte Navigation erreichbar sein.

## 11.5 Quizoberfläche

Anforderungen:

- Große, gut lesbare Frage.
- Deutliche Antwortbuttons.
- Sichtbarer Timer.
- Mobile Bedienbarkeit.
- Keine unnötigen Animationen während laufender Zeitmessung.
- Antwortbestätigung.
- Klare Fehlerzustände bei Verbindungsproblemen.
- Barrierearme Gestaltung.

Eine Aufgabe darf nicht allein durch einen Browser-Reload versehentlich verloren gehen.

Gleichzeitig darf ein Reload keine neue Antwortchance schaffen.

---

# 12. Technische Architektur

Der Agent soll anhand des existierenden Repository-Zustands und der vorhandenen Infrastruktur einen geeigneten Stack empfehlen.

Bevorzugt wird eine moderne TypeScript-basierte Architektur.

## 12.1 Vorschlag

**Frontend**

- React mit TypeScript.
- Geeignetes Framework, beispielsweise Next.js oder Vite.
- Responsive UI.
- Performanter Kartenrenderer, beispielsweise Canvas/WebGL bei großen Welten.
- Lokalisierungssystem.

**Backend**

- TypeScript-basierte serverseitige API.
- Serverautoritatives Spielsystem.
- Separate Spielregeln und Domänenlogik.
- Hintergrundprozesse für Belagerungsabläufe und NPC-Aktionen.
- Geeignete Echtzeitkommunikation.

**Datenbank**

- PostgreSQL als primäre persistente Datenbank.
- Relationale Speicherung von Spielern, Königreichen, Gebieten, Konflikten und Inventar.
- Versionierte Datenbankmigrationen.

**Zusätzliche Infrastruktur**

- Redis optional für Caching, Rate Limiting oder Hintergrundjobs.
- WebSockets oder geeignete Realtime-Technologie.
- Job-Queue mit dauerhaft gespeicherten Jobs.
- Monitoring, strukturierte Logs und Fehlerüberwachung.

Technologien sind Vorschläge, keine unveränderlichen Vorgaben.

## 12.2 Grundsatz: Server Authority

Der Client darf niemals die folgenden Werte verbindlich festlegen:

- Eigentümer eines Gebiets.
- Gewinner eines Quizduells.
- Richtigkeit einer Antwort.
- Antwortzeit.
- Ablauf einer Belagerung.
- Anzahl eines Items.
- Drop-Ergebnis.
- NPC-Ergebnis.
- Spielerpunkte.
- Offizielle Ranglistenwerte.

Alle entscheidenden Zustandsänderungen erfolgen ausschließlich auf dem Server.

## 12.3 Datenmodell

Mindestens folgende Domänen berücksichtigen:

### Accounts und Profile

- `users`
- `player_profiles`
- `player_settings`
- `player_statistics`

### Welten

- `worlds`
- `world_instances`
- `world_rules`
- `world_seasons`
- `world_participants`

### Karte

- `regions`
- `region_ownership`
- `region_protection`
- `region_history`

### Königreiche

- `kingdoms`
- `kingdom_memberships`
- `kingdom_statistics`
- `kingdom_history`

### NPCs

- `npc_factions`
- `npc_profiles`
- `npc_actions`

### Quiz

- `questions`
- `question_translations`
- `question_options`
- `question_versions`
- `question_reviews`
- `quiz_challenges`
- `quiz_answers`

### Kämpfe

- `sieges`
- `siege_participants`
- `battle_results`
- `battle_events`

### Items

- `item_definitions`
- `player_inventory`
- `inventory_transactions`
- `item_usage`
- `reward_events`

### Betrieb

- `notifications`
- `scheduled_jobs`
- `audit_events`
- `abuse_signals`

Dies ist ein konzeptionelles Modell, keine endgültige SQL-Spezifikation.

Der Agent soll Normalisierung, Indizes, Relationen, Constraints und Migrationsstrategie definieren.

## 12.4 Atomare Eigentumswechsel

Bei Abschluss einer Belagerung muss verhindert werden, dass parallele Prozesse unterschiedliche Sieger erzeugen.

Beispiel eines kritischen Konflikts:

1. Die 24-Stunden-Frist läuft ab.
2. Der Verteidiger sendet nahezu zeitgleich seine Antwort.
3. Ein Hintergrundjob versucht, das Gebiet dem Angreifer zuzuteilen.

Es darf niemals passieren, dass beide Vorgänge unabhängig voneinander erfolgreich Eigentumsänderungen ausführen.

Benötigt werden:

- Datenbanktransaktionen.
- Eindeutige Zustandsübergänge.
- Zeitstempel auf Serverseite.
- Locking oder Optimistic Concurrency Control.
- Idempotente Verarbeitung.
- Revisionsfähige Ereignisprotokolle.

Als verbindliche Regel gilt: Eine nach dem festgelegten Server-Deadline-Zeitpunkt eingegangene Antwort ist verspätet, selbst wenn der Timeout-Job noch nicht ausgeführt wurde.

## 12.5 Echtzeitkommunikation

Bei relevanten Ereignissen soll die UI aktualisiert werden:

- Gebiet erobert.
- Spieler angegriffen.
- Verteidigung abgeschlossen.
- Item erhalten.
- Frist verlängert.
- NPC hat expandiert.
- Saison beendet.

Das System muss bei Verbindungsunterbrechungen zuverlässig synchronisieren.

Ein reconnectender Client liest den aktuellen autoritativen Zustand vom Server.

## 12.6 Skalierung

Architekturziele:

- Viele gleichzeitig sichtbare Gebiete.
- Viele Spieler pro Welt.
- Zahlreiche offene asynchrone Belagerungen.
- Hintergrundsimulation der NPC-Königreiche.
- Mehrere parallele Daily-/Weekly-Instanzen.
- Konsistente Eigentumsverhältnisse.

Keine vollständige Weltkarte bei jeder kleinen Änderung übertragen.

Bevorzugt:

- Räumliches Chunking.
- Delta-Updates.
- Viewport-bezogene Datenabfragen.
- Geeignete Server-Caches.
- Effiziente Datenbankindizes.
- Getrennte Simulation und Darstellung.

Konkrete Kapazitätsversprechen dürfen erst nach Lasttests erfolgen.

---

# 13. Anti-Cheat und Missbrauchsschutz

Quizbasierte Multiplayer-Spiele sind besonders anfällig für Bots, automatisiertes Nachschlagen und koordinierte Manipulation.

Es gibt keine vollständig zuverlässige technische Methode, externe Recherche zu verhindern.

Das Ziel ist eine angemessene Kombination aus Fairness, Missbrauchserkennung und geringem Aufwand für normale Spieler.

## 13.1 Quiz-Manipulation

Verhindern:

- Offenlegung korrekter Antworten vor Abschluss.
- Manipulierte Client-Timer.
- Mehrfache Antwortversuche.
- Wechsel der Fragen durch Refresh.
- Unzulässige Wiederholung derselben Herausforderung.
- Vorzeitige Offenlegung der Gegnerantwort.
- Manipulation von numerischen Antworten.

Antworten werden versioniert und durch serverseitige Validierung geprüft.

## 13.2 Bot-Erkennung

Mögliche Signale:

- Ungewöhnlich perfekte Antwortquoten.
- Unnatürlich konstante Antwortzeiten.
- Sehr hohe Zahl wiederholter Kämpfe.
- Auffällige Account-Interaktionen.
- Automatisierte Request-Muster.

Maßnahmen müssen verhältnismäßig sein und dürfen normale schnelle Spieler nicht allein aufgrund guter Leistungen sanktionieren.

## 13.3 Multiaccount-Farming

Potenzielle Missbrauchsform:

Ein Spieler kontrolliert mehrere Accounts und erobert wiederholt eigene Gebiete, um Items zu erzeugen.

Gegenmaßnahmen:

- Begrenzte Dropberechtigung für wiederholte Gegner.
- Cooldowns.
- Belohnungsprotokolle.
- Missbrauchsanalyse.
- Schutz vor unendlichem Gebietswechsel.

## 13.4 Angriffsspam

Angriffslimits und aktive Belagerungsgrenzen müssen serverseitig erzwungen werden.

Gleichzeitige Requests dürfen Limits nicht umgehen.

## 13.5 Admin-Werkzeuge

Für den Betreiber erforderlich:

- Weltzustand einsehen.
- Belagerungen prüfen.
- Kampfereignisse nachvollziehen.
- Verdächtige Belohnungsmuster untersuchen.
- Quizfragen deaktivieren.
- NPC-Aktivität begrenzen.
- Problematische Accounts überprüfen.
- Technische Fehler sicher korrigieren.

Administrative Eingriffe müssen protokolliert werden.

---

# 14. Rechtliche und datenschutzbezogene Anforderungen

Das Projekt soll unabhängig von bestehenden Spielen entwickelt werden.

## 14.1 Geistiges Eigentum

Nicht übernehmen:

- Original-Quellcode anderer Spiele.
- Originalgrafiken.
- Originalsounds.
- Original-Fragendatenbanken.
- Originaltexte.
- Geschützte Marken und Logos.
- Unzulässig übernommene Design-Assets.

Eigene Karten, Icons, Quizfragen und UI-Komponenten erstellen beziehungsweise rechtmäßig lizenzieren.

Für jedes externe Asset die Herkunft und Lizenz dokumentieren.

Die rechtliche Beurteilung des finalen Designs erfordert gesonderte Prüfung.

## 14.2 Datenschutz

Bereits bei der Architektur berücksichtigen:

- Datenminimierung.
- Sichere Authentifizierung.
- Datenschutzerklärung.
- Impressum, soweit erforderlich.
- Accountlöschung.
- Datenexport beziehungsweise Auskunftsfunktionen.
- Lösch- und Aufbewahrungsregeln.
- Sichere Speicherung von Nutzerdaten.
- Regelungen für Cookies und lokalen Speicher.
- Auftragsverarbeitungsverträge, wo erforderlich.

## 14.3 Kommunikation

Ein öffentlicher Chat ist für das MVP nicht notwendig.

Dadurch können Moderations- und Missbrauchsrisiken reduziert werden.

Falls später Chat, frei wählbare öffentliche Namen oder andere nutzergenerierte Inhalte eingeführt werden, sind die jeweils anwendbaren Plattform-, Melde-, Moderations- und Jugendschutzpflichten gesondert zu prüfen.

## 14.4 Monetarisierung

Zum Start:

- Kostenlos spielbar.
- Keine Echtgeld-Einsätze.
- Keine Geldgewinne.
- Kein Pay-to-Win.
- Keine kaufbaren richtigen Antworten.
- Keine kaufbaren Verteidigungsverlängerungen.

Später sind kosmetische Monetarisierungsmodelle denkbar, benötigen jedoch eine separate Produkt- und Rechtsprüfung.

---

# 15. Benutzerreisen

## 15.1 Neuer Spieler

1. Website öffnen.
2. Sprache auswählen.
3. Kurzes Tutorial starten.
4. Eternal-Welt betreten.
5. Startgebiet erhalten.
6. Benachbartes neutrales Gebiet auswählen.
7. Trivia-Herausforderung beantworten.
8. NPC besiegen.
9. Gebiet erhalten.
10. Karte aktualisiert sich.
11. Gegebenenfalls Item erhalten.
12. Königreich kann weiter expandieren.

Ziel: Innerhalb weniger Minuten muss sich der Spieler wie der Herrscher eines kleinen wachsenden Reichs fühlen.

## 15.2 Spieler greift menschliches Gebiet an

1. Fremde angrenzende Region auswählen.
2. Angriffsberechtigung prüfen.
3. Trivia-Frage beantworten.
4. Schätzfrage beantworten.
5. Angreiferleistung wird gespeichert.
6. Belagerung startet.
7. Verteidiger erhält Nachricht.
8. Angreifer sieht verbleibende Wartefrist.
9. Verteidiger antwortet oder die Zeit läuft ab.
10. Ergebnis wird veröffentlicht.
11. Gebiet und Belohnung werden verarbeitet.

## 15.3 Spieler verlängert Verteidigung

1. Benachrichtigung über einen Angriff öffnen.
2. Belagerungsdetail aufrufen.
3. Verbleibende Zeit sehen.
4. Zeit-Item auswählen.
5. Neue Frist vor Verbrauch anzeigen.
6. Item bestätigen.
7. Server validiert den Vorgang.
8. Inventar wird reduziert.
9. Frist wird aktualisiert.
10. Änderung erscheint im Ereignisprotokoll.

## 15.4 Spieler verliert alle Gebiete

1. Letztes Gebiet wird erobert.
2. Königreichsstatistik wird aktualisiert.
3. Spieler erhält eine nachvollziehbare Niederlagenmeldung.
4. Historischer Fortschritt bleibt erhalten.
5. Ein neues geeignetes Startgebiet kann beansprucht werden.
6. Spieler kann erneut expandieren.

Ein vollständiger territorialer Verlust darf nicht bedeuten, dass ein neues Konto erstellt werden muss.

---

# 16. Entwicklungsphasen

Nicht sämtliche Funktionen gleichzeitig implementieren.

Die Architektur muss die Gesamtvision berücksichtigen, aber die Entwicklung erfolgt in unabhängig testbaren Phasen.

## Phase 0 – Analyse und Architektur

Ergebnisse:

- Repository-Audit.
- Technologievorschlag.
- Domänenmodell.
- Architekturdiagramm.
- Regelwerk mit gekennzeichneten Annahmen.
- Risikoanalyse.
- Datenbank- und API-Entwurf.
- Entwicklungsplan.
- Teststrategie.

Kritische offene Entscheidungen dokumentieren und Empfehlungen formulieren.

Keine produktiven Änderungen.

## Phase 1 – Singleplayer-Gameplay-Prototyp

Implementieren:

- Hexagonkarte.
- Kleine Testwelt mit circa 150 Regionen.
- Startgebiet.
- NPC-Regionen.
- Basis-Quizsystem.
- Schätzfragen.
- Eroberungslogik.
- Königreichsanzeige.
- Persistente Speicherung.

Akzeptanzkriterium:

Ein einzelner Spieler kann wiederholt NPC-Gebiete erobern, sein Königreich erweitern und nach erneutem Login den korrekten Weltzustand sehen.

## Phase 2 – Echter Multiplayer

Implementieren:

- Spieleraccounts.
- Mehrere menschliche Königreiche.
- Gemeinsamer Weltzustand.
- PvP-Angriffe.
- Asynchrone Trivia-Duelle.
- Serverseitige Gewinnerermittlung.
- Eigentumswechsel.
- Echtzeitaktualisierung.

Akzeptanzkriterium:

Zwei echte Spieler können auf derselben Karte gegeneinander kämpfen, ohne dass parallele Interaktionen zu inkonsistenten Gebietsbesitzverhältnissen führen.

## Phase 3 – Eternal-Belagerungen

Implementieren:

- 24-Stunden-Verteidigungsfrist.
- Belagerungsstatus.
- Hintergrundjobs.
- Automatischer Gebietsverlust bei Fristablauf.
- Benachrichtigungen innerhalb der App.
- Belagerungs-Dashboard.
- Angriffslimits.
- Eroberungsschutz.

Akzeptanzkriterium:

Eine nicht beantwortete Belagerung wird zuverlässig beendet und das Gebiet korrekt übertragen, auch wenn kein Spieler online ist oder ein Server während der Frist neugestartet wurde.

## Phase 4 – Items

Implementieren:

- Itemdefinitionen.
- Inventar.
- Belohnungswürfe.
- Zeitverlängerungen.
- Maximale Verteidigungsfrist.
- Verwendung und Transaktionshistorie.
- Anti-Farming-Regeln.
- Optionale automatische Verlängerung.

Akzeptanzkriterium:

Ein erspieltes Zeit-Item kann genau einmal zur gültigen Verlängerung einer offenen Belagerung eingesetzt werden.

## Phase 5 – Erweiterte NPC-Simulation

Implementieren:

- Mehrere NPC-Fraktionen.
- Variable Schwierigkeit.
- Automatische NPC-Expansion.
- NPC-Angriffe auf Spieler.
- Dynamische Schwierigkeitsanpassung.
- Begrenzung der NPC-Aktivität.

Akzeptanzkriterium:

Die Welt entwickelt sich nachvollziehbar weiter, auch wenn keine menschlichen Spieler aktiv sind.

## Phase 6 – Daily und Weekly

Implementieren:

- Wiederverwendbares Weltinstanzsystem.
- Separate Regelkonfigurationen.
- Tageswelten.
- Wochenwelten.
- Saisonstart und -ende.
- Saisonranglisten.
- Weltabschluss.
- Historische Ergebnisse.
- Neue Saisoninstanzen.

Akzeptanzkriterium:

Daily, Weekly und Eternal können parallel betrieben werden, ohne dass ihre Gebietsstände, Items und Fristen ungewollt ineinandergreifen.

## Phase 7 – Produktionsvorbereitung

- Lasttests.
- Security-Audit.
- Anti-Cheat-Tests.
- Usability-Tests.
- Mobile Optimierung.
- Fragequalität.
- Datenschutzprüfung.
- Lizenzprüfung.
- Monitoring.
- Backups.
- Recovery-Tests.
- Fehlerbehandlung.
- Staging-Abnahme.
- Kontrollierte Beta.

---

# 17. Teststrategie

Automatisierte Tests sind integraler Bestandteil der Entwicklung.

## 17.1 Unit-Tests

Mindestens testen:

- Angriffsberechtigung.
- Nachbarschaftsregeln.
- Quizantwort-Bewertung.
- Schätzfragen-Bewertung.
- Tiebreaker.
- NPC-Antwortlogik.
- Item-Drops.
- Maximale Zeitverlängerung.
- Königreichsränge.
- Weltabschlussregeln.

## 17.2 Integrationstests

- Gebietseroberung.
- PvP-Belagerung.
- Ablauf einer Verteidigungsfrist.
- Gleichzeitige Antworten.
- Parallele Eigentumswechsel.
- Itemverbrauch bei konkurrierenden Requests.
- NPC-Expansion.
- Neustart während aktiver Jobs.
- Daily-/Weekly-Saisonabschluss.

## 17.3 End-to-End-Tests

Beispiele:

**E2E-01: Erste Eroberung**

Neuer Spieler erhält Startgebiet, gewinnt gegen NPC und besitzt danach zwei Regionen.

**E2E-02: Trivia-Sieg**

Angreifer antwortet richtig, Verteidiger falsch, Angreifer gewinnt.

**E2E-03: Schätzfrage**

Beide beantworten Trivia korrekt, die nähere Schätzung gewinnt.

**E2E-04: Zeit-Tiebreaker**

Beide haben denselben Schätzabstand, der schnellere Spieler gewinnt.

**E2E-05: Keine Verteidigung**

24 Stunden vergehen ohne Verteidigungsantwort. Gebiet wird übertragen.

**E2E-06: Itemverlängerung**

Verteidiger verlängert eine Belagerung gültig von 24 auf 36 Stunden.

**E2E-07: Verlängerungsgrenze**

Ein Versuch, die Frist über 48 Stunden hinaus zu verlängern, wird abgelehnt oder auf den erlaubten Wert begrenzt, ohne unzulässigen Itemverbrauch.

**E2E-08: Neustart**

Server wird während einer Belagerung neu gestartet. Die Belagerung bleibt korrekt gespeichert.

**E2E-09: Parallelität**

Zwei gleichzeitige Vorgänge können dasselbe Gebiet nicht widersprüchlich übertragen.

**E2E-10: Mehrsprachigkeit**

Zwei Spieler erhalten dieselbe Frage auf unterschiedlichen Sprachen und werden korrekt bewertet.

**E2E-11: Keine doppelte Belohnung**

Ein wiederholtes Abschicken oder erneutes Verarbeiten eines abgeschlossenen Kampfes erzeugt keine doppelten Items.

**E2E-12: Welttrennung**

Eine Gebietsänderung in der Weekly-Welt verändert keine Eternal-Gebiete.

---

# 18. Observability und Betrieb

Von Anfang an benötigen wir nachvollziehbare technische Informationen.

Mindestens:

- Anzahl aktiver Spieler.
- Anzahl gleichzeitig offener Belagerungen.
- Durchschnittliche Konfliktdauer.
- Fehlerrate der Quiz-API.
- Latenz bei Antworten.
- Rate fehlgeschlagener Eigentumswechsel.
- NPC-Aktivität pro Welt.
- Item-Dropverteilung.
- Serverlast.
- Datenbanklast.
- Fehler in Hintergrundjobs.
- Reconnects und Synchronisationsfehler.

Wichtige Spielereignisse müssen mithilfe eindeutiger IDs nachvollziehbar sein.

Es muss möglich sein, einen strittigen Kampf anhand seiner Ereignisdaten zu rekonstruieren.

---

# 19. Risiken und offene Designentscheidungen

## 19.1 Hohe Priorität

**A. Skalierung großer Königreiche**

Wie viele Gebiete kann ein Spieler besitzen, bevor Einzelverteidigungen unpraktisch werden?

Empfehlung: Begrenzte gleichzeitige Belagerungen plus spätere Provinzverwaltung.

**B. Asynchrone Quizfairness**

Wie werden Antwortzeiten fair gemessen und Fragenleaks reduziert?

Empfehlung: Versionierte Fragen, serverseitige Zeitmessung und definierte Tie-Break-Protokolle.

**C. Inaktive Spieler**

Wie wird mit jahrelang nicht gespielten Königreichen umgegangen?

Empfehlung: Späteres geregeltes Inaktivitäts- und Zerfallssystem, keine voreilige harte Löschung.

**D. Kartendichte**

Wie können neue Spieler langfristig starten?

Empfehlung: Dynamische Kartenerweiterung und geeignete Einstiegszonen.

**E. Verteidigungsdruck**

Wie verhindern wir, dass sich das Spiel nach ständiger Anwesenheitspflicht anfühlt?

Empfehlung: Angriffslimits, Zeit-Items, Schutzzeiten und kontrollierte Maximalverluste.

## 19.2 Mittlere Priorität

**F. Zufallsbelohnungen**

Wie häufig sollen Zeit-Items erscheinen?

Empfehlung: Drops durch Simulationen mit unterschiedlichen Spielertypen balancieren.

**G. NPC-Schwierigkeit**

Wie bleibt die NPC-Schwierigkeit unabhängig von reinem Gebietsfarming angemessen?

Empfehlung: Spielerleistung, Erfahrung und regionale Schwierigkeit kombinieren.

**H. Weltgröße**

Wie viele Spieler und Regionen unterstützt eine einzelne Eternal-Instanz?

Empfehlung: Architektur anhand von Lastprofilen und tatsächlichen Benchmarks festlegen.

**I. Daily-/Weekly-Regeln**

Wie schnell müssen diese Modi sein?

Empfehlung: Eigene Antwortfristen und eigene Angriffsbudgets.

**J. Quizdatenbank**

Wie erhalten wir viele korrekte, rechtmäßig nutzbare Fragen in mehreren Sprachen?

Empfehlung: Eigene redaktionell geprüfte Datenbank mit Versionierung und Quellenangaben.

---

# 20. Konkreter Auftrag an Claude Code

Du übernimmst die Rolle des technischen Projektleiters und Hauptentwicklungsagenten.

Deine Aufgabe ist nicht nur, einzelne Dateien zu erstellen, sondern die Entwicklung dieses Produkts systematisch vorzubereiten und schrittweise umzusetzen.

## Arbeitsweise

1. Untersuche zunächst das vorhandene Repository und seine Infrastruktur.
2. Ermittle, welche technischen Komponenten bereits verfügbar sind.
3. Erstelle ein fundiertes Architekturkonzept.
4. Identifiziere widersprüchliche oder unvollständige Anforderungen.
5. Trenne ausdrücklich bestätigte Regeln von Designvorschlägen.
6. Schlage für offene technische Details sinnvolle Lösungen vor.
7. Plane die Umsetzung in überprüfbaren Phasen.
8. Verhindere unnötige Überarchitektur, ohne die Skalierbarkeit zu gefährden.
9. Implementiere Komponenten mit ausreichenden Tests.
10. Dokumentiere alle relevanten technischen Entscheidungen und Änderungen.

## Entscheidungsautonomie

Du darfst selbstständig technische Implementierungsentscheidungen treffen, sofern diese:

- Zum definierten Produktziel passen.
- Keine bestätigten Spielregeln verändern.
- Keine unfreigegebenen produktiven Änderungen verursachen.
- Die Wartbarkeit nicht unnötig verschlechtern.
- Dokumentiert und nachvollziehbar bleiben.

Produktentscheidungen mit erheblichem Einfluss auf Fairness, Monetarisierung, Spielerprogression oder irreversible Datenmodelle müssen als offene Entscheidungen gekennzeichnet und mit einer Empfehlung versehen werden.

Nichtkritische offene Details dürfen mit einer klar gekennzeichneten, leicht änderbaren Standardannahme umgesetzt werden.

## Pflichtdokumentation

Erstelle und pflege geeignete Projektdateien, beispielsweise:

- `docs/PRODUCT_VISION.md`
- `docs/GAME_RULES.md`
- `docs/WORLD_SYSTEM.md`
- `docs/QUIZ_ENGINE.md`
- `docs/SIEGE_SYSTEM.md`
- `docs/ITEM_SYSTEM.md`
- `docs/NPC_SYSTEM.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/SECURITY.md`
- `docs/DEVELOPMENT_ROADMAP.md`
- `docs/DECISIONS.md`
- `docs/TEST_PLAN.md`

Die Aufteilung darf angepasst werden, wenn dadurch eine bessere Dokumentationsstruktur entsteht.

## Qualitätsanforderungen

- Sauber typisierter Code.
- Klare Modulschnittstellen.
- Serverseitige Datenvalidierung.
- Nachvollziehbare Fehlerbehandlung.
- Automatisierte Tests.
- Reproduzierbare Builds.
- Datenbankmigrationen.
- Sichere Konfiguration.
- Keine hardcodierten Secrets.
- Keine direkten Änderungen an Produktivdaten ohne Freigabe.
- Klare Trennung von Staging und Produktion.

## Berichterstattung

Nach jedem größeren Arbeitsschritt erwarte ich einen ausführlichen, strukturierten Bericht.

Dieser soll mindestens enthalten:

1. Was wurde analysiert?
2. Was wurde implementiert?
3. Welche Dateien und Komponenten wurden verändert?
4. Welche Architekturentscheidungen wurden getroffen und warum?
5. Welche Tests wurden ausgeführt?
6. Welche Tests sind fehlgeschlagen oder noch nicht vorhanden?
7. Welche Risiken bestehen?
8. Welche Regeln wurden nur vorläufig angenommen?
9. Welche Entscheidungen benötigst du vom Product Owner?
10. Was ist der sinnvollste nächste Schritt?

Berichte sollen ausreichend detailliert sein, damit ein externer technischer Reviewer die Arbeit und die Entscheidungen nachvollziehen kann.

## Erste konkrete Lieferung

Beginne mit Phase 0.

Liefere:

- Eine Architekturübersicht.
- Ein konsistentes Datenmodell.
- Einen klaren Entwurf des Quiz- und Belagerungsprotokolls.
- Einen Entwurf der Eternal-Welt und ihrer Skalierungsstrategie.
- Einen NPC-Systementwurf.
- Eine Analyse der Itemökonomie.
- Einen schrittweisen Implementierungsplan.
- Eine priorisierte Liste relevanter offener Entscheidungen.
- Eine klare Definition des ersten spielbaren MVP.

Anschließend können technisch unabhängige, risikoarme Grundlagen umgesetzt werden.

Produktive Veröffentlichung, kostenpflichtige Infrastrukturentscheidungen und irreversible Produktionsmigrationen benötigen gesonderte Freigabe.

---

# 21. Erfolgskriterien des Projekts

Das Produkt ist erfolgreich, wenn Spieler:

1. Innerhalb weniger Minuten ihr erstes Gebiet erobern können.
2. Den Aufbau ihres Königreichs als langfristiges Ziel wahrnehmen.
3. Quizduelle als fair und verständlich erleben.
4. Gegen NPCs spielen können, auch wenn wenige Menschen online sind.
5. Andere Spieler strategisch angreifen können.
6. Bei Eternal-Angriffen eine nachvollziehbare Reaktionsfrist besitzen.
7. Zeitverlängerungs-Items als wertvolle, aber nicht zwingend notwendige Ressource wahrnehmen.
8. Daily-, Weekly- und Eternal-Welten als unterschiedliche Spielangebote verstehen.
9. Auch nach einer vollständigen Niederlage sinnvoll weiterspielen können.
10. Spaß am eigenen Wissen und der territorialen Strategie entwickeln, ohne für Wettbewerbsvorteile zahlen zu müssen.

# Abschließende Produktvision

**Reiche des Wissens soll kein klassisches Quiz mit einer dekorativen Karte sein.**

Es soll ein lebendiges Multiplayer-Strategiespiel werden, dessen wichtigste Ressource Wissen ist.

Spieler errichten Königreiche, kämpfen um Territorien, verteidigen Grenzen und treffen langfristige strategische Entscheidungen.

Die Welt entwickelt sich auch ohne permanente Anwesenheit jedes einzelnen Spielers weiter.

Der zentrale Gameplay-Loop bleibt:

**Wissen einsetzen → Gebiete erobern → Königreich erweitern → Gebiete verteidigen → neue Herausforderungen meistern.**

Das Produkt muss technisch so entwickelt werden, dass die grundlegende Spielidee von Beginn an funktioniert und spätere Erweiterungen nicht zu einer vollständigen Neuentwicklung führen.
