-- F4 polish round (before the whole-branch review). Each redefined function is copied from its latest definition with
-- only the change named in its section.
--
--   1. Refused draws: raffles.draw_refused_code / draw_refused_at, set by the cron through record_raffle_draw_refusal
--      (service_role) when draw_raffle refuses a closed raffle (draw_block_invalid, invalid_state or any other code).
--      One row per raffle: the same code again changes nothing (no hourly audit rows, no hourly realtime broadcast), a
--      different code replaces it. The treasurer's alert is derived on read: treasury_raffles.draw_refused is the code
--      while the raffle is still closed, so a later successful draw (or a cancel) clears it with no extra write.
--   3. Every internal move of an outflow link from one kind to the other (the F4d heal of 20261019400005 in
--      _withdrawal_unlink_ops, _raffle_unlink_ops, unlink_withdrawal_candidate and unlink_raffle_candidate) writes an
--      audit_log row: actor null (system), action treasury_payout_relinked, target the dao_safe_operations row, payload
--      { txHash, logIndex, fromKind, fromId, toKind, toId } only. The scan's cross-kind fit (F4d-R6,
--      record_safe_operations) links a new outflow once and never moves a link, so it has nothing to audit.
--   4. treasury_raffles.paid_late: the rule of _raffle_card (paid, payout block time past drawn_at + 14 days).
--   5. request_withdrawal (latest 20261019300002): the treasury_notice fan-out skips the requester (F4c minor #8).
--   6. dao_overview (latest 20261019300002): donors counts the members with shares minus approved ones > 0, the holders
--      dao_ranking lists (F4c minor #9).
--   7. Dead code: record_reconciliation and dao_reconciliations (F3, unused since the NAV fund) and the
--      treasury_mismatch notification kind only they produced (the kind check, _push_build). my_dao_position was
--      already dropped by 20261019300007.

-- ===== 1. refused draws =====
alter table public.raffles add column draw_refused_code text
  check (draw_refused_code is null or draw_refused_code ~ '^[a-z0-9_]{1,64}$');
alter table public.raffles add column draw_refused_at timestamptz;
alter table public.raffles add constraint raffles_draw_refused_coherent
  check ((draw_refused_code is null) = (draw_refused_at is null));

create function public.record_raffle_draw_refusal(p_raffle uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_code is null or p_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'invalid_input';
  end if;
  -- only a closed raffle awaits its draw; the same code again is a no-op (one alert per raffle and code)
  update public.raffles
  set draw_refused_code = p_code, draw_refused_at = now()
  where id = p_raffle and status = 'closed' and draw_refused_code is distinct from p_code
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'raffle_draw_refused', 'raffle', v_id, jsonb_build_object('raffle', v_id, 'code', p_code));
  return true;
end;
$$;

-- ===== treasury_raffles (latest 20261019400004) + paid_late (4) and draw_refused (1); new columns: drop and create =====
drop function public.treasury_raffles();
create or replace function public.treasury_raffles()
returns table (id uuid, title text, status text, prize_token text, prize_amount text, prize_value_usd6 text, mode text,
               closes_at timestamptz, entries int, total_weight text, winner_member_id uuid, winner_label text,
               winner_address text, drawn_at timestamptz, unpaid boolean, payout_tx_hash text,
               payout_recorded_at timestamptz, paid_at timestamptz, cancel_reason text, created_by_label text,
               created_at timestamptz, paid_late boolean, draw_refused text)
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
         r.created_at,
         -- 4: the rule of _raffle_card's paidLate
         coalesce(r.status = 'paid' and r.payout_block_time > r.drawn_at + interval '14 days', false),
         -- 1: a refusal matters only while the raffle still awaits its draw
         case when r.status = 'closed' then r.draw_refused_code end
  from public.raffles r
  where r.chain_id = v_chain
    and (r.status in ('open', 'closed', 'drawn')
         or coalesce(r.paid_at, r.cancelled_at, r.closed_at) >= now() - interval '30 days')
  order by (r.status in ('open', 'closed', 'drawn')) desc, r.created_at desc, r.id;
end;
$$;

-- ===== 3. relink audit: one helper, called by the four re-link paths below (latest 20261019400005) =====
create function public._audit_payout_relink(o public.dao_safe_operations, p_from_kind text, p_from uuid,
                                            p_to_kind text, p_to uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'treasury_payout_relinked', 'dao_safe_operation', o.id, jsonb_build_object(
    'txHash', o.tx_hash, 'logIndex', o.log_index,
    'fromKind', p_from_kind, 'fromId', p_from, 'toKind', p_to_kind, 'toId', p_to))
$$;

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

-- ===== grants (create or replace keeps them; restated) =====
revoke execute on function
  public._audit_payout_relink(public.dao_safe_operations, text, uuid, text, uuid),
  public._withdrawal_unlink_ops(uuid, text, int),
  public._raffle_unlink_ops(uuid, text, int),
  public.unlink_withdrawal_candidate(uuid, text, int, text),
  public.unlink_raffle_candidate(uuid, text, int, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.unlink_withdrawal_candidate(uuid, text, int, text),
  public.unlink_raffle_candidate(uuid, text, int, text)
to service_role;

-- ===== 5. request_withdrawal (latest 20261019300002): the requester is not notified =====
create or replace function public.request_withdrawal(p_shares numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_enabled boolean;
  s public.dao_state;
  p public.dao_positions;
  v_supply numeric;
  v_id uuid;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';

  -- held until commit: switching withdrawals off waits for a request in flight
  select cc.withdrawals_enabled into v_enabled from public.chain_config cc where cc.chain_id = v_chain for share;
  if not coalesce(v_enabled, false) then
    raise exception 'withdrawals_disabled';
  end if;
  if p_shares is null or p_shares <= 0 or p_shares <> trunc(p_shares) then
    raise exception 'invalid_input';
  end if;

  -- dao_state before the insert (lock order), then the position
  select * into s from public.dao_state x where x.chain_id = v_chain for update;
  if not found then
    raise exception 'chain_invalid';
  end if;
  select * into p from public.dao_positions x where x.chain_id = v_chain and x.member_id = v_me for update;
  if not found or p_shares > p.shares then
    raise exception 'insufficient_shares';
  end if;

  v_supply := s.total_shares - s.approved_locked_shares;
  if p_shares <> p.shares and (v_supply <= 0 or div(p_shares * s.value_usdc, v_supply) < 1000000) then
    raise exception 'amount_too_small';
  end if;

  if exists (select 1 from public.withdrawal_requests w
             where w.chain_id = v_chain and w.member_id = v_me and w.status in ('pending', 'approved')) then
    raise exception 'withdrawal_exists';
  end if;
  begin
    insert into public.withdrawal_requests (chain_id, member_id, shares)
    values (v_chain, v_me, p_shares)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'withdrawal_exists';
  end;

  update public.dao_positions
  set locked_shares = p_shares, updated_at = now()
  where chain_id = v_chain and member_id = v_me;

  -- treasurers only learn that a request exists (no name, no amount in the notice); a requesting treasurer already knows
  insert into public.notifications (recipient_id, kind, data)
  select m.id, 'treasury_notice', jsonb_build_object('event', 'withdrawal_requested', 'requestId', v_id)
  from public.members m
  where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0 and m.id <> v_me;

  return v_id;
end;
$$;

-- ===== 6. dao_overview (latest 20261019300002): donors as dao_ranking =====
create or replace function public.dao_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_total numeric := 0;
  v_value numeric := 0;
  v_club numeric := 0;
  v_approved_locked numeric := 0;
  v_supply numeric := 0;
  v_nav_at timestamptz;
  v_shares numeric := 0;
  v_locked numeric := 0;
  v_my_approved numeric := 0;
  v_counted numeric := 0;
  v_net numeric := 0;
  v_pending jsonb;
  v_comp jsonb;
  v_enabled boolean;
  v_w public.withdrawal_requests;
  v_withdrawal jsonb;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select s.total_shares, s.value_usdc, s.club_shares, s.approved_locked_shares, s.nav_at
    into v_total, v_value, v_club, v_approved_locked, v_nav_at
  from public.dao_state s where s.chain_id = v_chain;
  v_total := coalesce(v_total, 0);
  v_value := coalesce(v_value, 0);
  v_supply := v_total - coalesce(v_approved_locked, 0);
  select p.shares, p.net_contributed_usdc, p.locked_shares into v_shares, v_net, v_locked
  from public.dao_positions p where p.chain_id = v_chain and p.member_id = v_me;
  v_shares := coalesce(v_shares, 0);
  v_locked := coalesce(v_locked, 0);
  select coalesce(sum(w.shares), 0) into v_my_approved
  from public.withdrawal_requests w
  where w.chain_id = v_chain and w.member_id = v_me and w.status = 'approved';
  v_counted := greatest(v_shares - v_my_approved, 0);
  select cc.withdrawals_enabled into v_enabled from public.chain_config cc where cc.chain_id = v_chain;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ledgerId', l.id, 'amount', l.amount_usdc::text, 'txHash', l.tx_hash, 'createdAt', l.created_at)
         order by l.created_at desc, l.id), '[]'::jsonb)
    into v_pending
  from public.dao_ledger l
  where l.chain_id = v_chain and l.member_id = v_me and l.status = 'pending_finality';
  select jsonb_build_object(
           'usdcUnits', n.usdc_units::text, 'ethWei', n.eth_wei::text, 'wethWei', n.weth_wei::text,
           'ethPriceE8', n.eth_price_e8::text, 'priceSource', n.price_source, 'takenAt', n.taken_at)
    into v_comp
  from public.dao_nav_snapshots n
  where n.chain_id = v_chain
  order by n.taken_at desc
  limit 1;

  -- the active request, else the newest one closed in the last 14 days
  select * into v_w from public.withdrawal_requests w
  where w.chain_id = v_chain and w.member_id = v_me and w.status in ('pending', 'approved')
  limit 1;
  if not found then
    select * into v_w from public.withdrawal_requests w
    where w.chain_id = v_chain and w.member_id = v_me and w.status in ('paid', 'rejected', 'cancelled')
      and coalesce(w.paid_at, w.rejected_at, w.cancelled_at) >= now() - interval '14 days'
    order by coalesce(w.paid_at, w.rejected_at, w.cancelled_at) desc, w.created_at desc, w.id
    limit 1;
  end if;
  if v_w.id is not null then
    v_withdrawal := jsonb_build_object(
      'id', v_w.id,
      'status', v_w.status,
      'shares', v_w.shares::text,
      'amountUsdc', v_w.amount_usdc_locked::text,
      'approvedAt', v_w.approved_at,
      'expiresAt', v_w.approved_at + interval '14 days',
      'payoutRecorded', v_w.payout_tx_hash is not null,
      'payoutTxHash', v_w.payout_tx_hash,
      'rejectReason', v_w.reject_reason,
      'lastExpiredAt', v_w.last_expired_at,
      'createdAt', v_w.created_at);
  end if;

  return jsonb_build_object(
    'chainId', v_chain,
    'totalShares', v_total::text,
    'valueUsdc', v_value::text,
    -- the holders dao_ranking lists: shares minus approved ones > 0 (pending locked shares still count)
    'donors', (select count(*) from public.dao_positions p
               where p.chain_id = v_chain
                 and p.shares - coalesce((select sum(w.shares) from public.withdrawal_requests w
                                          where w.chain_id = v_chain and w.member_id = p.member_id
                                            and w.status = 'approved'), 0) > 0),
    'myShares', v_shares::text,
    'myShareBps', case when v_supply <= 0 then 0 else div(v_counted * 10000, v_supply) end,
    'myNet', coalesce(v_net, 0)::text,
    'myPending', v_pending,
    'navUsd6', v_value::text,
    'navAt', v_nav_at,
    'sharePriceUsd6', case when v_supply <= 0 then '0' else div(v_value * 1000000000000000000, v_supply)::text end,
    'myValueUsd6', case when v_supply <= 0 then '0' else div(v_counted * v_value, v_supply)::text end,
    'clubShares', coalesce(v_club, 0)::text,
    'composition', v_comp,
    'withdrawalsEnabled', coalesce(v_enabled, false),
    'supplyShares', greatest(v_supply, 0)::text,
    'myLockedShares', v_locked::text,
    'myWithdrawal', v_withdrawal);
end;
$$;

-- ===== 7. dead code =====
drop function public.record_reconciliation(int, numeric, uuid);
drop table public.dao_reconciliations;

delete from public.notifications where kind = 'treasury_mismatch';
-- the list from 20261019500002 without treasury_mismatch
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention', 'reply', 'channel_message',
  'invite_redeemed', 'godchild_banned', 'sponsor_penalized',
  'report_new', 'member_review',
  'ticket_new', 'ticket_reply', 'ticket_status',
  'tip_received', 'bounty_solution', 'bounty_paid',
  'treasury_outflow',
  'withdrawal_approved', 'withdrawal_rejected', 'withdrawal_paid', 'withdrawal_expired', 'treasury_notice',
  'raffle_won',
  'poll_closed'
));

