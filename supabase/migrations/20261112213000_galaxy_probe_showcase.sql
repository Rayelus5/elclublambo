-- Galaxy Survivor, plan «banda sonora, skins, perfil y entorno», part D: the probes a player shows on their profile,
-- up to three, in order, each once. The API checks they are the player's; the profile shows only those still theirs.
create table galaxy.probe_showcase (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  slot smallint not null check (slot between 0 and 2),
  probe text not null check (probe ~ '^[a-z0-9-]{1,32}$'),
  primary key (account_id, slot),
  unique (account_id, probe)
);

alter table galaxy.probe_showcase enable row level security;
create policy galaxy_api_all on galaxy.probe_showcase for all to galaxy_api using (true) with check (true);
revoke all on galaxy.probe_showcase from public, anon, authenticated, service_role;
grant select, insert, update, delete on galaxy.probe_showcase to galaxy_api;
