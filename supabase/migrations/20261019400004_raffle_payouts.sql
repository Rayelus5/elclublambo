-- F4d Task 4: verified raffle prize payouts, on the F4c withdrawal-payout machinery (20261019300004/300005/300007).
--
--   Two phases: the server (pasted hash) or the cron (linked outflow) verifies the prize transfer on chain (USDC or WETH,
--   atLeast, TIP_CONFIRMATIONS) and calls record_raffle_payout. From payout_block on the prize is no longer a liability
--   (_raffle_prize_owed, 20261019400002): the prize and the Safe's tokens drop together, so value_usdc is NOT touched.
--   At finality (and after a TS re-verification) finalize_raffle_payout marks the raffle paid; the cache does not move
--   either. A payout that fails permanently is reverted: the raffle is drawn again and its prize a liability.
--
--   record_safe_operations links a USDC or WETH outflow with no withdrawal match (a withdrawal match takes precedence) to
--   a raffle when it is the raffle's recorded payout, or when it matches a drawn raffle without a payout: the prize token,
--   to the winner's wallet, amount >= the prize and occurred_at >= drawn_at - 120 s (no upper bound: a late payment is
--   still a payment). A linked outflow raises no treasury_outflow alert. This is the link _raffle_prize_owed reads for
--   ruling F4d-R2 (a drawn prize whose linked payout outflow is at or before B counts as paid when valuing at B), so the
--   valuation cap of 20261019400002 holds while a drawn prize is unpaid and lifts as soon as the payout is recorded.
--   Recording a payout unlinks the raffle's other outflows, a revert or a failed candidate unlinks its own: such an
--   outflow is unexplained again and alerts the treasurers once (alerted_at).
--
--   Anti-reuse: one (chain, tx, log) pays one thing. record_raffle_payout refuses (tx_already_used) another raffle's
--   payout, any withdrawal payout, an outflow the scan linked to a withdrawal, and any dao_ledger (donation) tx of the
--   chain; record_withdrawal_payout (latest 20261019300004) now also refuses a raffle payout and an outflow linked to a
--   raffle. dao_safe_operations_one_link (20261019400002) backs it in the table.
--
--   dao_operations / treasury_unexplained_outflows: a raffle link explains the outflow while the raffle is drawn (as its
--   candidate or its payout) or paid (as its payout); the note defaults to "Premio de sorteo" and the hash is shown only
--   to treasurers (the winner sees it on the raffle page, raffle_detail).
--
--   notify_unpaid_raffles: a drawn raffle with no payout 14 days after the draw sends treasury_notice raffle_unpaid to
--   every active bit-256 holder, once (unpaid_notified_at).
--
--   raffles_awaiting_finality also returns payout_log_index (not in the plan's signature): the finality re-verification
--   must check the recorded log, as withdrawals_awaiting_finality does since 20261019300007 (final review minor).
--
--   Task 3 carry (draw_raffle, latest 20261019400003): timestamp and parentTimestamp must be ISO 8601 date-times (no
--   'now' / 'epoch' / date-only literals), the block time may not be more than 120 s ahead of the database clock
--   (draw_block_invalid), and the parent block time is stored (raffles.draw_parent_block_time, shown by raffle_detail).
--
-- Fix round 1 (Task 4 review):
--   - Ruling F4d-R4 (departs from the plan's order): the scan matches the RECORDED payouts of both kinds first
--     (withdrawal, then raffle, both for share) and only then the candidates (withdrawal precedence, then raffle). A
--     prize payout pasted before the scan saw it is no longer captured by a withdrawal candidate (which cleared two
--     liabilities with one transfer, then left the real payout unexplained, alerting and with a public hash).
--   - Ruling F4d-R3: a drawn raffle with a linked candidate (a real payment awaiting verification) is not unpaid:
--     notify_unpaid_raffles skips it (a later run notifies once it is unlinked) and so do the derived `unpaid` flags
--     of _raffle_card and treasury_raffles (latest 20261019400003).
--   - Minor 1: a raffle candidate is the largest prize the outflow covers (an exact amount is that one), then the
--     oldest draw. Minor 2: both record functions take pg_advisory_xact_lock on (chain, tx, log). Minor 3: each
--     record's link update skips an op linked to the other kind and then raises tx_already_used if one is.
--
-- Lock order: raffle row (for update) -> chain_config (for share) -> dao_state (for update) -> dao_positions;
-- dao_safe_operations rows are locked after their raffle row. Exception: record_safe_operations takes chain_config (for
-- share) first and then the matched raffle row (for update of r / for share of r), as for withdrawals (20261019300004).

-- ===== the parent block time of the draw (Task 3 carry) =====
alter table public.raffles add column draw_parent_block_time timestamptz;

-- ===== _raffle_unlink_ops (internal): unlink a raffle's other outflows; alert each one once =====
create function public._raffle_unlink_ops(p_raffle uuid, p_keep_hash text, p_keep_log int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.dao_safe_operations;
begin
  for o in select * from public.dao_safe_operations x
           where x.raffle_id = p_raffle
             and (p_keep_hash is null or x.tx_hash is distinct from p_keep_hash or x.log_index is distinct from p_keep_log)
           order by x.id
           for update loop
    update public.dao_safe_operations set raffle_id = null, missing_since = null where id = o.id;
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

-- ===== record_raffle_payout (service_role, after the server or the cron verified the transfer) =====
-- p_payout = {txHash, logIndex, blockNumber, blockTime (ISO), to, token, amount}; p_actor null = detected by the cron.
create function public.record_raffle_payout(p_raffle uuid, p_safe text, p_payout jsonb, p_actor uuid)
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

  -- one (chain, tx, log) pays one thing: not another prize, not a withdrawal, never a donation's tx
  if exists (select 1 from public.raffles x
             where x.chain_id = r.chain_id and x.id <> r.id and x.payout_tx_hash = v_hash and x.payout_log_index = v_log)
     or exists (select 1 from public.withdrawal_requests w
                where w.chain_id = r.chain_id and w.payout_tx_hash = v_hash and w.payout_log_index = v_log)
     or exists (select 1 from public.dao_safe_operations o
                where o.chain_id = r.chain_id and o.tx_hash = v_hash and o.log_index = v_log
                  and o.withdrawal_id is not null)
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
  -- fix round minor 3: a scan that linked this log to a withdrawal meanwhile wins; nothing of this call is kept
  if exists (select 1 from public.dao_safe_operations o
             where o.chain_id = r.chain_id and o.tx_hash = v_hash and o.log_index = v_log and o.withdrawal_id is not null) then
    raise exception 'tx_already_used';
  end if;

  -- F4c-R4: also when the cron recorded it (null actor)
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (p_actor, 'raffle_payout_recorded', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'txHash', v_hash, 'logIndex', v_log, 'blockNumber', v_block, 'token', v_token,
    'amount', v_amount::text));

  return jsonb_build_object('status', 'recorded');
end;
$$;

-- ===== finalize_raffle_payout (service_role, the cron after re-verifying the payout at finality) =====
create function public.finalize_raffle_payout(p_raffle uuid, p_safe text, p_finalized_block bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.raffles;
  v_cfg_safe text;
begin
  if p_finalized_block is null or p_finalized_block < 0 then
    raise exception 'invalid_input';
  end if;

  select * into r from public.raffles x where x.id = p_raffle for update;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status = 'paid' then
    return jsonb_build_object('status', 'already');
  end if;
  if r.status <> 'drawn' then
    raise exception 'invalid_state';
  end if;

  select c.safe_address into v_cfg_safe from public.chain_config c where c.chain_id = r.chain_id for share;
  if p_safe is null or v_cfg_safe is null or lower(p_safe) <> v_cfg_safe then
    raise exception 'safe_changed';
  end if;

  if r.payout_tx_hash is null or r.payout_block > p_finalized_block then
    return jsonb_build_object('status', 'pending');
  end if;

  -- the prize stopped being a liability at its payout block; value_usdc is not touched here
  update public.raffles
  set status = 'paid', paid_at = now(), payout_missing_since = null, updated_at = now()
  where id = r.id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'raffle_paid', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'txHash', r.payout_tx_hash, 'logIndex', r.payout_log_index, 'token', r.prize_token,
    'amount', r.payout_amount::text));

  return jsonb_build_object('status', 'paid');
end;
$$;

-- ===== revert_raffle_payout (service_role, the payout failed permanently) =====
create function public.revert_raffle_payout(p_raffle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.raffles;
begin
  select * into r from public.raffles x where x.id = p_raffle for update;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status <> 'drawn' or r.payout_tx_hash is null then
    raise exception 'invalid_state';
  end if;

  update public.raffles
  set payout_tx_hash = null,
      payout_log_index = null,
      payout_block = null,
      payout_block_time = null,
      payout_amount = null,
      payout_recorded_at = null,
      payout_recorded_by = null,
      payout_missing_since = null,
      updated_at = now()
  where id = r.id;

  -- its outflow is unexplained again
  perform public._raffle_unlink_ops(r.id, null, null);

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'raffle_payout_reverted', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'txHash', r.payout_tx_hash, 'logIndex', r.payout_log_index, 'blockNumber', r.payout_block,
    'token', r.prize_token, 'amount', r.payout_amount::text));
