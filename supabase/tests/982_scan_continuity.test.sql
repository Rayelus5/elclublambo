-- Ruling F4-R1 (migration 20261019600003): the scan advances its cursor only after a balance-continuity check.
--   record_safe_scan = record_safe_operations + the Safe's token balances at p_to_block, in the same transaction; it
--   clears the gap counter. record_scan_gap counts a run that did not advance. treasury_scan_gap shows it to treasurers.
begin;
select plan(20);

create function tests.gsafe() returns text language sql stable as $$
  select c.safe_address from public.chain_config c where c.chain_id = 59141
$$;
create function tests.guser(p_member text) returns uuid language sql stable as $$
  select auth_user_id from public.members where id = current_setting('t.' || p_member)::uuid
$$;
create function tests.gscan(p_to bigint, p_balances jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_safe_scan(59141, tests.gsafe(), '[]'::jsonb, p_to, p_balances);
  reset role;
  return v;
end;
$$;
create function tests.ggap() returns int language plpgsql as $$
declare v int;
begin
  set local role service_role;
  v := public.record_scan_gap(59141);
  reset role;
  return v;
end;
$$;
create function tests.gread() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.dao_scan_balances(59141);
  reset role;
  return v;
end;
$$;
create function tests.gtreasury(p_member text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.guser(p_member));
  v := public.treasury_scan_gap();
  perform tests.clear_authentication();
  return v;
end;
$$;

select set_config('t.a', tests.create_member('0x' || lpad('f9820', 40, '0'), null, true)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9821', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.m', tests.create_member('0x' || lpad('f9822', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T982 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T982 tesorero';
update public.chain_config set safe_address = '0x' || lpad('5afe98201', 40, '0'), platform_wallet = null where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
delete from public.dao_scan_state where chain_id = 59141;

-- ===== grants and definitions =====
select ok((select bool_and(has_function_privilege('service_role', f, 'execute')
                           and not has_function_privilege('authenticated', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute'))
           from unnest(array['public.record_safe_scan(int,text,jsonb,bigint,jsonb)', 'public.record_scan_gap(int)',
                             'public.dao_scan_balances(int)']) f),
  'record_safe_scan, record_scan_gap and dao_scan_balances are service-only');
select ok(has_function_privilege('authenticated', 'public.treasury_scan_gap()', 'execute')
          and not has_function_privilege('anon', 'public.treasury_scan_gap()', 'execute'),
  'treasury_scan_gap: authenticated (gated in the body), not anon');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.record_safe_scan(int,text,jsonb,bigint,jsonb)'::regprocedure,
                         'public.record_scan_gap(int)'::regprocedure, 'public.dao_scan_balances(int)'::regprocedure,
                         'public.treasury_scan_gap()'::regprocedure)),
  'all four are security definer with an empty search_path');
select ok(has_function_privilege('service_role', 'public.record_safe_operations(int,text,jsonb,bigint)', 'execute'),
  'record_safe_operations keeps its signature and grant');

-- ===== first scan: no state yet =====
select is(tests.gread(), null::jsonb, 'no scan state: no stored balances');
select is(tests.gscan(100, '{"USDC": "5000000", "WETH": "0"}'), jsonb_build_object('inserted', 0, 'alerts', 0),
  'the first scan records nothing');
select is(tests.gread(), jsonb_build_object('block', '100', 'balances', jsonb_build_object('USDC', '5000000', 'WETH', '0')),
  'the cursor and the balances at it are stored together');

-- ===== gaps =====
select is(tests.ggap(), 1, 'a run that did not advance counts one gap');
select is(tests.ggap(), 2, 'and the next one two');
select is((select last_block from public.dao_scan_state where chain_id = 59141), 100::bigint, 'a gap never moves the cursor');
select is(tests.gtreasury('t') ->> 'runs', '2', 'treasurers see the consecutive gap runs');
select ok((tests.gtreasury('t') ->> 'since')::timestamptz <= now(), 'and since when');
select throws_ok($$select tests.gtreasury('m')$$, 'forbidden', 'a member without bit 256 cannot read it');

-- ===== a continuous run advances, stores the new balances and clears the gap =====
select is(tests.gscan(150, '{"USDC": "7000000", "WETH": "1"}'), jsonb_build_object('inserted', 0, 'alerts', 0), 'a checked run records');
select is(tests.gread(), jsonb_build_object('block', '150', 'balances', jsonb_build_object('USDC', '7000000', 'WETH', '1')),
  'cursor and balances move together');
select is(tests.gtreasury('t'), null::jsonb, 'the gap is cleared');

-- ===== an older concurrent run cannot overwrite newer balances; null keeps them =====
select tests.gscan(120, '{"USDC": "1", "WETH": "1"}');
select is(tests.gread(), jsonb_build_object('block', '150', 'balances', jsonb_build_object('USDC', '7000000', 'WETH', '1')),
  'a run that ends below the stored block keeps the newer balances and cursor');
select tests.gscan(150, null);
select is(tests.gread() -> 'balances', jsonb_build_object('USDC', '7000000', 'WETH', '1'), 'null balances keep the stored ones');

-- ===== input =====
select throws_ok($$select tests.gscan(160, '{"DOGE": "1"}')$$, 'invalid_input', 'an unknown token is refused');
select throws_ok($$select tests.gscan(160, '{"USDC": "-1"}')$$, 'invalid_input', 'a negative balance is refused');

select * from finish();
rollback;
