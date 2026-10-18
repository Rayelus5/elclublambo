begin;
select plan(38);

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;

-- number of broadcasts of an event about an id
create function tests.ev(p_event text, p_id uuid) returns int language sql as $$
  select count(*)::int from realtime.messages m where m.event = p_event and m.payload->>'id' = p_id::text
$$;

-- ===== structure =====
select has_trigger('public', 'messages', 'messages_broadcast_insert', 'insert trigger on messages');
select has_trigger('public', 'messages', 'messages_broadcast_update', 'update trigger on messages');
select has_trigger('public', 'messages', 'messages_broadcast_delete', 'delete trigger on messages');
select has_trigger('public', 'message_reactions', 'message_reactions_broadcast_insert', 'insert trigger on reactions');
select has_trigger('public', 'message_reactions', 'message_reactions_broadcast_delete', 'delete trigger on reactions');

select ok(not has_function_privilege('anon', 'public.broadcast_message_event()', 'execute'), 'anon cannot execute message broadcast fn');
select ok(not has_function_privilege('authenticated', 'public.broadcast_message_event()', 'execute'), 'authenticated cannot execute message broadcast fn');
select ok(not has_function_privilege('service_role', 'public.broadcast_message_event()', 'execute'), 'service_role cannot execute message broadcast fn');
select ok(not has_function_privilege('anon', 'public.broadcast_reaction_event()', 'execute'), 'anon cannot execute reaction broadcast fn');
select ok(not has_function_privilege('authenticated', 'public.broadcast_reaction_event()', 'execute'), 'authenticated cannot execute reaction broadcast fn');
select ok(not has_function_privilege('service_role', 'public.broadcast_reaction_event()', 'execute'), 'service_role cannot execute reaction broadcast fn');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
           from pg_proc p where p.oid in ('public.broadcast_message_event()'::regprocedure, 'public.broadcast_reaction_event()'::regprocedure)),
  'broadcast functions are definer with empty search_path');
select is(to_regprocedure('public._spike_emit(uuid)'), null, 'spike helper is gone');

select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd = 'SELECT'), 6,
  'one SELECT policy per topic family on realtime.messages (channel, member, ticket, dao, activity, presence)');
select ok((select bool_and(qual like '%CASE%') from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd = 'SELECT'),
  'every receive policy guards the uuid cast with CASE');
select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd in ('INSERT', 'ALL')), 0,
  'no client write policy on realtime.messages');

-- folded-in task 4 fixes
select ok(pg_get_functiondef('public.toggle_reaction(uuid,text)'::regprocedure) ~* 'for share', 'toggle_reaction locks the message row for share');

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d2300', 40, '0'), null, true)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('d2301', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.m', tests.create_member('0x' || lpad('d2302', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ux', (select auth_user_id::text from public.members where id = current_setting('t.x')::uuid), true);
select set_config('t.um', (select auth_user_id::text from public.members where id = current_setting('t.m')::uuid), true);
insert into public.roles (name, color, position, permissions) values ('T230 mod', '#BBBBBB', 63, 8);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.m')::uuid, id from public.roles where name = 'T230 mod';

select set_config('t.cat', tests.create_channel(null, 'category', 'T230cat')::text, true);
select set_config('t.c', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't230')::text, true);

-- ===== message events =====
select set_config('t.m1', gen_random_uuid()::text, true);
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links)
  values (current_setting('t.m1')::uuid, current_setting('t.c')::uuid, current_setting('t.x')::uuid, tests.td('uno'), 'uno', false);
select is(tests.ev('message_created', current_setting('t.m1')::uuid), 1, 'insert emits message_created');
select ok((select payload = jsonb_build_object('id', current_setting('t.m1'), 'channel_id', current_setting('t.c'), 'thread_root_id', null)
           from realtime.messages where event = 'message_created' and payload->>'id' = current_setting('t.m1')),
  'payload is exactly {id, channel_id, thread_root_id}');
select ok((select m.topic = 'channel:' || current_setting('t.c') and m.private
           from realtime.messages m where m.event = 'message_created' and m.payload->>'id' = current_setting('t.m1')),
  'sent to the private channel topic');

select set_config('t.r1', gen_random_uuid()::text, true);
insert into public.messages (id, channel_id, thread_root_id, author_id, body, body_text, allow_links)
  values (current_setting('t.r1')::uuid, current_setting('t.c')::uuid, current_setting('t.m1')::uuid, current_setting('t.x')::uuid, tests.td('resp'), 'resp', false);
select is((select payload->>'thread_root_id' from realtime.messages where event = 'message_created' and payload->>'id' = current_setting('t.r1')),
  current_setting('t.m1'), 'reply event carries thread_root_id');

update public.messages set reply_count = 1 where id = current_setting('t.m1')::uuid;
select is(tests.ev('message_updated', current_setting('t.m1')::uuid), 1, 'reply_count change emits message_updated for the root');

