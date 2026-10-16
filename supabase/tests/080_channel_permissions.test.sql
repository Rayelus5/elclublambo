begin;
select plan(26);

-- privileges
select ok(not has_function_privilege('anon', 'public.channel_permissions(uuid,uuid)', 'execute'), 'anon cannot channel_permissions');
select ok(not has_function_privilege('anon', 'public.can(uuid,bigint)', 'execute'), 'anon cannot can');
select ok(not has_function_privilege('anon', 'public.can_view(uuid)', 'execute'), 'anon cannot can_view');
select ok(not has_function_privilege('anon', 'public.visible_channels()', 'execute'), 'anon cannot visible_channels');
select ok(not has_function_privilege('anon', 'public.gate_passes(uuid,uuid,text)', 'execute'), 'anon cannot gate_passes');
select ok(has_function_privilege('authenticated', 'public.channel_permissions(uuid,uuid)', 'execute'), 'authenticated can channel_permissions');
select ok(has_function_privilege('service_role', 'public.channel_permissions(uuid,uuid)', 'execute'), 'service_role can channel_permissions');

-- fixtures
select set_config('t.a', tests.create_member('0x00000000000000000000000000000000000a0001', null, true)::text, true);
select set_config('t.b', tests.create_member('0x00000000000000000000000000000000000a0002', current_setting('t.a')::uuid)::text, true);

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
select is(public.channel_permissions(current_setting('t.b')::uuid, current_setting('t.txt2')::uuid), 8335::bigint, 'b: role base + cascade keeps global bits');
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