end;
$$;

-- ===== raffle_payout_candidates (service_role): linked outflows of drawn raffles without a payout =====
create function public.raffle_payout_candidates(p_chain int)
returns table (raffle_id uuid, tx_hash text, log_index int, token text, winner_address text, prize_amount text,
               drawn_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, o.tx_hash, o.log_index, r.prize_token, r.winner_address, r.prize_amount::text, r.drawn_at
  from public.dao_safe_operations o
  join public.raffles r on r.id = o.raffle_id
  where o.chain_id = p_chain and r.chain_id = p_chain and o.asset = r.prize_token and o.direction = 'out'
    and o.tx_hash is not null and r.status = 'drawn' and r.payout_tx_hash is null
  order by r.drawn_at, o.block_number, o.tx_hash, o.log_index
$$;

-- ===== raffles_awaiting_finality (service_role): recorded payouts not yet final =====
create function public.raffles_awaiting_finality(p_chain int)
returns table (raffle_id uuid, tx_hash text, token text, winner_address text, prize_amount text, drawn_at timestamptz,
               payout_block text, payout_log_index int)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.payout_tx_hash, r.prize_token, r.winner_address, r.prize_amount::text, r.drawn_at,
         r.payout_block::text, r.payout_log_index
  from public.raffles r
  where r.chain_id = p_chain and r.status = 'drawn' and r.payout_tx_hash is not null
  order by r.payout_block, r.id
$$;

-- ===== raffle_payout_missing (service_role): a recorded payout's not-found mark, as withdrawal_payout_missing =====
create function public.raffle_payout_missing(p_raffle uuid, p_missing boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.raffles;
begin
  select * into r from public.raffles x where x.id = p_raffle for update;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status <> 'drawn' or r.payout_tx_hash is null then
    raise exception 'invalid_state';
  end if;
  if p_missing is null then
    raise exception 'invalid_input';
  end if;
  if not p_missing then
    update public.raffles set payout_missing_since = null where id = r.id and payout_missing_since is not null;
    return false;
  end if;
  if r.payout_missing_since is null then
    update public.raffles set payout_missing_since = now() where id = r.id;
    return false;
  end if;
  return r.payout_missing_since <= now() - interval '30 minutes';
end;
$$;

-- ===== raffle_candidate_missing (service_role): a linked candidate's not-found mark, same rule =====
-- False (and no mark) when that outflow is not linked to the raffle.
create function public.raffle_candidate_missing(p_raffle uuid, p_tx_hash text, p_log_index int, p_missing boolean)
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

-- ===== unlink_raffle_candidate (service_role): a linked candidate failed verification for good =====
-- p_reason 'failed' unlinks at once; 'not_found' only once the outflow's not-found mark is 30 minutes old.
-- True when the link was removed.
create function public.unlink_raffle_candidate(p_raffle uuid, p_tx_hash text, p_log_index int, p_reason text)
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
    return false;
  end if;
  if p_reason = 'not_found' and (o.missing_since is null or o.missing_since > now() - interval '30 minutes') then
    return false;
  end if;

  update public.dao_safe_operations set raffle_id = null, missing_since = null where id = o.id;
  if o.alerted_at is null then
    insert into public.notifications (recipient_id, kind, data)
    select m.id, 'treasury_outflow', jsonb_build_object('opId', o.id, 'asset', o.asset, 'amount', o.amount::text)
    from public.members m
    where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;
    update public.dao_safe_operations set alerted_at = clock_timestamp() where id = o.id;
  end if;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'raffle_candidate_unlinked', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'txHash', o.tx_hash, 'logIndex', o.log_index, 'amount', o.amount::text, 'reason', p_reason));
  return true;
