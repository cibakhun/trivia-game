# NPC-System

Bezug: Brief §6, §9.3 (NPC-Imperien), §19 G. Kennzeichnung siehe [README](README.md#kennzeichnung-von-regeln).

## 1. Ziele und Grenzen

- NPCs sind ab Phase 1 Teil des Spiels und halten die Welt auch bei wenigen Spielern lebendig [V].
- NPC-Antworten entstehen aus **nachvollziehbaren Wahrscheinlichkeiten**, nie aus Sprachmodellen [V-nah, Brief §6.3].
- Jede NPC-Entscheidung ist mit dem RNG-Geheimnis exakt **reproduzierbar** und im Protokoll belegt [A].
- NPCs dürfen Spieler nicht dauerhaft bedrängen; ihre Aktivität ist pro Welt, Fraktion und Zielreich begrenzt [A].

## 2. Fraktionen und Archetypen [A/E]

| Archetyp | θ (Skill) | Typisches Gebiet | Expansion | Angriffe auf Spieler | Antwortzeit (Median Schätzfrage) | Max. Regionen |
|---|---|---|---|---|---|---|
| Neutrale Garnison (Startzone) | −2,5 | einzelne Regionen | keine | nie | 14 s | – |
| Neutrale Garnison (sonst) | −1,4 … +0,5 nach `tier` | einzelne Regionen | keine | nie | 12 s | – |
| Leicht | −0,4 | 5–15 | gering | selten | 12 s | 15 |
| Mittel | +0,6 | 15–60 | regelmäßig, Grenzangriffe | gelegentlich | 9 s | 60 |
| Schwer | +1,7 | 60–200 | häufig, strategisch | regelmäßig, bevorzugt gegen größere Reiche | 6 s | 200 |

Zwischenstufen sind stufenlos über θ möglich (Brief §6.1). Jede Fraktion hat ein unveränderliches, versioniertes Profil (`npc_profiles`) plus Persönlichkeitswerte (`aggression`, `expansion`) in `npc_factions`.

## 3. Antwortmodell

### 3.1 Trivia

Gemeinsame logistische Skala mit Spielern und Fragen ([QUIZ_ENGINE.md §10](QUIZ_ENGINE.md#10-kalibrierung-und-spielstärke)):

```
P(NPC richtig) = σ(θ_eff − b_frage)
```

Mit `b` = −1,2 / 0 / +1,2 für leicht / mittel / schwer reproduzieren drei θ-Werte die Platzhaltertabelle aus Brief §6.3:

| NPC | θ | leichte Frage (Brief) | mittlere Frage (Brief) | schwere Frage (Brief) |
|---|---:|---:|---:|---:|
| Leicht | −0,4 | 69 % (65 %) | 40 % (40 %) | 17 % (15 %) |
| Mittel | +0,6 | 86 % (85 %) | 65 % (65 %) | 35 % (35 %) |
| Schwer | +1,7 | 95 % (97 %) | 85 % (85 %) | 62 % (65 %) |

Vorteil gegenüber einer festen Tabelle: Sobald Fragen aus Spieldaten kalibriert sind (`calibrated_difficulty`), passen NPC-Wahrscheinlichkeiten automatisch zur tatsächlichen Schwierigkeit jeder einzelnen Frage.

### 3.2 Schätzung [E]

- `LINEAR`-Fragen (z. B. Jahreszahlen): `schätzung = wahrer Wert + N(0, s(θ) · estimate_scale)`
- `LOG`-Fragen (z. B. Einwohner, Entfernungen): `schätzung = wahrer Wert · exp(N(0, s(θ) · estimate_scale))`
- Streuung als stetige Funktion von `θ_eff`, damit auch angepasste NPCs (§4) reproduzierbar und kalibrierbar sind:

  ```
  s(θ) = clamp(s₀ · exp(−k · (θ − θ_ref)), s_min, s_max)
  Standard: s₀ = 1,0 · θ_ref = −0,4 · k = 0,75 · s_min = 0,1 · s_max = 2,0
  ⇒ leicht (θ −0,4) 1,00 · mittel (+0,6) 0,47 · schwer (+1,7) 0,21 · neutrale Garnison (−1,4) 2,0 (gekappt)
  ```

  Die Parameter sind Teil des versionierten NPC-Profils (`npc_profiles.estimate_spread`); das Ereignisprotokoll speichert den verwendeten Wert `s(θ_eff)`. Ergebnis wird auf `answer_precision` gerundet (`ROUND_HALF_UP`) und in `[input_min, input_max]` begrenzt. Exakttreffer entstehen so natürlich und bei starken NPCs häufiger.

### 3.3 Antwortzeit [E]

Log-normalverteilt mit Median je Archetyp (Tabelle §2), abgeschnitten auf 1 s unter dem Zeitlimit. NPC-Zeiten gelten als „effektive Zeit“ ohne Latenzausgleich. Umsetzung in `game-core` (Schritt 1.0): Streuung `σ(ln t) = 0,35`, Untergrenze 1 s, ganze Millisekunden; neutrale Garnisonen außerhalb der Startzone erhalten θ linear über die Regionsstufe (Stufe 0: −1,4, Stufe 10: +0,5). Alle drei Werte sind Startwerte für die Kalibrierung in Phase 5.

### 3.4 Erzeugung und Versiegelung

- Zufallsstrom `HMAC(secret, "npc-answer:" + challenge_id)` → drei Ziehungen (Trivia, Schätzung, Zeit), in fester Reihenfolge. Die Schätzung und die Zeit verbrauchen je zwei Werte des Stroms (Box-Muller), die Trivia-Ziehung einen; bei falscher Antwort ergibt sich die gewählte falsche Option aus demselben Trivia-Wert, ohne weitere Ziehung ([DECISIONS.md ADR-018](DECISIONS.md#architekturentscheidungen-adr)).
- Die NPC-Antworten werden **beim Anlegen der Herausforderung** als `quiz_answers` mit Status `GENERATED` gespeichert – vor jeder Spielerantwort. Das Ereignisprotokoll enthält `θ_eff`, `b`, die Ziehungen und `rng_version`, sodass Admins jede NPC-Leistung nachrechnen können.

## 4. Dynamische Schwierigkeit [V Grundsatz, E Umsetzung]

Brief §6.2 verlangt, dass NPC-Stärke dem Spielfortschritt folgt, aber nicht nur von der Gebietszahl abhängt. Zwei Mechanismen:

**1. Geografie (primär, sichtbar):** Die Regionsstufe steigt von den Startzonen nach innen. Wer wächst, stößt zwangsläufig auf stärkere Fraktionen. Die Stufe ist auf der Karte sichtbar (Leicht/Mittel/Schwer), Spieler können ihre Ziele also strategisch wählen.

**2. Begrenzte Anpassung an den Spieler (sekundär):**

```
θ_eff = θ_basis + clamp( α · (θ_spieler − θ_ziel(tier)) + β · erfahrung(kämpfe), −0,3, +0,6 )
```

- `θ_spieler` ist die Spielstärke aus **allen** Antworten (nicht aus der Gebietszahl). Ein erfahrener Spieler, der absichtlich klein bleibt, hat trotzdem ein hohes θ – leichte NPCs werden für ihn etwas stärker, und vor allem sinkt seine Belohnungsberechtigung gegen sie ([ITEM_SYSTEM.md §5](ITEM_SYSTEM.md#5-anti-farming)).
- `θ_ziel(tier)` ist die erwartete Spielstärke für eine Zone; `erfahrung` wächst logarithmisch mit der Zahl der Kämpfe; Startwerte `α = 0,3`, `β = 0,1`.
- Die Anpassung ist nach oben und unten gedeckelt, damit ein „leichter“ NPC nie zu einem „schweren“ wird (die sichtbare Einstufung bleibt ehrlich) und gute Spieler nicht übermäßig bestraft werden („Rubber-Banding“ vermeiden).
- Die Formel und ihre Parameter sind Konfiguration und werden in Phase 5 per Simulation kalibriert.

**Orientierungswerte (Gate aktiv, Schätzduell 50:50 angenommen):**

| Spieler beantwortet die Frage mit … | vs. Startgarnison | vs. Leicht | vs. Mittel | vs. Schwer |
|---|---:|---:|---:|---:|
| 55 % | 53 % Sieg | 44 % | 37 % | 32 % |
| 70 % | 67 % | 56 % | 47 % | 40 % |
| 85 % | 82 % | 68 % | 58 % | 49 % |

Für das Tutorial (Brief §15.1, „erste Eroberung in Minuten“) wird die erste Eroberung gegen eine Startgarnison mit leichter Frage gespielt; erwartete Siegquote ≈ 80 %, ein zweiter Versuch ist sofort möglich [E].

## 5. Expansion und Weltsimulation (Phase 5)

### 5.1 Tick-Modell [E]

- Der Worker führt pro Instanz alle N Minuten (Eternal: 15 min) einen **Tick** aus. `tick_id` = Instanz + geplanter Zeitpunkt.
- Jede Fraktion erhält ein Aktionsbudget aus Archetyp und `expansion` (z. B. leicht 0–1, schwer 1–3 Aktionen pro Stunde), gedeckelt durch `npc.maxActionsPerFactionPerHour`.
- Aktionen werden mit Zufallsstrom `npc-tick:{tick_id}:{faction_id}` gewählt und mit deterministischer ID gespeichert (`npc_actions`, `unique(tick_id, faction_id, seq)`). Ein doppelt ausgeführter Tick schreibt nichts doppelt.

### 5.2 Aktionen

| Aktion | Ziel | Auswertung |
|---|---|---|
| `EXPAND_NEUTRAL` | angrenzende neutrale Region, bevorzugt niedrige Stufe | sofort, NPC vs. Garnison mit `resolveDuel` |
| `ATTACK_NPC` | angrenzende Region einer schwächeren oder rivalisierenden Fraktion | sofort |
| `ATTACK_PLAYER` | angrenzende Spielerregion | **Belagerung** mit der Frist aus der Regelkonfiguration der Instanz (`defense.baseDeadline`, Eternal 24 h [A, Brief §6.4]); in Daily/Weekly gilt zusätzlich der PvP-Angriffsschluss ([WORLD_SYSTEM.md §6.2](WORLD_SYSTEM.md#62-saisonende-ohne-offene-konflikte-w-14-vorschlag-zu-o-16)). NPC-Leistung wird bei Eröffnung erzeugt; das verdeckte Gate gilt auch für NPCs: Liegt der NPC falsch, wird die Belagerung trotzdem eröffnet, und der Spieler kann sich verteidigen und Punkte erhalten |
| `IDLE` | – | – |

### 5.3 Schutz der Spieler vor NPC-Druck (Vorschlag zu [O-13]) [E]

- Höchstens **eine** offene NPC-Belagerung pro Spielerreich und höchstens eine neue pro 24 h.
- NPC-Belagerungen zählen zum Limit offener Belagerungen eines Reichs, werden aber nur eröffnet, wenn das Reich höchstens 2 offene Belagerungen hat. So können NPCs menschliche Angreifer nicht aussperren und kein Reich durch Slot-Belegung „schützen“ (W-6).
- Nie gegen Reiche unter Anfänger-, Wiederaufbau- oder Rückkehrerschutz.
- Zielauswahl gewichtet nach Reichsgröße: Große Reiche werden häufiger von schweren NPCs bedrängt – das unterstützt Prinzip 4 („mächtig, aber nicht unangreifbar“) und entspricht der Idee der NPC-Imperien (Brief §9.3).

### 5.4 Gleichgewicht

- Regionsobergrenze je Archetyp (Tabelle §2) verhindert, dass NPCs die Karte übernehmen.
- NPC-Hauptstädte haben wie Spielerhauptstädte drei Leben (GAME_RULES §3 Punkt 3, ADR-037): Erst der dritte Sieg ohne Erholungspause nimmt die Hauptstadt ein, und mit ihr geht das ganze NPC-Reich an den Angreifer. Kleine Randregionen einer Fraktion lassen sich einzeln erobern, das Reich selbst fällt nur über die Hauptstadt.
- Eine Fraktion ohne Regionen ist `DORMANT` und kann nach einer Abklingzeit in einer freien Gegend neu entstehen (Brief §6.4 „nach Niederlagen wieder expandieren“).
- Weltweiter Zielkorridor: Anteil neutraler Regionen im äußersten Ring ≥ 30 % (Raum für Neulinge). Wird er unterschritten, pausiert NPC-Expansion dort.
- Admin-Notschalter je Instanz: NPC-Aktivität drosseln oder anhalten (Brief §13.5).

## 6. Messgrößen

- Aktionen pro Fraktion und Stunde, Besitzwechsel durch NPCs, NPC-Belagerungen gegen Spieler und deren Ausgang (Brief §18).
- Siegquote von Spielern gegen jeden Archetyp, getrennt nach Spielstärke-Bändern – Grundlage für das Balancing in Phase 5.
- Abweichung beobachteter NPC-Trefferquoten von `σ(θ_eff − b)` (Plausibilitätsprüfung des Zufallsstroms).
