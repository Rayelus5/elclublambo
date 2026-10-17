begin;
select plan(47);

-- F2b final review fixes: storage read scope, upload needs posting rights, storage metadata is the only
-- authority, mentions only from the rendered content tree, locale-independent trim.

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d2500', 40, '0'), null, true)::text, true);
select set_config('t.u', tests.create_member('0x' || lpad('d2501', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.e', tests.create_member('0x' || lpad('d2502', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.h', tests.create_member('0x' || lpad('d2503', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.uu', (select auth_user_id::text from public.members where id = current_setting('t.u')::uuid), true);
select set_config('t.ue', (select auth_user_id::text from public.members where id = current_setting('t.e')::uuid), true);
select set_config('t.uh', (select auth_user_id::text from public.members where id = current_setting('t.h')::uuid), true);

insert into public.roles (name, color, position, permissions) values ('T250 attach', '#AAAAAA', 64, 1024);
insert into public.member_roles (member_id, role_id)
  select m, r.id from public.roles r,
    unnest(array[current_setting('t.e')::uuid, current_setting('t.h')::uuid]) m
  where r.name = 'T250 attach';

select set_config('t.cat', tests.create_channel(null, 'category', 'T250cat')::text, true);
select set_config('t.c', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't250')::text, true);
-- read-only channel (no SEND, no THREADS) and a threads-only channel (no SEND)
select set_config('t.cro', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't250ro')::text, true);
select set_config('t.cth', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't250th')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
  (current_setting('t.cro')::uuid, 'role', (select id from public.roles where is_everyone), 0, 6),
  (current_setting('t.cth')::uuid, 'role', (select id from public.roles where is_everyone), 0, 2),
  -- h cannot see t250 at all
  (current_setting('t.c')::uuid, 'member', current_setting('t.h')::uuid, 0, 1);

create function tests.pth(p_ch text, p_member text) returns text language sql as $$
  select p_ch || '/' || p_member || '/' || gen_random_uuid() || '.png'
$$;
-- plain insert under the caller's RLS (the INSERT policy), like the Storage API
create function tests.ins(p_name text) returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name) values ('chat-images', p_name);
end $$;
-- insert ... returning: Storage's upload path, which also needs the SELECT policy to pass for the new row
create function tests.ins_ret(p_name text) returns text language plpgsql as $$
declare
  v text;
begin
  insert into storage.objects (bucket_id, name, metadata)
    values ('chat-images', p_name, jsonb_build_object('mimetype', 'image/png', 'size', 100))
    returning name into v;
  return v;
end $$;
create function tests.seen(p_name text) returns int language sql as $$
  select count(*)::int from storage.objects where bucket_id = 'chat-images' and name = p_name
$$;
create function tests.seen_prefix(p_prefix text) returns int language sql as $$
  select count(*)::int from storage.objects where bucket_id = 'chat-images' and name like p_prefix || '/%'
$$;
create function tests.doc(p_nodes jsonb) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', p_nodes)
$$;
create function tests.para(p_nodes jsonb) returns jsonb language sql as $$
  select jsonb_build_object('type', 'paragraph', 'content', p_nodes)
$$;
create function tests.txt(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'text', 'text', p_text)
$$;
create function tests.ev() returns jsonb language sql as $$
  select '{"type":"mention","attrs":{"kind":"everyone"}}'::jsonb
$$;
-- a doc with a visible 'hola' paragraph plus p_node inside a paragraph wrapped in p_levels blockquotes:
-- doc is depth 0, so p_node sits at depth p_levels + 2
create function tests.nest(p_levels int, p_node jsonb) returns jsonb language plpgsql as $$
declare
  v jsonb := tests.para(jsonb_build_array(p_node));
begin
  for i in 1..p_levels loop
    v := jsonb_build_object('type', 'blockquote', 'content', jsonb_build_array(v));
  end loop;
  return tests.doc(jsonb_build_array(tests.para(jsonb_build_array(tests.txt('hola'))), v));
end $$;
-- posts p_body as the authenticated caller and returns the number of stored mention rows
create function tests.mcount(p_ch uuid, p_body jsonb) returns int language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := public.post_message(p_ch, p_body, '', false, null, null, '[]'::jsonb);
begin
  return (select count(*)::int from public.message_mentions where message_id = v_id);
end $$;
create function tests.post_att(p_ch uuid, p_path text) returns uuid language sql as $$
  select public.post_message(p_ch, tests.doc(jsonb_build_array(tests.para(jsonb_build_array(tests.txt('img'))))),
    'img', false, null, null, jsonb_build_array(jsonb_build_object('path', p_path, 'mime', 'image/png', 'size', 10)))
$$;
grant execute on all functions in schema tests to public;

-- ===== 1. storage SELECT: uploader or attached to a visible message =====
select set_config('t.pd', tests.pth(current_setting('t.c'), current_setting('t.e')), true);
select tests.authenticate_as(current_setting('t.ue')::uuid);
select is(tests.ins_ret(current_setting('t.pd')), current_setting('t.pd'),
  'upload with insert ... returning works for the uploader');
select is(tests.seen(current_setting('t.pd')), 1, 'uploader reads their own unattached object');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(tests.seen(current_setting('t.pd')), 0, 'another viewer cannot read an unattached object');
select is(tests.seen_prefix(current_setting('t.c')), 0, 'another viewer cannot list unattached objects of the channel');
select tests.authenticate_as(current_setting('t.uh')::uuid);
select is(tests.seen(current_setting('t.pd')), 0, 'a member who cannot view the channel cannot read the unattached object');

select tests.authenticate_as(current_setting('t.ue')::uuid);
select set_config('t.msg', tests.post_att(current_setting('t.c')::uuid, current_setting('t.pd'))::text, true);
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(tests.seen(current_setting('t.pd')), 1, 'another viewer reads the object once it is attached');
select is(tests.seen_prefix(current_setting('t.c')), 1, 'listing the channel shows attached objects only');
select tests.authenticate_as(current_setting('t.uh')::uuid);
select is(tests.seen(current_setting('t.pd')), 0, 'a member who cannot view the channel cannot read the attached object');
select tests.authenticate_as(current_setting('t.ue')::uuid);
select lives_ok(format($q$select public.delete_message(%L::uuid)$q$, current_setting('t.msg')), 'author deletes the image message');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(tests.seen(current_setting('t.pd')), 0, 'after delete_message another viewer can no longer read the object');
select tests.authenticate_as(current_setting('t.ue')::uuid);
select is(tests.seen(current_setting('t.pd')), 1, 'the uploader still reads the leftover object');
select tests.clear_authentication();
select ok((select qual like '%CASE%' from pg_policies where schemaname = 'storage' and policyname = 'chat_images_select'),
  'select policy still guards the uuid cast with CASE');

-- ===== 2. storage INSERT also needs SEND_MESSAGES or SEND_IN_THREADS =====
select tests.authenticate_as(current_setting('t.ue')::uuid);
select throws_ok(format($q$select tests.ins(tests.pth(%L, %L))$q$, current_setting('t.cro'), current_setting('t.e')),
  '42501', null, 'ATTACH without SEND or THREADS cannot upload');
select lives_ok(format($q$select tests.ins(tests.pth(%L, %L))$q$, current_setting('t.cth'), current_setting('t.e')),
  'ATTACH with THREADS only can upload');
select lives_ok(format($q$select tests.ins(tests.pth(%L, %L))$q$, current_setting('t.c'), current_setting('t.e')),
  'ATTACH with SEND can upload');
select tests.clear_authentication();

-- ===== 3. storage metadata is the only authority =====
select set_config('t.pnull', tests.pth(current_setting('t.c'), current_setting('t.e')), true);
insert into storage.objects (bucket_id, name) values ('chat-images', current_setting('t.pnull'));
select set_config('t.pnomime', tests.pth(current_setting('t.c'), current_setting('t.e')), true);
insert into storage.objects (bucket_id, name, metadata) values ('chat-images', current_setting('t.pnomime'), '{"size": 10}');
select set_config('t.pnosize', tests.pth(current_setting('t.c'), current_setting('t.e')), true);
insert into storage.objects (bucket_id, name, metadata) values ('chat-images', current_setting('t.pnosize'), '{"mimetype": "image/png"}');
select tests.authenticate_as(current_setting('t.ue')::uuid);
select throws_ok(format($q$select tests.post_att(%L::uuid, %L)$q$, current_setting('t.c'), current_setting('t.pnull')),
  'P0001', 'invalid_input', 'object without metadata: invalid_input (no fallback to client claims)');
select throws_ok(format($q$select tests.post_att(%L::uuid, %L)$q$, current_setting('t.c'), current_setting('t.pnomime')),
  'P0001', 'invalid_input', 'object metadata without mimetype: invalid_input');
select throws_ok(format($q$select tests.post_att(%L::uuid, %L)$q$, current_setting('t.c'), current_setting('t.pnosize')),
  'P0001', 'invalid_input', 'object metadata without size: invalid_input');
select tests.clear_authentication();

-- ===== 4. mentions: root must be a doc; only nodes the renderer shows count =====
select tests.authenticate_as(current_setting('t.uu')::uuid);
select throws_ok(format($q$select public.post_message(%L::uuid, %L::jsonb, 'x', false, null, null, '[]'::jsonb)$q$,
  current_setting('t.c'), tests.para(jsonb_build_array(tests.txt('hola'), tests.ev()))::text),
  'P0001', 'invalid_input', 'post with a root that is not a doc: invalid_input');
select throws_ok(format($q$select public.post_message(%L::uuid, %L::jsonb, 'x', false, null, null, '[]'::jsonb)$q$,
  current_setting('t.c'), '{"content":[{"type":"paragraph","content":[{"type":"text","text":"hola"}]}]}'),
  'P0001', 'invalid_input', 'post with a root without type: invalid_input');
select set_config('t.m1', public.post_message(current_setting('t.c')::uuid,
  tests.doc(jsonb_build_array(tests.para(jsonb_build_array(tests.txt('hola'))))), 'hola', false, null, null, '[]'::jsonb)::text, true);
select throws_ok(format($q$select public.edit_message(%L::uuid, %L::jsonb, 'x')$q$,
  current_setting('t.m1'), tests.para(jsonb_build_array(tests.txt('hola'), tests.ev()))::text),
  'P0001', 'invalid_input', 'edit with a root that is not a doc: invalid_input');

select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola"},{"type":"mention","attrs":{"kind":"everyone"}}]}]}'::jsonb),
  1, 'a visible @everyone is stored');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","attrs":{"x":{"type":"mention","attrs":{"kind":"everyone"}}},"content":[{"type":"text","text":"hola"}]}]}'::jsonb),
  0, 'a mention under attrs is not stored');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola","marks":[{"type":"mention","attrs":{"kind":"everyone"}}]}]}]}'::jsonb),
  0, 'a mention inside marks is not stored');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola","content":[{"type":"mention","attrs":{"kind":"everyone"}}]}]}]}'::jsonb),
  0, 'a mention under a text node is not stored');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola"},{"type":"hardBreak","content":[{"type":"mention","attrs":{"kind":"everyone"}}]}]}]}'::jsonb),
  0, 'a mention under a hardBreak is not stored');
