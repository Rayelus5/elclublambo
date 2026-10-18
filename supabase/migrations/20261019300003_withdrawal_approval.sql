-- F4c Task 3: approval at market NAV, rejection, 14-day expiry, liabilities and supply, treasurer reads, push copy.
--
--   Approval fixes amount_usdc_locked = floor(shares * NAV / S_eff), NAV = greatest(assets - liabilities(block), 0),
--   S_eff = _dao_supply(chain) (the request is still pending, so its shares are inside it). From then on the fixed
--   amount is a liability (until its payout is recorded at or before the block the Safe is read at) and its shares
--   are out of S_eff (until burned), so the share price does not move.
--
--   Cached NAV (dao_state.value_usdc, read by dao_overview / dao_ranking / treasury_withdrawals): it is always
--   "assets - liabilities" at the last valuation, so every step that changes the liabilities keeps it in step in the
--   same transaction (F4c Task 2 carry i):
--     approve       value_usdc := NAV (fresh, as credit_donation does) - amount     approved_locked += shares
--     reject/expire value_usdc := value_usdc + amount                               approved_locked -= shares
--   With a fresh NAV the price after approval is (NAV - floor(s*NAV/S)) / (S - s) = NAV / S (up to the floor), which a
--   cached-minus-amount update could not guarantee when the market moved since the last snapshot.
--   Payout recording (Task 4) leaves value_usdc alone: the liability and the Safe's USDC drop by the same amount.
--
-- Lock order: request row (for update) -> chain_config (for share) -> dao_state (for update) -> dao_positions.

-- ===== _dao_liabilities_usd6 (latest 20261019100001) + approved, unpaid withdrawals =====
-- With a block: approved requests whose payout is not recorded at or before it (the USDC is still in the assets).
-- Without (read paths): every approved request without a payout.
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
                   where w.chain_id = p_chain and w.status = 'approved'
                     and case when p_at_block is null then w.payout_tx_hash is null
                              else w.payout_block is null or w.payout_block > p_at_block end), 0)
$$;

-- ===== credit_donation (latest 20261019100005): divides by S_eff =====
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

-- ===== record_nav_snapshot (latest 20261019300001): the snapshot's total_shares is S_eff after the club mint =====
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

