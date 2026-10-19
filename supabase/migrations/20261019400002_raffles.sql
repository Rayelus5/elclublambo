-- F4d Task 2: raffles with a private seed commitment, the weighted switch per network, create / cancel as fund
-- liabilities, and prize liabilities valued at the caller's ETH price (my decision 1).
--
--   raffles / raffle_entries  RLS on, no client access; every write goes through definer RPCs.
--   private.raffle_seeds      the secret seed (32 bytes from gen_random_bytes). Schema private is usable by no API role
--                             (anon, authenticated, service_role): only definer functions owned by postgres touch it.
--                             Only keccak256(seed) is published (raffles.seed_commit); the seed is revealed at the draw
--                             (Task 3) and deleted, unrevealed, on cancel.
--   Liabilities               _dao_liabilities_usd6(chain, block, eth_price_e8 default null) also counts the prizes of
--                             open / closed / drawn raffles until their payout (block-bounded: payout_block > B), USDC
--                             as is and WETH at floor(amount * price / 10^20), price = the caller's, else the chain's
--                             latest snapshot, else 0. F4c-R7 carried over: a drawn prize whose linked payout candidate
--                             is at or before B is paid for valuation, and a drawn, unpaid prize caps valuations at the
--                             scan cursor (_dao_assets_covered / dao_valuation_cap), exactly like an approved withdrawal.
--   Cached NAV                create lowers dao_state.value_usdc by prize_value_usd6 in the same transaction; cancel
--                             (and void, Task 3) adds it back; payout recording and finality do not touch it. A fresh
--                             valuation then gives the cached value: the share price never jumps for the other holders.
--   Price passthrough         credit_donation, record_nav_snapshot, _withdrawal_valuation, quote_withdrawal and
--                             approve_withdrawal pass an ETH price to the liabilities (trailing default null keeps every
--                             existing caller valid).
--   Switch                    chain_config.weighted_raffles_enabled (default off, on for 59141), bit 512 only; it gates
--                             creating weighted raffles only. app_config.weighted_raffles_enabled stays, unused.
-- Lock order: raffle row (for update) -> chain_config (for share) -> dao_state (for update) -> dao_positions.

-- ===== schema =====
create table public.raffles (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null check (chain_id in (59144, 59141)),
  title text not null check (title = btrim(title) and char_length(title) between 1 and 80),
  prize_token text not null check (prize_token in ('USDC', 'WETH')),
  prize_amount numeric(78, 0) not null check (prize_amount > 0),
  prize_value_usd6 numeric(78, 0) not null check (prize_value_usd6 >= 0),
  mode text not null check (mode in ('equal', 'weighted')),
  closes_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed', 'drawn', 'paid', 'cancelled', 'void')),
  seed_commit text not null check (seed_commit ~ '^0x[0-9a-f]{64}$'),
  seed_reveal text check (seed_reveal is null or seed_reveal ~ '^0x[0-9a-f]{64}$'),
  closed_at timestamptz,
  total_weight numeric(78, 0) check (total_weight is null or total_weight >= 0),
  draw_block_number bigint check (draw_block_number is null or draw_block_number >= 0),
  draw_block_hash text check (draw_block_hash is null or draw_block_hash ~ '^0x[0-9a-f]{64}$'),
  draw_block_time timestamptz,
  draw_random text,
  winner_position int check (winner_position is null or winner_position >= 1),
  winner_member_id uuid references public.members (id),
  winner_address text check (winner_address is null or winner_address ~ '^0x[0-9a-f]{40}$'),
  drawn_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.members (id),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 1 and 280),
  payout_tx_hash text check (payout_tx_hash is null or payout_tx_hash ~ '^0x[0-9a-f]{64}$'),
  payout_log_index int check (payout_log_index is null or payout_log_index >= 0),
  payout_block bigint check (payout_block is null or payout_block >= 0),
  payout_block_time timestamptz,
  payout_amount numeric(78, 0) check (payout_amount is null or payout_amount > 0),
  payout_recorded_at timestamptz,
  payout_recorded_by uuid references public.members (id), -- null: detected by the cron
  payout_missing_since timestamptz,
  paid_at timestamptz,
  unpaid_notified_at timestamptz,
  created_by uuid not null references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raffles_drawn_coherent check (
    (status in ('drawn', 'paid'))
    = (winner_member_id is not null and winner_address is not null and drawn_at is not null and draw_block_hash is not null)),
  constraint raffles_reveal_coherent check ((seed_reveal is not null) = (status in ('drawn', 'paid', 'void'))),
  constraint raffles_cancel_coherent check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint raffles_payout_coherent check (
    (payout_tx_hash is null and payout_log_index is null and payout_block is null and payout_block_time is null
       and payout_amount is null and payout_recorded_at is null)
    or (payout_tx_hash is not null and payout_log_index is not null and payout_block is not null
        and payout_block_time is not null and payout_amount is not null and payout_recorded_at is not null
        and status in ('drawn', 'paid'))),
  constraint raffles_paid_coherent check ((status = 'paid') = (paid_at is not null)),
  constraint raffles_paid_has_payout check (status <> 'paid' or payout_tx_hash is not null)
);
create index raffles_chain_status_idx on public.raffles (chain_id, status, closes_at);
create unique index raffles_payout_uidx on public.raffles (chain_id, payout_tx_hash, payout_log_index)
  where payout_tx_hash is not null;
