begin;
select plan(132);

-- privileges
select ok(not has_function_privilege('anon', 'public.set_overwrite(uuid,text,uuid,bigint,bigint)', 'execute'), 'anon cannot set_overwrite');
select ok(not has_function_privilege('anon', 'public.create_role(text,text,bigint)', 'execute'), 'anon cannot create_role');
select ok(not has_function_privilege('anon', 'public.update_role(uuid,text,text,bigint)', 'execute'), 'anon cannot update_role');
select ok(not has_function_privilege('anon', 'public.delete_role(uuid)', 'execute'), 'anon cannot delete_role');
select ok(not has_function_privilege('anon', 'public.move_role(uuid,int)', 'execute'), 'anon cannot move_role');
select ok(not has_function_privilege('anon', 'public.add_allowed_domain(text)', 'execute'), 'anon cannot add_allowed_domain');
select ok(has_function_privilege('authenticated', 'public.set_overwrite(uuid,text,uuid,bigint,bigint)', 'execute'), 'authenticated can set_overwrite');
select ok(has_function_privilege('authenticated', 'public.remove_allowed_domain(text)', 'execute'), 'authenticated can remove_allowed_domain');

-- fixtures: a = admin, b = manager (64+128, pos 500), c = plain, d = pos 600, e = pos 5
select set_config('t.a', tests.create_member('0x00000000000000000000000000000000000c0001', null, true)::text, true);
select set_config('t.b', tests.create_member('0x00000000000000000000000000000000000c0002', current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x00000000000000000000000000000000000c0003', current_setting('t.a')::uuid)::text, true);
select set_config('t.d', tests.create_member('0x00000000000000000000000000000000000c0004', current_setting('t.a')::uuid)::text, true);
select set_config('t.e', tests.create_member('0x00000000000000000000000000000000000c0005', current_setting('t.a')::uuid)::text, true);
insert into public.roles (name, color, position, permissions) values
  ('T095 gestor', '#AAAAAA', 500, 192),
  ('T095 alto', '#BBBBBB', 600, 0),
  ('T095 bajo', '#CCCCCC', 5, 0);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.b')::uuid, id from public.roles where name = 'T095 gestor';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.d')::uuid, id from public.roles where name = 'T095 alto';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.e')::uuid, id from public.roles where name = 'T095 bajo';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
select set_config('t.everyone', (select id::text from public.roles where is_everyone), true);
select set_config('t.superadmin', (select id::text from public.roles where name = 'SuperAdmin'), true);
select set_config('t.verified', (select id::text from public.roles where system_key = 'verified'), true);
select set_config('t.gestor', (select id::text from public.roles where name = 'T095 gestor'), true);
select set_config('t.alto', (select id::text from public.roles where name = 'T095 alto'), true);
select set_config('t.bajo', (select id::text from public.roles where name = 'T095 bajo'), true);

select set_config('t.ch', tests.create_channel(null, 'category', 'Visible')::text, true);
select set_config('t.hid', tests.create_channel(null, 'category', 'Oculta')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.hid')::uuid, 'role', current_setting('t.everyone')::uuid, 0, 1);

-- ===== set_overwrite =====
select tests.authenticate_as(current_setting('t.uc')::uuid);
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 2, 0)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'P0001', 'forbidden', 'plain member cannot set_overwrite');

select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 2, 0)$q$, current_setting('t.hid'), current_setting('t.bajo')),
  'P0001', 'forbidden', 'cannot touch a channel you cannot view');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 8, 0)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'P0001', 'forbidden', 'cannot grant a bit you lack in that channel');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 8)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'P0001', 'forbidden', 'cannot deny a bit you lack in that channel');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 128, 0)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'P0001', 'invalid_input', 'global bit is invalid_input');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 2, 2)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'P0001', 'invalid_input', 'allow and deny overlap is invalid_input');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'team', %L::uuid, 2, 0)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'P0001', 'invalid_input', 'bad target type is invalid_input');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 2, 0)$q$, current_setting('t.ch'), current_setting('t.alto')),
  'P0001', 'hierarchy', 'role above actor is hierarchy');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 2, 0)$q$, current_setting('t.ch'), current_setting('t.gestor')),
  'P0001', 'hierarchy', 'own top role is hierarchy');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 2, 0)$q$, current_setting('t.ch'), current_setting('t.superadmin')),
  'P0001', 'forbidden', 'SuperAdmin role is forbidden');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'member', %L::uuid, 2, 0)$q$, current_setting('t.ch'), current_setting('t.b')),
  'P0001', 'hierarchy', 'overwrite on yourself is hierarchy');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'member', %L::uuid, 2, 0)$q$, current_setting('t.ch'), current_setting('t.d')),
  'P0001', 'hierarchy', 'overwrite on a higher member is hierarchy');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'member', %L::uuid, 2, 0)$q$, current_setting('t.ch'), gen_random_uuid()),
  'P0001', 'invalid_input', 'unknown member is invalid_input');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 2, 0)$q$, current_setting('t.ch'), gen_random_uuid()),
  'P0001', 'invalid_input', 'unknown role is invalid_input');

