-- Re-review round 2 (R2-I1, R2-M1). Every redefined function is copied from its latest definition; only the changes
-- named here are made.
--
--   R2-I1 finalize_withdrawal (latest 20261019300004): in a combined payout (F4-R3) the USDC prize recorded on the same
--     (chain, tx, log) belongs to the prize, so the withdrawal books payout_amount − that prize in net_contributed_usdc,
--     the withdrawal_paid notice and the audit row. Overpayments keep their meaning in every other case (the whole
--     payout is booked). It takes the (chain, tx, log) advisory key of the record functions before reading the prize.
--   R2-I1 record_raffle_payout (latest 20261019600005): when the combined withdrawal is already paid (finalized before
--     any prize recorded the log, so it booked the whole transfer), the prize is added back to the winner's
--     net_contributed_usdc. The advisory key makes exactly one of the two account for the prize.
--   R2-M1 dao_safe_operations.combine_retired_at: a combined candidate that fails for good. unlink_raffle_candidate /
--     unlink_withdrawal_candidate (latest 20261019600001) retire such an op (it is linked to the other kind, which keeps
--     the link) instead of finding nothing every run; raffle_candidate_missing / withdrawal_candidate_missing (latest
--     20261019400004 / 20261019300005) keep the not-found mark on that op (shared with the other kind: the same
--     transfer); the candidate unions (latest 20261019600005) skip retired ops. A treasurer can still paste the hash.

alter table public.dao_safe_operations add column combine_retired_at timestamptz;

-- ===== finalize_withdrawal (latest 20261019300004) =====
create or replace function public.finalize_withdrawal(p_request uuid, p_safe text, p_finalized_block bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
  v_cfg_safe text;
  v_amount numeric;
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

  -- R2-I1: in a combined payout the USDC prize recorded on the same log is the prize's, not the withdrawal's. The
  -- advisory key of both record functions serializes this read with a prize being recorded on the log meanwhile (that
  -- one then sees this withdrawal paid and gives the prize back itself, record_raffle_payout below).
  perform pg_advisory_xact_lock(hashtextextended(w.chain_id::text || ':' || w.payout_tx_hash || ':' || w.payout_log_index::text, 0));
  v_amount := w.payout_amount - coalesce((select sum(r.prize_amount) from public.raffles r
                                          where r.chain_id = w.chain_id and r.prize_token = 'USDC'
                                            and r.payout_tx_hash = w.payout_tx_hash
                                            and r.payout_log_index = w.payout_log_index), 0);

  -- burn: total and approved drop together, so S_eff and value_usdc (and the share price) do not move
  update public.dao_state
  set total_shares = total_shares - w.shares,
      approved_locked_shares = approved_locked_shares - w.shares,
      updated_at = now()
  where chain_id = w.chain_id;

  update public.dao_positions
  set shares = shares - w.shares,
      locked_shares = greatest(locked_shares - w.shares, 0),
      net_contributed_usdc = greatest(net_contributed_usdc - v_amount, 0),
      updated_at = now()
  where chain_id = w.chain_id and member_id = w.member_id;

  update public.withdrawal_requests
  set status = 'paid', paid_at = now(), updated_at = now()
  where id = w.id;

  insert into public.notifications (recipient_id, kind, data)
  values (w.member_id, 'withdrawal_paid', jsonb_build_object('requestId', w.id, 'amount', v_amount::text));

  -- R4: the burn is part of the money trail
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'withdrawal_paid', 'withdrawal_request', w.id, jsonb_build_object(
    'request', w.id, 'txHash', w.payout_tx_hash, 'amount', v_amount::text, 'shares', w.shares::text));

  return jsonb_build_object('status', 'paid');
end;
$$;

