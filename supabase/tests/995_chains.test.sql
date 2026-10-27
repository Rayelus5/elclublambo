-- P0 Task 1 (migration 20261024100001): public.chains replaces the Linea checks on the live money tables (FK),
-- private.chain_enabled, set_chain_enabled (SuperAdmin, audited), members.receive_networks with its two RPCs, and
-- the P0 flags (legacy_dao_enabled = false, min_fee_bps = 0) read through economy_config.
begin;
select plan(51);

-- fixtures: admin (bootstrap, SuperAdmin), plain active member, banned member, outsider (auth user without membership)
select set_config('t.admin', tests.create_member('0xa995000000000000000000000000000000000001', null, true)::text, true);
select set_config('t.plain', tests.create_member('0xa995000000000000000000000000000000000002', current_setting('t.admin')::uuid)::text, true);
select set_config('t.banned', tests.create_member('0xa995000000000000000000000000000000000003', current_setting('t.admin')::uuid)::text, true);
update public.members set status = 'banned' where id = current_setting('t.banned')::uuid;
insert into public.member_roles (member_id, role_id)
  select current_setting('t.admin')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.out', tests.create_wallet_user('0xb995000000000000000000000000000000000001')::text, true);

create function pg_temp.uid(p_member text) returns uuid language sql security definer as
  $$ select auth_user_id from public.members where id = p_member::uuid $$;
grant execute on function pg_temp.uid(text) to public;

-- ===== 1. table, seeds, privileges =====
select has_table('public', 'chains', 'public.chains exists');
select results_eq(
  $$select chain_id, network, name, testnet, enabled, safe_address from public.chains order by chain_id$$,
  $$values (8453, 'base'::text, 'Base'::text, false, true, '0x380f2e12081995359e2ab88e3c31c6b227904234'::text),
           (42161, 'arbitrum', 'Arbitrum', false, true, '0x380f2e12081995359e2ab88e3c31c6b227904234'),
           (59141, 'linea', 'Linea Sepolia', true, false, null),
           (59144, 'linea', 'Linea', false, false, null),
           (84532, 'base', 'Base Sepolia', true, true, '0x380f2e12081995359e2ab88e3c31c6b227904234'),
           (421614, 'arbitrum', 'Arbitrum Sepolia', true, true, '0x380f2e12081995359e2ab88e3c31c6b227904234')$$,
  'chains seeded with the six networks (P0-R14: the four non-Linea ones enabled)');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.chains'::regclass), 'chains has RLS');
select ok(not has_table_privilege('anon', 'public.chains', 'select'), 'anon has no SELECT on chains');
select ok(not has_table_privilege('authenticated', 'public.chains', 'insert')
      and not has_table_privilege('authenticated', 'public.chains', 'update')
      and not has_table_privilege('authenticated', 'public.chains', 'delete')
      and not has_table_privilege('authenticated', 'public.chains', 'truncate'), 'authenticated has no write privileges on chains');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'chains'
           and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')), 0, 'chains has no write policy');
select ok(not has_function_privilege('anon', 'public.set_chain_enabled(int,boolean)', 'execute')
      and has_function_privilege('authenticated', 'public.set_chain_enabled(int,boolean)', 'execute'),
  'set_chain_enabled: authenticated yes, anon no');
select ok(not has_function_privilege('anon', 'public.set_receive_networks(text[])', 'execute')
      and has_function_privilege('authenticated', 'public.set_receive_networks(text[])', 'execute')
      and not has_function_privilege('anon', 'public.receive_networks_of(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.receive_networks_of(uuid)', 'execute'),
  'receive-network RPCs: authenticated yes, anon no');
select ok(not has_function_privilege('authenticated', 'private.chain_enabled(int)', 'execute')
      and not has_function_privilege('service_role', 'private.chain_enabled(int)', 'execute'),
  'private.chain_enabled is executable by no API role');

-- ===== 2. private.chain_enabled =====
select ok(private.chain_enabled(84532), '84532 enabled');
select ok(private.chain_enabled(421614), '421614 enabled');
select ok(private.chain_enabled(8453), '8453 enabled');
select ok(private.chain_enabled(42161), '42161 enabled');
select ok(not private.chain_enabled(59141), '59141 disabled');
select ok(not private.chain_enabled(59144), '59144 disabled');
select ok(not private.chain_enabled(1), 'unknown chain is not enabled');

-- ===== 3. FKs replace the Linea checks on the live tables =====
select is((select count(*)::int from pg_constraint
           where conrelid in ('public.payment_intents'::regclass, 'public.tips'::regclass,
                              'public.onchain_transfers'::regclass, 'public.bounties'::regclass)
             and contype = 'c' and pg_get_constraintdef(oid) like '%59144%'), 0, 'no Linea check left on the live tables');
select is((select count(*)::int from pg_constraint
           where conrelid in ('public.payment_intents'::regclass, 'public.tips'::regclass,
                              'public.onchain_transfers'::regclass, 'public.bounties'::regclass)
             and contype = 'f' and confrelid = 'public.chains'::regclass), 4, 'each live table has an FK to chains');

