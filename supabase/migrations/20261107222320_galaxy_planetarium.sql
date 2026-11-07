-- Galaxy Survivor M4c-2 (GDD §10.5, §14.2): the planetarium. Each account exhibits up to eight galaxies, one per
-- pedestal (the live config `planetarium.slots` says how many it has); an exhibited galaxy is neither fused nor
-- disintegrated (the server answers galaxy_exhibited) and stands on one pedestal at most. Visits are counted once
-- per visitor, owner and UTC day, never one's own.

create table galaxy.exhibits (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  slot smallint not null check (slot between 1 and 8),
  galaxy_id uuid not null unique references galaxy.galaxies (id),
  primary key (account_id, slot)
);

create table galaxy.planetarium_visits (
  owner_id uuid not null references galaxy.accounts (id) on delete cascade,
  visitor_id uuid not null references galaxy.accounts (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  primary key (owner_id, visitor_id, day),
  check (owner_id <> visitor_id)
);

alter table galaxy.exhibits enable row level security;
alter table galaxy.planetarium_visits enable row level security;
create policy galaxy_api_all on galaxy.exhibits for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.planetarium_visits for all to galaxy_api using (true) with check (true);
revoke all on galaxy.exhibits, galaxy.planetarium_visits from public, anon, authenticated, service_role;
grant select, insert, update, delete on galaxy.exhibits to galaxy_api;
grant select, insert on galaxy.planetarium_visits to galaxy_api;
