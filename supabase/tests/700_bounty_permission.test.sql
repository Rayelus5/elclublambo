-- F3c Task 1: CREATE_BOUNTIES channel bit (65536). CHANNEL_MASK 97295, ALL 131071, member-safe mask 76823.
begin;
select plan(22);

select set_config('t.a', tests.create_member('0x00000000000000000000000000000000000d0001', null, true)::text, true);
select set_config('t.b', tests.create_member('0x00000000000000000000000000000000000d0002', current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x00000000000000000000000000000000000d0003', current_setting('t.a')::uuid)::text, true);
-- b: delegate with MANAGE_ROLES 64 + MANAGE_CHANNELS 128 + MANAGE_MESSAGES 8 + CREATE_BOUNTIES 65536
insert into public.roles (name, color, position, permissions) values ('T700 gestor', '#AAAAAA', 500, 64 | 128 | 8 | 65536);
insert into public.roles (name, color, position, permissions) values ('T700 bajo', '#CCCCCC', 5, 0);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.b')::uuid, id from public.roles where name = 'T700 gestor';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.everyone', (select id::text from public.roles where is_everyone), true);
select set_config('t.verified', (select id::text from public.roles where system_key = 'verified'), true);
select set_config('t.bajo', (select id::text from public.roles where name = 'T700 bajo'), true);
select set_config('t.ch', tests.create_channel(null, 'category', 'T700')::text, true);

-- default grant
select is((select permissions & 65536 from public.roles where system_key = 'verified'), 65536::bigint,
  'Verificado holds CREATE_BOUNTIES by default');
select is((select permissions from public.roles where is_everyone), 8199::bigint, '@everyone is unchanged');

-- overwrite accepted at table level; out of range rejected
select lives_ok(format($q$insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (%L::uuid, 'role', %L::uuid, 65536, 0)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'an overwrite allowing 65536 is accepted');
select throws_ok(format($q$insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (%L::uuid, 'role', %L::uuid, 131072, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  '23514', null, 'an overwrite with 131072 is rejected');

-- channel_permissions returns the bit when allowed, omits it when denied
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.ch')::uuid, 'member', current_setting('t.c')::uuid, 65536, 0);
select is(public.channel_permissions(current_setting('t.c')::uuid, current_setting('t.ch')::uuid) & 65536, 65536::bigint,
  'channel_permissions returns the bit for a member granted it');
update public.permission_overwrites set allow = 0, deny = 65536
  where channel_id = current_setting('t.ch')::uuid and target_type = 'member' and target_id = current_setting('t.c')::uuid;
select is(public.channel_permissions(current_setting('t.c')::uuid, current_setting('t.ch')::uuid) & 65536, 0::bigint,
  'channel_permissions omits the bit when denied');
select is(public.channel_permissions(current_setting('t.a')::uuid, current_setting('t.ch')::uuid), 97295::bigint,
  'admin gets the full channel mask 97295');
select is(public.member_global_permissions(current_setting('t.a')::uuid), 131071::bigint, 'admin global permissions are 131071');
-- the penalty mechanism cannot be used to smuggle global bits
select is(public.member_global_permissions(current_setting('t.b')::uuid) & 65536, 65536::bigint,
  'a role bit 65536 shows in global permissions of the holder');

-- can() / has_any_channel_perm accept the new bit
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is(public.can(current_setting('t.ch')::uuid, 65536), true, 'can() accepts 65536');
select is(public.has_any_channel_perm(65536), true, 'has_any_channel_perm accepts 65536');
select throws_ok($q$select public.can(null, 131072)$q$, 'P0001', 'invalid_input', 'can() still rejects bits outside the channel mask');

-- non-admin delegate: 65536 on @everyone and on Verificado is allowed, 8 is not
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 65536, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'delegate can put 65536 on @everyone');
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 65536, 0)$q$, current_setting('t.ch'), current_setting('t.verified')),
  'delegate can put 65536 on Verificado');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 8, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'P0001', 'forbidden', 'delegate cannot put 8 on @everyone');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 65536 | 8, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'P0001', 'forbidden', 'delegate cannot mix 8 with 65536 on @everyone');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 131072, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'P0001', 'invalid_input', 'bit 131072 is outside the channel mask');

-- update_role: member-safe mask on mass roles for non-admins
select lives_ok(format($q$select public.update_role(%L::uuid, 'Verificado', '#3DDC84', 3072 | 65536)$q$, current_setting('t.verified')),
  'delegate can grant 65536 to a system_key role');
select throws_ok(format($q$select public.update_role(%L::uuid, 'Verificado', '#3DDC84', 3072 | 8)$q$, current_setting('t.verified')),
  'P0001', 'forbidden', 'delegate cannot grant 8 to a system_key role');
select tests.clear_authentication();

-- role permissions are bounded by 131071
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok($q$select public.create_role('T700 ok', '#123456', 131071 & ~512)$q$, 'create_role accepts up to 131071 (without ADMINISTRATOR)');
select throws_ok($q$select public.create_role('T700 big', '#123456', 131072)$q$, 'P0001', 'invalid_input', 'create_role rejects above 131071');
select throws_ok(format($q$select public.update_role(%L::uuid, 'T700 bajo', '#CCCCCC', 131072)$q$, current_setting('t.bajo')),
  'P0001', 'invalid_input', 'update_role rejects above 131071');
select tests.clear_authentication();

select * from finish();
rollback;
