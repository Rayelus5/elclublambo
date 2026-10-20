begin;
set local client_min_messages = warning;
select plan(149);

-- helpers (rolled back with the test); they run as the invoking role, the RPCs under test are the definers
create function tests.td(p_text text) returns jsonb language sql as $$
  select case when p_text is null or p_text = '' then '{"type":"doc","content":[]}'::jsonb
    else jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
      'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text))))) end
$$;
create function tests.post(
  p_ch uuid, p_text text default 'hola', p_root uuid default null, p_expanded boolean default false,
  p_quoted uuid default null, p_att jsonb default '[]'::jsonb, p_body jsonb default null
) returns uuid language sql as $$
  select public.post_message(p_ch,
    coalesce(p_body, tests.td(p_text)), p_text, p_expanded, p_root, p_quoted, p_att)
$$;
create function tests.mn(p_kind text, p_id text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('kind', p_kind, 'id', p_id))
$$;
create function tests.mdoc(variadic p_nodes jsonb[]) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', to_jsonb(p_nodes))))
$$;
create function tests.att(p_ch uuid, p_member uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_path text := p_ch || '/' || p_member || '/' || gen_random_uuid() || '.png';
begin
  -- the post RPC verifies the object exists in storage (F2b task 6)
  insert into storage.objects (bucket_id, name, metadata)
    values ('chat-images', v_path, jsonb_build_object('mimetype', 'image/png', 'size', 1234));
  return jsonb_build_array(jsonb_build_object('path', v_path, 'mime', 'image/png', 'size', 1234, 'width', 10, 'height', 10));
end
$$;

-- privileges
select ok(not has_function_privilege('anon', 'public.post_message(uuid,jsonb,text,boolean,uuid,uuid,jsonb,uuid)', 'execute'), 'anon cannot post_message');
select ok(has_function_privilege('authenticated', 'public.post_message(uuid,jsonb,text,boolean,uuid,uuid,jsonb,uuid)', 'execute'), 'authenticated can post_message');
select ok(not has_function_privilege('authenticated', 'public.post_message_as(uuid,uuid,jsonb,text,boolean,uuid,uuid,jsonb,text)', 'execute'), 'authenticated cannot post_message_as');
select ok(not has_function_privilege('anon', 'public.post_message_as(uuid,uuid,jsonb,text,boolean,uuid,uuid,jsonb,text)', 'execute'), 'anon cannot post_message_as');
select ok(has_function_privilege('service_role', 'public.post_message_as(uuid,uuid,jsonb,text,boolean,uuid,uuid,jsonb,text)', 'execute'), 'service_role can post_message_as');
select ok(not has_function_privilege('authenticated', 'public._post_message_core(uuid,uuid,jsonb,text,boolean,uuid,uuid,jsonb,text,uuid)', 'execute'), 'authenticated cannot core');
select ok(not has_function_privilege('service_role', 'public._post_message_core(uuid,uuid,jsonb,text,boolean,uuid,uuid,jsonb,text,uuid)', 'execute'), 'service_role cannot core');
select ok(not has_function_privilege('anon', 'public.edit_message(uuid,jsonb,text)', 'execute'), 'anon cannot edit_message');
select ok(not has_function_privilege('anon', 'public.delete_message(uuid)', 'execute'), 'anon cannot delete_message');
select ok(has_function_privilege('authenticated', 'public.my_slowmode_remaining(uuid)', 'execute'), 'authenticated can my_slowmode_remaining');

-- fixtures
select set_config('t.a', tests.create_member('0x' || lpad('d2100', 40, '0'), null, true)::text, true);
select set_config('t.u', tests.create_member('0x' || lpad('d2101', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.e', tests.create_member('0x' || lpad('d2102', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.m', tests.create_member('0x' || lpad('d2103', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.w', tests.create_member('0x' || lpad('d2104', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.n', tests.create_member('0x' || lpad('d2105', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.s', tests.create_member('0x' || lpad('d2106', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.r', tests.create_member('0x' || lpad('d2107', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('d2108', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('d2109', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ban', tests.create_member('0x' || lpad('d210a', 40, '0'), current_setting('t.a')::uuid)::text, true);
update public.members set status = 'banned' where id = current_setting('t.ban')::uuid;
select set_config('t.uu', (select auth_user_id::text from public.members where id = current_setting('t.u')::uuid), true);
select set_config('t.ue', (select auth_user_id::text from public.members where id = current_setting('t.e')::uuid), true);
select set_config('t.um', (select auth_user_id::text from public.members where id = current_setting('t.m')::uuid), true);
select set_config('t.uw', (select auth_user_id::text from public.members where id = current_setting('t.w')::uuid), true);
select set_config('t.un', (select auth_user_id::text from public.members where id = current_setting('t.n')::uuid), true);
select set_config('t.us', (select auth_user_id::text from public.members where id = current_setting('t.s')::uuid), true);
select set_config('t.ur', (select auth_user_id::text from public.members where id = current_setting('t.r')::uuid), true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ux', (select auth_user_id::text from public.members where id = current_setting('t.x')::uuid), true);

insert into public.roles (name, color, position, permissions) values
  ('T210 power', '#AAAAAA', 61, 1024 | 2048 | 4096),
  ('T210 mod', '#BBBBBB', 62, 8);
select set_config('t.rolePower', (select id::text from public.roles where name = 'T210 power'), true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.e')::uuid, id from public.roles where name = 'T210 power';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.m')::uuid, id from public.roles where name = 'T210 mod';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where is_system;

select set_config('t.cat', tests.create_channel(null, 'category', 'T210cat')::text, true);
select set_config('t.txt', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't210txt')::text, true);
select set_config('t.txt2', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't210txt2')::text, true);
select set_config('t.slow', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't210slow')::text, true);
select set_config('t.alpha', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't210alpha')::text, true);
select set_config('t.forum', tests.create_channel(current_setting('t.cat')::uuid, 'forum', 't210forum')::text, true);
select set_config('t.del', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't210del')::text, true);
select set_config('t.catH', tests.create_channel(null, 'category', 'T210hid')::text, true);
select set_config('t.txtH', tests.create_channel(current_setting('t.catH')::uuid, 'text', 't210hid')::text, true);
update public.channels set slowmode_seconds = 60 where id = current_setting('t.slow')::uuid;
update public.channels set alpha_enabled = true where id = current_setting('t.alpha')::uuid;
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
  (current_setting('t.catH')::uuid, 'role', (select id from public.roles where is_everyone), 0, 1),
  (current_setting('t.txt')::uuid, 'member', current_setting('t.n')::uuid, 0, 6),
  (current_setting('t.txt')::uuid, 'member', current_setting('t.s')::uuid, 0, 4),
  (current_setting('t.txt')::uuid, 'member', current_setting('t.r')::uuid, 0, 2);

-- ===== permissions =====
select tests.authenticate_as(current_setting('t.uu')::uuid);
select set_config('t.root1', tests.post(current_setting('t.txt')::uuid, 'primero')::text, true);
select tests.clear_authentication();
select is((select author_id from public.messages where id = current_setting('t.root1')::uuid), current_setting('t.u')::uuid, 'post stores the caller as author');
select is((select kind from public.messages where id = current_setting('t.root1')::uuid), 'text', 'post kind is text');
select is((select allow_links from public.messages where id = current_setting('t.root1')::uuid), false, 'plain member: allow_links false');

select tests.authenticate_as(current_setting('t.un')::uuid);
select throws_ok($$select tests.post(current_setting('t.txt')::uuid)$$, 'P0001', 'forbidden', 'no SEND_MESSAGES: forbidden');
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, 'x', current_setting('t.root1')::uuid)$$, 'P0001', 'forbidden', 'no SEND/THREADS: reply forbidden');
select tests.authenticate_as(current_setting('t.us')::uuid);
select lives_ok($$select tests.post(current_setting('t.txt')::uuid, 'solo raiz')$$, 'SEND without THREADS: can post root');
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, 'x', current_setting('t.root1')::uuid)$$, 'P0001', 'forbidden', 'SEND without THREADS: reply forbidden');
select tests.authenticate_as(current_setting('t.ur')::uuid);
select throws_ok($$select tests.post(current_setting('t.txt')::uuid)$$, 'P0001', 'forbidden', 'THREADS without SEND: root forbidden');
select lives_ok($$select tests.post(current_setting('t.txt')::uuid, 'respuesta', current_setting('t.root1')::uuid)$$, 'THREADS without SEND: reply ok');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select throws_ok($$select tests.post(current_setting('t.txtH')::uuid)$$, 'P0001', 'forbidden', 'hidden channel: forbidden');
select throws_ok($$select tests.post(gen_random_uuid())$$, 'P0001', 'forbidden', 'missing channel: forbidden');
select throws_ok($$select tests.post(current_setting('t.forum')::uuid)$$, 'P0001', 'invalid_input', 'forum channel: invalid_input');
select throws_ok($$select tests.post(current_setting('t.cat')::uuid)$$, 'P0001', 'invalid_input', 'category channel: invalid_input');
select tests.authenticate_as(gen_random_uuid());
select throws_ok($$select tests.post(current_setting('t.txt')::uuid)$$, 'P0001', 'forbidden', 'non member: forbidden');
select tests.clear_authentication();

-- ===== threads =====
select tests.authenticate_as(current_setting('t.uu')::uuid);
select set_config('t.reply1', tests.post(current_setting('t.txt')::uuid, 'r1', current_setting('t.root1')::uuid)::text, true);
select throws_ok($$select tests.post(current_setting('t.txt2')::uuid, 'x', current_setting('t.root1')::uuid)$$, 'P0001', 'thread_invalid', 'reply to a root of another channel: thread_invalid');
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, 'x', current_setting('t.reply1')::uuid)$$, 'P0001', 'thread_invalid', 'reply to a reply: thread_invalid');
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, 'x', gen_random_uuid())$$, 'P0001', 'thread_invalid', 'reply to a missing root: thread_invalid');
select tests.clear_authentication();
select is((select reply_count from public.messages where id = current_setting('t.root1')::uuid), 2, 'root reply_count counts both replies');
select ok((select last_reply_at is not null from public.messages where id = current_setting('t.root1')::uuid), 'root last_reply_at set');
select is((select thread_root_id from public.messages where id = current_setting('t.reply1')::uuid), current_setting('t.root1')::uuid, 'reply points to its root');

