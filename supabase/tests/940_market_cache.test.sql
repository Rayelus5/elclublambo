-- F4b Task 1: market_cache is a service-role-only last-good copy of the CoinGecko payloads.
begin;
select plan(14);

select has_table('public', 'market_cache', 'market_cache exists');
select col_is_pk('public', 'market_cache', 'key', 'key is the primary key');
select ok((select relrowsecurity from pg_class where oid = 'public.market_cache'::regclass), 'RLS enabled');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'market_cache'), 0, 'no policies');

select ok(not has_table_privilege('anon', 'public.market_cache', 'select'), 'anon cannot select');
select ok(not has_table_privilege('anon', 'public.market_cache', 'insert'), 'anon cannot insert');
select ok(not has_table_privilege('authenticated', 'public.market_cache', 'select'), 'authenticated cannot select');
select ok(not has_table_privilege('authenticated', 'public.market_cache', 'insert'), 'authenticated cannot insert');
select ok(not has_table_privilege('authenticated', 'public.market_cache', 'update'), 'authenticated cannot update');
select ok(not has_table_privilege('authenticated', 'public.market_cache', 'delete'), 'authenticated cannot delete');

set local role service_role;

insert into public.market_cache (key, payload, fetched_at) values ('markets:top100', '[1]'::jsonb, '2026-10-18T10:00:00Z');
select is((select payload from public.market_cache where key = 'markets:top100'), '[1]'::jsonb, 'service role inserts and reads');

insert into public.market_cache (key, payload, fetched_at) values ('markets:top100', '[2]'::jsonb, '2026-10-18T10:01:00Z')
  on conflict (key) do update set payload = excluded.payload, fetched_at = excluded.fetched_at;
select is((select payload from public.market_cache where key = 'markets:top100'), '[2]'::jsonb, 'service role upserts');
select is((select count(*)::int from public.market_cache), 1, 'one row per key');

reset role;
set local role authenticated;
select throws_ok($$ select * from public.market_cache $$, '42501', null, 'authenticated select denied');
reset role;

select * from finish();
rollback;
