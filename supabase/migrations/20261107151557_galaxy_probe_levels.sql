-- Galaxy Survivor M4b-1 (GDD §6): probe levels and starting-weapon variants. One row per account and probe that has
-- been levelled or given a variant (no row: level 1 with the base weapon); the bonuses, costs and variants themselves
-- are live config and content. Every run snapshots the upgrades it started with (bonuses and variant), like its relics.

create table galaxy.probe_levels (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  probe text not null check (probe ~ '^[a-z0-9-]{1,32}$'),
  level smallint not null default 1 check (level between 1 and 20),
  variant text check (variant ~ '^[a-z0-9-]{1,32}$'),
  updated_at timestamptz not null default now(),
  primary key (account_id, probe)
);

alter table galaxy.probe_levels enable row level security;
create policy galaxy_api_all on galaxy.probe_levels for all to galaxy_api using (true) with check (true);
revoke all on galaxy.probe_levels from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.probe_levels to galaxy_api;

alter table galaxy.runs add column upgrades jsonb not null default '{}'::jsonb;