-- ===== record_raffle_payout (latest 20261019600005) =====
create or replace function public.record_raffle_payout(p_raffle uuid, p_safe text, p_payout jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.raffles;
  v_hash text;
  v_log int;
  v_block bigint;
  v_at timestamptz;
  v_to text;
  v_token text;
  v_amount numeric;
  v_cfg_safe text;
  v_combined uuid;
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
     or coalesce(p_payout ->> 'token', '') not in ('USDC', 'WETH')
     or coalesce(p_payout ->> 'amount', '') !~ '^[0-9]{1,78}$'
     or coalesce(p_payout ->> 'blockTime', '')
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
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
  v_token := p_payout ->> 'token';
  v_amount := (p_payout ->> 'amount')::numeric;
  if v_at is null or not isfinite(v_at) or v_amount <= 0 then
    raise exception 'invalid_input';
  end if;

  select * into r from public.raffles x where x.id = p_raffle for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- the transfer must come from the configured Safe (held until commit: a Safe change waits for this write)
  select c.safe_address into v_cfg_safe from public.chain_config c where c.chain_id = r.chain_id for share;
  if p_safe is null or v_cfg_safe is null or lower(p_safe) <> v_cfg_safe then
    raise exception 'safe_changed';
  end if;

  -- fix round minor 2: a withdrawal and a prize pasted with the same (chain, tx, log) at once are serialized here (the
  -- same key in record_withdrawal_payout), so the second one sees the first one's payout in the checks below
  perform pg_advisory_xact_lock(hashtextextended(r.chain_id::text || ':' || v_hash || ':' || v_log::text, 0));

  if r.payout_tx_hash = v_hash and r.payout_log_index = v_log then
    return jsonb_build_object('status', 'already');
  end if;
  if r.status <> 'drawn' or r.payout_tx_hash is not null then
    raise exception 'invalid_state';
  end if;

  -- F4-R3: the withdrawal this log pays together with this prize (same wallet, USDC, ≥ both amounts), if any
  v_combined := case when v_to = r.winner_address
                     then public._combined_withdrawal(r.chain_id, v_hash, v_log, v_to, v_token, v_amount,
                                                      r.prize_token, r.prize_amount) end;

  -- one (chain, tx, log) pays one thing: not another prize, not a withdrawal (but the combined one), never a
  -- donation's tx
  if exists (select 1 from public.raffles x
             where x.chain_id = r.chain_id and x.id <> r.id and x.payout_tx_hash = v_hash and x.payout_log_index = v_log)
     or exists (select 1 from public.withdrawal_requests w
                where w.chain_id = r.chain_id and w.payout_tx_hash = v_hash and w.payout_log_index = v_log
                  and w.id is distinct from v_combined)
     or exists (select 1 from public.dao_safe_operations o
                where o.chain_id = r.chain_id and o.tx_hash = v_hash and o.log_index = v_log
                  and o.withdrawal_id is not null and o.withdrawal_id is distinct from v_combined)
     or exists (select 1 from public.dao_ledger l where l.chain_id = r.chain_id and l.tx_hash = v_hash) then
    raise exception 'tx_already_used';
  end if;
  if v_to <> r.winner_address or v_token <> r.prize_token or v_amount < r.prize_amount then
    raise exception 'tx_mismatch';
  end if;
  -- the scan already saw this log: it must be the same transfer
  if exists (select 1 from public.dao_safe_operations o
             where o.chain_id = r.chain_id and o.tx_hash = v_hash and o.log_index = v_log
               and (o.asset <> v_token or o.direction <> 'out' or o.counterparty is distinct from v_to
                    or o.amount <> v_amount)) then
    raise exception 'tx_mismatch';
  end if;
  if v_at < r.drawn_at - interval '120 seconds' then
    raise exception 'tx_too_old';
  end if;

  begin
    update public.raffles
    set payout_tx_hash = v_hash,
        payout_log_index = v_log,
        payout_block = v_block,
        payout_block_time = v_at,
        payout_amount = v_amount,
        payout_recorded_at = now(),
        payout_recorded_by = p_actor,
        payout_missing_since = null,
        updated_at = now()
    where id = r.id;
  exception when unique_violation then
    raise exception 'tx_already_used';
  end;

  -- the payout's outflow is explained by this raffle; any other outflow linked to it is not
  perform public._raffle_unlink_ops(r.id, v_hash, v_log);
  update public.dao_safe_operations
  set raffle_id = r.id
  where chain_id = r.chain_id and tx_hash = v_hash and log_index = v_log and asset = v_token and direction = 'out'
    and withdrawal_id is null;
  -- fix round minor 3: a scan that linked this log to a withdrawal meanwhile wins (but the combined one: the op link
  -- stays with it, F4-R3); nothing of this call is kept
  if exists (select 1 from public.dao_safe_operations o
             where o.chain_id = r.chain_id and o.tx_hash = v_hash and o.log_index = v_log and o.withdrawal_id is not null
               and o.withdrawal_id is distinct from v_combined) then
    raise exception 'tx_already_used';
  end if;

  -- R2-I1: a combined withdrawal already finalized booked the whole transfer as withdrawn (no prize had recorded the
  -- log then): the prize is given back to the winner's net contribution. Serialized with finalize_withdrawal by the
  -- advisory key above, so exactly one of the two accounts for it.
  if v_combined is not null then
    update public.dao_positions p
    set net_contributed_usdc = p.net_contributed_usdc + r.prize_amount, updated_at = now()
    from public.withdrawal_requests w
    where w.id = v_combined and w.status = 'paid' and p.chain_id = w.chain_id and p.member_id = w.member_id;
  end if;

  -- F4c-R4: also when the cron recorded it (null actor)
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (p_actor, 'raffle_payout_recorded', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'txHash', v_hash, 'logIndex', v_log, 'blockNumber', v_block, 'token', v_token,
    'amount', v_amount::text)
    || case when v_combined is null then '{}'::jsonb else jsonb_build_object('combinedWithdrawal', v_combined) end);

  return jsonb_build_object('status', 'recorded');
