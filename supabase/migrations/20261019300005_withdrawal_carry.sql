-- F4c Task 5 carries (SQL). Lock order unchanged: request row (for update) -> chain_config (for share) -> dao_state
-- (for update) -> dao_positions; dao_safe_operations rows are locked after their request row.
--
--   (A) expire_withdrawal_approvals locks every lapsed approval first and only then, statement by statement (a fresh
--       snapshot each), re-checks it: still approved, no payout, no linked outflow inside its window. A scan that linked
--       a payment while the expiry waited for the row lock is therefore seen, and the request is skipped (F4c-R3).
--   (B) _dao_liabilities_usd6: the withdrawal filter is a plain OR under a top-level `status in ('approved', 'paid')`,
--       which implies the predicate of withdrawal_requests_payout_block_idx (no CASE hiding it from the planner).
--   (C) record_safe_operations: the exact-payout match takes `for share of w`, so a concurrent revert is waited for and
--       re-checked; the outflow is then matched as a fresh candidate (or alerts) instead of being linked to a payout that
--       no longer exists.
--   (D) an approval whose only linked outflows are outside its window expires, and those stale links are removed with
--       one treasury_outflow alert each (they would otherwise stay "Sin explicar" without ever alerting).
--   (E) unlink_withdrawal_candidate (service_role): when the server's verification of a linked candidate fails for
--       good, the link is removed with one alert and an audit entry, so the request can be rejected or expire and stops
--       being a liability forever. 'failed' unlinks at once; 'not_found' only once the outflow's not-found mark is
--       30 minutes old (a lagging RPC node is not believed, as for donations).
--
--   Fix round 1 (Task 5 review):
--   - Not-found marks mirror donations' missing_since (donation_missing): withdrawal_requests.payout_missing_since for
--     a recorded payout (withdrawal_payout_missing) and dao_safe_operations.missing_since for a linked candidate
--     (withdrawal_candidate_missing). The first not-found sets the mark, any ok verification clears it, and the
--     server reverts / unlinks on not-found only once the mark is at least 30 minutes old. A revert clears the mark.
--   - Ruling F4c-R5: expiry never runs past what the scan covered. expire_withdrawal_approvals(p_chain,
--     p_scanned_through) also requires approved_at + 14 d + 120 s < p_scanned_through (the block time of the scan
--     cursor the cron just reached), so a payout mined at the end of the window is linked before its approval lapses.

alter table public.withdrawal_requests add column payout_missing_since timestamptz;
alter table public.dao_safe_operations add column missing_since timestamptz;

-- ===== _dao_liabilities_usd6 (latest 20261019300004): plain OR (carry B) =====
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
                          or (p_at_block is not null and (w.payout_block is null or w.payout_block > p_at_block)))), 0)
$$;

-- ===== record_safe_operations (latest 20261019300004): `for share of w` on the exact-payout match (carry C) =====
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
      where w.chain_id = p_chain and w.payout_tx_hash = v_hash and w.payout_log_index = v_log
      for share of w; -- carry C: a concurrent revert is waited for, then the payout is re-checked
      if v_withdrawal is null and v_cp is not null then
        select w.id into v_withdrawal from public.withdrawal_requests w
        where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null
          and w.destination_address = v_cp and v_amount >= w.amount_usdc_locked
          and v_at >= w.approved_at - interval '120 seconds' and v_at <= w.approved_at + interval '14 days'
        order by w.approved_at, w.id
        limit 1
        for update of w; -- waits for a concurrent record / reject, then re-checks (header: lock-order exception)
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

-- ===== expire_withdrawal_approvals (latest 20261019300004): per chain, bounded by the scan (R5), re-check under the
-- lock (A), stale links alert (D). The argument-less version is dropped: it could expire past what the scan covered.
drop function public.expire_withdrawal_approvals();

