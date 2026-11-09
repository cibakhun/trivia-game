-- 0004 NPC-Profile und -Fraktionen, Königreiche, Karte, Saisonergebnisse.
-- Bezug: docs/DATA_MODEL.md §4.2–4.5, docs/GAME_RULES.md §2–3, docs/NPC_SYSTEM.md §2–3.
-- Fremdschlüssel auf sieges (region_state.active_siege_id, region_history.siege_id) folgen mit
-- der Migration der Belagerungen (Phase 1/3).

-- ---------------------------------------------------------------------------------------------
-- NPCs
-- ---------------------------------------------------------------------------------------------

-- Versionierte, unveränderliche Antwortprofile. Die Basisprofile kommen als Referenzdaten mit
-- der PvE-Phase (DATA_MODEL §6.4), zusammen mit dem Code, der sie nutzt.
create table npc_profiles (
  id              uuid primary key,
  code            text not null,
  version         int not null check (version >= 1),
  -- numeric kennt NaN und ±Infinity (NaN gilt als größer als jede Zahl), daher beide Grenzen.
  skill_theta     numeric not null check (skill_theta > '-Infinity' and skill_theta < 'Infinity'),
  estimate_spread jsonb not null check (jsonb_typeof(estimate_spread) = 'object'),
  rt_log_mu       numeric not null check (rt_log_mu > '-Infinity' and rt_log_mu < 'Infinity'),
  rt_log_sigma    numeric not null check (rt_log_sigma > 0 and rt_log_sigma < 'Infinity'),
  created_at      timestamptz not null default game_now(),
  unique (code, version)
);

create trigger npc_profiles_immutable
  before update or delete on npc_profiles
  for each row execute function forbid_row_change();
create trigger npc_profiles_no_truncate
  before truncate on npc_profiles
  for each statement execute function forbid_row_change();

create table npc_factions (
  id           uuid primary key,
  instance_id  uuid not null references world_instances (id),
  name_key     text not null,
  archetype    text not null check (archetype in ('LIGHT', 'MEDIUM', 'HEAVY')),
  profile_id   uuid not null references npc_profiles (id),
  aggression   numeric not null check (aggression between 0 and 1),
  expansion    numeric not null check (expansion between 0 and 1),
  status       text not null default 'ACTIVE' check (status in ('ACTIVE', 'DORMANT', 'ELIMINATED')),
  home_chunk_x int not null,
  home_chunk_y int not null
);
create index npc_factions_instance on npc_factions (instance_id);
create index npc_factions_profile on npc_factions (profile_id);

-- ---------------------------------------------------------------------------------------------
-- Königreiche
-- ---------------------------------------------------------------------------------------------

create table kingdoms (
  id                uuid primary key,
  instance_id       uuid not null references world_instances (id),
  kind              text not null check (kind in ('PLAYER', 'NPC')),
  owner_user_id     uuid null references users (id) on delete restrict,
  npc_faction_id    uuid null references npc_factions (id),
  name_parts        jsonb not null check (jsonb_typeof(name_parts) = 'object'),
  color             smallint not null check (color >= 0),
  status            text not null default 'ACTIVE' check (status in ('ACTIVE', 'FALLEN', 'DISSOLVED')),
  region_count      int not null default 0 check (region_count >= 0),
  protected_until   timestamptz null,
  protection_reason text null check (protection_reason in ('NEWBIE', 'RESPAWN', 'VACATION')),
  generation        smallint not null default 1 check (generation >= 1),  -- n-tes Reich des Spielers
  founded_at        timestamptz not null default game_now(),
  fallen_at         timestamptz null,
  version           bigint not null default 0,
  constraint kingdoms_kind_owner check (
    (kind = 'PLAYER' and owner_user_id is not null and npc_faction_id is null)
    or (kind = 'NPC' and npc_faction_id is not null and owner_user_id is null)
  ),
  constraint kingdoms_protection_pair check ((protected_until is null) = (protection_reason is null)),
  constraint kingdoms_fallen_at check ((status = 'FALLEN') = (fallen_at is not null)),
  -- generation zählt die Reiche eines Spielers je Instanz; NPC-Reiche (Besitzer null) zählen nicht.
  constraint kingdoms_generation_unique unique (instance_id, owner_user_id, generation)
);
-- Ein Spieler hat pro Instanz höchstens ein aktives Reich (GAME_RULES §3.1).
create unique index kingdoms_one_active_per_player on kingdoms (instance_id, owner_user_id)
  where status = 'ACTIVE' and kind = 'PLAYER';
-- Eine Fraktion steuert höchstens ein aktives Reich.
create unique index kingdoms_one_active_per_faction on kingdoms (instance_id, npc_faction_id)
  where status = 'ACTIVE' and kind = 'NPC';
create index kingdoms_owner_user on kingdoms (owner_user_id);
create index kingdoms_npc_faction on kingdoms (npc_faction_id);

create table kingdom_statistics (
  kingdom_id            uuid primary key references kingdoms (id),
  max_regions           int not null default 0 check (max_regions >= 0),
  npc_regions_conquered int not null default 0 check (npc_regions_conquered >= 0),
  pvp_won               int not null default 0 check (pvp_won >= 0),
  pvp_lost              int not null default 0 check (pvp_lost >= 0),
  defenses_won          int not null default 0 check (defenses_won >= 0),
  defenses_lost         int not null default 0 check (defenses_lost >= 0),
  defense_points        int not null default 0 check (defense_points >= 0),
  timeout_losses        int not null default 0 check (timeout_losses >= 0),
  longest_connected     int not null default 0 check (longest_connected >= 0),
  updated_at            timestamptz not null default game_now()
);

