-- 0001 Grundlagen: Erweiterungen, Spielzeit (game_clock, game_now), gemeinsame Triggerfunktionen.
-- Bezug: docs/ARCHITECTURE.md §8, docs/DATA_MODEL.md §1 und §4.9.

create extension if not exists citext;

-- ---------------------------------------------------------------------------------------------
-- Spielzeit
-- ---------------------------------------------------------------------------------------------
-- Alle Fristvergleiche nutzen game_now(). In Produktion ist der Versatz 0 und die Tabelle
-- schreibgeschützt. Test und Staging erlauben einen Versatz nur, wenn die Datenbank selbst die
-- Einstellung rdw.allow_game_clock_offset = on trägt (ALTER DATABASE … SET, nur Superuser).
-- Ein SET in der eigenen Sitzung genügt bewusst nicht: Der Trigger liest den Katalog.

create table game_clock (
  id       int primary key check (id = 1),
  "offset" interval not null default interval '0'
);

insert into game_clock (id, "offset") values (1, interval '0');

create function game_clock_offset_allowed() returns boolean
  language sql stable
  as $$
    select exists (
      select 1
      from pg_db_role_setting s
      join pg_database d on d.oid = s.setdatabase
      where d.datname = current_database()
        and s.setrole = 0
        and 'rdw.allow_game_clock_offset=on' = any (s.setconfig)
    )
  $$;

create function game_clock_guard() returns trigger
  language plpgsql
  as $$
  begin
    if tg_op <> 'UPDATE' then
      raise exception 'game_clock: nur die eine Zeile darf geändert werden (%)', tg_op
        using errcode = 'restrict_violation';
    end if;
    if new.id <> old.id then
      raise exception 'game_clock: id ist fest' using errcode = 'restrict_violation';
    end if;
    if new."offset" <> interval '0' and not game_clock_offset_allowed() then
      raise exception 'game_clock ist schreibgeschützt: Zeitversatz nur in Test und Staging'
        using errcode = 'insufficient_privilege',
              hint = 'ALTER DATABASE … SET rdw.allow_game_clock_offset = on (nur Nicht-Produktion)';
    end if;
    return new;
  end
  $$;

create trigger game_clock_guard
  before insert or update or delete on game_clock
  for each row execute function game_clock_guard();

create function game_clock_no_truncate() returns trigger
  language plpgsql
  as $$
  begin
    raise exception 'game_clock darf nicht geleert werden' using errcode = 'restrict_violation';
  end
  $$;

create trigger game_clock_no_truncate
  before truncate on game_clock
  for each statement execute function game_clock_no_truncate();

-- clock_timestamp() statt now(): Zeit der Anweisung, nicht des Transaktionsbeginns.
create function game_now() returns timestamptz
  language sql volatile
  as $$
    select clock_timestamp() + coalesce((select "offset" from game_clock where id = 1), interval '0')
  $$;

-- ---------------------------------------------------------------------------------------------
-- Gemeinsame Triggerfunktionen
-- ---------------------------------------------------------------------------------------------

-- Für unveränderliche Zeilen (z. B. world_rules, npc_profiles). Ausnahmen für die Schwärzung bei
-- Kontolöschung (DATA_MODEL §1) kommen mit der Migration des Löschjobs und seiner Datenbankrolle.
create function forbid_row_change() returns trigger
  language plpgsql
  as $$
  begin
    raise exception '%: Zeilen sind unveränderlich (%)', tg_table_name, tg_op
      using errcode = 'restrict_violation';
  end
  $$;
