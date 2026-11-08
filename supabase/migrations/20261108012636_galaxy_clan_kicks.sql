-- Galaxy Survivor M5b-1 (final review): an account kicked from a clan cannot join it or ask to again until `until`
-- (live config `clans.kickHours`, 24 by default). Being kicked again moves the date forward; the rows go with the clan
-- or the account.

create table galaxy.clan_kicks (
  clan_id uuid not null references galaxy.clans (id) on delete cascade,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  until timestamptz not null,
  primary key (clan_id, account_id)
);

alter table galaxy.clan_kicks enable row level security;
create policy galaxy_api_all on galaxy.clan_kicks for all to galaxy_api using (true) with check (true);
revoke all on galaxy.clan_kicks from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.clan_kicks to galaxy_api;
