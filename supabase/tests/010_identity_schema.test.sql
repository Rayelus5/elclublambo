begin;
select plan(33);

select has_table('public', t, t || ' exists')
  from unnest(array['members','invites','invite_redemptions','roles','member_roles',
    'member_permission_overrides','bans','audit_log','app_config']) as t;

select col_is_unique('public', 'members', 'wallet_address', 'members.wallet_address unique');

-- wallet casing / sponsor constraints
select set_config('tests.u_upper',
  tests.create_wallet_user('0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD')::text, true);
select throws_ok(
  $$insert into public.members (auth_user_id, wallet_address, is_bootstrap)
    values (current_setting('tests.u_upper')::uuid, '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD', true)$$,
  '23514', null, 'uppercase wallet rejected');
select throws_ok(
  $$select tests.create_member('0x2222222222222222222222222222222222222222', null, false)$$,
  '23514', null, 'member without sponsor nor bootstrap rejected');

-- generic RLS check
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity),
  0, 'RLS enabled on every public table');

-- seed roles
select results_eq(
  $$select name, position, permissions, is_everyone, is_system, color from public.roles order by position$$,
  $$values ('@everyone'::text, 0, 8199::bigint, true, false, '#A3A3A3'::text),
           ('Padrino', 10, 16::bigint, false, false, '#61DFFF'),
           ('Mecenas', 15, 0::bigint, false, false, '#C6F36B'),
           ('Verificado', 20, 199680::bigint, false, false, '#3DDC84'),
           ('Soporte', 100, 19456::bigint, false, false, '#FFB020'),
           ('Moderador', 500, 252968::bigint, false, false, '#FF5A5A'),
           ('SuperAdmin', 1000, 512::bigint, false, true, '#EDEDED')$$,
  'seed roles exact');
select results_eq(
  $$select key, value from public.app_config order by key$$,
  $$values ('active_chain_id'::text, '59141'::jsonb), ('donor_role_min_usd6', '1000000'::jsonb), ('legacy_dao_enabled', 'false'::jsonb), ('min_fee_bps', '0'::jsonb),
    ('weighted_raffles_enabled', 'false'::jsonb), ('withdrawals_enabled', 'false'::jsonb)$$,
  'app_config seed');

-- single is_everyone
select throws_ok(
  $$insert into public.roles (name, color, position, permissions, is_everyone) values ('x2','#000000',1,0,true)$$,
  '23505', null, 'only one @everyone role');

-- other checks
select tests.create_member('0x3333333333333333333333333333333333333333', null, true);
select throws_ok(
  $$insert into public.invites (code, created_by, max_uses, expires_at)
    select 'c1', id, 101, now() + interval '1 day' from public.members limit 1$$,
  '23514', null, 'max_uses > 100 rejected');
select throws_ok(
  $$insert into public.invites (code, created_by, max_uses, uses, expires_at)
    select 'c2', id, 1, 2, now() + interval '1 day' from public.members limit 1$$,
  '23514', null, 'uses > max_uses rejected');
select throws_ok(
  $$insert into public.roles (name, color, position) values ('bad','#abcdef',5)$$,
  '23514', null, 'lowercase role color rejected');
select throws_ok(
  $$update public.members set display_name = 'a'$$,
  '23514', null, 'short display_name rejected');
select throws_ok(
  $$update public.members set status = 'zombie'$$,
  '23514', null, 'invalid status rejected');

-- FK deferrable
select is(
  (select condeferrable and condeferred from pg_constraint
    where conrelid = 'public.members'::regclass and confrelid = 'public.invites'::regclass),
  true, 'members.invite_id FK deferrable initially deferred');

-- create_wallet_user nests custom_claims
select is(
  (select identity_data->'custom_claims'->>'address' from auth.identities
    where provider_id = 'web3:ethereum:0x3333333333333333333333333333333333333333'),
  '0x3333333333333333333333333333333333333333',
  'identity_data nests address under custom_claims');

-- anon: deny
set local role anon;
select throws_ok('select * from public.members', '42501', null, 'anon cannot read members');
select throws_ok('select * from public.roles', '42501', null, 'anon cannot read roles');
select throws_ok('select * from public.app_config', '42501', null, 'anon cannot read app_config');
reset role;

-- authenticated non-member: read policies require is_active_member() => 0 rows
select tests.authenticate_as(tests.create_wallet_user('0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a'));
select is((select count(*)::int from public.members), 0, 'non-member sees 0 members');
select is((select count(*)::int from public.roles), 0, 'non-member sees 0 roles');
select throws_ok(
  $$insert into public.audit_log (action) values ('x')$$,
  '42501', null, 'authenticated cannot insert audit_log');
select throws_ok(
  $$update public.audit_log set action = 'y'$$,
  '42501', null, 'authenticated cannot update audit_log');
select throws_ok(
  $$delete from public.audit_log$$,
  '42501', null, 'authenticated cannot delete audit_log');
select tests.clear_authentication();

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
      and not (table_name = 'vouches' and privilege_type = 'SELECT')),  -- vouches: public on-chain data, select-only through RLS (P5)
  0, 'anon has no table grants in public');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'audit_log' and grantee = 'authenticated'
      and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'authenticated has no write grants on audit_log');

select * from finish();
rollback;
