begin;
select plan(43);

-- structure
select has_table('public', 'messages', 'messages exists');
select has_table('public', 'message_attachments', 'message_attachments exists');
select has_table('public', 'message_reactions', 'message_reactions exists');
select has_table('public', 'message_mentions', 'message_mentions exists');
select has_table('public', 'alpha_details', 'alpha_details exists');
select has_table('public', 'channel_reads', 'channel_reads exists');
select has_index('public', 'messages', 'messages_channel_created_idx', 'channel feed index');
select has_index('public', 'messages', 'messages_thread_idx', 'thread index');
select has_index('public', 'messages', 'messages_author_idx', 'author index');
select ok((select relrowsecurity from pg_class where oid = 'public.messages'::regclass), 'messages RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.channel_reads'::regclass), 'channel_reads RLS on');
select ok(not has_table_privilege('authenticated', 'public.messages', 'INSERT'), 'authenticated cannot insert messages');
select ok(not has_table_privilege('authenticated', 'public.message_reactions', 'UPDATE'), 'authenticated cannot update reactions');
select ok(not has_table_privilege('authenticated', 'public.channel_reads', 'DELETE'), 'authenticated cannot delete channel_reads');
select ok(not has_table_privilege('anon', 'public.messages', 'SELECT'), 'anon cannot select messages');