-- ===== content limits and quotes =====
select tests.authenticate_as(current_setting('t.uu')::uuid);
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, repeat('x', 4001))$$, 'P0001', 'too_long', 'compact over 4000: too_long');
select lives_ok($$select tests.post(current_setting('t.txt')::uuid, repeat('x', 4001), null, true)$$, 'expanded over 4000 ok');
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, repeat('x', 20001), null, true)$$, 'P0001', 'too_long', 'expanded over 20000: too_long');
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, 'x', null, false, null, '[]', jsonb_build_object('type', 'doc', 'pad', repeat('x', 65600)))$$,
  'P0001', 'too_long', 'json over 64KB: too_long');
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, '   ')$$, 'P0001', 'invalid_input', 'empty text without attachments: invalid_input');
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, null)$$, 'P0001', 'invalid_input', 'null text: invalid_input');
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, 'x', null, false, null, '[]', '[]'::jsonb)$$, 'P0001', 'invalid_input', 'non-object body: invalid_input');
select lives_ok($$select tests.post(current_setting('t.txt')::uuid, 'cita', null, false, current_setting('t.root1')::uuid)$$, 'quote of a message of the same channel ok');
select throws_ok($$select tests.post(current_setting('t.txt2')::uuid, 'cita', null, false, current_setting('t.root1')::uuid)$$, 'P0001', 'invalid_input', 'quote of another channel: invalid_input');
select throws_ok($$select tests.post(current_setting('t.txt')::uuid, 'cita', null, false, gen_random_uuid())$$, 'P0001', 'invalid_input', 'quote of a missing message: invalid_input');
select tests.clear_authentication();
select is((select quoted_message_id from public.messages where body_text = 'cita'), current_setting('t.root1')::uuid, 'quote stored');