create function public.expire_withdrawal_approvals(p_chain int, p_scanned_through timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  w public.withdrawal_requests;
  v_n int := 0;
begin
  if p_chain is null or p_chain not in (59144, 59141) or p_scanned_through is null then
    raise exception 'invalid_input';
  end if;

  -- every lapsed approval's row first, in id order (lock order: request rows -> dao_state)
  select coalesce(array_agg(x.id order by x.id), '{}') into v_ids
  from (select r.id from public.withdrawal_requests r
        where r.chain_id = p_chain and r.status = 'approved' and r.payout_tx_hash is null
          and r.approved_at < now() - interval '14 days'
          -- R5: the scan has covered the whole payout window (plus the 120 s clock tolerance)
          and r.approved_at + interval '14 days 120 seconds' < p_scanned_through
        order by r.id
        for update) x;

  foreach v_id in array v_ids loop
    -- carry A: each statement sees what committed while we waited for the locks (a scan's link included)
    select * into w from public.withdrawal_requests r where r.id = v_id;
    if not found or w.status <> 'approved' or w.payout_tx_hash is not null
       or w.approved_at >= now() - interval '14 days'
       or w.approved_at + interval '14 days 120 seconds' >= p_scanned_through then
      continue;
    end if;
    -- F4c-R3: a payment mined inside the window and awaiting verification must not be expired
    if exists (select 1 from public.dao_safe_operations o
               where o.withdrawal_id = w.id
                 and o.occurred_at between w.approved_at - interval '120 seconds'
                                       and w.approved_at + interval '14 days') then
      continue;
    end if;

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

    -- carry D: outflows linked outside the window explain nothing any more; each alerts the treasurers once
    perform public._withdrawal_unlink_ops(w.id, null, null);

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

-- ===== unlink_withdrawal_candidate (service_role): a linked candidate failed verification for good (carry E) =====
-- p_reason 'failed' (tx_failed / tx_mismatch / tx_too_old, or the payout record refused it) unlinks at once;
-- 'not_found' only when the outflow was scanned more than 30 minutes ago. True when the link was removed.
create function public.unlink_withdrawal_candidate(p_request uuid, p_tx_hash text, p_log_index int, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
  o public.dao_safe_operations;
  v_hash text := lower(p_tx_hash);
begin
  if p_reason is null or p_reason not in ('failed', 'not_found')
     or v_hash is null or v_hash !~ '^0x[0-9a-f]{64}$' or p_log_index is null or p_log_index < 0 then
    raise exception 'invalid_input';
  end if;

  select * into w from public.withdrawal_requests x where x.id = p_request for update;
  if not found then
    raise exception 'not_found';
  end if;
  -- only a candidate: a recorded payout is reverted (revert_withdrawal_payout), never unlinked here
  if w.status <> 'approved' or w.payout_tx_hash is not null then
    raise exception 'invalid_state';
  end if;

  select * into o from public.dao_safe_operations x
  where x.withdrawal_id = w.id and x.chain_id = w.chain_id and x.tx_hash = v_hash and x.log_index = p_log_index
  for update;
  if not found then
    return false;
  end if;
  -- fix round 1: believed only once the first not-found mark (withdrawal_candidate_missing) is 30 minutes old
  if p_reason = 'not_found' and (o.missing_since is null or o.missing_since > now() - interval '30 minutes') then
    return false;
  end if;

  update public.dao_safe_operations set withdrawal_id = null, missing_since = null where id = o.id;
  if o.alerted_at is null then
    insert into public.notifications (recipient_id, kind, data)
    select m.id, 'treasury_outflow', jsonb_build_object('opId', o.id, 'asset', o.asset, 'amount', o.amount::text)
    from public.members m
    where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;
    update public.dao_safe_operations set alerted_at = clock_timestamp() where id = o.id;
  end if;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'withdrawal_candidate_unlinked', 'withdrawal_request', w.id, jsonb_build_object(
    'request', w.id, 'txHash', o.tx_hash, 'logIndex', o.log_index, 'amount', o.amount::text, 'reason', p_reason));
  return true;
end;
$$;

-- ===== withdrawal_payout_missing (service_role): a recorded payout's not-found mark, as donation_missing =====
-- p_missing true: sets the mark on the first call, then answers whether it is at least 30 minutes old (revert allowed).
-- p_missing false (any ok verification): clears it. Only an approved request with a recorded payout has one.
create function public.withdrawal_payout_missing(p_request uuid, p_missing boolean)
returns boolean
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
  if p_missing is null then
    raise exception 'invalid_input';
  end if;
  if not p_missing then
    update public.withdrawal_requests set payout_missing_since = null where id = w.id and payout_missing_since is not null;
    return false;
  end if;
  if w.payout_missing_since is null then
    update public.withdrawal_requests set payout_missing_since = now() where id = w.id;
    return false;
  end if;
  return w.payout_missing_since <= now() - interval '30 minutes';
end;
$$;

-- ===== withdrawal_candidate_missing (service_role): a linked candidate's not-found mark, same rule =====
-- False (and no mark) when that outflow is not linked to the request.
create function public.withdrawal_candidate_missing(p_request uuid, p_tx_hash text, p_log_index int, p_missing boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
  o public.dao_safe_operations;
  v_hash text := lower(p_tx_hash);
begin
  if p_missing is null or v_hash is null or v_hash !~ '^0x[0-9a-f]{64}$' or p_log_index is null or p_log_index < 0 then
    raise exception 'invalid_input';
  end if;
  select * into w from public.withdrawal_requests x where x.id = p_request for update;
  if not found then
    raise exception 'not_found';
  end if;
  if w.status <> 'approved' or w.payout_tx_hash is not null then
    raise exception 'invalid_state';
  end if;
  select * into o from public.dao_safe_operations x
  where x.withdrawal_id = w.id and x.chain_id = w.chain_id and x.tx_hash = v_hash and x.log_index = p_log_index
  for update;
  if not found then
    return false;
  end if;
  if not p_missing then
    update public.dao_safe_operations set missing_since = null where id = o.id and missing_since is not null;
    return false;
  end if;
  if o.missing_since is null then
    update public.dao_safe_operations set missing_since = now() where id = o.id;
    return false;
  end if;
  return o.missing_since <= now() - interval '30 minutes';
end;
$$;

-- ===== revert_withdrawal_payout (latest 20261019300004): also clears the not-found mark =====
create or replace function public.revert_withdrawal_payout(p_request uuid)
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
      payout_missing_since = null,
      updated_at = now()
  where id = w.id;

  -- its outflow is unexplained again
  perform public._withdrawal_unlink_ops(w.id, null, null);

  -- R4: the cleared payout stays in the money trail
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'withdrawal_payout_reverted', 'withdrawal_request', w.id, jsonb_build_object(
    'request', w.id, 'txHash', w.payout_tx_hash, 'logIndex', w.payout_log_index, 'blockNumber', w.payout_block,
    'amount', w.payout_amount::text));
end;
$$;

-- ===== grants =====
revoke execute on function
  public.unlink_withdrawal_candidate(uuid, text, int, text),
  public.expire_withdrawal_approvals(int, timestamptz),
  public.withdrawal_payout_missing(uuid, boolean),
  public.withdrawal_candidate_missing(uuid, text, int, boolean)
from public, anon, authenticated, service_role;
grant execute on function
  public.unlink_withdrawal_candidate(uuid, text, int, text),
  public.expire_withdrawal_approvals(int, timestamptz),
  public.withdrawal_payout_missing(uuid, boolean),
  public.withdrawal_candidate_missing(uuid, text, int, boolean)
to service_role;
