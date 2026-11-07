-- Galaxy Survivor M4b-2 (GDD §10.6): the Laboratorio. One row per account and node it has bought (no row: level 0);
-- the tree itself (effects, costs, requirements) is live config (`lab`), and the room's repair is `station.lab`.

create table galaxy.lab_nodes (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  node text not null check (node ~ '^[a-z0-9-]{1,32}$'),
  level smallint not null check (level between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (account_id, node)
);

alter table galaxy.lab_nodes enable row level security;
create policy galaxy_api_all on galaxy.lab_nodes for all to galaxy_api using (true) with check (true);
revoke all on galaxy.lab_nodes from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.lab_nodes to galaxy_api;
