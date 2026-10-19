-- F4d Task 5 carry (Task 4 review, important 1): heal for the in-flight-scan race.
--
--   The scan reads under READ COMMITTED without the record functions' advisory key (taking it would deadlock: scan key
--   -> raffle row, record raffle row -> key). So a payout pasted while a scan batch is already past the recorded-payout
--   match can still be linked by that scan to a candidate of the OTHER kind (a withdrawal candidate for a prize payout,
--   or a prize candidate for a withdrawal payout). The cron's detection then refuses that candidate for good
--   (tx_already_used) and unlinks it, which used to leave a real, recorded payout unexplained: a treasury_outflow alert
--   and a public hash.
--
--   Now every unlink re-links the outflow to the other kind when that kind has exactly this (chain, tx, log) recorded
--   as its payout, in the asset that payout is made in, as an outflow. A re-linked outflow raises no alert and is not
--   marked alerted (it is explained), and its not-found mark is cleared. Covered:
--     unlink_withdrawal_candidate (latest 20261019300005) and unlink_raffle_candidate (latest 20261019400004), whose
--     audit payload gains relinkedRaffle / relinkedWithdrawal (only when it re-linked);
--     _withdrawal_unlink_ops (latest 20261019300004) and _raffle_unlink_ops (latest 20261019400004), used by record,
--     revert, reject and expiry.
--   Everything else in these functions is unchanged.
--
--   Locks: the other kind's row is only read (no lock). A concurrent revert of that payout can leave the outflow linked
--   to a request or raffle with no payout; that is then an ordinary candidate, which the next detection re-verifies
--   (and unlinks with an alert if it no longer qualifies). No new lock order is introduced.

-- ===== _withdrawal_unlink_ops (latest 20261019300004) + re-link to a raffle that recorded the outflow =====
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
    select r.id into v_raffle from public.raffles r
    where r.chain_id = o.chain_id and r.payout_tx_hash = o.tx_hash and r.payout_log_index = o.log_index
      and r.prize_token = o.asset and o.direction = 'out';
    if v_raffle is not null then
      -- the other kind recorded this outflow as its payout: it stays explained
      update public.dao_safe_operations set withdrawal_id = null, raffle_id = v_raffle, missing_since = null
      where id = o.id;
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

-- ===== _raffle_unlink_ops (latest 20261019400004) + re-link to a withdrawal that recorded the outflow =====
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
    select w.id into v_request from public.withdrawal_requests w
    where w.chain_id = o.chain_id and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index
      and o.asset = 'USDC' and o.direction = 'out';
    if v_request is not null then
      -- the other kind recorded this outflow as its payout: it stays explained
      update public.dao_safe_operations set raffle_id = null, withdrawal_id = v_request, missing_since = null
      where id = o.id;
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

-- ===== unlink_withdrawal_candidate (latest 20261019300005) + re-link to a raffle that recorded the outflow =====
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
    return false;
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

-- ===== unlink_raffle_candidate (latest 20261019400004) + re-link to a withdrawal that recorded the outflow =====
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
    return false;
  end if;
  if p_reason = 'not_found' and (o.missing_since is null or o.missing_since > now() - interval '30 minutes') then
    return false;
  end if;

  -- F4d heal: a withdrawal that recorded this outflow as its payout keeps it explained (no alert)
  select w.id into v_request from public.withdrawal_requests w
  where w.chain_id = o.chain_id and w.payout_tx_hash = o.tx_hash and w.payout_log_index = o.log_index
    and o.asset = 'USDC' and o.direction = 'out';
  update public.dao_safe_operations set raffle_id = null, withdrawal_id = v_request, missing_since = null where id = o.id;
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

-- ===== grants (create or replace keeps them; restated) =====
revoke execute on function
  public._withdrawal_unlink_ops(uuid, text, int),
  public._raffle_unlink_ops(uuid, text, int),
  public.unlink_withdrawal_candidate(uuid, text, int, text),
  public.unlink_raffle_candidate(uuid, text, int, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.unlink_withdrawal_candidate(uuid, text, int, text),
  public.unlink_raffle_candidate(uuid, text, int, text)
to service_role;