-- happy paths for the manager
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 8192, 0)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'manager can set an overwrite on a lower role');
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 2)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'manager can set an overwrite on @everyone');
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'member', %L::uuid, 4, 0)$q$, current_setting('t.ch'), current_setting('t.c')),
  'manager can set an overwrite on a lower member');
select tests.clear_authentication();
select is((select allow || ':' || deny from public.permission_overwrites
  where channel_id = current_setting('t.ch')::uuid and target_type = 'role' and target_id = current_setting('t.bajo')::uuid),
  '8192:0', 'role overwrite stored');
select is((select allow || ':' || deny from public.permission_overwrites
  where channel_id = current_setting('t.ch')::uuid and target_type = 'role' and target_id = current_setting('t.everyone')::uuid),
  '0:2', '@everyone overwrite stored');

select tests.authenticate_as(current_setting('t.ub')::uuid);
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 8192)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'upsert replaces the row');
select tests.clear_authentication();
select is((select count(*)::int from public.permission_overwrites
  where channel_id = current_setting('t.ch')::uuid and target_id = current_setting('t.bajo')::uuid), 1, 'upsert keeps a single row');
select is((select allow || ':' || deny from public.permission_overwrites
  where channel_id = current_setting('t.ch')::uuid and target_id = current_setting('t.bajo')::uuid), '0:8192', 'upsert updated values');

select tests.authenticate_as(current_setting('t.ub')::uuid);
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 0)$q$, current_setting('t.ch'), current_setting('t.bajo')),
  'allow=deny=0 succeeds');
select tests.clear_authentication();
select is((select count(*)::int from public.permission_overwrites
  where channel_id = current_setting('t.ch')::uuid and target_id = current_setting('t.bajo')::uuid), 0, 'allow=deny=0 deletes the row');

-- admin can do everything
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 8, 0)$q$, current_setting('t.ch'), current_setting('t.alto')),
  'admin can grant any channel bit to a high role');
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'member', %L::uuid, 8, 0)$q$, current_setting('t.ch'), current_setting('t.a')),
  'admin can set an overwrite on themselves');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 8, 0)$q$, current_setting('t.hid'), current_setting('t.superadmin')),
  'P0001', 'forbidden', 'even admin cannot target the SuperAdmin role');
select tests.clear_authentication();
select is((select allow from public.permission_overwrites
  where channel_id = current_setting('t.ch')::uuid and target_type = 'member' and target_id = current_setting('t.a')::uuid),
  8::bigint, 'admin self overwrite stored');
select is((select payload->>'allow' || ':' || (payload->>'deny') from public.audit_log
  where action = 'overwrite_set' and payload->>'target_id' = current_setting('t.alto')),
  '8:0', 'overwrite_set audited');

-- ===== create_role =====
select tests.authenticate_as(current_setting('t.uc')::uuid);
select throws_ok($q$select public.create_role('T095 x', '#112233', 2)$q$, 'P0001', 'forbidden', 'plain member cannot create_role');

