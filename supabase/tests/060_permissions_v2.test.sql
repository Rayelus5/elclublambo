begin;
select plan(31);

-- seed roles (exact)
select results_eq(
  $$select name, position, permissions, is_everyone, is_system, color from public.roles order by position$$,
  $$values ('@everyone'::text, 0, 8199::bigint, true, false, '#A3A3A3'::text),
           ('Padrino', 10, 16::bigint, false, false, '#61DFFF'),
           ('Verificado', 20, 3072::bigint, false, false, '#3DDC84'),
           ('Soporte', 100, 19456::bigint, false, false, '#FFB020'),
           ('Moderador', 500, 56360::bigint, false, false, '#FF5A5A'),
           ('SuperAdmin', 1000, 512::bigint, false, true, '#EDEDED')$$,
  'seed roles exact');
select is((select permissions from public.roles where is_everyone), 8199::bigint, '@everyone = 8199');

-- privileges
select ok(not has_function_privilege('anon', 'public.set_verified(uuid,boolean)', 'execute'), 'anon cannot set_verified');
select ok(has_function_privilege('authenticated', 'public.set_verified(uuid,boolean)', 'execute'), 'authenticated can set_verified');

-- fixtures
select set_config('t.admin', tests.create_member('0xe000000000000000000000000000000000000001', null, true)::text, true);
select set_config('t.mod', tests.create_member('0xe000000000000000000000000000000000000002', current_setting('t.admin')::uuid)::text, true);
select set_config('t.mod2', tests.create_member('0xe000000000000000000000000000000000000003', current_setting('t.admin')::uuid)::text, true);
select set_config('t.plain', tests.create_member('0xe000000000000000000000000000000000000004', current_setting('t.admin')::uuid)::text, true);
select set_config('t.plain2', tests.create_member('0xe000000000000000000000000000000000000005', current_setting('t.admin')::uuid)::text, true);
select set_config('t.banned', tests.create_member('0xe000000000000000000000000000000000000006', current_setting('t.admin')::uuid)::text, true);
select set_config('t.pen', tests.create_member('0xe000000000000000000000000000000000000007', current_setting('t.admin')::uuid)::text, true);

insert into public.member_roles (member_id, role_id)
select current_setting('t.admin')::uuid, id from public.roles where name = 'SuperAdmin'
union all select current_setting('t.mod')::uuid, id from public.roles where name = 'Moderador'
union all select current_setting('t.mod2')::uuid, id from public.roles where name = 'Moderador';
update public.members set status = 'banned' where id = current_setting('t.banned')::uuid;

-- effective permissions
select is(public.member_global_permissions(current_setting('t.admin')::uuid), 65535::bigint, 'admin -> 65535');
select is(public.member_global_permissions(current_setting('t.plain')::uuid), 8199::bigint, 'plain member -> 8199');
select is(public.member_global_permissions(current_setting('t.mod')::uuid), 8199::bigint | 56360::bigint, 'Moderador -> everyone | 56360');

-- override_allow_ignores_channel_bits: channel bits in allow never grant anything; global bits do
insert into public.member_permission_overrides (member_id, allow, deny) values (current_setting('t.pen')::uuid, 17, 1);
select is(public.member_global_permissions(current_setting('t.pen')::uuid) & 1, 0::bigint,
  'override_allow_ignores_channel_bits: VIEW stays denied');
select is(public.member_global_permissions(current_setting('t.pen')::uuid) & 16, 16::bigint,
  'override allow keeps global bit 16');

-- set_verified: moderator -> plain member
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.mod')::uuid));
select public.set_verified(current_setting('t.plain')::uuid, true);
select tests.clear_authentication();
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where mr.member_id = current_setting('t.plain')::uuid and r.system_key = 'verified'), 1, 'moderator verifies a plain member');
select is((select count(*)::int from public.audit_log
  where action = 'member_verified_set' and target_id = current_setting('t.plain')::uuid
    and actor_member_id = current_setting('t.mod')::uuid and (payload->>'enabled')::boolean), 1, 'audit written');

-- idempotent enable
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.mod')::uuid));
select lives_ok(format($q$select public.set_verified(%L::uuid, true)$q$, current_setting('t.plain')), 'enabling twice is fine');

-- disable
select public.set_verified(current_setting('t.plain')::uuid, false);
select tests.clear_authentication();
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where mr.member_id = current_setting('t.plain')::uuid and r.system_key = 'verified'), 0, 'moderator unverifies');

-- admin can verify too
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.admin')::uuid));
select lives_ok(format($q$select public.set_verified(%L::uuid, true)$q$, current_setting('t.plain2')), 'admin can verify');
select tests.clear_authentication();

