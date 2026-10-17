begin;
select plan(51);

-- privileges / security mode
select ok(not (select prosecdef from pg_proc where oid = 'public.search_messages(text,integer,uuid)'::regprocedure), 'search_messages is SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid = 'public.search_members(text,integer)'::regprocedure), 'search_members is SECURITY INVOKER');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('public.search_messages(text,integer,uuid)'::regprocedure, 'public.search_members(text,integer)'::regprocedure,
                           'public._search_tsquery(text)'::regprocedure, 'public.f_unaccent(text)'::regprocedure)),
  'search functions pin an empty search_path');
select ok(not has_function_privilege('anon', 'public.search_messages(text,integer,uuid)', 'execute'), 'anon cannot search_messages');
select ok(not has_function_privilege('anon', 'public.search_members(text,integer)', 'execute'), 'anon cannot search_members');
select ok(not has_function_privilege('anon', 'public._search_tsquery(text)', 'execute'), 'anon cannot _search_tsquery');
select ok(has_function_privilege('authenticated', 'public.search_messages(text,integer,uuid)', 'execute'), 'authenticated can search_messages');
select ok(has_function_privilege('authenticated', 'public.search_members(text,integer)', 'execute'), 'authenticated can search_members');
select ok(has_function_privilege('authenticated', 'public._search_tsquery(text)', 'execute'), 'authenticated can _search_tsquery');
select ok((select p.provolatile = 'i' and p.proparallel = 's' and p.proisstrict from pg_proc p where p.oid = 'public.f_unaccent(text)'::regprocedure),
  'f_unaccent is immutable strict');
select has_index('public', 'messages', 'messages_search_idx', 'GIN index exists');
select is((select am.amname from pg_class c join pg_am am on am.oid = c.relam where c.relname = 'messages_search_idx'), 'gin', 'index is GIN');