select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($q$select public.create_role('T095 x', '#112233', 8)$q$, 'P0001', 'hierarchy', 'create with bits you lack is hierarchy');
select throws_ok($q$select public.create_role('T095 x', '#112233', 512)$q$, 'P0001', 'forbidden', 'create with ADMINISTRATOR is reserved');
select throws_ok($q$select public.create_role('T095 x', '#112233', 256)$q$, 'P0001', 'hierarchy', 'create with MANAGE_TREASURY you lack is hierarchy');
select throws_ok($q$select public.create_role('', '#112233', 2)$q$, 'P0001', 'invalid_input', 'empty name is invalid_input');
select throws_ok($q$select public.create_role(repeat('x', 33), '#112233', 2)$q$, 'P0001', 'invalid_input', 'long name is invalid_input');
select throws_ok($q$select public.create_role('T095 x', 'red', 2)$q$, 'P0001', 'invalid_input', 'bad color is invalid_input');
select throws_ok($q$select public.create_role('T095 x', '#112233', -1)$q$, 'P0001', 'invalid_input', 'negative permissions are invalid_input');
select throws_ok($q$select public.create_role('T095 gestor', '#112233', 2)$q$, 'P0001', 'invalid_input', 'duplicate name is invalid_input');
select set_config('t.r1', public.create_role('  T095 nuevo  ', '#abcdef', 2)::text, true);
select tests.clear_authentication();
select is((select name || ':' || color || ':' || permissions::text || ':' || position::text from public.roles where id = current_setting('t.r1')::uuid),
  'T095 nuevo:#ABCDEF:2:101', 'create trims, uppercases color and positions just above the next lower role');
select is((select count(*)::int from public.audit_log where action = 'role_created' and target_id = current_setting('t.r1')::uuid),
  1, 'role_created audited');

select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.r2', public.create_role('T095 admin role', '#123456', 65535 & ~512)::text, true);
select tests.clear_authentication();
select is((select position from public.roles where id = current_setting('t.r2')::uuid), 601,
  'admin role goes just above the highest role below SuperAdmin');

-- ===== update_role =====
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.update_role(%L::uuid, 'X', '#112233', 0)$q$, current_setting('t.alto')),
  'P0001', 'hierarchy', 'update a role above you is hierarchy');
select throws_ok(format($q$select public.update_role(%L::uuid, 'X', '#112233', 0)$q$, current_setting('t.gestor')),
  'P0001', 'hierarchy', 'update your own top role is hierarchy');
select throws_ok(format($q$select public.update_role(%L::uuid, 'T095 nuevo', '#112233', 8)$q$, current_setting('t.r1')),
  'P0001', 'hierarchy', 'update granting bits you lack is hierarchy');
select throws_ok(format($q$select public.update_role(%L::uuid, 'T095 bajo', '#112233', 2)$q$, current_setting('t.r1')),
  'P0001', 'invalid_input', 'rename to an existing name is invalid_input');
select lives_ok(format($q$select public.update_role(%L::uuid, 'T095 renombrado', '#00ff00', 4)$q$, current_setting('t.r1')),
  'update a lower role');
select throws_ok(format($q$select public.update_role(%L::uuid, 'x', '#112233', 0)$q$, current_setting('t.superadmin')),
  'P0001', 'forbidden', 'update a system role is forbidden');
select throws_ok(format($q$select public.update_role(%L::uuid, 'Nuevo nombre', '#112233', 8199)$q$, current_setting('t.everyone')),
  'P0001', 'forbidden', '@everyone cannot be renamed');
select throws_ok(format($q$select public.update_role(%L::uuid, (select name from public.roles where is_everyone), '#112233', 8199)$q$, current_setting('t.everyone')),
  'P0001', 'forbidden', '@everyone color cannot change');
select lives_ok(format($q$select public.update_role(%L::uuid, (select name from public.roles where is_everyone), (select color from public.roles where is_everyone), 8195)$q$, current_setting('t.everyone')),
  '@everyone permissions can change within the actor''s own');
select throws_ok(format($q$select public.update_role(%L::uuid, (select name from public.roles where is_everyone), (select color from public.roles where is_everyone), 8199 | 16)$q$, current_setting('t.everyone')),
  'P0001', 'hierarchy', '@everyone permissions limited to the actor''s own');
select throws_ok(format($q$select public.update_role(%L::uuid, 'Verificado 2', '#3DDC84', 2)$q$, current_setting('t.verified')),
  'P0001', 'forbidden', 'system_key roles cannot be renamed');
select lives_ok(format($q$select public.update_role(%L::uuid, 'Verificado', '#3ddc85', 3072)$q$, current_setting('t.verified')),
  'system_key role color and permissions are editable');
