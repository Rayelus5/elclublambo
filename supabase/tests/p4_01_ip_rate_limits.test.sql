-- P4 Task 2 (migration 20261025300001): rate limit by IP for the public checker and the API.
--   public.ip_rate_limit_hit(subject, bucket): service_role only; subject 'ip:' + 32 lowercase hex or 'ip:unknown';
--   buckets checker_web (30 / 10 min), api_free (60 / 1 h) and api_paid_attempt (300 / 1 h); the hit past the max
--   raises rate_limited and does not count (the raise rolls it back).
begin;
select plan(17);

select ok(has_function_privilege('service_role', 'public.ip_rate_limit_hit(text,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.ip_rate_limit_hit(text,text)', 'execute')
      and not has_function_privilege('anon', 'public.ip_rate_limit_hit(text,text)', 'execute'),
  'only service_role can execute ip_rate_limit_hit');

set local role anon;
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('a', 32), 'checker_web')$$, '42501', null, 'anon cannot call it');
reset role;
set local role authenticated;
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('a', 32), 'checker_web')$$, '42501', null, 'authenticated cannot call it');
reset role;

set local role service_role;
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('a', 32), 'checker_web') from generate_series(1, 30)$$,
  '30 hits on checker_web are fine');
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('a', 32), 'checker_web')$$, 'P0001', 'rate_limited',
  'the 31st hit is rate_limited');
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('b', 32), 'checker_web')$$, 'another subject has its own counter');
select lives_ok($$select public.ip_rate_limit_hit('ip:unknown', 'checker_web')$$, 'ip:unknown is a valid (shared) subject');
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('c', 32), 'api_free') from generate_series(1, 60)$$,
  '60 hits on api_free are fine');
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('c', 32), 'api_free')$$, 'P0001', 'rate_limited',
  'the 61st hit is rate_limited');
reset role;
select is((select hits from private.rate_limit_hits where subject = 'ip:' || repeat('c', 32) and bucket = 'api_free'), 60,
  'a rejected hit does not count (the raise rolls it back)');
set local role service_role;
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('d', 32), 'api_paid_attempt') from generate_series(1, 300)$$,
  '300 hits on api_paid_attempt are fine');
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('d', 32), 'api_paid_attempt')$$, 'P0001', 'rate_limited',
  'the 301st api_paid_attempt hit is rate_limited');
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('a', 32), 'nope')$$, 'P0001', 'invalid_input', 'unknown bucket');
select throws_ok($$select public.ip_rate_limit_hit('u:' || repeat('a', 32), 'checker_web')$$, 'P0001', 'invalid_input',
  'a subject without the ip: prefix');
select throws_ok($$select public.ip_rate_limit_hit('ip:aaaa', 'checker_web')$$, 'P0001', 'invalid_input',
  'a subject that is not 32 hex chars');
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('A', 32), 'checker_web')$$, 'P0001', 'invalid_input',
  'upper-case hex is not what the server sends');
select throws_ok($$select public.ip_rate_limit_hit(null, 'checker_web')$$, 'P0001', 'invalid_input', 'a null subject');
reset role;

select * from finish();
rollback;
