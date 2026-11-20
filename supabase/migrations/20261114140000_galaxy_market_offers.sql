-- Galaxy Survivor (the owner, 2026-11-14: offers on market listings, «se reserva» the gold). An offer holds the buyer's
-- coins: they leave the balance when it is made (a ledger line) and come back when it ends without a sale (another
-- line), so a balance is always what one can spend. `coin_holds` keeps each hold (offers now, trades' gold next):
-- held, spent (it paid a sale) or released (back to its owner), each change once (`where status = 'held'`).
-- `galaxy.release_hold` gives a hold back with its ledger line; a listing that stops being on sale (sold, withdrawn,
-- expired, cancelled by an admin or by a ban) closes its open offers and gives their coins back in the same statement,
-- whatever path ended it.

create table galaxy.coin_holds (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references galaxy.accounts (id) on delete cascade,
  amount bigint not null check (amount > 0),
  kind text not null check (kind in ('offer', 'trade')),
  status text not null default 'held' check (status in ('held', 'spent', 'released')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'held') = (closed_at is null))
);
create index coin_holds_account on galaxy.coin_holds (account_id) where status = 'held';

create table galaxy.market_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references galaxy.market_listings (id) on delete cascade,
  buyer_id uuid not null references galaxy.accounts (id) on delete cascade,
  amount bigint not null check (amount > 0),
  hold_id uuid not null references galaxy.coin_holds (id),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'outbid', 'expired', 'closed', 'withdrawn')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  check ((status = 'open') = (closed_at is null)),
  check (expires_at > created_at)
);
-- One open offer per buyer and listing; the open ones of a listing by amount; a buyer's; the ones due.
create unique index market_offers_one_open on galaxy.market_offers (listing_id, buyer_id) where status = 'open';
create index market_offers_listing on galaxy.market_offers (listing_id, amount desc, created_at) where status = 'open';
create index market_offers_buyer on galaxy.market_offers (buyer_id, created_at desc);
create index market_offers_due on galaxy.market_offers (expires_at) where status = 'open';

-- Gives a held hold back to its owner, with its ledger line; nothing when it is not held any more. True when it did.
create function galaxy.release_hold(hold uuid, why text, ref jsonb) returns boolean language plpgsql set search_path = '' as $$
declare
  owner uuid;
  coins bigint;
  balance bigint;
begin
  update galaxy.coin_holds set status = 'released', closed_at = now()
   where id = hold and status = 'held'
   returning account_id, amount into owner, coins;
  if owner is null then
    return false;
  end if;
  insert into galaxy.balances (account_id, currency, amount) values (owner, 'coins', coins)
    on conflict (account_id, currency) do update set amount = galaxy.balances.amount + excluded.amount
    returning amount into balance;
  insert into galaxy.ledger (account_id, currency, delta, balance_after, reason, ref)
    values (owner, 'coins', coins, balance, why, ref);
  return true;
end $$;
revoke all on function galaxy.release_hold(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function galaxy.release_hold(uuid, text, jsonb) to galaxy_api;

-- A listing off sale: its open offers close and their coins go back.
create function galaxy.market_listing_offers_close() returns trigger language plpgsql set search_path = '' as $$
declare
  o record;
begin
  for o in
    update galaxy.market_offers set status = 'closed', closed_at = now()
     where listing_id = new.id and status = 'open'
     returning id, hold_id
  loop
    perform galaxy.release_hold(o.hold_id, 'market_offer_release', jsonb_build_object('offer', o.id, 'listing', new.id));
  end loop;
  return null;
end $$;
create trigger market_listings_offers_close after update of status on galaxy.market_listings
  for each row when (old.status = 'active' and new.status <> 'active')
  execute function galaxy.market_listing_offers_close();

alter table galaxy.coin_holds enable row level security;
alter table galaxy.market_offers enable row level security;
create policy galaxy_api_all on galaxy.coin_holds for all to galaxy_api using (true) with check (true);
create policy galaxy_api_all on galaxy.market_offers for all to galaxy_api using (true) with check (true);
revoke all on galaxy.coin_holds, galaxy.market_offers from public, anon, authenticated, service_role;
grant select, insert, update on galaxy.coin_holds to galaxy_api;
grant select, insert, update on galaxy.market_offers to galaxy_api;
