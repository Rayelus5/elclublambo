begin;
select plan(50);

-- privileges
select ok(not has_function_privilege('anon', 'public.create_channel(uuid,text,text,text)', 'execute'), 'anon cannot create_channel');
select ok(not has_function_privilege('anon', 'public.update_channel(uuid,text,text,int,boolean,boolean)', 'execute'), 'anon cannot update_channel');
select ok(not has_function_privilege('anon', 'public.move_channel(uuid,uuid,int)', 'execute'), 'anon cannot move_channel');
select ok(not has_function_privilege('anon', 'public.delete_channel(uuid)', 'execute'), 'anon cannot delete_channel');
select ok(has_function_privilege('authenticated', 'public.create_channel(uuid,text,text,text)', 'execute'), 'authenticated can create_channel');
select ok(has_function_privilege('authenticated', 'public.move_channel(uuid,uuid,int)', 'execute'), 'authenticated can move_channel');

-- fixtures: a = admin, b = manager (128, position 50), c = plain member
select set_config('t.a', tests.create_member('0x00000000000000000000000000000000000b0001', null, true)::text, true);
select set_config('t.b', tests.create_member('0x00000000000000000000000000000000000b0002', current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x00000000000000000000000000000000000b0003', current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions)
  values (gen_random_uuid(), 'T090 gestor', '#AAAAAA', 50, 128);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.b')::uuid, id from public.roles where name = 'T090 gestor';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
select set_config('t.everyone', (select id::text from public.roles where is_everyone), true);

select set_config('t.cat1', tests.create_channel(null, 'category', 'Visible')::text, true);
select set_config('t.cat2', tests.create_channel(null, 'category', 'Oculta')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.cat2')::uuid, 'role', current_setting('t.everyone')::uuid, 0, 1);
select set_config('t.hid', tests.create_channel(current_setting('t.cat2')::uuid, 'text', 'secreto')::text, true);

-- no 128 -> forbidden
select tests.authenticate_as(current_setting('t.uc')::uuid);
select throws_ok(format($q$select public.create_channel(%L::uuid, 'forum', 'X')$q$, current_setting('t.cat1')),
  'P0001', 'forbidden', 'plain member cannot create');
select throws_ok(format($q$select public.update_channel(%L::uuid, 'X', null, 0, false, false)$q$, current_setting('t.cat1')),
  'P0001', 'forbidden', 'plain member cannot update');
select throws_ok(format($q$select public.move_channel(%L::uuid, null, 0)$q$, current_setting('t.cat1')),
  'P0001', 'forbidden', 'plain member cannot move');
select throws_ok(format($q$select public.delete_channel(%L::uuid)$q$, current_setting('t.cat1')),
  'P0001', 'forbidden', 'plain member cannot delete');

-- 128 but no VIEW on destination / node
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.create_channel(%L::uuid, 'forum', 'X')$q$, current_setting('t.cat2')),
  'P0001', 'forbidden', 'manager cannot create under hidden parent');
select throws_ok(format($q$select public.update_channel(%L::uuid, 'X', null, 0, false, false)$q$, current_setting('t.hid')),
  'P0001', 'forbidden', 'manager cannot update hidden node');
select throws_ok(format($q$select public.delete_channel(%L::uuid)$q$, current_setting('t.hid')),
  'P0001', 'forbidden', 'manager cannot delete hidden node');

-- happy create (manager); root category needs only 128
select set_config('t.f', public.create_channel(current_setting('t.cat1')::uuid, 'forum', '  Foro  ', 'tema')::text, true);
select tests.clear_authentication();
select is((select name from public.channels where id = current_setting('t.f')::uuid), 'Foro', 'create trims name');
select is((select position from public.channels where id = current_setting('t.f')::uuid), 0, 'first child at position 0');
select is((select created_by from public.channels where id = current_setting('t.f')::uuid), current_setting('t.b')::uuid, 'created_by is actor');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.g', public.create_channel(current_setting('t.cat1')::uuid, 'forum', 'G')::text, true);
select set_config('t.t1', public.create_channel(current_setting('t.f')::uuid, 'text', 't1')::text, true);
select set_config('t.t2', public.create_channel(current_setting('t.f')::uuid, 'text', 't2')::text, true);
select set_config('t.t3', public.create_channel(current_setting('t.f')::uuid, 'text', 't3')::text, true);
select lives_ok($q$select public.create_channel(null, 'category', 'Nueva raiz')$q$, 'manager creates root category with only 128');
select tests.clear_authentication();
select is((select position from public.channels where id = current_setting('t.g')::uuid), 1, 'append: second sibling at position 1');
select is((select array_agg(position order by position) from public.channels where parent_id = current_setting('t.f')::uuid), array[0,1,2], 'children appended 0..2');

-- validation
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.create_channel(%L::uuid, 'forum', '   ')$q$, current_setting('t.cat1')), 'P0001', 'invalid_input', 'empty name');
select throws_ok(format($q$select public.create_channel(%L::uuid, 'forum', %L)$q$, current_setting('t.cat1'), repeat('x', 51)), 'P0001', 'invalid_input', 'name too long');
select throws_ok(format($q$select public.create_channel(%L::uuid, 'forum', 'X', %L)$q$, current_setting('t.cat1'), repeat('x', 301)), 'P0001', 'invalid_input', 'topic too long');
select throws_ok(format($q$select public.create_channel(%L::uuid, 'banana', 'X')$q$, current_setting('t.cat1')), 'P0001', 'invalid_input', 'unknown kind');
select throws_ok($q$select public.create_channel(gen_random_uuid(), 'forum', 'X')$q$, 'P0001', 'invalid_input', 'nonexistent parent');
select throws_ok($q$select public.create_channel(null, 'text', 'X')$q$, 'P0001', 'invalid_tree', 'text at root -> invalid_tree from trigger');
select throws_ok(format($q$select public.update_channel(%L::uuid, 'X', null, 3, false, false)$q$, current_setting('t.t1')), 'P0001', 'invalid_input', 'slowmode 3 invalid');
select throws_ok(format($q$select public.update_channel(%L::uuid, 'X', null, 0, true, false)$q$, current_setting('t.f')), 'P0001', 'invalid_input', 'tickets on forum invalid');
select throws_ok($q$select public.update_channel(gen_random_uuid(), 'X', null, 0, false, false)$q$, 'P0001', 'invalid_input', 'update nonexistent');

