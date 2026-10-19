-- F4c Task 3: approval at market NAV (fixed USDC amount becomes a liability, its shares leave S_eff), rejection,
-- 14-day expiry, the treasurer list and the withdrawal push copy.
begin;
select plan(107);

-- ===== helpers (rolled back with the test) =====
create function tests.xh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.xsafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
-- a pending_finality donation of p_amount on the active chain by p_user, paid in tx p_n at block p_block
create function tests.xpend(p_user uuid, p_amount numeric, p_n int, p_block bigint)
returns uuid language plpgsql as $$
declare
  v jsonb;
  v_id uuid;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_donation_intent(p_amount, 0, true);
  perform public.attach_intent_tx((v ->> 'id')::uuid, 'main', tests.xh(p_n));
  perform tests.clear_authentication();
  set local role service_role;
  v_id := public.record_donation((v ->> 'id')::uuid,
    jsonb_build_object('txHash', tests.xh(p_n), 'logIndex', 0, 'blockNumber', p_block), null);
  reset role;
  return v_id;
end;
$$;
create function tests.xcr(p_ledger uuid, p_assets numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.credit_donation(p_ledger, p_assets, p_block);
  reset role;
  return v;
end;
$$;
create function tests.xq(p_req uuid, p_assets numeric, p_block bigint, p_safe text default null) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.quote_withdrawal(p_req, coalesce(p_safe, tests.xsafe()), p_assets, p_block);
  reset role;
  return v;
end;
$$;
create function tests.xa(p_req uuid, p_actor uuid, p_assets numeric, p_block bigint, p_safe text default null) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.approve_withdrawal(p_req, p_actor, coalesce(p_safe, tests.xsafe()), p_assets, p_block);
  reset role;
  return v;
end;
$$;
create function tests.xexp() returns int language plpgsql as $$
declare v int;
begin
  set local role service_role;
  v := public.expire_withdrawal_approvals(59141, now() + interval '100 days'); -- R5: scan far ahead
  reset role;
  return v;
end;
$$;
create function tests.xliab(p_block bigint) returns numeric language plpgsql as $$
declare v numeric;
begin
  set local role service_role;
  v := public._dao_liabilities_usd6(59141, p_block);
  reset role;
  return v;
end;
$$;
create function tests.xsupply() returns numeric language plpgsql as $$
declare v numeric;
begin
  set local role service_role;
  v := public._dao_supply(59141);
  reset role;
  return v;
end;
$$;
create function tests.xsnap(p_usdc numeric, p_block bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_nav_snapshot(59141, tests.xsafe(), jsonb_build_object(
    'usdcUnits', p_usdc::text, 'ethWei', '0', 'wethWei', '0', 'ethPriceE8', '200000000000',
    'priceSource', 'chainlink', 'blockNumber', p_block::text, 'assetsUsd6', p_usdc::text));
  reset role;
  return v;
end;
$$;
create function tests.xov(p_user uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(p_user);
  v := public.dao_overview();
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.xreq(p_user uuid, p_shares numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.authenticate_as(p_user);
  v := public.request_withdrawal(p_shares);
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.xstate() returns text language sql as $$
  select total_shares::text || ':' || approved_locked_shares::text || ':' || value_usdc::text
  from public.dao_state where chain_id = 59141
$$;
create function tests.xpush(p_id bigint) returns text language sql as $$
  select title || '|' || body || '|' || url from public._push_build(p_id)
$$;
create function tests.xnote(p_member text, p_kind text) returns bigint language sql as $$
  select n.id from public.notifications n
  where n.recipient_id = current_setting('t.' || p_member)::uuid and n.kind = p_kind order by n.id desc limit 1
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9520', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9521', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9522', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T952 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T952 tesorero';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.ut', (select auth_user_id::text from public.members where id = current_setting('t.t')::uuid), true);

update public.chain_config set safe_address = '0x' || lpad('5afe95201', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';
-- whatever the local database holds is not part of these scenarios
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
update public.withdrawal_requests set status = 'cancelled', cancelled_at = now() - interval '60 days', amount_usdc_locked = null
  where status in ('pending', 'approved') and payout_tx_hash is null;
delete from public.dao_nav_snapshots where chain_id = 59141;
delete from public.dao_positions where chain_id = 59141;
-- F4c-R7 (a): the scan has covered every block these scenarios read the Safe at (956 tests the cursor guard)
insert into public.dao_scan_state (chain_id, last_block) values (59141, 1000000000)
  on conflict (chain_id) do update set last_block = excluded.last_block;
-- A 8 * 10^18, T 2 * 10^18: S = 10 * 10^18 valued at 20 USDC (price 2 USDC)
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 20000000,
                            approved_locked_shares = 0, nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.a')::uuid, 8000000000000000000, 8000000),
  (59141, current_setting('t.t')::uuid, 2000000000000000000, 2000000);

-- ===== 1. grants =====
select ok(has_function_privilege('service_role', 'public.quote_withdrawal(uuid,text,numeric,bigint)', 'execute')
      and not has_function_privilege('authenticated', 'public.quote_withdrawal(uuid,text,numeric,bigint)', 'execute')
      and not has_function_privilege('anon', 'public.quote_withdrawal(uuid,text,numeric,bigint)', 'execute'),
  'quote_withdrawal is service-only');
select ok(has_function_privilege('service_role', 'public.approve_withdrawal(uuid,uuid,text,numeric,bigint)', 'execute')
      and not has_function_privilege('authenticated', 'public.approve_withdrawal(uuid,uuid,text,numeric,bigint)', 'execute')
      and not has_function_privilege('anon', 'public.approve_withdrawal(uuid,uuid,text,numeric,bigint)', 'execute'),
  'approve_withdrawal is service-only');
select ok(has_function_privilege('service_role', 'public.expire_withdrawal_approvals(int,timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'public.expire_withdrawal_approvals(int,timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.expire_withdrawal_approvals(int,timestamptz)', 'execute'),
  'expire_withdrawal_approvals is service-only');
select ok(has_function_privilege('authenticated', 'public.reject_withdrawal(uuid,text)', 'execute')
      and not has_function_privilege('anon', 'public.reject_withdrawal(uuid,text)', 'execute'),
  'reject_withdrawal: members yes, anon no');
select ok(has_function_privilege('authenticated', 'public.treasury_withdrawals()', 'execute')
      and not has_function_privilege('anon', 'public.treasury_withdrawals()', 'execute'),
  'treasury_withdrawals: members yes, anon no');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.quote_withdrawal(uuid,text,numeric,bigint)'::regprocedure,
                         'public.approve_withdrawal(uuid,uuid,text,numeric,bigint)'::regprocedure,
                         'public.expire_withdrawal_approvals(int,timestamptz)'::regprocedure,
                         'public.reject_withdrawal(uuid,text)'::regprocedure,
                         'public.treasury_withdrawals()'::regprocedure)),
  'the new functions are definer with an empty search_path');

-- ===== 2. formula =====
select set_config('t.ov0', tests.xov(current_setting('t.ut')::uuid)::text, true);
select is(current_setting('t.ov0')::jsonb ->> 'sharePriceUsd6', '2000000', 'price before any request: 20 / 10');
select set_config('t.ra', tests.xreq(current_setting('t.ua')::uuid, 4000000000000000000)::text, true);
select is(tests.xq(current_setting('t.ra')::uuid, 20000000, 100),
  jsonb_build_object('amountUsdc', '8000000', 'navUsd6', '20000000', 'supplyShares', '10000000000000000000', 'reservedUsdc', '0'),
  'quote: floor(4 * 20 / 10) = 8 USDC');
select is((select status from public.withdrawal_requests where id = current_setting('t.ra')::uuid), 'pending', 'the quote changes no status');
select is(tests.xstate(), '10000000000000000000:0:20000000', 'the quote changes no state');
select set_config('t.ov1', tests.xov(current_setting('t.ut')::uuid)::text, true);
select is(tests.xa(current_setting('t.ra')::uuid, current_setting('t.t')::uuid, 20000000, 100),
  jsonb_build_object('amountUsdc', '8000000', 'selfApproved', false), 'approval fixes 8 USDC');
select is((select status || ':' || amount_usdc_locked || ':' || destination_address || ':' || approved_by || ':'
                  || self_approved || ':' || approval_count || ':' || (approved_at = now())
           from public.withdrawal_requests where id = current_setting('t.ra')::uuid),
  'approved:8000000:0x' || lpad('f9520', 40, '0') || ':' || current_setting('t.t') || ':false:1:true',
  'the request is approved with amount, destination = A''s wallet, approver, count and time');
select is((select approved_locked_shares from public.dao_state where chain_id = 59141), 4000000000000000000::numeric,
  'approved_locked_shares = 4 * 10^18');
select is((select locked_shares from public.dao_positions where chain_id = 59141 and member_id = current_setting('t.a')::uuid),
  4000000000000000000::numeric, 'A''s locked shares are kept');
select is((select count(*)::int from public.notifications where recipient_id = current_setting('t.a')::uuid
             and kind = 'withdrawal_approved'
             and data = jsonb_build_object('requestId', current_setting('t.ra'), 'amount', '8000000')), 1,
  'A gets one withdrawal_approved {requestId, amount}');
select is((select payload from public.audit_log where action = 'withdrawal_approved'
             and payload ->> 'request' = current_setting('t.ra')),
  jsonb_build_object('request', current_setting('t.ra'), 'amount', '8000000', 'selfApproved', false,
                     'navUsd6', '20000000', 'supplyShares', '10000000000000000000', 'assetsBlock', 100),
  'audit withdrawal_approved with the formula inputs');
select is((select actor_member_id from public.audit_log where action = 'withdrawal_approved'
             and payload ->> 'request' = current_setting('t.ra')), current_setting('t.t')::uuid, 'the audit actor is the treasurer');

-- ===== 3. price unchanged by the approval (cached path) =====
select is(tests.xliab(100), 8000000::numeric, 'liabilities at block 100 include the fixed 8 USDC');
select is(tests.xliab(null), 8000000::numeric, 'and on the read path');
select is(tests.xsupply(), 6000000000000000000::numeric, 'S_eff = 6 * 10^18');
select set_config('t.ov2', tests.xov(current_setting('t.ut')::uuid)::text, true);
select is(current_setting('t.ov2')::jsonb ->> 'navUsd6', '12000000', 'the cached NAV drops by the fixed amount at approval');
select is(current_setting('t.ov2')::jsonb ->> 'sharePriceUsd6', current_setting('t.ov1')::jsonb ->> 'sharePriceUsd6',
  'dao_overview sharePriceUsd6 right after approval == right before (2 USDC)');
select is(current_setting('t.ov2')::jsonb ->> 'myValueUsd6', current_setting('t.ov1')::jsonb ->> 'myValueUsd6',
  'another holder''s value is unchanged by the approval');
select is(current_setting('t.ov2')::jsonb ->> 'myValueUsd6', '4000000', 'T still holds 4 USD');

-- ===== 4. donation while the withdrawal is approved and unpaid =====
select set_config('t.l1', tests.xpend(current_setting('t.ub')::uuid, 2000000, 95201, 101)::text, true);
select is(tests.xcr(current_setting('t.l1')::uuid, 22000000, 101) ->> 'shares', '1000000000000000000',
  'a 2 USDC donation mints floor(2 * 6 / 12) = 10^18 shares');
select is(tests.xstate(), '11000000000000000000:4000000000000000000:14000000', 'total 11, approved 4, NAV 14');
select is(tests.xov(current_setting('t.ut')::uuid) ->> 'sharePriceUsd6', '2000000', 'the share price is still 2 USDC');

-- ===== 5. snapshot =====
select is(tests.xsnap(22000000, 102) ->> 'navUsd6', '14000000', 'the snapshot NAV is assets 22 minus the 8 reserved');
select is((select total_shares::text || ':' || liabilities_usd6::text from public.dao_nav_snapshots where chain_id = 59141
           order by taken_at desc limit 1), '7000000000000000000:8000000',
  'the snapshot stores total_shares = S_eff and the reserved 8 USDC as liability');

-- ===== 6. self-approval =====
select set_config('t.rt', tests.xreq(current_setting('t.ut')::uuid, 1000000000000000000)::text, true);
select is(tests.xa(current_setting('t.rt')::uuid, current_setting('t.t')::uuid, 22000000, 102),
  jsonb_build_object('amountUsdc', '2000000', 'selfApproved', true), 'the treasurer approves their own request: 2 USDC, selfApproved');
select is((select payload -> 'selfApproved' from public.audit_log where action = 'withdrawal_approved'
             and payload ->> 'request' = current_setting('t.rt')), 'true'::jsonb, 'the audit payload says selfApproved');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is((select self_approved from public.treasury_withdrawals() where id = current_setting('t.rt')::uuid), true,
  'treasury_withdrawals shows self_approved');
select tests.clear_authentication();
select is(tests.xstate(), '11000000000000000000:5000000000000000000:12000000', 'approved 5, NAV 12');
select is(tests.xov(current_setting('t.ua')::uuid) ->> 'sharePriceUsd6', '2000000', 'still 2 USDC per participación');

-- ===== 7. guards =====
-- B holds 10^18; asks for half of it (1 USD at the cached 12 / 6)
select set_config('t.rb', tests.xreq(current_setting('t.ub')::uuid, 500000000000000000)::text, true);
update public.chain_config set withdrawals_enabled = false where chain_id = 59141;
select throws_ok(format('select tests.xa(%L, %L, 22000000, 102)', current_setting('t.rb'), current_setting('t.t')),
  'withdrawals_disabled', 'approve with the switch off raises withdrawals_disabled');
select throws_ok(format('select tests.xq(%L, 22000000, 102)', current_setting('t.rb')),
  'withdrawals_disabled', 'quote with the switch off raises withdrawals_disabled');
update public.chain_config set withdrawals_enabled = true where chain_id = 59141;
select throws_ok(format('select tests.xa(%L, %L, 22000000, 102)', current_setting('t.rb'), current_setting('t.a')),
  'forbidden', 'a non-256 actor raises forbidden');
select throws_ok(format('select tests.xa(%L, null, 22000000, 102)', current_setting('t.rb')),
  'forbidden', 'a null actor raises forbidden');
select throws_ok(format('select tests.xa(%L, %L, 22000000, 102, %L)', current_setting('t.rb'), current_setting('t.t'),
                        '0x' || lpad('5afe95299', 40, '0')),
  'safe_changed', 'a different Safe raises safe_changed');
select throws_ok(format('select tests.xq(%L, 22000000, 102, %L)', current_setting('t.rb'), '0x' || lpad('5afe95299', 40, '0')),
  'safe_changed', 'quote with a different Safe raises safe_changed');
select throws_ok(format('select tests.xa(%L, %L, 22000000, 100)', current_setting('t.rb'), current_setting('t.t')),
  'assets_stale', 'an assets block older than a credited donation raises assets_stale');
select throws_ok(format('select tests.xq(%L, 22000000, 100)', current_setting('t.rb')),
  'assets_stale', 'quote: assets_stale');
update public.dao_state set nav_initialized = false where chain_id = 59141;
select throws_ok(format('select tests.xa(%L, %L, 22000000, 102)', current_setting('t.rb'), current_setting('t.t')),
  'nav_not_ready', 'a chain without valuation raises nav_not_ready');
select throws_ok(format('select tests.xq(%L, 22000000, 102)', current_setting('t.rb')), 'nav_not_ready', 'quote: nav_not_ready');
update public.dao_state set nav_initialized = true where chain_id = 59141;
select throws_ok(format('select tests.xa(%L, %L, 22000000, 102)', current_setting('t.ra'), current_setting('t.t')),
  'invalid_state', 'approving an approved request raises invalid_state');
select throws_ok(format('select tests.xq(%L, 22000000, 102)', current_setting('t.ra')), 'invalid_state', 'quote: invalid_state');
select throws_ok(format('select tests.xa(%L, %L, 22000000, 102)', gen_random_uuid(), current_setting('t.t')),
  'not_found', 'an unknown request raises not_found');
select throws_ok(format('select tests.xa(%L, %L, -1, 102)', current_setting('t.rb'), current_setting('t.t')),
  'invalid_input', 'negative assets are invalid');
select throws_ok(format('select tests.xa(%L, %L, 22000000, null)', current_setting('t.rb'), current_setting('t.t')),
  'invalid_input', 'a null block is invalid');
-- assets 15: NAV 15 - 10 reserved = 5, half a share of 6 is worth 0.41 USDC
select throws_ok(format('select tests.xa(%L, %L, 15000000, 102)', current_setting('t.rb'), current_setting('t.t')),
  'amount_too_small', 'a partial request worth < 1 USDC raises amount_too_small');
select throws_ok(format('select tests.xq(%L, 15000000, 102)', current_setting('t.rb')), 'amount_too_small', 'quote: amount_too_small');
select throws_ok(format('select tests.xa(%L, %L, 10000000, 102)', current_setting('t.rb'), current_setting('t.t')),
  'amount_too_small', 'a zero amount raises amount_too_small');
select is((select status from public.withdrawal_requests where id = current_setting('t.rb')::uuid), 'pending', 'B''s request is still pending');
select is(tests.xstate(), '11000000000000000000:5000000000000000000:12000000', 'failed approvals change nothing');
select is(tests.xq(current_setting('t.rb')::uuid, 22000000, 102),
  jsonb_build_object('amountUsdc', '1000000', 'navUsd6', '12000000', 'supplyShares', '6000000000000000000', 'reservedUsdc', '10000000'),
  'quote reports the reserved 10 USDC (8 + 2)');
select is(tests.xa(current_setting('t.rb')::uuid, current_setting('t.t')::uuid, 22000000, 102) ->> 'amountUsdc', '1000000',
  'B''s half share is approved at exactly 1 USDC');
select is(tests.xstate(), '11000000000000000000:5500000000000000000:11000000', 'approved 5.5, NAV 11');

-- ===== 8. reject =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.ra'), 'no'),
  'forbidden', 'a non-treasurer cannot reject');
select throws_ok($$select public.treasury_withdrawals()$$, 'forbidden', 'a non-treasurer cannot list');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.ra'), ''),
  'reason_required', 'an empty reason raises reason_required');
select throws_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.ra'), '   '),
  'reason_required', 'a blank reason raises reason_required');
select throws_ok(format('select public.reject_withdrawal(%L, null)', current_setting('t.ra')),
  'reason_required', 'a null reason raises reason_required');
select throws_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.ra'), repeat('x', 281)),
  'reason_required', 'a 281-character reason raises reason_required');
