-- F5 Task 2 follow-up (migration 20261019700102):
--   Ruling F5-R17: members with ADMINISTRATOR (512) are exempt from invite_create; everyone else keeps 30 per day.
--   prune_rate_limits(): service_role only; deletes the hits whose window ended long ago (window_start older than
--   1 day of margin + the longest window, 1 day) and answers {"deleted": n}.
begin;
set local client_min_messages = warning;
select plan(10);

create function tests.login(p_member text) returns void language plpgsql as $$
begin
  perform tests.clear_authentication();
  perform tests.authenticate_as((select m.auth_user_id from public.members m where m.id = p_member::uuid));
end;
$$;
create function tests.rep(p_sql text, p_n int) returns void language plpgsql as $$
begin
  for i in 1..p_n loop
    execute p_sql;
  end loop;
end;
$$;

select set_config('t.s', tests.create_member('0x' || lpad('f9920', 40, '0'), null, true)::text, true);
select set_config('t.p', tests.create_member('0x' || lpad('f9921', 40, '0'), current_setting('t.s')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.s')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.p')::uuid, id from public.roles where name = 'Padrino';
delete from private.rate_limit_hits;

-- ===== F5-R17 =====
select tests.login(current_setting('t.s'));
select lives_ok($$select tests.rep($q$select public.create_invite(1, 24)$q$, 35)$$, 'an administrator creates 35 invites in a day');
select tests.login(current_setting('t.p'));
select lives_ok($$select tests.rep($q$select public.create_invite(1, 24)$q$, 30)$$, 'a Padrino (CREATE_INVITES) creates 30');
select throws_ok($$select public.create_invite(1, 24)$$, 'P0001', 'rate_limited', 'and is limited at the 31st');
select tests.clear_authentication();
select is((select count(*)::int from private.rate_limit_hits where subject = current_setting('t.s') and bucket = 'invite_create'), 0,
  'an administrator is not charged at all');

-- ===== prune_rate_limits =====
select ok(has_function_privilege('service_role', 'public.prune_rate_limits()', 'execute')
          and not has_function_privilege('authenticated', 'public.prune_rate_limits()', 'execute')
          and not has_function_privilege('anon', 'public.prune_rate_limits()', 'execute'),
  'prune_rate_limits is service_role only');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
           where p.oid = 'public.prune_rate_limits()'::regprocedure), 'prune_rate_limits is definer with an empty search_path');
delete from private.rate_limit_hits;
insert into private.rate_limit_hits (subject, bucket, window_start, hits) values
  ('old1', 'message_min', now() - interval '3 days', 5),
  ('old2', 'withdrawal', now() - interval '2 days 1 hour', 5),
  ('day', 'withdrawal', now() - interval '1 day 12 hours', 5),
  ('now', 'message_min', date_bin(interval '1 minute', now(), timestamptz '2000-01-01Z'), 5);
set local role service_role;
select is(public.prune_rate_limits(), '{"deleted": 2}'::jsonb, 'the two rows past 2 days are pruned');
reset role;
select is((select string_agg(subject, ',' order by subject) from private.rate_limit_hits), 'day,now',
  'rows inside the margin (even a 1-day window opened 36 h ago) stay');
set local role service_role;
select is(public.prune_rate_limits(), '{"deleted": 0}'::jsonb, 'a second run has nothing to prune');
reset role;
select tests.login(current_setting('t.p'));
select throws_ok($$select public.prune_rate_limits()$$, '42501', null, 'a member cannot prune');
select tests.clear_authentication();

select * from finish();
rollback;
