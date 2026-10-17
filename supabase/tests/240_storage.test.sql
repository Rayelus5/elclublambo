begin;
select plan(33);

-- ===== bucket =====
select is((select public from storage.buckets where id = 'chat-images'), false, 'chat-images bucket is private');
select is((select file_size_limit from storage.buckets where id = 'chat-images'), 5242880::bigint, 'bucket size limit is 5 MB');
select is((select allowed_mime_types from storage.buckets where id = 'chat-images'),
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif'], 'bucket allows only the four image types');

-- ===== policies =====
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'chat\_images\_%'),
  array['chat_images_insert', 'chat_images_select'], 'only insert and select policies exist for chat images');
select is((select count(*)::int from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'DELETE', 'ALL')
             and (qual ilike '%chat-images%' or with_check ilike '%chat-images%')), 0,
  'no update/delete/all policy touches the chat-images bucket');
select ok((select with_check like '%CASE%' from pg_policies where schemaname = 'storage' and policyname = 'chat_images_insert'),
  'insert policy guards the uuid cast with CASE');
select ok((select qual like '%CASE%' from pg_policies where schemaname = 'storage' and policyname = 'chat_images_select'),
  'select policy guards the uuid cast with CASE');

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d2400', 40, '0'), null, true)::text, true);
select set_config('t.u', tests.create_member('0x' || lpad('d2401', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.e', tests.create_member('0x' || lpad('d2402', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.f', tests.create_member('0x' || lpad('d2403', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ban', tests.create_member('0x' || lpad('d2404', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.uu', (select auth_user_id::text from public.members where id = current_setting('t.u')::uuid), true);
select set_config('t.ue', (select auth_user_id::text from public.members where id = current_setting('t.e')::uuid), true);
select set_config('t.uf', (select auth_user_id::text from public.members where id = current_setting('t.f')::uuid), true);
select set_config('t.ubn', (select auth_user_id::text from public.members where id = current_setting('t.ban')::uuid), true);

insert into public.roles (name, color, position, permissions) values ('T240 power', '#AAAAAA', 64, 1024);
insert into public.member_roles (member_id, role_id)
  select m, r.id from public.roles r,
    unnest(array[current_setting('t.e')::uuid, current_setting('t.f')::uuid, current_setting('t.ban')::uuid]) m
  where r.name = 'T240 power';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where is_system;
update public.members set status = 'banned' where id = current_setting('t.ban')::uuid;

select set_config('t.cat', tests.create_channel(null, 'category', 'T240cat')::text, true);
select set_config('t.c', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't240')::text, true);
select set_config('t.catH', tests.create_channel(null, 'category', 'T240hid')::text, true);
select set_config('t.cH', tests.create_channel(current_setting('t.catH')::uuid, 'text', 't240hid')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
  (current_setting('t.catH')::uuid, 'role', (select id from public.roles where is_everyone), 0, 1),
  (current_setting('t.catH')::uuid, 'member', current_setting('t.f')::uuid, 1, 0);

create function tests.pth(p_ch text, p_member text, p_ext text default 'png') returns text language sql as $$
  select p_ch || '/' || p_member || '/' || gen_random_uuid() || '.' || p_ext
$$;
create function tests.ins(p_name text) returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name) values ('chat-images', p_name);
end $$;
grant execute on function tests.pth(text, text, text), tests.ins(text) to public;

-- ===== insert policy =====
select tests.authenticate_as(current_setting('t.ue')::uuid);
select lives_ok(format($q$select tests.ins(tests.pth(%L, %L))$q$, current_setting('t.c'), current_setting('t.e')),
  'member with ATTACH uploads into own folder of a visible channel');
select throws_ok(format($q$select tests.ins(tests.pth(%L, %L))$q$, current_setting('t.c'), current_setting('t.u')),
  '42501', null, 'cannot upload into another member folder');
select throws_ok(format($q$select tests.ins(tests.pth(%L, %L))$q$, current_setting('t.cH'), current_setting('t.e')),
  '42501', null, 'cannot upload into a hidden channel');
select throws_ok(format($q$select tests.ins(tests.pth(%L, %L, 'svg'))$q$, current_setting('t.c'), current_setting('t.e')),
  '42501', null, 'extension outside the allowlist is denied');
select throws_ok(format($q$select tests.ins(%L)$q$, current_setting('t.c') || '/' || current_setting('t.e') || '/not-a-uuid.png'),
  '42501', null, 'non-uuid file name is denied');
select throws_ok(format($q$select tests.ins(upper(tests.pth(%L, %L)))$q$, current_setting('t.c'), current_setting('t.e')),
  '42501', null, 'uppercase path is denied');
select throws_ok(format($q$select tests.ins(%L || '/extra/' || gen_random_uuid() || '.png')$q$, current_setting('t.c') || '/' || current_setting('t.e')),
  '42501', null, 'extra path segment is denied');
select throws_ok(format($q$select tests.ins(tests.pth('zzzz', %L))$q$, current_setting('t.e')),
  '42501', null, 'malformed channel segment is denied without a cast error');
select throws_ok(format($q$select tests.ins(%L)$q$, current_setting('t.c') || '/' || gen_random_uuid() || '.png'),
  '42501', null, 'path without member segment is denied');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select throws_ok(format($q$select tests.ins(tests.pth(%L, %L))$q$, current_setting('t.c'), current_setting('t.u')),
  '42501', null, 'member without ATTACH_FILES is denied in own folder');
select tests.authenticate_as(current_setting('t.ubn')::uuid);
select throws_ok(format($q$select tests.ins(tests.pth(%L, %L))$q$, current_setting('t.c'), current_setting('t.ban')),
  '42501', null, 'banned member is denied');
select tests.clear_authentication();

-- ===== select policy =====
select set_config('t.pv', tests.pth(current_setting('t.c'), current_setting('t.e')), true);
select set_config('t.ph', tests.pth(current_setting('t.cH'), current_setting('t.f')), true);
select tests.ins(current_setting('t.pv'));
select tests.ins(current_setting('t.ph'));

select tests.authenticate_as(current_setting('t.uu')::uuid);
select is((select count(*)::int from storage.objects where bucket_id = 'chat-images' and name = current_setting('t.pv')), 1,
  'member who can view the channel reads its image');
select is((select count(*)::int from storage.objects where bucket_id = 'chat-images' and name = current_setting('t.ph')), 0,
  'member who cannot view the channel sees 0 rows');
select tests.authenticate_as(current_setting('t.uf')::uuid);
select is((select count(*)::int from storage.objects where bucket_id = 'chat-images' and name = current_setting('t.ph')), 1,
  'member granted VIEW on the hidden channel reads its image');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select count(*)::int from storage.objects where bucket_id = 'chat-images' and name = current_setting('t.pv')), 1, 'admin reads visible image');
select tests.clear_authentication();
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'chat-images'), 0, 'anon sees no chat image');
reset role;

