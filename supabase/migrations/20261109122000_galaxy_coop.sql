-- Galaxy Survivor (multiplayer plan, phase 6): co-op runs.
--   coop_runs        one row per run a room launched: its room, seed, sector, anomaly, the co-op rules and every
--                    player's snapshotted probe (the referee and the replayer rebuild the run from them), how it is
--                    going (running → ended, or interrupted by a server restart) and how it ended.
--   coop_run_inputs  the run's sealed inputs (packages/sim log v2, ≤ 4 MB), rewritten every few seconds while it runs
--                    so a restart can settle it from the last tick saved.
--   runs             each player keeps its own row (missions, season and leaderboards read those): which co-op run
--                    and place it was, how many started it, and the factor on its season points.

create table galaxy.coop_runs (
  id uuid primary key default gen_random_uuid(),
  room_code text not null check (room_code ~ '^[A-Z0-9]{6}$'),
  kind text not null check (kind in ('public', 'friends', 'private')),
  leader_id uuid references galaxy.accounts (id) on delete set null,
  sector text not null check (sector ~ '^[a-z0-9-]{1,32}$'),
  seed numeric(20, 0) not null,
  anomaly text,
  rules jsonb not null,
  players jsonb not null,
  content_version int not null,
  sim_version text not null,
  state text not null default 'running' check (state in ('running', 'ended', 'interrupted')),
  outcome text check (outcome in ('extracted', 'died', 'interrupted')),
  ticks int,
  depth int,
  boss_kills int,
  hash text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((state = 'running') = (ended_at is null))
);
create index coop_runs_running on galaxy.coop_runs (started_at) where state = 'running';

create table galaxy.coop_run_inputs (
  coop_run_id uuid primary key references galaxy.coop_runs (id) on delete cascade,
  inputs bytea not null check (octet_length(inputs) <= 4000000),
  ticks int not null default 0 check (ticks >= 0),
  updated_at timestamptz not null default now()
);

alter table galaxy.runs
  add column coop_run_id uuid references galaxy.coop_runs (id) on delete set null,
  add column slot smallint check (slot between 0 and 3),
  add column party_size smallint not null default 1 check (party_size between 1 and 4),
  add column points_factor real not null default 1 check (points_factor >= 0 and points_factor <= 2),
  add constraint runs_coop_slot check ((coop_run_id is null) = (slot is null));
create unique index runs_coop_slot_unique on galaxy.runs (coop_run_id, slot) where coop_run_id is not null;

alter table galaxy.coop_runs enable row level security;
alter table galaxy.coop_run_inputs enable row level security;
create policy galaxy_api_all on galaxy.coop_runs for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.coop_run_inputs for all to galaxy_api using (true) with check (true);
revoke all on galaxy.coop_runs, galaxy.coop_run_inputs from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.coop_runs to galaxy_api;
grant select, insert, update on galaxy.coop_run_inputs to galaxy_api;
