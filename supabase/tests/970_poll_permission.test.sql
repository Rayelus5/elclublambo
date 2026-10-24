-- F4e Task 1: CREATE_POLLS channel bit (131072). CHANNEL_MASK 228367, ALL 262143, member-safe mask 207895.
begin;
select plan(28);

select set_config('t.a', tests.create_member('0x00000000000000000000000000000000000e0001', null, true)::text, true);
select set_config('t.b', tests.create_member('0x00000000000000000000000000000000000e0002', current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x00000000000000000000000000000000000e0003', current_setting('t.a')::uuid)::text, true);
select set_config('t.d', tests.create_member('0x00000000000000000000000000000000000e0004', current_setting('t.a')::uuid)::text, true);
-- b: delegate with MANAGE_ROLES 64 + MANAGE_CHANNELS 128 + MANAGE_MESSAGES 8 + CREATE_POLLS 131072
insert into public.roles (name, color, position, permissions) values ('T970 gestor', '#AAAAAA', 500, 64 | 128 | 8 | 131072);
insert into public.roles (name, color, position, permissions) values ('T970 bajo', '#CCCCCC', 5, 0);
-- e: a delegate WITHOUT the new bit (escalation guard)
select set_config('t.e', tests.create_member('0x00000000000000000000000000000000000e0005', current_setting('t.a')::uuid)::text, true);
insert into public.roles (name, color, position, permissions) values ('T970 sin', '#BBBBBB', 400, 64 | 128);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.b')::uuid, id from public.roles where name = 'T970 gestor';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.e')::uuid, id from public.roles where name = 'T970 sin';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.ue', (select auth_user_id::text from public.members where id = current_setting('t.e')::uuid), true);
select set_config('t.everyone', (select id::text from public.roles where is_everyone), true);
select set_config('t.verified', (select id::text from public.roles where system_key = 'verified'), true);
select set_config('t.bajo', (select id::text from public.roles where name = 'T970 bajo'), true);
select set_config('t.ch', tests.create_channel(null, 'category', 'T970')::text, true);
select set_config('t.cat2', tests.create_channel(null, 'category', 'T970b')::text, true);
select set_config('t.chG', tests.create_channel(current_setting('t.cat2')::uuid, 'text', 'gated')::text, true);
select set_config('t.chE', tests.create_channel(current_setting('t.cat2')::uuid, 'text', 'esc')::text, true);

-- default grant
select is((select permissions & 131072 from public.roles where system_key = 'verified'), 131072::bigint,
  'Verificado holds CREATE_POLLS by default');
select is((select permissions & 131072 from public.roles where name = 'Moderador'), 131072::bigint,
  'Moderador holds CREATE_POLLS by default');
select is((select permissions from public.roles where is_everyone), 8199::bigint, '@everyone is unchanged');

-- overwrite accepted at table level; out of range rejected
select lives_ok(format($q$insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (%L::uuid, 'role', %L::uuid, 131072, 0)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'an overwrite allowing 131072 is accepted');
select throws_ok(format($q$insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (%L::uuid, 'role', %L::uuid, 262144, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  '23514', null, 'an overwrite allowing 262144 is rejected');
select throws_ok(format($q$insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (%L::uuid, 'role', %L::uuid, 0, 262144)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  '23514', null, 'an overwrite denying 262144 is rejected');

-- channel_permissions returns the bit when allowed, omits it when denied
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.ch')::uuid, 'member', current_setting('t.c')::uuid, 131072, 0);
select is(public.channel_permissions(current_setting('t.c')::uuid, current_setting('t.ch')::uuid) & 131072, 131072::bigint,
  'channel_permissions returns the bit for a member granted it');
update public.permission_overwrites set allow = 0, deny = 131072
  where channel_id = current_setting('t.ch')::uuid and target_type = 'member' and target_id = current_setting('t.c')::uuid;
select is(public.channel_permissions(current_setting('t.c')::uuid, current_setting('t.ch')::uuid) & 131072, 0::bigint,
  'channel_permissions omits the bit when denied');
select is(public.channel_permissions(current_setting('t.a')::uuid, current_setting('t.ch')::uuid), 228367::bigint,
  'admin gets the full channel mask 228367');
select is(public.member_global_permissions(current_setting('t.a')::uuid), 262143::bigint, 'admin global permissions are 262143');
select is(public.member_global_permissions(current_setting('t.b')::uuid) & 131072, 131072::bigint,
  'a role bit 131072 shows in global permissions of the holder');

-- a penalty override cannot smuggle the new bit in through its allow
insert into public.member_permission_overrides (member_id, allow, deny) values (current_setting('t.d')::uuid, 131072, 0)
  on conflict (member_id) do update set allow = excluded.allow, deny = excluded.deny;
select is(public.member_global_permissions(current_setting('t.d')::uuid) & 131072, 0::bigint,
  'an override allow never grants CREATE_POLLS');
-- the view-gate still clears every channel bit, the new one included
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.chG')::uuid, 'member', current_setting('t.c')::uuid, 131072, 0);
select is(public.channel_permissions(current_setting('t.c')::uuid, current_setting('t.chG')::uuid) & 131072, 131072::bigint,
  'ungated: the member holds 131072 on the channel');
update public.channels set gate_min_donated_usd6 = 100, gate_scope = 'view' where id = current_setting('t.chG')::uuid;
select is(public.channel_permissions(current_setting('t.c')::uuid, current_setting('t.chG')::uuid), 0::bigint,
  'a failed view-gate returns 0 (clears 131072 too)');

-- can() / has_any_channel_perm accept the new bit
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is(public.can(current_setting('t.ch')::uuid, 131072), true, 'can() accepts 131072');
select is(public.has_any_channel_perm(131072), true, 'has_any_channel_perm accepts 131072');
select throws_ok($q$select public.can(null, 262144)$q$, 'P0001', 'invalid_input', 'can() rejects bits outside the channel mask');

-- non-admin delegate: 131072 on @everyone and on Verificado is allowed (member-safe), 8 mixed in is not
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 131072, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'delegate can put 131072 on @everyone');
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 131072, 0)$q$, current_setting('t.ch'), current_setting('t.verified')),
  'delegate can put 131072 on Verificado');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 131072 | 8, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'P0001', 'forbidden', 'delegate cannot mix 8 with 131072 on @everyone');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 262144, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'P0001', 'invalid_input', 'bit 262144 is outside the channel mask');

