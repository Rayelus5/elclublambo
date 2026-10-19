-- F4c Task 2: withdrawal requests (one active per chain and member), the per-network switch, locked shares, the
-- counted supply S_eff = total_shares - approved_locked_shares and gating on unlocked shares.
begin;
select plan(86);

-- ===== helpers (rolled back with the test) =====
create function tests.wh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
-- a pending_finality donation of p_amount on the active chain by p_user, paid in tx p_n at block p_block
create function tests.wpend(p_user uuid, p_amount numeric, p_n int, p_block bigint default 100)
returns uuid language plpgsql as $$
declare
  v jsonb;
  v_id uuid;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_donation_intent(p_amount, 0, true);
  perform public.attach_intent_tx((v ->> 'id')::uuid, 'main', tests.wh(p_n));
  perform tests.clear_authentication();
  set local role service_role;
  v_id := public.record_donation((v ->> 'id')::uuid,
    jsonb_build_object('txHash', tests.wh(p_n), 'logIndex', 0, 'blockNumber', p_block), null);
  reset role;
  return v_id;
end;
$$;
create function tests.wcr(p_ledger uuid, p_assets numeric, p_block bigint default 1000000) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.credit_donation(p_ledger, p_assets, p_block);
  reset role;
  return v;
end;
$$;
create function tests.wsupply(p_chain int) returns numeric language plpgsql as $$
declare v numeric;
begin
  set local role service_role;
  v := public._dao_supply(p_chain);
  reset role;
  return v;
end;
$$;
-- dao_overview() as the given auth user
create function tests.wov(p_user uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(p_user);
  v := public.dao_overview();
  perform tests.clear_authentication();
  return v;
end;
$$;
-- security definer: the realtime.messages receive policy hides rows from a session without a joined topic
create function tests.wev() returns int language sql security definer set search_path = '' as $$
  select count(*)::int from realtime.messages m where m.event = 'dao_changed' and m.topic = 'dao'
$$;
create function tests.wlocked(p_member text) returns numeric language sql as $$
  select locked_shares from public.dao_positions where chain_id = 59141 and member_id = current_setting('t.' || p_member)::uuid
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9510', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9511', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9512', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.s', tests.create_member('0x' || lpad('f9513', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T951 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T951 tesorero';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.s')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.ut', (select auth_user_id::text from public.members where id = current_setting('t.t')::uuid), true);
select set_config('t.us', (select auth_user_id::text from public.members where id = current_setting('t.s')::uuid), true);

update public.chain_config set safe_address = '0x' || lpad('5afe95101', 40, '0'), platform_wallet = null where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';
-- whatever the local database holds for 59141 is not part of these scenarios
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
delete from public.dao_positions where chain_id = 59141;
-- A holds all 10 * 10^18 shares, valued at 10 USDC
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 10000000,
                            nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc)
  values (59141, current_setting('t.a')::uuid, 10000000000000000000, 10000000);

-- ===== 1. grants and schema =====
select ok(not has_function_privilege('anon', 'public.request_withdrawal(numeric)', 'execute'), 'anon cannot request_withdrawal');
select ok(not has_function_privilege('anon', 'public.cancel_withdrawal(uuid)', 'execute'), 'anon cannot cancel_withdrawal');
select ok(not has_function_privilege('anon', 'public.set_withdrawals_enabled(int,boolean)', 'execute'), 'anon cannot set_withdrawals_enabled');
select ok(has_function_privilege('authenticated', 'public.request_withdrawal(numeric)', 'execute')
      and has_function_privilege('authenticated', 'public.cancel_withdrawal(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.set_withdrawals_enabled(int,boolean)', 'execute'),
  'members can call the member-side withdrawal RPCs');
select ok(not has_function_privilege('authenticated', 'public._dao_supply(int)', 'execute')
      and not has_function_privilege('anon', 'public._dao_supply(int)', 'execute')
      and has_function_privilege('service_role', 'public._dao_supply(int)', 'execute'), '_dao_supply is service-only');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.request_withdrawal(numeric)'::regprocedure, 'public.cancel_withdrawal(uuid)'::regprocedure,
                         'public.set_withdrawals_enabled(int,boolean)'::regprocedure, 'public._dao_supply(int)'::regprocedure)),
  'withdrawal functions are definer with an empty search_path');
