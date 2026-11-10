-- 0003 Welten, Regelversionen, Saisons, Instanzen, Teilnahme. Bezug: docs/DATA_MODEL.md §4.2,
-- docs/WORLD_SYSTEM.md. world_participants.current_kingdom_id erhält den Fremdschlüssel in 0004.

create table worlds (
  id               uuid primary key,
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  mode             text not null check (mode in ('ETERNAL', 'DAILY', 'WEEKLY')),
  name_key         text not null,
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  current_rules_id uuid null    -- Fremdschlüssel unten, nach world_rules
);

-- Versionierte Regelkonfiguration; Schema in packages/protocol (rulesConfigSchema).
-- Zeilen sind unveränderlich: Änderungen erzeugen eine neue Version.
create table world_rules (
  id          uuid primary key,
  world_id    uuid not null references worlds (id),
  version     int not null check (version >= 1),
  config      jsonb not null check (jsonb_typeof(config) = 'object'),
  config_hash text not null check (config_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256, hex
  created_by  uuid null references users (id) on delete restrict,
  created_at  timestamptz not null default game_now(),
  notes       text null,
  unique (world_id, version),
  unique (id, world_id)          -- Ziel der Fremdschlüssel, die die Welt mitprüfen
);
create index world_rules_created_by on world_rules (created_by);

create trigger world_rules_immutable
  before update or delete on world_rules
  for each row execute function forbid_row_change();
create trigger world_rules_no_truncate
  before truncate on world_rules
  for each statement execute function forbid_row_change();

-- Die aktuelle Regelversion muss zur selben Welt gehören.
alter table worlds
  add constraint worlds_current_rules_fk
  foreign key (current_rules_id, id) references world_rules (id, world_id);
create index worlds_current_rules on worlds (current_rules_id, id);

create table world_seasons (
  id            uuid primary key,
  world_id      uuid not null references worlds (id),
  period_key    text not null,                 -- z. B. 2026-11-09 (Daily), 2026-W46 (Weekly)
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  pvp_cutoff_at timestamptz not null,
  status        text not null default 'SCHEDULED'
                check (status in ('SCHEDULED', 'RUNNING', 'CLOSING', 'CLOSED')),
  unique (world_id, period_key),
  unique (id, world_id),
  check (starts_at < pvp_cutoff_at and pvp_cutoff_at <= ends_at)
);

-- Saison und Regelversion einer Instanz gehören zur selben Welt (zusammengesetzte Fremdschlüssel).
create table world_instances (
  id         uuid primary key,
  world_id   uuid not null references worlds (id),
  season_id  uuid null,      -- Eternal: null
  rules_id   uuid not null,
  map_seed   bigint not null,
  capacity   int not null check (capacity > 0),
  status     text not null default 'PROVISIONING'
             check (status in ('PROVISIONING', 'RUNNING', 'CLOSING', 'CLOSED', 'ARCHIVED')),
  starts_at  timestamptz not null,
  ends_at    timestamptz null,
  closed_at  timestamptz null,
  event_seq  bigint not null default 0 check (event_seq >= 0),  -- Zähler für world_events.seq
  check (ends_at is null or starts_at < ends_at),
  constraint world_instances_season_fk
    foreign key (season_id, world_id) references world_seasons (id, world_id),
  constraint world_instances_rules_fk
    foreign key (rules_id, world_id) references world_rules (id, world_id)
);
create index world_instances_world_status on world_instances (world_id, status);
create index world_instances_season on world_instances (season_id, world_id);
create index world_instances_rules on world_instances (rules_id, world_id);

create table world_participants (
  instance_id        uuid not null references world_instances (id),
  user_id            uuid not null references users (id) on delete restrict,
  joined_at          timestamptz not null default game_now(),
  status             text not null default 'ACTIVE' check (status in ('ACTIVE', 'LEFT', 'BANNED')),
  current_kingdom_id uuid null,
  last_active_at     timestamptz null,
  primary key (instance_id, user_id)
);
create index world_participants_user on world_participants (user_id);