select throws_ok(format('select public.reject_withdrawal(%L, %L)', gen_random_uuid(), 'motivo'),
  'not_found', 'rejecting an unknown request raises not_found');
select lives_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.ra'), E'  Sin liquidez\nahora  '),
  'the treasurer rejects A''s approved request');
select throws_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.ra'), 'otra vez'),
  'invalid_state', 'a rejected request cannot be rejected again');
select tests.clear_authentication();
select is((select status || ':' || reject_reason || ':' || rejected_by || ':' || (rejected_at is not null)
                  || ':' || (amount_usdc_locked is null)
           from public.withdrawal_requests where id = current_setting('t.ra')::uuid),
  E'rejected:Sin liquidez\nahora:' || current_setting('t.t') || ':true:true',
  'the request is rejected with the trimmed reason, by and at, and no fixed amount');
select is((select locked_shares from public.dao_positions where chain_id = 59141 and member_id = current_setting('t.a')::uuid),
  0::numeric, 'A''s locked shares are released');
select is(tests.xstate(), '11000000000000000000:1500000000000000000:19000000',
  'approved_locked_shares drops by 4 and the 8 USDC liability returns to the NAV');
select is(tests.xliab(null), 3000000::numeric, 'the rejected amount is no longer a liability');
select is(tests.xov(current_setting('t.ub')::uuid) ->> 'sharePriceUsd6', '2000000', 'the price is unchanged by the rejection');
select is((select count(*)::int from public.notifications where recipient_id = current_setting('t.a')::uuid
             and kind = 'withdrawal_rejected'
             and data = jsonb_build_object('requestId', current_setting('t.ra'), 'reason', E'Sin liquidez\nahora')), 1,
  'A gets withdrawal_rejected {requestId, reason}');
