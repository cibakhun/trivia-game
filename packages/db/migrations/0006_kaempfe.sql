-- 0006 Kämpfe: Belagerungen, Teilnehmer, Herausforderungen, Antworten, Ergebnisse, Kampfprotokoll.
-- Bezug: docs/DATA_MODEL.md §4.6–4.7 und §5, docs/SIEGE_SYSTEM.md §2–3 und §6, docs/QUIZ_ENGINE.md §7.
-- Jeder Kampf ist eine Zeile in sieges, auch PvE (sofort ausgewertet). Alle Verweise innerhalb
-- eines Kampfes gehören zur selben Instanz: zusammengesetzte Fremdschlüssel über (id, instance_id)
-- entscheiden I13 für diese Tabellen (DATA_MODEL §5).

alter table regions add constraint regions_id_instance unique (id, instance_id);
alter table kingdoms add constraint kingdoms_id_instance unique (id, instance_id);
alter table npc_factions add constraint npc_factions_id_instance unique (id, instance_id);

-- ---------------------------------------------------------------------------------------------
-- I13 auch für die Tabellen aus 0003/0004: Verweise auf Reiche, Regionen und Fraktionen tragen die
-- Instanz mit. Die einfachen Fremdschlüssel werden ersetzt; ADD CONSTRAINT prüft vorhandene Zeilen.
-- Die Indizes führen mit den Fremdschlüsselspalten, damit Löschungen im Ziel nicht scannen.
-- ---------------------------------------------------------------------------------------------

alter table kingdoms
  drop constraint kingdoms_npc_faction_id_fkey,
  add constraint kingdoms_npc_faction_fk foreign key (npc_faction_id, instance_id)
    references npc_factions (id, instance_id);
drop index kingdoms_npc_faction;
create index kingdoms_npc_faction on kingdoms (npc_faction_id, instance_id);

alter table world_participants
  drop constraint world_participants_current_kingdom_fk,
  add constraint world_participants_current_kingdom_fk foreign key (current_kingdom_id, instance_id)
    references kingdoms (id, instance_id);
drop index world_participants_current_kingdom;
create index world_participants_current_kingdom on world_participants (current_kingdom_id, instance_id);

alter table region_state
  drop constraint region_state_owner_kingdom_id_fkey,
  add constraint region_state_owner_fk foreign key (owner_kingdom_id, instance_id)
    references kingdoms (id, instance_id);
drop index region_state_owner;
create index region_state_owner on region_state (owner_kingdom_id, instance_id);

alter table region_history
  drop constraint region_history_region_id_fkey,
  drop constraint region_history_from_kingdom_id_fkey,
  drop constraint region_history_to_kingdom_id_fkey,
  add constraint region_history_region_fk foreign key (region_id, instance_id)
    references regions (id, instance_id),
  add constraint region_history_from_kingdom_fk foreign key (from_kingdom_id, instance_id)
    references kingdoms (id, instance_id),
  add constraint region_history_to_kingdom_fk foreign key (to_kingdom_id, instance_id)
    references kingdoms (id, instance_id);
-- Abfragen nach Region geben die Instanz mit an (sie ist immer bekannt).
drop index region_history_region_at;
create index region_history_region_at on region_history (region_id, instance_id, at desc);
drop index region_history_from_kingdom;
create index region_history_from_kingdom on region_history (from_kingdom_id, instance_id);
drop index region_history_to_kingdom;
create index region_history_to_kingdom on region_history (to_kingdom_id, instance_id);

alter table season_results
  drop constraint season_results_kingdom_id_fkey,
  add constraint season_results_kingdom_fk foreign key (kingdom_id, instance_id)
    references kingdoms (id, instance_id);
drop index season_results_kingdom;
create index season_results_kingdom on season_results (kingdom_id, instance_id);

-- ---------------------------------------------------------------------------------------------
-- Belagerungen (SIEGE_SYSTEM §3)
-- ---------------------------------------------------------------------------------------------