create table kingdom_history (
  id         bigint generated always as identity primary key,
  kingdom_id uuid not null references kingdoms (id),
  kind       text not null
             check (kind in ('FOUNDED', 'CAPITAL_CHANGED', 'RANK_CHANGED', 'FALLEN', 'RANK_SNAPSHOT')),
  payload    jsonb not null default '{}'::jsonb,
  at         timestamptz not null default game_now()
);
create index kingdom_history_kingdom_at on kingdom_history (kingdom_id, at);

-- Protokolle werden nur angehängt (DATA_MODEL §1). UPDATE ist für alle gesperrt; DELETE bleibt für
-- die Aufbewahrungsfristen (DATA_MODEL §7) und wird der Anwendungsrolle mit der Rollen-Migration
-- per Rechtevergabe entzogen.
create trigger kingdom_history_append_only
  before update on kingdom_history
  for each row execute function forbid_row_change();

alter table world_participants
  add constraint world_participants_current_kingdom_fk
  foreign key (current_kingdom_id) references kingdoms (id);
create index world_participants_current_kingdom on world_participants (current_kingdom_id);

-- ---------------------------------------------------------------------------------------------
-- Karte (DATA_MODEL §4.3; verbindliche Constraints dort)
-- ---------------------------------------------------------------------------------------------

create table regions (
  id              bigint generated always as identity primary key,
  instance_id     uuid not null references world_instances (id),
  q               int  not null,
  r               int  not null,
  chunk_x         int  not null,           -- aus Offset-Koordinaten abgeleitet, unveränderlich
  chunk_y         int  not null,
  biome           smallint not null,
  tier            smallint not null check (tier between 0 and 10),
  strategic_value smallint not null default 0,
  province_id     uuid null,               -- vorbereitet für Provinzen (O-14), im MVP null
  unique (instance_id, q, r),
  unique (id, instance_id, chunk_x, chunk_y),   -- Ziel des Fremdschlüssels aus region_state
  -- Gleiche Formel wie chunkOf in packages/game-core (odd-r, 16 × 16; WORLD_SYSTEM §3.1).
  constraint regions_chunk_matches_coordinates check (
    chunk_x = floor((q + (r - (r & 1)) / 2)::numeric / 16)
    and chunk_y = floor(r::numeric / 16)
  )
);
create index regions_chunk on regions (instance_id, chunk_x, chunk_y);

-- Statische Kartendaten ändern sich nie (Löschen bleibt für Aufbewahrungsfristen möglich).
create trigger regions_immutable
  before update on regions
  for each row execute function forbid_row_change();

-- instance_id und Chunk sind Kopien für Chunk-Abfragen ohne Join; der zusammengesetzte
-- Fremdschlüssel hält sie gleich mit regions.
create table region_state (
  region_id         bigint primary key,
  instance_id       uuid not null,
  chunk_x           int  not null,
  chunk_y           int  not null,
  owner_kingdom_id  uuid null references kingdoms (id),   -- null = neutral
  is_capital        boolean not null default false,
  owned_since       timestamptz null,
  protected_until   timestamptz null,
  protection_reason text null check (protection_reason in ('CONQUEST', 'ADMIN')),
  active_siege_id   uuid null,           -- Fremdschlüssel auf sieges(id, target_region_id), DATA_MODEL §4.7
  version           bigint not null default 0,
  updated_at        timestamptz not null default game_now(),
  check (not is_capital or owner_kingdom_id is not null),
  check ((protected_until is null) = (protection_reason is null)),
  constraint region_state_region_fk foreign key (region_id, instance_id, chunk_x, chunk_y)
    references regions (id, instance_id, chunk_x, chunk_y)
);
create index region_state_owner on region_state (owner_kingdom_id);
create index region_state_chunk on region_state (instance_id, chunk_x, chunk_y);
create unique index region_state_one_capital on region_state (owner_kingdom_id) where is_capital;
create unique index region_state_active_siege on region_state (active_siege_id)
  where active_siege_id is not null;

create table region_history (
  id              bigint generated always as identity primary key,
  region_id       bigint not null references regions (id),
  instance_id     uuid not null references world_instances (id),
  from_kingdom_id uuid null references kingdoms (id),
  to_kingdom_id   uuid null references kingdoms (id),
  cause           text not null check (cause in
                  ('CONQUEST_PVE', 'CONQUEST_PVP', 'TIMEOUT', 'NPC', 'START_CLAIM', 'DECAY', 'ADMIN')),
  siege_id        uuid null,              -- Fremdschlüssel mit der Belagerungs-Migration
  at              timestamptz not null default game_now()
);
create index region_history_region_at on region_history (region_id, at desc);
create index region_history_instance_at on region_history (instance_id, at);
create index region_history_from_kingdom on region_history (from_kingdom_id);
create index region_history_to_kingdom on region_history (to_kingdom_id);

create trigger region_history_append_only
  before update on region_history
  for each row execute function forbid_row_change();

-- ---------------------------------------------------------------------------------------------
-- Saisonergebnisse (DATA_MODEL §4.2)
-- ---------------------------------------------------------------------------------------------

create table season_results (
  instance_id uuid not null references world_instances (id),
  user_id     uuid not null references users (id) on delete restrict,
  kingdom_id  uuid not null references kingdoms (id),
  rank        int not null check (rank >= 1),
  score       int not null,
  details     jsonb not null default '{}'::jsonb,
  primary key (instance_id, user_id)
);
create index season_results_user on season_results (user_id);
create index season_results_kingdom on season_results (kingdom_id);