-- ===== update / delete =====
select tests.authenticate_as(current_setting('t.ue')::uuid);
with u as (update storage.objects set name = name || 'x' where bucket_id = 'chat-images' and name = current_setting('t.pv') returning 1)
  select is((select count(*)::int from u), 0, 'authenticated cannot update (no upsert/overwrite) even own objects');
select throws_ok(format($q$delete from storage.objects where bucket_id = 'chat-images' and name = %L$q$, current_setting('t.pv')),
  '42501', null, 'authenticated cannot delete objects (no policy; Storage also blocks direct SQL deletes)');
select tests.clear_authentication();
select is((select count(*)::int from storage.objects where bucket_id = 'chat-images' and name = current_setting('t.pv')), 1,
  'object survives the authenticated delete attempt');

-- ===== post_message verifies objects =====
create function tests.post(p_ch uuid, p_att jsonb) returns uuid language sql as $$
  select public.post_message(p_ch, jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'hola'))))),
    'hola', false, null, null, p_att)
$$;
grant execute on function tests.post(uuid, jsonb) to public;

select set_config('t.pmiss', tests.pth(current_setting('t.c'), current_setting('t.e')), true);
select tests.authenticate_as(current_setting('t.ue')::uuid);
select throws_ok(format($q$select tests.post(%L::uuid, jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/png', 'size', 10)))$q$,
  current_setting('t.c'), current_setting('t.pmiss')), 'P0001', 'invalid_input', 'attachment whose object does not exist: invalid_input');
select tests.clear_authentication();

-- metadata overrides the client claims
select set_config('t.pmeta', tests.pth(current_setting('t.c'), current_setting('t.e')), true);
insert into storage.objects (bucket_id, name, metadata)
  values ('chat-images', current_setting('t.pmeta'), jsonb_build_object('mimetype', 'image/webp', 'size', 999));
select tests.authenticate_as(current_setting('t.ue')::uuid);
select set_config('t.msg', tests.post(current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('path', current_setting('t.pmeta'), 'mime', 'image/png', 'size', 1234)))::text, true);
select tests.clear_authentication();
select is((select mime from public.message_attachments where message_id = current_setting('t.msg')::uuid), 'image/webp',
  'mime is taken from the object metadata');