select tests.clear_authentication();
select is((select name || ':' || color || ':' || permissions::text from public.roles where id = current_setting('t.r1')::uuid),
  'T095 renombrado:#00FF00:4', 'update stored (color uppercased)');
select is((select permissions from public.roles where is_everyone), 8195::bigint, '@everyone permissions stored');
select is((select color from public.roles where id = current_setting('t.verified')::uuid), '#3DDC85', 'Verificado color stored');
select is((select count(*)::int from public.audit_log where action = 'role_updated'), 3, 'role_updated audited');

-- ===== move_role =====
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.move_role(%L::uuid, 500)$q$, current_setting('t.bajo')),
  'P0001', 'hierarchy', 'move to your own level is hierarchy');
select throws_ok(format($q$select public.move_role(%L::uuid, 600)$q$, current_setting('t.bajo')),
  'P0001', 'hierarchy', 'move above yourself is hierarchy');
select throws_ok(format($q$select public.move_role(%L::uuid, 0)$q$, current_setting('t.bajo')),
  'P0001', 'hierarchy', 'move to position 0 is hierarchy');
select throws_ok(format($q$select public.move_role(%L::uuid, 7)$q$, current_setting('t.everyone')),
  'P0001', 'forbidden', '@everyone cannot move');
select throws_ok(format($q$select public.move_role(%L::uuid, 7)$q$, current_setting('t.superadmin')),
  'P0001', 'forbidden', 'system role cannot move');
select throws_ok(format($q$select public.move_role(%L::uuid, 7)$q$, current_setting('t.alto')),
  'P0001', 'hierarchy', 'a role above you cannot be moved');
select lives_ok(format($q$select public.move_role(%L::uuid, 101)$q$, current_setting('t.bajo')),
  'move onto an occupied slot');
select tests.clear_authentication();
select is((select position from public.roles where id = current_setting('t.bajo')::uuid), 101, 'moved role takes the slot');
select is((select position from public.roles where id = current_setting('t.r1')::uuid), 102, 'occupant shifted up by one');
select is((select position from public.roles where id = current_setting('t.gestor')::uuid), 500, 'roles at the actor level untouched');
select is((select position from public.roles where is_everyone), 0, '@everyone untouched');
select is((select count(*)::int from public.audit_log where action = 'role_moved' and target_id = current_setting('t.bajo')::uuid),
  1, 'role_moved audited');

-- shifting must never reach the actor's top
insert into public.roles (name, color, position, permissions) values ('T095 tope', '#DDDDDD', 499, 0);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.move_role(%L::uuid, 499)$q$, current_setting('t.bajo')),
  'P0001', 'hierarchy', 'shift that would reach the actor level is hierarchy');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($q$select public.move_role(%L::uuid, 1000)$q$, current_setting('t.bajo')),
  'P0001', 'hierarchy', 'admin cannot move to SuperAdmin level');
select lives_ok(format($q$select public.move_role(%L::uuid, 999)$q$, current_setting('t.bajo')),
  'admin can move up to 999');
select tests.clear_authentication();

-- ===== delete_role =====
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.delete_role(%L::uuid)$q$, current_setting('t.superadmin')),
  'P0001', 'forbidden', 'cannot delete a system role');
select throws_ok(format($q$select public.delete_role(%L::uuid)$q$, current_setting('t.everyone')),
  'P0001', 'forbidden', 'cannot delete @everyone');
select throws_ok(format($q$select public.delete_role(%L::uuid)$q$, current_setting('t.verified')),
  'P0001', 'forbidden', 'cannot delete a system_key role');
select throws_ok(format($q$select public.delete_role(%L::uuid)$q$, current_setting('t.alto')),
  'P0001', 'hierarchy', 'cannot delete a role above you');
select throws_ok(format($q$select public.delete_role(%L::uuid)$q$, gen_random_uuid()),
  'P0001', 'invalid_input', 'unknown role is invalid_input');
select tests.authenticate_as(current_setting('t.uc')::uuid);
select throws_ok(format($q$select public.delete_role(%L::uuid)$q$, current_setting('t.r1')),
  'P0001', 'forbidden', 'plain member cannot delete a role');

