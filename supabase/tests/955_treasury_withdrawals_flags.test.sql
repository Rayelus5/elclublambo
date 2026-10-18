-- F4c-R6: treasury_withdrawals() payout_linked, rejected_at, cancelled_at.
begin;
select plan(10);

select set_config('t.a', tests.create_member('0x' || lpad('f9550', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9551', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9552', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T955 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T955 tesorero';
select set_config('t.ut', (select auth_user_id::text from public.members where id = current_setting('t.t')::uuid), true);

update public.chain_config set safe_address = '0x' || lpad('5afe95501', 40, '0'), withdrawals_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
update public.withdrawal_requests set status = 'cancelled', cancelled_at = now() - interval '60 days', amount_usdc_locked = null,
       payout_tx_hash = null, payout_log_index = null, payout_block = null, payout_amount = null, payout_recorded_at = null
  where status in ('pending', 'approved');
delete from public.dao_safe_operations where chain_id = 59141;

-- two approved requests (inserted directly: this test is about the read) and two closed ones
insert into public.withdrawal_requests (id, chain_id, member_id, shares, status, amount_usdc_locked, approved_at, approved_by, destination_address)
  values ('00000000-0000-4000-8000-000000009551', 59141, current_setting('t.a')::uuid, 1, 'approved', 1000000, now() - interval '1 day',
          current_setting('t.t')::uuid, '0x' || lpad('f9550', 40, '0')),
         ('00000000-0000-4000-8000-000000009552', 59141, current_setting('t.b')::uuid, 1, 'approved', 1000000, now() - interval '1 day',
          current_setting('t.t')::uuid, '0x' || lpad('f9551', 40, '0'));
insert into public.withdrawal_requests (id, chain_id, member_id, shares, status, rejected_at, reject_reason)
  values ('00000000-0000-4000-8000-000000009553', 59141, current_setting('t.a')::uuid, 1, 'rejected', now() - interval '2 days', 'No');
insert into public.withdrawal_requests (id, chain_id, member_id, shares, status, cancelled_at)
  values ('00000000-0000-4000-8000-000000009554', 59141, current_setting('t.b')::uuid, 1, 'cancelled', now() - interval '3 days');

-- an outflow linked to request ...51 inside its window
insert into public.dao_safe_operations (chain_id, tx_hash, log_index, asset, direction, amount, counterparty, block_number, occurred_at, withdrawal_id)
  values (59141, '0x' || lpad('955', 64, '0'), 0, 'USDC', 'out', 1000000, '0x' || lpad('f9550', 40, '0'), 10, now() - interval '12 hours',
          '00000000-0000-4000-8000-000000009551');

select tests.authenticate_as(current_setting('t.ut')::uuid);
select is((select payout_linked from public.treasury_withdrawals() where id = '00000000-0000-4000-8000-000000009551'), true,
  'an approved request with a linked outflow in its window is payout_linked');
select is((select payout_linked from public.treasury_withdrawals() where id = '00000000-0000-4000-8000-000000009552'), false,
  'an approved request without one is not');
select is((select payout_linked from public.treasury_withdrawals() where id = '00000000-0000-4000-8000-000000009553'), false,
  'a closed request is not');
select is((select rejected_at is not null and cancelled_at is null from public.treasury_withdrawals() where id = '00000000-0000-4000-8000-000000009553'), true,
  'a rejected row carries rejected_at');
select is((select cancelled_at is not null and rejected_at is null from public.treasury_withdrawals() where id = '00000000-0000-4000-8000-000000009554'), true,
  'a cancelled row carries cancelled_at');
select tests.clear_authentication();

-- a linked outflow outside the window does not count
update public.dao_safe_operations set occurred_at = now() - interval '40 days' where tx_hash = '0x' || lpad('955', 64, '0');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is((select payout_linked from public.treasury_withdrawals() where id = '00000000-0000-4000-8000-000000009551'), false,
  'a link outside the payout window is not payout_linked');
select tests.clear_authentication();

-- once the payout is recorded it is no longer a candidate
update public.dao_safe_operations set occurred_at = now() - interval '12 hours' where tx_hash = '0x' || lpad('955', 64, '0');
update public.withdrawal_requests
  set payout_tx_hash = '0x' || lpad('955', 64, '0'), payout_log_index = 0, payout_block = 10, payout_amount = 1000000, payout_recorded_at = now()
  where id = '00000000-0000-4000-8000-000000009551';
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is((select payout_linked from public.treasury_withdrawals() where id = '00000000-0000-4000-8000-000000009551'), false,
  'once the payout is recorded it is not payout_linked');
select tests.clear_authentication();

-- treasury_unexplained_outflows: more than 100 old unexplained outflows are all there; a noted or payout-linked one is not
insert into public.dao_safe_operations (chain_id, tx_hash, log_index, asset, direction, amount, counterparty, block_number, occurred_at)
  select 59141, '0x' || lpad(to_hex(1000 + g), 64, '0'), 0, 'USDC', 'out', 5, null, 20 + g, now() - interval '20 days' - g * interval '1 minute'
  from generate_series(1, 120) g;
update public.dao_safe_operations set note = 'Swap' where tx_hash = '0x' || lpad(to_hex(1001), 64, '0');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is((select count(*)::int from public.treasury_unexplained_outflows()), 119,
  'all unexplained outflows come back (119 of 120: one is noted; the payout-explained one is out), past 100');
select tests.clear_authentication();
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.b')::uuid));
select throws_ok($$select public.treasury_unexplained_outflows()$$, 'forbidden', 'a non-treasurer cannot read it');
select tests.clear_authentication();

select ok(has_function_privilege('authenticated', 'public.treasury_withdrawals()', 'execute')
      and not has_function_privilege('anon', 'public.treasury_withdrawals()', 'execute'),
  'grants are unchanged: members yes, anon no');

select * from finish();
rollback;
