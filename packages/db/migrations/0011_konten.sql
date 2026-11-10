-- 0011 Konten (Phase 2 Paket 2: O-03, O-10; ADR-043 bis ADR-045).
-- Bezug: docs/DATA_MODEL.md §4.1, docs/SECURITY.md §2 und §5.2, docs/API.md §2.1.
--
-- 1. Gesicherte Konten melden sich mit Benutzername und Passwort an (O-03). Der Benutzername ist
--    nur Anmeldename und wird nie öffentlich gezeigt; öffentlich ist der Spielername. Groß- und
--    Kleinschreibung zählen nicht (citext). Das Passwort liegt nur als Argon2id-Hash vor.
--    Gäste haben keine Anmeldedaten, gesicherte Konten immer beide; Platzhalter gelöschter Konten
--    keine. Bestehende Zeilen sind Gäste oder hätten ohne Anmeldedaten nie benutzt werden können.
-- 2. Spielernamen werden aus Bausteinen gewählt (O-10). Statt eines Zufallsstartwerts speichert
--    das Profil die gewählten Bausteine. Die Tabelle ist bis hierher leer (nichts legte Profile an),
--    deshalb geht die neue Pflichtspalte ohne Standardwert.
-- 3. Die Löschung inaktiver Gäste (90 Tage, O-03) schwärzt persönliche Ereignisse der Outbox, die
--    Rohtexte der Antworten und die Konto-ID in der Gründungsspur der Reiche und stellt
--    Regelversionen auf das Platzhalterkonto um (SECURITY §5.2). Das sind die einzigen erlaubten
--    Änderungen an diesen Tabellen; die Trigger lassen genau sie zu.

alter table users
  add column username citext null,
  drop constraint users_guest_without_credentials,
  drop constraint users_deleted_without_personal_data,
  add constraint users_username_format
    check (username is null or username ~ '^[A-Za-z0-9ÄÖÜäöüß_.-]{3,24}$'),
  add constraint users_password_argon2id
    check (password_hash is null or password_hash like '$argon2id$%'),
  add constraint users_guest_without_credentials
    check (not is_guest or (username is null and email is null and password_hash is null)),
  add constraint users_registered_with_credentials
    check (is_guest or deleted_at is not null or (username is not null and password_hash is not null)),
  add constraint users_deleted_without_personal_data
    check (deleted_at is null or (username is null and email is null and email_verified_at is null
           and password_hash is null and guest_bootstrap_hash is null));

create unique index users_username_unique on users (username) where username is not null;
-- Aufräumlauf: Gäste nach Inaktivität (ab last_seen_at, bei nie benutzten Konten ab created_at)
create index users_guest_inactive on users ((coalesce(last_seen_at, created_at)))
  where is_guest and deleted_at is null;
create index sessions_expires on sessions (expires_at);

alter table player_profiles
  drop column name_seed,
  add column name_parts jsonb not null check (jsonb_typeof(name_parts) = 'object'),
  add column updated_at timestamptz not null default game_now();

-- Outbox: nur anhängen; geändert werden darf nur die Schwärzung eines persönlichen Ereignisses
-- (Typ REDACTED, leerer Inhalt, ohne Konto, alles andere gleich).
create function world_event_redact_only() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  begin
    if old.user_id is not null and old.type <> 'REDACTED'
       and new.type = 'REDACTED' and new.user_id is null and new.payload = '{}'::jsonb
       and new.id = old.id and new.instance_id = old.instance_id and new.seq = old.seq
       and new.chunk_x is not distinct from old.chunk_x
       and new.chunk_y is not distinct from old.chunk_y
       and new.created_at = old.created_at then
      return new;
    end if;
    raise exception 'world_events: nur anhängen; erlaubt ist nur die Schwärzung persönlicher Ereignisse'
      using errcode = 'restrict_violation';
  end
  $$;

drop trigger world_events_append_only on world_events;
create trigger world_events_append_only
  before update on world_events
  for each row execute function world_event_redact_only();

-- Reichsprotokoll: nur anhängen. Die Prüfspur der Gründung (join.ts) enthält in
-- spawn.rngEntityId die Konto-ID (Instanz.Konto.Generation); die Kontolöschung entfernt genau
-- dieses Feld, alles andere bleibt gleich (SECURITY §5.2).
create function kingdom_history_redact_only() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  begin
    if old.payload #> '{spawn,rngEntityId}' is not null
       and new.payload = old.payload #- '{spawn,rngEntityId}'
       and new.id = old.id and new.kingdom_id = old.kingdom_id and new.kind = old.kind
       and new.at = old.at then
      return new;
    end if;
    raise exception 'kingdom_history: nur anhängen; erlaubt ist nur das Entfernen der Konto-ID'
      using errcode = 'restrict_violation';
  end
  $$;

drop trigger kingdom_history_append_only on kingdom_history;
create trigger kingdom_history_append_only
  before update on kingdom_history
  for each row execute function kingdom_history_redact_only();

-- Regelversionen: unveränderlich wie in 0003. Die Kontolöschung stellt nur created_by auf das
-- Platzhalterkonto um (ein Konto mit deleted_at), alles andere bleibt gleich.
create function world_rules_redact_only() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  declare
    unchanged public.world_rules;
  begin
    if tg_op = 'UPDATE' and old.created_by is not null and new.created_by <> old.created_by then
      unchanged := new;
      unchanged.created_by := old.created_by;
      if unchanged is not distinct from old and exists (
        select 1 from public.users u where u.id = new.created_by and u.deleted_at is not null
      ) then
        return new;
      end if;
    end if;
    raise exception 'world_rules: Zeilen sind unveränderlich (%); erlaubt ist nur das Umstellen auf ein gelöschtes Konto', tg_op
      using errcode = 'restrict_violation';
  end
  $$;

drop trigger world_rules_immutable on world_rules;
create trigger world_rules_immutable
  before update or delete on world_rules
  for each row execute function world_rules_redact_only();

-- Antworten: wie 0006, dazu die Schwärzung des Rohtexts einer abgegebenen Antwort (raw_input
-- wird leer, alles andere bleibt gleich).
create or replace function quiz_answer_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  declare
    is_npc boolean;
    unchanged public.quiz_answers;
  begin
    if tg_op = 'INSERT' then
      select p.npc_profile_id is not null into is_npc
      from public.siege_participants p where p.id = new.participant_id;
      if is_npc is not null and is_npc <> (new.status = 'GENERATED') then
        raise exception 'quiz_answers: GENERATED genau für NPC-Teilnehmer (Status %)', new.status
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      raise exception 'quiz_answers: Antworten werden nicht gelöscht' using errcode = 'restrict_violation';
    end if;
    if old.status <> 'PRESENTED' then
      unchanged := new;
      unchanged.raw_input := old.raw_input;
      if old.raw_input is not null and new.raw_input is null and unchanged is not distinct from old then
        return new;
      end if;
      raise exception 'quiz_answers: abgegebene Antworten sind unveränderlich'
        using errcode = 'restrict_violation';
    end if;
    if new.status not in ('ANSWERED', 'TIMED_OUT')
       or new.id <> old.id or new.challenge_id <> old.challenge_id or new.siege_id <> old.siege_id
       or new.participant_id <> old.participant_id or new.step_index <> old.step_index
       or new.locale is distinct from old.locale or new.presentation <> old.presentation
       or new.presented_at <> old.presented_at or new.answer_deadline_at <> old.answer_deadline_at then
      raise exception 'quiz_answers: nur Abgabe oder Zeitablauf einer präsentierten Frage'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end
  $$;
