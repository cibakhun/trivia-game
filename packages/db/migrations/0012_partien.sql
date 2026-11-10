-- 0012 Partien (rundenbasierte Partie, Paket M2; ADR-046 bis ADR-049).
-- Bezug: docs/MATCH_RULES.md, docs/API.md §2.6, docs/DATA_MODEL.md §4.10.
--
-- Eine Partie entsteht als Aufstellung (LOBBY) mit Einladungscode und läuft nach dem Start als
-- Zustandsmaschine aus game-core (`state`, reines JSON). Der Server führt die Zeit: `phase` und
-- `phase_deadline_at` sagen, worauf die Partie gerade wartet (Wahl, Frage, Auflösung) und bis
-- wann. Alles, was nach einem Neustart weiterlaufen muss, steht hier; der Ablauf liest nur diese
-- Tabellen und `game_now()`.
--
-- Normale Partien spielen nur Menschen; in Testpartien (kind = TEST, nicht in Produktion) füllen
-- Bots freie Plätze (ADR-048). Bot-Antworten werden beim Öffnen einer Frage erzeugt und
-- gespeichert, bevor ein Mensch die Frage sieht (status GENERATED).

alter table player_statistics
  add column matches_played int not null default 0 check (matches_played >= 0),
  add column matches_won int not null default 0 check (matches_won >= 0),
  add constraint player_statistics_matches_won check (matches_won <= matches_played);

