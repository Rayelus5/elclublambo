begin;
select plan(40);

-- tables + RLS + privileges
select has_table('public', 'channels', 'channels exists');
select has_table('public', 'permission_overwrites', 'permission_overwrites exists');
select ok((select relrowsecurity from pg_class where oid = 'public.channels'::regclass), 'channels RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.permission_overwrites'::regclass), 'overwrites RLS on');
select ok(not has_table_privilege('anon', 'public.channels', 'select'), 'anon no select on channels');
select ok(not has_table_privilege('anon', 'public.permission_overwrites', 'select'), 'anon no select on overwrites');
select ok(not has_table_privilege('authenticated', 'public.channels', 'insert')
  and not has_table_privilege('authenticated', 'public.channels', 'update')
  and not has_table_privilege('authenticated', 'public.channels', 'delete')
  and not has_table_privilege('authenticated', 'public.channels', 'truncate'), 'authenticated cannot write channels');
select ok(not has_table_privilege('authenticated', 'public.permission_overwrites', 'insert')
  and not has_table_privilege('authenticated', 'public.permission_overwrites', 'update')
  and not has_table_privilege('authenticated', 'public.permission_overwrites', 'delete')
  and not has_table_privilege('authenticated', 'public.permission_overwrites', 'truncate'), 'authenticated cannot write overwrites');
select ok(has_table_privilege('authenticated', 'public.channels', 'select'), 'authenticated can select channels');

-- valid tree
select set_config('t.cat', tests.create_channel(null, 'category', 'General')::text, true);
select set_config('t.f1', tests.create_channel(current_setting('t.cat')::uuid, 'forum', 'f1')::text, true);
select set_config('t.f2', tests.create_channel(current_setting('t.f1')::uuid, 'forum', 'f2')::text, true);
select set_config('t.f3', tests.create_channel(current_setting('t.f2')::uuid, 'forum', 'f3')::text, true);
select set_config('t.f4', tests.create_channel(current_setting('t.f3')::uuid, 'forum', 'f4')::text, true);
select set_config('t.f5', tests.create_channel(current_setting('t.f4')::uuid, 'forum', 'f5')::text, true);   -- depth 6
select set_config('t.txt', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'chat')::text, true);

select lives_ok($$select tests.create_channel(null, 'category', 'Otra')$$, 'second root category ok');

-- shape rules
select throws_ok($$select tests.create_channel(current_setting('t.cat')::uuid, 'category', 'x')$$, 'P0001', 'invalid_tree', 'category with parent');
select throws_ok($$select tests.create_channel(current_setting('t.txt')::uuid, 'text', 'x')$$, 'P0001', 'invalid_tree', 'text as parent');
select throws_ok($$select tests.create_channel(null, 'forum', 'x')$$, 'P0001', 'invalid_tree', 'forum at root');
select throws_ok($$select tests.create_channel(null, 'text', 'x')$$, 'P0001', 'invalid_tree', 'text at root');

-- depth
select throws_ok($$select tests.create_channel(current_setting('t.f5')::uuid, 'text', 'deep')$$, 'P0001', 'depth_limit', 'depth 7 rejected');
select lives_ok($$select tests.create_channel(current_setting('t.f4')::uuid, 'text', 'ok6')$$, 'depth 6 ok');

-- cycles
select throws_ok($$update public.channels set parent_id = current_setting('t.f2')::uuid where id = current_setting('t.f1')::uuid$$,
  'P0001', 'invalid_tree', 'move forum under its child');
select throws_ok($$update public.channels set parent_id = id where id = current_setting('t.f1')::uuid$$,
  'P0001', 'invalid_tree', 'move forum under itself');

-- subtree depth on move: f1 subtree (f1..f5) has height 5; moving under a depth-2 node -> 7
select set_config('t.g1', tests.create_channel(current_setting('t.cat')::uuid, 'forum', 'g1')::text, true);
select throws_ok($$update public.channels set parent_id = current_setting('t.g1')::uuid where id = current_setting('t.f1')::uuid$$,
  'P0001', 'depth_limit', 'subtree move exceeding depth');
select is((select parent_id from public.channels where id = current_setting('t.f1')::uuid), current_setting('t.cat')::uuid, 'failed move left tree intact');

