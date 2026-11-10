# Regelwerk

Kennzeichnung: **[V]** verbindlich · **[A]** Annahme aus dem Brief (konfigurierbar) · **[E]** Empfehlung (Standard, änderbar) · **[O-xx]** offene PO-Entscheidung. Details zu den Teilsystemen stehen in den verlinkten Dokumenten; dieses Dokument ist die zusammenfassende Referenz.

---

## 1. Grundbegriffe

| Begriff | Definition |
|---|---|
| **Welt** (`world`) | Definition eines Spielangebots: Modus `ETERNAL`, `DAILY` oder `WEEKLY`, Regelvorlage, Sprache(n). |
| **Weltinstanz** (`world_instance`) | Eine konkrete, laufende Karte. Eternal hat eine langlebige Instanz, Daily/Weekly erzeugen pro Saison mehrere. Alle Spielzustände gehören genau einer Instanz [V, Brief §3.4]. |
| **Region** | Ein Hexfeld der Karte. Kleinste eroberbare Einheit. |
| **Königreich** (`kingdom`) | Besitzeinheit. Gehört einem Spieler (`PLAYER`) oder einer NPC-Fraktion (`NPC`). Neutrale Regionen haben keinen Besitzer. |
| **Herausforderung** (`quiz_challenge`) | Die festgelegte Folge von Fragen eines Kampfes. Angreifer und Verteidiger erhalten **dieselbe** Herausforderung [V, Brief §5.1/§5.4]. |
| **Leistung** (`performance`) | Was ein Teilnehmer in der Herausforderung erbracht hat: Trivia richtig/falsch, Schätzwert, effektive Antwortzeit. |
| **Kampf** (`battle`) | Auswertung zweier Leistungen. PvE-Kämpfe werden sofort ausgewertet, PvP-Kämpfe über eine Belagerung. |
| **Belagerung** (`siege`) | Ein laufender Kampf um eine Region mit Verteidigungsfrist. Pro Region höchstens eine aktive Belagerung [A, technisch erzwungen]. |

## 2. Karte und Nachbarschaft

