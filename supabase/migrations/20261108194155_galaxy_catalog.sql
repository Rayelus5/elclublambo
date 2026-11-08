-- Galaxy Survivor M7b (GDD §12.3): the ECN Catalogue's rewards an account has collected, one row per share of the album
-- (what it has found is read from its galaxies and its pulls).

create table galaxy.catalog_claims (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  percent smallint not null check (percent between 1 and 100),
  claimed_at timestamptz not null default now(),
  primary key (account_id, percent)
);

alter table galaxy.catalog_claims enable row level security;
create policy galaxy_api_all on galaxy.catalog_claims for all to galaxy_api using (true) with check (true);
revoke all on galaxy.catalog_claims from public, anon, authenticated, service_role;
grant select, insert on galaxy.catalog_claims to galaxy_api;
