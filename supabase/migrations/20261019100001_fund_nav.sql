-- F4a Task 1: the DAO is valued at market. The server reads the Safe (USDC, ETH, WETH) and the ETH/USD price, values
-- the assets in usd6 and hands them to SQL; SQL subtracts the liabilities it knows and owns all the accounting.
--
--   liabilities_usd6 = _dao_liabilities_usd6(chain, block)   (every pending_finality donation mined at or before the
--                      block the Safe was read at: its money is already in those assets; ruling F4a-R4)
--   NAV              = greatest(assets_usd6 - liabilities_usd6, 0)
--   credit:          shares = S = 0 ? d * 10^12 : floor(d * S / NAV_previo)
--                    if S = 0 and NAV_previo > 0, the "Fondo del club" first takes club_shares = NAV_previo * 10^12
--                    0 shares -> shares_zero (not credited, left pending for review)
--   first valuation: a chain with an F3 ledger (nav_initialized = false, S > 0) whose NAV exceeds the ledger value V
--                    gives the excess to the club at the ledger price: floor((NAV - V) * S / V).
--
-- Share price (ruling F4a-R3): the usd6 price of ONE participación = 10^18 shares (1 USDC buys 10^18 shares in an
-- empty fund, so it starts at 1_000000): sharePriceUsd6 = floor(NAV * 10^18 / S).
--
-- dao_state.value_usdc keeps its name and now caches the last NAV (usd6); nav_at is when it was taken.
-- The club fund (dao_state.club_shares) counts in total_shares; it cannot be withdrawn, does not vote, enters no
-- raffle and opens no channel gate (it has no dao_positions row, so the gates never see it).

-- ===== schema =====
alter table public.dao_state
  add column club_shares numeric(78, 0) not null default 0 check (club_shares >= 0),
  add column nav_initialized boolean not null default false,
  add column nav_at timestamptz,
  add constraint dao_state_club_within_total check (club_shares <= total_shares);

create table public.dao_nav_snapshots (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null check (chain_id in (59144, 59141)),
  taken_at timestamptz not null default now(),
  usdc_units numeric(78, 0) not null check (usdc_units >= 0),
  eth_wei numeric(78, 0) not null check (eth_wei >= 0),
  weth_wei numeric(78, 0) not null check (weth_wei >= 0),
  eth_price_e8 numeric(78, 0) not null check (eth_price_e8 > 0),
  assets_usd6 numeric(78, 0) not null check (assets_usd6 >= 0),
  liabilities_usd6 numeric(78, 0) not null check (liabilities_usd6 >= 0),
  nav_usd6 numeric(78, 0) not null check (nav_usd6 >= 0),
  total_shares numeric(78, 0) not null check (total_shares >= 0),
  price_source text not null check (price_source in ('chainlink', 'coingecko')),
  block_number bigint not null check (block_number >= 0)
);
create index dao_nav_snapshots_chain_taken_idx on public.dao_nav_snapshots (chain_id, taken_at desc);

alter table public.dao_nav_snapshots enable row level security;
revoke all on public.dao_nav_snapshots from public, anon, authenticated;

-- ===== _dao_liabilities_usd6 (service_role): what the Safe holds that is not the fund's yet. F4c/F4d extend it. =====
-- p_at_block bounds the donations to the block the assets were read at (a later donation's money is not in them);
-- null counts every pending donation (read paths only).
create function public._dao_liabilities_usd6(p_chain int, p_at_block bigint)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.amount_usdc), 0)
  from public.dao_ledger l
  where l.chain_id = p_chain and l.status = 'pending_finality'
    and (p_at_block is null or l.block_number <= p_at_block)
$$;

-- ===== credit_donation (service_role): phase 2 at NAV, idempotent =====
-- p_assets_usd6 is the Safe valued at block p_assets_block. The donation must be in those assets (its block <= the
-- read block), else assets_stale: the server read the Safe before the donation landed and retries later.
-- A replay of a credited row returns its stored shares; clubMinted is then "0" (informational only, not a total).
drop function public.credit_donation(uuid);

