begin;
select plan(66);

-- helpers (rolled back with the test)
create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.mn(p_kind text, p_id text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('kind', p_kind, 'id', p_id))
$$;
create function tests.mdoc(variadic p_nodes jsonb[]) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', to_jsonb(p_nodes))))
$$;
create function tests.post(p_ch uuid, p_body jsonb, p_root uuid default null, p_quoted uuid default null)
returns uuid language sql as $$
  select public.post_message(p_ch, p_body, 'x', false, p_root, p_quoted, '[]'::jsonb)
$$;
-- kind of the notification a member got for a message (null when none)
create function tests.nk(p_msg text, p_member text) returns text language sql as $$
  select n.kind from public.notifications n where n.message_id = p_msg::uuid and n.recipient_id = p_member::uuid
$$;
create function tests.nc(p_msg text) returns int language sql as $$
  select count(*)::int from public.notifications n where n.message_id = p_msg::uuid
$$;

-- privileges
select ok(not has_function_privilege('authenticated', 'public._notify_message(uuid,boolean)', 'execute'), 'authenticated cannot _notify_message');
select ok(not has_function_privilege('anon', 'public._notify_message(uuid,boolean)', 'execute'), 'anon cannot _notify_message');
select ok(not has_function_privilege('service_role', 'public._notify_message(uuid,boolean)', 'execute'), 'service_role cannot _notify_message');
select ok(has_function_privilege('authenticated', 'public.post_message(uuid,jsonb,text,boolean,uuid,uuid,jsonb)', 'execute'), 'authenticated still posts');
select ok(not has_function_privilege('anon', 'public.post_message(uuid,jsonb,text,boolean,uuid,uuid,jsonb)', 'execute'), 'anon still cannot post');
select ok(has_function_privilege('authenticated', 'public.edit_message(uuid,jsonb,text)', 'execute'), 'authenticated still edits');
select ok(has_function_privilege('service_role', 'public.post_message_as(uuid,uuid,jsonb,text,boolean,uuid,uuid,jsonb,text)', 'execute'), 'service_role still post_message_as');
select ok(not has_function_privilege('authenticated', 'public.post_message_as(uuid,uuid,jsonb,text,boolean,uuid,uuid,jsonb,text)', 'execute'), 'authenticated still cannot post_message_as');

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d3100', 40, '0'), null, true)::text, true);
select set_config('t.p', tests.create_member('0x' || lpad('d3101', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.q', tests.create_member('0x' || lpad('d3102', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('d3103', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.y', tests.create_member('0x' || lpad('d3104', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.z', tests.create_member('0x' || lpad('d3105', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.h', tests.create_member('0x' || lpad('d3106', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('d3107', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.w', tests.create_member('0x' || lpad('d3108', 40, '0'), current_setting('t.a')::uuid)::text, true);
update public.members set status = 'banned' where id = current_setting('t.b')::uuid;
select set_config('t.up', (select auth_user_id::text from public.members where id = current_setting('t.p')::uuid), true);
select set_config('t.uq', (select auth_user_id::text from public.members where id = current_setting('t.q')::uuid), true);
select set_config('t.ux', (select auth_user_id::text from public.members where id = current_setting('t.x')::uuid), true);
select set_config('t.uy', (select auth_user_id::text from public.members where id = current_setting('t.y')::uuid), true);
select set_config('t.uz', (select auth_user_id::text from public.members where id = current_setting('t.z')::uuid), true);
select set_config('t.uh', (select auth_user_id::text from public.members where id = current_setting('t.h')::uuid), true);
select set_config('t.uw', (select auth_user_id::text from public.members where id = current_setting('t.w')::uuid), true);

-- p holds MENTION_EVERYONE (4096) and EMBED_LINKS; role R groups x and h
insert into public.roles (name, color, position, permissions) values
  ('T310 mentioner', '#AAAAAA', 61, 4096),
  ('T310 group', '#BBBBBB', 62, 0);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.p')::uuid, id from public.roles where name = 'T310 mentioner';
insert into public.member_roles (member_id, role_id)
  select m, r.id from public.roles r, unnest(array[current_setting('t.x')::uuid, current_setting('t.h')::uuid]) m
  where r.name = 'T310 group';
select set_config('t.role', (select id::text from public.roles where name = 'T310 group'), true);

select set_config('t.cat', tests.create_channel(null, 'category', 'T310cat')::text, true);
select set_config('t.c', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't310')::text, true);
select set_config('t.cA', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't310all')::text, true);
update public.channels set default_follow = 'all' where id = current_setting('t.cA')::uuid;
-- h cannot see c
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.c')::uuid, 'member', current_setting('t.h')::uuid, 0, 1);

-- ===== mentions =====
select tests.authenticate_as(current_setting('t.up')::uuid);
select set_config('t.m1', tests.post(current_setting('t.c')::uuid, tests.mdoc(
  tests.mn('member', current_setting('t.x')), tests.mn('member', current_setting('t.h')),
  tests.mn('member', current_setting('t.b')), tests.mn('member', current_setting('t.p'))))::text, true);
select tests.clear_authentication();
select is(tests.nk(current_setting('t.m1'), current_setting('t.x')), 'mention', '@member who sees the channel: mention');
select is(tests.nk(current_setting('t.m1'), current_setting('t.h')), null, '@member who cannot see the channel: nothing');
select is(tests.nk(current_setting('t.m1'), current_setting('t.b')), null, '@banned member: nothing');
select is(tests.nk(current_setting('t.m1'), current_setting('t.p')), null, 'author is never notified');
select is(tests.nc(current_setting('t.m1')), 1, 'exactly one notification for the message');
select is((select actor_id from public.notifications where message_id = current_setting('t.m1')::uuid), current_setting('t.p')::uuid, 'actor is the author');
select is((select channel_id from public.notifications where message_id = current_setting('t.m1')::uuid), current_setting('t.c')::uuid, 'notification carries the channel');
select is((select data from public.notifications where message_id = current_setting('t.m1')::uuid), '{}'::jsonb, 'root mention has no thread data');

-- @everyone / @role without MENTION_EVERYONE: nobody
select tests.authenticate_as(current_setting('t.uq')::uuid);
select set_config('t.m2', tests.post(current_setting('t.c')::uuid, tests.mdoc(
  tests.mn('everyone', 'everyone'), tests.mn('role', current_setting('t.role'))))::text, true);
select tests.clear_authentication();
select is(tests.nc(current_setting('t.m2')), 0, '@everyone and @role without MENTION_EVERYONE notify nobody');

-- @everyone with permission: active members who see the channel, minus the author
select tests.authenticate_as(current_setting('t.up')::uuid);
select set_config('t.m3', tests.post(current_setting('t.c')::uuid, tests.mdoc(tests.mn('everyone', 'everyone')))::text, true);
select tests.clear_authentication();
select is(tests.nc(current_setting('t.m3')), 6, '@everyone: a, q, x, y, z, w (not author, banned or hidden)');
select is(tests.nk(current_setting('t.m3'), current_setting('t.x')), 'mention', '@everyone recipients get kind mention');
select is(tests.nk(current_setting('t.m3'), current_setting('t.h')), null, '@everyone skips a member who cannot see the channel');
select is(tests.nk(current_setting('t.m3'), current_setting('t.b')), null, '@everyone skips a banned member');
select is(tests.nk(current_setting('t.m3'), current_setting('t.p')), null, '@everyone skips the author');

-- @role: only role members who see the channel
select tests.authenticate_as(current_setting('t.up')::uuid);
select set_config('t.m4', tests.post(current_setting('t.c')::uuid, tests.mdoc(tests.mn('role', current_setting('t.role'))))::text, true);
select tests.clear_authentication();
select is(tests.nk(current_setting('t.m4'), current_setting('t.x')), 'mention', '@role: member of the role who sees the channel');
select is(tests.nk(current_setting('t.m4'), current_setting('t.h')), null, '@role: member of the role who cannot see the channel');
select is(tests.nc(current_setting('t.m4')), 1, '@role: only role members are notified');

-- ===== mute =====
select tests.authenticate_as(current_setting('t.uz')::uuid);
select public.set_channel_follow(current_setting('t.c')::uuid, 'mute');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.up')::uuid);
select set_config('t.m5', tests.post(current_setting('t.c')::uuid, tests.mdoc(tests.mn('everyone', 'everyone')))::text, true);
select set_config('t.m6', tests.post(current_setting('t.c')::uuid, tests.mdoc(tests.mn('member', current_setting('t.z'))))::text, true);
select tests.clear_authentication();
select is(tests.nk(current_setting('t.m5'), current_setting('t.z')), null, 'mute suppresses @everyone');
select is(tests.nc(current_setting('t.m5')), 5, '@everyone still reaches the others');
select is(tests.nk(current_setting('t.m6'), current_setting('t.z')), 'mention', 'mute does not suppress a direct @member');

-- ===== replies and quotes =====
select tests.authenticate_as(current_setting('t.ux')::uuid);
select set_config('t.root', tests.post(current_setting('t.c')::uuid, tests.td('raiz'))::text, true);
select tests.authenticate_as(current_setting('t.uy')::uuid);
select set_config('t.r1', tests.post(current_setting('t.c')::uuid, tests.td('r1'), current_setting('t.root')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.uz')::uuid);
select set_config('t.r2', tests.post(current_setting('t.c')::uuid, tests.td('r2'), current_setting('t.root')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ux')::uuid);
select set_config('t.r3', tests.post(current_setting('t.c')::uuid, tests.td('r3'), current_setting('t.root')::uuid)::text, true);
select tests.clear_authentication();
select is(tests.nk(current_setting('t.r1'), current_setting('t.x')), 'reply', 'reply notifies the root author');
select is((select data from public.notifications where message_id = current_setting('t.r1')::uuid and recipient_id = current_setting('t.x')::uuid),
  jsonb_build_object('thread_root_id', current_setting('t.root')), 'reply notification carries thread_root_id');
select is(tests.nk(current_setting('t.r2'), current_setting('t.y')), 'reply', 'reply notifies earlier participants');
select is(tests.nk(current_setting('t.r2'), current_setting('t.x')), 'reply', 'reply notifies the root author again for a new message');
select is(tests.nk(current_setting('t.r3'), current_setting('t.z')), 'reply', 'mute does not suppress replies');
select is(tests.nk(current_setting('t.r3'), current_setting('t.x')), null, 'replier who is the root author is not self-notified');
select is(tests.nc(current_setting('t.r3')), 2, 'x replying notifies y and z only');
select is(tests.nk(current_setting('t.r1'), current_setting('t.q')), null, 'unrelated member gets no reply notification');

-- quoting
select tests.authenticate_as(current_setting('t.uy')::uuid);
select set_config('t.qt', tests.post(current_setting('t.c')::uuid, tests.td('cito'), null, current_setting('t.root')::uuid)::text, true);
select tests.clear_authentication();
select is(tests.nk(current_setting('t.qt'), current_setting('t.x')), 'reply', 'quoting notifies the quoted author');
select is(tests.nc(current_setting('t.qt')), 1, 'quoting a message notifies only its author');

-- ===== follow all =====
select tests.authenticate_as(current_setting('t.uz')::uuid);
select public.set_channel_follow(current_setting('t.cA')::uuid, 'mute');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.up')::uuid);
select set_config('t.f1', tests.post(current_setting('t.cA')::uuid, tests.td('anuncio'))::text, true);
select tests.clear_authentication();
select is(tests.nk(current_setting('t.f1'), current_setting('t.x')), 'channel_message', 'level all: root message notifies channel_message');
select is(tests.nk(current_setting('t.f1'), current_setting('t.h')), 'channel_message', 'level all: members who see the channel');
select is(tests.nk(current_setting('t.f1'), current_setting('t.z')), null, 'mute suppresses channel_message');
select is(tests.nk(current_setting('t.f1'), current_setting('t.p')), null, 'author not notified of own root');
select is(tests.nk(current_setting('t.f1'), current_setting('t.b')), null, 'banned member not notified');
select is(tests.nc(current_setting('t.f1')), 6, 'channel_message: a, q, x, y, w, h');
-- a member who overrides to mentions does not get it
select tests.authenticate_as(current_setting('t.uw')::uuid);
select public.set_channel_follow(current_setting('t.cA')::uuid, 'mentions');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.up')::uuid);
select set_config('t.f2', tests.post(current_setting('t.cA')::uuid, tests.td('otro'))::text, true);
select tests.clear_authentication();
select is(tests.nk(current_setting('t.f2'), current_setting('t.w')), null, 'own pref mentions overrides the channel default all');

-- replies are not channel_message
select tests.authenticate_as(current_setting('t.ux')::uuid);
select set_config('t.f3', tests.post(current_setting('t.cA')::uuid, tests.td('resp'), current_setting('t.f1')::uuid)::text, true);
select tests.clear_authentication();
select is(tests.nc(current_setting('t.f3')), 1, 'reply in an all-follow channel: no channel_message fan-out');
select is(tests.nk(current_setting('t.f3'), current_setting('t.p')), 'reply', 'reply in an all-follow channel: only the thread participant');

-- ===== duplicates =====
select tests.authenticate_as(current_setting('t.up')::uuid);
select set_config('t.d1', tests.post(current_setting('t.cA')::uuid, tests.mdoc(tests.mn('member', current_setting('t.x'))),
  current_setting('t.f1')::uuid)::text, true);
select set_config('t.d2', tests.post(current_setting('t.cA')::uuid, tests.mdoc(tests.mn('member', current_setting('t.y'))))::text, true);
select tests.clear_authentication();
select is(tests.nk(current_setting('t.d1'), current_setting('t.x')), 'mention', 'mention + reply to the same member: one notification, kind mention');
select is((select count(*)::int from public.notifications where message_id = current_setting('t.d1')::uuid and recipient_id = current_setting('t.x')::uuid), 1, 'no duplicate for mention + reply');
select is(tests.nk(current_setting('t.d2'), current_setting('t.y')), 'mention', 'mention + channel_message: kind mention');
select is((select count(*)::int from public.notifications where message_id = current_setting('t.d2')::uuid and recipient_id = current_setting('t.y')::uuid), 1, 'no duplicate for mention + channel_message');

-- ===== edits =====
select tests.authenticate_as(current_setting('t.up')::uuid);
select public.edit_message(current_setting('t.m1')::uuid, tests.mdoc(
  tests.mn('member', current_setting('t.x')), tests.mn('member', current_setting('t.h')),
  tests.mn('member', current_setting('t.b')), tests.mn('member', current_setting('t.p'))), 'x');
select tests.clear_authentication();
select is(tests.nc(current_setting('t.m1')), 1, 'edit without changes creates no notification');
select tests.authenticate_as(current_setting('t.up')::uuid);
select public.edit_message(current_setting('t.m1')::uuid, tests.mdoc(
  tests.mn('member', current_setting('t.x')), tests.mn('member', current_setting('t.y'))), 'x');
select tests.clear_authentication();
select is(tests.nk(current_setting('t.m1'), current_setting('t.y')), 'mention', 'edit adding @y notifies y');
select is(tests.nc(current_setting('t.m1')), 2, 'edit adding @y: only the new mention is notified');
select tests.authenticate_as(current_setting('t.up')::uuid);
select public.edit_message(current_setting('t.m1')::uuid, tests.mdoc(
  tests.mn('member', current_setting('t.x')), tests.mn('member', current_setting('t.y')), tests.mn('member', current_setting('t.h'))), 'x');
select tests.clear_authentication();
select is(tests.nk(current_setting('t.m1'), current_setting('t.h')), null, 'edit adding a member who cannot see the channel: nothing');
select tests.authenticate_as(current_setting('t.up')::uuid);
select public.edit_message(current_setting('t.m1')::uuid, tests.mdoc(tests.mn('everyone', 'everyone')), 'x');
select tests.clear_authentication();
select is(tests.nc(current_setting('t.m1')), 5, 'edit adding @everyone: new recipients only (z muted), x and y keep their single row');
select is((select count(*)::int from (
  select recipient_id, message_id from public.notifications where message_id is not null group by 1, 2 having count(*) > 1) s),
  0, 'never two notifications for the same (recipient, message)');
select is((select count(*)::int from public.notifications where recipient_id = actor_id), 0, 'nobody is notified of their own message');

-- ===== Task 1 review minors =====
-- (a) re-saving the oldest subscription keeps it; cap stays 10
select tests.authenticate_as(current_setting('t.uw')::uuid);
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/o' || g, repeat('A', 87), repeat('B', 22)) from generate_series(1, 10) g;
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/o1', repeat('A', 87), repeat('B', 22));
select is((select count(*)::int from public.push_subscriptions), 10, 're-saving the oldest keeps the cap at 10');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/o1'), 1, 're-saved endpoint is kept');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/o11', repeat('A', 87), repeat('B', 22));
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/o2'), 0, 'next save trims the now-oldest');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/o1'), 1, 're-saved endpoint survives the next trim');
select tests.clear_authentication();

-- (b) mark_notifications_read skips rows of channels the member cannot see
insert into public.notifications (recipient_id, kind, actor_id, channel_id) values
  (current_setting('t.h')::uuid, 'channel_message', current_setting('t.p')::uuid, current_setting('t.c')::uuid);
insert into public.notifications (recipient_id, kind) values (current_setting('t.h')::uuid, 'invite_redeemed');
select set_config('t.hid', (select max(id)::text from public.notifications where channel_id = current_setting('t.c')::uuid and recipient_id = current_setting('t.h')::uuid), true);
select set_config('t.hvis', (select count(*)::text from public.notifications where recipient_id = current_setting('t.h')::uuid and channel_id is distinct from current_setting('t.c')::uuid), true);
select tests.authenticate_as(current_setting('t.uh')::uuid);
select is(public.mark_notifications_read(null), current_setting('t.hvis')::int, 'mark all only touches visible rows');
select is(public.mark_notifications_read(array[current_setting('t.hid')::bigint]), 0, 'marking a hidden-channel row by id is a no-op');
select tests.clear_authentication();
select is((select count(*)::int from public.notifications where recipient_id = current_setting('t.h')::uuid and channel_id = current_setting('t.c')::uuid and read_at is null), 1, 'hidden-channel row stays unread');

-- (c) a message notification needs a channel
select throws_ok(
  format($q$insert into public.notifications (recipient_id, kind, message_id) values (%L::uuid, 'reply', %L::uuid)$q$,
    current_setting('t.x'), current_setting('t.m1')),
  '23514', null, 'message_id without channel_id rejected');

select * from finish();
rollback;
