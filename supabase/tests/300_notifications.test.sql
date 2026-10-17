begin;
select plan(78);

-- ===== structure =====
select has_table('public', 'notifications', 'notifications exists');
select has_table('public', 'channel_follow_prefs', 'channel_follow_prefs exists');
select has_table('public', 'push_subscriptions', 'push_subscriptions exists');
select has_column('public', 'channels', 'default_follow', 'channels.default_follow exists');
select ok((select relrowsecurity from pg_class where oid = 'public.notifications'::regclass), 'RLS on notifications');
select ok((select relrowsecurity from pg_class where oid = 'public.channel_follow_prefs'::regclass), 'RLS on channel_follow_prefs');
select ok((select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass), 'RLS on push_subscriptions');
select is((select count(*)::int from pg_policies where schemaname = 'public'
           and tablename in ('notifications', 'channel_follow_prefs', 'push_subscriptions') and cmd <> 'SELECT'),
  0, 'no write policies on the new tables');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'INSERT')
      and not has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.notifications', 'DELETE'), 'authenticated cannot write notifications directly');
select ok(not has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT')
      and not has_table_privilege('authenticated', 'public.channel_follow_prefs', 'INSERT'), 'authenticated cannot write prefs/subscriptions directly');
select ok(not has_table_privilege('anon', 'public.notifications', 'SELECT'), 'anon has no access to notifications');

-- anon cannot execute any of the new functions
select ok(not has_function_privilege('anon', 'public.set_channel_follow(uuid,text)', 'execute'), 'anon cannot set_channel_follow');
select ok(not has_function_privilege('anon', 'public.my_channel_follow(uuid)', 'execute'), 'anon cannot my_channel_follow');
select ok(not has_function_privilege('anon', 'public.mark_notifications_read(bigint[])', 'execute'), 'anon cannot mark_notifications_read');
select ok(not has_function_privilege('anon', 'public.my_unread_notification_count()', 'execute'), 'anon cannot my_unread_notification_count');
select ok(not has_function_privilege('anon', 'public.save_push_subscription(text,text,text)', 'execute'), 'anon cannot save_push_subscription');
select ok(not has_function_privilege('anon', 'public.delete_push_subscription(text)', 'execute'), 'anon cannot delete_push_subscription');
select ok(not has_function_privilege('authenticated', 'public._follow_level(uuid,uuid)', 'execute'), 'authenticated cannot _follow_level');
select ok(not has_function_privilege('authenticated', 'public.broadcast_notification_event()', 'execute'), 'authenticated cannot the notification trigger fn');
select ok(has_function_privilege('authenticated', 'public.save_push_subscription(text,text,text)', 'execute'), 'authenticated can save_push_subscription');

-- realtime policy: own policy, CASE-guarded, no write policy
select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages'
           and policyname = 'realtime_receive_member_topics' and cmd = 'SELECT'), 1, 'member topic policy exists');
select ok((select qual like '%CASE%' from pg_policies where schemaname = 'realtime' and tablename = 'messages'
           and policyname = 'realtime_receive_member_topics'), 'member topic policy guards the uuid cast with CASE');
select has_trigger('public', 'notifications', 'notifications_broadcast_insert', 'notification insert trigger');

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d3000', 40, '0'), null, true)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('d3001', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.y', tests.create_member('0x' || lpad('d3002', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ux', (select auth_user_id::text from public.members where id = current_setting('t.x')::uuid), true);
select set_config('t.uy', (select auth_user_id::text from public.members where id = current_setting('t.y')::uuid), true);

select set_config('t.cat', tests.create_channel(null, 'category', 'T300cat')::text, true);
select set_config('t.c', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't300')::text, true);
select set_config('t.c2', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't300b')::text, true);
select set_config('t.msg', gen_random_uuid()::text, true);
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links)
  values (current_setting('t.msg')::uuid, current_setting('t.c')::uuid, current_setting('t.a')::uuid,
          '{"type":"doc","content":[]}'::jsonb, 'hola', false);

-- ===== notifications constraints =====
select throws_ok(
  format($q$insert into public.notifications (recipient_id, kind) values (%L::uuid, 'bogus')$q$, current_setting('t.x')),
  '23514', null, 'unknown kind rejected');
select lives_ok(
  format($q$insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id)
            values (%L::uuid, 'mention', %L::uuid, %L::uuid, %L::uuid)$q$,
    current_setting('t.x'), current_setting('t.a'), current_setting('t.c'), current_setting('t.msg')),
  'mention for x inserted');
select throws_ok(
  format($q$insert into public.notifications (recipient_id, kind, channel_id, message_id)
            values (%L::uuid, 'reply', %L::uuid, %L::uuid)$q$,
    current_setting('t.x'), current_setting('t.c'), current_setting('t.msg')),
  '23505', null, 'one notification per (recipient, message)');