end;
$$;

-- ===== notify_unpaid_raffles (service_role, cron): once per raffle, 14 days after the draw without a payout =====
create function public.notify_unpaid_raffles(p_chain int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.raffles;
  v_n int := 0;
begin
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;

  for r in
    select * from public.raffles x
    where x.chain_id = p_chain and x.status = 'drawn' and x.payout_tx_hash is null
      and x.drawn_at < now() - interval '14 days' and x.unpaid_notified_at is null
      -- F4d-R3: a linked candidate is a real payment awaiting verification; once unlinked, a later run notifies
      and not exists (select 1 from public.dao_safe_operations o where o.raffle_id = x.id)
    order by x.id
    for update
  loop
    update public.raffles set unpaid_notified_at = now(), updated_at = now() where id = r.id;

    insert into public.notifications (recipient_id, kind, data)
    select m.id, 'treasury_notice', jsonb_build_object('event', 'raffle_unpaid', 'raffleId', r.id)
    from public.members m
    where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;

    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ===== record_safe_operations (latest 20261019300005) + raffle prize payout matching =====
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
    -- candidate), then the candidates, where a withdrawal takes precedence over a prize
    v_withdrawal := null;
    v_raffle := null;
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
      -- F4c: a USDC outflow that matches an approved request still unpaid
      if v_withdrawal is null and v_raffle is null and v_asset = 'USDC' and v_cp is not null then
        select w.id into v_withdrawal from public.withdrawal_requests w
        where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null
          and w.destination_address = v_cp and v_amount >= w.amount_usdc_locked
          and v_at >= w.approved_at - interval '120 seconds' and v_at <= w.approved_at + interval '14 days'
        order by w.approved_at, w.id
        limit 1
        for update of w; -- waits for a concurrent record / reject, then re-checks (header: lock-order exception)
      end if;
      -- F4d: a drawn raffle without a payout whose winner it pays at least the prize, in the prize token, after the
      -- draw. The largest prize it covers (an exact amount is that one), then the oldest draw (fix round, minor 1).
      if v_withdrawal is null and v_raffle is null and v_cp is not null then
        select r.id into v_raffle from public.raffles r
        where r.chain_id = p_chain and r.status = 'drawn' and r.payout_tx_hash is null
          and r.prize_token = v_asset and r.winner_address = v_cp and v_amount >= r.prize_amount
          and v_at >= r.drawn_at - interval '120 seconds'
        order by r.prize_amount desc, r.drawn_at, r.id
        limit 1
        for update of r; -- waits for a concurrent record / revert, then re-checks (header: lock-order exception)
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

