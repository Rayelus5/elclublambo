-- Member card + server-authoritative presence + channel member list.
begin;
select plan(14);

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
select isnt((select last_seen_at from public.members where id = current_setting('t.b')::uuid), null, 'touch_presence stamps the caller');
select is((select last_seen_at from public.members where id = current_setting('t.a')::uuid), null, 'and nobody else');
update public.members set last_seen_at = now() - interval '10 seconds' where id = current_setting('t.b')::uuid;
select set_config('t.seen', (select last_seen_at::text from public.members where id = current_setting('t.b')::uuid), true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select public.touch_presence();
select tests.clear_authentication();
select is((select last_seen_at::text from public.members where id = current_setting('t.b')::uuid), current_setting('t.seen'), 'a second beat within 30 s writes nothing');

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

select * from finish();
rollback;