-- update happy
select lives_ok(format($q$select public.update_channel(%L::uuid, 'Renombrado', 'nuevo tema', 60, true, true)$q$, current_setting('t.t1')), 'update text channel');
select tests.clear_authentication();
select is((select (name, topic, slowmode_seconds, tickets_enabled, alpha_enabled)::text from public.channels where id = current_setting('t.t1')::uuid),
  '(Renombrado,"nuevo tema",60,t,t)', 'update applied');

-- move: reorder within same parent (t3 -> index 0), contiguous
select tests.authenticate_as(current_setting('t.ub')::uuid);
select lives_ok(format($q$select public.move_channel(%L::uuid, %L::uuid, 0)$q$, current_setting('t.t3'), current_setting('t.f')), 'reorder within same parent');
select tests.clear_authentication();
select is((select array_agg(id order by position) from public.channels where parent_id = current_setting('t.f')::uuid),
  array[current_setting('t.t3')::uuid, current_setting('t.t1')::uuid, current_setting('t.t2')::uuid], 'order t3,t1,t2');
select is((select array_agg(position order by position) from public.channels where parent_id = current_setting('t.f')::uuid), array[0,1,2], 'contiguous after reorder');

-- move to another parent, index clamped
select tests.authenticate_as(current_setting('t.ub')::uuid);
select lives_ok(format($q$select public.move_channel(%L::uuid, %L::uuid, 99)$q$, current_setting('t.t1'), current_setting('t.g')), 'move to other parent with clamped index');
select tests.clear_authentication();
select is((select array_agg(position order by position) from public.channels where parent_id = current_setting('t.f')::uuid), array[0,1], 'source siblings renumbered');
select is((select position from public.channels where id = current_setting('t.t1')::uuid), 0, 'destination index clamped to end');

-- move into own descendant -> invalid_tree, tree intact
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.move_channel(%L::uuid, %L::uuid, 0)$q$, current_setting('t.f'), current_setting('t.t2')), 'P0001', 'invalid_tree', 'move under text child -> invalid_tree');
select tests.clear_authentication();
select is((select parent_id from public.channels where id = current_setting('t.f')::uuid), current_setting('t.cat1')::uuid, 'tree unchanged after failed move');
select is((select array_agg(position order by position) from public.channels where parent_id = current_setting('t.cat1')::uuid), array[0,1], 'sibling positions unchanged after failed move');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.f2', public.create_channel(current_setting('t.f')::uuid, 'forum', 'sub')::text, true);
select throws_ok(format($q$select public.move_channel(%L::uuid, %L::uuid, 0)$q$, current_setting('t.f'), current_setting('t.f2')), 'P0001', 'invalid_tree', 'move under own descendant forum -> invalid_tree');
select throws_ok(format($q$select public.move_channel(%L::uuid, %L::uuid, 0)$q$, current_setting('t.t2'), current_setting('t.hid')), 'P0001', 'forbidden', 'move to hidden destination forbidden');

-- depth limit
select tests.clear_authentication();
select set_config('t.d2', tests.create_channel(current_setting('t.cat1')::uuid, 'forum', 'd2')::text, true);
select set_config('t.d3', tests.create_channel(current_setting('t.d2')::uuid, 'forum', 'd3')::text, true);
select set_config('t.d4', tests.create_channel(current_setting('t.d3')::uuid, 'forum', 'd4')::text, true);
select set_config('t.d5', tests.create_channel(current_setting('t.d4')::uuid, 'forum', 'd5')::text, true);
select set_config('t.d6', tests.create_channel(current_setting('t.d5')::uuid, 'forum', 'd6')::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.create_channel(%L::uuid, 'text', 'deep')$q$, current_setting('t.d6')), 'P0001', 'depth_limit', 'create beyond depth 6');
select throws_ok(format($q$select public.move_channel(%L::uuid, %L::uuid, 0)$q$, current_setting('t.g'), current_setting('t.d6')), 'P0001', 'depth_limit', 'move beyond depth 6');

-- delete
select throws_ok(format($q$select public.delete_channel(%L::uuid)$q$, current_setting('t.f')), 'P0001', 'not_empty', 'delete with children');
select lives_ok(format($q$select public.delete_channel(%L::uuid)$q$, current_setting('t.t2')), 'delete leaf');
select tests.clear_authentication();
select is((select count(*)::int from public.channels where id = current_setting('t.t2')::uuid), 0, 'leaf gone');

-- audit
select is((select array_agg(distinct action order by action) from public.audit_log where action like 'channel\_%'),
  array['channel_created','channel_deleted','channel_moved','channel_updated'], 'audit actions recorded');

-- can(): global bits are rejected
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($q$select public.can(%L::uuid, 128)$q$, current_setting('t.cat1')), 'P0001', 'invalid_input', 'can() rejects global bits');
select throws_ok(format($q$select public.can(%L::uuid, 33)$q$, current_setting('t.cat1')), 'P0001', 'invalid_input', 'can() rejects mixed bits');
select is(public.can(current_setting('t.cat1')::uuid, 3), true, 'can() still works for channel bits');

select * from finish();
rollback;
