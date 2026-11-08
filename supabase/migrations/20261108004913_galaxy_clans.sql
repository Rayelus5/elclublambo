-- Galaxy Survivor M5b-1 (GDD §14.3): clans. A clan has a unique name (whatever the case) and a unique tag in capitals,
-- an emblem and a colour; an account belongs to one clan at most, and a clan has exactly one leader while it has
-- members (the server keeps it so; the database refuses a second one). Closed clans keep the requests to join them.

create table galaxy.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 3 and 24),
  tag text not null unique check (tag ~ '^[A-Z0-9]{2,4}$'),
  description text not null default '' check (length(description) <= 140),
  emblem text not null check (emblem ~ '^[a-z]{1,16}$'),
  color text not null check (color ~ '^[a-z]{1,16}$'),
  open boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index clans_name_ci on galaxy.clans (lower(name));

create table galaxy.clan_members (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  clan_id uuid not null references galaxy.clans (id) on delete cascade,
  role text not null check (role in ('leader', 'officer', 'member')),
  joined_at timestamptz not null default now()
);
create index clan_members_clan on galaxy.clan_members (clan_id);
create unique index clan_members_one_leader on galaxy.clan_members (clan_id) where role = 'leader';

create table galaxy.clan_requests (
  clan_id uuid not null references galaxy.clans (id) on delete cascade,
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clan_id, account_id)
);
create index clan_requests_account on galaxy.clan_requests (account_id);

alter table galaxy.clans enable row level security;
alter table galaxy.clan_members enable row level security;
alter table galaxy.clan_requests enable row level security;
create policy galaxy_api_all on galaxy.clans for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.clan_members for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.clan_requests for all to galaxy_api using (true) with check (true);
revoke all on galaxy.clans, galaxy.clan_members, galaxy.clan_requests from public, anon, authenticated, service_role;
grant select, insert, update, delete on galaxy.clans, galaxy.clan_members to galaxy_api;
grant select, insert, delete on galaxy.clan_requests to galaxy_api;