-- ===== _withdrawal_valuation (internal): the checks shared by quote and approve, and the fixed amount =====
-- Expects the request row already read (and, for approve, locked). Raises in the plan's order after the request state:
-- withdrawals_disabled, safe_changed, chain_invalid, nav_not_ready, assets_stale, amount_too_small.
create function public._withdrawal_valuation(w public.withdrawal_requests, p_safe text, p_assets_usd6 numeric,
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

-- ===== quote_withdrawal (service_role): read-only, same checks as approve =====
create function public.quote_withdrawal(p_request uuid, p_safe text, p_assets_usd6 numeric, p_assets_block bigint)
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
     or p_assets_block is null or p_assets_block < 0 then
    raise exception 'invalid_input';
  end if;
  select * into w from public.withdrawal_requests x where x.id = p_request;
  if not found then
    raise exception 'not_found';
  end if;
  if w.status <> 'pending' then
    raise exception 'invalid_state';
  end if;

  select * into v from public._withdrawal_valuation(w, p_safe, p_assets_usd6, p_assets_block, false);

  return jsonb_build_object(
    'amountUsdc', v.amount::text,
    'navUsd6', v.nav::text,
    'supplyShares', v.supply::text,
    'reservedUsdc', (select coalesce(sum(x.amount_usdc_locked), 0)::text from public.withdrawal_requests x
                     where x.chain_id = w.chain_id and x.status = 'approved' and x.payout_tx_hash is null));
end;
$$;

-- ===== approve_withdrawal (service_role, after the server read the Safe) =====
create function public.approve_withdrawal(p_request uuid, p_actor uuid, p_safe text, p_assets_usd6 numeric,
                                          p_assets_block bigint)
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
     or p_assets_block is null or p_assets_block < 0 then
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
  select * into v from public._withdrawal_valuation(w, p_safe, p_assets_usd6, p_assets_block, true);

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

-- ===== reject_withdrawal (bit 256): from pending, or approved without a payout =====
create function public.reject_withdrawal(p_request uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  w public.withdrawal_requests;
begin
  if v_me is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  if char_length(v_reason) not between 1 and 280 then
    raise exception 'reason_required';
  end if;

  select * into w from public.withdrawal_requests x where x.id = p_request for update;
  if not found then
    raise exception 'not_found';
  end if;
  if not (w.status = 'pending' or (w.status = 'approved' and w.payout_tx_hash is null)) then
    raise exception 'invalid_state';
  end if;

  if w.status = 'approved' then
    -- the shares return to S_eff and the liability to the NAV
    update public.dao_state
    set approved_locked_shares = approved_locked_shares - w.shares,
        value_usdc = value_usdc + w.amount_usdc_locked,
        updated_at = now()
    where chain_id = w.chain_id;
  end if;

  update public.withdrawal_requests
  set status = 'rejected',
      amount_usdc_locked = null, -- the fixed amount stops existing (kept in the audit)
      rejected_by = v_me,
      rejected_at = now(),
      reject_reason = v_reason,
      updated_at = now()
  where id = w.id;

  update public.dao_positions
  set locked_shares = greatest(locked_shares - w.shares, 0), updated_at = now()
  where chain_id = w.chain_id and member_id = w.member_id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_me, 'withdrawal_rejected', 'withdrawal_request', w.id, jsonb_build_object(
    'request', w.id, 'reason', v_reason, 'previousStatus', w.status, 'amount', w.amount_usdc_locked::text));

  insert into public.notifications (recipient_id, kind, data)
  values (w.member_id, 'withdrawal_rejected', jsonb_build_object('requestId', w.id, 'reason', v_reason));
end;
$$;

-- ===== expire_withdrawal_approvals (service_role, cron after payout detection) =====
create function public.expire_withdrawal_approvals()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  w public.withdrawal_requests;
  v_n int := 0;
begin
  -- every request row first, in id order (lock order: request rows -> dao_state)
  select coalesce(array_agg(x.id order by x.id), '{}') into v_ids
  from (select r.id from public.withdrawal_requests r
        where r.status = 'approved' and r.payout_tx_hash is null and r.approved_at < now() - interval '14 days'
        order by r.id
        for update) x;

  for w in select * from public.withdrawal_requests r where r.id = any (v_ids) order by r.id loop
    update public.dao_state
    set approved_locked_shares = approved_locked_shares - w.shares,
        value_usdc = value_usdc + w.amount_usdc_locked,
        updated_at = now()
    where chain_id = w.chain_id;

    update public.withdrawal_requests
    set status = 'pending',
        amount_usdc_locked = null,
        approved_by = null,
        approved_at = null,
        self_approved = false,
        last_expired_at = now(),
        updated_at = now()
    where id = w.id;

    insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
    values (null, 'withdrawal_expired', 'withdrawal_request', w.id, jsonb_build_object(
      'request', w.id, 'amount', w.amount_usdc_locked::text, 'approvedAt', w.approved_at));

    insert into public.notifications (recipient_id, kind, data)
    values (w.member_id, 'withdrawal_expired', jsonb_build_object('requestId', w.id));

    insert into public.notifications (recipient_id, kind, data)
    select m.id, 'treasury_notice', jsonb_build_object('event', 'approval_expired', 'requestId', w.id)
    from public.members m
    where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;

    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ===== treasury_withdrawals (bit 256): active chain, open requests + closed in the last 30 days =====
create function public.treasury_withdrawals()
returns table (id uuid, member_id uuid, member_label text, wallet text, shares text, position_shares text, status text,
               created_at timestamptz, approved_at timestamptz, expires_at timestamptz, approved_by_label text,
               self_approved boolean, amount_usdc text, estimate_usd6 text, last_expired_at timestamptz,
               reject_reason text, payout_tx_hash text, payout_amount text, payout_recorded_at timestamptz,
               paid_at timestamptz)
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
         m.wallet_address,
         w.shares::text,
         coalesce(p.shares, 0)::text,
         w.status, w.created_at, w.approved_at, w.approved_at + interval '14 days',
         public._member_label(w.approved_by),
         w.self_approved,
         w.amount_usdc_locked::text,
         case when coalesce(v_supply, 0) > 0 then div(w.shares * coalesce(v_value, 0), v_supply)::text end,
         w.last_expired_at, w.reject_reason, w.payout_tx_hash, w.payout_amount::text, w.payout_recorded_at, w.paid_at
  from public.withdrawal_requests w
  join public.members m on m.id = w.member_id
  left join public.dao_positions p on p.chain_id = w.chain_id and p.member_id = w.member_id
  where w.chain_id = v_chain
    and (w.status in ('pending', 'approved')
         or coalesce(w.paid_at, w.rejected_at, w.cancelled_at) >= now() - interval '30 days')
  order by (w.status in ('pending', 'approved')) desc, w.created_at desc, w.id;
end;
$$;

-- ===== _push_build (latest 20261019100002): outflow url, treasury_notice gate, the five withdrawal kinds =====
create or replace function public._push_build(p_id bigint)
returns table (title text, body text, url text, tag text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  n public.notifications;
  v_perms bigint := 0;
  v_actor text;
  v_wallet text;
  v_channel text;
  v_subject text;
  v_phrase text;
  v_title text;
  v_url text;
  v_excerpt text;
  v_root text;
  v_asset text;
begin
  select * into n from public.notifications x where x.id = p_id;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.members m where m.id = n.recipient_id and m.status = 'active') then
    return;
  end if;
  if n.kind in ('mention', 'reply', 'channel_message') and n.channel_id is null then
    return;
  end if;
  if n.channel_id is not null then
    v_perms := public.channel_permissions(n.recipient_id, n.channel_id);
    if (v_perms & 1) = 0 then
      return;
    end if;
  end if;
  if n.ticket_id is not null and not public._member_can_access_ticket(n.recipient_id, n.ticket_id) then
    return;
  end if;
  if n.kind = 'report_new' and (v_perms & 8) = 0 then
    return;
  end if;
  if n.kind = 'member_review' and (public.member_global_permissions(n.recipient_id) & (32 | 512)) = 0 then
    return;
  end if;
  if n.kind = 'treasury_mismatch' and (public.member_global_permissions(n.recipient_id) & (256 | 512)) = 0 then
    return;
  end if;
  if n.kind = 'treasury_outflow' and (public.member_global_permissions(n.recipient_id) & (256 | 512)) = 0 then
    return;
  end if;
  if n.kind = 'treasury_notice' and (public.member_global_permissions(n.recipient_id) & (256 | 512)) = 0 then
    return;
  end if;

  select coalesce('@' || a.handle::text,
                  '@' || nullif(btrim(regexp_replace(a.display_name, '[[:cntrl:]]+', ' ', 'g')), ''),
                  '@' || left(a.wallet_address, 6) || '…' || right(a.wallet_address, 4)),
         a.wallet_address
    into v_actor, v_wallet
  from public.members a where a.id = n.actor_id;
  v_actor := coalesce(v_actor, case when n.kind = 'tip_received' then 'Anónimo' else 'Alguien' end);

  if n.channel_id is not null then
    select btrim(regexp_replace(c.name, '[[:cntrl:]]+', ' ', 'g')) into v_channel
    from public.channels c where c.id = n.channel_id;
  end if;
  if n.ticket_id is not null then
    select btrim(regexp_replace(t.subject, '[[:cntrl:]]+', ' ', 'g')) into v_subject
    from public.tickets t where t.id = n.ticket_id;
  end if;

  v_url := '/notifications';
  if n.kind in ('mention', 'reply', 'channel_message') then
    v_url := '/c/' || n.channel_id::text;
    v_root := n.data ->> 'thread_root_id';
    if n.message_id is not null then
      -- jump to (and highlight) the exact message, like the in-app link (src/lib/notifications/queries.ts)
      v_url := v_url || '?m=' || n.message_id::text;
      if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_url := v_url || '&thread=' || v_root;
      end if;
      v_url := v_url || '&h=n' || n.id::text;
    elsif v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_url := v_url || '?thread=' || v_root;
    end if;
    select btrim(left(btrim(regexp_replace(m.body_text, '[[:space:][:cntrl:]]+', ' ', 'g')), 80)) into v_excerpt
    from public.messages m
    where m.id = n.message_id and m.channel_id = n.channel_id and m.deleted_at is null;
    v_excerpt := nullif(v_excerpt, '');
  elsif n.kind in ('tip_received', 'bounty_solution', 'bounty_paid') then
    if n.channel_id is not null then
      v_url := '/c/' || n.channel_id::text;
      v_root := n.data ->> 'threadRootId';
      if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_url := v_url || '?thread=' || v_root;
      end if;
    end if;
  elsif n.kind in ('invite_redeemed', 'godchild_banned', 'sponsor_penalized') then
    if v_wallet is not null then
      v_url := '/u/' || v_wallet;
    end if;
  elsif n.kind = 'report_new' then
    v_url := '/moderation/reports';
  elsif n.kind = 'member_review' then
    v_url := '/admin/members';
  elsif n.kind = 'treasury_mismatch' then
    v_url := '/dao';
  elsif n.kind in ('treasury_outflow', 'treasury_notice') then
    v_url := '/dao/tesoreria'; -- ruling F4a-R1
  elsif n.kind in ('withdrawal_approved', 'withdrawal_rejected', 'withdrawal_paid', 'withdrawal_expired') then
    v_url := '/dao#retirada';
  elsif n.ticket_id is not null then
    v_url := '/tickets/' || n.ticket_id::text;
  end if;

  case n.kind
    when 'mention' then
      v_title := 'Nueva mención';
      v_phrase := v_actor || ' te mencionó en #' || coalesce(v_channel, '');
    when 'reply' then
      v_title := 'Nueva respuesta';
      v_phrase := v_actor || ' respondió en #' || coalesce(v_channel, '');
    when 'channel_message' then
      v_title := 'Nuevo mensaje';
      v_phrase := v_actor || ' publicó en #' || coalesce(v_channel, '');
    when 'tip_received' then
      v_title := 'Nueva propina';
      v_phrase := 'Has recibido una propina de ' || v_actor;
    when 'bounty_solution' then
      v_title := 'Solución elegida';
      v_phrase := v_actor || ' ha elegido tu respuesta como solución del bounty';
    when 'bounty_paid' then
      v_title := 'Bounty pagado';
      v_phrase := v_actor || ' te ha pagado el bounty';
    when 'invite_redeemed' then
      v_title := 'Invitación canjeada';
      v_phrase := v_actor || ' se unió con tu invitación';
    when 'godchild_banned' then
      v_title := 'Ahijado baneado';
      v_phrase := 'Tu ahijado ' || v_actor || ' ha sido baneado';
    when 'sponsor_penalized' then
      v_title := 'Penalización de padrino';
      v_phrase := 'Te han penalizado porque ' || v_actor || ' fue baneado';
    when 'report_new' then
      v_title := 'Nuevo reporte';
      v_phrase := v_actor || ' reportó un mensaje en #' || coalesce(v_channel, '');
    when 'member_review' then
      v_title := 'Miembro por revisar';
      v_phrase := v_actor || ' necesita revisión';
    when 'treasury_mismatch' then
      v_title := 'Descuadre en la tesorería';
      v_phrase := 'El saldo de la Safe no coincide con el registro de la DAO';
    when 'treasury_outflow' then
      v_asset := case when n.data ->> 'asset' in ('USDC', 'WETH', 'ETH') then n.data ->> 'asset' else null end;
      if v_asset is null or coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,60}$' then
        return;
      end if;
      v_title := 'Salida de la tesorería';
      -- WETH has 18 decimals like ETH: _format_token_amount knows only ETH (18) and USDC (6)
      v_phrase := public._format_token_amount((n.data ->> 'amount')::numeric, case when v_asset = 'USDC' then 'USDC' else 'ETH' end)
                  || ' ' || v_asset || ' salió de la Safe sin explicar';
    when 'withdrawal_approved' then
      if coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,60}$' then
        return;
      end if;
      v_title := 'Retirada aprobada';
      v_phrase := 'Tu retirada de ' || public._format_token_amount((n.data ->> 'amount')::numeric, 'USDC')
                  || ' USDC está aprobada. El tesorero la pagará desde la Safe.';
    when 'withdrawal_rejected' then
      v_title := 'Retirada rechazada';
      v_phrase := 'El tesorero rechazó tu retirada';
      v_excerpt := nullif(btrim(left(btrim(regexp_replace(coalesce(n.data ->> 'reason', ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 80)), '');
    when 'withdrawal_paid' then
      if coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,60}$' then
        return;
      end if;
      v_title := 'Retirada pagada';
      v_phrase := 'Has recibido ' || public._format_token_amount((n.data ->> 'amount')::numeric, 'USDC') || ' USDC de la tesorería.';
    when 'withdrawal_expired' then
      v_title := 'Aprobación caducada';
      v_phrase := 'Tu retirada no se pagó en 14 días y vuelve a estar pendiente de aprobación.';
    when 'treasury_notice' then
      v_title := 'Aviso de tesorería';
      v_phrase := case n.data ->> 'event'
                    when 'withdrawal_requested' then 'Hay una nueva solicitud de retirada.'
                    when 'approval_expired' then 'Una retirada aprobada caducó sin pagarse.'
                  end;
      if v_phrase is null then
        return;
      end if;
    when 'ticket_new' then
      v_title := 'Nuevo ticket';
      v_phrase := v_actor || ' abrió un ticket: ' || coalesce(v_subject, '');
    when 'ticket_reply' then
      v_title := 'Respuesta en un ticket';
      v_phrase := v_actor || ' escribió en el ticket: ' || coalesce(v_subject, '');
    when 'ticket_status' then
      if n.data ->> 'status' = 'closed' then
        v_title := 'Ticket cerrado';
        v_phrase := v_actor || ' cerró el ticket: ' || coalesce(v_subject, '');
      else
        v_title := 'Ticket reabierto';
        v_phrase := v_actor || ' reabrió el ticket: ' || coalesce(v_subject, '');
      end if;
    else
      return;
  end case;

  title := v_title;
  body := case when v_excerpt is not null then v_phrase || ': «' || v_excerpt || '»' else v_phrase end;
  url := v_url;
  tag := n.kind || ':' || coalesce(n.message_id::text, n.ticket_id::text, n.id::text);
  return next;
end;
$$;

-- ===== grants =====
revoke execute on function
  public._withdrawal_valuation(public.withdrawal_requests, text, numeric, bigint, boolean),
  public.quote_withdrawal(uuid, text, numeric, bigint),
  public.approve_withdrawal(uuid, uuid, text, numeric, bigint),
  public.expire_withdrawal_approvals(),
  public.reject_withdrawal(uuid, text),
  public.treasury_withdrawals()
from public, anon, authenticated, service_role;

grant execute on function
  public.quote_withdrawal(uuid, text, numeric, bigint),
  public.approve_withdrawal(uuid, uuid, text, numeric, bigint),
  public.expire_withdrawal_approvals()
to service_role;

grant execute on function
  public.reject_withdrawal(uuid, text),
  public.treasury_withdrawals()
to authenticated;