select is(tests.mcount(current_setting('t.c')::uuid, replace('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola"},{"type":"mention","attrs":{"kind":"everyone"},"content":[{"type":"mention","attrs":{"kind":"member","id":"MEMBER_ID"}}]}]}]}', 'MEMBER_ID', current_setting('t.a'))::jsonb),
  1, 'a mention nested inside a mention is not stored (only the outer one)');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola"}]},{"type":"codeBlock","content":[{"type":"text","text":"x"},{"type":"mention","attrs":{"kind":"everyone"}}]}]}'::jsonb),
  0, 'a mention inside a codeBlock is not stored');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola"}]},{"type":"horizontalRule","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"kind":"everyone"}}]}]}]}'::jsonb),
  0, 'a mention inside a horizontalRule is not stored');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola"}]},{"type":"table","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"kind":"everyone"}}]}]}]}'::jsonb),
  0, 'a mention directly under a table (not in a row) is not stored');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola"}]},{"type":"table","content":[{"type":"tableRow","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"kind":"everyone"}}]}]}]}]}'::jsonb),
  0, 'a mention directly under a tableRow (not in a cell) is not stored');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"hola"},{"type":"mention","attrs":{"kind":"everyone"}}]}]}]}]}]}'::jsonb),
  1, 'a mention inside a table cell is stored');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"text","text":"hola"},{"type":"mention","attrs":{"kind":"everyone"}}]}'::jsonb),
  1, 'an inline mention directly under the doc is stored (the sanitizer wraps it in a paragraph)');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"mention","attrs":{"kind":"everyone"}}]},{"type":"paragraph","content":[{"type":"text","text":"b"},{"type":"mention","attrs":{"kind":"everyone"}}]}]}'::jsonb),
  1, 'duplicate mentions are still deduplicated');
