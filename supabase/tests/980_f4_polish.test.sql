-- F4 polish (migration 20261019600001):
--   1. record_raffle_draw_refusal: the cron's refused draws are stored once per raffle and code; treasury_raffles
--      exposes the code while the raffle is still closed (the «Avisos» derive the alert on read).
--   3. Every internal re-link of an outflow from one kind to the other writes a treasury_payout_relinked audit row.
--   4. treasury_raffles.paid_late, the rule of the public card.
--   5. request_withdrawal does not notify the requesting treasurer.
--   6. dao_overview.donors counts the holders dao_ranking lists (shares minus approved ones > 0).
--   7. Dead code: my_dao_position, record_reconciliation, dao_reconciliations and the treasury_mismatch kind are gone.
-- Setup: 59141 valued at 200 USDC, S = 10 * 10^18: A 6, W 2, V 1, T 1 (T is a treasurer, T2 another one).
begin;
select plan(37);

-- ===== helpers (rolled back with the test) =====
create function tests.ph(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.psafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
create function tests.pw(p_member text) returns text language sql stable as $$
  select lower(m.wallet_address) from public.members m where m.id = current_setting('t.' || p_member)::uuid
$$;
create function tests.puser(p_member text) returns uuid language sql stable as $$
  select auth_user_id from public.members where id = current_setting('t.' || p_member)::uuid
$$;
create function tests.pcreate(p_amount numeric) returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.puser('t'));
  v := public.create_raffle('Sorteo ' || p_amount, 'USDC', p_amount, now() + interval '1 day', 'equal');
  perform tests.clear_authentication();
  return (v ->> 'id')::uuid;
end;
$$;
create function tests.pdrawn(p_raffle uuid, p_winner text) returns void language plpgsql as $$
begin
  update public.raffles
  set status = 'drawn', closed_at = now(), total_weight = 1, seed_reveal = '0x' || lpad('5eed', 64, '0'),
      draw_block_number = 1, draw_block_hash = tests.ph(1), draw_block_time = now(), draw_random = '0',
      winner_position = 1, winner_member_id = current_setting('t.' || p_winner)::uuid,
      winner_address = tests.pw(p_winner), drawn_at = now()
  where id = p_raffle;
  delete from private.raffle_seeds where raffle_id = p_raffle;
