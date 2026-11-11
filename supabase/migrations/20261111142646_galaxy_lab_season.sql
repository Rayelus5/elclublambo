-- Galaxy Survivor, the Laboratorio's seasonal core (shop and lab plan, F2a): one row per account, season and node it
-- has bought (no row: level 0). The levels are kept by season id, so a new season starts the tree empty and the past
-- ones stay as history; the prestige («Corrimiento al rojo») still wipes only galaxy.lab_nodes. The tree itself is the
-- live config's `lab.season`.

create table galaxy.lab_season_nodes (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  season text not null check (season ~ '^[a-z0-9-]{1,32}$'),
  node text not null check (node ~ '^[a-z0-9-]{1,32}$'),
  level smallint not null check (level between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (account_id, season, node)
);

alter table galaxy.lab_season_nodes enable row level security;
create policy galaxy_api_all on galaxy.lab_season_nodes for all to galaxy_api using (true) with check (true);
revoke all on galaxy.lab_season_nodes from public, anon, authenticated, service_role;
grant select, insert, update, delete on galaxy.lab_season_nodes to galaxy_api;