create function public.credit_donation(p_ledger uuid, p_assets_usd6 numeric, p_assets_block bigint)
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
     or p_assets_block is null or p_assets_block < 0 then
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

  -- this donation is still pending, so it is one of the liabilities: NAV_previo excludes it
  v_nav := greatest(p_assets_usd6 - public._dao_liabilities_usd6(l.chain_id, p_assets_block), 0);
  v_total := s.total_shares;

  if v_total = 0 then
    -- whatever the Safe held before the first donor belongs to the club fund
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

-- ===== record_nav_snapshot (service_role): at most one per chain every 55 minutes =====
create function public.record_nav_snapshot(p_chain int, p_snapshot jsonb)
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

  v_liab := public._dao_liabilities_usd6(p_chain, v_block);
  v_nav := greatest(v_assets - v_liab, 0);

  -- first valuation of a chain with an F3 ledger
  if not s.nav_initialized and s.total_shares > 0 and s.value_usdc > 0 and v_nav > s.value_usdc then
    v_club := div((v_nav - s.value_usdc) * s.total_shares, s.value_usdc);
  end if;

  insert into public.dao_nav_snapshots (chain_id, usdc_units, eth_wei, weth_wei, eth_price_e8, assets_usd6,
                                        liabilities_usd6, nav_usd6, total_shares, price_source, block_number)
  values (p_chain, v_usdc, v_eth, v_weth, v_price, v_assets, v_liab, v_nav, s.total_shares + v_club, v_source, v_block)
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

-- ===== dao_overview: + NAV, share price, my value, club shares, composition =====
create or replace function public.dao_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_total numeric := 0;
  v_value numeric := 0;
  v_club numeric := 0;
  v_nav_at timestamptz;
  v_shares numeric := 0;
  v_net numeric := 0;
  v_pending jsonb;
  v_comp jsonb;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select s.total_shares, s.value_usdc, s.club_shares, s.nav_at into v_total, v_value, v_club, v_nav_at
  from public.dao_state s where s.chain_id = v_chain;
  v_total := coalesce(v_total, 0);
  v_value := coalesce(v_value, 0);
  select p.shares, p.net_contributed_usdc into v_shares, v_net
  from public.dao_positions p where p.chain_id = v_chain and p.member_id = v_me;
  v_shares := coalesce(v_shares, 0);
  select coalesce(jsonb_agg(jsonb_build_object(
           'ledgerId', l.id, 'amount', l.amount_usdc::text, 'txHash', l.tx_hash, 'createdAt', l.created_at)
         order by l.created_at desc, l.id), '[]'::jsonb)
    into v_pending
  from public.dao_ledger l
  where l.chain_id = v_chain and l.member_id = v_me and l.status = 'pending_finality';
  select jsonb_build_object(
           'usdcUnits', n.usdc_units::text, 'ethWei', n.eth_wei::text, 'wethWei', n.weth_wei::text,
           'ethPriceE8', n.eth_price_e8::text, 'priceSource', n.price_source, 'takenAt', n.taken_at)
    into v_comp
  from public.dao_nav_snapshots n
  where n.chain_id = v_chain
  order by n.taken_at desc
  limit 1;

  return jsonb_build_object(
    'chainId', v_chain,
    'totalShares', v_total::text,
    'valueUsdc', v_value::text,
    'donors', (select count(*) from public.dao_positions p where p.chain_id = v_chain and p.shares > 0),
    'myShares', v_shares::text,
    'myShareBps', case when v_total = 0 then 0 else div(v_shares * 10000, v_total) end,
    'myNet', coalesce(v_net, 0)::text,
    'myPending', v_pending,
    'navUsd6', v_value::text,
    'navAt', v_nav_at,
    'sharePriceUsd6', case when v_total = 0 then '0' else div(v_value * 1000000000000000000, v_total)::text end,
    'myValueUsd6', case when v_total = 0 then '0' else div(v_shares * v_value, v_total)::text end,
    'clubShares', coalesce(v_club, 0)::text,
    'composition', v_comp);
