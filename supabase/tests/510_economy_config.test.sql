begin;
select plan(35);

-- fixtures: admin (bootstrap, SuperAdmin), plain active member, outsider (auth user without membership)
select set_config('t.admin', tests.create_member('0xa510000000000000000000000000000000000001', null, true)::text, true);
select set_config('t.plain', tests.create_member('0xa510000000000000000000000000000000000002', current_setting('t.admin')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.admin')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.out', tests.create_wallet_user('0xb510000000000000000000000000000000000001')::text, true);

create function pg_temp.uid(p_member text) returns uuid language sql security definer as
  $$ select auth_user_id from public.members where id = p_member::uuid $$;
grant execute on function pg_temp.uid(text) to public;

-- ===== privileges =====
select ok(not has_function_privilege('anon', 'public.economy_config()', 'execute'), 'anon cannot economy_config');
select ok(has_function_privilege('authenticated', 'public.economy_config()', 'execute'), 'authenticated can economy_config');
select ok(not has_function_privilege('anon', 'public.set_active_chain(int)', 'execute'), 'anon cannot set_active_chain');
select ok(not has_function_privilege('anon', 'public.set_min_fee_bps(int)', 'execute'), 'anon cannot set_min_fee_bps');
select ok(not has_function_privilege('anon', 'public.set_chain_addresses(int,text,text)', 'execute'), 'anon cannot set_chain_addresses');
select ok(has_function_privilege('authenticated', 'public.set_active_chain(int)', 'execute'), 'authenticated can set_active_chain');
select ok(has_function_privilege('authenticated', 'public.set_min_fee_bps(int)', 'execute'), 'authenticated can set_min_fee_bps');
select ok(has_function_privilege('authenticated', 'public.set_chain_addresses(int,text,text)', 'execute'), 'authenticated can set_chain_addresses');
select ok(not has_table_privilege('anon', 'public.chain_config', 'select'), 'anon has no SELECT on chain_config');
select ok(not has_table_privilege('authenticated', 'public.chain_config', 'insert')
      and not has_table_privilege('authenticated', 'public.chain_config', 'update')
      and not has_table_privilege('authenticated', 'public.chain_config', 'delete')
      and not has_table_privilege('authenticated', 'public.chain_config', 'truncate'), 'authenticated has no write privileges on chain_config');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'chain_config'
           and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')), 0, 'chain_config has no write policy');

-- ===== defaults =====
select is((select count(*)::int from public.chain_config), 2, 'chain_config seeded with two chains');
select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select is(public.economy_config(),
  '{"activeChainId":59141,"minFeeBps":0,"chains":{"59144":{"safe":null,"platform":null,"withdrawalsEnabled":false,"weightedRafflesEnabled":false},"59141":{"safe":null,"platform":null,"withdrawalsEnabled":false,"weightedRafflesEnabled":true}}}'::jsonb,
  'defaults read through economy_config');
select is((select count(*)::int from public.chain_config), 2, 'active member can select chain_config');

-- ===== non-admin cannot write (Review Focus 4) =====
select throws_ok($$select public.set_active_chain(59144)$$, 'forbidden', 'non-admin: set_active_chain forbidden');
select throws_ok($$select public.set_min_fee_bps(100)$$, 'forbidden', 'non-admin: set_min_fee_bps forbidden');
select throws_ok($$select public.set_chain_addresses(59144, '0x1111111111111111111111111111111111111111', null)$$,
  'forbidden', 'non-admin: set_chain_addresses forbidden');
select tests.clear_authentication();

-- ===== outsider / anon =====
select tests.authenticate_as(current_setting('t.out')::uuid);
select throws_ok($$select public.economy_config()$$, 'forbidden', 'non-member cannot economy_config');
select is((select count(*)::int from public.chain_config), 0, 'non-member sees no chain_config rows');
select throws_ok($$select public.set_active_chain(59144)$$, 'forbidden', 'non-member: set_active_chain forbidden');
select tests.clear_authentication();
set local role anon;
select throws_ok($$select count(*) from public.chain_config$$, '42501', null, 'anon cannot select chain_config');
select throws_ok($$select public.economy_config()$$, '42501', null, 'anon cannot call economy_config');
reset role;

-- ===== admin happy path =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select lives_ok($$select public.set_active_chain(59144)$$, 'admin sets active chain');
select lives_ok($$select public.set_min_fee_bps(260)$$, 'admin sets min fee');
select lives_ok($$select public.set_chain_addresses(59144, '0xAbCdEf0123456789aBcDeF0123456789abcdef01', '0x2222222222222222222222222222222222222222')$$,
  'admin sets addresses');
select is(public.economy_config(),
  '{"activeChainId":59144,"minFeeBps":260,"chains":{"59144":{"safe":"0xabcdef0123456789abcdef0123456789abcdef01","platform":"0x2222222222222222222222222222222222222222","withdrawalsEnabled":false,"weightedRafflesEnabled":false},"59141":{"safe":null,"platform":null,"withdrawalsEnabled":false,"weightedRafflesEnabled":true}}}'::jsonb,
  'values read back, addresses lowercased');
select tests.clear_authentication();

-- audit rows with old and new values (audit_log is readable by moderators/admin only: read as postgres)
select is((select payload from public.audit_log where action = 'economy.active_chain'),
  '{"old":59141,"new":59144}'::jsonb, 'audit: active chain old/new');
select is((select payload from public.audit_log where action = 'economy.min_fee'),
  '{"old":0,"new":260}'::jsonb, 'audit: min fee old/new');
select is((select payload from public.audit_log where action = 'economy.addresses'),
  '{"chain":59144,"old":{"safe":null,"platform":null},"new":{"safe":"0xabcdef0123456789abcdef0123456789abcdef01","platform":"0x2222222222222222222222222222222222222222"},"reset":true}'::jsonb,
  'audit: addresses old/new (+ F4a-R12 reset flag: a first Safe starts the chain clean)');

-- ===== validation =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select throws_ok($$select public.set_min_fee_bps(5001)$$, 'fee_out_of_range', '5001 bps rejected');
select throws_ok($$select public.set_min_fee_bps(-1)$$, 'fee_out_of_range', 'negative bps rejected');
select throws_ok($$select public.set_active_chain(1)$$, 'chain_invalid', 'unknown active chain rejected');
select throws_ok($$select public.set_chain_addresses(1, null, null)$$, 'chain_invalid', 'unknown chain for addresses rejected');
select throws_ok($$select public.set_chain_addresses(59144, '0x0000000000000000000000000000000000000000', null)$$,
  'address_invalid', 'zero address rejected');
select throws_ok($$select public.set_chain_addresses(59144, '0x123', null)$$, 'address_invalid', 'malformed address rejected');
select tests.clear_authentication();

select * from finish();
rollback;