create table sieges (
  id                  uuid primary key,
  instance_id         uuid not null references world_instances (id),
  mode                text not null check (mode in ('PVE', 'PVP')),
  target_region_id    bigint not null,
  attacker_kingdom_id uuid not null,
  defender_kingdom_id uuid null,         -- null = neutral
  defender_kind       text not null check (defender_kind in ('PLAYER', 'NPC', 'NEUTRAL')),
  status              text not null check (status in (
                        'PREPARING', 'ATTACK_FAILED', 'AWAITING_DEFENSE', 'DEFENDING', 'RESOLVING',
                        'ATTACKER_WON', 'DEFENDER_WON', 'ATTACKER_WON_BY_TIMEOUT', 'CANCELLED',
                        'EXPIRED_INVALID')),
  created_at          timestamptz not null default game_now(),
  attack_presented_at timestamptz null,  -- Budgetverbrauch ab hier (GAME_RULES §4)
  opened_at           timestamptz null,  -- Beginn der Verteidigungsfrist (nur PvP)
  base_deadline_at    timestamptz null,
  deadline_at         timestamptz null,
  max_deadline_at     timestamptz null,
  defense_started_at  timestamptz null,
  resolved_at         timestamptz null,
  outcome             text null check (outcome in ('ATTACKER', 'DEFENDER', 'NONE')),
  outcome_reason      text null check (outcome_reason in (
                        'TIMEOUT', 'ATTACKER_GATE', 'TRIVIA', 'ESTIMATE', 'SPEED', 'FULL_TIE',
                        'ABANDONED', 'NEVER_STARTED', 'SEASON_CUTOFF', 'CANCELLED', 'INSTANCE_CLOSED')),
  rules_snapshot      jsonb not null check (jsonb_typeof(rules_snapshot) = 'object'),
  version             int not null default 0 check (version >= 0),
  idempotency_key     uuid not null,     -- NPC: deterministisch je Tick und Aktion
  unique (attacker_kingdom_id, idempotency_key),
  unique (id, target_region_id),         -- Ziel des Fremdschlüssels aus region_state
  unique (id, instance_id),
  constraint sieges_target_fk foreign key (target_region_id, instance_id)
    references regions (id, instance_id),
  constraint sieges_attacker_fk foreign key (attacker_kingdom_id, instance_id)
    references kingdoms (id, instance_id),
  constraint sieges_defender_fk foreign key (defender_kingdom_id, instance_id)
    references kingdoms (id, instance_id),
  constraint sieges_not_self check (attacker_kingdom_id is distinct from defender_kingdom_id),
  -- Fristen: PvE nie; PvP leer bis zur Eröffnung, ab opened_at alle gesetzt und geordnet (I10)
  constraint sieges_deadlines check (
    (opened_at is null and base_deadline_at is null and deadline_at is null and max_deadline_at is null)
    or (mode = 'PVP' and opened_at is not null
        and base_deadline_at is not null and deadline_at is not null and max_deadline_at is not null
        and opened_at <= base_deadline_at
        and base_deadline_at <= deadline_at and deadline_at <= max_deadline_at)
  ),
  -- sofortige Auswertung gegen NPC/neutral, Frist nur gegen Spielerreiche
  constraint sieges_mode_defender check (
    (mode = 'PVE' and defender_kind in ('NPC', 'NEUTRAL')) or (mode = 'PVP' and defender_kind = 'PLAYER')
  ),
  constraint sieges_neutral_without_kingdom check ((defender_kind = 'NEUTRAL') = (defender_kingdom_id is null)),
  -- Endzustände tragen Zeitpunkt und Ergebnis, aktive nicht
  constraint sieges_terminal_fields check (
    (status in ('PREPARING', 'AWAITING_DEFENSE', 'DEFENDING', 'RESOLVING')
      and resolved_at is null and outcome is null and outcome_reason is null)
    or (status not in ('PREPARING', 'AWAITING_DEFENSE', 'DEFENDING', 'RESOLVING')
      and resolved_at is not null and outcome is not null and outcome_reason is not null)
  ),
  constraint sieges_outcome_matches_status check (
    outcome is null
    or (status in ('ATTACKER_WON', 'ATTACKER_WON_BY_TIMEOUT') and outcome = 'ATTACKER')
    or (status = 'DEFENDER_WON' and outcome = 'DEFENDER')
    or (status in ('ATTACK_FAILED', 'CANCELLED', 'EXPIRED_INVALID') and outcome = 'NONE')
  )
);
-- Höchstens eine aktive Belagerung pro Region (I2, N1).
create unique index sieges_one_active_per_region on sieges (target_region_id)
  where status in ('PREPARING', 'AWAITING_DEFENSE', 'DEFENDING', 'RESOLVING');
create index sieges_open_by_defender on sieges (defender_kingdom_id)
  where status in ('PREPARING', 'AWAITING_DEFENSE', 'DEFENDING');
create index sieges_by_attacker_time on sieges (attacker_kingdom_id, attack_presented_at);
create index sieges_due on sieges (deadline_at) where status in ('AWAITING_DEFENSE', 'DEFENDING');
create index sieges_target on sieges (target_region_id, instance_id);
create index sieges_attacker on sieges (attacker_kingdom_id, instance_id);
create index sieges_defender on sieges (defender_kingdom_id, instance_id);
create index sieges_instance on sieges (instance_id);