select lives_ok(
  format($q$insert into public.notifications (recipient_id, kind, channel_id, message_id)
            values (%L::uuid, 'channel_message', %L::uuid, %L::uuid)$q$,
    current_setting('t.y'), current_setting('t.c'), current_setting('t.msg')),
  'same message, other recipient is fine');
select lives_ok(
  format($q$insert into public.notifications (recipient_id, kind, data) values (%L::uuid, 'invite_redeemed', '{}'), (%L::uuid, 'invite_redeemed', '{}')$q$,
    current_setting('t.x'), current_setting('t.x')),
  'notifications without a message are not deduplicated');
select is((select count(*)::int from realtime.messages where event = 'notification_created'
           and topic = 'member:' || current_setting('t.x')), 3, 'each insert broadcast to member:<recipient>');
select ok((select bool_and(m.private and (select count(*) from jsonb_object_keys(m.payload)) = 1 and m.payload ? 'id')
           from realtime.messages m where m.event = 'notification_created'), 'broadcast payload is {id} only and private');

-- ===== RLS =====
select tests.authenticate_as(current_setting('t.ux')::uuid);
select is((select count(*)::int from public.notifications), 3, 'x sees own notifications');
select is(public.my_unread_notification_count(), 3, 'x unread count 3');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('t.uy')::uuid);
select is((select count(*)::int from public.notifications), 1, 'y sees only own notification');
select is((select count(*)::int from public.notifications where recipient_id = current_setting('t.x')::uuid), 0, 'y cannot see x notifications');
select tests.clear_authentication();

-- losing VIEW hides the channel notification (select and count), not the channel-less ones
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.c')::uuid, 'member', current_setting('t.x')::uuid, 0, 1);
select tests.authenticate_as(current_setting('t.ux')::uuid);
select is((select count(*)::int from public.notifications), 2, 'x loses the notification of the hidden channel');
select is(public.my_unread_notification_count(), 2, 'unread count excludes the hidden channel');
select tests.clear_authentication();

-- mark_notifications_read only touches own rows
select tests.authenticate_as(current_setting('t.ux')::uuid);
select is(public.mark_notifications_read(array[(select id from public.notifications where recipient_id = current_setting('t.y')::uuid limit 1)]),
  0, 'cannot see/mark another member notification by id');
select is(public.mark_notifications_read(null), 2, 'null marks all visible own rows (the hidden-channel row is skipped)');
select is(public.my_unread_notification_count(), 0, 'nothing unread afterwards');
select is(public.mark_notifications_read(null), 0, 'idempotent');
select tests.clear_authentication();
select is((select read_at is null from public.notifications where recipient_id = current_setting('t.y')::uuid), true, 'y notification untouched');

-- ===== follow prefs =====
select tests.authenticate_as(current_setting('t.uy')::uuid);
select is(public.my_channel_follow(current_setting('t.c2')::uuid), 'mentions', 'default follow level is mentions');
select is(public.my_channel_follow((select id from public.channels where name = 'Anuncios' and kind = 'text')), 'all', 'Anuncios defaults to all');
select is(public.my_channel_follow((select id from public.channels where name = 'General' and kind = 'text')), 'mentions', 'General defaults to mentions');
select public.set_channel_follow(current_setting('t.c2')::uuid, 'all');
select is(public.my_channel_follow(current_setting('t.c2')::uuid), 'all', 'explicit pref wins');
select is((select count(*)::int from public.channel_follow_prefs), 1, 'y sees own pref row');
select public.set_channel_follow(current_setting('t.c2')::uuid, 'mentions');
select is((select count(*)::int from public.channel_follow_prefs), 0, 'returning to the default deletes the row');
select public.set_channel_follow(current_setting('t.c2')::uuid, 'mute');
select is(public.my_channel_follow(current_setting('t.c2')::uuid), 'mute', 'mute stored');
select throws_ok(format($q$select public.set_channel_follow(%L::uuid, 'bogus')$q$, current_setting('t.c2')), 'P0001', 'invalid_input', 'invalid level');
select throws_ok(format($q$select public.set_channel_follow(%L::uuid, 'all')$q$, current_setting('t.cat')), 'P0001', 'invalid_input', 'categories cannot be followed');
select tests.clear_authentication();
select is((select count(*)::int from public.channel_follow_prefs where member_id = current_setting('t.y')::uuid), 1, 'one pref row persisted');

select tests.authenticate_as(current_setting('t.ux')::uuid);
select is((select count(*)::int from public.channel_follow_prefs), 0, 'x does not see y prefs');
select throws_ok(format($q$select public.set_channel_follow(%L::uuid, 'all')$q$, current_setting('t.c')), 'P0001', 'forbidden', 'hidden channel: forbidden');
select throws_ok(format($q$select public.my_channel_follow(%L::uuid)$q$, current_setting('t.c')), 'P0001', 'forbidden', 'hidden channel: my_channel_follow forbidden');
select tests.clear_authentication();

