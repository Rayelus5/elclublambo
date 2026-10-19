-- F4c final review C1 / I1, ruling F4c-R7: between "the Safe paid an approved withdrawal" and "the forum recorded the
-- payout", a valuation saw the USDC gone from the assets while still subtracting the fixed amount as a liability, so
-- NAV was low by the payout: donations were over-issued, the next approval under-fixed and snapshots dipped.
--
--   (a) _dao_assets_covered(chain, block): while the chain has an approved request without a recorded payout, a Safe
--       read is trusted only at a block the scan has covered (dao_scan_state.last_block >= block): the scan has then
--       seen, and linked, every outflow up to it. credit_donation, _withdrawal_valuation (quote / approve) and
--       record_nav_snapshot raise assets_stale otherwise (the callers retry later). dao_valuation_cap(chain) tells the
--       server which block to read the Safe at: {capped, block} (block = the scan cursor, null without one).
--   (b) _dao_liabilities_usd6(chain, B) leaves out an approved request whose linked payout candidate (a scanned USDC
--       outflow to it, inside its window [approved_at - 120 s, approved_at + 14 d], the predicate of payout_linked) is
--       at or before B: for valuation it is paid from that block on, exactly as a recorded payout is. Recording it later
--       changes nothing (same block); a revert or unlink removes the link, and then the USDC never left the Safe.
--   Together: a valuation at B <= cursor sees every payout mined up to B as gone from both sides, so the price does not
--   move for the other holders. The read paths (block null) are unchanged.
--
-- Minors of the same review: treasury_withdrawals shows the destination snapshotted at approval; the recorded payout
-- log is returned to the finality check (withdrawals_awaiting_finality.payout_log_index); the unused, stale
-- my_dao_position (it ignored approved shares) is dropped.

-- ===== (a) the guard and the cap =====
create function public._dao_assets_covered(p_chain int, p_block bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.withdrawal_requests w
                     where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null)
      or coalesce((select s.last_block from public.dao_scan_state s where s.chain_id = p_chain), -1) >= p_block
$$;

create function public.dao_valuation_cap(p_chain int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'capped', exists (select 1 from public.withdrawal_requests w
                      where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null),
    'block', (select s.last_block::text from public.dao_scan_state s where s.chain_id = p_chain))
$$;

revoke execute on function public._dao_assets_covered(int, bigint), public.dao_valuation_cap(int)
  from public, anon, authenticated, service_role;
grant execute on function public._dao_assets_covered(int, bigint), public.dao_valuation_cap(int) to service_role;

-- ===== (b) _dao_liabilities_usd6 (latest 20261019300005): a linked payout candidate at or before B is a payout =====
create or replace function public._dao_liabilities_usd6(p_chain int, p_at_block bigint)
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
$$;

-- ===== credit_donation (latest 20261019300003): + the scan-cursor guard (a) =====
create or replace function public.credit_donation(p_ledger uuid, p_assets_usd6 numeric, p_assets_block bigint)
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

  -- a credited donation is no longer a liability: a read that predates its money would understate NAV
  if exists (select 1 from public.dao_ledger c
             where c.chain_id = l.chain_id and c.status = 'credited' and c.block_number > p_assets_block) then
    raise exception 'assets_stale';
  end if;
  -- F4c-R7 (a): a read past the scan cursor may miss a payout that already left the Safe
  if not public._dao_assets_covered(l.chain_id, p_assets_block) then
    raise exception 'assets_stale';
  end if;

  -- this donation is still pending, so it is one of the liabilities: NAV_previo excludes it
  v_nav := greatest(p_assets_usd6 - public._dao_liabilities_usd6(l.chain_id, p_assets_block), 0);
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

-- ===== record_nav_snapshot (latest 20261019300003): + the scan-cursor guard (a), after the throttle =====
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

  v_liab := public._dao_liabilities_usd6(p_chain, v_block);
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

