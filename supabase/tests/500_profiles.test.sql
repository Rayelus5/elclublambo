begin;
select plan(101);

-- Calls set_handle as the current role and returns the stored handle or the error message.
create function pg_temp.sh(p_handle text) returns text language plpgsql as $$
begin
  return public.set_handle(p_handle);
exception when others then
  return sqlerrm;
end $$;
-- definer: a banned caller cannot read members, which would make the lookup return null
create function pg_temp.up(p_member text) returns uuid language sql security definer as
  $$ select auth_user_id from public.members where id = p_member::uuid $$;
create function pg_temp.uuidpath(p_folder text, p_ext text default 'png') returns text language sql as
  $$ select p_folder || '/' || gen_random_uuid() || '.' || p_ext $$;
create function pg_temp.mkobj(p_name text, p_meta jsonb) returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, metadata) values ('avatars', p_name, p_meta);
end $$;
grant execute on function pg_temp.sh(text), pg_temp.up(text), pg_temp.uuidpath(text, text), pg_temp.mkobj(text, jsonb) to public;

-- ===== privileges =====
select ok(not has_table_privilege('authenticated', 'public.members', 'update'), 'authenticated has no table UPDATE on members');
select ok(not has_any_column_privilege('authenticated', 'public.members', 'update'), 'authenticated has no column UPDATE on members');
select ok(has_function_privilege('authenticated', 'public.set_handle(text)', 'execute'), 'authenticated can set_handle');
select ok(not has_function_privilege('anon', 'public.set_handle(text)', 'execute'), 'anon cannot set_handle');
select ok(has_function_privilege('authenticated', 'public.update_profile(text,text,jsonb)', 'execute'), 'authenticated can update_profile');
select ok(not has_function_privilege('anon', 'public.update_profile(text,text,jsonb)', 'execute'), 'anon cannot update_profile');
select ok(has_function_privilege('authenticated', 'public.set_avatar(text)', 'execute'), 'authenticated can set_avatar');
select ok(not has_function_privilege('anon', 'public.set_avatar(text)', 'execute'), 'anon cannot set_avatar');
select ok(has_function_privilege('authenticated', 'public.complete_welcome()', 'execute'), 'authenticated can complete_welcome');
select ok(not has_function_privilege('anon', 'public.complete_welcome()', 'execute'), 'anon cannot complete_welcome');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'members' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0, 'members has no write policy');