select is((select payload ->> 'request' from public.audit_log where action = 'withdrawal_rejected'
             and payload ->> 'request' = current_setting('t.ra')), current_setting('t.ra'), 'the rejection is audited');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is((select status || ':' || reject_reason from public.treasury_withdrawals() where id = current_setting('t.ra')::uuid),
  E'rejected:Sin liquidez\nahora', 'the list shows the rejected request with its reason');
select tests.clear_authentication();

-- rejecting a pending request (never approved) only releases the member's lock
select set_config('t.ra2', tests.xreq(current_setting('t.ua')::uuid, 4000000000000000000)::text, true);
select tests.authenticate_as(current_setting('t.ut')::uuid);
select lives_ok(format('select public.reject_withdrawal(%L, %L)', current_setting('t.ra2'), 'Duplicada'), 'a pending request can be rejected');
select tests.clear_authentication();
select is(tests.xstate(), '11000000000000000000:1500000000000000000:19000000', 'rejecting a pending request leaves the supply and NAV');
select is((select locked_shares from public.dao_positions where chain_id = 59141 and member_id = current_setting('t.a')::uuid),
  0::numeric, 'and releases the lock');

-- ===== treasurer list =====
select set_config('t.lb', public._member_label(current_setting('t.b')::uuid), true);
select set_config('t.lt', public._member_label(current_setting('t.t')::uuid), true);
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is((select member_label || '|' || wallet || '|' || shares || '|' || position_shares || '|' || status || '|'
                  || approved_by_label || '|' || amount_usdc || '|' || estimate_usd6 || '|'
                  || (expires_at = approved_at + interval '14 days')
           from public.treasury_withdrawals() where id = current_setting('t.rb')::uuid),
  current_setting('t.lb') || '|0x' || lpad('f9521', 40, '0') || '|500000000000000000|1000000000000000000|approved|'
    || current_setting('t.lt') || '|1000000|1000000|true',
  'treasury_withdrawals: label, wallet, shares, position, approver, amount, estimate = shares * NAV / S_eff, expiry');
