-- 0007 Betrieb (Outbox world_events, Idempotenzspeicher) und NPC-Basisprofile als Referenzdaten.
-- Bezug: docs/DATA_MODEL.md §4.5, §4.9 und §6.4, docs/API.md §1, docs/ARCHITECTURE.md §10,
-- docs/NPC_SYSTEM.md §2–3.

-- ---------------------------------------------------------------------------------------------
-- Outbox (ARCHITECTURE §10): seq lückenlos je Instanz aus world_instances.event_seq; die Nummer
-- vergibt der Trigger world_events_seq, nicht die Anwendung (ADR-027)
-- ---------------------------------------------------------------------------------------------

create table world_events (
  id          bigint generated always as identity primary key,
  instance_id uuid not null references world_instances (id),
  seq         bigint not null default 0 check (seq >= 1),  -- 0 = „vergibt der Trigger“
  chunk_x     int null,
  chunk_y     int null,
  user_id     uuid null references users (id) on delete restrict,  -- gesetzt = persönliches Ereignis
  -- REDACTED: Platzhalter für geschwärzte persönliche Ereignisse (SECURITY.md §5.2)
  type        text not null check (type = 'REDACTED' or type ~ '^[a-z]+(\.[a-z]+)+$'),
  payload     jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at  timestamptz not null default game_now(),
  unique (instance_id, seq),
  check ((chunk_x is null) = (chunk_y is null)),
  -- ein Platzhalter hält weder Konto noch Inhalt (SECURITY.md §5.2)
  constraint world_events_redacted check (type <> 'REDACTED' or (user_id is null and payload = '{}'::jsonb))
);
create index world_events_user on world_events (user_id);
create index world_events_created on world_events (created_at);

-- Vergibt die nächste Nummer der Instanz und erhöht den Zähler in derselben Transaktion: Die
-- Zeilensperre auf world_instances hält bis zum Commit, ein Rollback gibt die Nummern wieder frei.
-- Mehrere Zeilen einer Anweisung erhalten ihre Nummern in Einfügereihenfolge.
create function world_event_seq() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
  begin
    if new.seq <> 0 then
      raise exception 'world_events: seq vergibt die Datenbank' using errcode = 'check_violation';
    end if;
    update public.world_instances set event_seq = event_seq + 1
     where id = new.instance_id
     returning event_seq into new.seq;
    if not found then
      raise exception 'world_events: unbekannte Instanz %', new.instance_id
        using errcode = 'foreign_key_violation';
    end if;
    return new;
  end
  $$;

create trigger world_events_seq
  before insert on world_events
  for each row execute function world_event_seq();

-- nur anhängen; DELETE bleibt für die Aufbewahrung (7 Tage)
create trigger world_events_append_only
  before update on world_events
  for each row execute function forbid_row_change();
create trigger world_events_no_truncate
  before truncate on world_events
  for each statement execute function forbid_row_change();

-- ---------------------------------------------------------------------------------------------
-- Idempotenzspeicher (API.md §1): Scope ist das Konto der Sitzung beim Eintreffen
-- ---------------------------------------------------------------------------------------------

create table idempotency_keys (
  user_id         uuid not null references users (id) on delete restrict,
  key             uuid not null,
  endpoint        text not null check (length(endpoint) between 1 and 200),
  request_hash    text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_status smallint not null check (response_status between 100 and 599),
  response_body   jsonb not null,
  created_at      timestamptz not null default game_now(),
  primary key (user_id, key)
);
create index idempotency_keys_created on idempotency_keys (created_at);

-- ---------------------------------------------------------------------------------------------
-- NPC-Basisprofile (NPC_SYSTEM §2–3, Werte wie NPC_BASE_PROFILES und garrisonProfile in
-- packages/game-core; ein Integrationstest vergleicht beide). Neutrale Garnisonen außerhalb der
-- Startzone haben je Regionsstufe ein eigenes Profil, weil θ von der Stufe abhängt.
-- rt_log_mu = ln(Median der Antwortzeit in ms), rt_log_sigma = σ von ln t.
-- ---------------------------------------------------------------------------------------------

insert into npc_profiles (id, code, version, skill_theta, estimate_spread, rt_log_mu, rt_log_sigma)
select
  ('00000000-0000-4000-8000-' || lpad(to_hex(p.n), 12, '0'))::uuid,
  p.code, 1, p.theta,
  '{"s0": 1.0, "thetaRef": -0.4, "k": 0.75, "sMin": 0.1, "sMax": 2.0}'::jsonb,
  ln(p.median_ms::numeric), 0.35
from (
  values
    (1, 'GARRISON_START', -2.5, 14000),
    (2, 'LIGHT', -0.4, 12000),
    (3, 'MEDIUM', 0.6, 9000),
    (4, 'HEAVY', 1.7, 6000)
) as p (n, code, theta, median_ms)
union all
select
  ('00000000-0000-4000-8000-' || lpad(to_hex(16 + t), 12, '0'))::uuid,
  'GARRISON_T' || lpad(t::text, 2, '0'), 1,
  round(-1.4 + 1.9 * t / 10.0, 2),
  '{"s0": 1.0, "thetaRef": -0.4, "k": 0.75, "sMin": 0.1, "sMax": 2.0}'::jsonb,
  ln(12000::numeric), 0.35
from generate_series(0, 10) as t;