-- ===== record_withdrawal_payout (latest 20261019300004): a prize's tx and log are used too =====
create or replace function public.record_withdrawal_payout(p_request uuid, p_safe text, p_payout jsonb, p_actor uuid)
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

  -- fix round minor 2: serialized with record_raffle_payout on the same (chain, tx, log) key
  perform pg_advisory_xact_lock(hashtextextended(w.chain_id::text || ':' || v_hash || ':' || v_log::text, 0));

  if w.payout_tx_hash = v_hash and w.payout_log_index = v_log then
    return jsonb_build_object('status', 'already');
  end if;
  if w.status <> 'approved' or w.payout_tx_hash is not null then
    if w.status = 'pending' and w.last_expired_at is not null then
      raise exception 'approval_expired';
    end if;
    raise exception 'invalid_state';
  end if;

  -- F4d: nor a raffle prize's payout, nor an outflow the scan linked to a raffle
  if exists (select 1 from public.withdrawal_requests x
             where x.chain_id = w.chain_id and x.id <> w.id and x.payout_tx_hash = v_hash and x.payout_log_index = v_log)
     or exists (select 1 from public.raffles r
                where r.chain_id = w.chain_id and r.payout_tx_hash = v_hash and r.payout_log_index = v_log)
     or exists (select 1 from public.dao_safe_operations o
                where o.chain_id = w.chain_id and o.tx_hash = v_hash and o.log_index = v_log and o.raffle_id is not null)
     or exists (select 1 from public.dao_ledger l where l.chain_id = w.chain_id and l.tx_hash = v_hash) then
    raise exception 'tx_already_used';
  end if;
  if v_to <> w.destination_address or v_amount < w.amount_usdc_locked then
    raise exception 'tx_mismatch';
  end if;
  -- the scan already saw this log: it must be the same transfer
  if exists (select 1 from public.dao_safe_operations o
             where o.chain_id = w.chain_id and o.tx_hash = v_hash and o.log_index = v_log
               and (o.asset <> 'USDC' or o.direction <> 'out' or o.counterparty is distinct from v_to
                    or o.amount <> v_amount)) then
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
  where chain_id = w.chain_id and tx_hash = v_hash and log_index = v_log and asset = 'USDC' and direction = 'out'
    and raffle_id is null;
  -- fix round minor 3: a scan that linked this log to a raffle meanwhile wins; nothing of this call is kept
  if exists (select 1 from public.dao_safe_operations o
             where o.chain_id = w.chain_id and o.tx_hash = v_hash and o.log_index = v_log and o.raffle_id is not null) then
    raise exception 'tx_already_used';
  end if;

  -- R4: also when the cron recorded it (null actor)
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (p_actor, 'withdrawal_payout_recorded', 'withdrawal_request', w.id, jsonb_build_object(
    'request', w.id, 'txHash', v_hash, 'logIndex', v_log, 'blockNumber', v_block, 'amount', v_amount::text));

  return jsonb_build_object('status', 'recorded');