-- ===== push subscriptions =====
select tests.authenticate_as(current_setting('t.uy')::uuid);
select throws_ok($q$select public.save_push_subscription('http://fcm.googleapis.com/fcm/send/abc', repeat('A', 87), repeat('B', 22))$q$, 'P0001', 'invalid_input', 'http endpoint rejected');
select throws_ok($q$select public.save_push_subscription('https://127.0.0.1/x', repeat('A', 87), repeat('B', 22))$q$, 'P0001', 'invalid_input', 'loopback rejected');
select throws_ok($q$select public.save_push_subscription('https://evil.com/x', repeat('A', 87), repeat('B', 22))$q$, 'P0001', 'invalid_input', 'foreign host rejected');
select throws_ok($q$select public.save_push_subscription('https://fcm.googleapis.com.evil.com/x', repeat('A', 87), repeat('B', 22))$q$, 'P0001', 'invalid_input', 'suffix attack on exact host rejected');
select throws_ok($q$select public.save_push_subscription('https://evil-fcm.googleapis.com.attacker.io/x', repeat('A', 87), repeat('B', 22))$q$, 'P0001', 'invalid_input', 'lookalike host rejected');
select throws_ok($q$select public.save_push_subscription('https://evilnotify.windows.com/x', repeat('A', 87), repeat('B', 22))$q$, 'P0001', 'invalid_input', 'wildcard needs a dot boundary');
select throws_ok($q$select public.save_push_subscription('https://user:pw@fcm.googleapis.com/x', repeat('A', 87), repeat('B', 22))$q$, 'P0001', 'invalid_input', 'userinfo rejected');
select throws_ok($q$select public.save_push_subscription('https://fcm.googleapis.com@evil.com/x', repeat('A', 87), repeat('B', 22))$q$, 'P0001', 'invalid_input', 'userinfo trick rejected');
select throws_ok($q$select public.save_push_subscription('https://fcm.googleapis.com:8443/x', repeat('A', 87), repeat('B', 22))$q$, 'P0001', 'invalid_input', 'non-default port rejected');
select throws_ok($q$select public.save_push_subscription('https://fcm.googleapis.com/' || repeat('a', 2048), repeat('A', 87), repeat('B', 22))$q$, 'P0001', 'invalid_input', 'endpoint over 2048 chars rejected');
select throws_ok($q$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', 'not base64!', repeat('B', 22))$q$, 'P0001', 'invalid_input', 'bad p256dh rejected');
select throws_ok($q$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', repeat('A', 87), 'x')$q$, 'P0001', 'invalid_input', 'short auth rejected');
select lives_ok($q$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', repeat('A', 87), repeat('B', 22))$q$, 'FCM endpoint accepted');
select lives_ok($q$select public.save_push_subscription('https://wns2-par02p.notify.windows.com/w/?token=abc', repeat('A', 87), repeat('B', 22))$q$, 'wildcard windows host accepted');
select lives_ok($q$select public.save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/abc', repeat('A', 87), repeat('B', 22))$q$, 'mozilla accepted');
select lives_ok($q$select public.save_push_subscription('https://web.push.apple.com/abc', repeat('A', 87), repeat('B', 22))$q$, 'apple accepted');
select lives_ok($q$select public.save_push_subscription('https://api.push.apple.com/abc', repeat('A', 87), repeat('B', 22))$q$, 'wildcard apple host accepted');
select tests.clear_authentication();

-- upsert reassigns the endpoint to the latest caller; at most 10 per member, oldest dropped
select tests.authenticate_as(current_setting('t.ux')::uuid);
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc', repeat('C', 87), repeat('D', 22));
select tests.clear_authentication();
select is((select member_id from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/abc'),
  current_setting('t.x')::uuid, 'upsert reassigns the member');
select is((select p256dh from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/abc'), repeat('C', 87), 'upsert updates keys');

select tests.authenticate_as(current_setting('t.uy')::uuid);
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/s' || g, repeat('A', 87), repeat('B', 22)) from generate_series(1, 10) g;
select is((select count(*)::int from public.push_subscriptions), 10, 'capped at 10 per member');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://wns2-par02p.notify.windows.com/w/?token=abc'), 0, 'oldest subscription dropped');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/s10'), 1, 'newest kept');
select public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/s10');
select is((select count(*)::int from public.push_subscriptions), 9, 'delete own subscription');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('t.ux')::uuid);
select public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/s1');
select tests.clear_authentication();
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/s1'), 1, 'cannot delete another member subscription');

select * from finish();
rollback;