update public.messages set body = tests.td('uno2'), body_text = 'uno2', edited_at = now() where id = current_setting('t.m1')::uuid;
select is(tests.ev('message_updated', current_setting('t.m1')::uuid), 2, 'edit emits message_updated');

update public.messages set pinned_at = now(), pinned_by = current_setting('t.m')::uuid where id = current_setting('t.m1')::uuid;
select is(tests.ev('message_pinned', current_setting('t.m1')::uuid), 1, 'pin emits message_pinned');
select is(tests.ev('message_updated', current_setting('t.m1')::uuid), 2, 'a pin change is not also message_updated');

-- reactions
insert into public.message_reactions (message_id, member_id, emoji)
  values (current_setting('t.m1')::uuid, current_setting('t.m')::uuid, 'x1');
select is(tests.ev('reaction_changed', current_setting('t.m1')::uuid), 1, 'reaction insert emits reaction_changed with the message id');
select ok((select payload = jsonb_build_object('id', current_setting('t.m1'), 'channel_id', current_setting('t.c'), 'thread_root_id', null)
           from realtime.messages where event = 'reaction_changed' and payload->>'id' = current_setting('t.m1')),
  'reaction payload is exactly {id, channel_id, thread_root_id}');
delete from public.message_reactions where message_id = current_setting('t.m1')::uuid;
select is(tests.ev('reaction_changed', current_setting('t.m1')::uuid), 2, 'reaction delete emits reaction_changed');

-- soft delete
update public.messages set deleted_at = now(), deleted_by = current_setting('t.x')::uuid, body = '{}', body_text = ''
  where id = current_setting('t.m1')::uuid;
select is(tests.ev('message_deleted', current_setting('t.m1')::uuid), 1, 'soft delete emits message_deleted');
select is(tests.ev('message_updated', current_setting('t.m1')::uuid), 2, 'soft delete is not also message_updated');

-- hard delete
delete from public.messages where id = current_setting('t.r1')::uuid;
select is(tests.ev('message_deleted', current_setting('t.r1')::uuid), 1, 'hard delete emits message_deleted');

-- hard delete of a message with reactions: cascaded reaction deletes emit nothing for a vanished message
select set_config('t.m2', gen_random_uuid()::text, true);
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links)
  values (current_setting('t.m2')::uuid, current_setting('t.c')::uuid, current_setting('t.x')::uuid, tests.td('dos'), 'dos', false);
insert into public.message_reactions (message_id, member_id, emoji)
  values (current_setting('t.m2')::uuid, current_setting('t.m')::uuid, 'x1');
delete from public.messages where id = current_setting('t.m2')::uuid;
select is(tests.ev('message_deleted', current_setting('t.m2')::uuid), 1, 'hard delete with reactions emits message_deleted once');
select is(tests.ev('reaction_changed', current_setting('t.m2')::uuid), 1, 'cascaded reaction delete does not emit (only the insert did)');

-- ===== set_pinned no-op =====
select set_config('t.m3', gen_random_uuid()::text, true);
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links)
  values (current_setting('t.m3')::uuid, current_setting('t.c')::uuid, current_setting('t.x')::uuid, tests.td('tres'), 'tres', false);
select tests.authenticate_as(current_setting('t.um')::uuid);
select public.set_pinned(current_setting('t.m3')::uuid, false);
select tests.clear_authentication();
select is((select count(*)::int from public.audit_log where target_id = current_setting('t.m3')::uuid), 0, 'unpin of an unpinned message: no audit');
select is(tests.ev('message_pinned', current_setting('t.m3')::uuid), 0, 'unpin of an unpinned message: no event');
select tests.authenticate_as(current_setting('t.um')::uuid);
select public.set_pinned(current_setting('t.m3')::uuid, true);
select public.set_pinned(current_setting('t.m3')::uuid, true);
select tests.clear_authentication();
select is((select count(*)::int from public.audit_log where target_id = current_setting('t.m3')::uuid), 1, 'pin twice: one audit row');
select is(tests.ev('message_pinned', current_setting('t.m3')::uuid), 1, 'pin twice: one event');

-- ===== channel delete cascades emit no per-message events (Task 5 review) =====
select set_config('t.cd', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't230del')::text, true);
insert into public.messages (channel_id, author_id, body, body_text, allow_links)
  select current_setting('t.cd')::uuid, current_setting('t.x')::uuid, tests.td('c' || g), 'c' || g, false from generate_series(1, 3) g;
delete from public.channels where id = current_setting('t.cd')::uuid;
select is((select count(*)::int from realtime.messages m where m.event = 'message_deleted' and m.payload->>'channel_id' = current_setting('t.cd')),
  0, 'deleting a channel with 3 messages emits no message_deleted events');

select * from finish();
rollback;