select is(tests.mcount(current_setting('t.c')::uuid, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hola"}]},{"type":"unknownWrapper","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"kind":"everyone"}}]}]}]}'::jsonb),
  1, 'a mention under an unknown wrapper node is stored (the sanitizer keeps its children)');
select is(tests.mcount(current_setting('t.c')::uuid, tests.nest(38, tests.ev())), 1, 'a mention at depth 40 is stored');
select is(tests.mcount(current_setting('t.c')::uuid, tests.nest(39, tests.ev())), 0, 'a mention at depth 41 is not stored');
select tests.clear_authentication();
select ok(not has_function_privilege('authenticated', 'public._insert_mentions(uuid,jsonb,bigint)', 'execute'),
  'authenticated cannot execute _insert_mentions');
select ok(not has_function_privilege('service_role', 'public._insert_mentions(uuid,jsonb,bigint)', 'execute'),
  'service_role cannot execute _insert_mentions');
select ok(not has_function_privilege('anon', 'public._insert_mentions(uuid,jsonb,bigint)', 'execute'),
  'anon cannot execute _insert_mentions');

-- ===== 5. _doc_text trims ASCII whitespace only =====
select is(public._doc_text(tests.doc(jsonb_build_array(tests.para(jsonb_build_array(tests.txt(E'\u00a0x\u00a0'))))) ),
  E'\u00a0x\u00a0', '_doc_text keeps leading/trailing NBSP');