end;
$$;

-- ===== raffle_payout_candidates (latest 20261019600005) =====
create or replace function public.raffle_payout_candidates(p_chain int)
returns table (raffle_id uuid, tx_hash text, log_index int, token text, winner_address text, prize_amount text,
               drawn_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.tx_hash, c.log_index, c.prize_token, c.winner_address, c.prize_amount, c.drawn_at
  from (
    select r.id, o.tx_hash, o.log_index, r.prize_token, r.winner_address, r.prize_amount::text as prize_amount,
           r.drawn_at, o.block_number
    from public.dao_safe_operations o
    join public.raffles r on r.id = o.raffle_id
    where o.chain_id = p_chain and r.chain_id = p_chain and o.asset = r.prize_token and o.direction = 'out'
      and o.tx_hash is not null and r.status = 'drawn' and r.payout_tx_hash is null
    union all
    -- F4-R3: an outflow linked to a withdrawal to the same wallet that also covers this USDC prize (combined payout)
    select r.id, o.tx_hash, o.log_index, r.prize_token, r.winner_address, r.prize_amount::text, r.drawn_at, o.block_number
    from public.dao_safe_operations o
    join public.raffles r on r.chain_id = p_chain and r.status = 'drawn' and r.payout_tx_hash is null
                         and r.prize_token = 'USDC' and r.winner_address = o.counterparty
    where o.chain_id = p_chain and o.asset = 'USDC' and o.direction = 'out' and o.tx_hash is not null
      and o.occurred_at >= r.drawn_at - interval '120 seconds'
      and o.combine_retired_at is null -- R2-M1: a combined candidate that failed for good is not offered again
      and public._combined_withdrawal(p_chain, o.tx_hash, o.log_index, o.counterparty, o.asset, o.amount,
                                      r.prize_token, r.prize_amount) = o.withdrawal_id
  ) c
  order by c.drawn_at, c.block_number, c.tx_hash, c.log_index
$$;

-- ===== withdrawal_payout_candidates (latest 20261019600005) =====
create or replace function public.withdrawal_payout_candidates(p_chain int)
returns table (request_id uuid, tx_hash text, log_index int, destination text, amount_usdc_locked text,
               approved_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.tx_hash, c.log_index, c.destination_address, c.amount_usdc_locked, c.approved_at
  from (
    select w.id, o.tx_hash, o.log_index, w.destination_address, w.amount_usdc_locked::text as amount_usdc_locked,
           w.approved_at, o.block_number
    from public.dao_safe_operations o
    join public.withdrawal_requests w on w.id = o.withdrawal_id
    where o.chain_id = p_chain and w.chain_id = p_chain and o.asset = 'USDC' and o.direction = 'out'
      and o.tx_hash is not null and w.status = 'approved' and w.payout_tx_hash is null
    union all
    -- F4-R3: an outflow linked to a USDC prize of the same wallet that also covers this withdrawal (combined payout)
    select w.id, o.tx_hash, o.log_index, w.destination_address, w.amount_usdc_locked::text, w.approved_at, o.block_number
    from public.dao_safe_operations o
    join public.withdrawal_requests w on w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null
                                     and w.destination_address = o.counterparty
    where o.chain_id = p_chain and o.asset = 'USDC' and o.direction = 'out' and o.tx_hash is not null
      and o.occurred_at between w.approved_at - interval '120 seconds' and w.approved_at + interval '14 days'
      and o.combine_retired_at is null -- R2-M1
      and public._combined_raffle(p_chain, o.tx_hash, o.log_index, o.counterparty, o.asset, o.amount,
                                  w.amount_usdc_locked) = o.raffle_id
  ) c
  order by c.approved_at, c.block_number, c.tx_hash, c.log_index
$$;

-- ===== unlink_raffle_candidate (latest 20261019600001) =====
create or replace function public.unlink_raffle_candidate(p_raffle uuid, p_tx_hash text, p_log_index int, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.raffles;
  o public.dao_safe_operations;
  v_hash text := lower(p_tx_hash);
  v_request uuid;
begin
  if p_reason is null or p_reason not in ('failed', 'not_found')
     or v_hash is null or v_hash !~ '^0x[0-9a-f]{64}$' or p_log_index is null or p_log_index < 0 then
    raise exception 'invalid_input';
  end if;

  select * into r from public.raffles x where x.id = p_raffle for update;
  if not found then
    raise exception 'not_found';
  end if;
  -- only a candidate: a recorded payout is reverted (revert_raffle_payout), never unlinked here
  if r.status <> 'drawn' or r.payout_tx_hash is not null then
    raise exception 'invalid_state';
  end if;

  select * into o from public.dao_safe_operations x
  where x.raffle_id = r.id and x.chain_id = r.chain_id and x.tx_hash = v_hash and x.log_index = p_log_index
  for update;
  if not found then
    -- R2-M1: a combined candidate (the op belongs to the withdrawal) is retired from combining instead: it is never
    -- offered again, the withdrawal keeps its link
    select * into o from public.dao_safe_operations x
    where x.chain_id = r.chain_id and x.tx_hash = v_hash and x.log_index = p_log_index
      and x.withdrawal_id is not null and x.combine_retired_at is null and x.counterparty = r.winner_address
      and x.withdrawal_id = public._combined_withdrawal(x.chain_id, x.tx_hash, x.log_index, x.counterparty, x.asset,
                                                        x.amount, r.prize_token, r.prize_amount)
    for update;
    if not found then
      return false;
    end if;
    if p_reason = 'not_found' and (o.missing_since is null or o.missing_since > now() - interval '30 minutes') then
      return false;
    end if;
    update public.dao_safe_operations set combine_retired_at = now() where id = o.id;
    insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
    values (null, 'raffle_combined_candidate_retired', 'raffle', r.id, jsonb_build_object(
      'raffle', r.id, 'txHash', o.tx_hash, 'logIndex', o.log_index, 'withdrawal', o.withdrawal_id, 'reason', p_reason));
    return true;
  end if;
  if p_reason = 'not_found' and (o.missing_since is null or o.missing_since > now() - interval '30 minutes') then
    return false;
  end if;

  -- F4d heal: a withdrawal that recorded this outflow as its payout keeps it explained (no alert)
  select w.id into v_request from public.withdrawal_requests w
  where w.chain_id = o.chain_id and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index
    and o.asset = 'USDC' and o.direction = 'out';
  update public.dao_safe_operations set raffle_id = null, withdrawal_id = v_request, missing_since = null where id = o.id;
  if v_request is not null then
    perform public._audit_payout_relink(o, 'raffle', r.id, 'withdrawal', v_request);
  end if;
  if v_request is null and o.alerted_at is null then
    insert into public.notifications (recipient_id, kind, data)
    select m.id, 'treasury_outflow', jsonb_build_object('opId', o.id, 'asset', o.asset, 'amount', o.amount::text)
    from public.members m
    where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;
    update public.dao_safe_operations set alerted_at = clock_timestamp() where id = o.id;
  end if;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'raffle_candidate_unlinked', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'txHash', o.tx_hash, 'logIndex', o.log_index, 'amount', o.amount::text, 'reason', p_reason)
    || case when v_request is null then '{}'::jsonb else jsonb_build_object('relinkedWithdrawal', v_request) end);
  return true;
end;
$$;

-- ===== unlink_withdrawal_candidate (latest 20261019600001) =====
create or replace function public.unlink_withdrawal_candidate(p_request uuid, p_tx_hash text, p_log_index int, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.withdrawal_requests;
  o public.dao_safe_operations;
  v_hash text := lower(p_tx_hash);
  v_raffle uuid;
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
    -- R2-M1: a combined candidate (the op belongs to the prize) is retired from combining instead: it is never
    -- offered again, the prize keeps its link
    select * into o from public.dao_safe_operations x
    where x.chain_id = w.chain_id and x.tx_hash = v_hash and x.log_index = p_log_index
      and x.raffle_id is not null and x.combine_retired_at is null and x.counterparty = w.destination_address
      and x.raffle_id = public._combined_raffle(x.chain_id, x.tx_hash, x.log_index, x.counterparty, x.asset, x.amount,
                                                w.amount_usdc_locked)
    for update;
    if not found then
      return false;
    end if;
    if p_reason = 'not_found' and (o.missing_since is null or o.missing_since > now() - interval '30 minutes') then
      return false;
    end if;
    update public.dao_safe_operations set combine_retired_at = now() where id = o.id;
    insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
    values (null, 'withdrawal_combined_candidate_retired', 'withdrawal_request', w.id, jsonb_build_object(
      'request', w.id, 'txHash', o.tx_hash, 'logIndex', o.log_index, 'raffle', o.raffle_id, 'reason', p_reason));
    return true;
  end if;
  -- fix round 1: believed only once the first not-found mark (withdrawal_candidate_missing) is 30 minutes old
  if p_reason = 'not_found' and (o.missing_since is null or o.missing_since > now() - interval '30 minutes') then
    return false;
  end if;

  -- F4d heal: a raffle that recorded this outflow as its prize payout keeps it explained (no alert)
  select r.id into v_raffle from public.raffles r
  where r.chain_id = o.chain_id and r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index
    and r.prize_token = o.asset and o.direction = 'out';
  update public.dao_safe_operations set withdrawal_id = null, raffle_id = v_raffle, missing_since = null where id = o.id;
  if v_raffle is not null then
    perform public._audit_payout_relink(o, 'withdrawal', w.id, 'raffle', v_raffle);
  end if;
  if v_raffle is null and o.alerted_at is null then
    insert into public.notifications (recipient_id, kind, data)
    select m.id, 'treasury_outflow', jsonb_build_object('opId', o.id, 'asset', o.asset, 'amount', o.amount::text)
    from public.members m
    where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;
    update public.dao_safe_operations set alerted_at = clock_timestamp() where id = o.id;
  end if;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'withdrawal_candidate_unlinked', 'withdrawal_request', w.id, jsonb_build_object(
    'request', w.id, 'txHash', o.tx_hash, 'logIndex', o.log_index, 'amount', o.amount::text, 'reason', p_reason)
    || case when v_raffle is null then '{}'::jsonb else jsonb_build_object('relinkedRaffle', v_raffle) end);
  return true;
end;
$$;

-- ===== raffle_candidate_missing (latest 20261019400004) =====
create or replace function public.raffle_candidate_missing(p_raffle uuid, p_tx_hash text, p_log_index int, p_missing boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.raffles;
  o public.dao_safe_operations;
  v_hash text := lower(p_tx_hash);
begin
  if p_missing is null or v_hash is null or v_hash !~ '^0x[0-9a-f]{64}$' or p_log_index is null or p_log_index < 0 then
    raise exception 'invalid_input';
  end if;
  select * into r from public.raffles x where x.id = p_raffle for update;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status <> 'drawn' or r.payout_tx_hash is not null then
    raise exception 'invalid_state';
  end if;
  select * into o from public.dao_safe_operations x
  where x.raffle_id = r.id and x.chain_id = r.chain_id and x.tx_hash = v_hash and x.log_index = p_log_index
  for update;
  if not found then
    -- R2-M1: a combined candidate shares the op's mark with the withdrawal it is linked to (the same transfer)
    select * into o from public.dao_safe_operations x
    where x.chain_id = r.chain_id and x.tx_hash = v_hash and x.log_index = p_log_index
      and x.withdrawal_id is not null and x.combine_retired_at is null and x.counterparty = r.winner_address
      and x.withdrawal_id = public._combined_withdrawal(x.chain_id, x.tx_hash, x.log_index, x.counterparty, x.asset,
                                                        x.amount, r.prize_token, r.prize_amount)
    for update;
    if not found then
      return false;
    end if;
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

-- ===== withdrawal_candidate_missing (latest 20261019300005) =====
create or replace function public.withdrawal_candidate_missing(p_request uuid, p_tx_hash text, p_log_index int, p_missing boolean)
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
    -- R2-M1: a combined candidate shares the op's mark with the prize it is linked to (the same transfer)
    select * into o from public.dao_safe_operations x
    where x.chain_id = w.chain_id and x.tx_hash = v_hash and x.log_index = p_log_index
      and x.raffle_id is not null and x.combine_retired_at is null and x.counterparty = w.destination_address
      and x.raffle_id = public._combined_raffle(x.chain_id, x.tx_hash, x.log_index, x.counterparty, x.asset, x.amount,
                                                w.amount_usdc_locked)
    for update;
    if not found then
      return false;
    end if;
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
