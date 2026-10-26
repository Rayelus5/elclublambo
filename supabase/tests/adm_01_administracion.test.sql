-- Administración Task 1 (migration 20261026100001): site state, team access list, maintenance password, admin history
-- and closable registration (A-R1, A-R2, A-R5, A-R10, A-R11, A-R13).
begin;
select plan(98);

-- fixtures: admin (bootstrap, SuperAdmin), plain active member, outsider (wallet user without membership)
select set_config('t.admin', tests.create_member('0xad01000000000000000000000000000000000001', null, true)::text, true);
select set_config('t.plain', tests.create_member('0xad01000000000000000000000000000000000002', current_setting('t.admin')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.admin')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.out', tests.create_wallet_user('0xbd01000000000000000000000000000000000001')::text, true);

create function pg_temp.uid(p_member text) returns uuid language sql security definer as
  $$ select auth_user_id from public.members where id = p_member::uuid $$;
grant execute on function pg_temp.uid(text) to public;

-- ===== privileges =====
select ok(has_function_privilege('anon', 'public.site_state()', 'execute')
      and has_function_privilege('authenticated', 'public.site_state()', 'execute'), 'anon and authenticated can site_state');
select ok(not has_function_privilege('anon', 'public.admin_overview()', 'execute'), 'anon cannot admin_overview');
select ok(not has_function_privilege('anon', 'public.admin_set_switch(text,boolean)', 'execute')
      and not has_function_privilege('anon', 'public.admin_set_maintenance(boolean,text,text,text,timestamptz,timestamptz,timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.admin_set_maintenance_password(text)', 'execute')
      and not has_function_privilege('anon', 'public.admin_add_access_wallet(text,text)', 'execute')
      and not has_function_privilege('anon', 'public.admin_remove_access_wallet(text)', 'execute')
      and not has_function_privilege('anon', 'public.my_maintenance_access()', 'execute')
      and not has_function_privilege('anon', 'public.my_registration_blocked()', 'execute'),
  'anon cannot execute the admin_* / my_* RPCs');
select ok(has_function_privilege('authenticated', 'public.admin_overview()', 'execute')
      and has_function_privilege('authenticated', 'public.my_maintenance_access()', 'execute')
      and has_function_privilege('authenticated', 'public.my_registration_blocked()', 'execute'),
  'authenticated can execute admin_overview / my_maintenance_access / my_registration_blocked');
select ok(not has_function_privilege('authenticated', 'public.maintenance_password_record()', 'execute')
      and not has_function_privilege('anon', 'public.maintenance_password_record()', 'execute'),
  'only service_role can maintenance_password_record');
select ok(not has_function_privilege('authenticated', 'public.grant_maintenance_access(uuid,int)', 'execute')
      and not has_function_privilege('anon', 'public.grant_maintenance_access(uuid,int)', 'execute'),
  'only service_role can grant_maintenance_access');
select ok(has_function_privilege('service_role', 'public.maintenance_password_record()', 'execute')
      and has_function_privilege('service_role', 'public.grant_maintenance_access(uuid,int)', 'execute'),
  'service_role can maintenance_password_record and grant_maintenance_access');
select ok(not has_table_privilege('anon', 'public.' || t, 'select') and not has_table_privilege('authenticated', 'public.' || t, 'select'),
  'anon and authenticated have no SELECT on ' || t)
  from unnest(array['maintenance_access_wallets', 'maintenance_password', 'maintenance_grants', 'registration_holds']) t;
select is((select count(*)::int from pg_policies where schemaname = 'public'
           and tablename in ('maintenance_access_wallets', 'maintenance_password', 'maintenance_grants', 'registration_holds')),
  0, 'the four private tables have no policies');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname in ('maintenance_access_wallets', 'maintenance_password', 'maintenance_grants', 'registration_holds')),
  'the four private tables have RLS enabled');