select ok((select relrowsecurity from pg_class where oid = 'public.withdrawal_requests'::regclass), 'withdrawal_requests has RLS on');
select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'withdrawal_requests'),
  'withdrawal_requests has no client policy');
select ok(not has_table_privilege('authenticated', 'public.withdrawal_requests', 'select')
      and not has_table_privilege('anon', 'public.withdrawal_requests', 'select'), 'clients cannot read withdrawal_requests');
select is((select count(*)::int from public.chain_config where withdrawals_enabled), 0, 'withdrawals are off on both networks');
select is((select value from public.app_config where key = 'withdrawals_enabled'), 'false'::jsonb,
  'the legacy app_config key is untouched');
select has_column('public', 'dao_safe_operations', 'withdrawal_id', 'dao_safe_operations.withdrawal_id exists');
select throws_ok($$update public.dao_positions set locked_shares = shares + 1 where chain_id = 59141$$, '23514', null,
  'locked_shares cannot exceed shares');
select throws_ok($$update public.dao_positions set locked_shares = -1 where chain_id = 59141$$, '23514', null,
  'locked_shares cannot be negative');
select throws_ok($$update public.dao_state set approved_locked_shares = total_shares - club_shares + 1 where chain_id = 59141$$,
  '23514', null, 'approved_locked_shares cannot exceed the members'' shares');
select throws_ok($$insert into public.withdrawal_requests (chain_id, member_id, shares, status)
                   values (59141, current_setting('t.b')::uuid, 1, 'approved')$$, '23514', null,
  'an approved request needs its amount, approval time and destination');
select throws_ok($$insert into public.withdrawal_requests (chain_id, member_id, shares, status, payout_tx_hash)
                   values (59141, current_setting('t.b')::uuid, 1, 'pending', '0x' || repeat('a', 64))$$, '23514', null,
  'payout columns are all set or all null, and only on approved/paid');

-- ===== 2. switch =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.request_withdrawal(4000000000000000000)$$, 'withdrawals_disabled',
  'requesting with the switch off raises withdrawals_disabled');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok($$select public.set_withdrawals_enabled(59141, true)$$, 'forbidden', 'a treasurer (256 only) cannot flip the switch');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('t.us')::uuid);
select throws_ok($$select public.set_withdrawals_enabled(1, true)$$, 'chain_invalid', 'unknown chain raises chain_invalid');
select throws_ok($$select public.set_withdrawals_enabled(59141, null)$$, 'invalid_input', 'a null switch value is invalid');
select lives_ok($$select public.set_withdrawals_enabled(59141, true)$$, 'SuperAdmin turns withdrawals on for 59141');
select tests.clear_authentication();
select is((select withdrawals_enabled from public.chain_config where chain_id = 59141), true, '59141 is on');
select is((select withdrawals_enabled from public.chain_config where chain_id = 59144), false, '59144 stays off');
select is((select payload from public.audit_log where action = 'economy.withdrawals'
             and actor_member_id = current_setting('t.s')::uuid order by created_at desc limit 1),
  jsonb_build_object('chain', 59141, 'old', false, 'new', true), 'the switch is audited as economy.withdrawals {chain, old, new}');

