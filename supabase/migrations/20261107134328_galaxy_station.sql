-- Galaxy Survivor M4a (GDD §10, §11): the station. Raw material (from the runs) and components (from the refinery)
-- join the wallet and the ledger; each account keeps the level of its rooms, its refinery's queue (material to
-- refine), its components ready to collect and the clock it has refined up to, and its antenna's clock. Everything
-- else (rates, capacities, costs) is live config, and the refinery and the antenna advance lazily in the server.

alter table galaxy.balances drop constraint balances_currency_check;
alter table galaxy.balances add constraint balances_currency_check
  check (currency ~ '^(coins|dust|signal|signal:[a-z0-9-]{1,32}|material|components)$');
alter table galaxy.ledger drop constraint ledger_currency_check;
alter table galaxy.ledger add constraint ledger_currency_check
  check (currency ~ '^(coins|dust|signal|signal:[a-z0-9-]{1,32}|material|components)$');

create table galaxy.station_rooms (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  room text not null check (room ~ '^[a-z0-9-]{1,32}$'),
  level smallint not null check (level >= 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, room)
);

create table galaxy.refinery (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  queue integer not null default 0 check (queue >= 0),
  ready integer not null default 0 check (ready >= 0),
  clock timestamptz not null default now()
);

create table galaxy.antenna (
  account_id uuid primary key references galaxy.accounts (id) on delete cascade,
  clock timestamptz not null default now()
);

alter table galaxy.station_rooms enable row level security;
alter table galaxy.refinery enable row level security;
alter table galaxy.antenna enable row level security;
create policy galaxy_api_all on galaxy.station_rooms for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.refinery for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.antenna for all to galaxy_api using (true) with check (true);
revoke all on galaxy.station_rooms, galaxy.refinery, galaxy.antenna from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.station_rooms, galaxy.refinery, galaxy.antenna to galaxy_api;