end;
$$;

-- ===== dao_operations (latest 20261019300004): prize payouts are explained too, their hash only for treasurers =====
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
  -- a link explains the outflow only while its request is approved (as its candidate or its recorded payout) or paid
  -- (as its payout), or while its raffle is drawn (as its candidate or its recorded payout) or paid (as its payout);
  -- any other link shows as an unexplained outflow
  return query
  with ops as (
    select o.id, o.asset, o.direction, o.amount, o.tx_hash, o.occurred_at, o.note,
           coalesce((w.status = 'approved' and (w.payout_tx_hash is null
                                                or (w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index)))
                    or (w.status = 'paid' and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index),
                    false) as payout,
           coalesce((r.status = 'drawn' and (r.payout_tx_hash is null
                                             or (r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index)))
                    or (r.status = 'paid' and r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index),
                    false) as prize
    from public.dao_safe_operations o
    left join public.withdrawal_requests w on w.id = o.withdrawal_id
    left join public.raffles r on r.id = o.raffle_id
    where o.chain_id = (select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id')
      and o.ledger_id is null
      and (o.direction = 'out' or o.note is not null or v_treasurer)
  )
  select o.id, o.asset, o.direction, o.amount::text,
         case when o.payout or o.prize then case when v_treasurer then o.tx_hash end
              when o.direction = 'out' or v_treasurer then o.tx_hash end,
         o.occurred_at,
         case when o.payout then coalesce(o.note, 'Retirada de un miembro')
              when o.prize then coalesce(o.note, 'Premio de sorteo')
              else o.note end,
         (o.direction = 'in' or o.note is not null or o.payout or o.prize)
  from ops o
  order by o.occurred_at desc, o.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
end;
$$;

-- ===== treasury_unexplained_outflows (latest 20261019300006): the same rule as dao_operations' explained =====
create or replace function public.treasury_unexplained_outflows()
returns table (id uuid, asset text, direction text, amount text, tx_hash text, occurred_at timestamptz, note text, explained boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_member_id() is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  return query
  select o.id, o.asset, o.direction, o.amount::text, o.tx_hash, o.occurred_at, o.note, false
  from public.dao_safe_operations o
  left join public.withdrawal_requests w on w.id = o.withdrawal_id
  left join public.raffles r on r.id = o.raffle_id
  where o.chain_id = (select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id')
    and o.ledger_id is null
    and o.direction = 'out'
    and o.note is null
    and not coalesce((w.status = 'approved' and (w.payout_tx_hash is null
                                                or (w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index)))
                     or (w.status = 'paid' and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index),
                     false)
    and not coalesce((r.status = 'drawn' and (r.payout_tx_hash is null
                                             or (r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index)))
                     or (r.status = 'paid' and r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index),
                     false)
  order by o.occurred_at desc, o.id desc
  limit 500;
end;
$$;

-- ===== draw_raffle (latest 20261019400003): ISO timestamps only, no block from the future, the parent time stored =====
create or replace function public.draw_raffle(p_raffle uuid, p_block jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.raffles;
  v_number bigint;
  v_hash text;
  v_time timestamptz;
  v_parent timestamptz;
  v_seed bytea;
  v_weights numeric[];
  v_random numeric;
  v_pos int;
  v_winner uuid;
  v_wallet text;
  v_iso constant text :=
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$';
begin
  if p_block is null or jsonb_typeof(p_block) <> 'object'
     or coalesce(p_block ->> 'number', '') !~ '^[0-9]{1,18}$'
     or coalesce(p_block ->> 'hash', '') !~ '^0x[0-9a-fA-F]{64}$'
     or jsonb_typeof(p_block -> 'timestamp') is distinct from 'string'
     or jsonb_typeof(p_block -> 'parentTimestamp') is distinct from 'string'
     -- carry: ISO date-times only ('now', 'epoch', 'today' or a bare date would parse to something else)
     or (p_block ->> 'timestamp') !~ v_iso
     or (p_block ->> 'parentTimestamp') !~ v_iso then
    raise exception 'invalid_input';
  end if;
  v_number := (p_block ->> 'number')::bigint;
  v_hash := lower(p_block ->> 'hash');
  begin
    v_time := (p_block ->> 'timestamp')::timestamptz;
    v_parent := (p_block ->> 'parentTimestamp')::timestamptz;
  exception when others then
    raise exception 'invalid_input';
  end;
  if v_time is null or v_parent is null or not isfinite(v_time) or not isfinite(v_parent) then
    raise exception 'invalid_input';
  end if;

  select * into r from public.raffles x where x.id = p_raffle for update;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status in ('drawn', 'paid') then
    if r.draw_block_number = v_number and r.draw_block_hash = v_hash then
      return jsonb_build_object('status', 'already', 'winnerPosition', r.winner_position);
    end if;
    raise exception 'invalid_state';
  end if;
  if r.status <> 'closed' or coalesce(r.total_weight, 0) <= 0 then
    raise exception 'invalid_state';
  end if;
  -- the first block after the close: its own time is past closes_at, its parent's is not; and it already exists
  -- (carry: a block time more than 120 s ahead of the database clock cannot be a mined, finalized block)
  if not (v_time > r.closes_at and r.closes_at >= v_parent) or v_time > now() + interval '120 seconds' then
    raise exception 'draw_block_invalid';
  end if;

  select s.seed into v_seed from private.raffle_seeds s where s.raffle_id = r.id;
  if v_seed is null then
    raise exception 'invalid_state';
  end if;
  select array_agg(e.weight order by e.position) into v_weights
  from public.raffle_entries e where e.raffle_id = r.id;

  v_random := public._uint256_be(public._keccak256(v_seed || decode(substr(v_hash, 3), 'hex')));
  v_pos := public._raffle_pick(v_random, v_weights);
  select e.member_id into v_winner from public.raffle_entries e where e.raffle_id = r.id and e.position = v_pos;
  select lower(m.wallet_address) into v_wallet from public.members m where m.id = v_winner;
  if v_pos is null or v_winner is null or v_wallet is null then
    raise exception 'invalid_state';
  end if;

  update public.raffles
  set status = 'drawn',
      seed_reveal = '0x' || encode(v_seed, 'hex'),
      draw_block_number = v_number,
      draw_block_hash = v_hash,
      draw_block_time = v_time,
      draw_parent_block_time = v_parent,
      draw_random = v_random::text,
      winner_position = v_pos,
      winner_member_id = v_winner,
      winner_address = v_wallet,
      drawn_at = now(),
      updated_at = now()
  where id = r.id;
  delete from private.raffle_seeds s where s.raffle_id = r.id;

  insert into public.notifications (recipient_id, kind, data)
  values (v_winner, 'raffle_won', jsonb_build_object(
    'raffleId', r.id, 'title', r.title, 'token', r.prize_token, 'amount', r.prize_amount::text));

  -- treasurers learn that a prize is owed (the winner's name is on the treasury page)
  insert into public.notifications (recipient_id, kind, data)
  select m.id, 'treasury_notice', jsonb_build_object('event', 'raffle_drawn', 'raffleId', r.id)
  from public.members m
  where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'raffle_drawn', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'block', v_number, 'hash', v_hash, 'random', v_random::text, 'winnerPosition', v_pos));

  return jsonb_build_object('status', 'drawn', 'winnerPosition', v_pos);
end;
$$;

-- ===== raffle_detail (latest 20261019400003) + drawParentBlockTime (the verifier checks parent <= closesAt) =====
create or replace function public.raffle_detail(p_raffle uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  r public.raffles;
  v_treasurer boolean;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select * into r from public.raffles x where x.id = p_raffle and x.chain_id = v_chain;
  if not found then
    raise exception 'not_found';
  end if;
  v_treasurer := public.has_global_perm(256);

  return public._raffle_card(r, v_me) || jsonb_build_object(
    'chainId', r.chain_id,
    'drawBlockHash', r.draw_block_hash,
    'drawBlockTime', r.draw_block_time,
    'drawParentBlockTime', r.draw_parent_block_time,
    'drawRandom', r.draw_random,
    'winnerPosition', r.winner_position,
    'payoutTxHash', case when v_treasurer or r.winner_member_id = v_me then r.payout_tx_hash end,
    'entryList', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'position', l.position,
               'label', case when l.is_me or l.visible then public._member_label(l.member_id)
                             else 'Anónimo #' || l.hidden_rank end,
               'weight', l.weight::text,
               'isMe', l.is_me) order by l.ord), '[]'::jsonb)
      from (select e.member_id, e.position, e.weight, e.member_id = v_me as is_me, m.dao_ranking_visible as visible,
                   row_number() over w as ord,
                   count(*) filter (where not m.dao_ranking_visible) over w as hidden_rank
            from public.raffle_entries e
            join public.members m on m.id = e.member_id
            where e.raffle_id = r.id
            window w as (order by e.position nulls last, e.entered_at, e.member_id
                         rows between unbounded preceding and current row)) l));
