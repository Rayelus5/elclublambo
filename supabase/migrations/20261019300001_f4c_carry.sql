-- F4c Task 1: carry from F4a (treasury admin).
--   (a) The cron writers take the Safe address they read and refuse (safe_changed) when it is null or differs from
--       chain_config.safe_address, read `for share` before any write. A Safe change that lands between the cron's
--       read and its write can therefore never store the old Safe's balances, operations or ETH cursor against the new
--       one (set_chain_addresses takes chain_config `for update`). The old overloads are dropped.
--   (b) create_donation_intent reads chain_config `for share`: an intent is either created against the Safe that
--       stays, or it exists before set_chain_addresses looks for open intents (and blocks the change).
--   (c) cancel_open_donation_intents (bit 512) expires a chain's pending donation intents that have no transaction
--       attached, so a Safe change blocked only by abandoned intents can go ahead. Attached ones keep blocking: they may
--       be real payments.
--   (d) A Safe reset also deletes the unread treasury_outflow notices of the operations it deletes (read ones stay).
-- Lock order: chain_config (share) -> dao_state (update), as set_chain_addresses (update -> update).

-- ===== (a) record_nav_snapshot(p_chain, p_safe, p_snapshot): body from 20261019100001 + the Safe check =====
drop function public.record_nav_snapshot(int, jsonb);

create function public.record_nav_snapshot(p_chain int, p_safe text, p_snapshot jsonb)
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

-- ===== (a) record_safe_operations(p_chain, p_safe, p_ops, p_to_block): body from 20261019100003 + the Safe check =====
drop function public.record_safe_operations(int, jsonb, bigint);