create index raffles_payout_block_idx on public.raffles (chain_id, payout_block) where status in ('drawn', 'paid');

create table public.raffle_entries (
  raffle_id uuid not null references public.raffles (id) on delete cascade,
  member_id uuid not null references public.members (id),
  entered_at timestamptz not null default now(),
  position int check (position is null or position >= 1),
  weight numeric(78, 0) check (weight is null or weight >= 0),
  primary key (raffle_id, member_id)
);
create unique index raffle_entries_position_uidx on public.raffle_entries (raffle_id, position) where position is not null;
create index raffle_entries_member_idx on public.raffle_entries (member_id);

alter table public.raffles enable row level security;
alter table public.raffle_entries enable row level security;
revoke all on public.raffles, public.raffle_entries from public, anon, authenticated;

-- ===== the secret seed: a schema no API role can use =====
create schema private;
revoke all on schema private from public, anon, authenticated, service_role;
-- defence in depth: whatever is created in private later starts with no API grant either
alter default privileges in schema private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema private revoke all on functions from public, anon, authenticated, service_role;

create table private.raffle_seeds (
  raffle_id uuid primary key references public.raffles (id) on delete cascade,
  seed bytea not null check (length(seed) = 32)
);
revoke all on private.raffle_seeds from public, anon, authenticated, service_role;

-- an outflow pays a withdrawal or a prize, never both (filled by the scan in Task 4)
alter table public.dao_safe_operations
  add column raffle_id uuid references public.raffles (id),
  add constraint dao_safe_operations_one_link check (withdrawal_id is null or raffle_id is null);
create index dao_safe_operations_raffle_idx on public.dao_safe_operations (raffle_id) where raffle_id is not null;

-- ===== the weighted switch per network =====
alter table public.chain_config add column weighted_raffles_enabled boolean not null default false;
update public.chain_config set weighted_raffles_enabled = true where chain_id = 59141;

-- ===== notification kinds: the list from 20261019300002 + raffle_won =====
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention', 'reply', 'channel_message',
  'invite_redeemed', 'godchild_banned', 'sponsor_penalized',
  'report_new', 'member_review',
  'ticket_new', 'ticket_reply', 'ticket_status',
  'tip_received', 'bounty_solution', 'bounty_paid',
  'treasury_mismatch', 'treasury_outflow',
  'withdrawal_approved', 'withdrawal_rejected', 'withdrawal_paid', 'withdrawal_expired', 'treasury_notice',
  'raffle_won'
));

-- ===== realtime: broadcast_dao_event (latest 20261019300002) + raffles and raffle_entries branches =====
create or replace function public.broadcast_dao_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chain int;
begin
  if tg_table_name = 'dao_state' then
    if new.total_shares is not distinct from old.total_shares and new.value_usdc is not distinct from old.value_usdc then
      return null;
    end if;
    v_chain := new.chain_id;
  elsif tg_table_name = 'dao_ledger' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      return null;
    end if;
    v_chain := new.chain_id;
  elsif tg_table_name = 'withdrawal_requests' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      return null;
    end if;
    v_chain := new.chain_id;
  elsif tg_table_name = 'raffles' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      return null;
    end if;
    v_chain := new.chain_id;
  elsif tg_table_name = 'raffle_entries' then
    -- insert or delete (new is null on delete); a raffle deleted with its entries has nothing left to show
    select r.chain_id into v_chain from public.raffles r
    where r.id = coalesce(case when tg_op = 'DELETE' then null else new.raffle_id end, old.raffle_id);
    if v_chain is null then
      return null;
    end if;
  else -- members: only the ranking opt-in matters; the active chain is the one the page shows
    if new.dao_ranking_visible is not distinct from old.dao_ranking_visible then
      return null;
    end if;
    select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  end if;

  perform realtime.send(jsonb_build_object('chain_id', v_chain), 'dao_changed', 'dao', true);
  return null;
end;
$$;

revoke execute on function public.broadcast_dao_event() from public, anon, authenticated, service_role;

create trigger raffles_broadcast after insert or update of status on public.raffles
  for each row execute function public.broadcast_dao_event();
create trigger raffle_entries_broadcast after insert or delete on public.raffle_entries
  for each row execute function public.broadcast_dao_event();