select ok(not has_function_privilege('anon', 'private.hold_registration()', 'execute')
      and not has_function_privilege('authenticated', 'private.hold_registration()', 'execute')
      and not has_function_privilege('service_role', 'private.hold_registration()', 'execute'),
  'private.hold_registration is executable by no API role');

-- ===== defaults =====
set local role anon;
select is(public.site_state(),
  '{"switches":{"giveaways":true,"pay":true,"checker":true,"vouches":true,"approvals":true,"multisend":true,"gas":true,"donate":true,"checkerApi":true,"registration":true},"maintenance":{"enabled":false,"mode":"default","messageEs":null,"messageEn":null,"returnAt":null,"startsAt":null,"endsAt":null}}'::jsonb,
  'site_state() returns the A-R1 defaults (as anon)');
select throws_ok($$select public.admin_overview()$$, '42501', null, 'anon cannot call admin_overview');
reset role;

-- ===== plain member is forbidden =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select throws_ok($$select public.admin_overview()$$, 'forbidden', 'plain: admin_overview forbidden');
select throws_ok($$select public.admin_set_switch('gas', false)$$, 'forbidden', 'plain: admin_set_switch forbidden');
select throws_ok($$select public.admin_set_maintenance(true, 'default', null, null, null, null, null)$$, 'forbidden',
  'plain: admin_set_maintenance forbidden');
select throws_ok($$select public.admin_set_maintenance_password('scrypt$32768$8$1$c2FsdA==$aGFzaA==')$$, 'forbidden',
  'plain: admin_set_maintenance_password forbidden');
select throws_ok($$select public.admin_add_access_wallet('0x' || repeat('1', 40), null)$$, 'forbidden',
  'plain: admin_add_access_wallet forbidden');
select throws_ok($$select public.admin_remove_access_wallet('0x' || repeat('1', 40))$$, 'forbidden',
  'plain: admin_remove_access_wallet forbidden');
select tests.clear_authentication();

-- ===== switches =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select lives_ok($$select public.admin_set_switch('gas', false)$$, 'admin turns gas off');
select is(public.site_state()->'switches'->>'gas', 'false', 'site_state shows gas off');
select is(public.site_state()->'switches'->>'pay', 'true', 'other switches untouched');
select throws_ok($$select public.admin_set_switch('nope', true)$$, 'switch_invalid', 'unknown switch key rejected');
select throws_ok($$select public.admin_set_switch(null, true)$$, 'switch_invalid', 'null switch key rejected');
select throws_ok($$select public.admin_set_switch('gas', null)$$, 'switch_invalid', 'null switch value rejected');
select tests.clear_authentication();
select is((select payload from public.audit_log where action = 'admin.switch' order by id desc limit 1),
  '{"key":"gas","enabled":false}'::jsonb, 'audit: admin.switch payload');

-- ===== maintenance (Review Focus 2) =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select throws_ok($$select public.admin_set_maintenance(true, 'default', 'Hola', null, null, null, null)$$,
  'maintenance_invalid', 'default with a message rejected');
select throws_ok($$select public.admin_set_maintenance(true, 'default', null, null, now() + interval '1 hour', null, null)$$,
  'maintenance_invalid', 'default with returnAt rejected');
select throws_ok($$select public.admin_set_maintenance(true, 'custom', 'Hola', null, null, null, null)$$,
  'maintenance_invalid', 'custom without the English message rejected');
select throws_ok($$select public.admin_set_maintenance(true, 'custom', 'Hola', repeat('x', 501), null, null, null)$$,
  'maintenance_invalid', 'custom with a 501-char message rejected');
select throws_ok($$select public.admin_set_maintenance(false, 'custom', 'Hola', 'Hi', null, now() + interval '2 hours', now() + interval '1 hour')$$,
  'maintenance_invalid', 'custom with ends <= starts rejected');
select throws_ok($$select public.admin_set_maintenance(true, 'custom', 'Hola', 'Hi', null, null, now() - interval '1 hour')$$,
  'maintenance_invalid', 'custom with ends in the past rejected');
