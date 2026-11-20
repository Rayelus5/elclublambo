-- Galaxy Survivor (plan «ajustes en la cuenta»): the player's settings — sound, image, accessibility, the game, and the
-- last release note seen — kept with the account, so every device shows the same. One row per account, its fields as
-- the API checked them (packages/shared accountSettingsSchema); none until the first save. Deleting a player drops it.

create table galaxy.settings (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table galaxy.settings enable row level security;
create policy galaxy_api_all on galaxy.settings for all to galaxy_api using (true) with check (true);
revoke all on galaxy.settings from public, anon, authenticated, service_role;
grant select, insert, update, delete on galaxy.settings to galaxy_api;
