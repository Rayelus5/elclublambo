begin;
select plan(47);

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;

-- privileges
select ok(not has_function_privilege('anon', 'public.toggle_reaction(uuid,text)', 'execute'), 'anon cannot toggle_reaction');
select ok(has_function_privilege('authenticated', 'public.toggle_reaction(uuid,text)', 'execute'), 'authenticated can toggle_reaction');
select ok(not has_function_privilege('anon', 'public.set_pinned(uuid,boolean)', 'execute'), 'anon cannot set_pinned');
select ok(has_function_privilege('authenticated', 'public.set_pinned(uuid,boolean)', 'execute'), 'authenticated can set_pinned');
select ok(not has_function_privilege('anon', 'public.mark_channel_read(uuid)', 'execute'), 'anon cannot mark_channel_read');
select ok(has_function_privilege('authenticated', 'public.mark_channel_read(uuid)', 'execute'), 'authenticated can mark_channel_read');
select ok(not has_function_privilege('anon', 'public.my_unread_channels()', 'execute'), 'anon cannot my_unread_channels');
select ok(has_function_privilege('authenticated', 'public.my_unread_channels()', 'execute'), 'authenticated can my_unread_channels');

-- fixtures
select set_config('t.a', tests.create_member('0x' || lpad('d2200', 40, '0'), null, true)::text, true);
select set_config('t.u', tests.create_member('0x' || lpad('d2201', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.n', tests.create_member('0x' || lpad('d2202', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.m', tests.create_member('0x' || lpad('d2203', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('d2204', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.h', tests.create_member('0x' || lpad('d2205', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.uu', (select auth_user_id::text from public.members where id = current_setting('t.u')::uuid), true);
select set_config('t.un', (select auth_user_id::text from public.members where id = current_setting('t.n')::uuid), true);
select set_config('t.um', (select auth_user_id::text from public.members where id = current_setting('t.m')::uuid), true);
select set_config('t.ux', (select auth_user_id::text from public.members where id = current_setting('t.x')::uuid), true);
select set_config('t.uh', (select auth_user_id::text from public.members where id = current_setting('t.h')::uuid), true);
-- members joined a day ago so that "new message" timestamps can be placed after the join date
update public.members set created_at = now() - interval '1 day'
  where id in (select id from public.members where id <> current_setting('t.a')::uuid);

insert into public.roles (name, color, position, permissions) values ('T220 mod', '#BBBBBB', 62, 8);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.m')::uuid, id from public.roles where name = 'T220 mod';

select set_config('t.cat', tests.create_channel(null, 'category', 'T220cat')::text, true);
select set_config('t.c1', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't220a')::text, true);
select set_config('t.c2', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't220b')::text, true);
select set_config('t.catH', tests.create_channel(null, 'category', 'T220hid')::text, true);
select set_config('t.cH', tests.create_channel(current_setting('t.catH')::uuid, 'text', 't220hid')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
  (current_setting('t.catH')::uuid, 'role', (select id from public.roles where is_everyone), 0, 1),
  (current_setting('t.c1')::uuid, 'member', current_setting('t.n')::uuid, 0, 8192);

-- messages (inserted directly: fixtures only), created in the past
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links, created_at) values
  (gen_random_uuid(), current_setting('t.c1')::uuid, current_setting('t.x')::uuid, tests.td('uno'), 'uno', false, now() - interval '1 hour');
select set_config('t.m1', (select id::text from public.messages where body_text = 'uno'), true);
insert into public.messages (channel_id, thread_root_id, author_id, body, body_text, allow_links, created_at) values
  (current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.x')::uuid, tests.td('resp'), 'resp', false, now() - interval '50 minutes');
select set_config('t.r1', (select id::text from public.messages where body_text = 'resp'), true);
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links, created_at) values
  (gen_random_uuid(), current_setting('t.cH')::uuid, current_setting('t.x')::uuid, tests.td('oculto'), 'oculto', false, now() - interval '1 hour');
select set_config('t.mH', (select id::text from public.messages where body_text = 'oculto'), true);
insert into public.messages (channel_id, author_id, body, body_text, allow_links, created_at, deleted_at, deleted_by) values
  (current_setting('t.c2')::uuid, current_setting('t.x')::uuid, '{"type":"doc","content":[]}', '', false, now() - interval '1 hour', now(), current_setting('t.x')::uuid);
select set_config('t.mD', (select id::text from public.messages where channel_id = current_setting('t.c2')::uuid), true);

-- ===== reactions =====
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(public.toggle_reaction(current_setting('t.m1')::uuid, E'\U0001F44D'), true, 'first toggle adds');
select is((select count(*)::int from public.message_reactions where message_id = current_setting('t.m1')::uuid), 1, 'reaction stored');
select is(public.toggle_reaction(current_setting('t.m1')::uuid, E'\U0001F44D'), false, 'second toggle removes');
select is((select count(*)::int from public.message_reactions where message_id = current_setting('t.m1')::uuid), 0, 'reaction removed');
select lives_ok($$select public.toggle_reaction(current_setting('t.r1')::uuid, E'\U0001F525')$$, 'reaction on a thread reply ok');
select throws_ok($$select public.toggle_reaction(current_setting('t.m1')::uuid, '')$$, 'P0001', 'invalid_input', 'empty emoji: invalid_input');
select throws_ok($$select public.toggle_reaction(current_setting('t.m1')::uuid, 'a b')$$, 'P0001', 'invalid_input', 'emoji with whitespace: invalid_input');
select throws_ok($$select public.toggle_reaction(current_setting('t.m1')::uuid, E'a\nb')$$, 'P0001', 'invalid_input', 'emoji with control char: invalid_input');
select throws_ok($$select public.toggle_reaction(current_setting('t.m1')::uuid, repeat('x', 33))$$, 'P0001', 'invalid_input', 'emoji over 32 bytes: invalid_input');
select throws_ok($$select public.toggle_reaction(current_setting('t.m1')::uuid, null)$$, 'P0001', 'invalid_input', 'null emoji: invalid_input');
select throws_ok($$select public.toggle_reaction(gen_random_uuid(), E'\U0001F44D')$$, 'P0001', 'forbidden', 'missing message: forbidden');
select throws_ok($$select public.toggle_reaction(current_setting('t.mD')::uuid, E'\U0001F44D')$$, 'P0001', 'invalid_input', 'deleted message: invalid_input');
select throws_ok($$select public.toggle_reaction(current_setting('t.mH')::uuid, E'\U0001F44D')$$, 'P0001', 'forbidden', 'message in a hidden channel: forbidden');

-- 20 distinct emojis max
select lives_ok($$select public.toggle_reaction(current_setting('t.m1')::uuid, 'e' || g) from generate_series(1, 20) g$$, '20 distinct emojis ok');
select throws_ok($$select public.toggle_reaction(current_setting('t.m1')::uuid, 'e21')$$, 'P0001', 'too_many_reactions', 'the 21st distinct emoji: too_many_reactions');
select tests.authenticate_as(current_setting('t.ux')::uuid);
select is(public.toggle_reaction(current_setting('t.m1')::uuid, 'e1'), true, 'another member adds an existing emoji at the limit');
select is(public.toggle_reaction(current_setting('t.m1')::uuid, 'e1'), false, 'and can remove it again');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(public.toggle_reaction(current_setting('t.m1')::uuid, 'e20'), false, 'removing at the limit is allowed');

select tests.authenticate_as(current_setting('t.un')::uuid);
select throws_ok($$select public.toggle_reaction(current_setting('t.m1')::uuid, E'\U0001F44D')$$, 'P0001', 'forbidden', 'without ADD_REACTIONS: forbidden');
select tests.authenticate_as(gen_random_uuid());
select throws_ok($$select public.toggle_reaction(current_setting('t.m1')::uuid, E'\U0001F44D')$$, 'P0001', 'forbidden', 'non member: forbidden');
select tests.clear_authentication();

-- ===== pins =====
select tests.authenticate_as(current_setting('t.uu')::uuid);
select throws_ok($$select public.set_pinned(current_setting('t.m1')::uuid, true)$$, 'P0001', 'forbidden', 'pin without MANAGE_MESSAGES: forbidden');
select tests.authenticate_as(current_setting('t.um')::uuid);
select lives_ok($$select public.set_pinned(current_setting('t.m1')::uuid, true)$$, 'moderator pins a root');
select tests.clear_authentication();
select is((select pinned_by from public.messages where id = current_setting('t.m1')::uuid), current_setting('t.m')::uuid, 'pinned_by set');
select ok((select pinned_at is not null from public.messages where id = current_setting('t.m1')::uuid), 'pinned_at set');
select is((select count(*)::int from public.audit_log where action = 'message_pinned' and target_id = current_setting('t.m1')::uuid), 1, 'pin audited');
select tests.authenticate_as(current_setting('t.um')::uuid);
select throws_ok($$select public.set_pinned(current_setting('t.r1')::uuid, true)$$, 'P0001', 'invalid_input', 'pin a reply: invalid_input');
select throws_ok($$select public.set_pinned(current_setting('t.mD')::uuid, true)$$, 'P0001', 'invalid_input', 'pin a deleted message: invalid_input');
select throws_ok($$select public.set_pinned(current_setting('t.mH')::uuid, true)$$, 'P0001', 'forbidden', 'pin in a hidden channel: forbidden');
select lives_ok($$select public.set_pinned(current_setting('t.m1')::uuid, false)$$, 'moderator unpins');
select tests.clear_authentication();
select ok((select pinned_at is null and pinned_by is null from public.messages where id = current_setting('t.m1')::uuid), 'pin columns cleared');
select is((select count(*)::int from public.audit_log where action = 'message_unpinned' and target_id = current_setting('t.m1')::uuid), 1, 'unpin audited');

-- ===== unread =====
-- u: c1 has messages from x (root + reply) newer than u's join date; the hidden channel has one too
select tests.authenticate_as(current_setting('t.uu')::uuid);
select ok((select current_setting('t.c1')::uuid in (select public.my_unread_channels())), 'channel with foreign messages is unread');
select ok((select current_setting('t.cH')::uuid not in (select public.my_unread_channels())), 'hidden channel never listed');
select ok((select current_setting('t.c2')::uuid not in (select public.my_unread_channels())), 'soft-deleted messages do not count');
select lives_ok($$select public.mark_channel_read(current_setting('t.c1')::uuid)$$, 'mark_channel_read ok');
select ok((select current_setting('t.c1')::uuid not in (select public.my_unread_channels())), 'read channel is no longer unread');
select throws_ok($$select public.mark_channel_read(current_setting('t.cH')::uuid)$$, 'P0001', 'forbidden', 'mark_channel_read on a hidden channel: forbidden');
select tests.clear_authentication();

-- own messages are ignored; foreign replies count; a new message after the read mark makes the channel unread again
insert into public.messages (channel_id, author_id, body, body_text, allow_links, created_at) values
  (current_setting('t.c1')::uuid, current_setting('t.u')::uuid, tests.td('mio'), 'mio', false, now() + interval '1 second');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select ok((select current_setting('t.c1')::uuid not in (select public.my_unread_channels())), 'own newer message does not make the channel unread');
select tests.clear_authentication();
insert into public.messages (channel_id, thread_root_id, author_id, body, body_text, allow_links, created_at) values
  (current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.x')::uuid, tests.td('nueva'), 'nueva', false, now() + interval '2 seconds');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select ok((select current_setting('t.c1')::uuid in (select public.my_unread_channels())), 'a newer foreign reply makes the channel unread');
select tests.clear_authentication();

select * from finish();
rollback;