-- Zeiger der Region auf ihre aktive Belagerung: existiert und betrifft genau diese Region (I3).
alter table region_state
  add constraint region_state_active_siege_fk
  foreign key (active_siege_id, region_id) references sieges (id, target_region_id);
create index region_state_active_siege_region on region_state (active_siege_id, region_id);

alter table region_history
  add constraint region_history_siege_fk foreign key (siege_id, instance_id)
    references sieges (id, instance_id);
create index region_history_siege on region_history (siege_id, instance_id);

-- Das Reich einer Seite steht in sieges (attacker_kingdom_id/defender_kingdom_id); eine Kopie hier
-- könnte auf ein Reich einer anderen Instanz zeigen (I13), deshalb gibt es sie nicht.
create table siege_participants (
  id             uuid primary key,
  siege_id       uuid not null references sieges (id),
  role           text not null check (role in ('ATTACKER', 'DEFENDER')),
  user_id        uuid null references users (id) on delete restrict,
  npc_profile_id uuid null references npc_profiles (id),
  locale         text null check (locale in ('de')),
  unique (siege_id, role),
  unique (id, siege_id),
  -- genau eine Seite antwortet: ein Mensch (mit Sprache) oder ein NPC-Profil
  constraint siege_participants_actor check (
    (user_id is not null and npc_profile_id is null and locale is not null)
    or (user_id is null and npc_profile_id is not null and locale is null)
  )
);
create index siege_participants_user on siege_participants (user_id);
create index siege_participants_npc_profile on siege_participants (npc_profile_id);

-- ---------------------------------------------------------------------------------------------
-- Herausforderungen und Antworten (QUIZ_ENGINE §5 und §7)
-- ---------------------------------------------------------------------------------------------

create table quiz_challenges (
  id                uuid primary key,
  siege_id          uuid not null unique references sieges (id),
  created_at        timestamptz not null default game_now(),
  target_difficulty numeric not null
                    check (target_difficulty > '-Infinity' and target_difficulty < 'Infinity'),
  rng_key_id        text not null check (length(rng_key_id) between 1 and 64),
  rng_version       smallint not null check (rng_version >= 1),
  unique (id, siege_id)
);

-- Die Fragenauswahl ist fest, solange die Herausforderung läuft (Brief §5.4).
create table quiz_challenge_steps (
  challenge_id  uuid not null references quiz_challenges (id),
  step_index    smallint not null check (step_index in (0, 1)),
  kind          text not null,
  version_id    uuid not null,
  time_limit_ms int not null check (time_limit_ms between 1000 and 600000),
  primary key (challenge_id, step_index),
  -- Schritt 0 ist die Trivia-, Schritt 1 die Schätzfrage (GAME_RULES §5.1)
  constraint quiz_challenge_steps_order check (
    (step_index = 0 and kind = 'TRIVIA') or (step_index = 1 and kind = 'ESTIMATE')
  ),
  constraint quiz_challenge_steps_version_fk foreign key (version_id, kind)
    references question_versions (id, kind)
);
create index quiz_challenge_steps_version on quiz_challenge_steps (version_id, kind);