-- cascade: r1 gets a member, an overwrite; then is deleted
select tests.clear_authentication();
insert into public.member_roles (member_id, role_id) values (current_setting('t.e')::uuid, current_setting('t.r1')::uuid);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.ch')::uuid, 'role', current_setting('t.r1')::uuid, 2, 0);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select lives_ok(format($q$select public.delete_role(%L::uuid)$q$, current_setting('t.r1')), 'manager deletes a lower role');
select tests.clear_authentication();
select is((select count(*)::int from public.roles where id = current_setting('t.r1')::uuid), 0, 'role gone');
select is((select count(*)::int from public.member_roles where role_id = current_setting('t.r1')::uuid), 0, 'member_roles cascaded');
select is((select count(*)::int from public.permission_overwrites where target_id = current_setting('t.r1')::uuid), 0, 'overwrites cascaded');
select ok(public.channel_permissions(current_setting('t.e')::uuid, current_setting('t.ch')::uuid) is not null,
  'permissions recompute after the role is gone');
select is((select count(*)::int from public.audit_log where action = 'role_deleted' and target_id = current_setting('t.r1')::uuid),
  1, 'role_deleted audited');

-- ===== allowed_domains =====
select is((select count(*)::int from public.allowed_domains), 7, 'seeded domains');
select ok((select bool_and(domain in ('lineascan.build','sepolia.lineascan.build','linea.build','github.com','x.com','dexscreener.com','etherscan.io'))
  from public.allowed_domains), 'seed list is exact');
select tests.authenticate_as(current_setting('t.uc')::uuid);
select is((select count(*)::int from public.allowed_domains), 7, 'active members can read domains');
select throws_ok($q$select public.add_allowed_domain('example.com')$q$, 'P0001', 'forbidden', 'add without 128 is forbidden');
select throws_ok($q$select public.remove_allowed_domain('x.com')$q$, 'P0001', 'forbidden', 'remove without 128 is forbidden');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($q$select public.add_allowed_domain('not a domain')$q$, 'P0001', 'invalid_input', 'bad format is invalid_input');
select throws_ok($q$select public.add_allowed_domain('nodot')$q$, 'P0001', 'invalid_input', 'no tld is invalid_input');
select lives_ok($q$select public.add_allowed_domain('  Example.COM ')$q$, 'add normalizes case and spaces');
select lives_ok($q$select public.add_allowed_domain('example.com')$q$, 'add is idempotent');
select is((select count(*)::int from public.allowed_domains where domain = 'example.com'), 1, 'domain stored once, lowercase');
select lives_ok($q$select public.remove_allowed_domain('EXAMPLE.com')$q$, 'remove normalizes');
select is((select count(*)::int from public.allowed_domains), 7, 'domain removed');
select tests.clear_authentication();
select ok((select count(*) from public.audit_log where action in ('domain_added', 'domain_removed')) >= 2, 'domain changes audited');

-- ===== fix round 1: changed-bits rule, mass grants, reserved 512, domain regex, audit only on change =====
insert into public.roles (name, color, position, permissions) values
  ('T095 medio', '#EEEEEE', 50, 0),
  ('T095 carga', '#EEEEEF', 51, 32);
select set_config('t.medio', (select id::text from public.roles where name = 'T095 medio'), true);
select set_config('t.carga', (select id::text from public.roles where name = 'T095 carga'), true);
select set_config('t.ro', tests.create_channel(null, 'category', 'SoloLectura')::text, true);

select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 2)$q$, current_setting('t.ro'), current_setting('t.everyone')),
  'admin sets @everyone deny=SEND on read-only channel');
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 2)$q$, current_setting('t.ro'), current_setting('t.medio')),
  'admin sets role deny=SEND on read-only channel');

select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 0)$q$, current_setting('t.ro'), current_setting('t.everyone')),
  'P0001', 'forbidden', 'deleting an @everyone deny the actor lacks is forbidden');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 8192)$q$, current_setting('t.ro'), current_setting('t.everyone')),
  'P0001', 'forbidden', 'replacing an @everyone deny the actor lacks is forbidden');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 0)$q$, current_setting('t.ro'), current_setting('t.medio')),
  'P0001', 'forbidden', 'deleting a lower-role deny the actor lacks is forbidden');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 4)$q$, current_setting('t.ro'), current_setting('t.medio')),
  'P0001', 'forbidden', 'replacing a lower-role deny the actor lacks is forbidden');