-- ===== slowmode =====
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(public.my_slowmode_remaining(current_setting('t.txt')::uuid), 0, 'no slowmode channel: 0');
select set_config('t.slowroot', tests.post(current_setting('t.slow')::uuid, 'lento')::text, true);
select throws_ok($$select tests.post(current_setting('t.slow')::uuid, 'otra')$$, 'P0001', 'slowmode', 'second post inside the window: slowmode');
do $$
declare v_detail text;
begin
  begin
    perform tests.post(current_setting('t.slow')::uuid, 'otra');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  perform set_config('t.detail', coalesce(v_detail, 'none'), true);
end $$;
select ok(current_setting('t.detail') ~ '^[0-9]+$' and current_setting('t.detail')::int between 1 and 60, 'slowmode DETAIL carries the remaining seconds');
select ok(public.my_slowmode_remaining(current_setting('t.slow')::uuid) between 1 and 60, 'my_slowmode_remaining reports it');
select lives_ok($$select public.edit_message(current_setting('t.slowroot')::uuid, tests.td('editado'), 'editado')$$, 'edits are not rate limited');
select tests.authenticate_as(current_setting('t.uw')::uuid);
select lives_ok($$select tests.post(current_setting('t.slow')::uuid, 'hilo', current_setting('t.slowroot')::uuid)$$, 'first reply of w ok');
select throws_ok($$select tests.post(current_setting('t.slow')::uuid, 'raiz')$$, 'P0001', 'slowmode', 'a thread reply counts for slowmode');
select tests.authenticate_as(current_setting('t.um')::uuid);
select lives_ok($$select tests.post(current_setting('t.slow')::uuid, 'mod 1')$$, 'MANAGE_MESSAGES: first post');
select lives_ok($$select tests.post(current_setting('t.slow')::uuid, 'mod 2')$$, 'MANAGE_MESSAGES: exempt from slowmode');
select is(public.my_slowmode_remaining(current_setting('t.slow')::uuid), 0, 'MANAGE_MESSAGES: remaining 0');
select tests.clear_authentication();
update public.member_channel_last_post set last_post_at = now() - interval '61 seconds' where member_id = current_setting('t.u')::uuid;
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(public.my_slowmode_remaining(current_setting('t.slow')::uuid), 0, 'window elapsed: remaining 0');
select lives_ok($$select tests.post(current_setting('t.slow')::uuid, 'ya puedo')$$, 'window elapsed: can post again');
select tests.clear_authentication();
-- remaining is clamped to the channel's slowmode_seconds even with a future timestamp
update public.member_channel_last_post set last_post_at = now() + interval '1 hour'
  where member_id = current_setting('t.u')::uuid and channel_id = current_setting('t.slow')::uuid;
select is(public._slowmode_remaining(current_setting('t.u')::uuid, current_setting('t.slow')::uuid), 60, 'remaining is clamped to slowmode_seconds');
-- deleting your own message does not reset the window
select tests.authenticate_as(current_setting('t.ux')::uuid);
select set_config('t.xslow', tests.post(current_setting('t.slow')::uuid, 'x1')::text, true);
select public.delete_message(current_setting('t.xslow')::uuid);
select throws_ok($$select tests.post(current_setting('t.slow')::uuid, 'x2')$$, 'P0001', 'slowmode', 'post, delete, post: slowmode still applies');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where id = current_setting('t.xslow')::uuid), 0, 'the deleted message is really gone');
select ok(not has_table_privilege('authenticated', 'public.member_channel_last_post', 'SELECT'), 'authenticated cannot read member_channel_last_post');
select ok(not has_table_privilege('anon', 'public.member_channel_last_post', 'SELECT'), 'anon cannot read member_channel_last_post');
select ok((select relrowsecurity from pg_class where oid = 'public.member_channel_last_post'::regclass), 'member_channel_last_post RLS on');
-- my_slowmode_remaining reveals nothing for channels the caller cannot view
update public.channels set slowmode_seconds = 60 where id = current_setting('t.txtH')::uuid;
insert into public.member_channel_last_post (member_id, channel_id, last_post_at)
  values (current_setting('t.u')::uuid, current_setting('t.txtH')::uuid, now());
