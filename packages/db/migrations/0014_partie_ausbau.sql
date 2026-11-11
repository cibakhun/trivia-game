-- 0014 Partie mit Ausbau: Spielart, Rüstzeit, Startfrage, Lieblingskategorien (ADR-057, ADR-058).
-- Bezug: docs/MATCH_RULES.md §11, docs/DATA_MODEL.md §4.10, docs/API.md §2.6.
--
-- Eine Partie spielt entweder wie bisher (`CLASSIC`) oder mit Burgen, Dörfern und Armeen (`REALM`).
-- Vorhandene Partien sind `CLASSIC` und laufen unverändert zu Ende; alle Prüfungen werden nur
-- weiter, vorhandene Zeilen erfüllen sie.
--
-- Mit Ausbau wartet eine laufende Partie zusätzlich auf die Befehle der Rüstzeit (`PREPARE`). Vor
-- der ersten Rüstzeit liegen immer die Startfrage und die Landnahme, deshalb gilt für sie wie für
-- QUESTION und REVEAL die Bedingung aus `matches_lifecycle`: `question_seq` ist gesetzt.

alter table matches
  add column mode text not null default 'CLASSIC' check (mode in ('CLASSIC', 'REALM'));

alter table matches drop constraint matches_phase_check;
alter table matches
  add constraint matches_phase_check
  check (phase in ('PICK', 'QUESTION', 'REVEAL', 'ANNOUNCE', 'PREPARE'));

-- Startfrage der Partie mit Ausbau: eine Schätzfrage an alle, ihre Rangfolge ist die Reihenfolge.
alter table match_questions drop constraint match_questions_purpose_check;
alter table match_questions
  add constraint match_questions_purpose_check
  check (purpose in ('LAND', 'DUEL_TRIVIA', 'DUEL_ESTIMATE', 'START'));

-- Lieblingskategorien eines Platzes: in der Aufstellung gewählt oder beim Start zugeteilt (Bots,
-- und wer nicht gewählt hat). Ohne Ausbau und vor der Wahl null. Dass sie verschieden sind und auf
-- dem Glücksrad stehen, prüft die Anwendung; hier nur die Kategorienliste aus 0005.
alter table match_players
  add column favorites text[] null
  constraint match_players_favorites_check check (
    favorites is null
    or (cardinality(favorites) between 1 and 11
      and favorites <@ array[
        'HISTORY', 'GEOGRAPHY', 'SCIENCE', 'TECHNOLOGY', 'MATHEMATICS', 'LITERATURE',
        'ARTS_CULTURE', 'SPORTS', 'POLITICS_SOCIETY', 'NATURE_ANIMALS', 'GENERAL']::text[])
  );

-- Das Konto merkt sich die zuletzt gewählten Lieblingskategorien für die nächste Aufstellung.
-- Kontolöschung: `player_settings` wird mit dem Konto gelöscht (DATA_MODEL §1).
alter table player_settings
  add column match_favorites text[] null
  constraint player_settings_match_favorites_check check (
    match_favorites is null
    or (cardinality(match_favorites) between 1 and 11
      and match_favorites <@ array[
        'HISTORY', 'GEOGRAPHY', 'SCIENCE', 'TECHNOLOGY', 'MATHEMATICS', 'LITERATURE',
        'ARTS_CULTURE', 'SPORTS', 'POLITICS_SOCIETY', 'NATURE_ANIMALS', 'GENERAL']::text[])
  );
