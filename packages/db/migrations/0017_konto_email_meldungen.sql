-- 0017 Konto löschen, E-Mail mit Bestätigung, Namen melden (ADR-086, O-47, O-48). Bezug:
-- docs/DATA_MODEL.md §4.1, docs/API.md §2.1 und §2.6, docs/SECURITY.md §5.
--
-- 1. E-Mail: Registrierte Konten müssen ihre Adresse innerhalb von 30 Tagen bestätigen, sonst
--    löscht die Kontopflege sie (nur, wenn der Server Mails wirklich zustellt). Die Frist steht in
--    `users.email_due_at`. Konten, die schon registriert sind, bekommen 30 Tage ab dieser
--    Migration. Eindeutig ist eine Adresse erst, wenn sie bestätigt ist: Wer eine fremde Adresse
--    unbestätigt einträgt, blockiert sie damit nicht für den, dem sie gehört.
-- 2. Bestätigungslinks: je Link eine Zeile mit dem SHA-256 des Tokens (das Token selbst steht nur
--    in der Mail), der Adresse, für die er gilt, und seiner Laufzeit.
-- 3. Namen melden: je Meldung eine Zeile mit dem Namen zum Zeitpunkt der Meldung. Ein Spieler
--    meldet ein Konto höchstens einmal, solange die Meldung offen ist. Sperrt die Spielleitung
--    einen Namen, steht sein Schlüssel in `blocked_names` (niemand kann ihn wieder wählen), und
--    das Konto muss sich selbst einen neuen geben (`player_profiles.name_blocked_at`).

alter table users add column email_due_at timestamptz null;
alter table users
  add constraint users_email_due_registered check (email_due_at is null or not is_guest);

update users set email_due_at = game_now() + interval '30 days'
 where not is_guest and deleted_at is null and email_verified_at is null;

drop index users_email_unique;
create unique index users_email_verified_unique on users (email)
  where email is not null and email_verified_at is not null;
create index users_email_due on users (email_due_at)
  where email_due_at is not null and email_verified_at is null and deleted_at is null;
create index users_deletion_requested on users (deletion_requested_at)
  where deletion_requested_at is not null and deleted_at is null;

create table email_verifications (
  id          uuid primary key,
  user_id     uuid not null references users (id) on delete restrict,
  email       citext not null,
  token_hash  bytea not null check (octet_length(token_hash) = 32),
  created_at  timestamptz not null default game_now(),
  expires_at  timestamptz not null,
  used_at     timestamptz null,
  constraint email_verifications_expiry check (expires_at > created_at)
);
create unique index email_verifications_token on email_verifications (token_hash);
create index email_verifications_user on email_verifications (user_id, created_at);

create table name_reports (
  id                uuid primary key,
  reporter_user_id  uuid not null references users (id) on delete restrict,
  reported_user_id  uuid not null references users (id) on delete restrict,
  -- Name, wie er bei der Meldung zu sehen war
  reported_name     text not null check (char_length(reported_name) between 1 and 64),
  match_id          uuid null references matches (id) on delete restrict,
  status            text not null default 'OPEN'
                      check (status in ('OPEN', 'BLOCKED', 'DISMISSED')),
  created_at        timestamptz not null default game_now(),
  resolved_at       timestamptz null,
  constraint name_reports_not_self check (reporter_user_id <> reported_user_id),
  constraint name_reports_resolved check ((status = 'OPEN') = (resolved_at is null))
);
create unique index name_reports_open_once on name_reports (reporter_user_id, reported_user_id)
  where status = 'OPEN';
create index name_reports_reporter on name_reports (reporter_user_id);
create index name_reports_reported on name_reports (reported_user_id);
create index name_reports_match on name_reports (match_id);
create index name_reports_open on name_reports (created_at) where status = 'OPEN';

create table blocked_names (
  -- player_name_key() des gesperrten Namens
  name_key    text primary key check (char_length(name_key) between 1 and 64),
  name        text not null check (char_length(name) between 1 and 64),
  blocked_at  timestamptz not null default game_now()
);

alter table player_profiles add column name_blocked_at timestamptz null;
