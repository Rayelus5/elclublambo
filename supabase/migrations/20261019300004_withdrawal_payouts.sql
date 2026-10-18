-- F4c Task 4: verified withdrawal payouts. Outflow matching, payout recording, burn at finality, revert.
--
--   Two phases (plan decision): the server (pasted hash) or the cron (detected outflow) verifies the USDC transfer on
--   chain with TIP_CONFIRMATIONS and calls record_withdrawal_payout. From payout_block on the fixed amount is no longer a
--   liability (the USDC left the Safe), so value_usdc is NOT touched: the liability and the Safe's USDC drop together.
--   At finality (and after a TS re-verification) finalize_withdrawal burns the shares: total_shares and
--   approved_locked_shares drop by the same amount, so S_eff and value_usdc are unchanged and so is the share price.
--   A payout that fails permanently is reverted: the request is approved again with its fixed amount as a liability.
--   The cache needs no change there either, because every valuation is bounded by block (the payout only stops being a
--   liability for Safe reads at or after its block, and a reverted payout never left the Safe).
--
--   _dao_liabilities_usd6 (Task 3 carry iv): with a block, paid requests whose payout_block is after it also count.
--   A Safe read before the payout block still holds that USDC, so a burned request must not overstate the NAV there.
--
--   record_safe_operations links a USDC outflow to a withdrawal request (no treasury_outflow alert) when it is the
--   request's recorded payout, or when it matches an approved request without a payout: destination, amount >= fixed
--   amount and occurred_at in [approved_at - 120 s, approved_at + 14 d]. Recording a payout unlinks any other outflow
--   linked to the same request, and a revert unlinks the payout's: such an outflow is unexplained again and alerts the
--   treasurers once (alerted_at).
--
--   dao_operations: a linked outflow is explained, its note defaults to "Retirada de un miembro" and its hash is shown
--   only to treasurers (the explorer would reveal the recipient). No column names the counterparty.
--
-- Lock order: request row (for update) -> chain_config (for share) -> dao_state (for update) -> dao_positions.

-- ===== _dao_liabilities_usd6 (latest 20261019300003): paid requests count for reads before their payout block =====
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
                     and case when p_at_block is null then w.status = 'approved' and w.payout_tx_hash is null
                              else w.status in ('approved', 'paid')
                                   and (w.payout_block is null or w.payout_block > p_at_block) end), 0)
$$;

