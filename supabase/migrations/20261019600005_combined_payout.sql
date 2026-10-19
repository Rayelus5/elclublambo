-- Ruling F4-R3 (re-review R-I1): a combined payout, and R-M3's valuation_paused.
--
--   One USDC transfer to the same wallet may pay both an approved withdrawal W and a drawn USDC prize R, when it covers
--   W.amount_usdc_locked + R.prize_amount. Before, record_raffle_payout refused it (tx_already_used, the scan had linked
--   it to W) and a treasurer note on it lifted the F4-R2 pause with R's prize still counted as a liability: the NAV
--   stayed 150 low for good.
--
--   _combined_withdrawal / _combined_raffle: the one obligation of the other kind that recorded or is linked to this
--     (chain, tx, log), to the same address, USDC on both sides, with amount ≥ both amounts. Null otherwise.
--   record_raffle_payout / record_withdrawal_payout (latest 20261019400004): every cross-kind tx_already_used check
--     (recorded payout, linked op, the post-link re-check) gets exactly this exception and no wider one. The other
--     prize / other withdrawal / donation checks are unchanged. The op link stays where it is (the update that links
--     it still skips an op linked to the other kind). The audit payload names the combined obligation.
--   raffle_payout_candidates / withdrawal_payout_candidates (latest 20261019400004 / 20261019300004): the scan's
--     detection also offers a combined log linked to the other kind, so the cron records both.
--   revert_raffle_payout / revert_withdrawal_payout (latest 20261019400004 / 20261019300005): reverting one side of a
--     combined payout (a permanent failure of the same transfer) reverts the other side if it still awaits finality,
--     before the op links are settled. Lock order: raffle → withdrawal from the raffle side, withdrawal → raffle from
--     the withdrawal side; the cron finalizes withdrawals and prizes one after the other, and a deadlock between two
--     overlapping runs aborts one of them (retried next run).
--   _withdrawal_unlink_ops / _raffle_unlink_ops (latest 20261019600001): never unlink or re-link a log both kinds
--     recorded.
--   _payout_outflow_unexplained (latest 20261019600004): the overpay branch compares the amount with what every
--     obligation holding the log takes (the linked one plus the others that recorded it), and a note no longer lifts it;
--     it ends when the paused obligation records the log. The note still explains the unexplained branch.
--   _dao_assets_covered (latest 20261019600004): R-M3, raises valuation_paused (own copy) while the pause holds, instead
--     of answering false (assets_stale). Its three callers (credit_donation, _withdrawal_valuation,
--     record_nav_snapshot) propagate it unchanged.

-- ===== the combined-payout helpers =====
create function public._combined_withdrawal(p_chain int, p_hash text, p_log int, p_to text, p_token text,
                                            p_amount numeric, p_prize_token text, p_prize numeric)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id
  from public.withdrawal_requests w
  where p_token = 'USDC' and p_prize_token = 'USDC'
    and w.chain_id = p_chain and w.status in ('approved', 'paid') and w.destination_address = p_to
    and p_amount >= w.amount_usdc_locked + p_prize
    and ((w.payout_tx_hash = p_hash and w.payout_log_index = p_log)
         or exists (select 1 from public.dao_safe_operations o
                    where o.chain_id = p_chain and o.tx_hash = p_hash and o.log_index = p_log and o.withdrawal_id = w.id))
  order by w.id
  limit 1
$$;

create function public._combined_raffle(p_chain int, p_hash text, p_log int, p_to text, p_token text,
                                        p_amount numeric, p_locked numeric)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.raffles r
  where p_token = 'USDC' and r.prize_token = 'USDC'
    and r.chain_id = p_chain and r.status in ('drawn', 'paid') and r.winner_address = p_to
    and p_amount >= p_locked + r.prize_amount
    and ((r.payout_tx_hash = p_hash and r.payout_log_index = p_log)
         or exists (select 1 from public.dao_safe_operations o
                    where o.chain_id = p_chain and o.tx_hash = p_hash and o.log_index = p_log and o.raffle_id = r.id))
  order by r.id
  limit 1
$$;

revoke execute on function
  public._combined_withdrawal(int, text, int, text, text, numeric, text, numeric),
  public._combined_raffle(int, text, int, text, text, numeric, numeric)
from public, anon, authenticated, service_role;