-- ===== _push_build (latest 20261019500004) without the treasury_mismatch branches =====
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
  v_raffle_title text;
begin
  select * into n from public.notifications x where x.id = p_id;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.members m where m.id = n.recipient_id and m.status = 'active') then
    return;
  end if;
  if n.kind in ('mention', 'reply', 'channel_message', 'poll_closed') and n.channel_id is null then
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
  if n.kind in ('mention', 'reply', 'channel_message', 'poll_closed') then
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
  elsif n.kind = 'treasury_notice' and n.data ->> 'event' in ('raffle_drawn', 'raffle_unpaid') then
    v_url := '/dao/tesoreria#sorteos';
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
    when 'poll_closed' then
      v_title := 'Encuesta cerrada';
      v_phrase := 'Se ha cerrado la encuesta en la que votaste en #' || coalesce(v_channel, '');
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
                    when 'raffle_drawn' then 'Un sorteo tiene ganador: hay un premio que pagar.'
                    when 'raffle_unpaid' then 'Un premio de sorteo lleva 14 días sin pagarse.'
                  end;
      if v_phrase is null then
        return;
      end if;
    when 'raffle_won' then
      if coalesce(n.data ->> 'raffleId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,78}$'
         or coalesce(n.data ->> 'token', '') not in ('USDC', 'WETH') then
        return;
      end if;
      v_url := '/dao/sorteos/' || (n.data ->> 'raffleId');
      v_raffle_title := btrim(left(btrim(regexp_replace(coalesce(n.data ->> 'title', ''), '[[:cntrl:]]+', ' ', 'g')), 60));
      v_title := 'Has ganado un sorteo';
      -- WETH has 18 decimals like ETH: _format_token_amount knows only ETH (18) and USDC (6)
      v_phrase := 'Premio: '
                  || public._format_token_amount((n.data ->> 'amount')::numeric,
                                                  case when n.data ->> 'token' = 'USDC' then 'USDC' else 'ETH' end)
                  || ' ' || (n.data ->> 'token') || ' en «' || v_raffle_title
                  || '». El tesorero te lo enviará desde la Safe.';
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
  public.record_raffle_draw_refusal(uuid, text),
  public.treasury_raffles(),
  public.request_withdrawal(numeric)
from public, anon, authenticated, service_role;

grant execute on function public.record_raffle_draw_refusal(uuid, text) to service_role;
grant execute on function public.treasury_raffles(), public.request_withdrawal(numeric) to authenticated;