select tests.clear_authentication();
insert into public.withdrawal_requests (chain_id, member_id, shares, status, cancelled_at, created_at)
  values (59141, current_setting('t.b')::uuid, 1, 'cancelled', now() - interval '31 days', now() - interval '32 days');
select set_config('t.rold', (select id::text from public.withdrawal_requests where member_id = current_setting('t.b')::uuid
                              and cancelled_at < now() - interval '30 days' limit 1), true);
insert into public.withdrawal_requests (chain_id, member_id, shares, status, cancelled_at)
  values (59144, current_setting('t.b')::uuid, 1, 'pending', null);
select set_config('t.r44', (select id::text from public.withdrawal_requests where chain_id = 59144
                             and member_id = current_setting('t.b')::uuid), true);
select tests.authenticate_as(current_setting('t.ut')::uuid);
select ok(not exists (select 1 from public.treasury_withdrawals() where id = current_setting('t.rold')::uuid),
  'a request closed over 30 days ago is not listed');
select ok(not exists (select 1 from public.treasury_withdrawals() where id = current_setting('t.r44')::uuid),
  'only the active chain is listed');
select ok(exists (select 1 from public.treasury_withdrawals() where id = current_setting('t.ra2')::uuid),
  'a request closed today is listed');
select tests.clear_authentication();

