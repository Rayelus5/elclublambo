begin;
select plan(27);

-- fixtures: a = admin, b = manager (Moderador + MANAGE_ROLES/CHANNELS override), c = banned, d = active target
select set_config('t.a', tests.create_member('0x00000000000000000000000000000000000d0001', null, true)::text, true);
select set_config('t.b', tests.create_member('0x00000000000000000000000000000000000d0002', current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x00000000000000000000000000000000000d0003', current_setting('t.a')::uuid)::text, true);
select set_config('t.d', tests.create_member('0x00000000000000000000000000000000000d0004', current_setting('t.a')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.b')::uuid, id from public.roles where name = 'Moderador';
insert into public.member_permission_overrides (member_id, allow, deny) values (current_setting('t.b')::uuid, 192, 0);
update public.members set status = 'banned' where id = current_setting('t.c')::uuid;
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.everyone', (select id::text from public.roles where is_everyone), true);
select set_config('t.verified', (select id::text from public.roles where system_key = 'verified'), true);
select set_config('t.padrino', (select id::text from public.roles where name = 'Padrino'), true);
select set_config('t.ch', tests.create_channel(null, 'category', 'Hardening')::text, true);

-- ===== 1. member-safe mass grants =====
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.update_role(%L::uuid, '@everyone', '#A3A3A3', 8199 | 8)$q$, current_setting('t.everyone')),
  'P0001', 'forbidden', 'non-admin: @everyone cannot gain MANAGE_MESSAGES');
select throws_ok(format($q$select public.update_role(%L::uuid, '@everyone', '#A3A3A3', 8199 | 4096)$q$, current_setting('t.everyone')),
  'P0001', 'forbidden', 'non-admin: @everyone cannot gain MENTION_EVERYONE');
select throws_ok(format($q$select public.update_role(%L::uuid, '@everyone', '#A3A3A3', 8199 | 16384)$q$, current_setting('t.everyone')),
  'P0001', 'forbidden', 'non-admin: @everyone cannot gain MANAGE_TICKETS');
select throws_ok(format($q$select public.update_role(%L::uuid, 'Verificado', '#3DDC84', 3072 | 4096)$q$, current_setting('t.verified')),
  'P0001', 'forbidden', 'non-admin: Verificado cannot gain MENTION_EVERYONE');
select lives_ok(format($q$select public.update_role(%L::uuid, '@everyone', '#A3A3A3', 8199 | 1024)$q$, current_setting('t.everyone')),
  'non-admin: @everyone may gain a member-safe bit');

select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 8, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'P0001', 'forbidden', 'non-admin: @everyone overwrite cannot allow MANAGE_MESSAGES');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 4096, 0)$q$, current_setting('t.ch'), current_setting('t.verified')),
  'P0001', 'forbidden', 'non-admin: Verificado overwrite cannot allow MENTION_EVERYONE');
select throws_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 16384, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'P0001', 'forbidden', 'non-admin: @everyone overwrite cannot allow MANAGE_TICKETS');
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 1024, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'non-admin: allowing a member-safe bit on @everyone is fine');
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 0, 8)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'non-admin: denying any channel bit on @everyone stays allowed');

select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($q$select public.update_role(%L::uuid, '@everyone', '#A3A3A3', 8199 | 8)$q$, current_setting('t.everyone')),
  'admin: @everyone may gain MANAGE_MESSAGES');
select lives_ok(format($q$select public.set_overwrite(%L::uuid, 'role', %L::uuid, 4096, 0)$q$, current_setting('t.ch'), current_setting('t.everyone')),
  'admin: @everyone overwrite may allow MENTION_EVERYONE');
select tests.clear_authentication();

-- ===== 2. overrides can never grant ADMINISTRATOR =====
select throws_ok(format($q$insert into public.member_permission_overrides (member_id, allow, deny) values (%L::uuid, 512, 0)$q$, current_setting('t.d')),
  '23514', null, 'CHECK: override allow cannot contain ADMINISTRATOR');
alter table public.member_permission_overrides drop constraint member_permission_overrides_no_admin_allow;
insert into public.member_permission_overrides (member_id, allow, deny) values (current_setting('t.d')::uuid, 512 | 16, 0);
select is(public.member_global_permissions(current_setting('t.d')::uuid) & 512, 0::bigint,
  'member_global_permissions masks ADMINISTRATOR out of override allow');
select is(public.member_global_permissions(current_setting('t.d')::uuid) & 16, 16::bigint,
  'member_global_permissions keeps other global bits of override allow');

-- ===== 3. set_member_role =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, true)$q$, current_setting('t.d'), current_setting('t.verified')),
  'P0001', 'forbidden', 'Verificado cannot go through set_member_role');
select throws_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, true)$q$, current_setting('t.c'), current_setting('t.padrino')),
  'P0001', 'invalid_input', 'banned target: invalid_input');
select lives_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, true)$q$, current_setting('t.d'), current_setting('t.padrino')),
  'Padrino (sponsor) still toggles through set_member_role');
select lives_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, false)$q$, current_setting('t.d'), current_setting('t.padrino')),
  'Padrino can be removed again');

-- ===== 4. move_role =====
select lives_ok(format($q$select public.move_role(%L::uuid, 30)$q$, current_setting('t.verified')),
  'the SuperAdmin can reorder a system_key role (roles drag & drop)');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.move_role(%L::uuid, 40)$q$, current_setting('t.verified')),
  'P0001', 'forbidden', 'a MANAGE_ROLES delegate still cannot move a system_key role');
select tests.clear_authentication();

-- ===== 5. Padrino identity =====
select is((select system_key from public.roles where name = 'Padrino'), 'sponsor', 'Padrino is pinned with system_key sponsor');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($q$select public.update_role(%L::uuid, 'Otro', '#61DFFF', 16)$q$, current_setting('t.padrino')),
  'P0001', 'forbidden', 'Padrino cannot be renamed');
select tests.clear_authentication();

-- ===== 6. backfill helper is gone =====
select hasnt_function('public', '_backfill_verified', 'backfill helper dropped');

-- ===== 7. generic guards =====
select is((select count(*)::int
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                             where c in ('search_path=""', 'search_path=''''', 'search_path=')))
          , 0, 'every SECURITY DEFINER function in public pins an empty search_path');
select is((select string_agg(c.relname, ',')
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
             and (has_table_privilege('authenticated', c.oid, 'INSERT')
               or has_table_privilege('authenticated', c.oid, 'UPDATE')
               or has_table_privilege('authenticated', c.oid, 'DELETE'))),
          null, 'authenticated has no table-level write privilege on any public table');
select is((select string_agg(c.relname, ',')
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
             and (has_table_privilege('anon', c.oid, 'INSERT')
               or has_table_privilege('anon', c.oid, 'UPDATE')
               or has_table_privilege('anon', c.oid, 'DELETE'))),
          null, 'anon has no table-level write privilege on any public table');

select * from finish();
rollback;