-- ===== _raffle_prize_owed (internal) =====
-- Whether raffle r's prize is still owed in a valuation at block p_at_block (null: the read path). Read path: not paid
-- and no payout recorded. At a block: until its payout block, and a drawn prize whose linked payout candidate (Task 4
-- links them: the prize token, out, at or after drawn_at - 120 s) is at or before the block is paid (F4c-R7 b).
create function public._raffle_prize_owed(r public.raffles, p_at_block bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_at_block is null and r.status in ('open', 'closed', 'drawn') and r.payout_tx_hash is null)
      or (p_at_block is not null and r.status in ('open', 'closed', 'drawn', 'paid')
          and (r.payout_block is null or r.payout_block > p_at_block)
          and not (r.status = 'drawn' and r.payout_tx_hash is null and exists (
            select 1 from public.dao_safe_operations o
            where o.raffle_id = r.id and o.chain_id = r.chain_id
              and o.asset = r.prize_token and o.direction = 'out'
              and o.block_number <= p_at_block
              and o.occurred_at >= r.drawn_at - interval '120 seconds')))
$$;
revoke execute on function public._raffle_prize_owed(public.raffles, bigint) from public, anon, authenticated, service_role;

-- ===== _dao_liabilities_usd6 (latest 20261019300007) + prizes, valued at the caller's ETH price =====
-- A prize counts while _raffle_prize_owed says so; USDC as is, WETH at floor(amount * price / 10^20), each prize floored
-- on its own. No CASE in the body: 954 pins the withdrawal filter as a plain OR under a top-level status filter.
drop function public._dao_liabilities_usd6(int, bigint);
create function public._dao_liabilities_usd6(p_chain int, p_at_block bigint, p_eth_price_e8 numeric default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(l.amount_usdc)
                   from public.dao_ledger l
                   where l.chain_id = p_chain and l.status = 'pending_finality'
                     and (p_at_block is null or l.block_number <= p_at_block)), 0)
       + coalesce((select sum(w.amount_usdc_locked)
                   from public.withdrawal_requests w
                   where w.chain_id = p_chain
                     and w.status in ('approved', 'paid')
                     and ((p_at_block is null and w.status = 'approved' and w.payout_tx_hash is null)
                          or (p_at_block is not null and (w.payout_block is null or w.payout_block > p_at_block)
                              and not (w.payout_tx_hash is null and exists (
                                select 1 from public.dao_safe_operations o
                                where o.withdrawal_id = w.id and o.chain_id = p_chain
                                  and o.asset = 'USDC' and o.direction = 'out'
                                  and o.block_number <= p_at_block
                                  and o.occurred_at between w.approved_at - interval '120 seconds'
                                                        and w.approved_at + interval '14 days'))))), 0)
       + coalesce((select sum(r.prize_amount)
                   from public.raffles r
                   where r.chain_id = p_chain and r.prize_token = 'USDC'
                     and r.status in ('open', 'closed', 'drawn', 'paid')
                     and public._raffle_prize_owed(r, p_at_block)), 0)
       + coalesce((select sum(div(r.prize_amount * px.price, 100000000000000000000))
                   from public.raffles r
                   cross join (select coalesce(p_eth_price_e8,
                                               (select n.eth_price_e8 from public.dao_nav_snapshots n
                                                where n.chain_id = p_chain
                                                order by n.taken_at desc limit 1),
                                               0) as price) px
                   where r.chain_id = p_chain and r.prize_token = 'WETH'
                     and r.status in ('open', 'closed', 'drawn', 'paid')
                     and public._raffle_prize_owed(r, p_at_block)), 0)
$$;

revoke execute on function public._dao_liabilities_usd6(int, bigint, numeric) from public, anon, authenticated, service_role;
grant execute on function public._dao_liabilities_usd6(int, bigint, numeric) to service_role;

