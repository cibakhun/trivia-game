-- 0013 Partie: Phase ANNOUNCE (Ansage, ADR-053).
-- Bezug: docs/MATCH_RULES.md §5, docs/DATA_MODEL.md §4.10.
--
-- Eine laufende Partie kann jetzt auch auf das Ende einer Ansage warten: Die Karte zeigt, was ein
-- Bot gewählt hat oder wer wen wo angreift, danach geht es weiter. Eine Ansage kann vor der ersten
-- Frage stehen (Hauptstadtwahl), deshalb gilt für sie wie für PICK keine Fragenummer.
--
-- Beide Prüfungen werden nur weiter: Vorhandene Zeilen erfüllen sie unverändert.

alter table matches drop constraint matches_phase_check;
alter table matches
  add constraint matches_phase_check check (phase in ('PICK', 'QUESTION', 'REVEAL', 'ANNOUNCE'));

alter table matches drop constraint matches_lifecycle;
alter table matches
  add constraint matches_lifecycle check (
    (status = 'LOBBY' and rules is null and state is null and phase is null
      and phase_deadline_at is null and question_seq is null and started_at is null
      and finished_at is null)
    or (status = 'RUNNING' and rules is not null and state is not null and phase is not null
      and phase_deadline_at is not null and started_at is not null and finished_at is null
      and (phase in ('PICK', 'ANNOUNCE') or question_seq is not null))
    or (status = 'FINISHED' and rules is not null and state is not null and phase is null
      and phase_deadline_at is null and started_at is not null and finished_at >= started_at)
    or (status = 'ABANDONED' and phase is null and phase_deadline_at is null
      and finished_at is not null)
  );