-- ===== _withdrawal_unlink_ops (internal): unlink a request's other outflows; alert each one once =====
create function public._withdrawal_unlink_ops(p_request uuid, p_keep_hash text, p_keep_log int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.dao_safe_operations;
begin
  for o in select * from public.dao_safe_operations x
           where x.withdrawal_id = p_request
             and (p_keep_hash is null or x.tx_hash is distinct from p_keep_hash or x.log_index is distinct from p_keep_log)
           order by x.id
           for update loop
    update public.dao_safe_operations set withdrawal_id = null where id = o.id;
    if o.alerted_at is null then
      insert into public.notifications (recipient_id, kind, data)
      select m.id, 'treasury_outflow', jsonb_build_object('opId', o.id, 'asset', o.asset, 'amount', o.amount::text)
      from public.members m
      where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;
      update public.dao_safe_operations set alerted_at = clock_timestamp() where id = o.id;
    end if;
  end loop;
end;
$$;

-- ===== record_withdrawal_payout (service_role, after the server or the cron verified the transfer) =====
-- p_payout = {txHash, logIndex, blockNumber, blockTime (iso), to, amount}; p_actor null = detected by the cron.
create function public.record_withdrawal_payout(p_request uuid, p_safe text, p_payout jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
  v_hash text;
  v_log int;
  v_block bigint;
  v_at timestamptz;
  v_to text;
  v_amount numeric;
  v_cfg_safe text;
begin
  if p_actor is not null
     and (not exists (select 1 from public.members m where m.id = p_actor and m.status = 'active')
          or (public.member_global_permissions(p_actor) & 256) = 0) then
    raise exception 'forbidden';
  end if;
  if p_payout is null or jsonb_typeof(p_payout) <> 'object'
     or coalesce(lower(p_payout ->> 'txHash'), '') !~ '^0x[0-9a-f]{64}$'
     or coalesce(p_payout ->> 'logIndex', '') !~ '^[0-9]{1,9}$'
     or coalesce(p_payout ->> 'blockNumber', '') !~ '^[0-9]{1,18}$'
     or coalesce(lower(p_payout ->> 'to'), '') !~ '^0x[0-9a-f]{40}$'
     or coalesce(p_payout ->> 'amount', '') !~ '^[0-9]{1,78}$' then
    raise exception 'invalid_input';
  end if;
  begin
    v_at := (p_payout ->> 'blockTime')::timestamptz;
  exception when others then
    raise exception 'invalid_input';
  end;
  v_hash := lower(p_payout ->> 'txHash');
  v_log := (p_payout ->> 'logIndex')::int;
  v_block := (p_payout ->> 'blockNumber')::bigint;
  v_to := lower(p_payout ->> 'to');
  v_amount := (p_payout ->> 'amount')::numeric;
  if v_at is null or v_amount <= 0 then
    raise exception 'invalid_input';
  end if;

  select * into w from public.withdrawal_requests x where x.id = p_request for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- the transfer must come from the configured Safe (held until commit: a Safe change waits for this write)
  select c.safe_address into v_cfg_safe from public.chain_config c where c.chain_id = w.chain_id for share;
  if p_safe is null or v_cfg_safe is null or lower(p_safe) <> v_cfg_safe then
    raise exception 'safe_changed';
  end if;

  if w.payout_tx_hash = v_hash and w.payout_log_index = v_log then
    return jsonb_build_object('status', 'already');
  end if;
  if w.status <> 'approved' or w.payout_tx_hash is not null then
    if w.status = 'pending' and w.last_expired_at is not null then
      raise exception 'approval_expired';
    end if;
    raise exception 'invalid_state';
  end if;

  if exists (select 1 from public.withdrawal_requests x
             where x.chain_id = w.chain_id and x.id <> w.id and x.payout_tx_hash = v_hash and x.payout_log_index = v_log)
     or exists (select 1 from public.dao_ledger l where l.chain_id = w.chain_id and l.tx_hash = v_hash) then
    raise exception 'tx_already_used';
  end if;
  if v_to <> w.destination_address or v_amount < w.amount_usdc_locked then
    raise exception 'tx_mismatch';
  end if;
  if v_at < w.approved_at - interval '120 seconds' then
    raise exception 'tx_too_old';
  end if;
  if v_at > w.approved_at + interval '14 days' then
    raise exception 'approval_expired';
  end if;

  begin
    update public.withdrawal_requests
    set payout_tx_hash = v_hash,
        payout_log_index = v_log,
        payout_block = v_block,
        payout_amount = v_amount,
        payout_recorded_at = now(),
        payout_recorded_by = p_actor,
        updated_at = now()
    where id = w.id;
  exception when unique_violation then
    raise exception 'tx_already_used';
  end;

  -- the payout's outflow is explained by this request; any other outflow linked to it is not
  perform public._withdrawal_unlink_ops(w.id, v_hash, v_log);
  update public.dao_safe_operations
  set withdrawal_id = w.id
  where chain_id = w.chain_id and tx_hash = v_hash and log_index = v_log and asset = 'USDC' and direction = 'out';

  if p_actor is not null then
    insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
    values (p_actor, 'withdrawal_payout_recorded', 'withdrawal_request', w.id, jsonb_build_object(
      'request', w.id, 'txHash', v_hash, 'logIndex', v_log, 'blockNumber', v_block, 'amount', v_amount::text));
  end if;

  return jsonb_build_object('status', 'recorded');
end;
$$;

-- ===== finalize_withdrawal (service_role, the cron after re-verifying the payout at finality) =====
create function public.finalize_withdrawal(p_request uuid, p_safe text, p_finalized_block bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
  v_cfg_safe text;
begin
  if p_finalized_block is null or p_finalized_block < 0 then
    raise exception 'invalid_input';
  end if;

  select * into w from public.withdrawal_requests x where x.id = p_request for update;
  if not found then
    raise exception 'not_found';
  end if;
  if w.status = 'paid' then
    return jsonb_build_object('status', 'already');
  end if;
  if w.status <> 'approved' then
    raise exception 'invalid_state';
  end if;

  select c.safe_address into v_cfg_safe from public.chain_config c where c.chain_id = w.chain_id for share;
  if p_safe is null or v_cfg_safe is null or lower(p_safe) <> v_cfg_safe then
    raise exception 'safe_changed';
  end if;

  if w.payout_tx_hash is null or w.payout_block > p_finalized_block then
    return jsonb_build_object('status', 'pending');
  end if;

  -- burn: total and approved drop together, so S_eff and value_usdc (and the share price) do not move
  update public.dao_state
  set total_shares = total_shares - w.shares,
      approved_locked_shares = approved_locked_shares - w.shares,
      updated_at = now()
  where chain_id = w.chain_id;

  update public.dao_positions
  set shares = shares - w.shares,
      locked_shares = 0,
      net_contributed_usdc = greatest(net_contributed_usdc - w.payout_amount, 0),
      updated_at = now()
  where chain_id = w.chain_id and member_id = w.member_id;

  update public.withdrawal_requests
  set status = 'paid', paid_at = now(), updated_at = now()
  where id = w.id;

  insert into public.notifications (recipient_id, kind, data)
  values (w.member_id, 'withdrawal_paid', jsonb_build_object('requestId', w.id, 'amount', w.payout_amount::text));

  return jsonb_build_object('status', 'paid');
end;
$$;

-- ===== revert_withdrawal_payout (service_role, the payout failed permanently) =====
create function public.revert_withdrawal_payout(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
begin
  select * into w from public.withdrawal_requests x where x.id = p_request for update;
  if not found then
    raise exception 'not_found';
  end if;
  if w.status <> 'approved' or w.payout_tx_hash is null then
    raise exception 'invalid_state';
  end if;

  update public.withdrawal_requests
  set payout_tx_hash = null,
      payout_log_index = null,
      payout_block = null,
      payout_amount = null,
      payout_recorded_at = null,
      payout_recorded_by = null,
      updated_at = now()
  where id = w.id;

  -- its outflow is unexplained again
  perform public._withdrawal_unlink_ops(w.id, null, null);
end;
$$;

-- ===== withdrawal_payout_candidates (service_role): linked outflows of approved requests without a payout =====
create function public.withdrawal_payout_candidates(p_chain int)
returns table (request_id uuid, tx_hash text, log_index int, destination text, amount_usdc_locked text,
               approved_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, o.tx_hash, o.log_index, w.destination_address, w.amount_usdc_locked::text, w.approved_at
  from public.dao_safe_operations o
  join public.withdrawal_requests w on w.id = o.withdrawal_id
  where o.chain_id = p_chain and w.chain_id = p_chain and o.asset = 'USDC' and o.direction = 'out'
    and o.tx_hash is not null and w.status = 'approved' and w.payout_tx_hash is null
  order by w.approved_at, o.block_number, o.tx_hash, o.log_index
$$;

-- ===== withdrawals_awaiting_finality (service_role): recorded payouts not yet burned =====
create function public.withdrawals_awaiting_finality(p_chain int)
returns table (request_id uuid, tx_hash text, destination text, amount_usdc_locked text, approved_at timestamptz,
               payout_block text, payout_recorded_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.payout_tx_hash, w.destination_address, w.amount_usdc_locked::text, w.approved_at,
         w.payout_block::text, w.payout_recorded_at
  from public.withdrawal_requests w
  where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is not null
  order by w.payout_block, w.id
$$;

-- ===== record_safe_operations (latest 20261019300001) + withdrawal payout matching =====
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

    -- F4c: a USDC outflow that is a request's recorded payout, or that matches an approved request still unpaid
    v_withdrawal := null;
    if v_asset = 'USDC' and v_dir = 'out' and v_hash is not null then
      select w.id into v_withdrawal from public.withdrawal_requests w
      where w.chain_id = p_chain and w.payout_tx_hash = v_hash and w.payout_log_index = v_log;
      if v_withdrawal is null and v_cp is not null then
        select w.id into v_withdrawal from public.withdrawal_requests w
        where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null
          and w.destination_address = v_cp and v_amount >= w.amount_usdc_locked
          and v_at >= w.approved_at - interval '120 seconds' and v_at <= w.approved_at + interval '14 days'
        order by w.approved_at, w.id
        limit 1;
      end if;
    end if;

    v_id := null;
    insert into public.dao_safe_operations
      (chain_id, tx_hash, log_index, asset, direction, amount, counterparty, block_number, occurred_at, ledger_id,
       withdrawal_id)
    values (p_chain, v_hash, v_log, v_asset, v_dir, v_amount, v_cp, v_block, v_at, v_ledger, v_withdrawal)
    on conflict do nothing
    returning id into v_id;

    if v_id is not null then
      v_inserted := v_inserted + 1;
      if v_dir = 'out' and v_withdrawal is null then
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

-- ===== dao_operations (latest 20261019100003): withdrawal payouts are explained, their hash only for treasurers =====
create or replace function public.dao_operations(p_limit int default 30)
returns table (id uuid, asset text, direction text, amount text, tx_hash text, occurred_at timestamptz, note text, explained boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_treasurer boolean;
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  v_treasurer := public.has_global_perm(256);
  return query
  select o.id, o.asset, o.direction, o.amount::text,
         case when o.withdrawal_id is not null then case when v_treasurer then o.tx_hash end
              when o.direction = 'out' or v_treasurer then o.tx_hash end,
         o.occurred_at,
         case when o.withdrawal_id is not null then coalesce(o.note, 'Retirada de un miembro') else o.note end,
         (o.direction = 'in' or o.note is not null or o.withdrawal_id is not null)
  from public.dao_safe_operations o
  where o.chain_id = (select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id')
    and o.ledger_id is null
    and (o.direction = 'out' or o.note is not null or v_treasurer)
  order by o.occurred_at desc, o.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
end;
$$;

-- ===== reject_withdrawal (latest 20261019300003): every kind of whitespace is trimmed (Task 3 carry vi) =====
create or replace function public.reject_withdrawal(p_request uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_reason text := regexp_replace(coalesce(p_reason, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
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

-- ===== grants =====
revoke execute on function
  public._withdrawal_unlink_ops(uuid, text, int),
  public.record_withdrawal_payout(uuid, text, jsonb, uuid),
  public.finalize_withdrawal(uuid, text, bigint),
  public.revert_withdrawal_payout(uuid),
  public.withdrawal_payout_candidates(int),
  public.withdrawals_awaiting_finality(int)
from public, anon, authenticated, service_role;

grant execute on function
  public.record_withdrawal_payout(uuid, text, jsonb, uuid),
  public.finalize_withdrawal(uuid, text, bigint),
  public.revert_withdrawal_payout(uuid),
  public.withdrawal_payout_candidates(int),
  public.withdrawals_awaiting_finality(int)
to service_role;
