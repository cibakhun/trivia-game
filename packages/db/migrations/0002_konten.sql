-- 0002 Konten und Profile. Bezug: docs/DATA_MODEL.md §4.1, docs/SECURITY.md §5, docs/API.md §1.
-- Regel aus DATA_MODEL §1: Jeder Fremdschlüssel auf users ist ON DELETE RESTRICT und indiziert.
-- IDs fachlicher Entitäten (UUIDv7) erzeugt die Anwendung; deshalb keine Standardwerte für id.

create table users (
  id                    uuid primary key,
  email                 citext null,
  email_verified_at     timestamptz null,
  password_hash         text null,
  is_guest              boolean not null,
  role                  text not null default 'PLAYER' check (role in ('PLAYER', 'EDITOR', 'ADMIN')),
  created_at            timestamptz not null default game_now(),
  last_seen_at          timestamptz null,   -- leer bis zur ersten authentifizierten Anfrage
  guest_bootstrap_hash  bytea null,         -- SHA-256 des Bootstrap-Cookies (API.md §1)
  deletion_requested_at timestamptz null,
  deleted_at            timestamptz null,
  -- Gastkonten haben keine Anmeldedaten.
  constraint users_guest_without_credentials
    check (not is_guest or (email is null and password_hash is null)),
  constraint users_verified_needs_email
    check (email_verified_at is null or email is not null),
  -- Platzhalterkonten gelöschter Konten: alle personenbezogenen Felder leer, keine Anmeldung.
  constraint users_deleted_without_personal_data
    check (deleted_at is null or (email is null and email_verified_at is null
           and password_hash is null and guest_bootstrap_hash is null)),
  constraint users_bootstrap_hash_sha256
    check (guest_bootstrap_hash is null or octet_length(guest_bootstrap_hash) = 32)
);

create unique index users_email_unique on users (email) where email is not null;
create unique index users_guest_bootstrap_unique on users (guest_bootstrap_hash)
  where guest_bootstrap_hash is not null;

create table sessions (
  token_hash   bytea primary key check (octet_length(token_hash) = 32),
  user_id      uuid not null references users (id) on delete restrict,
  created_at   timestamptz not null default game_now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz null,
  check (expires_at > created_at)
);
create index sessions_user on sessions (user_id);

create table player_profiles (
  user_id         uuid primary key references users (id) on delete restrict,
  display_name    text not null unique check (length(display_name) between 1 and 64),
  name_seed       int not null,
  cosmetic_avatar text null,
  created_at      timestamptz not null default game_now()
);

create table player_settings (
  user_id                uuid primary key references users (id) on delete restrict,
  locale                 text not null check (locale in ('de', 'hu', 'en')),
  timezone               text not null default 'UTC',
  auto_extend_enabled    boolean not null default false,
  auto_extend_priorities jsonb not null default '[]'::jsonb
                         check (jsonb_typeof(auto_extend_priorities) = 'array'),
  notification_prefs     jsonb not null default '{}'::jsonb
                         check (jsonb_typeof(notification_prefs) = 'object')
);

-- Weltübergreifende Statistik (Brief §3.4: globale Profile).
create table player_statistics (
  user_id         uuid primary key references users (id) on delete restrict,
  battles         int not null default 0 check (battles >= 0),
  battles_won     int not null default 0 check (battles_won >= 0),
  defenses        int not null default 0 check (defenses >= 0),
  defenses_won    int not null default 0 check (defenses_won >= 0),
  conquests       int not null default 0 check (conquests >= 0),
  regions_max     int not null default 0 check (regions_max >= 0),
  defense_points  int not null default 0 check (defense_points >= 0),
  trivia_answered int not null default 0 check (trivia_answered >= 0),
  trivia_correct  int not null default 0 check (trivia_correct >= 0),
  skill_rating    numeric not null default 0,   -- θ auf der gemeinsamen Skala (QUIZ_ENGINE §10)
  skill_rd        numeric not null default 1.5 check (skill_rd > 0), -- Unsicherheit [E]
  updated_at      timestamptz not null default game_now(),
  check (battles_won <= battles and defenses_won <= defenses and trivia_correct <= trivia_answered)
);
