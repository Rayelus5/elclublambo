-- F4a Task 4 fix (ruling F4a-R6): per-chain ETH snapshot cursor for the native-ETH diff of the operations scan.
begin;
select plan(13);

select ok(not has_function_privilege('anon', 'public.dao_eth_scan_from(int)', 'execute'), 'anon cannot dao_eth_scan_from');
select ok(not has_function_privilege('authenticated', 'public.dao_eth_scan_from(int)', 'execute'), 'authenticated cannot dao_eth_scan_from');
select ok(has_function_privilege('service_role', 'public.dao_eth_scan_from(int)', 'execute'), 'service_role can dao_eth_scan_from');
select ok(not has_function_privilege('anon', 'public.set_dao_eth_cursor(int,bigint)', 'execute'), 'anon cannot set_dao_eth_cursor');
select ok(not has_function_privilege('authenticated', 'public.set_dao_eth_cursor(int,bigint)', 'execute'), 'authenticated cannot set_dao_eth_cursor');
select ok(has_function_privilege('service_role', 'public.set_dao_eth_cursor(int,bigint)', 'execute'), 'service_role can set_dao_eth_cursor');

set local role service_role;

select is(public.dao_eth_scan_from(59141), null::bigint, 'null before any scan');
select throws_ok($$ select public.set_dao_eth_cursor(59141, 10) $$, 'not_found', 'cannot set the ETH cursor before the chain was scanned');

select public.record_safe_operations(59141, '[]'::jsonb, 500);
select is(public.dao_eth_scan_from(59141), null::bigint, 'still null after the first operations scan');

select public.set_dao_eth_cursor(59141, 700);
select is(public.dao_eth_scan_from(59141), 700::bigint, 'set');

select public.set_dao_eth_cursor(59141, 650);
select is(public.dao_eth_scan_from(59141), 700::bigint, 'never moves backwards');

select throws_ok($$ select public.set_dao_eth_cursor(59141, -1) $$, 'invalid_input', 'rejects a negative block');
select is(public.dao_scan_from(59141), 500::bigint, 'the log cursor is untouched');

reset role;
select * from finish();
rollback;
