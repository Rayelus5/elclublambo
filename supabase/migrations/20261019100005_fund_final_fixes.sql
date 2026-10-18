-- F4a final review fixes.
--
--   F4a-R11 (amends R8): the donation risk acknowledgement is enforced in SQL. create_donation_intent is granted to
--     authenticated, so a check in the server action alone could be skipped by calling the RPC with the member's JWT.
--     The RPC now takes p_acknowledged and raises acknowledgement_required unless it is true; the 2-argument overload
--     is dropped so no door remains without it. A created donation intent therefore implies consent.
--   F4a-R12: set_chain_addresses refuses changing a chain's Safe while that chain has shares, pending (not yet
--     credited) donations or donation intents that can still be confirmed (safe_change_blocked): their value lives in
--     the old Safe. A Safe change that nothing blocks clears that chain's operations scan state (incl. the ETH cursor),
--     NAV snapshots, Safe operations and the NAV cache (nav_initialized = false), so the new Safe starts clean: no
--     backfill from a stale cursor, no ETH diff against another wallet, and the funds already in it go to the club fund
--     at the first donation. Saving the same Safe (any case) is not a change and clears nothing.
--   Minor 2: credit_donation refuses an assets read older than a block already credited on the chain (assets_stale,
--     transient like R4): a credited donation is no longer a liability, so a read that predates its money would
--     understate NAV and over-issue. Defensive: settle reads at latest >= finalized >= every credited block.

-- ===== F4a-R11: create_donation_intent(p_amount, p_fee_bps, p_acknowledged) =====
-- Same body as 20261018800001 plus the acknowledgement, checked right after membership (before amounts and config).
drop function public.create_donation_intent(numeric, int);

create function public.create_donation_intent(p_amount numeric, p_fee_bps int, p_acknowledged boolean)
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

  select cc.safe_address, cc.platform_wallet into v_safe, v_platform
  from public.chain_config cc where cc.chain_id = v_chain;
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

revoke execute on function public.create_donation_intent(numeric, int, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_donation_intent(numeric, int, boolean) to authenticated;

-- ===== F4a-R12: set_chain_addresses guards and resets on a Safe change =====
-- Same as 20261018800020 (M6) plus the Safe-change guard and reset. Lock order: chain_config, then dao_state (the row
-- credit_donation and record_nav_snapshot lock), so a credit or snapshot cannot interleave with the reset.
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

-- ===== minor 2: credit_donation refuses a read older than a credited block =====
create index dao_ledger_credited_block_idx on public.dao_ledger (chain_id, block_number desc) where status = 'credited';

-- Same as 20261019100001 plus the credited-block guard, checked under the dao_state lock (every credit takes it, so
-- a credit that commits first is visible to this statement).
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