-- helper: pure functions
select is(public.f_unaccent('Línea ñandú'), 'Linea nandu', 'f_unaccent strips accents');
select is(public._search_tsquery('Línea  Dos')::text, '''linea'':* & ''dos'':*', 'tsquery tokenizes, unaccents, prefixes');
select is(public._search_tsquery('a & b | !c:*')::text, '''a'':* & ''b'':* & ''c'':*', 'operators are stripped, only words remain');
select is(public._search_tsquery('x')::text, null, 'one char -> null');
select is(public._search_tsquery('   ')::text, null, 'blank -> null');
select is(public._search_tsquery(null)::text, null, 'null -> null');
select is(public._search_tsquery('😀😀')::text, null, 'emoji only -> null');
select is((select count(*)::int from regexp_matches(public._search_tsquery('a1 b2 c3 d4 e5 f6 g7 h8 i9 j0')::text, '&', 'g')), 7, 'at most 8 terms');

-- fixtures
select set_config('t.a', tests.create_member('0x' || lpad('d4000', 40, '0'), null, true)::text, true);
select set_config('t.u', tests.create_member('0xabcdef' || lpad('4001', 34, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ban', tests.create_member('0x' || lpad('d4002', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.v', tests.create_member('0x' || lpad('d4003', 40, '0'), current_setting('t.a')::uuid)::text, true);
update public.members set display_name = 'Ángela Pérez' where id = current_setting('t.u')::uuid;
update public.members set display_name = 'Baneada Ban' where id = current_setting('t.ban')::uuid;
update public.members set display_name = '100%_real' where id = current_setting('t.v')::uuid;
update public.members set status = 'banned' where id = current_setting('t.ban')::uuid;
select set_config('t.uu', (select auth_user_id::text from public.members where id = current_setting('t.u')::uuid), true);
select set_config('t.uban', (select auth_user_id::text from public.members where id = current_setting('t.ban')::uuid), true);

select set_config('t.cat', tests.create_channel(null, 'category', 'T400cat')::text, true);
select set_config('t.txt', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't400txt')::text, true);
select set_config('t.txt2', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't400txt2')::text, true);
select set_config('t.catH', tests.create_channel(null, 'category', 'T400hid')::text, true);
select set_config('t.txtH', tests.create_channel(current_setting('t.catH')::uuid, 'text', 't400hid')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
  (current_setting('t.catH')::uuid, 'role', (select id from public.roles where is_everyone), 0, 1);

create function tests.ins(p_ch uuid, p_text text, p_root uuid default null, p_deleted boolean default false)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.messages (id, channel_id, thread_root_id, author_id, body, body_text, allow_links, deleted_at)
  values (v_id, p_ch, p_root, current_setting('t.a')::uuid, '{"type":"doc","content":[]}'::jsonb, p_text, true,
          case when p_deleted then now() end);
  return v_id;
end $$;

select set_config('t.m1', tests.ins(current_setting('t.txt')::uuid, 'Una Línea de prueba zebra')::text, true);
select set_config('t.m2', tests.ins(current_setting('t.txt2')::uuid, 'otra linea zebra zebra')::text, true);
select set_config('t.mr', tests.ins(current_setting('t.txt')::uuid, 'respuesta linea en hilo', current_setting('t.m1')::uuid)::text, true);
select set_config('t.mh', tests.ins(current_setting('t.txtH')::uuid, 'linea secreta zebra', null)::text, true);
select set_config('t.md', tests.ins(current_setting('t.txt')::uuid, 'linea borrada zebra', null, true)::text, true);
select tests.ins(current_setting('t.txt')::uuid, '');

-- generated column is accent-insensitive
select is((select search_tsv::text from public.messages where id = current_setting('t.m1')::uuid), '''de'':3 ''linea'':2 ''prueba'':4 ''una'':1 ''zebra'':5', 'search_tsv unaccented');

-- messages as a member
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is((select count(*)::int from public.search_messages('linea')), 3, '"linea" finds Línea, linea, reply; not hidden or deleted');
select is((select count(*)::int from public.search_messages('Línea')), 3, 'accented query matches the same rows');
select is((select count(*)::int from public.search_messages('lin')), 3, 'prefix "lin" matches');
select is((select count(*)::int from public.search_messages('linea', 20, current_setting('t.txtH')::uuid)), 0, 'p_channel pointing at hidden channel returns nothing');
select is((select count(*)::int from public.search_messages('linea', 20, current_setting('t.txt')::uuid)), 2, 'p_channel filters to one channel');
select is((select thread_root_id from public.search_messages('respuesta')), current_setting('t.m1')::uuid, 'reply carries thread_root_id');
select is((select id from public.search_messages('zebra') limit 1), current_setting('t.m2')::uuid, 'higher ts_rank first');
select is((select snippet from public.search_messages('prueba')), 'Una Línea de prueba zebra', 'snippet is plain left(body_text,160)');
select is((select count(*)::int from public.search_messages('linea', 0)), 1, 'p_limit 0 clamps to 1');
select is((select count(*)::int from public.search_messages('linea', 500)), 3, 'p_limit 500 clamps to 50');
select lives_ok($q$select * from public.search_messages('a & b | !c:*')$q$, 'tsquery syntax is harmless');
select lives_ok($q$select * from public.search_messages('''); drop table x; --')$q$, 'sql injection attempt is harmless');
select lives_ok($q$select * from public.search_messages('%_\')$q$, 'like chars are harmless');
select is((select count(*)::int from public.search_messages('😀😀')), 0, 'emoji-only query returns nothing');
select lives_ok(format($q$select * from public.search_messages(%L)$q$, repeat('lineaa ', 1500)), '10k char query does not error');
select is((select count(*)::int from public.search_messages('')), 0, 'empty query returns nothing');
select is((select count(*)::int from public.search_messages(null)), 0, 'null query returns nothing');

-- members as a member
select is((select count(*)::int from public.search_members('angela')), 1, 'name search ignores accents/case');
select is((select count(*)::int from public.search_members('abcdef0')), 1, 'wallet prefix without 0x');
select is((select count(*)::int from public.search_members('0xabcdef0')), 1, 'wallet prefix with 0x');
select is((select count(*)::int from public.search_members('abc')), 0, 'short non-hex-length query does not wallet-match');
select is((select count(*)::int from public.search_members('a%')), 0, '% is not a wildcard');
select is((select count(*)::int from public.search_members('0%real')), 0, 'wildcards escaped inside the term');
select is((select count(*)::int from public.search_members('100%_')), 1, 'literal % and _ match literally');
select is((select count(*)::int from public.search_members('baneada')), 0, 'banned members never listed');
select is((select count(*)::int from public.search_members('')), 0, 'empty member query returns nothing');
select lives_ok($q$select * from public.search_members('\')$q$, 'backslash is harmless');
select tests.clear_authentication();

-- banned caller and anon
select tests.authenticate_as(current_setting('t.uban')::uuid);
select is((select count(*)::int from public.search_messages('linea')), 0, 'banned caller gets nothing from messages');
select is((select count(*)::int from public.search_members('angela')), 0, 'banned caller gets nothing from members');
select tests.clear_authentication();
set local role anon;
select throws_ok($q$select * from public.search_messages('linea')$q$, '42501', null, 'anon cannot call search_messages');
reset role;

select * from finish();
rollback;
