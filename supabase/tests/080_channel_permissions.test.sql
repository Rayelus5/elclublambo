begin;
select plan(36);

-- privileges
select ok(not has_function_privilege('anon', 'public.channel_permissions(uuid,uuid)', 'execute'), 'anon cannot channel_permissions');
select ok(not has_function_privilege('anon', 'public.can(uuid,bigint)', 'execute'), 'anon cannot can');
select ok(not has_function_privilege('anon', 'public.can_view(uuid)', 'execute'), 'anon cannot can_view');
select ok(not has_function_privilege('anon', 'public.visible_channels()', 'execute'), 'anon cannot visible_channels');
select ok(not has_function_privilege('anon', 'public.gate_passes(uuid,uuid,text)', 'execute'), 'anon cannot gate_passes');
select ok(not has_function_privilege('authenticated', 'public.channel_permissions(uuid,uuid)', 'execute'), 'authenticated cannot channel_permissions (oracle)');
select ok(not has_function_privilege('authenticated', 'public.member_global_permissions(uuid)', 'execute'), 'authenticated cannot member_global_permissions');
select ok(not has_function_privilege('authenticated', 'public.member_top_position(uuid)', 'execute'), 'authenticated cannot member_top_position');
select ok(not has_function_privilege('authenticated', 'public.gate_passes(uuid,uuid,text)', 'execute'), 'authenticated cannot gate_passes');
select ok(has_function_privilege('authenticated', 'public.my_channel_permissions(uuid)', 'execute'), 'authenticated can my_channel_permissions');
select ok(not has_function_privilege('anon', 'public.my_channel_permissions(uuid)', 'execute'), 'anon cannot my_channel_permissions');
select ok(has_function_privilege('service_role', 'public.channel_permissions(uuid,uuid)', 'execute'), 'service_role can channel_permissions');

-- fixtures
select set_config('t.a', tests.create_member('0x00000000000000000000000000000000000a0001', null, true)::text, true);
select set_config('t.b', tests.create_member('0x00000000000000000000000000000000000a0002', current_setting('t.a')::uuid)::text, true);

select set_config('t.c', tests.create_member('0x00000000000000000000000000000000000a0003', current_setting('t.a')::uuid)::text, true);
insert into public.member_permission_overrides (member_id, allow, deny) values (current_setting('t.c')::uuid, 0, 1);

select set_config('t.cat1', tests.create_channel(null, 'category', 'Oculta')::text, true);
select set_config('t.txt1', tests.create_channel(current_setting('t.cat1')::uuid, 'text', 'dentro')::text, true);
select set_config('t.cat2', tests.create_channel(null, 'category', 'Publica')::text, true);
select set_config('t.forum2', tests.create_channel(current_setting('t.cat2')::uuid, 'forum', 'foro')::text, true);
select set_config('t.txt2', tests.create_channel(current_setting('t.forum2')::uuid, 'text', 'chat')::text, true);
select set_config('t.txtp', tests.create_channel(current_setting('t.cat2')::uuid, 'text', 'solo-lectura')::text, true);

select set_config('t.everyone', (select id::text from public.roles where is_everyone), true);
insert into public.roles (id, name, color, position, permissions)
  values (gen_random_uuid(), 'T080 gestor', '#AAAAAA', 50, 8327);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.b')::uuid, id from public.roles where name = 'T080 gestor';

insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
  (current_setting('t.cat1')::uuid, 'role', current_setting('t.everyone')::uuid, 0, 1),
  (current_setting('t.txt1')::uuid, 'member', current_setting('t.a')::uuid, 1, 0),
  (current_setting('t.cat2')::uuid, 'role', current_setting('t.everyone')::uuid, 8, 0),
  (current_setting('t.txtp')::uuid, 'role', current_setting('t.everyone')::uuid, 0, 2);

-- gate hook is a no-op in F2a
select is(public.gate_passes(current_setting('t.a')::uuid, current_setting('t.txt2')::uuid, 'view'), true, 'gate_passes always true in F2a');