-- ===== bucket =====
select is((select public from storage.buckets where id = 'avatars'), true, 'avatars bucket is public');
select is((select file_size_limit from storage.buckets where id = 'avatars'), 2097152::bigint, 'avatars size limit is 2 MB');
select is((select allowed_mime_types from storage.buckets where id = 'avatars'),
  array['image/png', 'image/jpeg', 'image/webp'], 'avatars allows png, jpeg and webp');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and cmd in ('UPDATE', 'ALL') and (qual ilike '%avatars%' or with_check ilike '%avatars%')), 0,
  'no update/all policy touches avatars');

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d5000', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('d5001', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('d5002', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.d', tests.create_member('0x' || lpad('d5003', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.e', tests.create_member('0x' || lpad('d5004', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.f', tests.create_member('0x' || lpad('d5005', 40, '0'), current_setting('t.a')::uuid)::text, true);
update public.members set status = 'banned' where id = current_setting('t.f')::uuid;

select throws_ok(format($q$update public.members set handle = 'Ab_c' where id = %L$q$, current_setting('t.b')),
  '23514', null, 'handle check constraint rejects uppercase');

-- ===== handles =====
select tests.authenticate_as(pg_temp.up(current_setting('t.a')));
select is(public.set_handle('Ray_L'), 'ray_l', 'Ray_L is stored as ray_l');
select is((select handle::text from public.members where id = current_setting('t.a')::uuid), 'ray_l', 'handle persisted');
select ok((select handle_changed_at is not null from public.members where id = current_setting('t.a')::uuid), 'handle_changed_at set on first set');
select tests.authenticate_as(pg_temp.up(current_setting('t.b')));
select is(public.set_handle('  ok_name  '), 'ok_name', 'whitespace is trimmed');

-- c keeps a null handle: every rejected input is tried on it
select tests.authenticate_as(pg_temp.up(current_setting('t.c')));
select is(pg_temp.sh('ab'), 'handle_invalid', 'too short');
select is(pg_temp.sh('aaaaaaaaaaaaaaaaaaaaa'), 'handle_invalid', '21 chars');
select is(pg_temp.sh('a.b.c'), 'handle_invalid', 'dots rejected');
select is(pg_temp.sh('a-b-c'), 'handle_invalid', 'dashes rejected');
select is(pg_temp.sh(E'аdmin'), 'handle_invalid', 'cyrillic a look-alike rejected');
select is(pg_temp.sh(E'Kelvin'), 'handle_invalid', 'kelvin sign rejected');
select is(pg_temp.sh(E'ad​min'), 'handle_invalid', 'zero width char rejected');
select is(pg_temp.sh(null), 'handle_invalid', 'null rejected');
select is(pg_temp.sh('ADMIN'), 'handle_reserved', 'ADMIN is reserved');
select is(pg_temp.sh('Admin '), 'handle_reserved', 'Admin with trailing space is reserved');
select is((select count(*)::int from unnest(array['admin', 'administrador', 'superadmin', 'elclub', 'el_club', 'sistema', 'system',
  'soporte', 'support', 'moderador', 'mod', 'staff', 'everyone', 'here', 'todos', 'anonimo', 'null', 'undefined']) r
  where pg_temp.sh(r) = 'handle_reserved'), 18, 'all 18 reserved handles are rejected');
select is(pg_temp.sh('ray_l'), 'handle_taken', 'handle taken by another member');
select is(pg_temp.sh('RAY_L'), 'handle_taken', 'case variant is taken too');
select is((select handle from public.members where id = current_setting('t.c')::uuid), null, 'rejected inputs stored nothing');

select tests.authenticate_as(pg_temp.up(current_setting('t.d')));
select is(public.set_handle('bob_1'), 'bob_1', 'bob_1 set');
select tests.authenticate_as(pg_temp.up(current_setting('t.e')));
select is(pg_temp.sh('Bob_1'), 'handle_taken', 'Bob_1 vs bob_1 is taken');
select tests.authenticate_as(pg_temp.up(current_setting('t.f')));
select is(pg_temp.sh('banned_one'), 'forbidden', 'banned member cannot set a handle');

-- cooldown
select tests.authenticate_as(pg_temp.up(current_setting('t.a')));
select is(pg_temp.sh('ray_two'), 'handle_cooldown', 'second change within 30 days is rejected');
select is(pg_temp.sh('ray_l'), 'ray_l', 'setting the same handle is a no-op');
select tests.clear_authentication();
update public.members set handle_changed_at = now() - interval '31 days' where id = current_setting('t.a')::uuid;
select tests.authenticate_as(pg_temp.up(current_setting('t.a')));
select is(public.set_handle('ray_two'), 'ray_two', 'change allowed after 31 days');
select ok((select handle_changed_at > now() - interval '1 minute' from public.members where id = current_setting('t.a')::uuid),
  'handle_changed_at refreshed');
select tests.authenticate_as(pg_temp.up(current_setting('t.e')));
select is(public.set_handle('ray_l'), 'ray_l', 'old handle is free again');

-- ===== profile fields =====
select tests.authenticate_as(pg_temp.up(current_setting('t.a')));
select throws_ok(format($q$select public.update_profile(null, %L, '[]')$q$, repeat('x', 281)), 'P0001', 'bio_too_long', '281 char bio rejected');
select lives_ok(format($q$select public.update_profile(null, %L, '[]')$q$, repeat('x', 280)), '280 char bio accepted');
select lives_ok($q$select public.update_profile(null, '   ', '[]')$q$, 'whitespace bio accepted');
select is((select bio from public.members where id = current_setting('t.a')::uuid), null, 'whitespace-only bio stores null');
select throws_ok($q$select public.update_profile(null, null, '{"a":"https://x.com"}')$q$, 'P0001', 'links_invalid', 'links object rejected');
select throws_ok($q$select public.update_profile(null, null, '"https://x.com"')$q$, 'P0001', 'links_invalid', 'links string rejected');
select throws_ok($q$select public.update_profile(null, null, '["https://a.com","https://b.com","https://c.com","https://d.com"]')$q$,
  'P0001', 'links_invalid', '4 links rejected');
select throws_ok($q$select public.update_profile(null, null, '["javascript:alert(1)"]')$q$, 'P0001', 'links_invalid', 'javascript: rejected');
select throws_ok($q$select public.update_profile(null, null, '["http://x.com"]')$q$, 'P0001', 'links_invalid', 'http: rejected');
select throws_ok(format($q$select public.update_profile(null, null, %L::jsonb)$q$, jsonb_build_array('https://x.com/' || repeat('a', 190))::text),
  'P0001', 'links_invalid', '204 char link rejected');
select throws_ok($q$select public.update_profile(null, null, '["https://"]')$q$, 'P0001', 'links_invalid', 'no host rejected');
select throws_ok($q$select public.update_profile(null, null, '["https:///path"]')$q$, 'P0001', 'links_invalid', 'empty host rejected');
select throws_ok($q$select public.update_profile(null, null, '["https://user@evil.com"]')$q$, 'P0001', 'links_invalid', 'userinfo rejected');
select throws_ok($q$select public.update_profile(null, null, '["https://localhost"]')$q$, 'P0001', 'links_invalid', 'dotless host rejected');
select throws_ok($q$select public.update_profile(null, null, '["https://a b.com"]')$q$, 'P0001', 'links_invalid', 'whitespace rejected');
select throws_ok($q$select public.update_profile(null, null, '[42]')$q$, 'P0001', 'links_invalid', 'non-string entry rejected');
select throws_ok($q$select public.update_profile(null, null, '[null]')$q$, 'P0001', 'links_invalid', 'null entry rejected');
select lives_ok($q$select public.update_profile(' Ray ', ' hola ', '["https://example.com/a?b=1#c","https://sub.example.org"]')$q$, 'valid profile accepted');
select is((select links from public.members where id = current_setting('t.a')::uuid),
  '["https://example.com/a?b=1#c","https://sub.example.org"]'::jsonb, 'links stored');
select is((select display_name || '|' || bio from public.members where id = current_setting('t.a')::uuid), 'Ray|hola', 'name and bio trimmed');
select lives_ok($q$select public.update_profile('', null, null)$q$, 'empty name and null links accepted');
select is((select display_name from public.members where id = current_setting('t.a')::uuid), null, 'empty display_name stores null');
select is((select links from public.members where id = current_setting('t.a')::uuid), '[]'::jsonb, 'null links store empty array');
select throws_ok($q$select public.update_profile('a', null, '[]')$q$, 'P0001', 'invalid_input', 'one-char display_name rejected');
select tests.authenticate_as(pg_temp.up(current_setting('t.f')));
select throws_ok($q$select public.update_profile(null, null, '[]')$q$, 'P0001', 'forbidden', 'banned member cannot update profile');

-- ===== welcome =====
select tests.authenticate_as(pg_temp.up(current_setting('t.c')));
select throws_ok($q$select public.complete_welcome()$q$, 'P0001', 'handle_required', 'complete_welcome without a handle');
select tests.authenticate_as(pg_temp.up(current_setting('t.a')));
select lives_ok($q$select public.complete_welcome()$q$, 'complete_welcome with a handle');
select ok((select welcome_completed_at is not null from public.members where id = current_setting('t.a')::uuid), 'welcome_completed_at set');

-- ===== avatar =====
select tests.clear_authentication();
select set_config('t.p_ok', pg_temp.uuidpath(current_setting('t.a')), true);
select set_config('t.p_other', pg_temp.uuidpath(current_setting('t.b')), true);
select set_config('t.p_gif', pg_temp.uuidpath(current_setting('t.a')), true);
select set_config('t.p_big', pg_temp.uuidpath(current_setting('t.a')), true);
select set_config('t.p_max', pg_temp.uuidpath(current_setting('t.a'), 'webp'), true);
select set_config('t.p_nometa', pg_temp.uuidpath(current_setting('t.a')), true);
select set_config('t.p_zero', pg_temp.uuidpath(current_setting('t.a')), true);
select set_config('t.p_nomime', pg_temp.uuidpath(current_setting('t.a')), true);
select set_config('t.p_missing', pg_temp.uuidpath(current_setting('t.a')), true);
select set_config('t.p_jpg', pg_temp.uuidpath(current_setting('t.a'), 'jpg'), true);
select pg_temp.mkobj(current_setting('t.p_ok'), '{"mimetype":"image/png","size":1000}');
select pg_temp.mkobj(current_setting('t.p_other'), '{"mimetype":"image/png","size":1000}');
select pg_temp.mkobj(current_setting('t.p_gif'), '{"mimetype":"image/gif","size":1000}');
select pg_temp.mkobj(current_setting('t.p_big'), '{"mimetype":"image/png","size":2097153}');
select pg_temp.mkobj(current_setting('t.p_max'), '{"mimetype":"image/webp","size":2097152}');
select pg_temp.mkobj(current_setting('t.p_nometa'), null);
select pg_temp.mkobj(current_setting('t.p_zero'), '{"mimetype":"image/png","size":0}');
select pg_temp.mkobj(current_setting('t.p_nomime'), '{"size":1000}');
select pg_temp.mkobj(current_setting('t.p_jpg'), '{"mimetype":"image/jpeg","size":1000}');

select tests.authenticate_as(pg_temp.up(current_setting('t.a')));
select throws_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_other')), 'P0001', 'avatar_invalid', 'another member folder rejected');
select throws_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_missing')), 'P0001', 'avatar_invalid', 'missing object rejected');
select throws_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_gif')), 'P0001', 'avatar_invalid', 'gif mime rejected');
select throws_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_big')), 'P0001', 'avatar_invalid', 'oversized object rejected');
select throws_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_nometa')), 'P0001', 'avatar_invalid', 'null metadata fails closed');
select throws_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_zero')), 'P0001', 'avatar_invalid', 'zero size rejected');
select throws_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_nomime')), 'P0001', 'avatar_invalid', 'missing mimetype fails closed');
select throws_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.a') || '/avatar.png'), 'P0001', 'avatar_invalid', 'non-uuid file name rejected');
select throws_ok(format($q$select public.set_avatar(%L)$q$, replace(current_setting('t.p_ok'), '.png', '.gif')), 'P0001', 'avatar_invalid', 'gif extension rejected');
select throws_ok(format($q$select public.set_avatar(%L)$q$, upper(current_setting('t.p_ok'))), 'P0001', 'avatar_invalid', 'uppercase path rejected');
select throws_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_ok') || '/x'), 'P0001', 'avatar_invalid', 'extra path segment rejected');
select throws_ok(format($q$select public.set_avatar(%L)$q$, '../' || current_setting('t.p_ok')), 'P0001', 'avatar_invalid', 'path traversal rejected');
select is((select avatar_path from public.members where id = current_setting('t.a')::uuid), null, 'rejected paths stored nothing');
select lives_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_ok')), 'own valid png accepted');
select is((select avatar_path from public.members where id = current_setting('t.a')::uuid), current_setting('t.p_ok'), 'avatar_path stored');
select lives_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_max')), 'exactly 2 MB webp accepted');
select lives_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_jpg')), 'own jpg accepted');
select lives_ok($q$select public.set_avatar(null)$q$, 'set_avatar(null) accepted');
select is((select avatar_path from public.members where id = current_setting('t.a')::uuid), null, 'set_avatar(null) clears the avatar');
select tests.authenticate_as(pg_temp.up(current_setting('t.f')));
select throws_ok(format($q$select public.set_avatar(%L)$q$, current_setting('t.p_ok')), 'P0001', 'forbidden', 'banned member cannot set avatar');

-- ===== bucket policies =====
select tests.authenticate_as(pg_temp.up(current_setting('t.a')));
select lives_ok(format($q$insert into storage.objects (bucket_id, name) values ('avatars', %L)$q$, pg_temp.uuidpath(current_setting('t.a'))),
  'member uploads under own folder');
select throws_ok(format($q$insert into storage.objects (bucket_id, name) values ('avatars', %L)$q$, pg_temp.uuidpath(current_setting('t.b'))),
  '42501', null, 'member cannot upload under another folder');
select throws_ok(format($q$insert into storage.objects (bucket_id, name) values ('avatars', %L)$q$, current_setting('t.a') || '/evil.exe'),
  '42501', null, 'bad file name cannot be uploaded');
select throws_ok(format($q$insert into storage.objects (bucket_id, name) values ('avatars', %L)$q$, current_setting('t.a') || '/x/' || gen_random_uuid() || '.png'),
  '42501', null, 'nested path cannot be uploaded');
select tests.authenticate_as(pg_temp.up(current_setting('t.f')));
select throws_ok(format($q$insert into storage.objects (bucket_id, name) values ('avatars', %L)$q$, pg_temp.uuidpath(current_setting('t.f'))),
  '42501', null, 'banned member cannot upload');
-- Direct DELETE on storage.objects is blocked by storage.protect_delete for every role (the Storage API sets the
-- bypass), so the delete policy is verified structurally.
select tests.clear_authentication();
select is((select cmd from pg_policies where schemaname = 'storage' and policyname = 'avatars_delete'), 'DELETE',
  'avatars delete policy exists');
select ok((select qual like '%current_member_id%' and qual like '%split_part%' from pg_policies
           where schemaname = 'storage' and policyname = 'avatars_delete'),
  'avatars delete policy is limited to the own folder');

-- ===== search =====
select tests.authenticate_as(pg_temp.up(current_setting('t.a')));
select is((select count(*)::int from public.search_members('ray') s where s.handle like 'ray%'), 2, 'search finds members by handle prefix');
select is((select s.handle from public.search_members('@ray_t') s), 'ray_two', 'leading @ is ignored and matches the handle');
select ok((select count(*) = 0 from public.search_members('ray') s where s.id = current_setting('t.f')::uuid), 'search skips banned members');
select is((select count(*)::int from public.search_members('ray') s where s.avatar_path is not null), 0, 'search returns avatar_path');

select * from finish();
rollback;