select tests.clear_authentication();
select is((select allow || ':' || deny from public.permission_overwrites
  where channel_id = current_setting('t.ro')::uuid and target_id = current_setting('t.everyone')::uuid), '0:2', '@everyone row unchanged');
select is((select allow || ':' || deny from public.permission_overwrites
  where channel_id = current_setting('t.ro')::uuid and target_id = current_setting('t.medio')::uuid), '0:2', 'role row unchanged');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'member', %L::uuid, 8192, 0)$q$, current_setting('t.ro'), current_setting('t.c')),
  'changing only bits the actor holds is allowed');

-- update_role: changed bits only
select lives_ok(format($q$select public.update_role(%L::uuid, 'T095 carga2', '#010203', 32)$q$, current_setting('t.carga')),
  'rename/recolor a lower role carrying a bit the actor lacks');
select throws_ok(format($q$select public.update_role(%L::uuid, 'T095 carga2', '#010203', 0)$q$, current_setting('t.carga')),
  'P0001', 'hierarchy', 'stripping a bit the actor lacks is hierarchy');
select throws_ok(format($q$select public.update_role(%L::uuid, 'T095 carga2', '#010203', 32 | 256)$q$, current_setting('t.carga')),
  'P0001', 'hierarchy', 'adding a bit the actor lacks is hierarchy');
select lives_ok(format($q$select public.update_role(%L::uuid, 'T095 carga2', '#010203', 32 | 2)$q$, current_setting('t.carga')),
  'adding a bit the actor holds keeps the untouched foreign bit');
select tests.clear_authentication();
select is((select permissions from public.roles where id = current_setting('t.carga')::uuid), 34::bigint, 'carga permissions stored');

-- mass grants
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.update_role(%L::uuid, (select name from public.roles where is_everyone), (select color from public.roles where is_everyone), (select permissions | 64 from public.roles where is_everyone))$q$, current_setting('t.everyone')),
  'P0001', 'forbidden', 'non-admin cannot give @everyone a global bit');
select throws_ok(format($q$select public.update_role(%L::uuid, 'Verificado', '#3DDC85', 3072 | 128)$q$, current_setting('t.verified')),
  'P0001', 'forbidden', 'non-admin cannot give a system_key role a global bit');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($q$select public.update_role(%L::uuid, (select name from public.roles where is_everyone), (select color from public.roles where is_everyone), (select permissions | 64 from public.roles where is_everyone))$q$, current_setting('t.everyone')),
  'admin may give @everyone a global bit');
select tests.clear_authentication();
select is((select permissions & 64 from public.roles where is_everyone), 64::bigint, 'admin mass grant stored');

-- 512 reserved to SuperAdmin
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($q$select public.create_role('T095 adm', '#123456', 512)$q$, 'P0001', 'forbidden', 'nobody creates a role with ADMINISTRATOR');
select throws_ok(format($q$select public.update_role(%L::uuid, 'T095 carga2', '#010203', 512)$q$, current_setting('t.carga')),
  'P0001', 'forbidden', 'nobody updates a role to ADMINISTRATOR');

-- domain regex and audit-on-change
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($q$select public.add_allowed_domain('..com')$q$, 'P0001', 'invalid_input', '..com is invalid');
select throws_ok($q$select public.add_allowed_domain('-a.com')$q$, 'P0001', 'invalid_input', '-a.com is invalid');
select throws_ok($q$select public.add_allowed_domain('a..b.com')$q$, 'P0001', 'invalid_input', 'a..b.com is invalid');
select lives_ok($q$select public.add_allowed_domain('github.com')$q$, 'adding an existing domain');
select lives_ok($q$select public.remove_allowed_domain('nonexistent.com')$q$, 'removing a missing domain');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_log where action = 'domain_added' and payload->>'domain' = 'github.com'), 0,
  'no audit when add changed nothing');
select is((select count(*)::int from public.audit_log where action = 'domain_removed' and payload->>'domain' = 'nonexistent.com'), 0,
  'no audit when remove changed nothing');

select * from finish();
rollback;