-- ===== 9. expiry =====
update public.withdrawal_requests set approved_at = now() - interval '15 days' where id = current_setting('t.rt')::uuid;
update public.withdrawal_requests set approved_at = now() - interval '13 days' where id = current_setting('t.rb')::uuid;
select is(tests.xexp(), 1, 'one approval older than 14 days expires');
select is((select status || ':' || (last_expired_at is not null) || ':' || (amount_usdc_locked is null) || ':'
                  || (approved_by is null) || ':' || (approved_at is null) || ':' || self_approved || ':' || approval_count
           from public.withdrawal_requests where id = current_setting('t.rt')::uuid),
  'pending:true:true:true:true:false:1', 'the expired request is pending again with its approval cleared');
select is((select locked_shares from public.dao_positions where chain_id = 59141 and member_id = current_setting('t.t')::uuid),
  1000000000000000000::numeric, 'its shares stay locked');
select is(tests.xstate(), '11000000000000000000:500000000000000000:21000000',
  'approved_locked_shares drops by 1 and the 2 USDC return to the NAV');
select is(tests.xliab(null), 1000000::numeric, 'the expired amount is no longer a liability');
select is(tests.xov(current_setting('t.ub')::uuid) ->> 'sharePriceUsd6', '2000000', 'the price is unchanged by the expiry');
select is((select status from public.withdrawal_requests where id = current_setting('t.rb')::uuid), 'approved',
  'a 13-day approval is untouched');
