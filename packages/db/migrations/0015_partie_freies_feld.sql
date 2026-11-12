-- 0015 Angriff auf ein freies Feld: Die Wissensfrage geht an den Angreifer allein (O-37, ADR-062).
-- Bezug: docs/MATCH_RULES.md §11.7, docs/DATA_MODEL.md §4.10.
--
-- Bisher antworteten auf jede Frage einer Partie zwei oder drei Sitze. Greift ein Reich in der
-- Partie mit Ausbau ein freies Feld an, gibt es keinen Verteidiger: Die Wissensfrage hat dann
-- genau einen Sitz. Schätzfragen (Startfrage, Landnahme, Stechen) brauchen weiter mindestens zwei.
-- Die Prüfung wird nur weiter, vorhandene Zeilen erfüllen sie.

alter table match_questions drop constraint match_questions_seats_check;
alter table match_questions
  add constraint match_questions_seats_check
  check (
    cardinality(seats) between 1 and 3
    and (cardinality(seats) >= 2 or purpose = 'DUEL_TRIVIA')
  );
