-- P4 Task 2 (migration 20261025300001): rate limit by IP for the public checker and the free API.
--   public.ip_rate_limit_hit(subject, bucket): service_role only; subject 'ip:...' (<= 80 chars); buckets checker_web
--   (30 / 10 min) and api_free (60 / 1 h); the hit past the max raises rate_limited.
begin;
select plan(11);

select ok(has_function_privilege('service_role', 'public.ip_rate_limit_hit(text,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.ip_rate_limit_hit(text,text)', 'execute')
      and not has_function_privilege('anon', 'public.ip_rate_limit_hit(text,text)', 'execute'),
  'only service_role can execute ip_rate_limit_hit');

set local role anon;
select throws_ok($$select public.ip_rate_limit_hit('ip:aaaa', 'checker_web')$$, '42501', null, 'anon cannot call it');
reset role;
set local role authenticated;
select throws_ok($$select public.ip_rate_limit_hit('ip:aaaa', 'checker_web')$$, '42501', null, 'authenticated cannot call it');
reset role;

set local role service_role;
select lives_ok($$select public.ip_rate_limit_hit('ip:aaaa', 'checker_web') from generate_series(1, 30)$$,
  '30 hits on checker_web are fine');
select throws_ok($$select public.ip_rate_limit_hit('ip:aaaa', 'checker_web')$$, 'P0001', 'rate_limited',
  'the 31st hit is rate_limited');
select lives_ok($$select public.ip_rate_limit_hit('ip:bbbb', 'checker_web')$$, 'another subject has its own counter');
select lives_ok($$select public.ip_rate_limit_hit('ip:cccc', 'api_free') from generate_series(1, 60)$$,
  '60 hits on api_free are fine');
select throws_ok($$select public.ip_rate_limit_hit('ip:cccc', 'api_free')$$, 'P0001', 'rate_limited',
  'the 61st hit is rate_limited');
select throws_ok($$select public.ip_rate_limit_hit('ip:aaaa', 'nope')$$, 'P0001', 'invalid_input', 'unknown bucket');
select throws_ok($$select public.ip_rate_limit_hit('u:aaaa', 'checker_web')$$, 'P0001', 'invalid_input',
  'a subject without the ip: prefix');
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('a', 78), 'checker_web')$$, 'P0001', 'invalid_input',
  'a subject over 80 chars');
reset role;

select * from finish();
rollback;
