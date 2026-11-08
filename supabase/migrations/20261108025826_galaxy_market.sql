-- Galaxy Survivor M5c-1 (GDD §14.6, §14.7): the market of galaxies and the trade alerts.
--   market_listings  a galaxy for sale (in escrow while active), sold once, withdrawn or expired. One active listing per
--                    galaxy. Rows are never deleted: they are the market's history.
--   market_min_price the price is at least the floor of the galaxy's rarity, read from the live config `market`
--                    (data.minPrice), or the GDD's defaults while that key was never published.
--   trade_alerts     sales the admin should look at (an IP shared by buyer and seller, a price far above the floor);
--                    shown by the admin panel (M6).

create table galaxy.market_listings (
  id uuid primary key default gen_random_uuid(),
  galaxy_id uuid not null references galaxy.galaxies (id) on delete cascade,
  seller_id uuid not null references galaxy.accounts (id) on delete cascade,
  price bigint not null check (price > 0),
  listed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled', 'expired')),
  buyer_id uuid references galaxy.accounts (id) on delete set null,
  sold_at timestamptz,
  commission bigint check (commission >= 0),
  check ((status = 'sold') = (sold_at is not null and commission is not null)),
  check (expires_at > listed_at)
);
create unique index market_listings_one_active on galaxy.market_listings (galaxy_id) where status = 'active';
create index market_listings_browse on galaxy.market_listings (listed_at desc, id) where status = 'active';
create index market_listings_price on galaxy.market_listings (price, id) where status = 'active';
create index market_listings_seller on galaxy.market_listings (seller_id, listed_at desc);
create index market_listings_buyer on galaxy.market_listings (buyer_id, sold_at desc) where status = 'sold';

create function galaxy.market_min_price() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  tier_name text;
  floor_price bigint;
begin
  select (array['common', 'uncommon', 'rare', 'epic', 'legendary'])[g.tier + 1] into tier_name
  from galaxy.galaxies g where g.id = new.galaxy_id;
  select (a.data -> 'minPrice' ->> tier_name)::bigint into floor_price
  from galaxy.game_config_active a where a.key = 'market';
  floor_price := coalesce(floor_price, case tier_name
    when 'common' then 50 when 'uncommon' then 120 when 'rare' then 400 when 'epic' then 1500 else 6000 end);
  if new.price < floor_price then
    raise exception 'price % under the % floor %', new.price, tier_name, floor_price using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function galaxy.market_min_price() from public, anon, authenticated, service_role;
create trigger market_listings_min_price
  before insert or update of price on galaxy.market_listings
  for each row execute function galaxy.market_min_price();

create table galaxy.trade_alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('shared_ip', 'unbalanced')),
  listing_id uuid references galaxy.market_listings (id) on delete set null,
  seller_id uuid references galaxy.accounts (id) on delete set null,
  buyer_id uuid references galaxy.accounts (id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index trade_alerts_time on galaxy.trade_alerts (created_at desc);

alter table galaxy.market_listings enable row level security;
alter table galaxy.trade_alerts enable row level security;
create policy galaxy_api_all on galaxy.market_listings for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.trade_alerts for all to galaxy_api using (true) with check (true);
revoke all on galaxy.market_listings, galaxy.trade_alerts from public, anon, authenticated, service_role;
revoke all on sequence galaxy.trade_alerts_id_seq from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.market_listings to galaxy_api;
grant select, insert on galaxy.trade_alerts to galaxy_api;
grant usage on sequence galaxy.trade_alerts_id_seq to galaxy_api;
