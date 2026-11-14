-- Galaxy Survivor (the owner, 2026-11-14: «trueques: oro, hasta 3 galaxias por lado, contraofertas»). Trades 2.0:
--   * Each side gives up to `market.tradeGalaxies` galaxies (`trade_items`) and, one side at most, coins
--     (`a_coins` / `b_coins`). A galaxy is held (in escrow) while its owner offers it in an open trade (`held`), in one
--     trade at most; the coins a side offers are held like a market offer's (`coin_holds`, kind 'trade',
--     `a_hold` / `b_hold`). What a side only asked of the other is never held.
--   * Every proposal, counter-offer, confirmation and close a player makes is kept (`trade_events`, append-only), the
--     deals as they were (names and tiers included), for the history both sides see.
--   * Whatever closes an open trade (done, cancelled, expired; by a player, an admin, a ban, a revoke or the market
--     job) frees its galaxies and gives coins not spent back, here in the database, on the status change.
--   The trades open today become the same deal in the new shape (their galaxies move to `trade_items`, held as they
--   were), with a first event; the old one-galaxy columns go.

create table galaxy.trade_items (
  trade_id uuid not null references galaxy.trades (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  galaxy_id uuid not null references galaxy.galaxies (id) on delete cascade,
  held boolean not null default false,
  primary key (trade_id, galaxy_id)
);
-- An offered galaxy is held by one open trade at most; a galaxy's trades, for its history and the holds.
create unique index trade_items_held on galaxy.trade_items (galaxy_id) where held;
create index trade_items_galaxy on galaxy.trade_items (galaxy_id);

alter table galaxy.trades
  add column a_coins bigint not null default 0 check (a_coins >= 0),
  add column b_coins bigint not null default 0 check (b_coins >= 0),
  add column a_hold uuid references galaxy.coin_holds (id),
  add column b_hold uuid references galaxy.coin_holds (id),
  -- What the market kept of the coins that changed hands (null when none did).
  add column commission bigint check (commission >= 0),
  add constraint trades_coins_one_side check (a_coins = 0 or b_coins = 0);

-- Today's trades, in the new shape: each galaxy of theirs an item, held when its side offered it in an open trade.
insert into galaxy.trade_items (trade_id, side, galaxy_id, held)
select id, 'a', a_galaxy, status = 'open' and a_offered from galaxy.trades where a_galaxy is not null
union all
select id, 'b', b_galaxy, status = 'open' and b_offered from galaxy.trades where b_galaxy is not null;

create table galaxy.trade_events (
  id bigint generated always as identity primary key,
  trade_id uuid not null references galaxy.trades (id) on delete cascade,
  version integer not null check (version >= 1),
  actor_id uuid references galaxy.accounts (id) on delete set null,
  kind text not null check (kind in ('proposed', 'countered', 'confirmed', 'done', 'cancelled')),
  -- The deal a proposal or a counter-offer made: {a: {galaxies: [{id, name, tier}], coins}, b: {…}}.
  deal jsonb,
  created_at timestamptz not null default now(),
  check ((kind in ('proposed', 'countered')) = (deal is not null))
);
create index trade_events_trade on galaxy.trade_events (trade_id, id);

-- Each trade so far starts its history with its deal as it stands, proposed by its proposer.
insert into galaxy.trade_events (trade_id, version, actor_id, kind, deal, created_at)
select t.id, t.version, t.a_id, 'proposed',
       jsonb_build_object(
         'a', jsonb_build_object('coins', 0, 'galaxies', coalesce((
           select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'tier', g.tier))
             from galaxy.trade_items i join galaxy.galaxies g on g.id = i.galaxy_id
            where i.trade_id = t.id and i.side = 'a'), '[]'::jsonb)),
         'b', jsonb_build_object('coins', 0, 'galaxies', coalesce((
           select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'tier', g.tier))
             from galaxy.trade_items i join galaxy.galaxies g on g.id = i.galaxy_id
            where i.trade_id = t.id and i.side = 'b'), '[]'::jsonb))),
       t.created_at
  from galaxy.trades t;

-- The one-galaxy columns go (with their checks and their unique indexes, now on trade_items).
alter table galaxy.trades drop column a_galaxy, drop column b_galaxy;

-- The open ones the market job ends when they are due.
create index trades_due on galaxy.trades (expires_at) where status = 'open';

-- An open trade that closes, however: its galaxies free, and its coins back unless the swap spent them.
create function galaxy.trade_close() returns trigger language plpgsql set search_path = '' as $$
begin
  update galaxy.trade_items set held = false where trade_id = new.id and held;
  if new.a_hold is not null then
    perform galaxy.release_hold(new.a_hold, 'trade_release', jsonb_build_object('trade', new.id));
  end if;
  if new.b_hold is not null then
    perform galaxy.release_hold(new.b_hold, 'trade_release', jsonb_build_object('trade', new.id));
  end if;
  return null;
end $$;
create trigger trades_close after update of status on galaxy.trades
  for each row when (old.status = 'open' and new.status <> 'open')
  execute function galaxy.trade_close();

alter table galaxy.trade_items enable row level security;
alter table galaxy.trade_events enable row level security;
create policy galaxy_api_all on galaxy.trade_items for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.trade_events for all to galaxy_api using (true) with check (true);
revoke all on galaxy.trade_items, galaxy.trade_events from public, anon, authenticated, service_role;
-- A side's items are replaced when it changes what it gives or asks (the history keeps every deal).
grant select, insert, update, delete on galaxy.trade_items to galaxy_api;
grant select, insert on galaxy.trade_events to galaxy_api;