-- subtree of height 3 (f3..f5) under depth-4 node would be 7: move f3 under a depth 2 node is fine, check boundary
select set_config('t.h1', tests.create_channel(current_setting('t.g1')::uuid, 'forum', 'h1')::text, true);   -- depth 3
select set_config('t.h2', tests.create_channel(current_setting('t.h1')::uuid, 'forum', 'h2')::text, true);   -- depth 4
select throws_ok($$update public.channels set parent_id = current_setting('t.h2')::uuid where id = current_setting('t.f3')::uuid$$,
  'P0001', 'depth_limit', 'height-3 subtree under depth-4 node');
select lives_ok($$update public.channels set parent_id = current_setting('t.h1')::uuid where id = current_setting('t.f3')::uuid$$,
  'height-3 subtree under depth-3 node ok (depth 6)');

-- kind change with children
select throws_ok($$update public.channels set kind = 'text' where id = current_setting('t.g1')::uuid$$, 'P0001', 'invalid_tree', 'cannot turn parent into text');

-- restrict
select throws_ok($$delete from public.channels where id = current_setting('t.cat')::uuid$$, '23503', null, 'delete with children restricted');

-- column checks
select throws_ok($$update public.channels set slowmode_seconds = 3 where id = current_setting('t.txt')::uuid$$, '23514', null, 'slowmode 3');
select throws_ok($$update public.channels set slowmode_seconds = 604801 where id = current_setting('t.txt')::uuid$$, '23514', null, 'slowmode 604801');
select lives_ok($$update public.channels set slowmode_seconds = 5 where id = current_setting('t.txt')::uuid$$, 'slowmode 5');
select throws_ok($$update public.channels set tickets_enabled = true where id = current_setting('t.g1')::uuid$$, '23514', null, 'tickets on forum');
select throws_ok($$update public.channels set alpha_enabled = true where id = current_setting('t.g1')::uuid$$, '23514', null, 'alpha on forum');
select lives_ok($$update public.channels set tickets_enabled = true where id = current_setting('t.txt')::uuid$$, 'tickets on text');

-- overwrites
select throws_ok($$insert into public.permission_overwrites (channel_id, target_type, target_id, allow)
  values (current_setting('t.txt')::uuid, 'role', (select id from public.roles where is_everyone), 16)$$, '23514', null, 'bit 16 not allowed');
select throws_ok($$insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.txt')::uuid, 'role', (select id from public.roles where is_everyone), 1, 1)$$, '23514', null, 'allow & deny overlap');

-- cleanup of overwrites when role / member deleted
insert into public.roles (name, color, position, permissions) values ('Temp', '#112233', 5, 0);
select set_config('t.role', (select id::text from public.roles where name = 'Temp'), true);
select set_config('t.mem', tests.create_member('0xf000000000000000000000000000000000000001', null, true)::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow)
  values (current_setting('t.txt')::uuid, 'role', current_setting('t.role')::uuid, 1),
         (current_setting('t.txt')::uuid, 'member', current_setting('t.mem')::uuid, 2);
delete from public.roles where id = current_setting('t.role')::uuid;
select is((select count(*)::int from public.permission_overwrites where target_type = 'role' and target_id = current_setting('t.role')::uuid), 0, 'role delete cleans overwrites');
delete from public.members where id = current_setting('t.mem')::uuid;
select is((select count(*)::int from public.permission_overwrites where target_type = 'member' and target_id = current_setting('t.mem')::uuid), 0, 'member delete cleans overwrites');

-- fix round 1
select throws_ok($$update public.channels set kind = 'forum' where id = current_setting('t.cat')::uuid$$, 'P0001', 'invalid_tree', 'root category -> forum');
select throws_ok($$update public.channels set kind = 'category' where id = current_setting('t.h2')::uuid$$, 'P0001', 'invalid_tree', 'child forum -> category');
select throws_ok($$update public.channels set kind = 'forum' where id = current_setting('t.txt')::uuid$$, '23514', null, 'text with tickets -> forum');
select throws_ok($$select tests.create_channel(gen_random_uuid(), 'forum', 'x')$$, 'P0001', 'invalid_tree', 'nonexistent parent');
select throws_ok($$insert into public.permission_overwrites (channel_id, target_type, target_id, allow)
  values (current_setting('t.txt')::uuid, 'role', gen_random_uuid(), 1)$$, 'P0001', 'invalid_input', 'nonexistent overwrite target');
select throws_ok($$update public.channels set gate_min_share_bps = 10001 where id = current_setting('t.txt')::uuid$$, '23514', null, 'gate_min_share_bps is capped at 10000');

select * from finish();
rollback;