end;
$$;
create function tests.pops(p_n int, p_amount numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_safe_operations(59141, tests.psafe(), jsonb_build_array(jsonb_build_object(
    'txHash', tests.ph(p_n), 'logIndex', 0, 'asset', 'USDC', 'direction', 'out', 'amount', p_amount::text,
    'counterparty', tests.pw('w'), 'blockNumber', p_block, 'occurredAt', now() + interval '1 minute')), p_block);
  reset role;
  return v;
end;
$$;
create function tests.ppay(p_n int, p_block bigint, p_amount numeric) returns jsonb language sql as $$
  select jsonb_build_object('txHash', tests.ph(p_n), 'logIndex', '0', 'blockNumber', p_block::text,
                            'blockTime', to_char((now() + interval '1 minute') at time zone 'UTC',
                                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                            'to', tests.pw('w'), 'token', 'USDC', 'amount', p_amount::text)
$$;
create function tests.pop(p_n int) returns public.dao_safe_operations language sql as $$
  select o from public.dao_safe_operations o where o.chain_id = 59141 and o.tx_hash = tests.ph(p_n)
$$;
-- the treasury_payout_relinked audit rows of tx n, as "fromKind:fromId>toKind:toId" (oldest first)
create function tests.prelinks(p_n int) returns text language sql as $$
  select coalesce(string_agg(a.payload ->> 'fromKind' || ':' || (a.payload ->> 'fromId') || '>'
                             || (a.payload ->> 'toKind') || ':' || (a.payload ->> 'toId'), ',' order by a.id), '')
  from public.audit_log a
  where a.action = 'treasury_payout_relinked' and a.payload ->> 'txHash' = tests.ph(p_n)
$$;
create function tests.prefuse(p_raffle uuid, p_code text) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.record_raffle_draw_refusal(p_raffle, p_code);
  reset role;
  return v;
end;
$$;
create function tests.ptreasury(p_raffle uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.puser('t'));
  select to_jsonb(x) into v from public.treasury_raffles() x where x.id = p_raffle;
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.poverview(p_member text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.puser(p_member));
  v := public.dao_overview();
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.pranked(p_member text) returns int language plpgsql as $$
declare v int;
begin
  perform tests.authenticate_as(tests.puser(p_member));
  select count(*)::int into v from public.dao_ranking(100) r where r.label <> 'Fondo del club';
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.pnotices(p_member text, p_request text) returns int language sql as $$
  select count(*)::int from public.notifications n
  where n.recipient_id = current_setting('t.' || p_member)::uuid and n.kind = 'treasury_notice'
    and n.data ->> 'event' = 'withdrawal_requested' and n.data ->> 'requestId' = p_request
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9800', 40, '0'), null, true)::text, true);
select set_config('t.w', tests.create_member('0x' || lpad('f9801', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.v', tests.create_member('0x' || lpad('f9802', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9803', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t2', tests.create_member('0x' || lpad('f9804', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T980 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select m, r.id from public.roles r, unnest(array[current_setting('t.t')::uuid, current_setting('t.t2')::uuid]) m
  where r.name = 'T980 tesorero';

update public.chain_config set safe_address = '0x' || lpad('5afe98001', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
delete from public.dao_safe_operations where raffle_id is not null;
delete from public.raffles;
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
update public.withdrawal_requests set status = 'cancelled', cancelled_at = now() - interval '60 days', amount_usdc_locked = null,
       payout_tx_hash = null, payout_log_index = null, payout_block = null, payout_amount = null, payout_recorded_at = null
  where status in ('pending', 'approved');
delete from public.dao_safe_operations where chain_id = 59141;
delete from public.dao_nav_snapshots where chain_id = 59141;
delete from public.dao_positions where chain_id = 59141;
delete from public.dao_scan_state where chain_id = 59141;
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 200000000,
                            approved_locked_shares = 0, nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.a')::uuid, 6000000000000000000, 120000000),
  (59141, current_setting('t.w')::uuid, 2000000000000000000, 40000000),
  (59141, current_setting('t.v')::uuid, 1000000000000000000, 20000000),
  (59141, current_setting('t.t')::uuid, 1000000000000000000, 20000000);
-- the scan has covered block 10 (the valuation guard of 20261019300007 while approvals are open)
insert into public.dao_scan_state (chain_id, last_block) values (59141, 10);

-- W asks for half, V for the whole position; both approved. T (a treasurer) asks for the whole position (pending).
select tests.authenticate_as(tests.puser('w'));
select set_config('t.wr', public.request_withdrawal(1000000000000000000)::text, true);
select tests.clear_authentication();
select tests.authenticate_as(tests.puser('v'));
select set_config('t.vr', public.request_withdrawal(1000000000000000000)::text, true);
select tests.clear_authentication();
select tests.authenticate_as(tests.puser('t'));
select set_config('t.tr', public.request_withdrawal(1000000000000000000)::text, true);
select tests.clear_authentication();
set local role service_role;
select public.approve_withdrawal(current_setting('t.wr')::uuid, current_setting('t.t2')::uuid, tests.psafe(), 200000000, 10);
select public.approve_withdrawal(current_setting('t.vr')::uuid, current_setting('t.t2')::uuid, tests.psafe(), 200000000, 10);
reset role;
select is((select string_agg(status, ',' order by status) from public.withdrawal_requests
           where id in (current_setting('t.wr')::uuid, current_setting('t.vr')::uuid, current_setting('t.tr')::uuid)),
  'approved,approved,pending', 'setup: W and V approved, T pending');

-- ===== 5. request_withdrawal: the requesting treasurer is not notified of their own request =====
select is(tests.pnotices('t', current_setting('t.tr')), 0, 'T, a treasurer, gets no treasury_notice for their own request');
select is(tests.pnotices('t2', current_setting('t.tr')), 1, 'the other treasurer does');
select is(tests.pnotices('t', current_setting('t.wr')), 1, 'T is still notified of other members'' requests');

-- ===== 6. dao_overview.donors = the members dao_ranking lists =====
select is(tests.pranked('a'), 3, 'dao_ranking lists A, W and T (V''s whole position is approved)');
select is((tests.poverview('a') ->> 'donors')::int, 3, 'donors counts the same three: V is out, pending T is in');
select is((tests.poverview('v') ->> 'donors')::int, tests.pranked('v'), 'and agrees with dao_ranking for any reader');

-- ===== 1. refused draws =====
select set_config('t.rk', tests.pcreate(4000000)::text, true);
update public.raffles set status = 'closed', closed_at = now(), total_weight = 1 where id = current_setting('t.rk')::uuid;
select ok((select has_function_privilege('service_role', 'public.record_raffle_draw_refusal(uuid,text)', 'execute')
              and not has_function_privilege('authenticated', 'public.record_raffle_draw_refusal(uuid,text)', 'execute')
              and not has_function_privilege('anon', 'public.record_raffle_draw_refusal(uuid,text)', 'execute')),
  'record_raffle_draw_refusal is service-only');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
           where oid = 'public.record_raffle_draw_refusal(uuid,text)'::regprocedure),
  'record_raffle_draw_refusal is security definer with an empty search_path');
select is(tests.ptreasury(current_setting('t.rk')::uuid) -> 'draw_refused', 'null'::jsonb,
  'a closed raffle without a refusal has no draw_refused');
select ok(tests.prefuse(current_setting('t.rk')::uuid, 'draw_block_invalid'), 'the first refusal is stored');
select is(tests.ptreasury(current_setting('t.rk')::uuid) ->> 'draw_refused', 'draw_block_invalid',
  'treasury_raffles exposes the refusal code');
select set_config('t.rkat', (select draw_refused_at::text from public.raffles where id = current_setting('t.rk')::uuid), true);
select ok(not tests.prefuse(current_setting('t.rk')::uuid, 'draw_block_invalid'), 'the same refusal again changes nothing');
select is((select draw_refused_at::text from public.raffles where id = current_setting('t.rk')::uuid), current_setting('t.rkat'),
  'its time is the first one');
select is((select count(*)::int from public.audit_log where action = 'raffle_draw_refused' and target_id = current_setting('t.rk')::uuid),
  1, 'one audit row, not one per hourly run');
select ok(tests.prefuse(current_setting('t.rk')::uuid, 'invalid_state'), 'a different code replaces it');
select is(tests.ptreasury(current_setting('t.rk')::uuid) ->> 'draw_refused', 'invalid_state', 'with the new code');
select throws_ok($$select tests.prefuse(current_setting('t.rk')::uuid, 'Not a code!')$$, 'invalid_input',
  'a malformed code is refused');
select ok(not tests.prefuse(gen_random_uuid(), 'invalid_state'), 'an unknown raffle is a no-op');
select tests.pdrawn(current_setting('t.rk')::uuid, 'w');
select is(tests.ptreasury(current_setting('t.rk')::uuid) -> 'draw_refused', 'null'::jsonb,
  'once drawn the refusal is no longer reported');
select ok(not tests.prefuse(current_setting('t.rk')::uuid, 'invalid_state'), 'and a drawn raffle stores no refusal');

-- ===== 4. treasury_raffles.paid_late =====
select set_config('t.rl', tests.pcreate(3000000)::text, true);
select set_config('t.ro', tests.pcreate(2000000)::text, true);
select tests.pdrawn(current_setting('t.rl')::uuid, 'w');
select tests.pdrawn(current_setting('t.ro')::uuid, 'w');
update public.raffles set status = 'paid', paid_at = now() + interval '15 days', payout_tx_hash = tests.ph(700 + x.n),
       payout_log_index = 0, payout_block = 700 + x.n, payout_amount = prize_amount, payout_recorded_at = now(),
       payout_block_time = case when x.n = 1 then drawn_at + interval '15 days' else drawn_at + interval '13 days' end
  from (values (current_setting('t.rl')::uuid, 1), (current_setting('t.ro')::uuid, 2)) x(id, n)
 where raffles.id = x.id;
select is(tests.ptreasury(current_setting('t.rl')::uuid) -> 'paid_late', 'true'::jsonb, 'paid 15 days after the draw: paid_late');
select is(tests.ptreasury(current_setting('t.ro')::uuid) -> 'paid_late', 'false'::jsonb, 'paid within 14 days: not late');
select is(tests.ptreasury(current_setting('t.rk')::uuid) -> 'paid_late', 'false'::jsonb, 'a drawn, unpaid raffle is not late-paid');

-- ===== 3. internal re-links write an audit row =====
select set_config('t.r1', tests.pcreate(25000000)::text, true);
select set_config('t.r2', tests.pcreate(5000000)::text, true);
select tests.pdrawn(current_setting('t.r1')::uuid, 'w');
select tests.pdrawn(current_setting('t.r2')::uuid, 'w');
-- R1's payout (tx 1) is recorded; the race leaves tx 1 as W's withdrawal candidate
set local role service_role;
select public.record_raffle_payout(current_setting('t.r1')::uuid, tests.psafe(), tests.ppay(1, 101, 25000000), current_setting('t.t')::uuid);
reset role;
select tests.pops(1, 25000000, 101);
update public.dao_safe_operations set raffle_id = null, withdrawal_id = current_setting('t.wr')::uuid,
                                      missing_since = now() - interval '1 hour'
 where chain_id = 59141 and tx_hash = tests.ph(1);
set local role service_role;
select public.unlink_withdrawal_candidate(current_setting('t.wr')::uuid, tests.ph(1), 0, 'failed');
reset role;
select is(tests.prelinks(1), 'withdrawal:' || current_setting('t.wr') || '>raffle:' || current_setting('t.r1'),
  'unlink_withdrawal_candidate: one relink row, from the withdrawal to R1');
select is((select jsonb_build_array(a.actor_member_id, a.target_type, a.target_id = (tests.pop(1)).id, a.payload ->> 'logIndex')
           from public.audit_log a where a.action = 'treasury_payout_relinked' and a.payload ->> 'txHash' = tests.ph(1)),
  jsonb_build_array(null, 'dao_safe_operation', true, '0'), 'system actor, the operation as target, the log index');
select is((select count(*)::int from public.audit_log a, jsonb_object_keys(a.payload) k
           where a.action = 'treasury_payout_relinked' and a.payload ->> 'txHash' = tests.ph(1)
             and k not in ('txHash', 'logIndex', 'fromKind', 'fromId', 'toKind', 'toId')), 0,
  'the payload carries only the tx, the log and both links');

-- W's payout (tx 2) is recorded; the race leaves tx 2 as R2's candidate
set local role service_role;
select public.record_withdrawal_payout(current_setting('t.wr')::uuid, tests.psafe(), tests.ppay(2, 102, 20000000) - 'token',
                                       current_setting('t.t')::uuid);
reset role;
select tests.pops(2, 20000000, 102);
update public.dao_safe_operations set withdrawal_id = null, raffle_id = current_setting('t.r2')::uuid
 where chain_id = 59141 and tx_hash = tests.ph(2);
set local role service_role;
select public.unlink_raffle_candidate(current_setting('t.r2')::uuid, tests.ph(2), 0, 'failed');
reset role;
select is(tests.prelinks(2), 'raffle:' || current_setting('t.r2') || '>withdrawal:' || current_setting('t.wr'),
  'unlink_raffle_candidate: one relink row, from R2 to the withdrawal');

-- the internal helpers
update public.dao_safe_operations set withdrawal_id = null, raffle_id = current_setting('t.r2')::uuid
 where chain_id = 59141 and tx_hash = tests.ph(2);
select public._raffle_unlink_ops(current_setting('t.r2')::uuid, null, null);
select is(tests.prelinks(2), 'raffle:' || current_setting('t.r2') || '>withdrawal:' || current_setting('t.wr')
                             || ',raffle:' || current_setting('t.r2') || '>withdrawal:' || current_setting('t.wr'),
  '_raffle_unlink_ops writes a relink row');
update public.dao_safe_operations set raffle_id = null, withdrawal_id = current_setting('t.wr')::uuid
 where chain_id = 59141 and tx_hash = tests.ph(1);
select public._withdrawal_unlink_ops(current_setting('t.wr')::uuid, tests.ph(2), 0);
select is(tests.prelinks(1), 'withdrawal:' || current_setting('t.wr') || '>raffle:' || current_setting('t.r1')
                             || ',withdrawal:' || current_setting('t.wr') || '>raffle:' || current_setting('t.r1'),
  '_withdrawal_unlink_ops writes a relink row');
select is((select count(*)::int from public.audit_log where action = 'treasury_payout_relinked' and payload ->> 'txHash' = tests.ph(2)),
  2, 'the kept payout (tx 2) gets no extra row');
-- a plain unlink (nothing recorded elsewhere) is not a relink
select tests.pops(3, 2000000, 103);
update public.dao_safe_operations set raffle_id = null, withdrawal_id = current_setting('t.wr')::uuid
 where chain_id = 59141 and tx_hash = tests.ph(3);
select public._withdrawal_unlink_ops(current_setting('t.wr')::uuid, tests.ph(2), 0);
select is(tests.prelinks(3), '', 'an unlink with nothing to re-link to writes no relink row');

-- ===== 7. dead code is gone =====
select hasnt_function('public', 'my_dao_position', 'my_dao_position is gone');
select hasnt_function('public', 'record_reconciliation', 'record_reconciliation is gone');
select hasnt_table('public', 'dao_reconciliations', 'dao_reconciliations is gone');
select throws_ok($$insert into public.notifications (recipient_id, kind, data)
                   values (current_setting('t.t')::uuid, 'treasury_mismatch', '{}'::jsonb)$$, '23514', null,
  'treasury_mismatch is no longer a notification kind');
select ok((select position('treasury_mismatch' in prosrc) = 0 from pg_proc where oid = 'public._push_build(bigint)'::regprocedure),
  '_push_build has no treasury_mismatch branch');

select * from finish();
rollback;
