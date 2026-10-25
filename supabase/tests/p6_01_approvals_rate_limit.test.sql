-- P6 Task 2 (migration 20261025600001): the approvals page's IP bucket (P6-R2e).
--   ip_rate_limit_hit(..., 'approvals_scan') 30 / 10 min per IP; the existing buckets keep working; service_role only.
begin;
select plan(8);

select ok(has_function_privilege('service_role', 'public.ip_rate_limit_hit(text,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.ip_rate_limit_hit(text,text)', 'execute')
      and not has_function_privilege('anon', 'public.ip_rate_limit_hit(text,text)', 'execute'),
  'only service_role can execute ip_rate_limit_hit');

set local role anon;
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('a', 32), 'approvals_scan')$$, '42501', null, 'anon cannot call it');
reset role;
set local role authenticated;
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('a', 32), 'approvals_scan')$$, '42501', null, 'authenticated cannot call it');
reset role;

set local role service_role;
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('f', 32), 'approvals_scan') from generate_series(1, 30)$$,
  '30 approvals_scan hits pass');
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('f', 32), 'approvals_scan')$$, 'P0001', 'rate_limited',
  'the 31st approvals_scan hit is rate_limited');
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('f', 32), 'nope')$$, 'P0001', 'invalid_input',
  'an unknown bucket is still invalid_input');
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('f', 32), 'vouch_refresh'), public.ip_rate_limit_hit('ip:' || repeat('f', 32), 'checker_web')$$,
  'vouch_refresh and checker_web still work (own counters)');
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('f', 32), 'api_free'), public.ip_rate_limit_hit('ip:' || repeat('f', 32), 'api_paid_attempt')$$,
  'api_free and api_paid_attempt still work');
reset role;

select * from finish();
rollback;