- Hexagonale Karte, axiale Koordinaten `(q, r)`, Ausrichtung „pointy-top“ [A].
- Jede Region hat bis zu sechs Nachbarn: `(q+1,r) (q-1,r) (q,r+1) (q,r-1) (q+1,r-1) (q-1,r+1)` [A].
- Regionen sind in Chunks von 16 × 16 Feldern organisiert ([WORLD_SYSTEM.md §3](WORLD_SYSTEM.md#3-karte-chunks-und-erzeugung)) [E].
- Regionstypen im MVP: neutral, NPC, Spieler, Hauptstadt-Markierung [A, Brief §4.2]. Gelände/Biom ist im MVP rein kosmetisch [E]. „Strategische Region“ ist im Datenmodell vorgesehen, aber ohne Regeln [A].
- Jede Region hat eine **Regionsstufe** (`tier`, 0–10), die die Stärke neutraler Verteidiger und die Fragenschwierigkeit bestimmt [E].

## 3. Königreich, Hauptstadt, Ränge, Totalverlust

1. Ein Spieler hat pro Weltinstanz höchstens ein aktives Königreich [A, Brief §4.4].
2. Die erste beanspruchte Region ist die Hauptstadt [A].
3. **Hauptstadt-Leben** [V, PO 2026-11-10, ADR-037]: Eine Hauptstadt hat drei Leben (`capital.lives`). Jeder Sieg eines Angreifers über die Hauptstadt kostet ein Leben; die Hauptstadt bleibt dann beim Reich und ist für `capital.protectionAfterHit` geschützt (Schutzgrund `CAPITAL_HIT`). Ohne neuen Treffer kehrt nach je `capital.lifeRegen` ein Leben zurück, höchstens bis zum vollen Stand; jeder Treffer startet diesen Takt neu. Die Zeiten hängen vom Modus ab (§10): Eternal und Weekly 1 h Schutz und 24 h je Leben, Daily 10 min und 4 h. Ein Sieg des Verteidigers kostet nichts. Die Regel gilt für Spieler- und NPC-Reiche gleich. Für Hauptstädte von Spielerreichen gilt seit PvP (Phase 2 Paket 1, umgesetzt) zusätzlich [V, [O-20] Option B]: Ein Leben kostet nur ein Sieg in einer PvP-Belagerung, in der der Verteidiger seine volle Verteidigungsfrist hatte, und jedes angreifende Reich trifft dieselbe Hauptstadt höchstens einmal je `capital.hitCooldownPerAttacker`. Die Sperre ist halb so lang wie die Erholung (`capital.lifeRegen`): Ein einzelner Angreifer kann eine Spielerhauptstadt allein einnehmen, braucht dafür aber drei Siege über mindestens die Erholungszeit (Eternal und Weekly 24 h, Daily 4 h). Mit gleich langer Sperre und Erholung ginge es allein nie, weil sich die Hauptstadt vor dem nächsten Treffer erholt.
4. **Übernahme:** Der Sieg, der das letzte Leben nimmt, übernimmt das ganze Reich: Alle Regionen gehen an den Angreifer (die Hauptstadt als Eroberung, die übrigen als Übernahme, alle mit Eroberungsschutz), das Reich fällt (Punkt 6). Laufende Angriffe Dritter auf Regionen dieses Reichs werden abgebrochen (`CANCELLED`). Die frühere Hauptstadt wird eine gewöhnliche Region des Angreifers; eine Hauptstadt wechselt nie mehr automatisch, weil sie nur mit dem ganzen Reich verloren gehen kann (ersetzt den Hauptstadtwechsel der Fassung vom 2026-11-09).
5. Hauptstädte sind angreifbar, außer unter Anfänger- oder Wiederaufbauschutz [A, Brief §4.5] und im Schutz nach einem Treffer.
6. **Totalverlust:** Das Königreich erhält den Status `FALLEN`, bleibt mit Statistik und Historie erhalten [V-nah, Brief §4.5/§15.4]. Der Spieler kann sofort ein neues Königreich in einer geeigneten Startregion gründen [A] und erhält 24 h Wiederaufbauschutz [E] (umgesetzt in Phase 2 Paket 1: „Neues Reich gründen“ auf der Karte, ADR-042). Inventar gehört zum Spieler in der Instanz, nicht zum Königreich, und bleibt erhalten [E].
7. Ränge sind rein kosmetisch und beeinflussen keine Spielwerte [A, Brief §4.4]:

| Regionen | Rang |
|---|---|
| 1–4 | Siedlung |
| 5–14 | Dorfverbund |
| 15–39 | Fürstentum |
| 40–99 | Königreich |
| 100–249 | Großreich |
| 250+ | Imperium |

8. Königreichsnamen werden im MVP aus Bausteinen generiert, nicht frei eingegeben [E, [O-10]] – das vermeidet Moderationspflichten für nutzergenerierte Inhalte (Brief §14.3). Umsetzung: Vorsilbe + Endung aus festen deutschen Listen (`names.ts` in `game-core`, z. B. „Falkenstein“), ist der Name in der Instanz vergeben, wird neu gezogen, insgesamt höchstens achtmal (danach bleibt der letzte Name); Farbe ist ein Index 0–15, bevorzugt eine wenig benutzte. Gespeichert werden die Bausteine (`kingdoms.name_parts`), angezeigt wird Rang + Name.

## 4. Angriffsberechtigung

Der Server prüft beim Start eines Angriffs in dieser Reihenfolge (alle Prüfungen innerhalb einer Transaktion mit Sperren, siehe [SIEGE_SYSTEM.md §5](SIEGE_SYSTEM.md#5-nebenläufigkeit-und-sperrreihenfolge)):

1. Instanz ist aktiv; bei Daily/Weekly ist für PvP der Angriffsschluss noch nicht erreicht ([WORLD_SYSTEM.md §6](WORLD_SYSTEM.md#6-daily-und-weekly)) [E].
2. Angreiferkönigreich ist `ACTIVE`.
3. Zielregion gehört zur selben Instanz und nicht dem Angreifer.
4. **Nachbarschaft:** Die Zielregion grenzt an mindestens eine Region des Angreifers [A, Brief §4.3 Grundregel].
5. Keine aktive Belagerung auf der Zielregion [A, Brief §7.4].
6. Zielregion ist nicht geschützt (`protected_until`), Zielkönigreich ist nicht unter Anfänger-/Wiederaufbauschutz, und die Rangabstandsregel ist erfüllt ([§7](#7-limits-und-schutzzeiten)). Ist das Ziel die Hauptstadt eines Spielerreichs, darf dasselbe angreifende Reich sie nicht innerhalb von `capital.hitCooldownPerAttacker` getroffen haben (`CAPITAL_HIT_COOLDOWN`, §3 Punkt 3). Der eigene Anfänger- oder Wiederaufbauschutz verhindert keinen Angriff; ein PvP-Angriff beendet ihn, und die Regionsdetails weisen vorher darauf hin (§7) [E].
7. Der Angreifer hat keine andere Herausforderung in Bearbeitung (max. eine gleichzeitig) [E].
8. Budgets gemäß Regelkonfiguration der Instanz ([§10](#10-parametertabelle)): PvP – `attack.maxNewPvpSiegesPerAttacker` und `attack.maxPvpAttemptsPerAttacker` (Eternal 3/6 je 24 h, Weekly 6/12 je 24 h, Daily 4/8 je 1 h); Verteidiger hat weniger als `attack.maxOpenSiegesPerDefender` offene oder in Vorbereitung befindliche Belagerungen (Eternal/Weekly/Daily 4/3/2); PvE – `attack.maxPveAttemptsPerPlayer` nicht erschöpft (Eternal/Weekly/Daily 50/60/unbegrenzt, [O-08]). Kennzeichnung der Werte siehe §10.

Ein Angriffs**versuch** zählt ab dem Moment, in dem die erste Frage angezeigt wird; eine **Belagerung** zählt, sobald sie eröffnet ist. Abbrechen nach Sicht der Frage gilt als gescheiterter Angriff [E]. Sonst könnten Spieler Fragen „durchblättern“, bis eine leichte kommt. Abgebrochene Angriffe belasten den Verteidiger nicht, sind aber durch das Versuchskontingent begrenzt. Jeder **abgeschlossene** PvP-Angriff eröffnet dagegen eine Belagerung – auch wenn der Angreifer falsch lag (verdecktes Gate, §5.2) – und zählt damit gegen das Belagerungskontingent [V, O-01].

## 5. Duellauswertung

### 5.1 Ablauf einer Herausforderung [V/E]

Jeder Teilnehmer beantwortet in dieser Reihenfolge, ohne Zwischenergebnis:

1. eine Multiple-Choice-Frage (Trivia) mit Zeitlimit 20 s [E],
2. unmittelbar danach eine Schätzfrage mit Zeitlimit 30 s [E] – **nur als Tiebreaker, wenn beide Seiten die Trivia-Frage richtig beantwortet haben** [V] (PO-Entscheidung 2026-11-10; ersetzt „auch wenn sie am Ende nicht gebraucht wird“, Brief §5.5). Im PvE wird sie nur dann gestellt. Im PvP wird sie immer gestellt, entscheidet aber ebenfalls nur bei Gleichstand (unten, [O-19]). „Keine Schätzfrage“ in der Tabelle gilt deshalb für den PvE-Ablauf; im PvP wird sie in diesen Fällen gestellt und zählt nicht.

| Angreifer | Verteidiger | Ergebnis |
|---|---|---|
| richtig | falsch | Angreifer erobert das Gebiet, keine Schätzfrage (Stufe 2) |
| falsch | falsch | Angriff fehlgeschlagen, keine Schätzfrage (Stufe 0) |
| falsch | richtig | Angriff fehlgeschlagen, keine Schätzfrage (Stufe 0) [E: vom PO nicht ausdrücklich genannt, folgt aus dem Gate] |
| richtig | richtig | Schätzfrage entscheidet (Stufen 3–5) |

Im PvE stehen die Antworten der Verteidigung (NPC oder Garnison) vor der ersten Frage versiegelt fest; der Server stellt die Schätzfrage deshalb nur bei Gleichstand und löst sonst direkt nach der Trivia-Frage auf. Im PvP antwortet der Verteidiger erst nach dem Angreifer; das Erscheinen der Schätzfrage würde ihm verraten, dass der Angreifer richtig lag. Deshalb beantworten im PvP beide Seiten immer beide Fragen, und die Schätzung zählt nur bei Gleichstand; die Oberfläche sagt dazu „Zählt nur, wenn ihr beide richtig liegt“ [V, [O-19] Option A, PO 2026-11-10; umgesetzt in Phase 2 Paket 1].

Die Oberfläche sagt „Deine Antworten sind gespeichert“ und behauptet nie, beide hätten richtig geantwortet [V-nah, Brief §5.5].

### 5.2 Entscheidungsreihenfolge

Für die Auswertung stehen beide Leistungen fest. Entscheidend ist die erste Stufe, die einen Unterschied ergibt:

| Stufe | Regel | Kennz. |
|---|---|---|
| 0 | **Verdecktes Angreifer-Gate:** Angreifer hat die Trivia-Frage falsch → der Angriff scheitert in jedem Fall, das Gebiet bleibt beim Verteidiger. Die Belagerung wird trotzdem eröffnet, und niemand erfährt vor der Auflösung, dass der Angreifer falsch lag. Verteidigt sich der Verteidiger rechtzeitig (alle ihm gestellten Fragen beantwortet, §5.5), gewinnt er (`DEFENDER_WON`, Grund `ATTACKER_GATE`) und erhält Verteidigungspunkte (§5.5). Verteidigt er nicht, endet die Belagerung bei Fristablauf als `ATTACK_FAILED` – ohne Punkte, ohne Gebietsverlust. | [V] (PO-Entscheidung [O-01], 2026-11-09) |
| 1 | Angreifer richtig, Verteidiger hat bis zur Frist keine Verteidigung begonnen → Angreifer gewinnt (`ATTACKER_WON_BY_TIMEOUT`). Eine begonnene Verteidigung wird immer nach den folgenden Stufen ausgewertet. | [V] |
| 2 | Genau einer hat die Trivia richtig → dieser gewinnt (Fall A) | [V] |
| 3 | Beide richtig → kleinerer absoluter Abstand der Schätzung gewinnt (Fall B) | [V] |
| 4 | Gleicher Abstand → kürzere effektive Antwortzeit der Schätzfrage gewinnt (Fall C) | [V] |
| 5 | Auch die Zeit ist auf die Millisekunde gleich → Verteidiger hält | [E] |

Fehlende Antworten (Zeitlimit überschritten) zählen als falsch (Trivia) bzw. als unendlicher Abstand und unendliche Zeit (Schätzung) [E].

**Warum das verdeckte Angreifer-Gate ([O-01], entschieden):** Der Brief-Vorschlag für Fall D („beide falsch → bis zu drei neue Runden“) ist mit asynchronen Belagerungen nicht vereinbar, ohne dass der Angreifer vorab drei Trivia-Fragen plus Schätzfrage beantwortet. Mit dem Gate entfällt Fall D vollständig, und jede Eroberung setzt eine richtige Antwort voraus (Prinzip 1); auch ein Sieg durch Zeitablauf ist nie „unverdient“. Dass die Belagerung trotzdem eröffnet wird, hält die Angreiferleistung bis zur Auflösung geheim (Brief §5.5) und gibt dem Verteidiger in jedem Fall die Gelegenheit, sich zu verteidigen und dafür belohnt zu werden.

Folgen [E]: Auch falsche Angriffe belegen bis zur Auflösung einen der offenen Belagerungsplätze des Verteidigers und verbrauchen das Belagerungskontingent des Angreifers. Ein Verteidiger kann ein Zeit-Item für eine Belagerung einsetzen, die ohnehin gescheitert wäre – das ist der Preis der verdeckten Information. Alternativen und Abwägung: [DECISIONS.md, O-01](DECISIONS.md#o-01-angreifer-gate-statt-fall-d).

### 5.3 Zeitmessung

Maßgeblich ist die serverseitig bestimmte Antwortzeit der Schätzfrage [V]. Sie wird aus Serverzeitstempeln gebildet; eine vom Client gemeldete Zeit wird nur innerhalb eines gemessenen Latenzfensters (höchstens 500 ms) berücksichtigt [E]. Details und unvermeidbare Unterschiede: [QUIZ_ENGINE.md §6](QUIZ_ENGINE.md#6-zeitmessung-und-latenzausgleich).

### 5.4 Sprache

Gespielt wird nur auf Deutsch [V, PO 2026-11-09, ADR-023; der Brief sah de/hu/en vor]. Bewertet wird trotzdem die sprachunabhängige Antwort-ID bzw. der normalisierte Zahlenwert [V, Brief §10.3]; Daten und Schnittstellen behalten die Sprachkennung, damit eine weitere Sprache später ohne Umbau ergänzt werden kann. Dann erhalten beide Teilnehmer dieselbe Fragenversion, jeweils in ihrer Sprache.

### 5.5 Verteidigungspunkte [V Grundsatz, E Werte, [O-18]]

- **Grundsatz [V, PO 2026-11-09]:** Wer sich gegen eine Belagerung rechtzeitig verteidigt, erhält Verteidigungspunkte dafür, dass er das Quiz gemacht hat (Teilnahme). Hat er die Trivia-Frage richtig beantwortet, erhält er mehr (Bonus). Ohne eigene Verteidigung gibt es keine Punkte, auch wenn der Angriff am Gate scheitert.
- **Unabhängig vom Ausgang [V, PO 2026-11-09]:** Die Punkte belohnen, dass sich der Verteidiger dem Angriff im Quiz entgegengestellt hat. Auch wer das Gebiet trotz Verteidigung verliert, erhält die Teilnahmepunkte und bei richtiger Antwort den Bonus. Deshalb verraten die Punkte nichts darüber, ob der Angreifer richtig lag.
- **Was als Verteidigung zählt [E]:** Jede Frage, die dem Verteidiger gestellt wurde, ist innerhalb ihres Zeitlimits beantwortet: die Trivia-Frage und die Schätzfrage, sofern sie gestellt wurde (im PvE nur als Tiebreaker, im PvP immer, §5.1 und [O-19]). Wer im PvE die Trivia-Frage falsch beantwortet und deshalb keine Schätzfrage bekommt, hat sich vollständig verteidigt; im PvP gehören immer beide Fragen zur Verteidigung. Wer die Verteidigung nur öffnet und nicht antwortet, erhält nichts.
- **Wirkung [E]:** Bis zur Entscheidung über [O-18] verschaffen Punkte keinen spielmechanischen Vorteil (nur Ansehen und Rangliste). Richtung laut PO: später für Kosmetik oder Emojis an andere Spieler. Ausgeben senkt nie den Ranglisten- oder Saisonwert; dafür gäbe es ein eigenes Guthaben mit Buchungsprotokoll und atomarer Abbuchung, das zusammen mit dem Nutzen in [O-18] spezifiziert wird [E].
- **Schutz gegen Absprachen [E]:** höchstens 2 punktbringende Verteidigungen je Paar aus Angreifer- und Verteidigerreich pro 24 h (Teilnahme und Bonus zusammen); keine Punkte, wenn die Konten als verdächtig verknüpft markiert sind ([SECURITY.md §4](SECURITY.md#4-missbrauch-multiaccounts-und-bots)); auffällig viele Gate-Fehlschläge desselben Angreifers gegen dasselbe Ziel erzeugen ein Missbrauchssignal.

**Werte [E, [O-18]]:**

| Modus | Teilnahme | Bonus bei richtiger Trivia-Antwort | höchstens je Verteidigung |
|---|---|---|---|
| Eternal | 5 Verteidigungspunkte | +5 | 10 |
| Daily/Weekly | 2 Saisonpunkte | +3 | 5 (wie eine Eroberung) |

Eternal-Punkte erscheinen im Reichsprofil, im globalen Spielerprofil und in der Rangliste „Verteidiger“. Saisonpunkte zählen zur Wertung der Daily-/Weekly-Instanz ([WORLD_SYSTEM.md §6.3](WORLD_SYSTEM.md#63-wertung-vorschlag-transparent-e)).

Stand Phase 2 Paket 1: Punkte und Paarsperre sind umgesetzt und werden in der Reichs- und Spielerstatistik gezählt; die Auflösung zeigt dem Verteidiger seine Punkte (oder dass die Paarsperre griff). Profil, Rangliste, Saisonwertung und die Prüfung verknüpfter Konten folgen.

## 6. Eternal-Verteidigung

| Regel | Wert | Kennz. |
|---|---|---|
| Standardfrist ab Eröffnung der Belagerung | 24 h | [V] |
| Keine gültige Verteidigung bis Fristende → Gebietsverlust | – | [V] |
| Maximale Frist inkl. Items, gerechnet ab Eröffnung | 48 h | [A] |
| Eine nach der Frist eingegangene Antwort ist verspätet, auch wenn der Timeout-Job noch nicht lief | – | [V, Brief §12.4] |
| Verteidigung kann nur **begonnen** werden, wenn die Restzeit für die gesamte Herausforderung reicht (Zeitlimits + 10 s Puffer) | ≈ 60 s | [E] |
| Items können eine abgelaufene Belagerung nicht wieder öffnen | – | [A] |
| Schutzzeit der Region nach Eroberung | 6 h | [A] |
| Der Angreifer sieht die aktuelle Frist inklusive Verlängerungen | – | [E] |
| Vor dem Start sieht der Verteidiger weder Frage noch Kategorie | – | [E] |
| Belagerungen laufen weiter, auch wenn der Angreifer zwischenzeitlich die Nachbarschaft verliert | – | [E] |
| Ist das Angreiferkönigreich bei Auflösung nicht mehr aktiv, wird die Belagerung abgebrochen (`CANCELLED`) | – | [E] |

NPC-Angriffe auf menschliche Eternal-Spieler unterliegen derselben Frist [A, Brief §6.4]. Zustandsmaschine und Nebenläufigkeit: [SIEGE_SYSTEM.md](SIEGE_SYSTEM.md).

## 7. Limits und Schutzzeiten

| Regel | Standard | Kennz. |
|---|---|---|
| Neu eröffnete PvP-Belagerungen pro Angreifer (gleitend 24 h) | 3 | [A] |
| Gleichzeitig offene Belagerungen gegen ein Königreich (alle Angreifer zusammen) | 4 | [A], Skalierung [O-05] |
| Aktive Belagerungen pro Region | 1 | [A] |
| Gleichzeitige Herausforderungen pro Spieler | 1 | [E] |
| Anfängerschutz (keine PvP- und NPC-Angriffe gegen das Reich) | 72 h **oder** bis das Reich 10 Regionen hat **oder** bis es selbst einen Spieler angreift – was zuerst eintritt | [E], [O-07] |
| Wiederaufbauschutz nach Totalverlust | 24 h | [E] |
| Rangabstandsschutz: Reich mit ≥ 4× so vielen Regionen darf ein Reich mit < 15 Regionen nicht angreifen | aktiv | [E], [O-07] |
| PvE-Angriffsversuche pro Spieler (gleitend 24 h) | 50 | [E], [O-08] |
| Urlaubsmodus | nicht im MVP | [O-06] |

## 8. Items (Kurzfassung)

| Item | Seltenheit | Effekt | Drop-Gewicht | Kennz. |
|---|---|---|---|---|
| Kleine Sanduhr | gewöhnlich | +6 h | 15 % | [A] |
| Chronos-Siegel | selten | +12 h | 5 % | [A] |
| Königlicher Zeitkristall | episch | +24 h | 1 % | [A] |
| kein Item | – | – | 79 % | [A] |

- Drops nur nach **qualifizierten** Eroberungen, eine gewichtete Ziehung pro Eroberung, serverseitig [V/A].
- Inventar max. 10 Zeit-Items; Überschuss geht in eine sichtbare Belohnungsablage (7 Tage) statt still zu verfallen [A/E].
- Wirkt auf genau eine offene Belagerung des eigenen Reichs; Obergrenze 48 h ab Eröffnung; würde ein Item die Grenze überschreiten, wird gekappt, und die Oberfläche zeigt vor der Bestätigung die neue Frist [E].
- Keine Weitergabe, kein Handel, keine Käufe [A, Brief §8.6/§14.4].
- Eternal-Items wirken nur in Eternal [V-nah, Brief §3.4].
- Automatische Verwendung optional, standardmäßig aus [A].

Ökonomie, Anti-Farming und Simulation: [ITEM_SYSTEM.md](ITEM_SYSTEM.md).

## 9. NPCs (Kurzfassung)

- NPC-Fraktionen besitzen Königreiche wie Spieler, Antworten entstehen aus nachvollziehbaren Wahrscheinlichkeiten, nie aus Sprachmodellen [V-nah, Brief §6.3].
- PvE-Kämpfe werden sofort ausgewertet; die NPC-Antwort wird **vor** der Spielerantwort festgelegt und gespeichert [E].
- NPC-Leistung ist reproduzierbar über einen geheimen, je Kampf abgeleiteten Zufallsstrom [A/E].

Details: [NPC_SYSTEM.md](NPC_SYSTEM.md).

## 10. Parametertabelle

Alle Werte liegen in der versionierten Regelkonfiguration (`world_rules.config`, validiert per Schema). Laufende Belagerungen speichern ihre Fristwerte bei Eröffnung, damit spätere Regeländerungen nicht rückwirkend greifen [E].

| Schlüssel | Eternal | Weekly | Daily | Kennz. |
|---|---|---|---|---|
| `defense.baseDeadline` | 24 h | 4 h | 15 min | V / A / A |
| `defense.maxDeadline` | 48 h | 4 h (keine Items) | 15 min (keine Items) | A / E / E |
| `defense.startBuffer` | 10 s | 10 s | 10 s | E |
| `defense.settleGrace` (technischer Abwicklungspuffer, verlängert keine Frist) | 5 s | 5 s | 5 s | E |
| `defense.pointsForDefending` (Teilnahme, §5.5) | 5 Verteidigungspunkte | 2 Saisonpunkte | 2 Saisonpunkte | E, [O-18] |
| `defense.pointsBonusCorrect` (eigene Trivia-Antwort richtig) | +5 | +3 | +3 | E, [O-18] |
| `defense.pointsPairLimitPerDay` | 2 | 2 | 2 | E, [O-18] |
| `quiz.triviaTimeLimit` | 20 s | 20 s | 15 s | E |
| `quiz.estimateTimeLimit` | 30 s | 30 s | 25 s | E |
| `quiz.latencyAllowanceCapMs` | 500 | 500 | 500 | E |
| `attack.maxNewPvpSiegesPerAttacker` | 3 / 24 h | 6 / 24 h | 4 / 1 h | A / A / E |
| `attack.maxPvpAttemptsPerAttacker` | 6 / 24 h | 12 / 24 h | 8 / 1 h | E |
| `attack.maxOpenSiegesPerDefender` | 4 | 3 | 2 | A / E / E |
| `attack.maxPveAttemptsPerPlayer` | 50 / 24 h | 60 / 24 h | unbegrenzt | E |
| `protection.afterConquest` | 6 h | 1 h | 5 min | A / E / E |
| `protection.newPlayer` | 72 h / 10 Regionen | 2 h | 15 min | E |
| `protection.respawn` | 24 h | 1 h | 10 min | E |
| `protection.rankGap.factor` / `.maxTargetRegions` | 4 / 15 | 4 / 10 | – | E |
| `capital.lives` (§3.3) | 3 | 3 | 3 | V (PO 2026-11-10) |
| `capital.lifeRegen` (ein Leben zurück ohne neuen Treffer) | 24 h | 24 h | 4 h | V (PO 2026-11-10) |
| `capital.protectionAfterHit` | 1 h | 1 h | 10 min | V (PO 2026-11-10) |
| `capital.hitCooldownPerAttacker` (nur Spielerhauptstädte, [O-20]; optional, ältere Welten bekommen den Standardwert des Modus) | 12 h | 12 h | 2 h | V (PO 2026-11-10) |
| `items.enabled` | ja | nein | nein | E |
| `items.inventoryCap` | 10 | – | – | A |
| `items.dropEligibleConquestsPerDay` | 6 | – | – | E (Begründung: ITEM_SYSTEM §4.4) |
| `items.regionRewardCooldown` | 24 h | – | – | E |
| `items.pairRewardLimitPerDay` | 2 | – | – | E |
| `items.pendingRewardExpiry` | 7 d | – | – | E |
| `items.autoUse.triggerBeforeDeadline` | 6 h | – | – | A |
| `npc.maxActionsPerFactionPerHour` | 2 | 4 | 12 | E |
| `npc.maxOpenSiegesAgainstHumanKingdom` | 1 | 1 | 1 | E, [O-13] |
| `season.pvpAttackCutoffBeforeEnd` | – | = maxDeadline + max. Angriffsdauer (≈ 4 h 1 min) | = maxDeadline + max. Angriffsdauer (≈ 16 min) | E, [O-16] |

## 11. Gefundene Widersprüche und Lücken im Brief

| # | Stelle | Problem | Vorschlag |
|---|---|---|---|
| W-1 | §5.3 Fall D vs. §5.4/§5.5 | „Neue Trivia-Runden bis Entscheidung“ erfordert in asynchronen Belagerungen eine Rückkehr des Angreifers oder Vorab-Antworten auf bis zu 4 Fragen. | Verdecktes Angreifer-Gate (entschieden, [O-01]) |
| W-2 | §5.1 Schritt 7 | „Nach erfolgreichem Abschluss“ ist mehrdeutig (abgeschlossen vs. richtig beantwortet). | Auslegung „richtig beantwortet“ = verdecktes Gate (entschieden, [O-01]) |
| W-3 | §7.3 | Zustandsliste kennt keinen Zustand für „Angreifer scheitert an eigener Frage“ und keinen für „Verteidiger beantwortet gerade“. | Verfeinerte Zustandsmaschine ([SIEGE_SYSTEM.md §3](SIEGE_SYSTEM.md#3-zustandsmaschine)) |
| W-4 | §12.4 vs. §11.5 | Antwort nach Frist ist verspätet, aber eine Herausforderung dauert bis ≈ 50 s. Ein Start kurz vor Fristende wäre eine Falle. | Startsperre, wenn Restzeit < Herausforderungsdauer + Puffer |
| W-5 | §7.4 vs. Prinzip 4 | Feste 4 offene Belagerungen pro Reich deckeln Verluste großer Reiche auf ≈ 4/Tag, unabhängig von der Zahl der Angreifer – große Reiche könnten faktisch unangreifbar werden. | Simulation in Phase 3, ggf. größenabhängige Kapazität [O-05] |
| W-6 | §6.4 vs. §7.4 | NPC-Belagerungen belegen dieselben Slots wie PvP – NPCs könnten menschliche Angreifer aussperren oder ein Reich „schützen“. | Eigenes NPC-Kontingent (max. 1) [O-13] |
| W-7 | §7.1 vs. Prinzip 3 | Ohne Benachrichtigung außerhalb der App erfährt ein Spieler oft erst zu spät vom Angriff; „Benachrichtigungen innerhalb der App“ (Phase 3) reichen nicht. | Web Push ab Phase 3 [O-04] |
| W-8 | §8.6 | „Keine stillschweigende Vernichtung“ bei vollem Inventar, aber kein Mechanismus definiert. | Belohnungsablage mit Ablauf |
| W-9 | §8.3 / E2E-07 | Offen, ob ein Item über der Obergrenze abgelehnt oder gekappt wird. | Kappen mit Vorschau und Bestätigung |
| W-10 | §5.3 Fall C | Bei Schätzfragen mit allgemein bekannter exakter Antwort (Jahreszahlen) entscheidet häufig die Geschwindigkeit; Netzunterschiede wiegen dann schwerer. | Redaktionsregel + Kennzahl „Exakttreffer-Quote“ je Frage ([QUIZ_ENGINE.md §3](QUIZ_ENGINE.md#3-schätzfragen)) |
| W-11 | §10.3 | Zahleneingaben unterscheiden sich je Sprache (`1.234,5` / `1,234.5` / `1 234,5`), Einheiten sind kulturell verschieden. | Sprachabhängiges Parsen mit Bestätigungsanzeige, metrische Einheiten in der Frage |
| W-12 | §14.3 | Spieler- und Königreichsnamen sind öffentliche nutzergenerierte Inhalte. | Generierte Namen im MVP [O-10] |
| W-13 | §3.2 | Daily mit 15-min-Frist verlangt Anwesenheit – widerspricht Prinzip 3 nur scheinbar, da Daily ein freiwilliger Kurzmodus ist. Muss im UI klar kommuniziert werden. | Hinweis beim Beitritt |
| W-14 | §3.3 | „Keine Konflikte mit Fälligkeit nach Saisonende“ – ohne Angriffsschluss wären die letzten Stunden PvP-frei oder Fristen müssten verkürzt werden. | PvP-Angriffsschluss = Saisonende − maximale Frist − Angriffsdauer, erneut geprüft bei Eröffnung [O-16] |
| W-15 | §12.3 | `kingdom_memberships` deutet Mehrspieler-Reiche an, §4.4 sagt „ein Königreich pro Spieler“. | MVP: 1 Spieler = 1 Reich; Tabelle erst mit Allianzen |
| W-16 | §7.4 | Unklar, wann das Angriffsbudget verbraucht wird. Ohne Regel ist „Fragen-Shopping“ (Abbrechen bis leichte Frage) möglich. | Budget wird bei Anzeige der ersten Frage verbraucht |
