-- Galaxy Survivor, open beta: event signals left over when their scanner and their event are over become star dust
-- (the gacha config's `leftoverDust` each). One row per conversion, with the event's name at the time, so the
-- player is told once (seen_at); the ledger keeps both movements under the reason `event_leftover`.
create table galaxy.event_leftovers (
  id bigint generated always as identity primary key,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  currency text not null check (currency ~ '^signal:[a-z0-9-]{1,32}$'),
  label text not null check (length(label) between 1 and 80),
  signals integer not null check (signals > 0),
  dust integer not null check (dust >= 0),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index event_leftovers_unseen on galaxy.event_leftovers (account_id) where seen_at is null;

alter table galaxy.event_leftovers enable row level security;
create policy galaxy_api_all on galaxy.event_leftovers for all to galaxy_api using (true) with check (true);
revoke all on galaxy.event_leftovers from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.event_leftovers to galaxy_api;