-- hierarchy / validation
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.mod')::uuid));
select throws_ok(format($q$select public.set_verified(%L::uuid, true)$q$, current_setting('t.mod2')),
  'P0001', 'hierarchy', 'moderator -> other moderator: hierarchy');
select throws_ok(format($q$select public.set_verified(%L::uuid, true)$q$, current_setting('t.mod')),
  'P0001', 'hierarchy', 'self: hierarchy');
select throws_ok(format($q$select public.set_verified(%L::uuid, true)$q$, current_setting('t.banned')),
  'P0001', 'invalid_input', 'banned target: invalid_input');
select throws_ok($q$select public.set_verified(gen_random_uuid(), true)$q$,
  'P0001', 'invalid_input', 'unknown target: invalid_input');
select tests.clear_authentication();

-- plain member lacks the bit
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.plain')::uuid));
select throws_ok(format($q$select public.set_verified(%L::uuid, true)$q$, current_setting('t.plain2')),
  'P0001', 'forbidden', 'plain member: forbidden');
select tests.clear_authentication();

-- unauthenticated-as-non-member: forbidden
select tests.authenticate_as(tests.create_wallet_user('0xe000000000000000000000000000000000000099'));
select throws_ok(format($q$select public.set_verified(%L::uuid, true)$q$, current_setting('t.plain2')),
  'P0001', 'forbidden', 'non-member: forbidden');
select tests.clear_authentication();

-- pinned role identity
select is((select count(*)::int from public.roles where system_key = 'verified' and name = 'Verificado'), 1,
  'Verificado is pinned with system_key verified');

-- backfill helper: private and idempotent
select ok(not has_function_privilege('anon', 'public._backfill_verified()', 'execute'), 'anon cannot run the backfill');
select ok(not has_function_privilege('authenticated', 'public._backfill_verified()', 'execute'), 'authenticated cannot run the backfill');
select set_config('t.bfa', tests.create_member('0xe000000000000000000000000000000000000011', current_setting('t.admin')::uuid)::text, true);
select set_config('t.bfp', tests.create_member('0xe000000000000000000000000000000000000012', current_setting('t.admin')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.bfp')::uuid, id from public.roles where name = 'Padrino';
update public.members set status = 'banned' where id = current_setting('t.bfp')::uuid;
select public._backfill_verified();
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where r.system_key = 'verified' and mr.member_id = current_setting('t.bfa')::uuid), 1, 'backfill: active member verified');
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where r.system_key = 'verified' and mr.member_id = current_setting('t.bfp')::uuid), 1, 'backfill: banned Padrino holder verified');
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where r.system_key = 'verified' and mr.member_id = current_setting('t.banned')::uuid), 0, 'backfill: banned non-Padrino not verified');
select is(public._backfill_verified(), 0, 'backfill: second call inserts nothing');

-- cannot grant a role carrying bits the actor lacks
-- (the moderator holds Verificado after the backfill, so drop it first or the raised bit would be inherited)
delete from public.member_roles where member_id = current_setting('t.mod')::uuid
  and role_id = (select id from public.roles where system_key = 'verified');
update public.roles set permissions = 3072 | 128 where system_key = 'verified';
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.mod')::uuid));
select throws_ok(format($q$select public.set_verified(%L::uuid, true)$q$, current_setting('t.pen')),
  'P0001', 'hierarchy', 'role with bits the actor lacks: hierarchy');
select tests.clear_authentication();
update public.roles set permissions = 3072 where system_key = 'verified';

-- renaming the role or creating a same-named one does not change what set_verified grants
update public.roles set name = 'Verificado (viejo)' where system_key = 'verified';
insert into public.roles (name, color, position, permissions) values ('Verificado', '#112233', 5, 0);
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.mod')::uuid));
select public.set_verified(current_setting('t.pen')::uuid, true);
select tests.clear_authentication();
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where r.system_key = 'verified' and mr.member_id = current_setting('t.pen')::uuid), 1, 'pinned role is granted after rename');
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where r.system_key is null and r.name = 'Verificado' and mr.member_id = current_setting('t.pen')::uuid), 0, 'same-named impostor role is not granted');

-- missing pinned role
delete from public.roles where system_key = 'verified';
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.mod')::uuid));
select throws_ok(format($q$select public.set_verified(%L::uuid, true)$q$, current_setting('t.plain2')),
  'P0001', 'invalid_input', 'missing pinned role: invalid_input');
select tests.clear_authentication();

select * from finish();
rollback;