-- update_role: member-safe mask on mass roles for non-admins now includes 131072
select lives_ok(format($q$select public.update_role(%L::uuid, 'Verificado', '#3DDC84', (select permissions from public.roles where id = %L::uuid) & ~131072)$q$,
  current_setting('t.verified'), current_setting('t.verified')),
  'delegate can remove 131072 from a system_key role');
select lives_ok(format($q$select public.update_role(%L::uuid, 'Verificado', '#3DDC84', (select permissions from public.roles where id = %L::uuid) | 131072)$q$,
  current_setting('t.verified'), current_setting('t.verified')),
  'delegate can grant 131072 to a system_key role');
select tests.clear_authentication();

-- escalation: a delegate without the bit cannot grant it (overwrite nor role)
select tests.authenticate_as(current_setting('t.ue')::uuid);
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 131072, 0)$q$, current_setting('t.chE'), current_setting('t.bajo')),
  'P0001', 'forbidden', 'a delegate lacking 131072 cannot put it in an overwrite');
select throws_ok(format($q$select public.update_role(%L::uuid, 'T970 bajo', '#CCCCCC', 131072)$q$, current_setting('t.bajo')),
  'P0001', 'hierarchy', 'a delegate lacking 131072 cannot grant it to a role');
select tests.clear_authentication();

-- role permissions are bounded by 262143
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok($q$select public.create_role('T970 ok', '#123456', 262143 & ~512)$q$, 'create_role accepts up to 262143 (without ADMINISTRATOR)');
select throws_ok($q$select public.create_role('T970 big', '#123456', 262144)$q$, 'P0001', 'invalid_input', 'create_role rejects above 262143');
select throws_ok(format($q$select public.update_role(%L::uuid, 'T970 bajo', '#CCCCCC', 262144)$q$, current_setting('t.bajo')),
  'P0001', 'invalid_input', 'update_role rejects above 262143');
select tests.clear_authentication();

select * from finish();
rollback;