select is((select count(*)::int from public.notifications where recipient_id = current_setting('t.t')::uuid
             and kind = 'withdrawal_expired' and data = jsonb_build_object('requestId', current_setting('t.rt'))), 1,
  'the member gets withdrawal_expired {requestId}');
select is((select count(*)::int from public.notifications where kind = 'treasury_notice'
             and data = jsonb_build_object('event', 'approval_expired', 'requestId', current_setting('t.rt'))),
  (select count(*)::int from public.members m where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0),
  'every active treasurer gets treasury_notice {approval_expired}');
select ok(not exists (select 1 from public.notifications where kind = 'treasury_notice' and recipient_id = current_setting('t.b')::uuid),
  'a plain member gets no treasury_notice');
select is(tests.xexp(), 0, 'a second run expires nothing');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select ok((select last_expired_at is not null and amount_usdc is null from public.treasury_withdrawals()
           where id = current_setting('t.rt')::uuid), 'the list shows the expiry');
select tests.clear_authentication();
-- re-approval after expiry counts again
select is(tests.xa(current_setting('t.rt')::uuid, current_setting('t.t')::uuid, 22000000, 102) ->> 'amountUsdc', '2000000',
  'an expired request can be approved again at the current NAV');
select is((select approval_count from public.withdrawal_requests where id = current_setting('t.rt')::uuid), 2, 'approval_count = 2');

