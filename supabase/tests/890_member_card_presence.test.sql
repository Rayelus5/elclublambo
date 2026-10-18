-- Member card + server-authoritative presence + channel member list.
begin;
select plan(19);

select set_config('t.a', tests.create_member('0x' || lpad('f8900', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f8901', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
update public.members set handle = 'ana890', bio = 'hola', welcome_completed_at = now() where id = current_setting('t.a')::uuid;
update public.members set handle = 'beto890', welcome_completed_at = now() where id = current_setting('t.b')::uuid;
insert into public.member_roles (member_id, role_id) select current_setting('t.a')::uuid, id from public.roles where name = 'Moderador';
select set_config('t.cat', tests.create_channel(null, 'category', 'T890cat')::text, true);
select set_config('t.open', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't890open')::text, true);
select set_config('t.hid', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't890hid')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.hid')::uuid, 'role', (select id from public.roles where is_everyone), 0, 1),
         (current_setting('t.hid')::uuid, 'member', current_setting('t.a')::uuid, 1, 0);

-- presence: the heartbeat stamps only the caller, and is throttled
select tests.authenticate_as(current_setting('t.ub')::uuid);
select public.touch_presence();
select tests.clear_authentication();
select isnt((select last_seen_at from public.member_presence where member_id = current_setting('t.b')::uuid), null, 'touch_presence stamps the caller');
select is((select count(*)::int from public.member_presence where member_id = current_setting('t.a')::uuid), 0, 'and nobody else');
update public.member_presence set last_seen_at = now() - interval '10 seconds' where member_id = current_setting('t.b')::uuid;
select set_config('t.seen', (select last_seen_at::text from public.member_presence where member_id = current_setting('t.b')::uuid), true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select public.touch_presence();
select tests.clear_authentication();
select is((select last_seen_at::text from public.member_presence where member_id = current_setting('t.b')::uuid), current_setting('t.seen'), 'a second beat within 30 s writes nothing');

-- member card
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is(public.member_card(current_setting('t.a')::uuid) ->> 'handle', 'ana890', 'the card carries the handle');
select is(public.member_card(current_setting('t.a')::uuid) ->> 'bio', 'hola', 'and the bio');
select is((public.member_card(current_setting('t.a')::uuid) -> 'roles' -> 0 ->> 'name'), 'Moderador', 'roles, highest first, without @everyone');
select is((public.member_card(current_setting('t.a')::uuid) ->> 'online')::boolean, false, 'A never beat: offline');
select is((public.member_card(current_setting('t.b')::uuid) ->> 'online')::boolean, true, 'B beat recently: online');
select ok(not (public.member_card(current_setting('t.a')::uuid) ? 'authUserId') and not (public.member_card(current_setting('t.a')::uuid) ? 'lastSeenAt'),
  'no auth id nor raw last-seen timestamp leaves');
select throws_ok($$select public.member_card('00000000-0000-4000-8000-0000000089ff'::uuid)$$, 'P0001', 'not_found', 'unknown member: not_found');

-- channel members
select is((select count(*)::int from public.channel_members(current_setting('t.open')::uuid) where member_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid)), 2,
  'both members can view the open channel');
select throws_ok(format($q$select * from public.channel_members(%L::uuid)$q$, current_setting('t.hid')), 'P0001', 'not_found', 'B cannot list a channel it cannot view');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select count(*)::int from public.channel_members(current_setting('t.hid')::uuid) where member_id = current_setting('t.b')::uuid), 0,
  'B is not listed in the hidden channel');
select tests.clear_authentication();

select ok(not has_function_privilege('anon', 'public.member_card(uuid)', 'execute'), 'anon cannot read cards');

-- MC3: no raw timestamp is readable by members
select ok(not has_table_privilege('authenticated', 'public.member_presence', 'select'), 'member_presence is not readable by clients');
select hasnt_column('public', 'members', 'last_seen_at', 'members no longer carries last_seen_at');

-- MC2: the cheap online refresh
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((select online from public.members_online(array[current_setting('t.b')::uuid])), true, 'members_online reports B online');
select is((select online from public.members_online(array[current_setting('t.a')::uuid])), false, 'and A offline');
select tests.clear_authentication();

-- MC1: a hidden donor who passes a DAO gate is not singled out in a gated channel's list
select set_config('t.c', tests.create_member('0x' || lpad('f8902', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
select set_config('t.gated', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't890gated')::text, true);
update public.channels set gate_min_net_usdc = 5000000, gate_scope = 'view' where id = current_setting('t.gated')::uuid;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc)
  values (public._active_chain(), current_setting('t.b')::uuid, 10, 9000000);
update public.dao_state set total_shares = total_shares + 10, value_usdc = value_usdc + 9000000 where chain_id = public._active_chain();
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((select count(*)::int from public.channel_members(current_setting('t.gated')::uuid)
           where member_id in (current_setting('t.a')::uuid, current_setting('t.c')::uuid)), 2,
  'the gated channel lists by role access: non-donors appear too, so the list says nothing about who donated');
select tests.clear_authentication();

select * from finish();
rollback;
