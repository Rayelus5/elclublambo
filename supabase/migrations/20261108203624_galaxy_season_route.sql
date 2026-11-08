-- Galaxy Survivor M7d-1 (GDD §11.1, §13.1): the season route and shop.
--   balances / ledger      a season's currency lives in its own balance, season:<id>, so it starts from zero each season;
--                          once that season has closed, what is left becomes dust.
--   season_route_claims    the route steps an account has collected in a season (once each, by the step's points).
--   season_purchases       how many of each shop item an account has bought in a season (never above its limit).

alter table galaxy.balances drop constraint balances_currency_check;
alter table galaxy.balances add constraint balances_currency_check
  check (currency ~ '^(coins|dust|signal|signal:[a-z0-9-]{1,32}|material|components|season:[a-z0-9-]{1,32})$');
alter table galaxy.ledger drop constraint ledger_currency_check;
alter table galaxy.ledger add constraint ledger_currency_check
  check (currency ~ '^(coins|dust|signal|signal:[a-z0-9-]{1,32}|material|components|season:[a-z0-9-]{1,32})$');

create table galaxy.season_route_claims (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  season text not null check (season ~ '^[a-z0-9-]{1,32}$'),
  step integer not null check (step between 1 and 100000000),
  claimed_at timestamptz not null default now(),
  primary key (account_id, season, step)
);

create table galaxy.season_purchases (
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  season text not null check (season ~ '^[a-z0-9-]{1,32}$'),
  item text not null check (item ~ '^[a-z0-9-]{1,32}$'),
  bought integer not null default 0 check (bought between 0 and 1000),
  updated_at timestamptz not null default now(),
  primary key (account_id, season, item)
);

alter table galaxy.season_route_claims enable row level security;
alter table galaxy.season_purchases enable row level security;
create policy galaxy_api_all on galaxy.season_route_claims for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.season_purchases for all to galaxy_api using (true) with check (true);
revoke all on galaxy.season_route_claims, galaxy.season_purchases from public, anon, authenticated, service_role;
grant select, insert on galaxy.season_route_claims to galaxy_api;
grant select, insert, update on galaxy.season_purchases to galaxy_api;