select throws_ok($$select public.admin_set_maintenance(true, 'custom', 'Hola', 'Hi', now() - interval '1 hour', null, null)$$,
  'maintenance_invalid', 'returnAt in the past rejected');
select throws_ok($$select public.admin_set_maintenance(true, 'other', null, null, null, null, null)$$,
  'maintenance_invalid', 'unknown mode rejected');
select lives_ok($$select public.admin_set_maintenance(false, 'custom', '  Volvemos pronto  ', 'Back soon',
    timestamptz '2099-01-01 12:00:00+00', timestamptz '2099-01-01 10:00:00+00', timestamptz '2099-01-01 11:30:00+00')$$,
  'valid custom scheduled maintenance accepted');
select is(public.site_state()->'maintenance',
  '{"enabled":false,"mode":"custom","messageEs":"Volvemos pronto","messageEn":"Back soon","returnAt":"2099-01-01T12:00:00.000Z","startsAt":"2099-01-01T10:00:00.000Z","endsAt":"2099-01-01T11:30:00.000Z"}'::jsonb,
  'stored maintenance JSON: camelCase keys, trimmed messages, ISO dates');
select tests.clear_authentication();
select is((select payload from public.audit_log where action = 'admin.maintenance' order by id desc limit 1),
  '{"enabled":false,"mode":"custom","returnAt":"2099-01-01T12:00:00.000Z","startsAt":"2099-01-01T10:00:00.000Z","endsAt":"2099-01-01T11:30:00.000Z"}'::jsonb,
  'audit: admin.maintenance payload');

-- ===== access list (Review Focus 5) =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select lives_ok($$select public.admin_add_access_wallet('0xBD01000000000000000000000000000000000001', ' Ana ')$$, 'admin adds a wallet (mixed case)');
select lives_ok($$select public.admin_add_access_wallet('0xbd01000000000000000000000000000000000001', 'Ana B')$$, 'admin re-adds it lowercased with another note');
select throws_ok($$select public.admin_add_access_wallet('0x12', null)$$, 'wallet_invalid', 'malformed wallet rejected');
select throws_ok($$select public.admin_add_access_wallet(null, null)$$, 'wallet_invalid', 'null wallet rejected');
select throws_ok($$select public.admin_add_access_wallet('0x' || repeat('2', 40), repeat('n', 81))$$, 'note_invalid', '81-char note rejected');
select lives_ok($$select public.admin_add_access_wallet('0x' || repeat('3', 40), '   ')$$, 'blank note accepted');
select tests.clear_authentication();
select is((select count(*)::int from public.maintenance_access_wallets where wallet = '0xbd01000000000000000000000000000000000001'),
  1, 'one row for the wallet');
select is((select note from public.maintenance_access_wallets where wallet = '0xbd01000000000000000000000000000000000001'),
  'Ana B', 'the row carries the latest note');
select ok((select note is null from public.maintenance_access_wallets where wallet = '0x' || repeat('3', 40)), 'blank note stored as null');
select is((select payload from public.audit_log where action = 'admin.access_add' order by id desc limit 1),
  jsonb_build_object('wallet', '0x' || repeat('3', 40), 'note', null), 'audit: admin.access_add payload');

-- ===== password =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select throws_ok($$select public.admin_set_maintenance_password('plain')$$, 'password_invalid', 'non-scrypt hash rejected');
select throws_ok($$select public.admin_set_maintenance_password(null)$$, 'password_invalid', 'null hash rejected');
select lives_ok($$select public.admin_set_maintenance_password('scrypt$32768$8$1$c2FsdDE=$aGFzaDE=')$$, 'admin sets the password');
select tests.clear_authentication();
set local role service_role;
select is(public.maintenance_password_record(), '{"hash":"scrypt$32768$8$1$c2FsdDE=$aGFzaDE=","version":1}'::jsonb,
  'maintenance_password_record returns hash and version 1');
