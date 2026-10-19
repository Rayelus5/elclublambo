-- F4d final review fixes (rulings F4d-R6, F4d-R7).
--
--   F4d-R6 (record_safe_operations, latest 20261019400004): when an outflow matches both a withdrawal candidate and a
--   prize candidate (same wallet, both owed), the scan chooses by fit across kinds, not by plain withdrawal
--   precedence: an exact amount first (the withdrawal's on a double exact), else the larger owed amount (both are
--   <= the outflow), and the withdrawal on a tie. Before, a 25 USDC prize payout to a member who also had a 20 USDC
--   approved withdrawal was linked to (and recorded for) the withdrawal: the fund overpaid it and the prize stayed owed.
--   The recorded payouts of both kinds are still matched first (F4d-R4). Within a kind the candidate choice is
--   unchanged (withdrawal: oldest approval; prize: largest prize it covers, then oldest draw). Both candidate rows are
--   locked (for update) before the choice, in the existing order (withdrawal row, then raffle row), so the choice is
--   made on re-checked rows; the one not chosen stays locked until the scan commits, which only delays a concurrent
--   record / reject / revert of it (no new lock cycle: no record function holds a raffle row while waiting for a
--   withdrawal row or the other way round).
--
--   F4d-R7 (create_raffle, latest 20261019400003): a prize may be worth at most half the cached fund value. Exact
--   comparison, integers only: prize_too_large when prize_value_usd6 * 2 > dao_state.value_usdc (so exactly half is
--   allowed). A prize equal to the whole fund drove the cached NAV to 0 while shares existed, and credit_donation then
--   refused every donation (invalid_state) until the raffle ended. Everything else in create_raffle is unchanged.
-- Lock order unchanged (raffle / request row -> chain_config -> dao_state -> dao_positions; the scan's exception of
-- 20261019300004 stays).

-- ===== record_safe_operations (latest 20261019400004): fit across kinds in the candidate step =====
create or replace function public.record_safe_operations(p_chain int, p_safe text, p_ops jsonb, p_to_block bigint)
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
  v_withdrawal uuid;
  v_raffle uuid;
  v_wcand uuid;
  v_wowed numeric;
  v_rcand uuid;
  v_rowed numeric;
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

    -- F4d-R4: the recorded payouts of both kinds first (a pasted payout is never captured by the other kind's
    -- candidate), then the candidates, chosen by fit across kinds (F4d-R6)
    v_withdrawal := null;
    v_raffle := null;
    v_wcand := null;
    v_wowed := null;
    v_rcand := null;
    v_rowed := null;
    if v_dir = 'out' and v_hash is not null and v_asset in ('USDC', 'WETH') then
      if v_asset = 'USDC' then
        select w.id into v_withdrawal from public.withdrawal_requests w
        where w.chain_id = p_chain and w.payout_tx_hash = v_hash and w.payout_log_index = v_log
        for share of w; -- carry C: a concurrent revert is waited for, then the payout is re-checked
      end if;
      if v_withdrawal is null then
        select r.id into v_raffle from public.raffles r
        where r.chain_id = p_chain and r.prize_token = v_asset and r.payout_tx_hash = v_hash and r.payout_log_index = v_log
        for share of r; -- a concurrent revert is waited for, then the payout is re-checked
      end if;
      if v_withdrawal is null and v_raffle is null and v_cp is not null then
        -- F4c: an approved request still unpaid that the USDC outflow pays in full
        if v_asset = 'USDC' then
          select w.id, w.amount_usdc_locked into v_wcand, v_wowed from public.withdrawal_requests w
          where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null
            and w.destination_address = v_cp and v_amount >= w.amount_usdc_locked
            and v_at >= w.approved_at - interval '120 seconds' and v_at <= w.approved_at + interval '14 days'
          order by w.approved_at, w.id
          limit 1
          for update of w; -- waits for a concurrent record / reject, then re-checks (header: lock-order exception)
        end if;
        -- F4d: a drawn raffle without a payout whose winner it pays at least the prize, in the prize token, after the
        -- draw. The largest prize it covers (an exact amount is that one), then the oldest draw.
        select r.id, r.prize_amount into v_rcand, v_rowed from public.raffles r
        where r.chain_id = p_chain and r.status = 'drawn' and r.payout_tx_hash is null
          and r.prize_token = v_asset and r.winner_address = v_cp and v_amount >= r.prize_amount
          and v_at >= r.drawn_at - interval '120 seconds'
        order by r.prize_amount desc, r.drawn_at, r.id
        limit 1
        for update of r; -- waits for a concurrent record / revert, then re-checks (header: lock-order exception)
        -- F4d-R6: exact amount first (the withdrawal's on a double exact), else the larger owed amount; a tie goes to
        -- the withdrawal. Both owed amounts are <= the outflow, so "larger" is "largest owed amount it covers".
        if v_wcand is not null
           and (v_rcand is null or v_wowed = v_amount or (v_rowed <> v_amount and v_wowed >= v_rowed)) then
          v_withdrawal := v_wcand;
        else
          v_raffle := v_rcand;
        end if;
      end if;
    end if;

    v_id := null;
    insert into public.dao_safe_operations
      (chain_id, tx_hash, log_index, asset, direction, amount, counterparty, block_number, occurred_at, ledger_id,
       withdrawal_id, raffle_id)
    values (p_chain, v_hash, v_log, v_asset, v_dir, v_amount, v_cp, v_block, v_at, v_ledger, v_withdrawal, v_raffle)
    on conflict do nothing
    returning id into v_id;

    if v_id is not null then
      v_inserted := v_inserted + 1;
      if v_dir = 'out' and v_withdrawal is null and v_raffle is null then
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

-- ===== create_raffle (latest 20261019400003): F4d-R7, at most half the cached fund value =====
create or replace function public.create_raffle(p_title text, p_prize_token text, p_prize_amount numeric, p_closes_at timestamptz,
                                     p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_title text := btrim(coalesce(p_title, ''), E' \t\n\r\f\v');
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
  -- F4d-R7: at most half the cached fund value (exactly half is allowed)
  if v_value * 2 > s.value_usdc then
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