select is(public._doc_text(tests.doc(jsonb_build_array(tests.para(jsonb_build_array(tests.txt(E'\u3000x\u2003'))))) ),
  E'\u3000x\u2003', '_doc_text keeps other Unicode spaces');
select is(public._doc_text(tests.doc(jsonb_build_array(tests.para(jsonb_build_array(tests.txt(E' \t\r\f\u000bx \n'))))) ),
  'x', '_doc_text trims ASCII whitespace');
select ok(not has_function_privilege('authenticated', 'public._doc_text(jsonb)', 'execute'), 'authenticated cannot execute _doc_text');
select ok(not has_function_privilege('anon', 'public._doc_text(jsonb)', 'execute'), 'anon cannot execute _doc_text');

-- an NBSP-only message is stored (TS and SQL agree it is not empty)
select tests.authenticate_as(current_setting('t.uu')::uuid);
select lives_ok(format($q$select public.post_message(%L::uuid, %L::jsonb, 'x', false, null, null, '[]'::jsonb)$q$,
  current_setting('t.c'), tests.doc(jsonb_build_array(tests.para(jsonb_build_array(tests.txt(E'\u00a0')))))::text),
  'an NBSP-only message is accepted');
select tests.clear_authentication();

-- ===== banned uploader =====
update public.members set status = 'banned' where id = current_setting('t.e')::uuid;
select tests.authenticate_as(current_setting('t.ue')::uuid);
select is(tests.seen(current_setting('t.pd')), 0, 'a banned uploader cannot read their leftover object');
select tests.clear_authentication();

select * from finish();
rollback;
