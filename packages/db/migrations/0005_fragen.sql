-- 0005 Fragenbestand: Fragen, Versionen, Optionen, Übersetzungen, Prüfungen, Exposition.
-- Bezug: docs/DATA_MODEL.md §4.6, docs/QUIZ_ENGINE.md §2–5 und §9, Brief §5.6.
-- Fragen kommen aus den YAML-Dateien (ADR-021) über den Import in tools/content; `key` ist der
-- stabile Dateischlüssel. Testfragen (content/fixtures) tragen is_fixture und werden nie freigegeben.

-- Tags wie im Fragenformat (tools/content/src/schema.ts): `fixture` oder `region:HU`; kein NULL,
-- kein leerer Text. Als Funktion, weil ein CHECK keine Unterabfrage über die Elemente erlaubt.
create function question_tags_valid(tags text[]) returns boolean
  language sql immutable
  set search_path = pg_catalog, pg_temp
  as $$
    select coalesce(bool_and(t is not null and t ~ '^[a-z]+(:[A-Za-z0-9_-]+)?$'), true)
    from unnest(tags) as t
  $$;

create table questions (
  id                 uuid primary key,
  key                text not null unique check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(key) <= 80),
  kind               text not null check (kind in ('TRIVIA', 'ESTIMATE')),
  category           text not null check (category in (
                       'HISTORY', 'GEOGRAPHY', 'SCIENCE', 'TECHNOLOGY', 'MATHEMATICS', 'LITERATURE',
                       'ARTS_CULTURE', 'SPORTS', 'POLITICS_SOCIETY', 'NATURE_ANIMALS', 'GENERAL')),
  status             text not null default 'DRAFT'
                     check (status in ('DRAFT', 'IN_REVIEW', 'ACTIVE', 'SUSPENDED', 'RETIRED')),
  current_version_id uuid null,      -- Fremdschlüssel unten, nach question_versions
  tags               text[] not null default '{}',
  origin             text not null check (origin in ('EDITORIAL', 'AI_ASSISTED', 'LICENSED')),
  license_note       text null,
  is_fixture         boolean not null default false,  -- fest ab dem Anlegen (Trigger unten)
  created_by         uuid null references users (id) on delete restrict,
  created_at         timestamptz not null default game_now(),
  -- Testfragen sind nie im aktiven Pool (ADR-021); ACTIVE verlangt eine aktuelle Version.
  constraint questions_fixture_never_active check (not is_fixture or status <> 'ACTIVE'),
  constraint questions_active_has_version check (status <> 'ACTIVE' or current_version_id is not null),
  -- Lizenzhinweis genau bei lizenzierten Fragen (wie tools/content/src/validate.ts)
  constraint questions_license_note check ((origin = 'LICENSED') = (license_note is not null)),
  constraint questions_tags_valid check (question_tags_valid(tags)),
  unique (id, kind)                -- Ziel des Fremdschlüssels aus question_versions
);
create index questions_pool on questions (kind, category, status);
create index questions_created_by on questions (created_by);