create table quiz_answers (
  id                 uuid primary key,
  challenge_id       uuid not null,
  siege_id           uuid not null,        -- Kopie: Teilnehmer und Herausforderung gehören zum selben Kampf
  participant_id     uuid not null,
  step_index         smallint not null check (step_index in (0, 1)),
  locale             text null check (locale in ('de')),  -- null nur bei NPC-Antworten
  presentation       jsonb null check (presentation is null or jsonb_typeof(presentation) = 'object'),
  presented_at       timestamptz null,
  answer_deadline_at timestamptz null,     -- presented_at + Zeitlimit + cap; rechtzeitig: received_at < answer_deadline_at
  received_at        timestamptz null,     -- beim Eintreffen der Anfrage, vor dem Warten auf Sperren
  answer_option_key  text null,
  answer_value       numeric null check (answer_value > '-Infinity' and answer_value < 'Infinity'),
  raw_input          text null check (length(raw_input) <= 64),
  client_elapsed_ms  int null,
  rtt_ms             int null check (rtt_ms >= 0),
  server_elapsed_ms  int null check (server_elapsed_ms >= 0),
  effective_ms       int null check (effective_ms >= 0),
  is_correct         boolean null,
  distance           numeric null check (distance >= 0 and distance < 'Infinity'),
  status             text not null check (status in ('PRESENTED', 'ANSWERED', 'TIMED_OUT', 'GENERATED')),
  idempotency_key    uuid null,
  audit              jsonb null check (audit is null or jsonb_typeof(audit) = 'object'),  -- NPC: θ, b, Ziehungen
  created_at         timestamptz not null default game_now(),
  unique (participant_id, step_index),
  unique (participant_id, idempotency_key),
  constraint quiz_answers_challenge_fk foreign key (challenge_id, siege_id)
    references quiz_challenges (id, siege_id),
  constraint quiz_answers_participant_fk foreign key (participant_id, siege_id)
    references siege_participants (id, siege_id),
  constraint quiz_answers_step_fk foreign key (challenge_id, step_index)
    references quiz_challenge_steps (challenge_id, step_index),
  -- Menschen: präsentiert mit Frist; NPC-Antworten entstehen vorab ohne Präsentation
  constraint quiz_answers_presentation check (
    (status = 'GENERATED' and locale is null and presented_at is null and answer_deadline_at is null
      and received_at is null and presentation is null and audit is not null)
    or (status <> 'GENERATED' and locale is not null and presented_at is not null
      and answer_deadline_at is not null and presentation is not null
      and presented_at < answer_deadline_at)
  ),
  constraint quiz_answers_answered check (
    (status = 'PRESENTED' and received_at is null and is_correct is null and effective_ms is null)
    or (status = 'ANSWERED' and received_at is not null and is_correct is not null)
    or (status = 'TIMED_OUT' and is_correct is null)
    or status = 'GENERATED'
  ),
  constraint quiz_answers_one_answer_kind check (answer_option_key is null or answer_value is null)
);
create index quiz_answers_challenge on quiz_answers (challenge_id, siege_id);
create index quiz_answers_participant on quiz_answers (participant_id, siege_id);
create index quiz_answers_step on quiz_answers (challenge_id, step_index);
create index quiz_answers_open on quiz_answers (answer_deadline_at) where status = 'PRESENTED';

-- Abgegebene Antworten sind unveränderlich (I11); nur PRESENTED darf einmal übergehen.
create function quiz_answer_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  begin
    if tg_op = 'DELETE' then
      raise exception 'quiz_answers: Antworten werden nicht gelöscht' using errcode = 'restrict_violation';
    end if;
    if old.status <> 'PRESENTED' then
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

create trigger quiz_answers_guard
  before update or delete on quiz_answers
  for each row execute function quiz_answer_guard();
create trigger quiz_answers_no_truncate
  before truncate on quiz_answers
  for each statement execute function forbid_row_change();

-- ---------------------------------------------------------------------------------------------
-- Ergebnisse und Protokoll
-- ---------------------------------------------------------------------------------------------

create table battle_results (
  siege_id         uuid primary key references sieges (id),
  winner_role      text null check (winner_role in ('ATTACKER', 'DEFENDER')),
  reason           text not null check (reason in (
                     'TIMEOUT', 'ATTACKER_GATE', 'TRIVIA', 'ESTIMATE', 'SPEED', 'FULL_TIE',
                     'ABANDONED', 'NEVER_STARTED', 'SEASON_CUTOFF', 'CANCELLED')),
  attacker_summary jsonb not null check (jsonb_typeof(attacker_summary) = 'object'),
  defender_summary jsonb not null check (jsonb_typeof(defender_summary) = 'object'),
  defended         boolean not null default false,
  defense_points   smallint not null default 0 check (defense_points between 0 and 100),
  decided_at       timestamptz not null default game_now(),
  core_version     text not null check (length(core_version) between 1 and 40)
);

create trigger battle_results_immutable
  before update or delete on battle_results
  for each row execute function forbid_row_change();
create trigger battle_results_no_truncate
  before truncate on battle_results
  for each statement execute function forbid_row_change();

create table battle_events (
  id       bigint generated always as identity primary key,
  siege_id uuid not null references sieges (id),
  seq      int not null check (seq >= 1),
  type     text not null check (type ~ '^[A-Z][A-Z_]*$'),
  payload  jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  at       timestamptz not null default game_now(),
  unique (siege_id, seq)
);

-- nur anhängen (DATA_MODEL §1); DELETE bleibt für Aufbewahrungsfristen
create trigger battle_events_append_only
  before update on battle_events
  for each row execute function forbid_row_change();
create trigger battle_events_no_truncate
  before truncate on battle_events
  for each statement execute function forbid_row_change();
