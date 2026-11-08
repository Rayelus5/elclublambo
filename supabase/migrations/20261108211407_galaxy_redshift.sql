-- Galaxy Survivor M7e-2 (GDD §12.5): the optional prestige «Corrimiento al rojo». One row per account that has taken a
-- rank: the rank (a small permanent bonus and a title each) and when the last one was taken. Taking one restarts the
-- Laboratorio (its nodes are deleted and its room goes back to level 0); the collection is never touched.

create table galaxy.redshift (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  rank integer not null check (rank between 1 and 10),
  updated_at timestamptz not null default now()
);

alter table galaxy.redshift enable row level security;
create policy galaxy_api_all on galaxy.redshift for all to galaxy_api using (true) with check (true);
revoke all on galaxy.redshift from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.redshift to galaxy_api;