reset role;
select is((select payload from public.audit_log where action = 'admin.maintenance_password' order by id desc limit 1),
  '{}'::jsonb, 'audit: admin.maintenance_password payload is empty (no hash)');

-- ===== team access (Review Focus 5) =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select is(public.my_maintenance_access(), 'superadmin', 'SuperAdmin -> superadmin');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select is(public.my_maintenance_access(), 'none', 'unlisted member -> none');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.out')::uuid);
select is(public.my_maintenance_access(), 'listed', 'listed wallet user -> listed');
select tests.clear_authentication();

set local role service_role;
select is(public.grant_maintenance_access(pg_temp.uid(current_setting('t.plain')), 1), 'not_listed', 'unlisted user -> not_listed');
select is(public.grant_maintenance_access(current_setting('t.out')::uuid, 1), 'granted', 'listed user with current version -> granted');
reset role;
select tests.authenticate_as(current_setting('t.out')::uuid);
select is(public.my_maintenance_access(), 'granted', 'after the grant -> granted');
select tests.clear_authentication();

select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select lives_ok($$select public.admin_set_maintenance_password('scrypt$32768$8$1$c2FsdDI=$aGFzaDI=')$$, 'admin changes the password');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.out')::uuid);
select is(public.my_maintenance_access(), 'listed', 'a password change revokes the grant -> listed');
select tests.clear_authentication();
set local role service_role;
select is(public.grant_maintenance_access(current_setting('t.out')::uuid, 1), 'stale', 'old password version -> stale');
select is(public.grant_maintenance_access(current_setting('t.out')::uuid, 2), 'granted', 'new version -> granted');
reset role;

select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select lives_ok($$select public.admin_remove_access_wallet(' 0xBD01000000000000000000000000000000000001 ')$$, 'admin removes the wallet');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.out')::uuid);
select is(public.my_maintenance_access(), 'none', 'removed wallet -> none');
select tests.clear_authentication();
select is((select count(*)::int from public.maintenance_grants where auth_user_id = current_setting('t.out')::uuid), 0,
  'removing the wallet drops its grants');
select is((select payload from public.audit_log where action = 'admin.access_remove' order by id desc limit 1),
  '{"wallet":"0xbd01000000000000000000000000000000000001"}'::jsonb, 'audit: admin.access_remove payload');
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select set_config('t.n_audit', (select count(*) from public.audit_log)::text, true);
select lives_ok($$select public.admin_remove_access_wallet('0x' || repeat('9', 40))$$, 'removing an absent wallet is a no-op');
select tests.clear_authentication();
select is((select count(*) from public.audit_log)::text, current_setting('t.n_audit'), 'removing an absent wallet is not audited');

-- expired grant
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.admin_add_access_wallet('0xbd01000000000000000000000000000000000001', null);
select tests.clear_authentication();
set local role service_role;
select is(public.grant_maintenance_access(current_setting('t.out')::uuid, 2), 'granted', 're-listed user granted again');
reset role;
select ok((select expires_at = now() + interval '12 hours' from public.maintenance_grants
           where auth_user_id = current_setting('t.out')::uuid), 'grant expires 12 h later (no endsAt in the past)');
update public.maintenance_grants set expires_at = now() - interval '1 minute' where auth_user_id = current_setting('t.out')::uuid;
select tests.authenticate_as(current_setting('t.out')::uuid);
select is(public.my_maintenance_access(), 'listed', 'an expired grant -> listed');
select tests.clear_authentication();

-- turning maintenance off drops every grant
set local role service_role;
select public.grant_maintenance_access(current_setting('t.out')::uuid, 2);
reset role;
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select lives_ok($$select public.admin_set_maintenance(true, 'default', null, null, null, null, null)$$, 'admin turns maintenance on');
select tests.clear_authentication();
select is((select count(*)::int from public.maintenance_grants), 1, 'turning it on keeps the grants');
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select lives_ok($$select public.admin_set_maintenance(false, 'default', null, null, null, null, null)$$, 'admin turns maintenance off');
select tests.clear_authentication();
select is((select count(*)::int from public.maintenance_grants), 0, 'turning it off drops all grants');

