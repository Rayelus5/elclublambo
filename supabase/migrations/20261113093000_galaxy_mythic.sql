-- Galaxy Survivor, plan «rareza Mítica» M1: the sixth galaxy tier, «Mítica» (tier 5), above the legendary. Only the
-- deep scan's own mythic draw gives one (its chance is live config, 0 until the owner publishes it), so the tables
-- only have to accept the new code; nothing already stored changes.
--   galaxies, gacha_pulls  the tier check reaches 5.
--   market_min_price       a mythic's floor is minPrice.mythic, or the legendary's in a market config published
--                          before the mythic, or 15000 while that key was never published. Whether a mythic may be
--                          listed at all is the API's rule (market.mythicListing).

alter table galaxy.galaxies drop constraint galaxies_tier_check;
alter table galaxy.galaxies add constraint galaxies_tier_check check (tier between 0 and 5);
alter table galaxy.gacha_pulls drop constraint gacha_pulls_tier_check;
alter table galaxy.gacha_pulls add constraint gacha_pulls_tier_check check (tier between 0 and 5);

create or replace function galaxy.market_min_price() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  tier_name text;
  floor_price bigint;
  prices jsonb;
begin
  select (array['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'])[g.tier + 1] into tier_name
  from galaxy.galaxies g where g.id = new.galaxy_id;
  select a.data -> 'minPrice' into prices
  from galaxy.game_config_active a where a.key = 'market';
  floor_price := (prices ->> tier_name)::bigint;
  if floor_price is null and tier_name = 'mythic' then
    floor_price := (prices ->> 'legendary')::bigint;
  end if;
  floor_price := coalesce(floor_price, case tier_name
    when 'common' then 50 when 'uncommon' then 120 when 'rare' then 400 when 'epic' then 1500 when 'legendary' then 6000
    else 15000 end);
  if new.price < floor_price then
    raise exception 'price % under the % floor %', new.price, tier_name, floor_price using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function galaxy.market_min_price() from public, anon, authenticated, service_role;