-- direct computation
select is(public.channel_permissions(current_setting('t.a')::uuid, current_setting('t.txt2')::uuid), 8207::bigint, 'a: cascade through category allow');
select is(public.channel_permissions(current_setting('t.a')::uuid, current_setting('t.txt1')::uuid), 0::bigint, 'a: hidden ancestor beats own allow');
select is(public.channel_permissions(current_setting('t.b')::uuid, current_setting('t.txt2')::uuid), 8207::bigint, 'b: channel bits only (global 128 not returned)');
select is(public.channel_permissions(current_setting('t.c')::uuid, current_setting('t.txt2')::uuid), 0::bigint, 'VIEW-deny penalty hides the channel');

-- a gated ancestor exercises the gate branch; gate_passes is true in F2a so nothing changes
update public.channels set gate_mode = 'min_share_bps', gate_value = 100, gate_scope = 'view' where id = current_setting('t.cat2')::uuid;
select is(public.channel_permissions(current_setting('t.a')::uuid, current_setting('t.txt2')::uuid), 8207::bigint, 'gated ancestor unchanged in F2a');
select is(public.channel_permissions(current_setting('t.a')::uuid, gen_random_uuid()), 0::bigint, 'missing channel -> 0');

-- RLS: channels
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.a')::uuid));
select is((select count(*)::int from public.channels where id = current_setting('t.cat1')::uuid), 0, 'hidden category not selectable');
select is((select count(*)::int from public.channels where id = current_setting('t.txt1')::uuid), 0, 'child of hidden node hidden even with own allow');
select is((select count(*)::int from public.channels where id = current_setting('t.cat2')::uuid), 1, 'visible category selectable');
select is((select count(*)::int from public.channels where id = current_setting('t.txt2')::uuid), 1, 'nested visible text selectable');
select is((select count(*)::int from public.visible_channels()
  where id in (current_setting('t.cat1')::uuid, current_setting('t.txt1')::uuid, current_setting('t.cat2')::uuid,
               current_setting('t.forum2')::uuid, current_setting('t.txt2')::uuid, current_setting('t.txtp')::uuid)),
  4, 'visible_channels returns only visible nodes');

-- can / can_view for current member
select is(public.can_view(current_setting('t.txt2')::uuid), true, 'can_view visible');
select is(public.can_view(current_setting('t.txt1')::uuid), false, 'can_view hidden');
select is(public.can(current_setting('t.txt2')::uuid, 2), true, 'can SEND on txt2');
select is(public.can(current_setting('t.txtp')::uuid, 2), false, 'cannot SEND where denied');
select is(public.can(current_setting('t.txt2')::uuid, 8), true, 'can MANAGE_MESSAGES via category allow');

select is(public.my_channel_permissions(current_setting('t.txt2')::uuid), 8207::bigint, 'my_channel_permissions for current member');
select tests.clear_authentication();
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.c')::uuid));
select is(public.can(current_setting('t.txt2')::uuid, 2), false, 'VIEW-deny penalty: cannot SEND');
select is(public.my_channel_permissions(current_setting('t.txt2')::uuid), 0::bigint, 'VIEW-deny penalty: my_channel_permissions 0');
select tests.clear_authentication();
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.a')::uuid));

-- RLS: overwrites need MANAGE_CHANNELS
select is((select count(*)::int from public.permission_overwrites), 0, 'overwrites invisible without 128');
select tests.clear_authentication();

select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.b')::uuid));
select is((select count(*)::int from public.permission_overwrites
  where channel_id in (current_setting('t.cat1')::uuid, current_setting('t.txt1')::uuid, current_setting('t.cat2')::uuid, current_setting('t.txtp')::uuid)),
  2, 'with 128 only overwrites of visible channels');
select tests.clear_authentication();

-- inactive member
update public.members set status = 'banned' where id = current_setting('t.b')::uuid;
select is(public.channel_permissions(current_setting('t.b')::uuid, current_setting('t.txt2')::uuid), 0::bigint, 'banned member -> 0');

-- corrupt tree (guard disabled): walk must terminate
alter table public.channels disable trigger channels_tree_guard;
update public.channels set parent_id = current_setting('t.forum2')::uuid where id = current_setting('t.cat2')::uuid;
select lives_ok(format($q$select public.channel_permissions(%L::uuid, %L::uuid)$q$, current_setting('t.a'), current_setting('t.txt2')),
  'cyclic tree does not recurse forever');

select * from finish();
rollback;