-- fixtures
select set_config('t.a', tests.create_member('0x00000000000000000000000000000000000b0001', null, true)::text, true);
select set_config('t.b', tests.create_member('0x00000000000000000000000000000000000b0002', current_setting('t.a')::uuid)::text, true);
select set_config('t.catH', tests.create_channel(null, 'category', 'Oculta200')::text, true);
select set_config('t.txtH', tests.create_channel(current_setting('t.catH')::uuid, 'text', 'oculto200')::text, true);
select set_config('t.catV', tests.create_channel(null, 'category', 'Visible200')::text, true);
select set_config('t.txtV', tests.create_channel(current_setting('t.catV')::uuid, 'text', 'visible200')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  select current_setting('t.catH')::uuid, 'role', id, 0, 1 from public.roles where is_everyone;

insert into public.messages (id, channel_id, author_id, body, body_text, allow_links) values
  ('00000000-0000-0000-0000-0000000000a1', current_setting('t.txtH')::uuid, current_setting('t.a')::uuid, '{}', 'oculto', false),
  ('00000000-0000-0000-0000-0000000000a2', current_setting('t.txtV')::uuid, current_setting('t.a')::uuid, '{}', 'visible', false);
insert into public.message_attachments (message_id, storage_path, mime, size_bytes) values
  ('00000000-0000-0000-0000-0000000000a1', 'p/h.png', 'image/png', 10),
  ('00000000-0000-0000-0000-0000000000a2', 'p/v.png', 'image/png', 10);
insert into public.message_reactions (message_id, member_id, emoji) values
  ('00000000-0000-0000-0000-0000000000a1', current_setting('t.a')::uuid, 'x'),
  ('00000000-0000-0000-0000-0000000000a2', current_setting('t.a')::uuid, 'x');
insert into public.message_mentions (message_id, kind, target_id, notify) values
  ('00000000-0000-0000-0000-0000000000a1', 'everyone', null, false),
  ('00000000-0000-0000-0000-0000000000a2', 'everyone', null, false);
insert into public.alpha_details (message_id, contract_address) values
  ('00000000-0000-0000-0000-0000000000a1', '0x' || repeat('a', 40)),
  ('00000000-0000-0000-0000-0000000000a2', '0x' || repeat('b', 40));
insert into public.channel_reads (member_id, channel_id) values
  (current_setting('t.a')::uuid, current_setting('t.txtV')::uuid),
  (current_setting('t.b')::uuid, current_setting('t.txtV')::uuid);

-- constraints (as postgres)
select throws_ok($$insert into public.messages (channel_id, author_id, body, body_text, allow_links, kind)
  values (current_setting('t.txtV')::uuid, current_setting('t.a')::uuid, '{}', 'x', false, 'bogus')$$, '23514', null, 'bad kind rejected');
select throws_ok($$insert into public.messages (channel_id, author_id, body, body_text, allow_links)
  values (current_setting('t.txtV')::uuid, current_setting('t.a')::uuid, '{}', repeat('x', 20001), false)$$, '23514', null, 'body_text over 20000 rejected');
select throws_ok($$insert into public.message_attachments (message_id, storage_path, mime, size_bytes)
  values ('00000000-0000-0000-0000-0000000000a2', 'p/z.svg', 'image/svg+xml', 10)$$, '23514', null, 'svg rejected');
select throws_ok($$insert into public.message_attachments (message_id, storage_path, mime, size_bytes)
  values ('00000000-0000-0000-0000-0000000000a2', 'p/z.png', 'image/png', 5242881)$$, '23514', null, 'oversize rejected');
select throws_ok($$insert into public.message_reactions (message_id, member_id, emoji)
  values ('00000000-0000-0000-0000-0000000000a2', current_setting('t.b')::uuid, repeat('x', 33))$$, '23514', null, 'emoji over 32 bytes rejected');
select throws_ok($$insert into public.message_mentions (message_id, kind, target_id, notify)
  values ('00000000-0000-0000-0000-0000000000a2', 'member', null, false)$$, '23514', null, 'member mention needs target');
select throws_ok($$insert into public.alpha_details (message_id, contract_address)
  values ('00000000-0000-0000-0000-0000000000a2', '0xABC')$$, '23514', null, 'bad address rejected');

select throws_ok($$insert into public.messages (channel_id, thread_root_id, author_id, body, body_text, allow_links)
  values (current_setting('t.txtH')::uuid, '00000000-0000-0000-0000-0000000000a2', current_setting('t.a')::uuid, '{}', 'x', false)$$, '23503', null, 'cross-channel thread root rejected');
select throws_ok($$insert into public.messages (channel_id, quoted_message_id, author_id, body, body_text, allow_links)
  values (current_setting('t.txtH')::uuid, '00000000-0000-0000-0000-0000000000a2', current_setting('t.a')::uuid, '{}', 'x', false)$$, '23503', null, 'cross-channel quote rejected');
select lives_ok($$insert into public.messages (channel_id, thread_root_id, author_id, body, body_text, allow_links)
  values (current_setting('t.txtV')::uuid, '00000000-0000-0000-0000-0000000000a2', current_setting('t.a')::uuid, '{}', 'x', false)$$, 'same-channel reply ok');
select throws_ok($$insert into public.messages (channel_id, author_id, body, body_text, allow_links)
  values (current_setting('t.txtV')::uuid, current_setting('t.a')::uuid, '{}', repeat('x', 4001), false)$$, '23514', null, 'compact over 4000 rejected');
select throws_ok($$insert into public.messages (channel_id, author_id, body, body_text, allow_links)
  values (current_setting('t.txtV')::uuid, current_setting('t.a')::uuid, jsonb_build_object('k', repeat('x', 65600)), 'x', false)$$, '23514', null, 'json over 64KB rejected');
select throws_ok($$insert into public.messages (channel_id, author_id, body, body_text, allow_links, reply_count)
  values (current_setting('t.txtV')::uuid, current_setting('t.a')::uuid, '{}', 'x', false, -1)$$, '23514', null, 'negative reply_count rejected');
select throws_ok($$insert into public.message_mentions (message_id, kind, target_id, notify)
  values ('00000000-0000-0000-0000-0000000000a2', 'everyone', null, false)$$, '23505', null, 'duplicate everyone mention rejected');
select throws_ok($$insert into public.message_mentions (message_id, kind, target_id, notify)
  values ('00000000-0000-0000-0000-0000000000a2', 'everyone', gen_random_uuid(), false)$$, '23514', null, 'everyone with target rejected');
select throws_ok($$insert into public.alpha_details (message_id, contract_address)
  values ('00000000-0000-0000-0000-0000000000a1', '0x' || repeat('A', 40))$$, '23514', null, 'mixed-case address rejected');
select is((select count(*)::int from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'
    and table_name in ('messages','message_attachments','message_reactions','message_mentions','alpha_details','channel_reads')
    and privilege_type in ('INSERT','UPDATE','DELETE')), 0, 'no authenticated write grants on message tables');

-- RLS: member b (no VIEW on hidden)
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.b')::uuid));
select is((select count(*)::int from public.messages where channel_id = current_setting('t.txtH')::uuid), 0, 'no VIEW: 0 messages in hidden');
select is((select count(*)::int from public.message_attachments), 1, 'no VIEW: only visible attachment');
select is((select count(*)::int from public.message_reactions), 1, 'no VIEW: only visible reaction');
select is((select count(*)::int from public.message_mentions), 1, 'no VIEW: only visible mention');
select is((select count(*)::int from public.alpha_details), 1, 'no VIEW: only visible alpha');
select is((select count(*)::int from public.messages where id = '00000000-0000-0000-0000-0000000000a2'), 1, 'VIEW: sees visible message');
select is((select count(*)::int from public.channel_reads), 1, 'channel_reads: only own');
select is((select member_id from public.channel_reads), current_setting('t.b')::uuid, 'channel_reads row is own');
select throws_ok($$insert into public.messages (channel_id, author_id, body, body_text, allow_links)
  values (current_setting('t.txtV')::uuid, current_setting('t.b')::uuid, '{}', 'x', false)$$, '42501', null, 'direct insert denied');
select tests.clear_authentication();

-- anon
set local role anon;
select throws_ok($$select count(*) from public.messages$$, '42501', null, 'anon denied on messages');
select throws_ok($$select count(*) from public.channel_reads$$, '42501', null, 'anon denied on channel_reads');
reset role;

select * from finish();
rollback;
