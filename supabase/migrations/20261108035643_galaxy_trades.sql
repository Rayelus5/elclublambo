-- Galaxy Survivor M5c-2 (GDD §14.5, §14.7): swaps of one galaxy for one galaxy between two accounts.
--   a_* is the side that proposed, b_* the other. Each side gives one galaxy (a_galaxy, b_galaxy). A galaxy is held
--   (in escrow) only when its owner offers it (*_offered): the proposer's from the start, the other's once its owner
--   puts it or agrees to it. A galaxy the other side only asked for is not held, so nobody can freeze someone else's.
--   Every change bumps `version` and clears both confirmations; the swap runs when both confirmed the same version.
--   Rows are never deleted. An open trade past expires_at counts as expired (no job), like a market listing.
create table galaxy.trades (
  id uuid primary key default gen_random_uuid(),
  version integer not null default 1 check (version >= 1),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled', 'expired')),
  a_id uuid not null references galaxy.accounts (id) on delete cascade,
  b_id uuid not null references galaxy.accounts (id) on delete cascade,
  a_galaxy uuid references galaxy.galaxies (id) on delete cascade,
  b_galaxy uuid references galaxy.galaxies (id) on delete cascade,
  a_offered boolean not null default false,
  b_offered boolean not null default false,
  a_confirmed boolean not null default false,
  b_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  check (a_id <> b_id),
  check (expires_at > created_at),
  check (not a_offered or a_galaxy is not null),
  check (not b_offered or b_galaxy is not null),
  check (not a_confirmed or a_offered),
  check (not b_confirmed or b_offered),
  check (status <> 'done' or (a_confirmed and b_confirmed and closed_at is not null)),
  check ((status = 'open') = (closed_at is null))
);
create unique index trades_a_offered_open on galaxy.trades (a_galaxy) where status = 'open' and a_offered;
create unique index trades_b_offered_open on galaxy.trades (b_galaxy) where status = 'open' and b_offered;
create index trades_a on galaxy.trades (a_id, created_at desc);
create index trades_b on galaxy.trades (b_id, created_at desc);

alter table galaxy.trade_alerts add column trade_id uuid references galaxy.trades (id) on delete set null;

alter table galaxy.trades enable row level security;
create policy galaxy_api_all on galaxy.trades for all to galaxy_api using (true) with check (true);
revoke all on galaxy.trades from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.trades to galaxy_api;