-- ===== _withdrawal_valuation (latest 20261019300003): + the scan-cursor guard (a) =====
create or replace function public._withdrawal_valuation(w public.withdrawal_requests, p_safe text, p_assets_usd6 numeric,
                                                        p_assets_block bigint, p_lock boolean)
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

  nav := greatest(p_assets_usd6 - public._dao_liabilities_usd6(w.chain_id, p_assets_block), 0);
  supply := s.total_shares - s.approved_locked_shares;
  amount := case when supply > 0 then div(w.shares * nav, supply) else 0 end;

  select p.shares into v_position from public.dao_positions p where p.chain_id = w.chain_id and p.member_id = w.member_id;
  if amount <= 0 or (w.shares is distinct from v_position and amount < 1000000) then
    raise exception 'amount_too_small';
  end if;
  return next;
end;
$$;

-- ===== withdrawals_awaiting_finality (latest 20261019300004): + payout_log_index (final review minor 1) =====
drop function public.withdrawals_awaiting_finality(int);
create function public.withdrawals_awaiting_finality(p_chain int)
returns table (request_id uuid, tx_hash text, destination text, amount_usdc_locked text, approved_at timestamptz,
               payout_block text, payout_recorded_at timestamptz, payout_log_index int)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.payout_tx_hash, w.destination_address, w.amount_usdc_locked::text, w.approved_at,
         w.payout_block::text, w.payout_recorded_at, w.payout_log_index
  from public.withdrawal_requests w
  where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is not null
  order by w.payout_block, w.id
$$;
revoke execute on function public.withdrawals_awaiting_finality(int) from public, anon, authenticated, service_role;
grant execute on function public.withdrawals_awaiting_finality(int) to service_role;

-- ===== the stale my_dao_position (unused; it divided by total_shares, ignoring approved shares) =====
drop function public.my_dao_position(int);

-- ===== treasury_withdrawals (latest 20261019300006): an approved or paid row shows the destination snapshotted at
-- approval (what the payout is verified against), not the member's current wallet (final review minor 5) =====
create or replace function public.treasury_withdrawals()
returns table (id uuid, member_id uuid, member_label text, wallet text, shares text, position_shares text, status text,
               created_at timestamptz, approved_at timestamptz, expires_at timestamptz, approved_by_label text,
               self_approved boolean, amount_usdc text, estimate_usd6 text, last_expired_at timestamptz,
               reject_reason text, payout_tx_hash text, payout_amount text, payout_recorded_at timestamptz,
               paid_at timestamptz, payout_linked boolean, rejected_at timestamptz, cancelled_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_chain int;
  v_value numeric := 0;
  v_supply numeric := 0;
begin
  if public.current_member_id() is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select s.value_usdc, s.total_shares - s.approved_locked_shares into v_value, v_supply
  from public.dao_state s where s.chain_id = v_chain;

  return query
  select w.id, w.member_id,
         public._member_label(w.member_id), -- the real label, even for a donor hidden from the ranking
         case when w.status in ('approved', 'paid') then coalesce(w.destination_address, m.wallet_address)
              else m.wallet_address end,
         w.shares::text,
         coalesce(p.shares, 0)::text,
         w.status, w.created_at, w.approved_at, w.approved_at + interval '14 days',
         public._member_label(w.approved_by),
         w.self_approved,
         w.amount_usdc_locked::text,
         case when coalesce(v_supply, 0) > 0 then div(w.shares * coalesce(v_value, 0), v_supply)::text end,
         w.last_expired_at, w.reject_reason, w.payout_tx_hash, w.payout_amount::text, w.payout_recorded_at, w.paid_at,
         (w.status = 'approved' and w.payout_tx_hash is null and exists (
            select 1 from public.dao_safe_operations o
            where o.withdrawal_id = w.id
              and o.occurred_at between w.approved_at - interval '120 seconds' and w.approved_at + interval '14 days')),
         w.rejected_at, w.cancelled_at
  from public.withdrawal_requests w
  join public.members m on m.id = w.member_id
  left join public.dao_positions p on p.chain_id = w.chain_id and p.member_id = w.member_id
  where w.chain_id = v_chain
    and (w.status in ('pending', 'approved')
         or coalesce(w.paid_at, w.rejected_at, w.cancelled_at) >= now() - interval '30 days')
  order by (w.status in ('pending', 'approved')) desc, w.created_at desc, w.id;
end;
$$;