end;
$$;

-- ===== _raffle_card (latest 20261019400003): F4d-R3, not unpaid while a payment awaits verification =====
create or replace function public._raffle_card(r public.raffles, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'prizeToken', r.prize_token,
    'prizeAmount', r.prize_amount::text,
    'mode', r.mode,
    'closesAt', r.closes_at,
    'status', r.status,
    'entries', (select count(*)::int from public.raffle_entries e where e.raffle_id = r.id),
    'iEntered', exists (select 1 from public.raffle_entries e where e.raffle_id = r.id and e.member_id = p_me),
    'myWeight', (select e.weight::text from public.raffle_entries e where e.raffle_id = r.id and e.member_id = p_me),
    'totalWeight', r.total_weight::text,
    'commit', r.seed_commit,
    'seedReveal', r.seed_reveal,
    'drawBlockNumber', r.draw_block_number::text,
    'winnerLabel', case when r.winner_member_id is null then null
                        when r.winner_member_id = p_me
                             or (select m.dao_ranking_visible from public.members m where m.id = r.winner_member_id)
                          then public._member_label(r.winner_member_id)
                        else 'Anónimo' end,
    'iWon', coalesce(r.winner_member_id = p_me, false),
    'unpaid', coalesce(r.status = 'drawn' and r.payout_tx_hash is null and r.drawn_at < now() - interval '14 days'
                       and not exists (select 1 from public.dao_safe_operations o where o.raffle_id = r.id), false),
    'paidLate', coalesce(r.status = 'paid' and r.payout_block_time > r.drawn_at + interval '14 days', false),
    'payoutRecorded', r.payout_tx_hash is not null,
    'cancelReason', r.cancel_reason,
    'createdAt', r.created_at)
