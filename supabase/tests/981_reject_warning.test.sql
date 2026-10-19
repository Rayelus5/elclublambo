-- F4 polish item 8 (migration 20261019600002): treasury_withdrawals.unexplained_outflow flags an approved, unpaid
-- request when the Safe sent USDC to its destination after the approval (120 s tolerance) and that outflow is still
-- unexplained (the treasury_unexplained_outflows rule). The reject dialog then warns: it may be a payout the forum
-- could not link (a split or short payment).
-- Setup: 59141 valued at 200 USDC; W has an approved 20 USDC withdrawal, V a pending one.
begin;
select plan(9);

create function tests.rh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.rsafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
create function tests.rw(p_member text) returns text language sql stable as $$
  select lower(m.wallet_address) from public.members m where m.id = current_setting('t.' || p_member)::uuid
$$;
create function tests.ruser(p_member text) returns uuid language sql stable as $$
  select auth_user_id from public.members where id = current_setting('t.' || p_member)::uuid
$$;
create function tests.rout(p_n int, p_amount numeric, p_to text, p_at timestamptz) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.record_safe_operations(59141, tests.rsafe(), jsonb_build_array(jsonb_build_object(
    'txHash', tests.rh(p_n), 'logIndex', 0, 'asset', 'USDC', 'direction', 'out', 'amount', p_amount::text,
    'counterparty', p_to, 'blockNumber', p_n, 'occurredAt', p_at)), p_n);
  reset role;
end;
$$;
create function tests.rflag(p_request text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform tests.authenticate_as(tests.ruser('t'));
  select x.unexplained_outflow into v from public.treasury_withdrawals() x where x.id = current_setting('t.' || p_request)::uuid;
  perform tests.clear_authentication();
  return v;
end;
$$;

select set_config('t.a', tests.create_member('0x' || lpad('f9810', 40, '0'), null, true)::text, true);
select set_config('t.w', tests.create_member('0x' || lpad('f9811', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.v', tests.create_member('0x' || lpad('f9812', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9813', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T981 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T981 tesorero';

update public.chain_config set safe_address = '0x' || lpad('5afe98101', 40, '0'), platform_wallet = null,
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
  (59141, current_setting('t.a')::uuid, 8000000000000000000, 160000000),
  (59141, current_setting('t.w')::uuid, 1000000000000000000, 20000000),
  (59141, current_setting('t.v')::uuid, 1000000000000000000, 20000000);
insert into public.dao_scan_state (chain_id, last_block) values (59141, 10);

select tests.authenticate_as(tests.ruser('w'));
select set_config('t.wr', public.request_withdrawal(1000000000000000000)::text, true);
select tests.clear_authentication();
select tests.authenticate_as(tests.ruser('v'));
select set_config('t.vr', public.request_withdrawal(1000000000000000000)::text, true);
select tests.clear_authentication();
set local role service_role;
select public.approve_withdrawal(current_setting('t.wr')::uuid, current_setting('t.t')::uuid, tests.rsafe(), 200000000, 10);
reset role;

select is(tests.rflag('wr'), false, 'an approved request with no outflow to its destination: no warning');
select is(tests.rflag('vr'), false, 'a pending request: no warning');

-- noise that must not trigger it: before the approval, to another wallet
select tests.rout(11, 5000000, tests.rw('w'), now() - interval '1 hour');
select tests.rout(12, 5000000, tests.rw('v'), now() + interval '1 minute');
select is(tests.rflag('wr'), false, 'an outflow to W before the approval, or to another wallet, does not count');

-- a short (split) payment to W after the approval: not linked (it does not cover the amount), unexplained
select tests.rout(13, 10000000, tests.rw('w'), now() + interval '1 minute');
select is((select withdrawal_id from public.dao_safe_operations where tx_hash = tests.rh(13)), null::uuid,
  'the 10 USDC outflow is not linked (it does not cover the 20 USDC)');
select is(tests.rflag('wr'), true, 'an unexplained USDC outflow to W after the approval raises the warning');

-- a note explains it: no warning any more
update public.dao_safe_operations set note = 'Parte del pago' where tx_hash = tests.rh(13);
select is(tests.rflag('wr'), false, 'once the outflow has a note it is explained: no warning');

-- within the 120 s tolerance before the approval it still counts
select tests.rout(14, 3000000, tests.rw('w'), (select approved_at from public.withdrawal_requests where id = current_setting('t.wr')::uuid) - interval '60 seconds');
select is(tests.rflag('wr'), true, 'an outflow 60 s before the approval counts (the 120 s tolerance)');
update public.dao_safe_operations set note = 'Otra cosa' where tx_hash = tests.rh(14);

-- a full payment is linked as the candidate (payout_linked), so it is not unexplained
select tests.rout(15, 20000000, tests.rw('w'), now() + interval '2 minutes');
select is(tests.rflag('wr'), false, 'a linked payout candidate is explained: no warning');
select ok(has_function_privilege('authenticated', 'public.treasury_withdrawals()', 'execute')
          and not has_function_privilege('anon', 'public.treasury_withdrawals()', 'execute'),
  'treasury_withdrawals keeps its grants');

select * from finish();
rollback;