end;
$$;

-- ===== dao_ranking: + the club fund row (member_id null, label 'Fondo del club', net 0), ranked by shares =====
create or replace function public.dao_ranking(p_limit int default 50)
returns table (rank int, member_id uuid, label text, share_bps int, net_usdc numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select (c.value #>> '{}')::int as chain from public.app_config c where c.key = 'active_chain_id'
  ), st as (
    select s.total_shares, s.club_shares from public.dao_state s join cfg on s.chain_id = cfg.chain
  ), holders as (
    select p.member_id as mid, p.shares as sh, p.net_contributed_usdc as net, false as club
    from public.dao_positions p join cfg on p.chain_id = cfg.chain
    where p.shares > 0
    union all
    select null::uuid, st.club_shares, 0::numeric, true
    from st
    where st.club_shares > 0
  ), r as (
    select row_number() over (order by h.sh desc, h.club desc, h.mid)::int as rk, h.mid, h.sh, h.net, h.club
    from holders h
  )
  select r.rk,
         case when r.club then null
              when m.dao_ranking_visible or r.mid = public.current_member_id() then r.mid end,
         case when r.club then 'Fondo del club'
              when m.dao_ranking_visible or r.mid = public.current_member_id() then public._member_label(r.mid)
              else 'Anónimo' end,
         div(r.sh * 10000, st.total_shares)::int,
         r.net
  from r
  left join public.members m on m.id = r.mid
  cross join st
  where public.is_active_member() and st.total_shares > 0
  order by r.rk
  limit greatest(1, least(100, coalesce(p_limit, 50)))
$$;

-- ===== dao_nav_history: NAV and share price over a range, oldest first, at most 500 points =====
-- Thinning keeps every k-th point counted back from the newest (k = ceil(n / 500)), so the newest is always kept and
-- the count is ceil(n / k) <= 500.
create function public.dao_nav_history(p_range text)
returns table (taken_at timestamptz, nav_usd6 text, share_price_usd6 text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
begin
  if public.current_member_id() is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  v_since := case p_range
    when '24h' then now() - interval '24 hours'
    when '7d' then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when 'all' then '-infinity'::timestamptz
  end;
  if v_since is null then
    raise exception 'invalid_input';
  end if;

  return query
  with cfg as (
    select (c.value #>> '{}')::int as chain from public.app_config c where c.key = 'active_chain_id'
  ), pts as (
    select n.taken_at as t, n.nav_usd6 as nav, n.total_shares as sh,
           row_number() over (order by n.taken_at desc, n.id desc) as back,
           count(*) over () as cnt
    from public.dao_nav_snapshots n join cfg on n.chain_id = cfg.chain
    where n.taken_at >= v_since
  )
  select pts.t,
         pts.nav::text,
         case when pts.sh = 0 then '0' else div(pts.nav * 1000000000000000000, pts.sh)::text end
  from pts
  where (pts.back - 1) % ceil(pts.cnt / 500.0)::bigint = 0
  order by pts.t, pts.back desc;
end;
$$;

-- ===== grants =====
revoke execute on function
  public._dao_liabilities_usd6(int, bigint),
  public.credit_donation(uuid, numeric, bigint),
  public.record_nav_snapshot(int, jsonb),
  public.dao_overview(),
  public.dao_ranking(int),
  public.dao_nav_history(text)
from public, anon, authenticated, service_role;

grant execute on function
  public._dao_liabilities_usd6(int, bigint),
  public.credit_donation(uuid, numeric, bigint),
  public.record_nav_snapshot(int, jsonb)
to service_role;

grant execute on function
  public.dao_overview(),
  public.dao_ranking(int),
  public.dao_nav_history(text)
to authenticated;
