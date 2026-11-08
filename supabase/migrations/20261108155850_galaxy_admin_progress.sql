-- Galaxy Survivor M6d-4 (GDD §16.2 «Editar todo»): what an admin changes in a player's progress that the game does not
-- keep anywhere else.
--   probe_grants        probes an admin unlocked for the account, on top of what its runs unlock; locking one deletes
--                       the row (the audit log keeps who, when and why).
--   season_adjustments  season points an admin added or took away, added to that season's General ranking. Rows are
--                       only added: a correction is another row, never an edit.

create table galaxy.probe_grants (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  probe text not null check (probe ~ '^[a-z0-9-]{1,32}$'),
  created_at timestamptz not null default now(),
  primary key (account_id, probe)
);

create table galaxy.season_adjustments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  season text not null check (season ~ '^[a-z0-9-]{1,32}$'),
  points int not null check (points <> 0 and points between -1000000 and 1000000),
  created_at timestamptz not null default now()
);
create index season_adjustments_season on galaxy.season_adjustments (season, account_id);
create trigger season_adjustments_append_only before update or delete on galaxy.season_adjustments
  for each row execute function galaxy.forbid_mutation();

alter table galaxy.probe_grants enable row level security;
alter table galaxy.season_adjustments enable row level security;
create policy galaxy_api_all on galaxy.probe_grants for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.season_adjustments for all to galaxy_api using (true) with check (true);

revoke all on galaxy.probe_grants, galaxy.season_adjustments from public, anon, authenticated, service_role;
grant select, insert, delete on galaxy.probe_grants to galaxy_api;
grant select, insert on galaxy.season_adjustments to galaxy_api;