-- ===== 10. push =====
select is(tests.xpush(tests.xnote('a', 'withdrawal_approved')),
  'Retirada aprobada|Tu retirada de 8 USDC está aprobada. El tesorero la pagará desde la Safe.|/dao#retirada',
  'push withdrawal_approved');
select is(tests.xpush((select n.id from public.notifications n where n.kind = 'withdrawal_rejected'
                         and n.data ->> 'requestId' = current_setting('t.ra'))),
  'Retirada rechazada|El tesorero rechazó tu retirada: «Sin liquidez ahora»|/dao#retirada',
  'push withdrawal_rejected (control characters stripped)');
insert into public.notifications (recipient_id, kind, data) values
  (current_setting('t.a')::uuid, 'withdrawal_rejected', jsonb_build_object('requestId', gen_random_uuid(), 'reason', repeat('a', 100)));
select is(tests.xpush(tests.xnote('a', 'withdrawal_rejected')),
  'Retirada rechazada|El tesorero rechazó tu retirada: «' || repeat('a', 80) || '»|/dao#retirada',
  'push withdrawal_rejected caps the reason at 80 characters');
insert into public.notifications (recipient_id, kind, data) values
  (current_setting('t.a')::uuid, 'withdrawal_paid', jsonb_build_object('requestId', gen_random_uuid(), 'amount', '2500000'));