select is(public._slowmode_remaining(current_setting('t.u')::uuid, current_setting('t.txtH')::uuid), 60, 'fixture: slowmode active in the hidden channel');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(public.my_slowmode_remaining(current_setting('t.txtH')::uuid), 0, 'my_slowmode_remaining is 0 without VIEW');
select tests.clear_authentication();

-- ===== body_text is derived server-side =====
select tests.authenticate_as(current_setting('t.uu')::uuid);
select set_config('t.derived', public.post_message(current_setting('t.txt')::uuid, tests.td('texto real'), 'texto falso', false, null, null, '[]')::text, true);
select tests.clear_authentication();
select is((select body_text from public.messages where id = current_setting('t.derived')::uuid), 'texto real', 'mismatched p_body_text is ignored');
select is(public._doc_text(jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
  jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
    jsonb_build_object('type', 'text', 'text', 'uno'), jsonb_build_object('type', 'hardBreak'),
    jsonb_build_object('type', 'text', 'text', 'dos'))),
  jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
    jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('kind', 'member', 'id', 'x', 'label', 'ana')),
    jsonb_build_object('type', 'text', 'text', ' hola'))),
  jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(tests.mn('everyone', null)))))),
  E'uno\ndos\n@ana hola\n@', '_doc_text: text, hardBreak, mention label and block separators');
select is(public._doc_text('{"type":"doc","content":[]}'), '', '_doc_text: empty doc');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select throws_ok($$select public.post_message(current_setting('t.txt')::uuid, tests.td(repeat('x', 4001)), 'x', false, null, null, '[]')$$,
  'P0001', 'too_long', 'big body with tiny p_body_text: too_long in compact mode');
select lives_ok($$select public.post_message(current_setting('t.txt')::uuid, tests.td(repeat('x', 4001)), 'x', true, null, null, '[]')$$, 'the same body is fine expanded');
select throws_ok($$select public.post_message(current_setting('t.txt')::uuid, tests.td(repeat('x', 20001)), 'x', true, null, null, '[]')$$,
  'P0001', 'too_long', 'derived text over 20000 even expanded: too_long');
select throws_ok($$select public.post_message(current_setting('t.txt')::uuid, '{"type":"doc","content":[]}', 'texto no vacio', false, null, null, '[]')$$,
  'P0001', 'invalid_input', 'empty doc with non-empty p_body_text: invalid_input');
select throws_ok(format($q$select public.edit_message(%L::uuid, '{"type":"doc","content":[]}', 'texto no vacio')$q$, current_setting('t.derived')),
  'P0001', 'invalid_input', 'edit to an empty doc with text: invalid_input');
select throws_ok(format($q$select public.edit_message(%L::uuid, tests.td(repeat('x', 4001)), 'x')$q$, current_setting('t.derived')),
  'P0001', 'too_long', 'edit: big body with tiny p_body_text: too_long');
select lives_ok(format($q$select public.edit_message(%L::uuid, tests.td('nuevo'), 'otro')$q$, current_setting('t.derived')), 'edit with a mismatched p_body_text');
select tests.clear_authentication();
select is((select body_text from public.messages where id = current_setting('t.derived')::uuid), 'nuevo', 'edit stores the derived text');
select ok(not has_function_privilege('authenticated', 'public._doc_text(jsonb)', 'execute'), 'authenticated cannot _doc_text');
select ok(not has_function_privilege('anon', 'public._doc_text(jsonb)', 'execute'), 'anon cannot _doc_text');

-- ===== links =====
select tests.authenticate_as(current_setting('t.ue')::uuid);
select set_config('t.eroot', tests.post(current_setting('t.txt')::uuid, 'con enlace')::text, true);
select tests.clear_authentication();
select is((select allow_links from public.messages where id = current_setting('t.eroot')::uuid), true, 'EMBED_LINKS: allow_links true');

-- ===== attachments =====
select tests.authenticate_as(current_setting('t.uu')::uuid);
select throws_ok(format($q$select tests.post(%L::uuid, 'img', null, false, null, tests.att(%L::uuid, %L::uuid))$q$,
  current_setting('t.txt'), current_setting('t.txt'), current_setting('t.u')), 'P0001', 'forbidden', 'no ATTACH_FILES: forbidden');
select tests.authenticate_as(current_setting('t.ue')::uuid);
select set_config('t.eatt', tests.post(current_setting('t.txt')::uuid, 'foto', null, false, null,
  tests.att(current_setting('t.txt')::uuid, current_setting('t.e')::uuid))::text, true);
select throws_ok(format($q$select tests.post(%L::uuid, 'img', null, false, null, tests.att(%L::uuid, %L::uuid))$q$,
  current_setting('t.txt'), current_setting('t.txt'), current_setting('t.u')), 'P0001', 'forbidden', 'path in another member folder: forbidden');
select throws_ok(format($q$select tests.post(%L::uuid, 'img', null, false, null, tests.att(%L::uuid, %L::uuid))$q$,
  current_setting('t.txt'), current_setting('t.txt2'), current_setting('t.e')), 'P0001', 'forbidden', 'path in another channel folder: forbidden');
