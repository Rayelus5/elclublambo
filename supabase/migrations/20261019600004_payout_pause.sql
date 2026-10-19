-- Ruling F4-R2 (whole-branch review I2, with M4) and M1.
--
--   A non-conforming payout (split, short, or one transfer covering two obligations) leaves the obligation a liability
--   after its money left the Safe: every valuation then sees a NAV that is too low. Valuations now pause instead.
--
--   _payout_outflow_unexplained(chain, token, to, start, own withdrawal, own raffle): an outflow of the Safe in `token`
--     to `to`, at [start − 120 s, start + 14 d] (the payout window; M4: it has an end), without a treasurer note, not
--     this obligation's own link, and either unexplained by the rule of treasury_unexplained_outflows (latest
--     20261019400004) or linked to another obligation that it overpays (the excess may be this one's payout: one 550
--     to a member owed W = 400 and R = 150 is linked to W).
--   _dao_payout_pause(chain): an approved, unpaid withdrawal (USDC to its destination, from approved_at) or a drawn,
--     unpaid prize (its token to the winner's address, from drawn_at) has such an outflow.
--   _dao_assets_covered (latest 20261019400002) is false while the pause holds, so credit_donation,
--     _withdrawal_valuation (quote / approve) and record_nav_snapshot answer assets_stale, as for a read past the cursor.
--   treasury_withdrawals (latest 20261019600002) computes unexplained_outflow with the helper; treasury_raffles (latest
--     20261019600001) gains unexplained_outflow (drop and create, grants restated). The panel's «Avisos» name the paused
--     obligation; the guide says how to resolve it (one transfer of at least the amount, then a note on the partial
--     outflows; or a note when the outflow is unrelated).
--   M1: record_nav_snapshot (latest 20261019400002) refuses a read older than a credited donation (assets_stale), the
--     guard credit_donation and _withdrawal_valuation already have.

-- ===== the predicate =====
create function public._payout_outflow_unexplained(p_chain int, p_token text, p_to text, p_start timestamptz,
                                                   p_withdrawal uuid, p_raffle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_to is not null and p_start is not null and exists (
    select 1
    from public.dao_safe_operations o
    left join public.withdrawal_requests w on w.id = o.withdrawal_id
    left join public.raffles r on r.id = o.raffle_id
    where o.chain_id = p_chain
      and o.direction = 'out' and o.asset = p_token and o.ledger_id is null and o.note is null
      and o.counterparty = p_to
      and o.occurred_at between p_start - interval '120 seconds' and p_start + interval '14 days'
      -- not this obligation's own candidate or payout
      and not coalesce(o.withdrawal_id = p_withdrawal, false)
      and not coalesce(o.raffle_id = p_raffle, false)
      and (
        -- unexplained (treasury_unexplained_outflows)
        not coalesce((w.status = 'approved' and (w.payout_tx_hash is null
                                                or (w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index)))
                     or (w.status = 'paid' and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index)
                     or (r.status = 'drawn' and (r.payout_tx_hash is null
                                                 or (r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index)))
                     or (r.status = 'paid' and r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index),
                     false)
        -- or linked to another obligation it overpays
        or o.amount > coalesce(w.amount_usdc_locked, r.prize_amount, o.amount)))
$$;

create function public._dao_payout_pause(p_chain int)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.withdrawal_requests w
                 where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null
                   and public._payout_outflow_unexplained(w.chain_id, 'USDC', w.destination_address, w.approved_at, w.id, null))
      or exists (select 1 from public.raffles r
                 where r.chain_id = p_chain and r.status = 'drawn' and r.payout_tx_hash is null
                   and public._payout_outflow_unexplained(r.chain_id, r.prize_token, r.winner_address, r.drawn_at, null, r.id))
$$;

-- ===== _dao_assets_covered (latest 20261019400002) + the pause =====
create or replace function public._dao_assets_covered(p_chain int, p_block bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select ((not exists (select 1 from public.withdrawal_requests w
                       where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null)
           and not exists (select 1 from public.raffles r
                           where r.chain_id = p_chain and r.status = 'drawn' and r.payout_tx_hash is null))
       or coalesce((select s.last_block from public.dao_scan_state s where s.chain_id = p_chain), -1) >= p_block)
     -- F4-R2: not while a non-conforming payout may have left the Safe
     and not public._dao_payout_pause(p_chain)
$$;

-- ===== record_nav_snapshot (latest 20261019400002) + M1 =====
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

  -- M1: a credited donation is no longer a liability: a read that predates its money would understate NAV
  if exists (select 1 from public.dao_ledger c
             where c.chain_id = p_chain and c.status = 'credited' and c.block_number > v_block) then
    raise exception 'assets_stale';
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

-- ===== treasury_withdrawals (latest 20261019600002): unexplained_outflow through the helper =====
create or replace function public.treasury_withdrawals()
returns table (id uuid, member_id uuid, member_label text, wallet text, shares text, position_shares text, status text,
               created_at timestamptz, approved_at timestamptz, expires_at timestamptz, approved_by_label text,
               self_approved boolean, amount_usdc text, estimate_usd6 text, last_expired_at timestamptz,
               reject_reason text, payout_tx_hash text, payout_amount text, payout_recorded_at timestamptz,
               paid_at timestamptz, payout_linked boolean, rejected_at timestamptz, cancelled_at timestamptz,
               unexplained_outflow boolean)
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
         w.rejected_at, w.cancelled_at,
         -- F4-R2: the pause predicate (an unexplained USDC outflow to the destination inside the payout window)
         (w.status = 'approved' and w.payout_tx_hash is null
          and public._payout_outflow_unexplained(w.chain_id, 'USDC', w.destination_address, w.approved_at, w.id, null))
  from public.withdrawal_requests w
  join public.members m on m.id = w.member_id
  left join public.dao_positions p on p.chain_id = w.chain_id and p.member_id = w.member_id
  where w.chain_id = v_chain
    and (w.status in ('pending', 'approved')
         or coalesce(w.paid_at, w.rejected_at, w.cancelled_at) >= now() - interval '30 days')
  order by (w.status in ('pending', 'approved')) desc, w.created_at desc, w.id;
end;
$$;

-- ===== treasury_raffles (latest 20261019600001) + unexplained_outflow; new column: drop and create =====
drop function public.treasury_raffles();
create or replace function public.treasury_raffles()
returns table (id uuid, title text, status text, prize_token text, prize_amount text, prize_value_usd6 text, mode text,
               closes_at timestamptz, entries int, total_weight text, winner_member_id uuid, winner_label text,
               winner_address text, drawn_at timestamptz, unpaid boolean, payout_tx_hash text,
               payout_recorded_at timestamptz, paid_at timestamptz, cancel_reason text, created_by_label text,
               created_at timestamptz, paid_late boolean, draw_refused text, unexplained_outflow boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_chain int;
begin
  if public.current_member_id() is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';

  return query
  select r.id, r.title, r.status, r.prize_token, r.prize_amount::text, r.prize_value_usd6::text, r.mode, r.closes_at,
         (select count(*)::int from public.raffle_entries e where e.raffle_id = r.id),
         r.total_weight::text,
         r.winner_member_id,
         public._member_label(r.winner_member_id), -- the real label: the treasurer pays this member
         r.winner_address,
         r.drawn_at,
         coalesce(r.status = 'drawn' and r.payout_tx_hash is null and r.drawn_at < now() - interval '14 days'
                  and not exists (select 1 from public.dao_safe_operations o where o.raffle_id = r.id), false),
         r.payout_tx_hash, r.payout_recorded_at, r.paid_at, r.cancel_reason,
         public._member_label(r.created_by),
         r.created_at,
         -- 4: the rule of _raffle_card's paidLate
         coalesce(r.status = 'paid' and r.payout_block_time > r.drawn_at + interval '14 days', false),
         -- 1: a refusal matters only while the raffle still awaits its draw
         case when r.status = 'closed' then r.draw_refused_code end,
         -- F4-R2: a drawn, unpaid prize with an unexplained outflow to the winner pauses valuations
         (r.status = 'drawn' and r.payout_tx_hash is null
          and public._payout_outflow_unexplained(r.chain_id, r.prize_token, r.winner_address, r.drawn_at, null, r.id))
  from public.raffles r
  where r.chain_id = v_chain
    and (r.status in ('open', 'closed', 'drawn')
         or coalesce(r.paid_at, r.cancelled_at, r.closed_at) >= now() - interval '30 days')
  order by (r.status in ('open', 'closed', 'drawn')) desc, r.created_at desc, r.id;
end;
$$;

revoke execute on function
  public._payout_outflow_unexplained(int, text, text, timestamptz, uuid, uuid),
  public._dao_payout_pause(int),
  public.treasury_raffles()
from public, anon, authenticated, service_role;
grant execute on function public.treasury_raffles() to authenticated;