create table matches (
  id                 uuid primary key,
  kind               text not null check (kind in ('STANDARD', 'TEST')),
  status             text not null check (status in ('LOBBY', 'RUNNING', 'FINISHED', 'ABANDONED')),
  host_user_id       uuid not null references users (id) on delete restrict,
  -- 6 Zeichen ohne leicht verwechselbare (0, O, 1, I); eindeutig unter offenen Aufstellungen
  invite_code        text not null check (invite_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  rules_preset       text not null check (rules_preset in ('DEFAULT', 'PLAYTEST')),
  -- Nur Testpartien: Plätze und Stärke der Bots für die freien Plätze, in Reihenfolge
  test_seats         smallint null check (test_seats in (2, 3)),
  test_bot_strengths text[] null,
  -- Regeln (matchRulesSchema) und Zustand (MatchState) ab dem Start
  rules              jsonb null check (rules is null or jsonb_typeof(rules) = 'object'),
  state              jsonb null check (state is null or jsonb_typeof(state) = 'object'),
  phase              text null check (phase in ('PICK', 'QUESTION', 'REVEAL')),
  phase_deadline_at  timestamptz null,
  -- Laufende bzw. zuletzt aufgelöste Frage (QUESTION, REVEAL)
  question_seq       int null check (question_seq >= 1),
  rng_key_id         text not null check (length(rng_key_id) between 1 and 64),
  rng_version        smallint not null check (rng_version >= 1),
  -- Zähler für abgeleitete Zufallsströme (Wahl nach Zeitablauf, Bot-Wahl)
  draws              int not null default 0 check (draws >= 0),
  created_at         timestamptz not null default game_now(),
  started_at         timestamptz null,
  finished_at        timestamptz null,
  constraint matches_test_config check (
    (kind = 'STANDARD' and test_seats is null and test_bot_strengths is null)
    or (kind = 'TEST' and test_seats is not null and test_bot_strengths is not null
        and cardinality(test_bot_strengths) = test_seats - 1
        and test_bot_strengths <@ array['EASY', 'MEDIUM', 'HARD'])
  ),
  constraint matches_lifecycle check (
    (status = 'LOBBY' and rules is null and state is null and phase is null
      and phase_deadline_at is null and question_seq is null and started_at is null
      and finished_at is null)
    or (status = 'RUNNING' and rules is not null and state is not null and phase is not null
      and phase_deadline_at is not null and started_at is not null and finished_at is null
      and (phase = 'PICK' or question_seq is not null))
    or (status = 'FINISHED' and rules is not null and state is not null and phase is null
      and phase_deadline_at is null and started_at is not null and finished_at >= started_at)
    or (status = 'ABANDONED' and phase is null and phase_deadline_at is null
      and finished_at is not null)
  )
);
create unique index matches_open_invite_code on matches (invite_code) where status = 'LOBBY';
-- Ablaufsteuerung: fällige Fristen laufender Partien
create index matches_due on matches (phase_deadline_at) where status = 'RUNNING';
-- Aufräumen verwaister Aufstellungen
create index matches_lobby_age on matches (created_at) where status = 'LOBBY';
create index matches_host on matches (host_user_id);

-- Teilnehmer: Menschen beim Beitritt, Bots beim Start. Der Sitz (Zugreihenfolge) wird beim Start
-- gelost; vorher ist er leer.
create table match_players (
  match_id     uuid not null references matches (id),
  join_order   smallint not null check (join_order between 0 and 2),
  user_id      uuid null references users (id) on delete restrict,
  bot_strength text null check (bot_strength in ('EASY', 'MEDIUM', 'HARD')),
  seat         smallint null check (seat between 0 and 2),
  joined_at    timestamptz not null default game_now(),
  primary key (match_id, join_order),
  unique (match_id, seat),
  unique (match_id, user_id),
  constraint match_players_human_or_bot check ((user_id is null) <> (bot_strength is null))
);
create index match_players_user on match_players (user_id);

-- Gestellte Fragen der Partie in Reihenfolge. Optionen und ihre Reihenfolge sind für alle Sitze
-- dieser Frage gleich (`presentation`: Token → Schlüssel).
create table match_questions (
  match_id      uuid not null references matches (id),
  seq           int not null check (seq >= 1),
  kind          text not null check (kind in ('TRIVIA', 'ESTIMATE')),
  -- Wofür die Frage gestellt wird: Landnahme (Schätzung aller) oder Duell (Wissens-, Stechfrage)
  purpose       text not null check (purpose in ('LAND', 'DUEL_TRIVIA', 'DUEL_ESTIMATE')),
  version_id    uuid not null,
  -- Sitze, die antworten (Landnahme: alle lebenden, Duell: Angreifer und Verteidiger)
  seats         smallint[] not null check (cardinality(seats) between 2 and 3),
  presentation  jsonb not null check (jsonb_typeof(presentation) = 'object'),
  time_limit_ms int not null check (time_limit_ms between 1000 and 600000),
  opened_at     timestamptz not null,
  -- Nach diesem Zeitpunkt wird die Frage nicht mehr gezeigt und angenommen: Zeitlimit +
  -- Latenzpuffer + Abholpuffer ab dem Öffnen. Aufgelöst wird kurz danach (Auflösungspuffer).
  closes_at     timestamptz not null check (closes_at > opened_at),
  resolved_at   timestamptz null check (resolved_at >= opened_at),
  primary key (match_id, seq),
  constraint match_questions_version_fk foreign key (version_id, kind)
    references question_versions (id, kind),
  -- Wissensfragen nur im Duell, Schätzfragen in Landnahme und Stechen
  constraint match_questions_purpose check ((purpose = 'DUEL_TRIVIA') = (kind = 'TRIVIA'))
);
create index match_questions_version on match_questions (version_id, kind);

-- Wie bei den Herausforderungen (0006): nur freigegebene Versionen aktiver Fragen, Testfragen nur
-- dort, wo der Import sie zulässt (local, test).
create function match_question_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  begin
    if not exists (
      select 1 from public.question_versions v join public.questions q on q.id = v.question_id
      where v.id = new.version_id
        and ((v.status = 'APPROVED' and q.status = 'ACTIVE') or (q.is_fixture and v.status <> 'RETIRED'))
    ) then
      raise exception 'match_questions: Version % ist nicht freigegeben oder die Frage nicht aktiv',
        new.version_id using errcode = 'check_violation';
    end if;
    return new;
  end
  $$;

create trigger match_questions_guard
  before insert on match_questions
  for each row execute function match_question_guard();

-- Antworten je Frage und Sitz. Menschen: Zeile beim ersten Abholen der Frage (PRESENTED), dann
-- ANSWERED oder bei der Auflösung MISSED; wer die Frage nie abholt, bekommt bei der Auflösung eine
-- MISSED-Zeile ohne Präsentation. Bots: GENERATED beim Öffnen der Frage, versiegelt.
create table match_answers (
  match_id           uuid not null,
  seq                int not null,
  seat               smallint not null check (seat between 0 and 2),
  status             text not null check (status in ('PRESENTED', 'ANSWERED', 'MISSED', 'GENERATED')),
  presented_at       timestamptz null,
  -- presented_at + Zeitlimit + cap, höchstens closes_at; rechtzeitig: received_at < Frist
  answer_deadline_at timestamptz null,
  received_at        timestamptz null,
  reloads            int not null default 0 check (reloads >= 0),
  answer_option_key  text null,
  answer_value       numeric null check (answer_value > '-Infinity' and answer_value < 'Infinity'),
  client_elapsed_ms  int null,
  server_elapsed_ms  int null check (server_elapsed_ms >= 0),
  effective_ms       int null check (effective_ms >= 0),
  is_correct         boolean null,
  distance           numeric null check (distance >= 0 and distance < 'Infinity'),
  idempotency_key    uuid null,
  audit              jsonb null check (audit is null or jsonb_typeof(audit) = 'object'),
  created_at         timestamptz not null default game_now(),
  primary key (match_id, seq, seat),
  unique (match_id, seat, idempotency_key),
  constraint match_answers_question_fk foreign key (match_id, seq)
    references match_questions (match_id, seq),
  constraint match_answers_one_answer_kind check (answer_option_key is null or answer_value is null),
  constraint match_answers_state check (
    (status = 'PRESENTED' and presented_at is not null and answer_deadline_at > presented_at
      and received_at is null and is_correct is null and effective_ms is null)
    or (status = 'ANSWERED' and presented_at is not null and received_at is not null
      and received_at < answer_deadline_at and is_correct is not null
      and effective_ms is not null and idempotency_key is not null)
    or (status = 'MISSED' and received_at is null and is_correct is null and distance is null
      and effective_ms is null)
    or (status = 'GENERATED' and presented_at is null and received_at is null
      and is_correct is not null and audit is not null)
  )
);

-- Abgegebene Antworten sind unveränderlich (DATA_MODEL I11): geändert wird nur eine gestellte
-- Frage (Reload zählen, beantworten, bei der Auflösung verpasst). GENERATED genau für Bot-Sitze,
-- und nur Sitze, an die die Frage geht.
create function match_answer_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  declare
    is_bot boolean;
  begin
    if tg_op = 'DELETE' then
      raise exception 'match_answers: Antworten werden nicht gelöscht' using errcode = 'restrict_violation';
    end if;
    if tg_op = 'INSERT' then
      if not exists (
        select 1 from public.match_questions q
        where q.match_id = new.match_id and q.seq = new.seq and new.seat = any (q.seats)
      ) then
        raise exception 'match_answers: Sitz % ist an Frage % nicht beteiligt', new.seat, new.seq
          using errcode = 'check_violation';
      end if;
      select p.bot_strength is not null into is_bot
      from public.match_players p where p.match_id = new.match_id and p.seat = new.seat;
      if is_bot is null or is_bot <> (new.status = 'GENERATED') then
        raise exception 'match_answers: GENERATED genau für Bot-Sitze (Status %)', new.status
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
    if old.status <> 'PRESENTED' then
      raise exception 'match_answers: abgegebene Antworten sind unveränderlich'
        using errcode = 'restrict_violation';
    end if;
    if new.status not in ('PRESENTED', 'ANSWERED', 'MISSED')
       or new.match_id <> old.match_id or new.seq <> old.seq or new.seat <> old.seat
       or new.presented_at is distinct from old.presented_at
       or new.answer_deadline_at is distinct from old.answer_deadline_at
       or new.reloads < old.reloads or new.created_at <> old.created_at then
      raise exception 'match_answers: unzulässige Änderung einer gestellten Frage'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end
  $$;

create trigger match_answers_guard
  before insert or update or delete on match_answers
  for each row execute function match_answer_guard();
create trigger match_answers_no_truncate
  before truncate on match_answers
  for each statement execute function forbid_row_change();

-- Protokoll der Partie: jede Zustandsänderung als Ereignis, fortlaufend je Partie. Die Clients
-- lesen es ab einer Nummer (später per WebSocket, M3). Ereignisse nennen Sitze, keine Konten.
create table match_events (
  match_id uuid not null references matches (id),
  seq      int not null check (seq >= 1),
  type     text not null check (type ~ '^[A-Z_]{1,40}$'),
  payload  jsonb not null check (jsonb_typeof(payload) = 'object'),
  at       timestamptz not null default game_now(),
  primary key (match_id, seq)
);
create trigger match_events_immutable
  before update or delete on match_events
  for each row execute function forbid_row_change();
create trigger match_events_no_truncate
  before truncate on match_events
  for each statement execute function forbid_row_change();