select throws_ok(format($q$select tests.post(%L::uuid, 'img', null, false, null,
  jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || upper(gen_random_uuid()::text) || '.png', 'mime', 'image/png', 'size', 10)))$q$,
  current_setting('t.txt'), current_setting('t.txt'), current_setting('t.e')), 'P0001', 'forbidden', 'uppercase uuid path: forbidden');
select throws_ok(format($q$select tests.post(%L::uuid, 'img', null, false, null,
  jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || gen_random_uuid() || '.svg', 'mime', 'image/png', 'size', 10)))$q$,
  current_setting('t.txt'), current_setting('t.txt'), current_setting('t.e')), 'P0001', 'forbidden', 'bad extension path: forbidden');
select throws_ok(format($q$select tests.post(%L::uuid, 'img', null, false, null,
  jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || gen_random_uuid() || '.png', 'mime', 'image/svg+xml', 'size', 10)))$q$,
  current_setting('t.txt'), current_setting('t.txt'), current_setting('t.e')), 'P0001', 'invalid_input', 'bad mime: invalid_input');
select throws_ok(format($q$select tests.post(%L::uuid, 'img', null, false, null,
  jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || gen_random_uuid() || '.png', 'mime', 'image/png', 'size', 5242881)))$q$,
  current_setting('t.txt'), current_setting('t.txt'), current_setting('t.e')), 'P0001', 'invalid_input', 'oversize: invalid_input');
select throws_ok(format($q$select tests.post(%L::uuid, 'img', null, false, null,
  tests.att(%L::uuid, %L::uuid) || tests.att(%L::uuid, %L::uuid) || tests.att(%L::uuid, %L::uuid) || tests.att(%L::uuid, %L::uuid) || tests.att(%L::uuid, %L::uuid))$q$,
  current_setting('t.txt'),
  current_setting('t.txt'), current_setting('t.e'), current_setting('t.txt'), current_setting('t.e'), current_setting('t.txt'), current_setting('t.e'),
  current_setting('t.txt'), current_setting('t.e'), current_setting('t.txt'), current_setting('t.e')), 'P0001', 'too_many_attachments', 'more than 4 attachments: too_many_attachments');
select lives_ok(format($q$select tests.post(%L::uuid, '', null, false, null, tests.att(%L::uuid, %L::uuid))$q$,
  current_setting('t.txt'), current_setting('t.txt'), current_setting('t.e')), 'attachment-only message (empty text) ok');
select tests.clear_authentication();
select is((select count(*)::int from public.message_attachments where message_id = current_setting('t.eatt')::uuid), 1, 'attachment row stored');
select is((select mime from public.message_attachments where message_id = current_setting('t.eatt')::uuid), 'image/png', 'attachment mime stored');

-- ===== mentions =====
select set_config('t.ghost', gen_random_uuid()::text, true);
select tests.authenticate_as(current_setting('t.uu')::uuid);
select set_config('t.mroot', tests.post(current_setting('t.txt')::uuid, 'menciones', null, false, null, '[]',
  tests.mdoc(
    tests.mn('member', current_setting('t.b')),
    tests.mn('member', current_setting('t.b')),
    tests.mn('member', current_setting('t.ghost')),
    tests.mn('member', current_setting('t.ban')),
    tests.mn('member', 'zzz'),
    tests.mn('role', current_setting('t.rolePower')),
    tests.mn('role', current_setting('t.ghost')),
    tests.mn('everyone', null),
    tests.mn('bogus', current_setting('t.b')),
    jsonb_build_object('type', 'bulletList', 'content', jsonb_build_array(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(
        jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(tests.mn('member', current_setting('t.x'))))))))
  ))::text, true);
select tests.clear_authentication();
select is((select count(*)::int from public.message_mentions where message_id = current_setting('t.mroot')::uuid), 4, 'mentions: deduped, invalid and unknown targets skipped, nested found');
select is((select notify from public.message_mentions where message_id = current_setting('t.mroot')::uuid and kind = 'member' and target_id = current_setting('t.b')::uuid), true, 'active member mention notifies');
select is((select notify from public.message_mentions where message_id = current_setting('t.mroot')::uuid and kind = 'role'), false, 'role mention without 4096: notify false');
select is((select notify from public.message_mentions where message_id = current_setting('t.mroot')::uuid and kind = 'everyone'), false, 'everyone mention without 4096: notify false');
select is((select count(*)::int from public.message_mentions where message_id = current_setting('t.mroot')::uuid and target_id in (current_setting('t.ghost')::uuid, current_setting('t.ban')::uuid)), 0, 'ghost and banned members are skipped');
select tests.authenticate_as(current_setting('t.ue')::uuid);
select set_config('t.mroot2', tests.post(current_setting('t.txt')::uuid, 'menciones e', null, false, null, '[]',
  tests.mdoc(tests.mn('role', current_setting('t.rolePower')), tests.mn('everyone', null)))::text, true);
select tests.clear_authentication();
select is((select count(*)::int from public.message_mentions where message_id = current_setting('t.mroot2')::uuid and notify), 2, 'role and everyone with 4096: notify true');
-- cap of 50 mentions
select set_config('t.manyids', (select jsonb_agg(m.id)::text from (
  select tests.create_member('0x' || lpad('d3' || lpad(i::text, 3, '0'), 40, '0'), current_setting('t.a')::uuid) as id
  from generate_series(1, 55) i) m), true);