select tests.authenticate_as(current_setting('t.ua')::uuid);
select is(public.economy_config() #> '{chains,59141,withdrawalsEnabled}', 'true'::jsonb, 'economy_config shows 59141 on');
select is(public.economy_config() #> '{chains,59144,withdrawalsEnabled}', 'false'::jsonb, 'economy_config shows 59144 off');

-- ===== 3. request =====
select set_config('t.r1', public.request_withdrawal(4000000000000000000)::text, true);
select tests.clear_authentication();
select is((select status from public.withdrawal_requests where id = current_setting('t.r1')::uuid), 'pending', 'the request is pending');
select is((select shares::text || ':' || chain_id::text || ':' || member_id::text from public.withdrawal_requests
           where id = current_setting('t.r1')::uuid),
  '4000000000000000000:59141:' || current_setting('t.a'), 'the request records shares, active chain and member');
select is(tests.wlocked('a'), 4000000000000000000::numeric, 'the requested shares are locked');
select is((select count(*)::int from public.notifications where kind = 'treasury_notice'
             and data = jsonb_build_object('event', 'withdrawal_requested', 'requestId', current_setting('t.r1'))),
  (select count(*)::int from public.members m where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0),
  'every active treasurer receives a treasury_notice');
select ok(exists (select 1 from public.notifications where kind = 'treasury_notice' and recipient_id = current_setting('t.t')::uuid
                  and data ->> 'requestId' = current_setting('t.r1')),
  'the 256-only treasurer is notified');
select ok(not exists (select 1 from public.notifications where kind = 'treasury_notice' and recipient_id = current_setting('t.b')::uuid),
  'a plain member is not notified');

select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.request_withdrawal(4000000000000000000)$$, 'withdrawal_exists', 'a second request raises withdrawal_exists');
select throws_ok($$select public.request_withdrawal(11000000000000000000)$$, 'insufficient_shares', 'more than the position raises insufficient_shares');
select throws_ok($$select public.request_withdrawal(0)$$, 'invalid_input', 'zero shares is invalid');
select throws_ok($$select public.request_withdrawal(1.5)$$, 'invalid_input', 'fractional shares are invalid');
select throws_ok($$select public.request_withdrawal(null)$$, 'invalid_input', 'null shares are invalid');
select throws_ok($$select public.request_withdrawal(100000000000000000)$$, 'amount_too_small',
  '0.1 USD (not the whole position) raises amount_too_small');
select tests.clear_authentication();
select is((select count(*)::int from public.withdrawal_requests where member_id = current_setting('t.a')::uuid), 1,
  'only one request exists');

select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($$select public.request_withdrawal(1000000000000000000)$$, 'insufficient_shares', 'no position raises insufficient_shares');
select tests.clear_authentication();

-- the unique index backs the up-front check
select throws_ok($$insert into public.withdrawal_requests (chain_id, member_id, shares)
                   values (59141, current_setting('t.a')::uuid, 1)$$, '23505', null,
  'the database refuses a second active request');

-- ===== 4. gating on unlocked shares =====
select set_config('t.cat', tests.create_channel(null, 'category', 'T951cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'T951 net')::text, true);
update public.channels set gate_min_net_usdc = 7000000, gate_scope = 'view' where id = current_setting('t.ch')::uuid;

select is(public.gate_passes(current_setting('t.a')::uuid, current_setting('t.ch')::uuid, 'view'), false,
  'with 4 of 10 locked the net counts 6 USDC < 7: gate fails');
select is((select share_bps || ':' || net_usdc from public._member_dao_standing(current_setting('t.a')::uuid)), '6000:6000000',
  'standing counts only unlocked shares (6000 bps, 6 USDC)');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((public.channel_lock_state(current_setting('t.ch')::uuid) ->> 'myShareBps')::int, 6000, 'lock state shows myShareBps = 6000');

-- ===== 5. cancel rules =====
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format('select public.cancel_withdrawal(%L)', current_setting('t.r1')), 'not_found', 'B cannot cancel A''s request');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.cancel_withdrawal(gen_random_uuid())$$, 'not_found', 'an unknown request is not_found');
select lives_ok(format('select public.cancel_withdrawal(%L)', current_setting('t.r1')), 'A cancels the pending request');
select throws_ok(format('select public.cancel_withdrawal(%L)', current_setting('t.r1')), 'invalid_state', 'a cancelled request cannot be cancelled again');
select tests.clear_authentication();
select is((select status || ':' || (cancelled_at is not null)::text from public.withdrawal_requests where id = current_setting('t.r1')::uuid),
  'cancelled:true', 'the request is cancelled with cancelled_at');
select is(tests.wlocked('a'), 0::numeric, 'cancelling releases the locked shares');
select is(public.gate_passes(current_setting('t.a')::uuid, current_setting('t.ch')::uuid, 'view'), true, 'after cancelling the gate passes again');

-- ===== 6. donate while a 100 % request is pending =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.r2', public.request_withdrawal(10000000000000000000)::text, true);
select tests.clear_authentication();
select is(tests.wlocked('a'), 10000000000000000000::numeric, 'the whole position is locked (no minimum applies)');
-- a 5 USDC donation credited at NAV 10 (assets 15 minus the 5 still pending) mints 5 * 10^18 shares
select set_config('t.l1', tests.wpend(current_setting('t.ua')::uuid, 5000000, 95101)::text, true);
select is(tests.wcr(current_setting('t.l1')::uuid, 15000000) ->> 'shares', '5000000000000000000', 'the donation is credited');
select is(tests.wlocked('a'), 10000000000000000000::numeric, 'locked_shares still equals the requested amount');
select is((select share_bps || ':' || net_usdc from public._member_dao_standing(current_setting('t.a')::uuid)), '3333:5000000',
  'the new shares count as unlocked (5 of 15: 3333 bps, 5 USDC of 15)');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format('select public.cancel_withdrawal(%L)', current_setting('t.r2')), 'A cancels the 100 % request');