select is((select size_bytes from public.message_attachments where message_id = current_setting('t.msg')::uuid), 999,
  'size is taken from the object metadata');

-- object metadata with a disallowed mime is rejected even if the claim looks fine
select set_config('t.pbad', tests.pth(current_setting('t.c'), current_setting('t.e')), true);
insert into storage.objects (bucket_id, name, metadata)
  values ('chat-images', current_setting('t.pbad'), jsonb_build_object('mimetype', 'text/html', 'size', 10));
select tests.authenticate_as(current_setting('t.ue')::uuid);
select throws_ok(format($q$select tests.post(%L::uuid, jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/png', 'size', 10)))$q$,
  current_setting('t.c'), current_setting('t.pbad')), 'P0001', 'invalid_input', 'object metadata mime outside the allowlist: invalid_input');
select tests.clear_authentication();

-- object metadata with an oversize file is rejected
select set_config('t.pbig', tests.pth(current_setting('t.c'), current_setting('t.e')), true);
insert into storage.objects (bucket_id, name, metadata)
  values ('chat-images', current_setting('t.pbig'), jsonb_build_object('mimetype', 'image/png', 'size', 9999999));
select tests.authenticate_as(current_setting('t.ue')::uuid);
select throws_ok(format($q$select tests.post(%L::uuid, jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/png', 'size', 10)))$q$,
  current_setting('t.c'), current_setting('t.pbig')), 'P0001', 'invalid_input', 'object metadata size over 5 MB: invalid_input');
select tests.clear_authentication();

-- an object without metadata falls back to the claims
select set_config('t.pnull', tests.pth(current_setting('t.c'), current_setting('t.e')), true);
select tests.ins(current_setting('t.pnull'));
select tests.authenticate_as(current_setting('t.ue')::uuid);
select set_config('t.msg2', tests.post(current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('path', current_setting('t.pnull'), 'mime', 'image/gif', 'size', 77)))::text, true);
select tests.clear_authentication();
select is((select mime || ':' || size_bytes from public.message_attachments where message_id = current_setting('t.msg2')::uuid), 'image/gif:77',
  'object without metadata keeps the client claims');

-- the same object cannot back two messages
select tests.authenticate_as(current_setting('t.ue')::uuid);
select throws_ok(format($q$select tests.post(%L::uuid, jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/png', 'size', 10)))$q$,
  current_setting('t.c'), current_setting('t.pmeta')), 'P0001', 'invalid_input', 'a storage object cannot be reused by a second message');
select tests.clear_authentication();

select * from finish();
rollback;