create table question_versions (
  id                    uuid primary key,
  question_id           uuid not null,
  version               int not null check (version >= 1),
  kind                  text not null,  -- Kopie aus questions für die Prüfungen unten
  difficulty            smallint not null check (difficulty between 1 and 5),
  calibrated_difficulty numeric null
                        check (calibrated_difficulty > '-Infinity' and calibrated_difficulty < 'Infinity'),
  answer_value          numeric null check (answer_value > '-Infinity' and answer_value < 'Infinity'),
  answer_precision      smallint null check (answer_precision between 0 and 6),
  answer_unit           text null,
  input_min             numeric null check (input_min > '-Infinity' and input_min < 'Infinity'),
  input_max             numeric null check (input_max > '-Infinity' and input_max < 'Infinity'),
  estimate_scale_type   text null check (estimate_scale_type in ('LINEAR', 'LOG')),
  estimate_scale        numeric null check (estimate_scale > 0 and estimate_scale < 'Infinity'),
  -- mindestens eine überprüfbare Quelle (Brief §5.2); CASE, weil AND keine Reihenfolge garantiert
  sources               jsonb not null check (
                          case when jsonb_typeof(sources) = 'array' then jsonb_array_length(sources) >= 1
                          else false end),
  status                text not null default 'DRAFT'
                        check (status in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED')),
  approved_at           timestamptz null,
  content_hash          text not null check (content_hash ~ '^[0-9a-f]{64}$'),  -- SHA-256 der Datei
  created_at            timestamptz not null default game_now(),
  unique (question_id, version),
  unique (question_id, content_hash),
  unique (id, question_id),        -- Ziel des Fremdschlüssels questions.current_version_id
  unique (id, kind),               -- Ziel des Fremdschlüssels aus quiz_challenge_steps
  constraint question_versions_question_fk
    foreign key (question_id, kind) references questions (id, kind),
  -- Trivia ohne, Schätzfragen mit vollständigem Schätzteil; der wahre Wert liegt im Eingabebereich.
  constraint question_versions_kind_fields check (
    (kind = 'TRIVIA' and answer_value is null and answer_precision is null and answer_unit is null
      and input_min is null and input_max is null and estimate_scale_type is null
      and estimate_scale is null)
    or (kind = 'ESTIMATE' and answer_value is not null and answer_precision is not null
      and answer_unit is not null and input_min is not null and input_max is not null
      and estimate_scale_type is not null and estimate_scale is not null
      and input_min <= answer_value and answer_value <= input_max
      and (estimate_scale_type <> 'LOG' or answer_value > 0))  -- LOG-Skala: positiver Zielwert
  ),
  -- approved_at setzt der Freigabe-Trigger; zurückgezogene Versionen behalten ihn (oder nie freigegeben)
  constraint question_versions_approved_at check (
    (status = 'APPROVED' and approved_at is not null)
    or (status in ('DRAFT', 'IN_REVIEW') and approved_at is null)
    or status = 'RETIRED'
  ),
  -- höchstens eine freigegebene Version je Frage; geprüft beim Commit, damit der Import die neue
  -- Version freigeben und danach die alte zurückziehen kann
  constraint question_versions_one_approved
    exclude using btree (question_id with =) where (status = 'APPROVED')
    deferrable initially deferred
);
create index question_versions_question on question_versions (question_id, kind);

alter table questions
  add constraint questions_current_version_fk
  foreign key (current_version_id, id) references question_versions (id, question_id);
create index questions_current_version on questions (current_version_id, id);

create table question_options (
  version_id uuid not null references question_versions (id),
  option_key text not null check (option_key ~ '^[a-z][a-z0-9_]{0,15}$'),
  is_correct boolean not null,
  primary key (version_id, option_key)
);
-- höchstens eine richtige Option; „genau eine“ und „mindestens vier“ prüft die Freigabe
create unique index question_options_one_correct on question_options (version_id) where is_correct;

create table question_translations (
  version_id   uuid not null references question_versions (id),
  locale       text not null check (locale in ('de')),   -- nur Deutsch (ADR-023)
  prompt       text not null check (length(prompt) between 10 and 300),
  option_texts jsonb null check (option_texts is null or jsonb_typeof(option_texts) = 'object'),
  unit_label   text null,
  explanation  text null,
  status       text not null default 'DRAFT' check (status in ('DRAFT', 'REVIEWED', 'APPROVED')),
  primary key (version_id, locale)
);

-- Dokumentierte menschliche Prüfungen (Brief §5.6), aus der Fragendatei übernommen. Die Prüfer
-- sind Redaktionsmitglieder mit Namen in Git, nicht zwingend Spielkonten.
create table question_reviews (
  id            uuid primary key,
  version_id    uuid not null references question_versions (id),
  kind          text not null check (kind in ('FACT', 'LANGUAGE')),
  locale        text null check (locale in ('de')),
  reviewer_name text not null check (length(reviewer_name) between 1 and 120),
  reviewed_on   date not null,
  notes         text null,
  check ((kind = 'LANGUAGE') = (locale is not null))
);
create index question_reviews_version on question_reviews (version_id);

-- Welche Fragen ein Spieler gesehen hat (Ausschluss bei der Auswahl, QUIZ_ENGINE §5).
create table player_question_exposure (
  user_id      uuid not null references users (id) on delete restrict,
  question_id  uuid not null references questions (id),
  last_seen_at timestamptz not null,
  times        int not null default 1 check (times >= 1),
  primary key (user_id, question_id)
);
create index player_question_exposure_question on player_question_exposure (question_id);

-- ---------------------------------------------------------------------------------------------
-- Freigabe und Unveränderlichkeit (Brief §5.6, DATA_MODEL I12)
-- ---------------------------------------------------------------------------------------------
-- Eine Version wird erst freigegeben, wenn alle Teile da sind: Die Freigaberegeln prüft der
-- Trigger beim Übergang nach APPROVED. Ab APPROVED ist die Version samt Optionen und
-- Übersetzungen unveränderlich; erlaubt bleibt nur der Übergang nach RETIRED.

create function question_version_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  declare
    q public.questions%rowtype;
    locale_missing text;
    option_count int;
    correct_count int;
  begin
    if tg_op = 'DELETE' then
      if old.status in ('APPROVED', 'RETIRED') then
        raise exception 'question_versions: freigegebene Versionen sind unveränderlich (DELETE)'
          using errcode = 'restrict_violation';
      end if;
      return old;
    end if;

    if tg_op = 'UPDATE' and old.status in ('APPROVED', 'RETIRED') then
      -- einziger erlaubter Übergang: APPROVED → RETIRED, sonst unverändert
      if not (old.status = 'APPROVED' and new.status = 'RETIRED'
              and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status')) then
        raise exception 'question_versions: freigegebene Versionen sind unveränderlich'
          using errcode = 'restrict_violation';
      end if;
      -- eine aktive Frage verliert ihre aktuelle Version nicht: erst umstellen oder aussetzen
      if exists (select 1 from public.questions qq
                 where qq.current_version_id = old.id and qq.status = 'ACTIVE') then
        raise exception 'question_versions: aktuelle Version einer aktiven Frage (erst Frage umstellen)'
          using errcode = 'restrict_violation';
      end if;
      return new;
    end if;

    if new.status = 'APPROVED' then
      select * into q from public.questions where id = new.question_id;
      if q.is_fixture then
        raise exception 'Testfragen werden nie freigegeben (ADR-021): %', q.key
          using errcode = 'check_violation';
      end if;
      if not exists (select 1 from public.question_reviews r
                     where r.version_id = new.id and r.kind = 'FACT') then
        raise exception 'Freigabe ohne dokumentierte Faktenprüfung (Brief §5.6): %', q.key
          using errcode = 'check_violation';
      end if;
      if not exists (select 1 from public.question_translations t where t.version_id = new.id) then
        raise exception 'Freigabe ohne Fragetext: %', q.key using errcode = 'check_violation';
      end if;
      select t.locale into locale_missing
      from public.question_translations t
      where t.version_id = new.id
        and (t.status <> 'APPROVED'
             or not exists (select 1 from public.question_reviews r
                            where r.version_id = new.id and r.kind = 'LANGUAGE'
                              and r.locale = t.locale))
      limit 1;
      if locale_missing is not null then
        raise exception 'Freigabe ohne freigegebene und geprüfte Sprache %: %', locale_missing, q.key
          using errcode = 'check_violation';
      end if;
      if new.kind = 'TRIVIA' then
        select count(*), count(*) filter (where is_correct) into option_count, correct_count
        from public.question_options where version_id = new.id;
        if option_count < 4 or correct_count <> 1 then
          raise exception 'Freigabe: Trivia braucht mindestens 4 Optionen und genau eine richtige: %', q.key
            using errcode = 'check_violation';
        end if;
        -- jede Sprache beschriftet genau die Optionen der Version, jeweils mit nichtleerem Text
        select t.locale into locale_missing
        from public.question_translations t
        where t.version_id = new.id
          and (t.option_texts is null
               or (select array_agg(k order by k) from jsonb_object_keys(t.option_texts) k)
                  is distinct from (select array_agg(o.option_key order by o.option_key)
                                    from public.question_options o where o.version_id = new.id)
               or exists (select 1 from jsonb_each(t.option_texts) e
                          where jsonb_typeof(e.value) <> 'string' or btrim(e.value #>> '{}') = ''))
        limit 1;
        if locale_missing is not null then
          raise exception 'Freigabe: Optionstexte (%) passen nicht zu den Optionen: %', locale_missing, q.key
            using errcode = 'check_violation';
        end if;
      elsif exists (select 1 from public.question_translations t
                    where t.version_id = new.id and t.option_texts is not null) then
        raise exception 'Freigabe: Schätzfragen haben keine Optionstexte: %', q.key
          using errcode = 'check_violation';
      end if;
      -- der Zeitpunkt der Freigabe kommt immer aus der Datenbank
      new.approved_at := public.game_now();
    end if;
    return new;
  end
  $$;

create trigger question_versions_guard
  before insert or update or delete on question_versions
  for each row execute function question_version_guard();
create trigger question_versions_no_truncate
  before truncate on question_versions
  for each statement execute function forbid_row_change();

-- Optionen, Übersetzungen und Prüfungen gehören zum Inhalt einer Version.
create function question_version_part_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  declare
    target uuid := case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  begin
    if exists (select 1 from public.question_versions v
               where v.id = target and v.status in ('APPROVED', 'RETIRED')) then
      raise exception '%: Teil einer freigegebenen Version ist unveränderlich (%)', tg_table_name, tg_op
        using errcode = 'restrict_violation';
    end if;
    if tg_op = 'UPDATE' and new.version_id <> old.version_id then
      raise exception '%: version_id ist fest', tg_table_name using errcode = 'restrict_violation';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end
  $$;

create trigger question_options_guard
  before insert or update or delete on question_options
  for each row execute function question_version_part_guard();
create trigger question_translations_guard
  before insert or update or delete on question_translations
  for each row execute function question_version_part_guard();
create trigger question_reviews_guard
  before insert or update or delete on question_reviews
  for each row execute function question_version_part_guard();
create trigger question_options_no_truncate
  before truncate on question_options
  for each statement execute function forbid_row_change();
create trigger question_translations_no_truncate
  before truncate on question_translations
  for each statement execute function forbid_row_change();
create trigger question_reviews_no_truncate
  before truncate on question_reviews
  for each statement execute function forbid_row_change();

-- Eine Frage ist nur aktiv, wenn ihre aktuelle Version freigegeben ist. Die Markierung als
-- Testfrage ist fest: Sonst könnte eine freigegebene Frage nachträglich zur Testfrage werden.
create function question_active_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  begin
    if tg_op = 'UPDATE' and new.is_fixture <> old.is_fixture then
      raise exception 'questions: is_fixture ist fest (%)', new.key using errcode = 'restrict_violation';
    end if;
    if new.status = 'ACTIVE' and not exists (
      select 1 from public.question_versions v
      where v.id = new.current_version_id and v.status = 'APPROVED'
    ) then
      raise exception 'questions: aktiv nur mit freigegebener aktueller Version (%)', new.key
        using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;

create trigger questions_active_guard
  before insert or update on questions
  for each row execute function question_active_guard();