-- ===== F4c-R7 (a) (latest 20261019300007): a drawn, unpaid prize also needs a Safe read the scan has covered =====
create or replace function public._dao_assets_covered(p_chain int, p_block bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (not exists (select 1 from public.withdrawal_requests w
                      where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null)
          and not exists (select 1 from public.raffles r
                          where r.chain_id = p_chain and r.status = 'drawn' and r.payout_tx_hash is null))
      or coalesce((select s.last_block from public.dao_scan_state s where s.chain_id = p_chain), -1) >= p_block
$$;

create or replace function public.dao_valuation_cap(p_chain int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'capped', exists (select 1 from public.withdrawal_requests w
                      where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null)
              or exists (select 1 from public.raffles r
                         where r.chain_id = p_chain and r.status = 'drawn' and r.payout_tx_hash is null),
    'block', (select s.last_block::text from public.dao_scan_state s where s.chain_id = p_chain))
$$;

-- ===== credit_donation (latest 20261019300007) + p_eth_price_e8, passed to the liabilities =====
drop function public.credit_donation(uuid, numeric, bigint);
create function public.credit_donation(p_ledger uuid, p_assets_usd6 numeric, p_assets_block bigint,
                                       p_eth_price_e8 numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.dao_ledger;
  s public.dao_state;
  v_nav numeric;
  v_total numeric;
  v_club numeric := 0;
  v_shares numeric;
begin
  if p_assets_usd6 is null or p_assets_usd6 < 0 or p_assets_usd6 <> trunc(p_assets_usd6)
     or p_assets_block is null or p_assets_block < 0
     or (p_eth_price_e8 is not null and (p_eth_price_e8 < 0 or p_eth_price_e8 <> trunc(p_eth_price_e8))) then
    raise exception 'invalid_input';
  end if;

  select * into l from public.dao_ledger x where x.id = p_ledger for update;
  if not found then
    raise exception 'not_found';
  end if;
  if l.status = 'credited' then
    return jsonb_build_object('shares', l.shares_delta::text, 'clubMinted', '0');
  end if;
  if l.status <> 'pending_finality' then
    raise exception 'invalid_state';
  end if;
  if l.block_number > p_assets_block then
    raise exception 'assets_stale';
  end if;

  select * into s from public.dao_state x where x.chain_id = l.chain_id for update;
  if not found then
    raise exception 'chain_invalid';
  end if;

  -- a credited donation is no longer a liability: a read that predates its money would understate NAV
  if exists (select 1 from public.dao_ledger c
             where c.chain_id = l.chain_id and c.status = 'credited' and c.block_number > p_assets_block) then
    raise exception 'assets_stale';
  end if;
  -- F4c-R7 (a): a read past the scan cursor may miss a payout that already left the Safe
  if not public._dao_assets_covered(l.chain_id, p_assets_block) then
    raise exception 'assets_stale';
  end if;

  -- this donation is still pending, so it is one of the liabilities: NAV_previo excludes it (open prizes at the price)
  v_nav := greatest(p_assets_usd6 - public._dao_liabilities_usd6(l.chain_id, p_assets_block, p_eth_price_e8), 0);
  -- F4c: the counted supply; approved shares are out of it (their fixed amount is a liability)
  v_total := s.total_shares - s.approved_locked_shares;

  if v_total = 0 then
    -- whatever the Safe held before the first (counted) donor belongs to the club fund
    if v_nav > 0 then
      v_club := v_nav * 1000000000000;
    end if;
    v_shares := l.amount_usdc * 1000000000000;
  else
    if v_nav = 0 then
      raise exception 'invalid_state';
    end if;
    -- first valuation of an F3 ledger: the excess over the ledger value goes to the club at the ledger price
    if not s.nav_initialized and s.value_usdc > 0 and v_nav > s.value_usdc then
      v_club := div((v_nav - s.value_usdc) * v_total, s.value_usdc);
      v_total := v_total + v_club;
    end if;
    v_shares := div(l.amount_usdc * v_total, v_nav);
  end if;
  if v_shares <= 0 then
    raise exception 'shares_zero';
  end if;

  update public.dao_state
  set total_shares = s.total_shares + v_club + v_shares,
      club_shares = s.club_shares + v_club,
      value_usdc = v_nav + l.amount_usdc,
      nav_initialized = true,
      nav_at = now(),
      updated_at = now()
  where chain_id = l.chain_id;

  insert into public.dao_positions as p (chain_id, member_id, shares, net_contributed_usdc)
  values (l.chain_id, l.member_id, v_shares, l.amount_usdc)
  on conflict (chain_id, member_id) do update
    set shares = p.shares + excluded.shares,
        net_contributed_usdc = p.net_contributed_usdc + excluded.net_contributed_usdc,
        updated_at = now();

  update public.dao_ledger
  set status = 'credited', shares_delta = v_shares, credited_at = clock_timestamp()
  where id = l.id;

  return jsonb_build_object('shares', v_shares::text, 'clubMinted', v_club::text);
end;
$$;

revoke execute on function public.credit_donation(uuid, numeric, bigint, numeric) from public, anon, authenticated, service_role;
grant execute on function public.credit_donation(uuid, numeric, bigint, numeric) to service_role;

-- ===== record_nav_snapshot (latest 20261019300007): the snapshot's own ETH price values the prizes =====
create or replace function public.record_nav_snapshot(p_chain int, p_safe text, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.dao_state;
  v_usdc numeric;
  v_eth numeric;
  v_weth numeric;
  v_price numeric;
  v_assets numeric;
  v_source text;
  v_block bigint;
  v_liab numeric;
  v_nav numeric;
  v_club numeric := 0;
  v_last public.dao_nav_snapshots;
  v_id uuid;
  v_cfg_safe text;
begin
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
     or coalesce(p_snapshot ->> 'usdcUnits', '') !~ '^[0-9]{1,78}$'
     or coalesce(p_snapshot ->> 'ethWei', '') !~ '^[0-9]{1,78}$'
     or coalesce(p_snapshot ->> 'wethWei', '') !~ '^[0-9]{1,78}$'
     or coalesce(p_snapshot ->> 'ethPriceE8', '') !~ '^[0-9]{1,78}$'
     or coalesce(p_snapshot ->> 'assetsUsd6', '') !~ '^[0-9]{1,78}$'
     or coalesce(p_snapshot ->> 'blockNumber', '') !~ '^[0-9]{1,18}$'
     or coalesce(p_snapshot ->> 'priceSource', '') not in ('chainlink', 'coingecko') then
    raise exception 'invalid_input';
  end if;
  v_usdc := (p_snapshot ->> 'usdcUnits')::numeric;
  v_eth := (p_snapshot ->> 'ethWei')::numeric;
  v_weth := (p_snapshot ->> 'wethWei')::numeric;
  v_price := (p_snapshot ->> 'ethPriceE8')::numeric;
  v_assets := (p_snapshot ->> 'assetsUsd6')::numeric;
  v_source := p_snapshot ->> 'priceSource';
  v_block := (p_snapshot ->> 'blockNumber')::bigint;
  -- the valuation must be the one the composition gives (USDC = 1 USD; ETH and WETH at price_e8, floor)
  if v_price = 0 or v_assets <> v_usdc + div((v_eth + v_weth) * v_price, 100000000000000000000) then
    raise exception 'invalid_input';
  end if;

  -- the balances must be the configured Safe's (held until commit: a Safe change waits for this snapshot)
  select c.safe_address into v_cfg_safe from public.chain_config c where c.chain_id = p_chain for share;
  if p_safe is null or v_cfg_safe is null or lower(p_safe) <> v_cfg_safe then
    raise exception 'safe_changed';
  end if;

  -- serialize with credit_donation (same row lock), then apply the 55-minute throttle
  select * into s from public.dao_state x where x.chain_id = p_chain for update;
  if not found then
    raise exception 'chain_invalid';
  end if;
  select * into v_last from public.dao_nav_snapshots n
  where n.chain_id = p_chain order by n.taken_at desc limit 1;
  if found and v_last.taken_at > now() - interval '55 minutes' then
    return jsonb_build_object('id', v_last.id, 'navUsd6', v_last.nav_usd6::text, 'clubMinted', '0', 'skipped', true);
  end if;

  -- F4c-R7 (a): a read past the scan cursor may miss a payout that already left the Safe
  if not public._dao_assets_covered(p_chain, v_block) then
    raise exception 'assets_stale';
  end if;

  -- F4d: the prizes at this snapshot's ETH price (the price the assets were valued at)
  v_liab := public._dao_liabilities_usd6(p_chain, v_block, v_price);
  v_nav := greatest(v_assets - v_liab, 0);

  -- first valuation of a chain with an F3 ledger
  if not s.nav_initialized and s.total_shares > 0 and s.value_usdc > 0 and v_nav > s.value_usdc then
    v_club := div((v_nav - s.value_usdc) * s.total_shares, s.value_usdc);
  end if;

  -- F4c: total_shares in the history is the counted supply S_eff, so nav_usd6 / total_shares is the share price
  insert into public.dao_nav_snapshots (chain_id, usdc_units, eth_wei, weth_wei, eth_price_e8, assets_usd6,
                                        liabilities_usd6, nav_usd6, total_shares, price_source, block_number)
  values (p_chain, v_usdc, v_eth, v_weth, v_price, v_assets, v_liab, v_nav,
          s.total_shares + v_club - s.approved_locked_shares, v_source, v_block)
  returning id into v_id;

  update public.dao_state
  set total_shares = s.total_shares + v_club,
      club_shares = s.club_shares + v_club,
      value_usdc = v_nav,
      nav_initialized = true,
      nav_at = now(),
      updated_at = now()
  where chain_id = p_chain;

  return jsonb_build_object('id', v_id, 'navUsd6', v_nav::text, 'clubMinted', v_club::text, 'skipped', false);
end;
$$;

-- ===== _withdrawal_valuation (latest 20261019300007) + p_eth_price_e8 =====
drop function public._withdrawal_valuation(public.withdrawal_requests, text, numeric, bigint, boolean);
create function public._withdrawal_valuation(w public.withdrawal_requests, p_safe text, p_assets_usd6 numeric,
                                             p_assets_block bigint, p_lock boolean, p_eth_price_e8 numeric default null)
returns table (amount numeric, nav numeric, supply numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_safe text;
  s public.dao_state;
  v_position numeric;
begin
  if p_lock then
    select c.withdrawals_enabled, c.safe_address into v_enabled, v_safe
    from public.chain_config c where c.chain_id = w.chain_id for share;
  else
    select c.withdrawals_enabled, c.safe_address into v_enabled, v_safe
    from public.chain_config c where c.chain_id = w.chain_id;
  end if;
  if not coalesce(v_enabled, false) then
    raise exception 'withdrawals_disabled';
  end if;
  if p_safe is null or v_safe is null or lower(p_safe) <> v_safe then
    raise exception 'safe_changed';
  end if;

  if p_lock then
    select * into s from public.dao_state x where x.chain_id = w.chain_id for update;
  else
    select * into s from public.dao_state x where x.chain_id = w.chain_id;
  end if;
  if not found then
    raise exception 'chain_invalid';
  end if;
  if not s.nav_initialized then
    raise exception 'nav_not_ready';
  end if;
  -- same guard as credit_donation: a read that predates a credited donation's money would understate NAV
  if exists (select 1 from public.dao_ledger c
             where c.chain_id = w.chain_id and c.status = 'credited' and c.block_number > p_assets_block) then
    raise exception 'assets_stale';
  end if;
  -- F4c-R7 (a): a read past the scan cursor may miss a payout that already left the Safe
  if not public._dao_assets_covered(w.chain_id, p_assets_block) then
    raise exception 'assets_stale';
  end if;

  nav := greatest(p_assets_usd6 - public._dao_liabilities_usd6(w.chain_id, p_assets_block, p_eth_price_e8), 0);
  supply := s.total_shares - s.approved_locked_shares;
  amount := case when supply > 0 then div(w.shares * nav, supply) else 0 end;

  select p.shares into v_position from public.dao_positions p where p.chain_id = w.chain_id and p.member_id = w.member_id;
  if amount <= 0 or (w.shares is distinct from v_position and amount < 1000000) then
    raise exception 'amount_too_small';
  end if;
  return next;
end;
$$;

-- ===== quote_withdrawal (latest 20261019300003) + p_eth_price_e8 =====
drop function public.quote_withdrawal(uuid, text, numeric, bigint);
create function public.quote_withdrawal(p_request uuid, p_safe text, p_assets_usd6 numeric, p_assets_block bigint,
                                        p_eth_price_e8 numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
  v record;
begin
  if p_assets_usd6 is null or p_assets_usd6 < 0 or p_assets_usd6 <> trunc(p_assets_usd6)
     or p_assets_block is null or p_assets_block < 0
     or (p_eth_price_e8 is not null and (p_eth_price_e8 < 0 or p_eth_price_e8 <> trunc(p_eth_price_e8))) then
    raise exception 'invalid_input';
  end if;
  select * into w from public.withdrawal_requests x where x.id = p_request;
  if not found then
    raise exception 'not_found';
  end if;
  if w.status <> 'pending' then
    raise exception 'invalid_state';
  end if;

  select * into v from public._withdrawal_valuation(w, p_safe, p_assets_usd6, p_assets_block, false, p_eth_price_e8);

  return jsonb_build_object(
    'amountUsdc', v.amount::text,
    'navUsd6', v.nav::text,
    'supplyShares', v.supply::text,
    'reservedUsdc', (select coalesce(sum(x.amount_usdc_locked), 0)::text from public.withdrawal_requests x
                     where x.chain_id = w.chain_id and x.status = 'approved' and x.payout_tx_hash is null));
end;
$$;

-- ===== approve_withdrawal (latest 20261019300003) + p_eth_price_e8 =====
drop function public.approve_withdrawal(uuid, uuid, text, numeric, bigint);
create function public.approve_withdrawal(p_request uuid, p_actor uuid, p_safe text, p_assets_usd6 numeric,
                                          p_assets_block bigint, p_eth_price_e8 numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
  v record;
  v_wallet text;
  v_self boolean;
begin
  if p_actor is null or not exists (select 1 from public.members m where m.id = p_actor and m.status = 'active')
     or (public.member_global_permissions(p_actor) & 256) = 0 then
    raise exception 'forbidden';
  end if;
  if p_assets_usd6 is null or p_assets_usd6 < 0 or p_assets_usd6 <> trunc(p_assets_usd6)
     or p_assets_block is null or p_assets_block < 0
     or (p_eth_price_e8 is not null and (p_eth_price_e8 < 0 or p_eth_price_e8 <> trunc(p_eth_price_e8))) then
    raise exception 'invalid_input';
  end if;

  select * into w from public.withdrawal_requests x where x.id = p_request for update;
  if not found then
    raise exception 'not_found';
  end if;
  if w.status <> 'pending' then
    raise exception 'invalid_state';
  end if;

  -- chain_config (share) -> dao_state (update), then the amount at the fresh NAV over S_eff
  select * into v from public._withdrawal_valuation(w, p_safe, p_assets_usd6, p_assets_block, true, p_eth_price_e8);

  select lower(m.wallet_address) into v_wallet from public.members m where m.id = w.member_id;
  v_self := p_actor = w.member_id;

  update public.withdrawal_requests
  set status = 'approved',
      amount_usdc_locked = v.amount,
      destination_address = v_wallet,
      approved_by = p_actor,
      approved_at = now(),
      self_approved = v_self,
      approval_count = approval_count + 1,
      updated_at = now()
  where id = w.id;

  -- the shares leave S_eff and the fixed amount becomes a liability: the cached NAV follows (carry i)
  update public.dao_state
  set approved_locked_shares = approved_locked_shares + w.shares,
      value_usdc = greatest(v.nav - v.amount, 0),
      nav_at = now(),
      updated_at = now()
  where chain_id = w.chain_id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (p_actor, 'withdrawal_approved', 'withdrawal_request', w.id, jsonb_build_object(
    'request', w.id, 'amount', v.amount::text, 'selfApproved', v_self, 'navUsd6', v.nav::text,
    'supplyShares', v.supply::text, 'assetsBlock', p_assets_block));

  insert into public.notifications (recipient_id, kind, data)
  values (w.member_id, 'withdrawal_approved', jsonb_build_object('requestId', w.id, 'amount', v.amount::text));

  return jsonb_build_object('amountUsdc', v.amount::text, 'selfApproved', v_self);
end;
$$;

revoke execute on function
  public._withdrawal_valuation(public.withdrawal_requests, text, numeric, bigint, boolean, numeric),
  public.quote_withdrawal(uuid, text, numeric, bigint, numeric),
  public.approve_withdrawal(uuid, uuid, text, numeric, bigint, numeric)
from public, anon, authenticated, service_role;

grant execute on function
  public.quote_withdrawal(uuid, text, numeric, bigint, numeric),
  public.approve_withdrawal(uuid, uuid, text, numeric, bigint, numeric)
to service_role;

-- ===== economy_config (latest 20261019300002) + weightedRafflesEnabled per chain =====
create or replace function public.economy_config()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'activeChainId', (select c.value from public.app_config c where c.key = 'active_chain_id'),
    'minFeeBps', (select c.value from public.app_config c where c.key = 'min_fee_bps'),
    'chains', (select coalesce(jsonb_object_agg(cc.chain_id::text,
                 jsonb_build_object('safe', cc.safe_address, 'platform', cc.platform_wallet,
                                    'withdrawalsEnabled', cc.withdrawals_enabled,
                                    'weightedRafflesEnabled', cc.weighted_raffles_enabled)), '{}'::jsonb)
               from public.chain_config cc)
  );
end;
$$;

-- ===== set_chain_addresses (latest 20261019300001): a raffle open, closed or drawn holds its prize in the old Safe =====
create or replace function public.set_chain_addresses(p_chain int, p_safe text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_safe text := nullif(lower(btrim(coalesce(p_safe, ''))), '');
  v_platform text := nullif(lower(btrim(coalesce(p_platform, ''))), '');
  v_old_safe text;
  v_old_platform text;
  v_reset boolean := false;
  s public.dao_state;
  v_zero constant text := '0x0000000000000000000000000000000000000000';
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if (v_safe is not null and (v_safe !~ '^0x[0-9a-f]{40}$' or v_safe = v_zero))
     or (v_platform is not null and (v_platform !~ '^0x[0-9a-f]{40}$' or v_platform = v_zero)) then
    raise exception 'address_invalid';
  end if;
  if v_safe is not null and v_safe = v_platform then
    raise exception 'safe_equals_platform';
  end if;

  select c.safe_address, c.platform_wallet into v_old_safe, v_old_platform
  from public.chain_config c where c.chain_id = p_chain for update;

  if v_safe is distinct from v_old_safe then
    select * into s from public.dao_state x where x.chain_id = p_chain for update;
    -- the value of shares, pending donations, still-confirmable donation intents and unpaid prizes lives in the old Safe
    if coalesce(s.total_shares, 0) > 0
       or exists (select 1 from public.dao_ledger l
                  where l.chain_id = p_chain and l.status = 'pending_finality')
       or exists (select 1 from public.payment_intents i
                  where i.chain_id = p_chain and i.purpose = 'donation' and i.status = 'pending'
                    and (i.expires_at > now()
                         or (i.hashes_attached_at is not null and i.hashes_attached_at <= i.expires_at
                             and now() <= i.created_at + interval '7 days')))
       or exists (select 1 from public.raffles r
                  where r.chain_id = p_chain and r.status in ('open', 'closed', 'drawn')) then
      raise exception 'safe_change_blocked';
    end if;

    -- F4a carry d: unread outflow alerts about the old Safe's operations go with them (read ones stay as history)
    delete from public.notifications n
     where n.kind = 'treasury_outflow' and n.read_at is null
       and n.data ->> 'opId' in (select o.id::text from public.dao_safe_operations o where o.chain_id = p_chain);
    delete from public.dao_safe_operations o where o.chain_id = p_chain;
    delete from public.dao_scan_state x where x.chain_id = p_chain;
    delete from public.dao_nav_snapshots n where n.chain_id = p_chain;
    update public.dao_state
    set value_usdc = 0, nav_initialized = false, nav_at = null, updated_at = now()
    where chain_id = p_chain;
    v_reset := true;
  end if;

  update public.chain_config
  set safe_address = v_safe, platform_wallet = v_platform, updated_at = now(), updated_by = v_me
  where chain_id = p_chain;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'economy.addresses', jsonb_build_object(
    'chain', p_chain,
    'old', jsonb_build_object('safe', v_old_safe, 'platform', v_old_platform),
    'new', jsonb_build_object('safe', v_safe, 'platform', v_platform),
    'reset', v_reset));
end;
$$;

-- ===== set_weighted_raffles_enabled (bit 512) =====
create function public.set_weighted_raffles_enabled(p_chain int, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_old boolean;
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if p_enabled is null then
    raise exception 'invalid_input';
  end if;

  select c.weighted_raffles_enabled into v_old from public.chain_config c where c.chain_id = p_chain for update;
  update public.chain_config
  set weighted_raffles_enabled = p_enabled, updated_at = now(), updated_by = v_me
  where chain_id = p_chain;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'economy.weighted_raffles', jsonb_build_object('chain', p_chain, 'old', v_old, 'new', p_enabled));
end;
$$;

-- ===== create_raffle (bit 256, active chain): the prize leaves the cached NAV at once =====
create function public.create_raffle(p_title text, p_prize_token text, p_prize_amount numeric, p_closes_at timestamptz,
                                     p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_title text := btrim(coalesce(p_title, ''));
  v_chain int;
  v_weighted boolean;
  s public.dao_state;
  v_price numeric;
  v_value numeric;
  v_seed bytea;
  v_commit text;
  v_id uuid;
begin
  if v_me is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  if char_length(v_title) not between 1 and 80 then
    raise exception 'title_required';
  end if;
  if p_prize_token is null or p_prize_token not in ('USDC', 'WETH')
     or p_mode is null or p_mode not in ('equal', 'weighted')
     or p_prize_amount is null or p_prize_amount <> trunc(p_prize_amount) then
    raise exception 'invalid_input';
  end if;
  if (p_prize_token = 'USDC' and p_prize_amount < 1000000)
     or (p_prize_token = 'WETH' and p_prize_amount < 1000000000000000) then
    raise exception 'prize_too_small';
  end if;
  if p_closes_at is null or p_closes_at < now() + interval '1 hour' or p_closes_at > now() + interval '30 days' then
    raise exception 'closes_at_invalid';
  end if;

  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  -- held until commit: the switch and a Safe change wait for this raffle
  select cc.weighted_raffles_enabled into v_weighted from public.chain_config cc where cc.chain_id = v_chain for share;
  if not found then
    raise exception 'chain_invalid';
  end if;
  if p_mode = 'weighted' and not v_weighted then
    raise exception 'weighted_raffles_disabled';
  end if;

  select * into s from public.dao_state x where x.chain_id = v_chain for update;
  if not found or not s.nav_initialized then
    raise exception 'nav_not_ready';
  end if;
  if p_prize_token = 'USDC' then
    v_value := p_prize_amount;
  else
    select n.eth_price_e8 into v_price from public.dao_nav_snapshots n
    where n.chain_id = v_chain order by n.taken_at desc limit 1;
    if v_price is null then
      raise exception 'nav_not_ready';
    end if;
    v_value := div(p_prize_amount * v_price, 100000000000000000000);
  end if;
  if v_value > s.value_usdc then
    raise exception 'prize_too_large';
  end if;

  v_seed := extensions.gen_random_bytes(32);
  v_commit := '0x' || encode(public._keccak256(v_seed), 'hex');

  insert into public.raffles (chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, closes_at,
                              seed_commit, created_by)
  values (v_chain, v_title, p_prize_token, p_prize_amount, v_value, p_mode, p_closes_at, v_commit, v_me)
  returning id into v_id;
  insert into private.raffle_seeds (raffle_id, seed) values (v_id, v_seed);

  -- the prize is a liability from now on: the cached NAV follows in the same transaction
  update public.dao_state
  set value_usdc = greatest(s.value_usdc - v_value, 0), updated_at = now()
  where chain_id = v_chain;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_me, 'raffle_created', 'raffle', v_id, jsonb_build_object(
    'raffle', v_id, 'token', p_prize_token, 'amount', p_prize_amount::text, 'valueUsd6', v_value::text,
    'mode', p_mode, 'closesAt', p_closes_at, 'commit', v_commit));

  return jsonb_build_object('id', v_id, 'commit', v_commit);
end;
$$;

-- ===== cancel_raffle (bit 256): open or closed only; the seed is deleted, never revealed =====
create function public.cancel_raffle(p_raffle uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_reason text := btrim(coalesce(p_reason, ''), E' \t\n\r\f\v');
  r public.raffles;
begin
  if v_me is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  if char_length(v_reason) not between 1 and 280 then
    raise exception 'reason_required';
  end if;

  select * into r from public.raffles x where x.id = p_raffle for update;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status in ('drawn', 'paid') then
    raise exception 'raffle_drawn';
  end if;
  if r.status not in ('open', 'closed') then
    raise exception 'invalid_state';
  end if;

  update public.raffles
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_me, cancel_reason = v_reason, updated_at = now()
  where id = r.id;
  delete from private.raffle_seeds x where x.raffle_id = r.id;

  -- the prize is no longer owed: the cached NAV gets it back (raffle row -> dao_state)
  update public.dao_state
  set value_usdc = value_usdc + r.prize_value_usd6, updated_at = now()
  where chain_id = r.chain_id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_me, 'raffle_cancelled', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'reason', v_reason, 'valueUsd6', r.prize_value_usd6::text));
end;
$$;

-- ===== grants =====
revoke execute on function
  public.set_weighted_raffles_enabled(int, boolean),
  public.create_raffle(text, text, numeric, timestamptz, text),
  public.cancel_raffle(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.set_weighted_raffles_enabled(int, boolean),
  public.create_raffle(text, text, numeric, timestamptz, text),
  public.cancel_raffle(uuid, text)
to authenticated;