select is(tests.xpush(tests.xnote('a', 'withdrawal_paid')),
  'Retirada pagada|Has recibido 2,5 USDC de la tesorería.|/dao#retirada', 'push withdrawal_paid');
select is(tests.xpush(tests.xnote('t', 'withdrawal_expired')),
  'Aprobación caducada|Tu retirada no se pagó en 14 días y vuelve a estar pendiente de aprobación.|/dao#retirada',
  'push withdrawal_expired');
select is(tests.xpush((select n.id from public.notifications n where n.recipient_id = current_setting('t.t')::uuid
                         and n.kind = 'treasury_notice' and n.data ->> 'event' = 'withdrawal_requested' order by n.id desc limit 1)),
  'Aviso de tesorería|Hay una nueva solicitud de retirada.|/dao/tesoreria', 'push treasury_notice withdrawal_requested');
select is(tests.xpush((select n.id from public.notifications n where n.recipient_id = current_setting('t.t')::uuid
                         and n.kind = 'treasury_notice' and n.data ->> 'event' = 'approval_expired' order by n.id desc limit 1)),
  'Aviso de tesorería|Una retirada aprobada caducó sin pagarse.|/dao/tesoreria', 'push treasury_notice approval_expired');
insert into public.notifications (recipient_id, kind, data) values
  (current_setting('t.t')::uuid, 'treasury_notice', jsonb_build_object('event', 'zzz', 'requestId', gen_random_uuid()));
select is((select count(*)::int from public._push_build(tests.xnote('t', 'treasury_notice'))), 0,
  'treasury_notice with an unknown event builds nothing');
insert into public.notifications (recipient_id, kind, data) values
  (current_setting('t.b')::uuid, 'treasury_notice', jsonb_build_object('event', 'withdrawal_requested', 'requestId', gen_random_uuid()));
select is((select count(*)::int from public._push_build(tests.xnote('b', 'treasury_notice'))), 0,
  'treasury_notice builds nothing for a recipient without 256');
insert into public.notifications (recipient_id, kind, data) values
  (current_setting('t.a')::uuid, 'withdrawal_approved', jsonb_build_object('requestId', gen_random_uuid(), 'amount', '8.5'));
select is((select count(*)::int from public._push_build(tests.xnote('a', 'withdrawal_approved'))), 0,
  'a malformed amount builds nothing');
insert into public.notifications (recipient_id, kind, data) values
  (current_setting('t.a')::uuid, 'withdrawal_paid', jsonb_build_object('requestId', gen_random_uuid()));
select is((select count(*)::int from public._push_build(tests.xnote('a', 'withdrawal_paid'))), 0,
  'a missing amount builds nothing');
insert into public.notifications (recipient_id, kind, data) values
  (current_setting('t.t')::uuid, 'treasury_outflow', jsonb_build_object('opId', gen_random_uuid(), 'asset', 'USDC', 'amount', '1000000'));
select is((select url from public._push_build(tests.xnote('t', 'treasury_outflow'))), '/dao/tesoreria',
  'treasury_outflow now opens /dao/tesoreria (R1)');

select * from finish();
rollback;