-- ===== history =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.set_min_fee_bps(10);
select public.admin_set_switch('gas', true);
select is(public.admin_overview()->'history'->0->>'action', 'admin.switch', 'history: newest admin action first');
select is(public.admin_overview()->'history'->0->'payload', '{"key":"gas","enabled":true}'::jsonb, 'history: newest payload first');
select is(public.admin_overview()->'history'->0->>'actor', '0xad01000000000000000000000000000000000001',
  'history: actor falls back to the wallet without a handle');
select ok(not exists (select 1 from jsonb_array_elements(public.admin_overview()->'history') e
                      where e->>'action' not like 'admin.%'), 'history: no economy.* rows');
select ok((public.admin_overview() ?& array['switches', 'maintenance', 'passwordSet', 'passwordUpdatedAt', 'accessList', 'history'])
      and (public.admin_overview()->>'passwordSet')::boolean, 'overview carries all keys and passwordSet = true');
select is((select jsonb_agg(e->>'wallet') from jsonb_array_elements(public.admin_overview()->'accessList') e),
  jsonb_build_array('0x' || repeat('3', 40), '0xbd01000000000000000000000000000000000001'), 'accessList ordered by created_at');
select tests.clear_authentication();
update public.members set handle = 'jefe' where id = current_setting('t.admin')::uuid;
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select is(public.admin_overview()->'history'->0->>'actor', '@jefe', 'history: actor is @handle when set');
select tests.clear_authentication();

-- ===== registration (A-R13) =====
select set_config('t.open_user', tests.create_wallet_user('0xbd01000000000000000000000000000000000002')::text, true);
select is((select count(*)::int from public.registration_holds where auth_user_id = current_setting('t.open_user')::uuid), 0,
  'registration open: no hold');
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.admin_set_switch('registration', false);
select tests.clear_authentication();
select set_config('t.closed_user', tests.create_wallet_user('0xbd01000000000000000000000000000000000003')::text, true);
select is((select count(*)::int from public.registration_holds where auth_user_id = current_setting('t.closed_user')::uuid), 1,
  'registration closed: hold created');
select tests.authenticate_as(current_setting('t.closed_user')::uuid);
select is(public.my_registration_blocked(), true, 'held user is blocked');
select is(public.is_public_account(), false, 'held user is not a public account');
select tests.clear_authentication();
select set_config('t.closed_member', tests.create_member('0xbd01000000000000000000000000000000000004', current_setting('t.admin')::uuid)::text, true);
select tests.authenticate_as(pg_temp.uid(current_setting('t.closed_member')));
select is(public.my_registration_blocked(), false, 'a member created while closed is not blocked');
select is(public.is_public_account(), true, 'a member created while closed is a public account');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.admin_set_switch('registration', true);
select tests.clear_authentication();
select is((select count(*)::int from public.registration_holds), 0, 'reopening clears all holds');

-- ===== rate limits =====
set local role service_role;
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('e', 32), 'maintenance_password') from generate_series(1, 20)$$,
  '20 maintenance_password IP hits pass');
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('e', 32), 'maintenance_password')$$, 'P0001', 'rate_limited',
  'the 21st maintenance_password IP hit is rate_limited');
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('e', 32), 'approvals_scan')$$, 'approvals_scan still works');
reset role;
select tests.authenticate_as(current_setting('t.out')::uuid);
select lives_ok($$select public.rate_limit_hit('maintenance_password') from generate_series(1, 5)$$, '5 maintenance_password session hits pass');
select throws_ok($$select public.rate_limit_hit('maintenance_password')$$, 'P0001', 'rate_limited',
  'the 6th maintenance_password session hit is rate_limited');
select lives_ok($$select public.rate_limit_hit('vouch_write')$$, 'vouch_write still works');
select tests.clear_authentication();

select * from finish();
rollback;
