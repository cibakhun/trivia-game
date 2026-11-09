# Produktvision

Quelle: Brief §1, §21, „Abschließende Produktvision“. Dieses Dokument verdichtet die Vision und ergänzt Abgrenzungen, die für Architektur und Priorisierung wichtig sind.

## 1. Vision in einem Satz

Ein browserbasiertes Multiplayer-Strategiespiel, in dem **Wissen die wichtigste Ressource** ist: Spieler erobern mit Quizduellen Gebiete auf einer gemeinsamen Hexagon-Karte, bauen über Wochen ein Königreich auf und verteidigen es asynchron gegen Menschen und NPC-Reiche.

**Kern-Loop:** Wissen einsetzen → Gebiete erobern → Königreich erweitern → Gebiete verteidigen → neue Herausforderungen meistern.

## 2. Zielgruppen (Annahme [E])

| Segment | Bedürfnis | Hauptmodus |
|---|---|---|
| Quiz-Enthusiasten (DE/HU/EN) | Wissen messen, fair gewinnen | Daily, Weekly |
| Strategiespieler mit wenig Zeit | Langfristiger Fortschritt in kurzen Sitzungen | Eternal |
| Gelegenheitsspieler mobil | „Eine Verteidigung in der Mittagspause“ | Eternal (Belagerungs-Dashboard) |

Gespielt wird nur auf Deutsch (PO-Entscheidung 2026-11-09, ADR-023; der Brief sah zusätzlich Ungarisch und Englisch vor). Die Technik hält die Sprachkennung offen, sodass eine weitere Sprache später ohne Umbau möglich ist.

## 3. Produktprinzipien (Brief §1.2) und ihre technische Konsequenz

| Prinzip | Konsequenz in diesem Entwurf |
|---|---|
| 1. Wissen ist primäre Voraussetzung | Verdecktes Angreifer-Gate (entschieden, [O-01]): ohne richtige Antwort keine Eroberung; wer sich verteidigt, wird mit Punkten belohnt |
| 2. Strategie bestimmt Ziele | Nachbarschaftsregel, Angriffsbudgets, Priorisierung im Dashboard |
| 3. Aktivität belohnen, Offlinezeit nicht vollständig bestrafen | 24 h Frist, Items bis 48 h, Kappung offener Belagerungen pro Reich, Urlaubsmodus als Option ([O-06]) |
| 4. Große Reiche mächtig, nicht unangreifbar | Jede Region einzeln eroberbar, Belagerungskapazität pro Reich ([O-05]) |
| 5. Funktioniert mit wenigen Spielern | NPC-Fraktionen und neutrale Regionen ab Phase 1 |
| 6. NPCs halten die Welt lebendig | Weltsimulation im Worker, unabhängig von Spieleraktivität |
| 7./8. Fairness vor Monetarisierung, kein Pay-to-Win | Items nur erspielbar, keine Kaufoptionen im Datenmodell vorgesehen |
| 9. Serverseitige Validierung | Server-Autorität für alle Entscheidungen, Client ist reine Darstellung |
| 10. Mehrere Weltinstanzen | Jede Spielzeile trägt `instance_id`; Regeln pro Instanz versioniert |

## 4. Nicht-Ziele (bis auf Weiteres)

- Kein öffentlicher Chat, keine frei wählbaren öffentlichen Texte im MVP (Moderationsaufwand, Brief §14.3).
- Keine Echtgeld-Mechaniken, keine Geldgewinne, keine kaufbaren Vorteile (Brief §14.4).
- Keine native App; mobil über responsive Web-App (PWA-fähig für Push-Benachrichtigungen).
- Keine Sprachmodelle zur Entscheidung von Duellen (Brief §6.3); KI höchstens als Entwurfshilfe in der redaktionellen Fragenpipeline.
- Keine visuelle oder inhaltliche Nähe zu bestehenden Spielen (Brief §11.1, §14.1).

## 5. Erfolgskriterien und messbare Indikatoren

Brief §21 nennt zehn qualitative Erfolgskriterien. Für Beta-Tests werden sie messbar gemacht ([E]):

| Kriterium (Brief §21) | Indikator | Zielwert Beta (Annahme) |
|---|---|---|
| 1. Erste Eroberung in Minuten | Median Zeit von Erstbesuch bis zweiter Region | < 3 min |
| 2. Königreich als Langzeitziel | D7-Rückkehrquote | > 25 % |
| 3. Duelle fair und verständlich | Umfrage „Ergebnis war nachvollziehbar“ | > 80 % Zustimmung |
| 4. Spielbar mit wenigen Menschen | Anteil Sitzungen mit ≥ 1 PvE-Kampf | > 90 % |
| 5. Strategische PvP-Angriffe | Anteil aktiver Spieler mit ≥ 1 PvP-Angriff/Woche | > 40 % |
| 6. Nachvollziehbare Reaktionsfrist | Anteil Belagerungen, die durch Timeout enden | < 35 % |
| 7. Items wertvoll, nicht zwingend | Anteil verteidigter Belagerungen ohne Itemnutzung | > 70 % |
| 8. Weltarten als unterschiedliche Angebote verstehen | **in der Beta nicht messbar** (Daily/Weekly erst Phase 6); ab Phase 6: Umfrage „Unterschied der Welten ist klar“ und Anteil Spieler, die ≥ 2 Weltarten nutzen | ab Phase 6: > 80 % bzw. > 30 % |
| 9. Weiterspielen nach Niederlage | Anteil Spieler mit Neustart nach Totalverlust | > 50 % |
| 10. Spaß an Wissen und Strategie, ohne zu zahlen | Umfrage „Spaß am Wissen und an der Gebietsstrategie“ (1–5); „ohne zu zahlen“ ist in der Beta mangels Monetarisierung erfüllt und wird erst mit einem Monetarisierungskonzept geprüft ([SECURITY.md §7](SECURITY.md#7-monetarisierungsschutz)) | Ø ≥ 4,0 |
| — Datenkonsistenz | Verstöße gegen Besitz-Invarianten (Prüfjob) | 0 |
| — Fragenqualität | Gemeldete Fehler pro 1 000 gestellte Fragen | < 2 |