-- ===== _payout_outflow_unexplained (latest 20261019600004) =====
create or replace function public._payout_outflow_unexplained(p_chain int, p_token text, p_to text, p_start timestamptz,
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
      and o.direction = 'out' and o.asset = p_token and o.ledger_id is null
      and o.counterparty = p_to
      and o.occurred_at between p_start - interval '120 seconds' and p_start + interval '14 days'
      -- not this obligation's own candidate or payout
      and not coalesce(o.withdrawal_id = p_withdrawal, false)
      and not coalesce(o.raffle_id = p_raffle, false)
      and (
        -- unexplained (treasury_unexplained_outflows): a treasurer note explains it
        (o.note is null
         and not coalesce((w.status = 'approved' and (w.payout_tx_hash is null
                                                     or (w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index)))
                          or (w.status = 'paid' and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index)
                          or (r.status = 'drawn' and (r.payout_tx_hash is null
                                                      or (r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index)))
                          or (r.status = 'paid' and r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index),
                          false))
        -- F4-R3: or linked to another obligation and more than what the obligations holding this log take (the linked
        -- one plus every other one that recorded it): the excess may be this one's payout. A note does not lift this
        -- branch; it ends when this obligation records the log (a combined payout) or is otherwise paid.
        or ((o.withdrawal_id is not null or o.raffle_id is not null)
            and o.amount > coalesce(w.amount_usdc_locked, r.prize_amount, 0)
                           + coalesce((select sum(x.prize_amount) from public.raffles x
                                       where x.chain_id = o.chain_id and x.payout_tx_hash = o.tx_hash
                                         and x.payout_log_index = o.log_index and x.id is distinct from o.raffle_id), 0)
                           + coalesce((select sum(y.amount_usdc_locked) from public.withdrawal_requests y
                                       where y.chain_id = o.chain_id and y.payout_tx_hash = o.tx_hash
                                         and y.payout_log_index = o.log_index and y.id is distinct from o.withdrawal_id), 0))))
$$;

-- ===== _dao_assets_covered (latest 20261019600004) =====
create or replace function public._dao_assets_covered(p_chain int, p_block bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- F4-R2 / R-M3: while a non-conforming payout may have left the Safe every valuation stops with its own code
  -- (credit_donation, _withdrawal_valuation and record_nav_snapshot all call this after their dao_state lock)
  if public._dao_payout_pause(p_chain) then
    raise exception 'valuation_paused';
  end if;
  return (not exists (select 1 from public.withdrawal_requests w
                      where w.chain_id = p_chain and w.status = 'approved' and w.payout_tx_hash is null)
          and not exists (select 1 from public.raffles r
                          where r.chain_id = p_chain and r.status = 'drawn' and r.payout_tx_hash is null))
      or coalesce((select s.last_block from public.dao_scan_state s where s.chain_id = p_chain), -1) >= p_block;
end;
$$;

-- ===== record_raffle_payout (latest 20261019400004) =====
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

  -- F4c-R4: also when the cron recorded it (null actor)
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (p_actor, 'raffle_payout_recorded', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'txHash', v_hash, 'logIndex', v_log, 'blockNumber', v_block, 'token', v_token,
    'amount', v_amount::text)
    || case when v_combined is null then '{}'::jsonb else jsonb_build_object('combinedWithdrawal', v_combined) end);

  return jsonb_build_object('status', 'recorded');
end;
$$;

-- ===== record_withdrawal_payout (latest 20261019400004) =====
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

  -- F4-R3: the USDC prize this log pays together with this withdrawal (same wallet, ≥ both amounts), if any
  v_combined := case when v_to = w.destination_address
                     then public._combined_raffle(w.chain_id, v_hash, v_log, v_to, 'USDC', v_amount, w.amount_usdc_locked) end;

  -- F4d: nor a raffle prize's payout, nor an outflow the scan linked to a raffle (but the combined prize's)
  if exists (select 1 from public.withdrawal_requests x
             where x.chain_id = w.chain_id and x.id <> w.id and x.payout_tx_hash = v_hash and x.payout_log_index = v_log)
     or exists (select 1 from public.raffles r
                where r.chain_id = w.chain_id and r.payout_tx_hash = v_hash and r.payout_log_index = v_log
                  and r.id is distinct from v_combined)
     or exists (select 1 from public.dao_safe_operations o
                where o.chain_id = w.chain_id and o.tx_hash = v_hash and o.log_index = v_log and o.raffle_id is not null
                  and o.raffle_id is distinct from v_combined)
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
  -- fix round minor 3: a scan that linked this log to a raffle meanwhile wins (but the combined prize: the op link
  -- stays with it, F4-R3); nothing of this call is kept
  if exists (select 1 from public.dao_safe_operations o
             where o.chain_id = w.chain_id and o.tx_hash = v_hash and o.log_index = v_log and o.raffle_id is not null
               and o.raffle_id is distinct from v_combined) then
    raise exception 'tx_already_used';
  end if;

  -- R4: also when the cron recorded it (null actor)
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (p_actor, 'withdrawal_payout_recorded', 'withdrawal_request', w.id, jsonb_build_object(
    'request', w.id, 'txHash', v_hash, 'logIndex', v_log, 'blockNumber', v_block, 'amount', v_amount::text)
    || case when v_combined is null then '{}'::jsonb else jsonb_build_object('combinedRaffle', v_combined) end);

  return jsonb_build_object('status', 'recorded');
end;
$$;

-- ===== raffle_payout_candidates (latest 20261019400004) =====
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
      and public._combined_withdrawal(p_chain, o.tx_hash, o.log_index, o.counterparty, o.asset, o.amount,
                                      r.prize_token, r.prize_amount) = o.withdrawal_id
  ) c
  order by c.drawn_at, c.block_number, c.tx_hash, c.log_index
