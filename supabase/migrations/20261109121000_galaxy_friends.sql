-- Galaxy Survivor (multiplayer plan, phase 3): friends, blocks and the privacy of the social side.
--   friendships   one row per pair (a < b): a pending request (who asked in requested_by) or an accepted friendship.
--                 Declining, cancelling or removing deletes the row.
--   blocks        who blocked whom. A block works both ways for everything social: no requests, no invites, no
--                 shared rooms, no presence; blocking also ends a friendship or a pending request between the two.
--   social_prefs  who may invite an account to a room (everyone, its friends and clan, nobody) and whether its
--                 friends see it online. No row: the defaults.

create table galaxy.friendships (
  a uuid not null references galaxy.accounts (id) on delete cascade,
  b uuid not null references galaxy.accounts (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  requested_by uuid not null references galaxy.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (a, b),
  check (a < b),
  check (requested_by = a or requested_by = b),
  check ((status = 'accepted') = (accepted_at is not null))
);
create index friendships_b on galaxy.friendships (b, a);

create table galaxy.blocks (
  blocker uuid not null references galaxy.accounts (id) on delete cascade,
  blocked uuid not null references galaxy.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index blocks_blocked on galaxy.blocks (blocked, blocker);

create table galaxy.social_prefs (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  invites text not null default 'friends' check (invites in ('everyone', 'friends', 'nobody')),
  show_status boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table galaxy.friendships enable row level security;
alter table galaxy.blocks enable row level security;
alter table galaxy.social_prefs enable row level security;
create policy galaxy_api_all on galaxy.friendships for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.blocks for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.social_prefs for all to galaxy_api using (true) with check (true);
revoke all on galaxy.friendships, galaxy.blocks, galaxy.social_prefs from public, anon, authenticated, service_role;
grant select, insert, update, delete on galaxy.friendships, galaxy.blocks to galaxy_api;
grant select, insert, update on galaxy.social_prefs to galaxy_api;