$$;

-- ===== treasury_raffles (latest 20261019400003): F4d-R3, the same unpaid rule =====
create or replace function public.treasury_raffles()
returns table (id uuid, title text, status text, prize_token text, prize_amount text, prize_value_usd6 text, mode text,
               closes_at timestamptz, entries int, total_weight text, winner_member_id uuid, winner_label text,
               winner_address text, drawn_at timestamptz, unpaid boolean, payout_tx_hash text,
               payout_recorded_at timestamptz, paid_at timestamptz, cancel_reason text, created_by_label text,
               created_at timestamptz)
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
         r.created_at
  from public.raffles r
  where r.chain_id = v_chain
    and (r.status in ('open', 'closed', 'drawn')
         or coalesce(r.paid_at, r.cancelled_at, r.closed_at) >= now() - interval '30 days')
  order by (r.status in ('open', 'closed', 'drawn')) desc, r.created_at desc, r.id;
end;
$$;

-- ===== grants =====
revoke execute on function
  public._raffle_unlink_ops(uuid, text, int),
  public.record_raffle_payout(uuid, text, jsonb, uuid),
  public.finalize_raffle_payout(uuid, text, bigint),
  public.revert_raffle_payout(uuid),
  public.raffle_payout_candidates(int),
  public.raffles_awaiting_finality(int),
  public.raffle_payout_missing(uuid, boolean),
  public.raffle_candidate_missing(uuid, text, int, boolean),
  public.unlink_raffle_candidate(uuid, text, int, text),
  public.notify_unpaid_raffles(int)
from public, anon, authenticated, service_role;

grant execute on function
  public.record_raffle_payout(uuid, text, jsonb, uuid),
  public.finalize_raffle_payout(uuid, text, bigint),
  public.revert_raffle_payout(uuid),
  public.raffle_payout_candidates(int),
  public.raffles_awaiting_finality(int),
  public.raffle_payout_missing(uuid, boolean),
  public.raffle_candidate_missing(uuid, text, int, boolean),
  public.unlink_raffle_candidate(uuid, text, int, text),
  public.notify_unpaid_raffles(int)
to service_role;