$$;

-- ===== withdrawal_payout_candidates (latest 20261019300004) =====
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
      and public._combined_raffle(p_chain, o.tx_hash, o.log_index, o.counterparty, o.asset, o.amount,
                                  w.amount_usdc_locked) = o.raffle_id
  ) c
  order by c.approved_at, c.block_number, c.tx_hash, c.log_index
$$;

-- ===== revert_raffle_payout (latest 20261019400004) =====
create or replace function public.revert_raffle_payout(p_raffle uuid)
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

  -- F4-R3: a combined payout (the same log recorded by a withdrawal still awaiting finality) is the same transfer:
  -- it is reverted with it, before the op links are settled
  perform public.revert_withdrawal_payout(w.id)
  from public.withdrawal_requests w
  where w.chain_id = r.chain_id and w.status = 'approved'
    and w.payout_tx_hash = r.payout_tx_hash and w.payout_log_index = r.payout_log_index;

  -- its outflow is unexplained again
  perform public._raffle_unlink_ops(r.id, null, null);

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'raffle_payout_reverted', 'raffle', r.id, jsonb_build_object(
    'raffle', r.id, 'txHash', r.payout_tx_hash, 'logIndex', r.payout_log_index, 'blockNumber', r.payout_block,
    'token', r.prize_token, 'amount', r.payout_amount::text));
end;
$$;

-- ===== revert_withdrawal_payout (latest 20261019300005) =====
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

  -- F4-R3: a combined payout (the same log recorded by a prize still awaiting finality) is the same transfer: it is
  -- reverted with it, before the op links are settled
  perform public.revert_raffle_payout(r.id)
  from public.raffles r
  where r.chain_id = w.chain_id and r.status = 'drawn'
    and r.payout_tx_hash = w.payout_tx_hash and r.payout_log_index = w.payout_log_index;

  -- its outflow is unexplained again
  perform public._withdrawal_unlink_ops(w.id, null, null);

  -- R4: the cleared payout stays in the money trail
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'withdrawal_payout_reverted', 'withdrawal_request', w.id, jsonb_build_object(
    'request', w.id, 'txHash', w.payout_tx_hash, 'logIndex', w.payout_log_index, 'blockNumber', w.payout_block,
    'amount', w.payout_amount::text));
end;
$$;

-- ===== _withdrawal_unlink_ops (latest 20261019600001) =====
create or replace function public._withdrawal_unlink_ops(p_request uuid, p_keep_hash text, p_keep_log int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.dao_safe_operations;
  v_raffle uuid;
begin
  for o in select * from public.dao_safe_operations x
           where x.withdrawal_id = p_request
             and (p_keep_hash is null or x.tx_hash is distinct from p_keep_hash or x.log_index is distinct from p_keep_log)
           order by x.id
           for update loop
    -- F4-R3: a log both kinds recorded (a combined payout) is never unlinked or re-linked here
    if exists (select 1 from public.withdrawal_requests w
               where w.chain_id = o.chain_id and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index)
       and exists (select 1 from public.raffles r
                   where r.chain_id = o.chain_id and r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index) then
      continue;
    end if;
    select r.id into v_raffle from public.raffles r
    where r.chain_id = o.chain_id and r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index
      and r.prize_token = o.asset and o.direction = 'out';
    if v_raffle is not null then
      -- the other kind recorded this outflow as its payout: it stays explained
      update public.dao_safe_operations set withdrawal_id = null, raffle_id = v_raffle, missing_since = null
      where id = o.id;
      perform public._audit_payout_relink(o, 'withdrawal', p_request, 'raffle', v_raffle);
      continue;
    end if;
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

-- ===== _raffle_unlink_ops (latest 20261019600001) =====
create or replace function public._raffle_unlink_ops(p_raffle uuid, p_keep_hash text, p_keep_log int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.dao_safe_operations;
  v_request uuid;
begin
  for o in select * from public.dao_safe_operations x
           where x.raffle_id = p_raffle
             and (p_keep_hash is null or x.tx_hash is distinct from p_keep_hash or x.log_index is distinct from p_keep_log)
           order by x.id
           for update loop
    -- F4-R3: a log both kinds recorded (a combined payout) is never unlinked or re-linked here
    if exists (select 1 from public.withdrawal_requests w
               where w.chain_id = o.chain_id and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index)
       and exists (select 1 from public.raffles r
                   where r.chain_id = o.chain_id and r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index) then
      continue;
    end if;
    select w.id into v_request from public.withdrawal_requests w
    where w.chain_id = o.chain_id and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index
      and o.asset = 'USDC' and o.direction = 'out';
    if v_request is not null then
      -- the other kind recorded this outflow as its payout: it stays explained
      update public.dao_safe_operations set raffle_id = null, withdrawal_id = v_request, missing_since = null
      where id = o.id;
      perform public._audit_payout_relink(o, 'raffle', p_raffle, 'withdrawal', v_request);
      continue;
    end if;
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
