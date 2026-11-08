-- Galaxy Survivor M7d-2 (GDD §13.1): closing a season.
--   season_archive   one row per closed season: its name, dates and how many players it ranked (the hall of fame).
--   season_results   each ranked account's final place, score and tier, with the rewards kept from that close and when
--                    they were collected (once). The podium's results are the station's trophies.

create table galaxy.season_archive (
  season text primary key check (season ~ '^[a-z0-9-]{1,32}$'),
  name text not null check (char_length(name) between 1 and 40),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  players integer not null default 0 check (players >= 0),
  closed_at timestamptz not null default now()
);

create table galaxy.season_results (
  season text not null references galaxy.season_archive (season) on delete cascade,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  rank integer not null check (rank >= 1),
  score integer not null check (score >= 0),
  tier text check (tier is null or tier in ('bronze', 'silver', 'gold', 'platinum', 'stellar')),
  podium boolean not null default false,
  rewards jsonb not null default '[]'::jsonb,
  claimed_at timestamptz,
  primary key (season, account_id)
);
create index season_results_account on galaxy.season_results (account_id);
create index season_results_podium on galaxy.season_results (season, rank) where podium;

alter table galaxy.season_archive enable row level security;
alter table galaxy.season_results enable row level security;
create policy galaxy_api_all on galaxy.season_archive for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.season_results for all to galaxy_api using (true) with check (true);
revoke all on galaxy.season_archive, galaxy.season_results from public, anon, authenticated, service_role;
grant select, insert on galaxy.season_archive to galaxy_api;
grant select, insert, update on galaxy.season_results to galaxy_api;
