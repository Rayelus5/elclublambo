begin;
select plan(27);

-- Fixtures (as superuser)
select set_config('t.boot', tests.create_member('0x1000000000000000000000000000000000000001', null, true)::text, true);
select set_config('t.plain', tests.create_member('0x1000000000000000000000000000000000000002', current_setting('t.boot')::uuid)::text, true);
select set_config('t.pad', tests.create_member('0x1000000000000000000000000000000000000003', current_setting('t.boot')::uuid)::text, true);
select set_config('t.sa', tests.create_member('0x1000000000000000000000000000000000000004', current_setting('t.boot')::uuid)::text, true);
select set_config('t.padden', tests.create_member('0x1000000000000000000000000000000000000005', current_setting('t.boot')::uuid)::text, true);
select set_config('t.sadeny', tests.create_member('0x1000000000000000000000000000000000000006', current_setting('t.boot')::uuid)::text, true);
select set_config('t.banned', tests.create_member('0x1000000000000000000000000000000000000007', current_setting('t.boot')::uuid)::text, true);
select set_config('t.nomember', tests.create_wallet_user('0x1000000000000000000000000000000000000008')::text, true);

insert into public.member_roles (member_id, role_id)
select current_setting('t.pad')::uuid, id from public.roles where name = 'Padrino'
union all select current_setting('t.sa')::uuid, id from public.roles where name = 'SuperAdmin'
union all select current_setting('t.padden')::uuid, id from public.roles where name = 'Padrino'
union all select current_setting('t.sadeny')::uuid, id from public.roles where name = 'SuperAdmin'
union all select current_setting('t.banned')::uuid, id from public.roles where name = 'Padrino';
insert into public.member_permission_overrides (member_id, deny) values
  (current_setting('t.padden')::uuid, 16), (current_setting('t.sadeny')::uuid, 512);
update public.members set status = 'banned' where id = current_setting('t.banned')::uuid;

-- pure computation
select is(public.member_global_permissions(current_setting('t.plain')::uuid), 8199::bigint, 'no roles -> 8199');
select is(public.member_global_permissions(current_setting('t.pad')::uuid), 8215::bigint, 'Padrino -> 8215');
select is(public.member_global_permissions(current_setting('t.sa')::uuid), 65535::bigint, 'SuperAdmin -> 65535');
select is(public.member_global_permissions(current_setting('t.padden')::uuid), 8199::bigint, 'Padrino deny 16 -> 8199');
select is(public.member_global_permissions(current_setting('t.sadeny')::uuid), 65535::bigint, 'admin ignores deny');
select is(public.member_top_position(current_setting('t.pad')::uuid), 10, 'top position Padrino');
select is(public.member_top_position(current_setting('t.plain')::uuid), 0, 'top position plain = @everyone');

-- allow override
insert into public.member_permission_overrides (member_id, allow) values (current_setting('t.plain')::uuid, 16);
select is(public.member_global_permissions(current_setting('t.plain')::uuid), 8215::bigint, 'allow override adds global bit');

-- active padrino
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.pad')::uuid));
select is(public.my_membership_status(), 'active', 'status active');
select is(public.auth_wallet_address(), '0x1000000000000000000000000000000000000003', 'wallet from identity');
select ok(public.is_active_member(), 'is_active_member');
select ok(public.has_global_perm(16), 'padrino has CREATE_INVITES');
select ok(not public.has_global_perm(32), 'padrino lacks BAN_MEMBERS');
select is(public.my_permissions(), 8215::bigint, 'my_permissions padrino 8215');
select cmp_ok((select count(*) from public.members), '>', 0::bigint, 'active reads members');
select is((select count(*) from public.bans), 0::bigint, 'active without BAN reads no bans');
select throws_ok($$update public.members set status = 'banned' where true$$, '42501', null,
  'active cannot update status');
select lives_ok($$update public.members set display_name = 'Padrino1' where auth_user_id = auth.uid()$$,
  'active can update own display_name');
select ok(not public.has_global_perm(0), 'has_global_perm(0) is false');
select throws_ok(
  $$insert into public.members (auth_user_id, wallet_address, is_bootstrap)
    values (gen_random_uuid(), '0x2000000000000000000000000000000000000001', true)$$,
  '42501', null, 'active cannot insert members');
select set_config('t.cnt', (select count(*) from public.members)::text, true);
delete from public.members;
select is((select count(*) from public.members)::text, current_setting('t.cnt'),
  'active delete on members affects no rows');
select tests.clear_authentication();

-- banned
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.banned')::uuid));
select ok(not public.has_global_perm(16), 'banned has no perms despite Padrino');
select is(public.my_permissions(), 0::bigint, 'banned my_permissions 0');
select tests.clear_authentication();

-- non member
select tests.authenticate_as(current_setting('t.nomember')::uuid);
select is(public.my_membership_status(), 'none', 'non-member status none');
select is(public.my_permissions() + (select count(*) from public.members), 0::bigint,
  'non-member: 0 perms and 0 members visible');
select tests.clear_authentication();

-- anon has no execute on any public function
select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('anon', p.oid, 'execute')),
  0::bigint, 'anon has no EXECUTE on public functions');

select is(
  (select count(*) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and has_table_privilege('authenticated', c.oid, 'TRUNCATE')),
  0::bigint, 'authenticated has no TRUNCATE on public tables');

select * from finish();
rollback;