create function pg_temp.intent(p_chain int) returns void language sql as $$
  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_address, target_type)
  values (current_setting('t.plain')::uuid, 'tip', p_chain, 'USDC', 1000000, 0, 0, 0,
          '0xa995000000000000000000000000000000000001', 'profile')
$$;
select throws_ok($$select pg_temp.intent(1)$$, '23503', null, 'unknown chain_id fails the FK');
select lives_ok($$select pg_temp.intent(59141)$$, 'legacy 59141 rows stay valid');
select lives_ok($$select pg_temp.intent(84532)$$, '84532 passes the FK');

-- ===== 4. set_chain_enabled =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select throws_ok($$select public.set_chain_enabled(8453, false)$$, 'forbidden', 'member without bit 512: forbidden');
select is((select count(*)::int from public.chains), 6, 'active member can select chains');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('t.out')::uuid);
select is((select count(*)::int from public.chains), 0, 'non-member sees no chains');
select tests.clear_authentication();

select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select throws_ok($$select public.set_chain_enabled(59144, true)$$, 'chain_invalid', 'a Linea chain cannot be enabled');
select throws_ok($$select public.set_chain_enabled(1, true)$$, 'chain_invalid', 'unknown chain rejected');
select lives_ok($$select public.set_chain_enabled(8453, false)$$, 'SuperAdmin disables 8453');
select is((select enabled from public.chains where chain_id = 8453), false, '8453 is disabled');
select is(public.economy_config() -> 'enabledChainIds', '[84532, 42161, 421614]'::jsonb, 'a disabled chain leaves enabledChainIds');
select lives_ok($$select public.set_chain_enabled(8453, true)$$, 'SuperAdmin enables 8453 again');
select is((select enabled from public.chains where chain_id = 8453), true, '8453 is enabled again');
select tests.clear_authentication();

-- audit_log is readable by moderators/admin only: read as postgres
select results_eq(
  $$select actor_member_id, payload from public.audit_log where action = 'economy.chain_enabled' order by id$$,
  $$values (current_setting('t.admin')::uuid, '{"chainId":8453,"enabled":false}'::jsonb),
           (current_setting('t.admin')::uuid, '{"chainId":8453,"enabled":true}'::jsonb)$$,
  'audit: one economy.chain_enabled row per change');

-- ===== 5. receive_networks =====
select is((select receive_networks from public.members where id = current_setting('t.plain')::uuid),
  '{base,arbitrum}'::text[], 'a new member receives on both networks');
select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select lives_ok($$select public.set_receive_networks('{arbitrum}')$$, 'member keeps only arbitrum');
select is(public.receive_networks_of(current_setting('t.plain')::uuid), '{arbitrum}'::text[], 'arbitrum saved');
select throws_ok($$select public.set_receive_networks('{}')$$, 'invalid_input', 'empty set rejected');
select throws_ok($$select public.set_receive_networks('{linea}')$$, 'invalid_input', 'linea rejected');
select throws_ok($$select public.set_receive_networks(null)$$, 'invalid_input', 'null rejected');
select lives_ok($$select public.set_receive_networks('{base,base}')$$, 'duplicates accepted');
select is(public.receive_networks_of(current_setting('t.plain')::uuid), '{base}'::text[], 'duplicates collapse to {base}');
select is(public.receive_networks_of(current_setting('t.admin')::uuid), '{base,arbitrum}'::text[], 'another member reads the default');
select throws_ok(format($$select public.receive_networks_of(%L::uuid)$$, current_setting('t.banned')),
  'not_found', 'a banned member has no receive networks');
select throws_ok($$update public.members set receive_networks = '{base}' where id = public.current_member_id()$$,
  '42501', null, 'no direct column write');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('t.out')::uuid);
select throws_ok($$select public.set_receive_networks('{base}')$$, 'forbidden', 'non-member: set_receive_networks forbidden');
select throws_ok(format($$select public.receive_networks_of(%L::uuid)$$, current_setting('t.plain')),
  'forbidden', 'non-member: receive_networks_of forbidden');
select tests.clear_authentication();

-- ===== 6. flags and economy_config =====
select is((select value from public.app_config where key = 'legacy_dao_enabled'), 'false'::jsonb, 'legacy_dao_enabled = false');
select is((select value from public.app_config where key = 'min_fee_bps'), '0'::jsonb, 'min_fee_bps = 0');

select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select is(public.economy_config() -> 'enabledChainIds', '[8453, 84532, 42161, 421614]'::jsonb,
  'enabledChainIds: base first, then testnet, then chain_id');
select is(public.economy_config() -> 'networks' -> '84532' ->> 'safe', '0x380f2e12081995359e2ab88e3c31c6b227904234',
  'networks carries the lowercase Safe');
select is((select array_agg(k order by k::int) from jsonb_object_keys(public.economy_config() -> 'networks') k),
  '{8453,42161,84532,421614}'::text[], 'networks: the four non-Linea chains only');
select is(public.economy_config() -> 'legacyDaoEnabled', 'false'::jsonb, 'legacyDaoEnabled is false');
select tests.clear_authentication();

select * from finish();
rollback;
