# Quiz-Engine

Bezug: Brief §5, §10.3, §11.5, §13.1. Kennzeichnung siehe [README](README.md#kennzeichnung-von-regeln).

## 1. Ziele

1. **Gleiche Aufgabe für beide Seiten:** dieselbe unveränderliche Fragenversion, unabhängig von Sprache und Zeitpunkt [V].
2. **Spoilerfrei asynchron:** Keine Information über Lösung oder Gegnerleistung vor der Auflösung [V].
3. **Server-Autorität:** Richtigkeit, Abstand, Zeit und Ergebnis bestimmt ausschließlich der Server [V].
4. **Reload-sicher:** Ein Reload verliert die Aufgabe nicht und schafft keine neue Chance [V-nah, Brief §11.5].
5. **Reproduzierbar:** Jede Auswertung lässt sich aus gespeicherten Daten nachrechnen (Brief §18).

## 2. Trivia-Fragen (Multiple Choice)

| Feld | Inhalt | Kennz. |
|---|---|---|
| Frage-ID, Versionsnummer | `questions.id`, `question_versions.version`; freigegebene Versionen sind unveränderlich | [V] |
| Kategorie | eine der elf Kategorien aus Brief §5.6 | [A] |
| Schwierigkeit | redaktionell 1–5; später zusätzlich kalibriert aus Spieldaten (§10) | [A/E] |
| Optionen | mindestens 4; jede Option hat einen sprachunabhängigen Schlüssel `option_key`; genau eine ist richtig | [V] |
| Texte | je Sprache Fragetext und Optionstexte (`option_key → Text`) | [V] |
| Quellen | mindestens eine überprüfbare Quelle pro Frage | [V-nah, Brief §5.2] |
| Status | `DRAFT → IN_REVIEW → APPROVED → RETIRED` pro Version; zusätzlich `SUSPENDED` auf Fragenebene | [V-nah, Brief §5.2 „Status der Qualitätsprüfung“, „Versionsnummer“] |
| Herkunft | `EDITORIAL`, `AI_ASSISTED` (nur nach menschlicher Prüfung aktivierbar), `LICENSED` (mit Lizenzvermerk) | [V-nah, Brief §5.6] |
| Tags | z. B. `region:HU` für landesspezifisches Wissen (§4) | [E] |

**Reihenfolge der Optionen:** pro Teilnehmer zufällig gemischt. An den Client gehen nicht die `option_key`s, sondern pro Präsentation neue Zufallstoken (`presentation` in `quiz_answers`, nur serverseitig gespeichert). So lässt sich aus wiederholten Fragen keine Zuordnung „Schlüssel → richtige Antwort“ lernen [E].

## 3. Schätzfragen

| Feld | Inhalt |
|---|---|
| `answer_value` | exakter Zielwert (Dezimal, kein Float) |
| `answer_precision` | erlaubte Nachkommastellen; Eingaben werden serverseitig in Dezimalarithmetik mit `ROUND_HALF_UP` (Hälfte von null weg: 2,5 → 3, −2,5 → −3) darauf gerundet (z. B. Jahr: 0) |
| `answer_unit` + `unit_label` je Sprache | immer metrisch, Einheit steht in der Frage („in Metern“) |
| `input_min`, `input_max` | plausibler Eingabebereich; schützt vor Tippfehlern und Manipulation |
| `estimate_scale_type`, `estimate_scale` | `LINEAR` (z. B. Jahreszahlen, Streuung 50) oder `LOG` (z. B. Einwohner, Entfernungen); nur für das NPC-Schätzmodell |

**Bewertung:** `distance = |round(eingabe, precision) − answer_value|`, berechnet in exakter Dezimalarithmetik [V für Abstand, E für Rundung].

**Redaktionsregeln** [E]:

- Bevorzugt Fragen, deren exakte Antwort selten bekannt ist (Höhen, Entfernungen, Mengen). Bei allgemein bekannten Jahreszahlen entscheidet sonst überwiegend die Geschwindigkeit (Widerspruch W-10), und Netzunterschiede wiegen schwerer.
- Kennzahl **Exakttreffer-Quote** je Frage (`question_stats.exact_hits / shown`); über 25 % → Frage wird zur Überarbeitung markiert.
- Keine Jahreszahlen vor Christus im MVP (Eingabe-Komplexität).
- Keine Werte, die sich schnell ändern (Einwohnerzahlen nur mit Stichtag in der Frage).

**Zahleneingabe** (Widerspruch W-11) [E]: Gespielt wird nur auf Deutsch (ADR-023).

| Sprache | Beispiel | Tausendertrenner | Dezimaltrenner |
|---|---|---|---|
| de | `1.234,5` | `.` oder Leerzeichen | `,` |

Tausendergruppen müssen genau drei Ziffern haben; `1.5` wird abgelehnt statt als 15 gelesen. Kommt eine Sprache hinzu, braucht der Parser nur einen weiteren Tabelleneintrag.

Der Client zeigt beim Tippen die interpretierte Zahl in neutraler Form („= 1 234,5 m“). Gesendet werden **Rohtext und Sprache**; der Server parst mit derselben Funktion aus `packages/protocol` und speichert Rohtext (`raw_input`) und Normalwert. So ist die Auswertung serverseitig und Missverständnisse sind sichtbar, bevor der Spieler bestätigt.

## 4. Mehrsprachigkeit und Sprach-Fairness

> **Derzeit ruhend:** Gespielt wird nur auf Deutsch (PO-Entscheidung 2026-11-09, ADR-023). Die folgenden Regeln gelten erst, wenn eine weitere Sprache hinzukommt; bis dahin braucht jede Frage nur den deutschen Text und eine deutsche Sprachprüfung.

1. Eine Fragenversion kommt nur dann in den **aktiven Pool**, wenn ihre Übersetzungen in **allen** aktiven Sprachen freigegeben sind (`LOCALES` in `packages/protocol`, derzeit nur `de`) [E]. Damit kann jedes Duell in jeder Sprachkombination gestellt werden.
2. Übersetzungen werden von Muttersprachlern geprüft; Übersetzung ≠ Wort-für-Wort: Optionen müssen in jeder Sprache gleich plausibel bleiben (keine Hinweise durch Wortlänge, Artikel, Kasus) [E].
3. **Namen** werden landesüblich dargestellt (Beispiel für eine spätere Erweiterung um Ungarisch: Familienname–Vorname, „Petőfi Sándor“ in hu, „Sándor Petőfi“ in de) [E].
4. **Landesspezifisches Wissen** (Tag `region:XX`): In Duellen zwischen Spielern verschiedener Sprachen werden solche Fragen ausgeschlossen; in gleichsprachigen Duellen und im PvE sind sie erlaubt [E].
5. **Monitoring (Differential Item Functioning):** Für jede Version wird die Quote richtiger Antworten je Sprache verfolgt. Weicht die kalibrierte Schwierigkeit zwischen Sprachen deutlich ab (z. B. > 0,5 Logits bei ≥ 200 Antworten je Sprache), wird die Frage automatisch suspendiert und zur Prüfung vorgelegt [E].
6. Erklärtext nach der Auflösung („Gold hat die Ordnungszahl 79“) in jeder Sprache – fördert den Lerneffekt und reduziert Beschwerden.

## 5. Fragenauswahl

Bei Anlage einer Herausforderung wählt der Server deterministisch (Zufallsstrom `question-pick`, siehe [ARCHITECTURE.md §9](ARCHITECTURE.md#9-zufallsmodell-auditierbar-reproduzierbar)) je eine Trivia- und eine Schätzfrage [E]:

1. **Zielschwierigkeit** aus der Regionsstufe (`tier`): Stufe 0–2 überwiegend leicht, 3–6 gemischt, 7–10 überwiegend schwer.
2. **Kategorie:** gewichteter Zufall, wobei die zuletzt gestellten Kategorien des Angreifers abgewertet werden (Abwechslung).
3. **Ausschluss bekannter Fragen:** Fragen, die einer der menschlichen Beteiligten in den letzten 90 Tagen gesehen hat, werden ausgeschlossen. Bei PvP ist der Verteidiger zum Zeitpunkt des Angriffs bekannt (Besitzer der Region) und wird mit berücksichtigt.
4. **Sprachkombination:** bei verschiedenen Sprachen keine `region:`-Fragen (§4).
5. **Expositionsbegrenzung:** Fragen mit sehr hoher Gesamtnutzung werden abgewertet, damit sich Lösungen nicht in der Community verbreiten.
6. **Rückfall:** Ist der Pool erschöpft, wird das Ausschlussfenster schrittweise verkleinert (90 → 30 → 7 Tage), dann die am längsten nicht gesehene Frage gewählt. Jeder Rückfall wird als Metrik gezählt – ein Frühindikator für zu kleinen Pool.

Die Auswahl wird mit der Herausforderung gespeichert (`quiz_challenge_steps`); sie ändert sich nie mehr, auch wenn eine Frage später suspendiert wird (Brief §5.4).

Stand Phase 1 Paket 3 (ADR-035, `packages/game-core/src/question-pick.ts`): Punkte 1, 2, 3 und 6 sind umgesetzt; Punkt 4 ruht (nur Deutsch, ADR-023), Punkt 5 folgt mit den Fragenstatistiken. Die erste Eroberung eines Reichs (Tutorial) bekommt leichte Fragen, solange es im Bestand welche gibt; die Ausschlussfenster gelten dann innerhalb der leichten Fragen, und nur ohne jede leichte Frage wird eine mittlere oder schwere gestellt. Die Schwierigkeit wird zweistufig gezogen: erst die Klasse nach ihrem Gewicht, dann die Frage innerhalb der Klasse (so entspricht die Mischung der gespeicherten Zielschwierigkeit). Die Exposition (`player_question_exposure`) wird beim Stellen gespeichert, nicht bei der Anlage.

Stand Phase 2 Paket 1 (ADR-039): Punkt 3 gilt im PvP für Angreifer und Verteidiger. Zusätzlich zählt eine Frage, die in einer noch offenen Belagerung eines der beiden steht, als eben gesehen; so sieht niemand eine Frage samt Lösung, die ihm in einem offenen Kampf noch bevorsteht. Die Tutorial-Regel (nur leichte Fragen) gilt nur im PvE. Bei der Auflösung einer eröffneten PvP-Belagerung werden die Fragen, die der Verteidiger nie gestellt bekommen hat, für ihn als gesehen gespeichert, weil die Auflösung sie ihm zeigt.

## 6. Zeitmessung und Latenzausgleich

### 6.1 Messgrößen

| Größe | Quelle | Bedeutung |
|---|---|---|
| `P` = `presented_at` | Server (`game_now()`) | unmittelbar bevor die Antwort mit der Frage gesendet wird |
| `R` = `received_at` | Server (`game_now()`) | beim Eintreffen der Antwort |
| `S = R − P` | Server | enthält Denkzeit **plus** Download, Darstellung, Upload |
| `C` | Client, `performance.now()` | vom ersten sichtbaren Frame der Frage bis zum Klick/Bestätigen; ohne Netzlaufzeit |
| `cap` | Konfiguration, Standard 500 ms | maximal anrechenbarer Netz- und Darstellungsanteil |

### 6.2 Effektive Antwortzeit [E]

```
effective = clamp(C, max(0, S − cap), S)      // in ganzen Millisekunden
```

- Ehrlicher Client mit normaler Verbindung: `S − C` (Netz + Darstellung) ≤ `cap` → `effective = C`, also volle Kompensation.
- Sehr langsame Verbindung: `S − C > cap` → `effective = S − cap`, Teilkompensation.
- Manipulierter Client meldet `C = 0` → `effective = max(0, S − cap)`. Der maximale Vorteil einer Manipulation ist damit auf `cap` begrenzt; zusätzlich erzeugt ein dauerhaft an der Grenze liegendes `S − C` ein Missbrauchssignal ([SECURITY.md §3](SECURITY.md#3-anti-cheat-quiz)).
- Nach einem Reload während eines Schritts zählt `effective = S` ohne Ausgleich, weil der Client-Timer neu begonnen hat.
- Fehlender, negativer oder nicht ganzzahliger Client-Wert: `C` wird verworfen, es gilt `effective = S`. Negative und nicht ganzzahlige Werte (der Client sendet ganze Millisekunden) werden zusätzlich als Signal protokolliert, auch nach einem Reload; ein fehlender Wert nicht. Die Untergrenze `max(0, …)` verhindert negative effektive Zeiten bei sehr schnellen Antworten (`S < cap`).
- Unplausibel kurze Zeiten (z. B. Schätzeingabe < 800 ms) werden gewertet, aber als Signal protokolliert.

`cap` ist ein Kompromiss zwischen Fairness für langsame Netze und Manipulationsspielraum; der Wert wird in der Beta anhand der gemessenen Verteilung von `S − C` justiert.

### 6.3 Unvermeidbare Unterschiede (Pflichtdokumentation nach Brief §5.4)

Auch mit Ausgleich bleiben Unterschiede, die technisch nicht vollständig beseitigt werden können:

1. **Schwankende Netzlaufzeit (Jitter):** Mobilfunk schwankt stark; der Ausgleich nutzt die tatsächlich gemessene Differenz, aber nur bis `cap`.
2. **Gerätegeschwindigkeit:** Langsame Geräte stellen die Frage später dar; das steckt in `S − C` und wird bis `cap` ausgeglichen. Die Bedienzeit (Touch vs. Maus vs. Tastatur) wird nicht ausgeglichen.
3. **Eingabeart der Schätzung:** Längere Zahlen brauchen länger zum Tippen. Das betrifft beide Spieler bei derselben Frage gleich, Tippgeschwindigkeit bleibt aber individuell.
4. **Timer-Auflösung im Browser:** Manche Browser vergröbern `performance.now()` aus Datenschutzgründen; das verschlechtert die Genauigkeit von `C`. Wirkung: höchstens `cap`.
5. **Lesegeschwindigkeit:** Die Schätzfrage-Zeit enthält Lesezeit. Gegenmaßnahme: Fragetexte kurz halten (Redaktionsregel). Mit nur einer Sprache (ADR-023) entfällt der Längenunterschied zwischen Übersetzungen.
6. **Asynchronität:** Verteidiger antworten zu einem selbst gewählten Zeitpunkt (ausgeruht oder müde). Das ist gewollt und gilt für beide Seiten gleich.

Die Geschwindigkeit entscheidet nur bei exakt gleichem Schätzabstand. Wie oft das passiert, wird als Kennzahl verfolgt (`battle_results.reason = 'SPEED'`).

## 7. Herausforderungsprotokoll

### 7.1 Ablauf je Teilnehmer

```mermaid
stateDiagram-v2
  [*] --> Bereit: Herausforderung angelegt
  Bereit --> Frage1: present(step 0) → P speichern
  Frage1 --> Frage2: answer(step 0), im PvE nur bei Gleichstand, im PvP immer
  Frage1 --> Fertig: answer(step 0) im PvE ohne Gleichstand, oder Zeitlimit
  Frage2 --> Fertig: answer(step 1) oder Zeitlimit
  Fertig --> [*]
```

1. `present(step)`: Server prüft, dass der vorige Schritt abgeschlossen ist, speichert `presented_at`, `answer_deadline_at = P + time_limit + cap` und die zufällige Optionsreihenfolge, liefert Fragetext in der Sprache des Teilnehmers, Optionstoken und `remainingMs`. Ein zweiter `present`-Aufruf für denselben Schritt liefert **dieselbe** Frage mit dem ursprünglichen `P` (Reload-Fall) [E].
2. `answer(step)`: Server prüft Token bzw. Zahl, `R < answer_deadline_at` (exklusive Grenze wie bei der Belagerungsfrist, [SIEGE_SYSTEM.md §6.1](SIEGE_SYSTEM.md#61-fristgrenze--eine-regel-für-alle-pfade-e)), Status `PRESENTED`; setzt in einer bedingten Aktualisierung (`… where status = 'PRESENTED'`) Status `ANSWERED`, Richtigkeit, Abstand und Zeiten. Ein zweiter Versuch ändert nichts und gibt den gespeicherten Stand zurück (Idempotenz) [V-nah, Brief §13.1].
3. Verpasste Zeitlimits setzt der Server beim nächsten Zugriff oder durch den Job `challenge.expireStale` auf `TIMED_OUT`, frühestens ab `answer_deadline_at + settleGrace` ([SIEGE_SYSTEM.md §6.1](SIEGE_SYSTEM.md#61-fristgrenze--eine-regel-für-alle-pfade-e)). Eine Herausforderung gibt es je Teilnehmer nur einmal; wer sie verlässt, kann sie nicht neu beginnen.
4. Schritt 1 (Schätzfrage) wird erst nach Abschluss von Schritt 0 ausgeliefert – kein Vorausladen möglich – und im PvE nur, wenn beide Seiten die Trivia-Frage richtig haben (Tiebreaker, [GAME_RULES.md §5.1](GAME_RULES.md#51-ablauf-einer-herausforderung-ve), PO 2026-11-10). Die Antwort auf Schritt 0 enthält dann direkt die Schätzfrage (`P₁` = Verarbeitungszeitpunkt dieser Antwort). So entsteht keine Lücke zwischen den Schritten, die ein Teilnehmer zum Nachschlagen nutzen oder die eine Verteidigungsfrist überschreiten könnte. Im PvE endet die Herausforderung ohne Gleichstand nach Schritt 0; Schritt 1 erscheint in der Ansicht als `SKIPPED`, und die Schätzfrage gilt nicht als gesehen. Im PvP wird Schritt 1 dagegen immer ausgeliefert, weil sein Erscheinen dem Verteidiger sonst die Angreiferleistung verriete; die Schätzung zählt dort nur bei Gleichstand ([O-19](DECISIONS.md#o-19-schätzfrage-als-tiebreaker-im-pvp) Option A, PO 2026-11-10).

Stand Phase 1 Paket 3 (ADR-033): umgesetzt für PvE. `present` ist ohne `Idempotency-Key` wiederholbar; ein Reload protokolliert `STEP_RELOADED`, danach gilt für diesen Schritt nur die Serverzeit (§6.2). `answer` speichert in einer kurzen Transaktion und wertet danach in einer zweiten aus. Läuft Schritt 0 ab, endet die Herausforderung ohne Schätzfrage (der Angreifer liegt damit am Gate falsch). Seit 2026-11-10 entfällt die Schätzfrage im PvE auch, wenn nur eine Seite die Trivia-Frage richtig hat (`estimateDecides` in `game-core`; der Aufräumlauf wertet solche Kämpfe ebenfalls aus). Wer nach dem Angriff 120 s lang keine Frage öffnet, verliert den Angriff ohne Versuch (`NEVER_STARTED`).

Stand Phase 2 Paket 1 (ADR-038): auch für PvP. Eine Herausforderung gehört zur Belagerung, ihre Schritte gibt es je Teilnehmer; welche Rolle der Spieler hat, ergibt sich aus seiner Teilnehmerzeile. Der Angreifer geht wie im PvE vor; läuft seine erste Frage ab, wird die Belagerung nicht eröffnet (`ATTACK_FAILED`), sonst eröffnet seine letzte Antwort (Ablauf in [SIEGE_SYSTEM.md §4](SIEGE_SYSTEM.md#4-ablauf-pvp-belagerung)). Für den Verteidiger stellt `POST /sieges/:id/defense` die Wissensfrage; vorher lehnt `present` mit `STEP_NOT_AVAILABLE` ab, danach liefert es dieselbe Frage als Reload. `STEP_RELOADED` trägt die Rolle, damit ein Reload nur die Antwort dieser Seite betrifft (ältere Einträge ohne Rolle gelten für den Angreifer).

### 7.2 Was der Client wann erfährt [E]

| Zeitpunkt | Angreifer erfährt | Verteidiger erfährt |
|---|---|---|
| Während der Herausforderung | nur die aktuelle Frage, keine Richtigkeit | nur die aktuelle Frage |
| PvP, Angreifer fertig | „Belagerung eröffnet – Frist bis …“; **keine** Rückmeldung zur Richtigkeit, auch nicht zur eigenen Trivia-Antwort (verdecktes Gate, [O-01]) | „Region X wird belagert – Frist bis …“; **keine** Frage, Kategorie oder Angreiferleistung, auch nicht, ob der Angreifer richtig lag |
| PvP, Angreifer bricht vor Abschluss ab | „Angriff abgebrochen“ (zählt als Versuch; umgesetzt: läuft die Wissensfrage ab, endet der Angriff `ATTACK_FAILED`) | nichts (keine Belagerung) |
| Nach Auflösung | vollständige Auflösung beider Seiten: Antworten, Lösung, Abstände, effektive Zeiten, Entscheidungsstufe | dasselbe |
| PvE | sofort nach dem letzten gestellten Schritt die vollständige Auflösung (ohne Gleichstand schon nach Schritt 0) | – |

Bis zur Auflösung enthält keine API-Antwort und kein WebSocket-Ereignis die Lösung, die Gegnerantwort oder den Gegnerabstand.

## 8. Duellauswertung

Reine Funktion in `packages/game-core`:

```ts
type Performance = {
  triviaCorrect: boolean;            // TIMED_OUT ⇒ false
  estimateDistance: Decimal | null;  // null ⇒ +∞
  estimateEffectiveMs: number | null;// null ⇒ +∞
  answeredAll: boolean;              // jede gestellte Frage innerhalb ihres Zeitlimits beantwortet
};

type Outcome =
  | { winner: 'ATTACKER'; reason: 'TIMEOUT' | 'TRIVIA' | 'ESTIMATE' | 'SPEED' }
  | { winner: 'DEFENDER'; reason: 'ATTACKER_GATE' | 'ESTIMATE' | 'SPEED' | 'FULL_TIE' }
  | { winner: 'NONE'; reason: 'ATTACKER_GATE' };   // Angriff gescheitert, keine Verteidigung begonnen

function resolveDuel(att: Performance, def: Performance | 'NO_DEFENSE'): Outcome {
  // verdecktes Gate (O-01): Angreifer falsch ⇒ Angriff scheitert immer; Sieger nur, wenn sich der Verteidiger verteidigt hat
  if (!att.triviaCorrect)
    return def === 'NO_DEFENSE' ? { winner: 'NONE', reason: 'ATTACKER_GATE' } : { winner: 'DEFENDER', reason: 'ATTACKER_GATE' };
  if (def === 'NO_DEFENSE') return { winner: 'ATTACKER', reason: 'TIMEOUT' };
  if (!def.triviaCorrect)   return { winner: 'ATTACKER', reason: 'TRIVIA' };
  // beide richtig → Schätzung
  const d = compareNullableAsInfinity(att.estimateDistance, def.estimateDistance);
  if (d !== 0) return d < 0 ? { winner: 'ATTACKER', reason: 'ESTIMATE' } : { winner: 'DEFENDER', reason: 'ESTIMATE' };
  const t = compareNullableAsInfinity(att.estimateEffectiveMs, def.estimateEffectiveMs);
  if (t !== 0) return t < 0 ? { winner: 'ATTACKER', reason: 'SPEED' } : { winner: 'DEFENDER', reason: 'SPEED' };
  return { winner: 'DEFENDER', reason: 'FULL_TIE' };
}

// Verteidigungspunkte (GAME_RULES §5.5): nur die eigene Leistung des Verteidigers zählt, nicht der Ausgang
function defensePoints(def: Performance | 'NO_DEFENSE', p: { forDefending: number; bonusCorrect: number }): number {
  if (def === 'NO_DEFENSE' || !def.answeredAll) return 0;
  return p.forDefending + (def.triviaCorrect ? p.bonusCorrect : 0);
}
```

Das Gate ist fest (PO-Entscheidung [O-01]); einen Schalter für andere Varianten gibt es nicht. Ein Mehrrundenprotokoll (Brief-Fall D) ist nicht vorgesehen. Die Funktion ist für alle Modi gleich (PvE, PvP, NPC gegen NPC). Abbildung auf den Belagerungszustand:

| Ergebnis | Zustand | Verteidigungspunkte |
|---|---|---|
| `ATTACKER`, `TIMEOUT` | `ATTACKER_WON_BY_TIMEOUT` | – (keine Verteidigung) |
| `ATTACKER`, `TRIVIA` / `ESTIMATE` / `SPEED` | `ATTACKER_WON` | `defensePoints`: Teilnahme; bei `ESTIMATE`/`SPEED` lag auch der Verteidiger richtig, also mit Bonus |
| `DEFENDER`, beliebiger Grund | `DEFENDER_WON` | `defensePoints` |
| `NONE`, `ATTACKER_GATE` | `ATTACK_FAILED` (Frist abgelaufen, Angreifer lag falsch); kein Sieger, zählt weder als gewonnene noch als verlorene Verteidigung | – |

`NO_DEFENSE` heißt: Der Verteidiger hat bis zur Frist keine Verteidigung begonnen. Eine begonnene Verteidigung wird immer mit ihren gespeicherten Antworten ausgewertet; verpasste Schritte zählen als `TIMED_OUT` ([SIEGE_SYSTEM.md §6.1](SIEGE_SYSTEM.md#61-fristgrenze--eine-regel-für-alle-pfade-e)).

`defensePoints` ist rein; Paarlimit und verdächtig verknüpfte Konten prüft die Auflösungstransaktion ([SIEGE_SYSTEM.md §5.3](SIEGE_SYSTEM.md#53-auflösungstransaktion)). Punkte gibt es nur, wenn der Verteidiger ein Spielerreich ist (PvP und NPC-Belagerungen, [GAME_RULES.md §5.5](GAME_RULES.md#55-verteidigungspunkte-v-grundsatz-e-werte-o-18)). Im PvE steht die Verteidigung (NPC oder Garnison) vorab fest; `def` ist dort nie `NO_DEFENSE`, das Ergebnis `NONE` kommt also nur im PvP vor.

### 8.1 Beispiele (Testfälle)

Verteidigungspunkte mit den Eternal-Werten aus [GAME_RULES.md §5.5](GAME_RULES.md#55-verteidigungspunkte-v-grundsatz-e-werte-o-18) (5 Teilnahme, +5 bei richtiger Antwort), Paarlimit nicht erreicht. Wo nichts anderes steht, hat der Verteidiger jede ihm gestellte Frage rechtzeitig beantwortet. Die Schätzfrage zählt dafür nur, wenn sie ihm gestellt wurde (Tiebreaker, GAME_RULES §5.1); im PvP wird sie immer gestellt ([O-19](DECISIONS.md#o-19-schätzfrage-als-tiebreaker-im-pvp)). Fall 11 setzt voraus, dass sie gestellt wurde.

| # | Angreifer | Verteidiger | Ergebnis | Stufe | Verteidigungspunkte |
|---|---|---|---|---|---|
| 1 | richtig, 1390, 6,1 s | falsch | Angreifer | TRIVIA (Fall A, E2E-02) | 5 |
| 2 | richtig, 1390 (Abstand 4) | richtig, 1400 (Abstand 14) | Angreifer | ESTIMATE (Fall B, E2E-03) | 10 |
| 3 | richtig, 1386, 5,2 s | richtig, 1386, 6,8 s | Angreifer | SPEED (Fall C, E2E-04) | 10 |
| 4 | richtig, 1382, 7,0 s | richtig, 1390, 4,0 s | Verteidiger | SPEED (gleicher Abstand 4) | 10 |
| 5 | falsch | richtig, rechtzeitig | Verteidiger | ATTACKER_GATE | 10 |
| 6 | richtig | keine Antwort bis Frist | Angreifer | TIMEOUT (E2E-05) | 0 |
| 7 | richtig, Schätzung verpasst | richtig, 2000 | Verteidiger | ESTIMATE (∞ > jeder Abstand) | 10 |
| 8 | richtig, 1386, 5000 ms | richtig, 1386, 5000 ms | Verteidiger | FULL_TIE | 10 |
| 9 | falsch | keine Antwort bis Frist | niemand: Angriff gescheitert (`ATTACK_FAILED`), Gebiet bleibt | ATTACKER_GATE | 0 |
| 10 | falsch | falsch, rechtzeitig | Verteidiger | ATTACKER_GATE | 5 |
| 11 | falsch | Trivia richtig, gestellte Schätzfrage verpasst | Verteidiger | ATTACKER_GATE | 0 (Quiz nicht vollständig) |
| 12 | richtig | falsch, keine Schätzfrage gestellt | Angreifer | TRIVIA | 5 (alle gestellten Fragen beantwortet) |

## 9. Inhaltspipeline und Umfang

### 9.1 Pipeline [E]

```mermaid
flowchart LR
  A[Entwurf<br/>Redaktion oder KI-gestützt] --> B[Faktenprüfung<br/>≥ 1 Quelle, 2. Person]
  B --> C[Sprachliche Prüfung<br/>Deutsch, ADR-023]
  C --> D[Freigabe<br/>dokumentierte Prüfungen]
  D --> E[CI-Validierung<br/>Schema, ≥4 Optionen, 1 richtig, Längen, Einheiten]
  E --> F[Import als APPROVED-Version]
  F --> G[Spielbetrieb + Statistik]
  G -->|Meldungen, Quoten, Exakttreffer| B
```

- Fragen liegen als YAML-Dateien in Git (eigenes Verzeichnis oder eigenes Redaktions-Repository): Versionierung, Review per Pull Request, Herkunft nachvollziehbar.
- **KI-generierte Entwürfe** sind erlaubt, werden aber mit `origin: AI_ASSISTED` markiert und können ohne dokumentierte menschliche Fakten- und Sprachprüfung nicht `APPROVED` werden (Brief §5.6) – technisch erzwungen durch die Freigabeprüfung im Import.
- Keine Übernahme fremder Fragendatenbanken (Brief §14.1). Fakten selbst sind nicht urheberrechtlich geschützt, Formulierungen schon: Fragen werden eigenständig formuliert. Datensammlungen unter „Share-Alike“-Lizenzen werden nicht eingebunden, da sie die eigene Datenbank lizenzrechtlich binden könnten.

### 9.2 Benötigter Umfang (Abschätzung)

Ein aktiver Spieler bestreitet geschätzt 15–25 Kämpfe pro Tag; jeder Kampf verbraucht eine Trivia- und eine Schätzfrage.

| Meilenstein | Trivia | Schätzung | Sprachen | Begründung |
|---|---|---|---|---|
| Phase 1 (Prototyp) | 100 | 50 | de | Wiederholungen im Einzelspieler-Test akzeptabel; bis zur Entscheidung über O-02 mit den 40 Testfragen |
| MVP / geschlossene Beta | 400 | 250 | de | ≈ 20 Tage ohne Wiederholung für Vielspieler (mit Rückfallregel) |
| Öffentliche Beta | 1 500+ | 800+ | de | 90-Tage-Fenster für Vielspieler |

Die Fragendatenbank ist voraussichtlich der **größte laufende Aufwand** des Projekts (Risiko R-03, Entscheidung [O-02]).

## 10. Kalibrierung und Spielstärke

Eine gemeinsame logistische Skala (1-Parameter-IRT/Elo-artig) für Spieler, NPCs und Fragen [E]:

```
P(richtig) = σ(θ_teilnehmer − b_frage),   σ(x) = 1 / (1 + e^(−x))
```

- `b_frage`: Start aus redaktioneller Schwierigkeit (leicht −1,2 · mittel 0 · schwer +1,2; Stufen 1–2 gelten als leicht, 3 als mittel, 4–5 als schwer [E]), danach laufend aus Spieldaten aktualisiert (`calibrated_difficulty`), bei mehr als einer Sprache getrennt je Sprache für das DIF-Monitoring (§4).
- `θ_spieler`: `player_statistics.skill_rating`, aktualisiert nach jeder Trivia-Antwort (`θ += K · (y − p)`), mit Unsicherheit `skill_rd` für neue Spieler.
- `θ_npc`: Profilwert der NPC-Fraktion ([NPC_SYSTEM.md §3](NPC_SYSTEM.md#3-antwortmodell)).

Mit dieser Skala reproduzieren drei NPC-Werte die Tabelle aus Brief §6.3 auf ±3 Prozentpunkte genau. Die Spielerstärke dient der NPC-Anpassung, der Fragenauswahl und später optional dem Matchmaking in Daily/Weekly – **nie** der Bewertung eines Duells.
