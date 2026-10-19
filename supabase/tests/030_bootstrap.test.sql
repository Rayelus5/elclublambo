begin;
select plan(16);

select set_config('t.u1', tests.create_wallet_user('0xAbCd000000000000000000000000000000000001')::text, true);
select set_config('t.u2', tests.create_wallet_user('0x2000000000000000000000000000000000000002')::text, true);

-- privileges
select tests.authenticate_as(current_setting('t.u1')::uuid);
select throws_ok(
  format($q$select public.bootstrap_super_admin(%L::uuid, '0xabcd000000000000000000000000000000000001')$q$, current_setting('t.u1')),
  '42501', null, 'authenticated cannot execute');
select tests.clear_authentication();
select ok(not has_function_privilege('anon', 'public.bootstrap_super_admin(uuid,text)', 'execute'), 'anon has no execute');
select ok(has_function_privilege('service_role', 'public.bootstrap_super_admin(uuid,text)', 'execute'), 'service_role can execute');

set local role service_role;

-- wallet mismatch (before any admin exists)
select throws_ok(
  format($q$select public.bootstrap_super_admin(%L::uuid, '0x2000000000000000000000000000000000000009')$q$, current_setting('t.u1')),
  'P0001', 'wallet_mismatch', 'different wallet -> wallet_mismatch');
select throws_ok(
  $q$select public.bootstrap_super_admin(gen_random_uuid(), '0xabcd000000000000000000000000000000000001')$q$,
  'P0001', 'wallet_mismatch', 'unknown user/no identity -> wallet_mismatch');

-- success, with checksum casing and whitespace in the input
select set_config('t.m1',
  public.bootstrap_super_admin(current_setting('t.u1')::uuid, '  0xABCD000000000000000000000000000000000001 ')::text, true);
reset role;

select is((select wallet_address from public.members where id = current_setting('t.m1')::uuid),
  '0xabcd000000000000000000000000000000000001', 'member created with lowercase wallet');
select ok((select is_bootstrap and status = 'active' and invited_by_member_id is null and auth_user_id = current_setting('t.u1')::uuid
  from public.members where id = current_setting('t.m1')::uuid), 'member is active bootstrap with no inviter');
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where mr.member_id = current_setting('t.m1')::uuid and r.name = 'SuperAdmin' and r.is_system), 1, 'SuperAdmin role assigned');
select is(public.member_global_permissions(current_setting('t.m1')::uuid), 262143::bigint, 'full permissions');
select is((select count(*)::int from public.audit_log
  where action = 'bootstrap_super_admin' and actor_member_id = current_setting('t.m1')::uuid
    and target_type = 'member' and target_id = current_setting('t.m1')::uuid
    and payload = jsonb_build_object('wallet', '0xabcd000000000000000000000000000000000001')), 1, 'audit row written');

-- idempotent
set local role service_role;
select is(public.bootstrap_super_admin(current_setting('t.u1')::uuid, '0xabcd000000000000000000000000000000000001'),
  current_setting('t.m1')::uuid, 'second call returns same id');
select throws_ok(
  format($q$select public.bootstrap_super_admin(%L::uuid, '0x2000000000000000000000000000000000000002')$q$, current_setting('t.u2')),
  'P0001', 'bootstrap_closed', 'second user -> bootstrap_closed');
reset role;
select is((select count(*)::int from public.audit_log where action = 'bootstrap_super_admin'), 1, 'no extra audit rows');

-- a user who is already a non-bootstrap member can never bootstrap, even with no admin present
select set_config('t.m4', tests.create_member('0x2000000000000000000000000000000000000004', current_setting('t.m1')::uuid)::text, true);
delete from public.member_roles where member_id = current_setting('t.m1')::uuid;
set local role service_role;
select throws_ok(
  format($q$select public.bootstrap_super_admin((select auth_user_id from public.members where id = %L::uuid), '0x2000000000000000000000000000000000000004')$q$, current_setting('t.m4')),
  'P0001', 'bootstrap_closed', 'existing non-bootstrap member -> bootstrap_closed');
reset role;

-- R7: deleting/demoting the SuperAdmin never reopens bootstrap (bootstrap member still exists, no longer holds role)
select set_config('t.u5', tests.create_wallet_user('0x2000000000000000000000000000000000000005')::text, true);
set local role service_role;
select throws_ok(
  format($q$select public.bootstrap_super_admin(%L::uuid, '0x2000000000000000000000000000000000000005')$q$, current_setting('t.u5')),
  'P0001', 'bootstrap_closed', 'existing is_bootstrap member without role -> bootstrap_closed');
reset role;

-- R7: wallet already owned by a different auth user -> bootstrap_closed, not raw 23505
select set_config('t.m7', tests.create_member('0x20000000000000000000000000000000000000ab', current_setting('t.m1')::uuid)::text, true);
select set_config('t.u6', tests.create_wallet_user('0x20000000000000000000000000000000000000AB')::text, true);
update public.members set invited_by_member_id = id where id = current_setting('t.m7')::uuid;
delete from public.audit_log;
delete from public.members where is_bootstrap or id = current_setting('t.m4')::uuid;
set local role service_role;
select throws_ok(
  format($q$select public.bootstrap_super_admin(%L::uuid, '0x20000000000000000000000000000000000000ab')$q$, current_setting('t.u6')),
  'P0001', 'bootstrap_closed', 'wallet owned by another auth user -> bootstrap_closed');
reset role;

select * from finish();
rollback;