create function public.record_safe_operations(p_chain int, p_safe text, p_ops jsonb, p_to_block bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op jsonb;
  v_hash text;
  v_log int;
  v_asset text;
  v_dir text;
  v_amount numeric;
  v_block bigint;
  v_at timestamptz;
  v_cp text;
  v_id uuid;
  v_ledger uuid;
  v_n int;
  v_inserted int := 0;
  v_alerts int := 0;
  v_cfg_safe text;
begin
  if p_chain not in (59144, 59141) or p_to_block is null or p_to_block < 0
     or p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'invalid_input';
  end if;

  -- the logs must be the configured Safe's (held until commit: a Safe change waits for this batch)
  select c.safe_address into v_cfg_safe from public.chain_config c where c.chain_id = p_chain for share;
  if p_safe is null or v_cfg_safe is null or lower(p_safe) <> v_cfg_safe then
    raise exception 'safe_changed';
  end if;

  for v_op in select e from jsonb_array_elements(p_ops) e loop
    begin
      v_hash := lower(nullif(v_op ->> 'txHash', ''));
      v_log := (v_op ->> 'logIndex')::int;
      v_asset := v_op ->> 'asset';
      v_dir := v_op ->> 'direction';
      v_amount := (v_op ->> 'amount')::numeric;
      v_block := (v_op ->> 'blockNumber')::bigint;
      v_at := (v_op ->> 'occurredAt')::timestamptz;
    exception when others then
      raise exception 'invalid_input';
    end;
    v_cp := lower(nullif(v_op ->> 'counterparty', ''));
    if v_asset is null or v_asset not in ('USDC', 'WETH', 'ETH') or v_dir is null or v_dir not in ('in', 'out')
       or v_amount is null or v_amount <= 0 or v_amount <> trunc(v_amount) or v_block is null or v_block < 0
       or v_at is null or (v_hash is null) <> (v_log is null) or v_log < 0
       or (v_hash is not null and v_hash !~ '^0x[0-9a-f]{64}$')
       or (v_cp is not null and v_cp !~ '^0x[0-9a-f]{40}$') then
      raise exception 'invalid_input';
    end if;

    v_ledger := null;
    if v_asset = 'USDC' and v_dir = 'in' and v_hash is not null then
      select l.id into v_ledger from public.dao_ledger l
      where l.chain_id = p_chain and l.tx_hash = v_hash and l.log_index = v_log limit 1;
    end if;

    v_id := null;
    insert into public.dao_safe_operations
      (chain_id, tx_hash, log_index, asset, direction, amount, counterparty, block_number, occurred_at, ledger_id)
    values (p_chain, v_hash, v_log, v_asset, v_dir, v_amount, v_cp, v_block, v_at, v_ledger)
    on conflict do nothing
    returning id into v_id;

    if v_id is not null then
      v_inserted := v_inserted + 1;
      if v_dir = 'out' then
        insert into public.notifications (recipient_id, kind, data)
        select m.id, 'treasury_outflow',
               jsonb_build_object('opId', v_id, 'asset', v_asset, 'amount', v_amount::text)
        from public.members m
        where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;
        get diagnostics v_n = row_count;
        v_alerts := v_alerts + v_n;
        update public.dao_safe_operations set alerted_at = clock_timestamp() where id = v_id;
      end if;
    end if;
  end loop;

  insert into public.dao_scan_state (chain_id, last_block) values (p_chain, p_to_block)
  on conflict (chain_id) do update set last_block = greatest(public.dao_scan_state.last_block, excluded.last_block);

  return jsonb_build_object('inserted', v_inserted, 'alerts', v_alerts);
end;
$$;

-- ===== (a) set_dao_eth_cursor(p_chain, p_safe, p_block): body from 20261019100004 + the Safe check =====
drop function public.set_dao_eth_cursor(int, bigint);

create function public.set_dao_eth_cursor(p_chain int, p_safe text, p_block bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg_safe text;
begin
  if p_chain is null or p_chain not in (59144, 59141) or p_block is null or p_block < 0 then
    raise exception 'invalid_input';
  end if;
  select c.safe_address into v_cfg_safe from public.chain_config c where c.chain_id = p_chain for share;
  if p_safe is null or v_cfg_safe is null or lower(p_safe) <> v_cfg_safe then
    raise exception 'safe_changed';
  end if;
  update public.dao_scan_state
     set eth_block = greatest(eth_block, p_block)
   where chain_id = p_chain;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke execute on function
  public.record_nav_snapshot(int, text, jsonb),
  public.record_safe_operations(int, text, jsonb, bigint),
  public.set_dao_eth_cursor(int, text, bigint)
from public, anon, authenticated, service_role;
grant execute on function
  public.record_nav_snapshot(int, text, jsonb),
  public.record_safe_operations(int, text, jsonb, bigint),
  public.set_dao_eth_cursor(int, text, bigint)
to service_role;

-- ===== (b) create_donation_intent: body from 20261019100005, chain_config read for share =====
create or replace function public.create_donation_intent(p_amount numeric, p_fee_bps int, p_acknowledged boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_min_fee int;
  v_fee numeric;
  v_safe text;
  v_platform text;
  v_id uuid;
  v_exp timestamptz;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_acknowledged is distinct from true then
    raise exception 'acknowledgement_required';
  end if;
  if p_amount is null or p_amount <> trunc(p_amount) or p_fee_bps is null then
    raise exception 'invalid_input';
  end if;
  -- 1 USDC .. 1000000 USDC
  if p_amount < 1000000 or p_amount > 1000000::numeric * 1000000 then
    raise exception 'amount_out_of_range';
  end if;

  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select (c.value #>> '{}')::int into v_min_fee from public.app_config c where c.key = 'min_fee_bps';
  if v_chain is null or v_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if p_fee_bps < 0 or p_fee_bps > 5000 then
    raise exception 'fee_out_of_range';
  end if;
  if p_fee_bps < coalesce(v_min_fee, 0) then
    raise exception 'fee_below_minimum';
  end if;

  -- for share (F4a carry b): a concurrent Safe change waits for this intent, then sees it and is blocked
  select cc.safe_address, cc.platform_wallet into v_safe, v_platform
  from public.chain_config cc where cc.chain_id = v_chain for share;
  if v_safe is null then
    raise exception 'safe_not_configured';
  end if;

  v_fee := div(p_amount * p_fee_bps + 9999, 10000);
  if v_fee > 0 and v_platform is null then
    raise exception 'platform_not_configured';
  end if;

  -- same lock key and cap as tip intents
  perform pg_advisory_xact_lock(hashtextextended('tip_intent:' || v_me::text, 0));
  if (select count(*) from public.payment_intents i
      where i.member_id = v_me and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, platform_address,
                                      target_type, target_id, anonymous)
  values (v_me, 'donation', v_chain, 'USDC', p_amount, p_fee_bps, coalesce(v_min_fee, 0), v_fee,
          null, v_safe, case when v_fee > 0 then v_platform end,
          'dao', null, false)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', v_chain, 'token', 'USDC',
    'amount', p_amount::text, 'feeAmount', v_fee::text,
    'recipientAddress', v_safe, 'platformAddress', case when v_fee > 0 then v_platform end,
    'expiresAt', v_exp);
end;
$$;

-- ===== (c) cancel_open_donation_intents (bit 512) =====
create function public.cancel_open_donation_intents(p_chain int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_n int;
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;

  -- same lock order as set_chain_addresses (chain_config first)
  perform 1 from public.chain_config c where c.chain_id = p_chain for share;

  -- intents with a transaction attached may be real payments: they keep blocking a Safe change
  update public.payment_intents i
     set status = 'expired'
   where i.chain_id = p_chain and i.purpose = 'donation' and i.status = 'pending' and i.hashes_attached_at is null;
  get diagnostics v_n = row_count;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'economy.intents_cancelled', jsonb_build_object('chain', p_chain, 'count', v_n));

  return v_n;
end;
$$;

revoke execute on function public.cancel_open_donation_intents(int) from public, anon, authenticated, service_role;
grant execute on function public.cancel_open_donation_intents(int) to authenticated;

-- ===== (d) set_chain_addresses: body from 20261019100005; the reset first deletes unread outflow notices =====
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
    -- the value of shares, pending donations and still-confirmable donation intents lives in the old Safe
    if coalesce(s.total_shares, 0) > 0
       or exists (select 1 from public.dao_ledger l
                  where l.chain_id = p_chain and l.status = 'pending_finality')
       or exists (select 1 from public.payment_intents i
                  where i.chain_id = p_chain and i.purpose = 'donation' and i.status = 'pending'
                    and (i.expires_at > now()
                         or (i.hashes_attached_at is not null and i.hashes_attached_at <= i.expires_at
                             and now() <= i.created_at + interval '7 days'))) then
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