select tests.authenticate_as(current_setting('t.uu')::uuid);
select set_config('t.mcap', tests.post(current_setting('t.txt')::uuid, 'muchas', null, false, null, '[]',
  jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph', 'content',
    (select jsonb_agg(tests.mn('member', v #>> '{}')) from jsonb_array_elements(current_setting('t.manyids')::jsonb) v)))))::text, true);
select tests.clear_authentication();
select is((select count(*)::int from public.message_mentions where message_id = current_setting('t.mcap')::uuid), 50, 'mentions are capped at 50');

-- ===== edit =====
select tests.authenticate_as(current_setting('t.uw')::uuid);
select throws_ok(format($q$select public.edit_message(%L::uuid, tests.td('hack'), 'hack')$q$, current_setting('t.root1')), 'P0001', 'forbidden', 'editing someone else''s message: forbidden');
select tests.authenticate_as(current_setting('t.um')::uuid);
select throws_ok(format($q$select public.edit_message(%L::uuid, tests.td('hack'), 'hack')$q$, current_setting('t.root1')), 'P0001', 'forbidden', 'moderators cannot edit others either');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select throws_ok(format($q$select public.edit_message(gen_random_uuid(), tests.td('x'), 'x')$q$), 'P0001', 'forbidden', 'editing a missing message: forbidden');
select throws_ok(format($q$select public.edit_message(%L::uuid, tests.td(repeat('x', 4001)), repeat('x', 4001))$q$, current_setting('t.root1')), 'P0001', 'too_long', 'edit over the compact limit: too_long');
select throws_ok(format($q$select public.edit_message(%L::uuid, tests.td(''), '')$q$, current_setting('t.root1')), 'P0001', 'invalid_input', 'edit to empty without attachments: invalid_input');
select lives_ok(format($q$select public.edit_message(%L::uuid, %L::jsonb, 'editado')$q$, current_setting('t.mroot'),
  tests.mdoc(tests.mn('member', current_setting('t.b')))::text), 'author edits');
select tests.clear_authentication();
select is((select body_text from public.messages where id = current_setting('t.mroot')::uuid), '@', 'edit stores the derived text (mention without label)');
select ok((select edited_at is not null from public.messages where id = current_setting('t.mroot')::uuid), 'edit sets edited_at');
select is((select count(*)::int from public.message_mentions where message_id = current_setting('t.mroot')::uuid), 1, 'edit recomputes mentions');
-- allow_links is recomputed against the author's current permissions
delete from public.member_roles where member_id = current_setting('t.e')::uuid and role_id = current_setting('t.rolePower')::uuid;
select tests.authenticate_as(current_setting('t.ue')::uuid);
select lives_ok(format($q$select public.edit_message(%L::uuid, tests.td('sin permiso'), 'sin permiso')$q$, current_setting('t.eroot')), 'edit after losing EMBED_LINKS');
select tests.clear_authentication();
select is((select allow_links from public.messages where id = current_setting('t.eroot')::uuid), false, 'edit recomputes allow_links');
insert into public.member_roles (member_id, role_id) values (current_setting('t.e')::uuid, current_setting('t.rolePower')::uuid);

-- ===== alpha (post_message_as) =====
select set_config('t.addr', '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01', true);
set local role service_role;
select set_config('t.alphamsg', public.post_message_as(current_setting('t.e')::uuid, current_setting('t.alpha')::uuid,
  tests.td('mira este contrato'), 'mira este contrato', false, null, null, '[]', current_setting('t.addr'))::text, true);
select throws_ok(format($q$select public.post_message_as(%L::uuid, %L::uuid, tests.td('x'), 'x', false, null, null, '[]', %L)$q$,
  current_setting('t.e'), current_setting('t.txt'), current_setting('t.addr')), 'P0001', 'forbidden', 'alpha in a channel without alpha_enabled: forbidden');
select throws_ok(format($q$select public.post_message_as(%L::uuid, %L::uuid, tests.td('x'), 'x', false, null, null, '[]', %L)$q$,
  current_setting('t.u'), current_setting('t.alpha'), current_setting('t.addr')), 'P0001', 'forbidden', 'alpha without EMBED_LINKS: forbidden');
select throws_ok(format($q$select public.post_message_as(%L::uuid, %L::uuid, tests.td('x'), 'x', false, null, null, '[]', '0x123')$q$,
  current_setting('t.e'), current_setting('t.alpha')), 'P0001', 'invalid_input', 'alpha with a malformed address: invalid_input');
select throws_ok(format($q$select public.post_message_as(%L::uuid, %L::uuid, tests.td('x'), 'x', false, null, null, '[]', null)$q$,
  current_setting('t.e'), current_setting('t.alpha')), 'P0001', 'invalid_input', 'post_message_as without address: invalid_input');
select throws_ok(format($q$select public.post_message_as(%L::uuid, %L::uuid, tests.td('x'), 'x', false, null, null, '[]', %L)$q$,
  current_setting('t.ban'), current_setting('t.alpha'), current_setting('t.addr')), 'P0001', 'forbidden', 'banned member: forbidden');
select throws_ok(format($q$select public.post_message_as(null, %L::uuid, tests.td('x'), 'x', false, null, null, '[]', %L)$q$,
  current_setting('t.alpha'), current_setting('t.addr')), 'P0001', 'forbidden', 'null member: forbidden');
reset role;
select is((select kind from public.messages where id = current_setting('t.alphamsg')::uuid), 'alpha', 'alpha message has kind alpha');
select is((select author_id from public.messages where id = current_setting('t.alphamsg')::uuid), current_setting('t.e')::uuid, 'alpha author is p_member');
select is((select allow_links from public.messages where id = current_setting('t.alphamsg')::uuid), true, 'alpha allow_links true');
select is((select contract_address from public.alpha_details where message_id = current_setting('t.alphamsg')::uuid), lower(current_setting('t.addr')), 'alpha address stored lowercase');
select tests.authenticate_as(current_setting('t.ue')::uuid);
select lives_ok(format($q$select public.edit_message(%L::uuid, tests.td('contrato editado'), 'contrato editado')$q$, current_setting('t.alphamsg')), 'alpha author edits');
select throws_ok($$select public.post_message_as(current_setting('t.e')::uuid, current_setting('t.alpha')::uuid, tests.td('x'), 'x', false, null, null, '[]', current_setting('t.addr'))$$,
  '42501', null, 'authenticated cannot call post_message_as');
select lives_ok($$select tests.post(current_setting('t.alpha')::uuid, 'texto normal')$$, 'regular post in an alpha channel ok');
select tests.clear_authentication();
select is((select contract_address from public.alpha_details where message_id = current_setting('t.alphamsg')::uuid), lower(current_setting('t.addr')), 'alpha keeps its address after edit');
select is((select kind from public.messages where id = current_setting('t.alphamsg')::uuid), 'alpha', 'alpha keeps its kind after edit');

-- ===== delete =====
-- soft delete: root with replies
select tests.authenticate_as(current_setting('t.ue')::uuid);
select set_config('t.droot', tests.post(current_setting('t.txt')::uuid, 'raiz con hilo', null, false, null,
  tests.att(current_setting('t.txt')::uuid, current_setting('t.e')::uuid),
  tests.mdoc(tests.mn('member', current_setting('t.b'))))::text, true);
select tests.authenticate_as(current_setting('t.uu')::uuid);
select set_config('t.drep1', tests.post(current_setting('t.txt')::uuid, 'h1', current_setting('t.droot')::uuid)::text, true);
select set_config('t.drep2', tests.post(current_setting('t.txt')::uuid, 'h2', current_setting('t.droot')::uuid)::text, true);
select tests.clear_authentication();
insert into public.message_reactions (message_id, member_id, emoji) values (current_setting('t.droot')::uuid, current_setting('t.u')::uuid, 'x');
select set_config('t.dpath', (select storage_path from public.message_attachments where message_id = current_setting('t.droot')::uuid), true);
select tests.authenticate_as(current_setting('t.uw')::uuid);
select throws_ok(format($q$select public.delete_message(%L::uuid)$q$, current_setting('t.droot')), 'P0001', 'forbidden', 'non author without MANAGE_MESSAGES: forbidden');
select tests.authenticate_as(current_setting('t.ue')::uuid);
select set_config('t.dres', public.delete_message(current_setting('t.droot')::uuid)::text, true);
select tests.clear_authentication();
select is((current_setting('t.dres')::jsonb)->>'hard', 'false', 'root with replies: soft delete');
select is((current_setting('t.dres')::jsonb)->'paths', jsonb_build_array(current_setting('t.dpath')), 'soft delete returns attachment paths');
select is((select body from public.messages where id = current_setting('t.droot')::uuid), '{"type":"doc","content":[]}'::jsonb, 'soft delete empties body');
select is((select body_text from public.messages where id = current_setting('t.droot')::uuid), '', 'soft delete empties body_text');
select is((select deleted_by from public.messages where id = current_setting('t.droot')::uuid), current_setting('t.e')::uuid, 'soft delete records deleted_by');
select ok((select deleted_at is not null from public.messages where id = current_setting('t.droot')::uuid), 'soft delete records deleted_at');
select is((select count(*)::int from public.messages where thread_root_id = current_setting('t.droot')::uuid), 2, 'soft delete keeps the replies');
select is((select count(*)::int from public.message_attachments where message_id = current_setting('t.droot')::uuid)
  + (select count(*)::int from public.message_reactions where message_id = current_setting('t.droot')::uuid)
  + (select count(*)::int from public.message_mentions where message_id = current_setting('t.droot')::uuid), 0, 'soft delete removes attachments, reactions and mentions');
select tests.authenticate_as(current_setting('t.ue')::uuid);
select throws_ok(format($q$select public.delete_message(%L::uuid)$q$, current_setting('t.droot')), 'P0001', 'invalid_input', 'deleting a tombstone again: invalid_input');
select throws_ok(format($q$select public.edit_message(%L::uuid, tests.td('x'), 'x')$q$, current_setting('t.droot')), 'P0001', 'forbidden', 'editing a deleted message: forbidden');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select lives_ok(format($q$select tests.post(%L::uuid, 'responder a borrado', %L::uuid)$q$, current_setting('t.txt'), current_setting('t.droot')), 'replying to a soft-deleted root is allowed');
-- hard delete of a reply
select set_config('t.rres', public.delete_message(current_setting('t.drep1')::uuid)::text, true);
select tests.clear_authentication();
select is((current_setting('t.rres')::jsonb)->>'hard', 'true', 'reply delete is hard');
select is((select count(*)::int from public.messages where id = current_setting('t.drep1')::uuid), 0, 'reply is gone');
select is((select reply_count from public.messages where id = current_setting('t.droot')::uuid), 2, 'reply_count decremented (3 -> 2)');
-- moderator deletes the rest; the last reply removes the tombstone too
select tests.authenticate_as(current_setting('t.um')::uuid);
select lives_ok(format($q$select public.delete_message(%L::uuid)$q$, current_setting('t.drep2')), 'moderator deletes someone else''s reply');
select lives_ok(format($q$select public.delete_message(id) from public.messages where thread_root_id = %L::uuid$q$, current_setting('t.droot')), 'moderator deletes the remaining reply');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where id = current_setting('t.droot')::uuid), 0, 'tombstone without replies is removed with its last reply');
-- hard delete of a root without replies
select tests.authenticate_as(current_setting('t.ue')::uuid);
select set_config('t.hroot', tests.post(current_setting('t.txt')::uuid, 'sin hilo', null, false, null,
  tests.att(current_setting('t.txt')::uuid, current_setting('t.e')::uuid))::text, true);
select set_config('t.hpath', (select string_agg(storage_path, ',') from (select 1) s, lateral (select storage_path from public.message_attachments where message_id = current_setting('t.hroot')::uuid) q), true);
select set_config('t.hres', public.delete_message(current_setting('t.hroot')::uuid)::text, true);
select tests.clear_authentication();
select is((current_setting('t.hres')::jsonb)->>'hard', 'true', 'root without replies: hard delete');
select is((current_setting('t.hres')::jsonb)->'paths', jsonb_build_array(current_setting('t.hpath')), 'hard delete returns attachment paths');
select is((select count(*)::int from public.messages where id = current_setting('t.hroot')::uuid), 0, 'hard-deleted root is gone');
select is((select count(*)::int from public.message_attachments where storage_path = current_setting('t.hpath')), 0, 'hard delete cascades attachments');

-- carried from task 2: cascade and quote nulling on direct deletes
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links) values
  ('00000000-0000-0000-0000-00000000c001', current_setting('t.txt2')::uuid, current_setting('t.u')::uuid, '{}', 'raiz', false);
insert into public.messages (id, channel_id, thread_root_id, author_id, body, body_text, allow_links) values
  ('00000000-0000-0000-0000-00000000c002', current_setting('t.txt2')::uuid, '00000000-0000-0000-0000-00000000c001', current_setting('t.u')::uuid, '{}', 'resp', false);
insert into public.messages (id, channel_id, quoted_message_id, author_id, body, body_text, allow_links) values
  ('00000000-0000-0000-0000-00000000c003', current_setting('t.txt2')::uuid, '00000000-0000-0000-0000-00000000c001', current_setting('t.u')::uuid, '{}', 'cita', false);
insert into public.messages (id, channel_id, quoted_message_id, author_id, body, body_text, allow_links) values
  ('00000000-0000-0000-0000-00000000c004', current_setting('t.txt2')::uuid, '00000000-0000-0000-0000-00000000c003', current_setting('t.u')::uuid, '{}', 'cita2', false);
delete from public.messages where id = '00000000-0000-0000-0000-00000000c003';
select is((select quoted_message_id from public.messages where id = '00000000-0000-0000-0000-00000000c004'), null, 'deleting a quoted message nulls quoted_message_id');
select is((select channel_id from public.messages where id = '00000000-0000-0000-0000-00000000c004'), current_setting('t.txt2')::uuid, 'quote nulling keeps channel_id');
delete from public.messages where id = '00000000-0000-0000-0000-00000000c001';
select is((select count(*)::int from public.messages where id = '00000000-0000-0000-0000-00000000c002'), 0, 'hard-deleting a root cascades its replies');

-- ===== delete_channel returns attachment paths and audits message_count =====
select tests.authenticate_as(current_setting('t.ue')::uuid);
select set_config('t.cmsg1', tests.post(current_setting('t.del')::uuid, 'uno', null, false, null,
  tests.att(current_setting('t.del')::uuid, current_setting('t.e')::uuid))::text, true);
select set_config('t.cmsg2', tests.post(current_setting('t.del')::uuid, 'dos', current_setting('t.cmsg1')::uuid)::text, true);
select tests.clear_authentication();
select set_config('t.cpath', (select storage_path from public.message_attachments where message_id = current_setting('t.cmsg1')::uuid), true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.cres', public.delete_channel(current_setting('t.del')::uuid)::text, true);
select tests.clear_authentication();
select is((current_setting('t.cres')::jsonb)->'paths', jsonb_build_array(current_setting('t.cpath')), 'delete_channel returns the attachment paths');
select is((select (payload->>'message_count')::int from public.audit_log where action = 'channel_deleted' and target_id = current_setting('t.del')::uuid), 2, 'delete_channel audits message_count');
select is((select count(*)::int from public.messages where channel_id = current_setting('t.del')::uuid), 0, 'delete_channel cascades messages');
select ok(not has_function_privilege('anon', 'public.delete_channel(uuid)', 'execute'), 'anon still cannot delete_channel');
select ok(has_function_privilege('authenticated', 'public.delete_channel(uuid)', 'execute'), 'authenticated still can delete_channel');

select * from finish();
rollback;
