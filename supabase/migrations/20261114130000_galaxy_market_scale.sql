-- Galaxy Survivor (the owner, 2026-11-14: a market «profesional para 100.000 anuncios», with search, filters and public
-- numbers). Each listing keeps a copy of what it is searched and sorted by (rarity, finish, type, palette, phenomenon,
-- level, score, name and designation), taken from its galaxy when it is listed and kept in step if the galaxy's level or
-- name change while it is on sale. The listings on sale have an index for each order and filter, and a trigram one on
-- the words; the market's job (market/jobs.ts) marks what expired and keeps the public numbers in `market_stats`.

create extension if not exists pg_trgm with schema extensions;

alter table galaxy.market_listings
  add column tier smallint,
  add column finish text,
  add column galaxy_type text,
  add column palette text,
  add column phenomenon text,
  add column level smallint,
  add column score real,
  add column search text;

create function galaxy.market_listing_copy() returns trigger language plpgsql set search_path = '' as $$
begin
  select g.tier, g.finish, g.traits ->> 'galaxy_type', g.traits ->> 'palette', coalesce(g.traits ->> 'phenomenon', 'none'), g.level, g.score,
         lower(g.name || ' ' || g.designation)
    into new.tier, new.finish, new.galaxy_type, new.palette, new.phenomenon, new.level, new.score, new.search
    from galaxy.galaxies g
   where g.id = new.galaxy_id;
  return new;
end $$;
create trigger market_listings_copy before insert on galaxy.market_listings for each row execute function galaxy.market_listing_copy();

-- A galaxy levelled up or renamed while on sale: its listing says so.
create function galaxy.market_listing_follow() returns trigger language plpgsql set search_path = '' as $$
begin
  update galaxy.market_listings
     set level = new.level, search = lower(new.name || ' ' || new.designation)
   where galaxy_id = new.id and status = 'active';
  return null;
end $$;
create trigger galaxies_market_follow after update of level, name on galaxy.galaxies
  for each row when (old.level is distinct from new.level or old.name is distinct from new.name)
  execute function galaxy.market_listing_follow();

update galaxy.market_listings m
   set tier = g.tier, finish = g.finish, galaxy_type = g.traits ->> 'galaxy_type', palette = g.traits ->> 'palette',
       phenomenon = coalesce(g.traits ->> 'phenomenon', 'none'), level = g.level, score = g.score,
       search = lower(g.name || ' ' || g.designation)
  from galaxy.galaxies g
 where g.id = m.galaxy_id;

-- The orders, on the listings on sale (each with its id last, the keyset's tie-break).
drop index if exists galaxy.market_listings_browse;
create index market_listings_new on galaxy.market_listings (listed_at desc, id desc) where status = 'active';
create index market_listings_ending on galaxy.market_listings (expires_at, id) where status = 'active';
create index market_listings_rare on galaxy.market_listings (tier desc, score desc, id desc) where status = 'active';
create index market_listings_level on galaxy.market_listings (level desc, id desc) where status = 'active';
-- A rarity chosen: newest and by price within it.
create index market_listings_tier_new on galaxy.market_listings (tier, listed_at desc, id desc) where status = 'active';
create index market_listings_tier_price on galaxy.market_listings (tier, price, id) where status = 'active';
create index market_listings_search on galaxy.market_listings using gin (search extensions.gin_trgm_ops) where status = 'active';
-- What the job marks as expired.
create index market_listings_due on galaxy.market_listings (expires_at) where status = 'active';
-- The sales of the last days, for the public numbers.
create index market_listings_sold on galaxy.market_listings (sold_at desc) where status = 'sold';

-- The public numbers, one row, rewritten by the job.
create table galaxy.market_stats (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table galaxy.market_stats enable row level security;
create policy galaxy_api_all on galaxy.market_stats for all to galaxy_api using (true) with check (true);
revoke all on galaxy.market_stats from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.market_stats to galaxy_api;