select tests.clear_authentication();

-- ===== 7. supply: an approved request takes its shares out of S_eff =====
-- A 8 * 10^18 (4 of them approved for withdrawal), B 2 * 10^18; NAV 12 USDC
update public.dao_positions set shares = 8000000000000000000, net_contributed_usdc = 8000000, locked_shares = 4000000000000000000
where chain_id = 59141 and member_id = current_setting('t.a')::uuid;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc)
  values (59141, current_setting('t.b')::uuid, 2000000000000000000, 2000000);
update public.dao_state set total_shares = 10000000000000000000, value_usdc = 12000000, approved_locked_shares = 4000000000000000000
where chain_id = 59141;
insert into public.withdrawal_requests (chain_id, member_id, shares, status, amount_usdc_locked, destination_address,
                                        approved_by, approved_at, approval_count)
  values (59141, current_setting('t.a')::uuid, 4000000000000000000, 'approved', 8000000, '0x' || lpad('f9510', 40, '0'),
          current_setting('t.t')::uuid, now() - interval '1 day', 1);
select set_config('t.r3', (select id::text from public.withdrawal_requests where status = 'approved'
                             and member_id = current_setting('t.a')::uuid), true);

select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format('select public.cancel_withdrawal(%L)', current_setting('t.r3')), 'invalid_state', 'an approved request cannot be cancelled');
select tests.clear_authentication();

select is(tests.wsupply(59141), 6000000000000000000::numeric, '_dao_supply = total - approved locked = 6 * 10^18');
select is(tests.wsupply(59144), (select total_shares - approved_locked_shares from public.dao_state where chain_id = 59144),
  '_dao_supply reads each chain');
select set_config('t.ova', tests.wov(current_setting('t.ua')::uuid)::text, true);
select is(current_setting('t.ova')::jsonb ->> 'sharePriceUsd6', '2000000', 'share price = NAV * 10^18 / S_eff (12 / 6)');
select is(current_setting('t.ova')::jsonb ->> 'supplyShares', '6000000000000000000', 'supplyShares is S_eff');
select is(current_setting('t.ova')::jsonb ->> 'myShares', '8000000000000000000', 'myShares is the whole position');
select is(current_setting('t.ova')::jsonb ->> 'myLockedShares', '4000000000000000000', 'myLockedShares');
select is(current_setting('t.ova')::jsonb ->> 'myValueUsd6', '8000000', 'my value counts the unapproved shares only (4 / 6 of 12)');
select is((current_setting('t.ova')::jsonb ->> 'myShareBps')::int, 6666, 'my share = unapproved shares / S_eff');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select share_bps from public.dao_ranking() where member_id = current_setting('t.a')::uuid), 6666,
  'ranking: A counts (8 - 4) / 6');
select is((select string_agg(rank || ':' || label || ':' || share_bps, ',' order by rank) from public.dao_ranking()
           where member_id is distinct from current_setting('t.a')::uuid), '2:Anónimo:3333', 'ranking: B counts 2 / 6');
select tests.clear_authentication();
-- F4c Task 2 carry ii: gating divides the unlocked shares by S_eff (not by total_shares)
select is((select share_bps || ':' || net_usdc from public._member_dao_standing(current_setting('t.a')::uuid)), '6666:4000000',
  'gating: A counts (8 - 4) / S_eff 6 = 6666 bps and 4 of 8 net');
