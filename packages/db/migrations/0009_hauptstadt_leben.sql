-- 0009 Hauptstadt-Leben und Reichsübernahme (PO-Entscheidung 2026-11-10, ADR-037). Bezug:
-- docs/GAME_RULES.md §3, docs/SIEGE_SYSTEM.md §8, docs/DATA_MODEL.md §4.
--
-- Eine Hauptstadt hat mehrere Leben (`capital.lives` der Regelkonfiguration). Jeder Sieg eines
-- Angreifers kostet ein Leben; der Sieg, der das letzte nimmt, übernimmt das ganze Reich. Leben
-- kehren zurück, solange kein neuer Treffer kommt; gespeichert werden deshalb nur die nicht
-- erholten Treffer zum Zeitpunkt des letzten Treffers, die aktuellen Leben rechnet game-core
-- (`capitalLives`) aus Regeln und Uhrzeit. Bestehende Reiche starten unbeschädigt.
alter table kingdoms
  add column capital_hits   smallint not null default 0 check (capital_hits >= 0),
  add column capital_hit_at timestamptz null,
  add constraint kingdoms_capital_hit_at check (capital_hits = 0 or capital_hit_at is not null);

-- Schutz der Hauptstadt nach einem Treffer
alter table region_state drop constraint region_state_protection_reason_check;
alter table region_state add constraint region_state_protection_reason_check
  check (protection_reason in ('CONQUEST', 'ADMIN', 'CAPITAL_HIT'));

-- Regionen, die mit dem Reich übernommen werden (die Hauptstadt selbst bleibt CONQUEST_*)
alter table region_history drop constraint region_history_cause_check;
alter table region_history add constraint region_history_cause_check
  check (cause in
    ('CONQUEST_PVE', 'CONQUEST_PVP', 'TIMEOUT', 'NPC', 'START_CLAIM', 'DECAY', 'ADMIN', 'TAKEOVER'));

-- CAPITAL_HIT beim getroffenen Reich, TAKEOVER beim übernehmenden. CAPITAL_CHANGED bleibt für
-- ältere Einträge (Hauptstadtwechsel vor dieser Migration) erlaubt.
alter table kingdom_history drop constraint kingdom_history_kind_check;
alter table kingdom_history add constraint kingdom_history_kind_check
  check (kind in
    ('FOUNDED', 'CAPITAL_CHANGED', 'RANK_CHANGED', 'FALLEN', 'RANK_SNAPSHOT', 'CAPITAL_HIT',
     'TAKEOVER'));

-- Wirkung eines Siegs auf eine Hauptstadt: verbleibende Leben (0 = Reich übernommen) und Zahl der
-- übernommenen Regionen. Beide null, wenn das Ziel keine Hauptstadt war (und bei Ergebnissen vor
-- dieser Migration).
alter table battle_results
  add column capital_lives_left smallint null check (capital_lives_left >= 0),
  add column regions_taken      int null check (regions_taken >= 1),
  add constraint battle_results_capital_effect check (
    regions_taken is null or capital_lives_left = 0
  );
