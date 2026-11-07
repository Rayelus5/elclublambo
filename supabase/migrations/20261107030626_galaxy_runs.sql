-- Galaxy Survivor M3a (GDD §5.1, §8.4, §11.3 bis, §14.7, §18.5): the hangar and the runs.
--
--   hangars     per account: the chosen probe and how many relic slots are open (2 at first, up to 6).
--   loadouts    the galaxies equipped as relics, one per slot; a galaxy sits in one slot at most.
--   runs        one row per run: the server's seed, the relic snapshot and the content version it started with; finished
--               once (outcome, summary, payout, plausibility flags) and never rewritten or deleted afterwards.
--   run_inputs  the run's recorded inputs (packages/sim log, ≤ 2 MB) for replays; only added. Retention: M5.
--   run_days    run time per account and Madrid day, behind the daily yield.

create table galaxy.hangars (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  probe text not null default 'lumen' check (probe ~ '^[a-z0-9-]{1,32}$'),
  relic_slots smallint not null default 2 check (relic_slots between 2 and 6),
  updated_at timestamptz not null default now()
);

create table galaxy.loadouts (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  slot smallint not null check (slot between 0 and 5),
  galaxy_id uuid not null unique references galaxy.galaxies (id),
  primary key (account_id, slot)
);

create table galaxy.runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  seed numeric(20, 0) not null check (seed >= 0 and seed < 18446744073709551616),
  sector text not null check (sector ~ '^[a-z0-9-]{1,32}$'),
  probe text not null check (probe ~ '^[a-z0-9-]{1,32}$'),
  relics jsonb not null check (jsonb_typeof(relics) = 'array'),
  content_version int not null check (content_version >= 0),
  sim_version text not null check (length(sim_version) between 1 and 20),
  start_key text not null check (length(start_key) between 8 and 80),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome in ('extracted', 'died', 'abandoned')),
  ticks int check (ticks >= 0),
  depth smallint check (depth >= 1),
  kills int check (kills >= 0),
  boss_kills int check (boss_kills >= 0),
  level smallint check (level >= 1),
  seconds int check (seconds >= 0),
  hash text check (hash ~ '^[0-9a-f]{16}$'),
  payout jsonb,
  runs_version int,
  flags text[] not null default '{}',
  suspicious boolean not null default false,
  check ((finished_at is null) = (outcome is null))
);
create index runs_account_time on galaxy.runs (account_id, started_at desc);

create function galaxy.runs_finish_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.finished_at is not null then
    raise exception 'run_finished';
  end if;
  return new;
end;
$$;
revoke all on function galaxy.runs_finish_once() from public, anon, authenticated, service_role;

create trigger runs_finish_once before update on galaxy.runs
  for each row execute function galaxy.runs_finish_once();
create trigger runs_no_delete before delete on galaxy.runs
  for each row execute function galaxy.forbid_mutation();

create table galaxy.run_inputs (
  run_id uuid primary key references galaxy.runs (id) on delete cascade,
  inputs bytea not null check (octet_length(inputs) <= 2000000),
  created_at timestamptz not null default now()
);
create trigger run_inputs_append_only before update or delete on galaxy.run_inputs
  for each row execute function galaxy.forbid_mutation();

create table galaxy.run_days (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  day date not null,
  seconds int not null default 0 check (seconds >= 0),
  primary key (account_id, day)
);

alter table galaxy.hangars enable row level security;
alter table galaxy.loadouts enable row level security;
alter table galaxy.runs enable row level security;
alter table galaxy.run_inputs enable row level security;
alter table galaxy.run_days enable row level security;
create policy galaxy_api_all on galaxy.hangars for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.loadouts for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.runs for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.run_inputs for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.run_days for all to galaxy_api using (true) with check (true);

revoke all on galaxy.hangars, galaxy.loadouts, galaxy.runs, galaxy.run_inputs, galaxy.run_days
  from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.hangars to galaxy_api;
grant select, insert, update, delete on galaxy.loadouts to galaxy_api;
grant select, insert, update on galaxy.runs to galaxy_api;
grant select, insert on galaxy.run_inputs to galaxy_api;
grant select, insert, update on galaxy.run_days to galaxy_api;