select is((select share_bps || ':' || net_usdc from public._member_dao_standing(current_setting('t.b')::uuid)), '3333:2000000',
  'gating: B counts 2 / S_eff 6 = 3333 bps (2000 over total_shares)');

-- ===== 8. dao_overview().myWithdrawal =====
select is(current_setting('t.ova')::jsonb -> 'withdrawalsEnabled', 'true'::jsonb, 'withdrawalsEnabled for the active chain');
select is(current_setting('t.ova')::jsonb #>> '{myWithdrawal,id}', current_setting('t.r3'), 'myWithdrawal is the active request');
select is(current_setting('t.ova')::jsonb #>> '{myWithdrawal,status}', 'approved', 'myWithdrawal.status');
select is(current_setting('t.ova')::jsonb #>> '{myWithdrawal,shares}', '4000000000000000000', 'myWithdrawal.shares');
select is(current_setting('t.ova')::jsonb #>> '{myWithdrawal,amountUsdc}', '8000000', 'myWithdrawal.amountUsdc');
select ok((current_setting('t.ova')::jsonb #>> '{myWithdrawal,expiresAt}')::timestamptz
          = (current_setting('t.ova')::jsonb #>> '{myWithdrawal,approvedAt}')::timestamptz + interval '14 days',
  'expiresAt = approvedAt + 14 days');
select is(current_setting('t.ova')::jsonb #> '{myWithdrawal,payoutRecorded}', 'false'::jsonb, 'no payout recorded');
select is((current_setting('t.ova')::jsonb -> 'myWithdrawal') - 'id' - 'status' - 'shares' - 'amountUsdc' - 'approvedAt'
          - 'expiresAt' - 'payoutRecorded' - 'createdAt',
  '{"payoutTxHash":null,"rejectReason":null,"lastExpiredAt":null}'::jsonb, 'the remaining myWithdrawal keys are null');
-- B: a request closed 20 days ago is not shown; one closed yesterday is
insert into public.withdrawal_requests (chain_id, member_id, shares, status, cancelled_at, created_at)
  values (59141, current_setting('t.b')::uuid, 1, 'cancelled', now() - interval '20 days', now() - interval '21 days');
select is(tests.wov(current_setting('t.ub')::uuid) -> 'myWithdrawal', 'null'::jsonb, 'a request closed over 14 days ago is not shown');
insert into public.withdrawal_requests (chain_id, member_id, shares, status, cancelled_at, created_at)
  values (59141, current_setting('t.b')::uuid, 1, 'cancelled', now() - interval '1 day', now() - interval '2 days');
select is(tests.wov(current_setting('t.ub')::uuid) #>> '{myWithdrawal,status}', 'cancelled', 'a request closed in the last 14 days is shown');

-- ===== 9. realtime =====
select set_config('t.ev0', tests.wev()::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r4', public.request_withdrawal(2000000000000000000)::text, true);
select tests.clear_authentication();
select is(tests.wev() - current_setting('t.ev0')::int, 1, 'inserting a request sends one dao_changed');
select ok((select bool_and((payload - 'id') = jsonb_build_object('chain_id', 59141) and private) from realtime.messages
           where event = 'dao_changed' and topic = 'dao'),
  'the broadcasts carry only the chain');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select public.cancel_withdrawal(current_setting('t.r4')::uuid);
select tests.clear_authentication();
select is(tests.wev() - current_setting('t.ev0')::int, 2, 'a status change sends one more');
select has_trigger('public', 'withdrawal_requests', 'withdrawal_requests_broadcast', 'withdrawal_requests broadcast trigger');

-- ===== 10. F4c Task 2 carry iii: an inactive member cannot request or cancel =====
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r5', public.request_withdrawal(2000000000000000000)::text, true);
select tests.clear_authentication();
update public.members set status = 'banned' where id = current_setting('t.b')::uuid;
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($$select public.request_withdrawal(1000000000000000000)$$, 'forbidden', 'a banned member cannot request');
select throws_ok(format('select public.cancel_withdrawal(%L)', current_setting('t.r5')), 'forbidden', 'a banned member cannot cancel');
select tests.clear_authentication();

select * from finish();
rollback;
