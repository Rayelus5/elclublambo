-- F4e Task 2 (migration 20261019500002): poll messages with private ballots and a creation-time weight snapshot.
--   A poll is a messages row (kind 'poll', body = the normalized question) plus polls / poll_options. Ballots and weight
--   snapshots live in schema private, which no API role (anon, authenticated, service_role) can use.
--   Weights (linear / quadratic) are snapshotted at creation from unlocked shares on the active chain, active members
--   only, positive only; the club fund has no member row and never weighs.
-- Setup: 59141 active; A 9e18 shares (1e18 locked), B 4e18, C 0, D 1e18 but banned; club_shares 5e18.
begin;
select plan(101);

-- ===== helpers (rolled back with the test) =====
create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.cfg(p_key text) returns text language sql as $$ select current_setting(p_key) $$;
-- P1 Task 1: create_poll no longer takes a weight mode. A legacy weighted row (kept for the delete cases) is seeded
-- by hand: an equal poll turned linear / quadratic with the old creation snapshot, definer so it works in a session.
create function tests.legacy_weights(p_poll uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.polls set weight_mode = p_mode, chain_id = 59141 where message_id = p_poll;
  insert into private.poll_weight_snapshots (poll_id, member_id, weight)
  select p_poll, w.member_id, w.weight
  from (select p.member_id,
               case when p_mode = 'linear' then greatest(p.shares - p.locked_shares, 0)
                    else public._isqrt(greatest(p.shares - p.locked_shares, 0)) end as weight
        from public.dao_positions p
        join public.members m on m.id = p.member_id and m.status = 'active'
        where p.chain_id = 59141) w
  where w.weight > 0;
end;
$$;
create function tests.poll(p_ch text, p_question text, p_options text[], p_mode text default 'equal',
                           p_closes timestamptz default now() + interval '1 day')
returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.create_poll(p_ch::uuid, p_question, p_options, p_closes);
  if p_mode in ('linear', 'quadratic') then perform tests.legacy_weights(v, p_mode); end if;
  return v;
end;
$$;
create function tests.snap(p_poll uuid) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(s.member_id::text, s.weight::text), '{}'::jsonb)
  from private.poll_weight_snapshots s where s.poll_id = p_poll
$$;
create function tests.ev(p_event text, p_id uuid) returns int language sql as $$
  select count(*)::int from realtime.messages m where m.event = p_event and m.payload->>'id' = p_id::text
$$;

-- ===== fixtures =====
select set_config('t.s', tests.create_member('0x' || lpad('f9710', 40, '0'), null, true)::text, true);                       -- SuperAdmin
select set_config('t.a', tests.create_member('0x' || lpad('f9711', 40, '0'), current_setting('t.s')::uuid)::text, true);    -- Verificado
select set_config('t.p', tests.create_member('0x' || lpad('f9712', 40, '0'), current_setting('t.s')::uuid)::text, true);    -- plain
select set_config('t.b', tests.create_member('0x' || lpad('f9713', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('f9714', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.d', tests.create_member('0x' || lpad('f9715', 40, '0'), current_setting('t.s')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.s')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where system_key = 'verified';
select set_config('t.us', (select auth_user_id::text from public.members where id = current_setting('t.s')::uuid), true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.up', (select auth_user_id::text from public.members where id = current_setting('t.p')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.ud', (select auth_user_id::text from public.members where id = current_setting('t.d')::uuid), true);

select set_config('t.cat', tests.create_channel(null, 'category', 'T971cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't971')::text, true);
select set_config('t.ch2', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't971mute')::text, true);
select set_config('t.ch3', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't971del')::text, true);
update public.channels set default_follow = 'all' where id = current_setting('t.ch')::uuid;
-- A cannot send in ch2
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.ch2')::uuid, 'member', current_setting('t.a')::uuid, 0, 2);

update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
delete from public.dao_positions where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, locked_shares) values
  (59141, current_setting('t.a')::uuid, 9000000000000000000, 1000000000000000000),
  (59141, current_setting('t.b')::uuid, 4000000000000000000, 0),
  (59141, current_setting('t.c')::uuid, 0, 0),
  (59141, current_setting('t.d')::uuid, 1000000000000000000, 0),
  (59144, current_setting('t.c')::uuid, 7000000000000000000, 0);   -- another chain never counts
update public.dao_state set club_shares = 5000000000000000000, total_shares = 19000000000000000000 where chain_id = 59141;
update public.members set status = 'banned' where id = current_setting('t.d')::uuid;

-- ===== 1. grants, schema, privacy =====
select ok(not has_function_privilege('anon', 'public.create_poll(uuid,text,text[],timestamptz)', 'execute'),
  'anon cannot create_poll');
select ok(has_function_privilege('authenticated', 'public.create_poll(uuid,text,text[],timestamptz)', 'execute'),
  'members can call create_poll (the bits are checked inside)');
select ok(not has_function_privilege('anon', 'public._isqrt(numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public._isqrt(numeric)', 'execute')
      and not has_function_privilege('service_role', 'public._isqrt(numeric)', 'execute'),
  'no API role can execute _isqrt');
select ok(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where p.oid = 'public._isqrt(numeric)'::regprocedure and a.grantee <> p.proowner
                        and a.privilege_type = 'EXECUTE'),
  '_isqrt is executable by its owner only (no PUBLIC grant either)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
           from pg_proc p
           where p.oid in ('public.create_poll(uuid,text,text[],timestamptz)'::regprocedure,
                           'public._isqrt(numeric)'::regprocedure,
                           'public.edit_message(uuid,jsonb,text)'::regprocedure,
                           'public.delete_message(uuid)'::regprocedure)),
  'the new and replaced functions are definer with an empty search_path');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon cannot use schema private');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated cannot use schema private');
select ok(not has_schema_privilege('service_role', 'private', 'USAGE'), 'service_role cannot use schema private');
select ok(not has_table_privilege('anon', 'private.poll_votes', 'select, insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('authenticated', 'private.poll_votes', 'select, insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('service_role', 'private.poll_votes', 'select, insert, update, delete, truncate, references, trigger'),
  'no API role holds any privilege on private.poll_votes');
select ok(not has_table_privilege('anon', 'private.poll_weight_snapshots', 'select, insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('authenticated', 'private.poll_weight_snapshots', 'select, insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('service_role', 'private.poll_weight_snapshots', 'select, insert, update, delete, truncate, references, trigger'),
  'no API role holds any privilege on private.poll_weight_snapshots');
select ok(not exists (select 1 from information_schema.column_privileges
                      where table_schema = 'private' and table_name in ('poll_votes', 'poll_weight_snapshots')
                        and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  'no column-level grant on the private tables either');
select ok(not exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
                      where (d.defaclnamespace = 0 or d.defaclnamespace = 'private'::regnamespace)
                        and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)),
  'no default privilege hands a future object in private to an API role');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace
                                                and p.oid not in ('private.rate_limit(text,text,int,interval)'::regprocedure,
                                                                  'private.chain_enabled(int)'::regprocedure)),
  'schema private still holds no function but private.rate_limit and private.chain_enabled (F5 Task 2 / P0 Task 1, executable by no API role: 990, 995)');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select * from private.poll_votes$$, '42501', null, 'authenticated cannot read private.poll_votes');
select throws_ok($$select * from private.poll_weight_snapshots$$, '42501', null,
  'authenticated cannot read private.poll_weight_snapshots');
select tests.clear_authentication();
set local role anon;
select throws_ok($$select * from private.poll_votes$$, '42501', null, 'anon cannot read private.poll_votes');
select throws_ok($$select * from private.poll_weight_snapshots$$, '42501', null, 'anon cannot read private.poll_weight_snapshots');
reset role;
set local role service_role;
select throws_ok($$select * from private.poll_votes$$, '42501', null, 'service_role cannot read private.poll_votes');
select throws_ok($$select * from private.poll_weight_snapshots$$, '42501', null,
  'service_role cannot read private.poll_weight_snapshots');
reset role;
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.polls'::regclass, 'public.poll_options'::regclass,
                         'private.poll_votes'::regclass, 'private.poll_weight_snapshots'::regclass)),
  'RLS is on for polls, poll_options, poll_votes and poll_weight_snapshots');
select ok(not exists (select 1 from pg_policies where (schemaname = 'public' and tablename in ('polls', 'poll_options'))
                                                 or schemaname = 'private'),
  'no policy on any poll table');
select ok(not has_table_privilege('authenticated', 'public.polls', 'insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('authenticated', 'public.poll_options', 'insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('anon', 'public.polls', 'select, insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('anon', 'public.poll_options', 'select, insert, update, delete, truncate, references, trigger'),
  'members cannot write polls or poll_options; anon has nothing');
select ok(not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name in ('polls', 'poll_options')
                        and column_name in ('member_id', 'weight', 'voter_id', 'option_id')),
  'public poll tables carry no member-to-option or weight column');
select lives_ok($$insert into public.notifications (recipient_id, kind, data)
                  values (tests.cfg('t.a')::uuid, 'poll_closed', '{}'::jsonb)$$, 'notification kind poll_closed is accepted');
select throws_ok($$insert into public.notifications (recipient_id, kind, data)
                   values (tests.cfg('t.a')::uuid, 'poll_nope', '{}'::jsonb)$$, '23514', null, 'an unknown kind is still refused');

-- ===== 2. _isqrt =====
select is(public._isqrt(0), 0::numeric, 'isqrt 0 = 0');
select is(public._isqrt(1), 1::numeric, 'isqrt 1 = 1');
select is(public._isqrt(15), 3::numeric, 'isqrt 15 = 3 (n^2 - 1)');
select is(public._isqrt(16), 4::numeric, 'isqrt 16 = 4');
select is(public._isqrt(17), 4::numeric, 'isqrt 17 = 4');
select is(public._isqrt(1000000000000000000), 1000000000::numeric, 'isqrt 10^18 = 10^9');
select is(public._isqrt(8000000000000000000), 2828427124::numeric, 'isqrt 8*10^18 = 2828427124');
select is(public._isqrt(1000000000000000000000000000000000000 - 1), 999999999999999999::numeric,
  'isqrt (10^36 - 1) = 10^18 - 1');
select is(public._isqrt(1000000000000000000000000000000000000), 1000000000000000000::numeric, 'isqrt 10^36 = 10^18');
select is(public._isqrt(1000000000000000000000000000000000001), 1000000000000000000::numeric, 'isqrt (10^36 + 1) = 10^18');
select is(public._isqrt((1000000000000000001::numeric * 1000000000000000001) - 1), 1000000000000000000::numeric,
  'isqrt ((10^18 + 1)^2 - 1) = 10^18');
select is(public._isqrt(1000000000000000001::numeric * 1000000000000000001), 1000000000000000001::numeric,
  'isqrt ((10^18 + 1)^2) = 10^18 + 1');
select is(public._isqrt(power(2::numeric, 256) - 1), 340282366920938463463374607431768211455::numeric,
  'isqrt (2^256 - 1) = 2^128 - 1');
select is(public._isqrt(null), null::numeric, 'isqrt null = null (strict)');
select throws_ok($$select public._isqrt(-1)$$, 'P0001', 'invalid_input', 'isqrt of a negative -> invalid_input');

-- ===== 3. guards =====
select tests.authenticate_as(current_setting('t.up')::uuid);
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{Sí,No}')$$, 'P0001', 'forbidden',
  'a member without CREATE_POLLS -> forbidden');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select tests.poll(tests.cfg('t.ch2'), 'Q', '{Sí,No}')$$, 'P0001', 'forbidden',
  'CREATE_POLLS but SEND_MESSAGES denied on the channel -> forbidden');
select throws_ok($$select public.create_poll(null, 'Q', '{Sí,No}', now() + interval '1 day')$$, 'P0001', 'forbidden',
  'a null channel -> forbidden');
select tests.authenticate_as(current_setting('t.ud')::uuid);
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{Sí,No}')$$, 'P0001', 'forbidden', 'a banned member -> forbidden');
select tests.clear_authentication();
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{Sí,No}')$$, 'P0001', 'forbidden', 'no session -> forbidden');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select tests.poll(tests.cfg('t.ch'), '   ', '{Sí,No}')$$, 'P0001', 'question_required',
  'a blank question -> question_required');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), null, '{Sí,No}')$$, 'P0001', 'question_required',
  'a null question -> question_required');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), repeat('a', 301), '{Sí,No}')$$, 'P0001', 'question_required',
  '301 characters -> question_required');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), '  ', '{Sí}', 'majority', now())$$, 'P0001', 'question_required',
  'the question is checked before the options, the mode and the close');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{Sí}')$$, 'P0001', 'poll_options_invalid', 'one option');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{1,2,3,4,5,6,7,8,9,10,11}')$$, 'P0001', 'poll_options_invalid',
  'eleven options');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{Sí,"  sí "}')$$, 'P0001', 'poll_options_invalid',
  'a case-insensitive duplicate after trimming');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', array['Sí', repeat('b', 81)])$$, 'P0001', 'poll_options_invalid',
  'an 81-character option');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{Sí,null}')$$, 'P0001', 'poll_options_invalid', 'a null option');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{Sí,"   "}')$$, 'P0001', 'poll_options_invalid', 'a blank option');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', null)$$, 'P0001', 'poll_options_invalid', 'a null array');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{{a,b},{c,d}}')$$, 'P0001', 'poll_options_invalid',
  'a two-dimensional array');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{Sí,No}', 'equal', now() + interval '59 minutes')$$,
  'P0001', 'closes_at_invalid', 'closing in 59 minutes -> closes_at_invalid');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{Sí,No}', 'equal', now() + interval '30 days 1 minute')$$,
  'P0001', 'closes_at_invalid', 'closing in 30 days and 1 minute -> closes_at_invalid');
select throws_ok($$select tests.poll(tests.cfg('t.ch'), 'Q', '{Sí,No}', 'equal', null)$$,
  'P0001', 'closes_at_invalid', 'a null close -> closes_at_invalid');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where channel_id in (current_setting('t.ch')::uuid, current_setting('t.ch2')::uuid)),
  0, 'no refused call left a message behind');

-- ===== 4. create, equal =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok($$select tests.poll(tests.cfg('t.ch'), 'Q1', '{a,b}', 'equal', now() + interval '1 hour')$$,
  'closing in exactly 1 hour is accepted');
select lives_ok($$select tests.poll(tests.cfg('t.ch'), 'Q2', '{a,b}', 'equal', now() + interval '30 days')$$,
  'closing in exactly 30 days is accepted');
select set_config('t.pe', tests.poll(current_setting('t.ch'), E'¿Pizza\n  o sushi?',
  array['  Pizza ', 'Sushi', E'Ninguna\n de\tlas dos'], 'equal', now() + interval '2 days')::text, true);
select tests.clear_authentication();
select is((select kind from public.messages where id = current_setting('t.pe')::uuid), 'poll', 'the message is a poll');
select is((select body_text from public.messages where id = current_setting('t.pe')::uuid), '¿Pizza o sushi?',
  'the body text is the normalized question');
select is((select body from public.messages where id = current_setting('t.pe')::uuid), tests.td('¿Pizza o sushi?'),
  'the body is one paragraph holding the question as a single text node');
select is((select author_id from public.messages where id = current_setting('t.pe')::uuid), current_setting('t.a')::uuid,
  'A authored the poll message');
select is((select array_agg(label order by position) from public.poll_options where poll_id = current_setting('t.pe')::uuid),
  array['Pizza', 'Sushi', 'Ninguna de las dos'], 'three options in order, normalized');
select is((select array_agg(position::int order by position) from public.poll_options where poll_id = current_setting('t.pe')::uuid),
  array[1, 2, 3], 'positions follow the array order');
select ok((select bool_and(result_tenths is null) from public.poll_options where poll_id = current_setting('t.pe')::uuid),
  'no result is stored on an open poll');
select is((select jsonb_build_object('ch', channel_id, 'author', author_id, 'chain', chain_id, 'mode', weight_mode,
                                     'closes', closes_at = now() + interval '2 days', 'fin', finalized_at,
                                     'vc', voter_count, 'wvc', weighted_voter_count, 'pub', results_published)
           from public.polls where message_id = current_setting('t.pe')::uuid),
  jsonb_build_object('ch', current_setting('t.ch')::uuid, 'author', current_setting('t.a')::uuid, 'chain', null,
                     'mode', 'equal', 'closes', true, 'fin', null, 'vc', null, 'wvc', null, 'pub', null),
  'the polls row: channel, author, no chain, equal, the close, nothing finalized');
select is(tests.snap(current_setting('t.pe')::uuid), '{}'::jsonb, 'an equal poll stores no snapshot');
select throws_ok($$update public.messages set kind = 'nope' where id = tests.cfg('t.pe')::uuid$$,
  '23514', null, 'messages_kind_check still refuses an unknown kind');
select is(tests.ev('message_created', current_setting('t.pe')::uuid), 1, 'one message_created broadcast');
select is((select count(*)::int from public.notifications
           where message_id = current_setting('t.pe')::uuid and kind = 'channel_message'
             and recipient_id = current_setting('t.b')::uuid), 1, 'a follower of the channel gets the channel_message notice');
select is((select count(*)::int from public.notifications
           where message_id = current_setting('t.pe')::uuid
             and recipient_id in (current_setting('t.a')::uuid, current_setting('t.d')::uuid)), 0,
  'neither the author nor a banned member is notified');
select is((select count(*)::int from public.audit_log where target_id = current_setting('t.pe')::uuid
             or payload::text like '%' || current_setting('t.pe') || '%'), 0, 'creating a poll writes no audit row');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((select count(*)::int from public.polls), 0, 'a member reads no polls row directly (RLS, no policy)');
select is((select count(*)::int from public.poll_options), 0, 'a member reads no poll_options row directly');
select tests.clear_authentication();
select throws_ok($$insert into public.poll_options (poll_id, position, label) values (tests.cfg('t.pe')::uuid, 4, ' x')$$,
  '23514', null, 'a label must be trimmed');
select throws_ok($$insert into public.poll_options (poll_id, position, label) values (tests.cfg('t.pe')::uuid, 4, 'PIZZA')$$,
  '23505', null, 'labels are unique per poll, case-insensitively');
select throws_ok($$update public.polls set finalized_at = now() where message_id = tests.cfg('t.pe')::uuid$$,
  '23514', null, 'the finalize columns are all null or all set');

-- ===== 5. legacy weighted rows (setup for the delete cases) =====
-- create_poll no longer makes them; they are seeded by hand as the rows F4e left behind.
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.pl', tests.poll(current_setting('t.ch'), 'Lineal', '{Sí,No}', 'linear')::text, true);
select set_config('t.pq', tests.poll(current_setting('t.ch'), 'Cuadrática', '{Sí,No}', 'quadratic')::text, true);
select tests.clear_authentication();

-- ===== 6. edit =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.edit_message(%L, tests.td('otra'), 'x')$$, current_setting('t.pe')),
  'P0001', 'poll_not_editable', 'the author cannot edit a poll -> poll_not_editable');
select set_config('t.m1', public.post_message(current_setting('t.ch')::uuid, tests.td('hola'), 'x', false, null, null, '[]'::jsonb)::text, true);
select lives_ok(format($$select public.edit_message(%L, tests.td('hola editado'), 'x')$$, current_setting('t.m1')),
  'a normal message still edits');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($$select public.edit_message(%L, tests.td('otra'), 'x')$$, current_setting('t.pe')),
  'P0001', 'forbidden', 'someone else editing a poll still gets forbidden first');
select tests.clear_authentication();
select is((select body_text from public.messages where id = current_setting('t.pe')::uuid), '¿Pizza o sushi?',
  'the poll question is unchanged');

-- ===== 7. delete (Review Focus 5) =====
-- a ballot (seeded as the owner) on the linear poll, then A deletes it: no replies -> hard delete, everything gone
insert into private.poll_votes (poll_id, member_id, option_id)
  select current_setting('t.pl')::uuid, current_setting('t.b')::uuid, o.id
  from public.poll_options o where o.poll_id = current_setting('t.pl')::uuid and o.position = 1;
select is((select count(*)::int from private.poll_votes where poll_id = current_setting('t.pl')::uuid), 1, 'a ballot is seeded');
select set_config('t.pl_opts', (select string_agg(id::text, ',') from public.poll_options where poll_id = current_setting('t.pl')::uuid), true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((public.delete_message(current_setting('t.pl')::uuid)) ->> 'hard', 'true', 'A deletes the poll: hard delete');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where id = current_setting('t.pl')::uuid), 0, 'the message is gone');
select is((select count(*)::int from public.polls where message_id = current_setting('t.pl')::uuid), 0, 'the polls row is gone');
select is((select count(*)::int from public.poll_options where id::text = any (string_to_array(current_setting('t.pl_opts'), ','))),
  0, 'its options are gone');
select is((select count(*)::int from private.poll_votes where poll_id = current_setting('t.pl')::uuid), 0, 'its ballots are gone');
select is(tests.snap(current_setting('t.pl')::uuid), '{}'::jsonb, 'its weight snapshot is gone');

-- a poll with a thread reply, deleted by a moderator: soft delete, tombstone kind text, no polls row left
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r1', public.post_message(current_setting('t.ch')::uuid, tests.td('respuesta'), 'x', false,
  current_setting('t.pq')::uuid, null, '[]'::jsonb)::text, true);
select tests.clear_authentication();
insert into private.poll_votes (poll_id, member_id, option_id)
  select current_setting('t.pq')::uuid, current_setting('t.b')::uuid, o.id
  from public.poll_options o where o.poll_id = current_setting('t.pq')::uuid and o.position = 2;
select tests.authenticate_as(current_setting('t.us')::uuid);
select is((public.delete_message(current_setting('t.pq')::uuid)) ->> 'hard', 'false',
  'a moderator deletes a poll with a reply: soft delete');
select tests.clear_authentication();
select is((select kind || '/' || (deleted_at is not null)::text || '/' || body_text from public.messages
           where id = current_setting('t.pq')::uuid), 'text/true/', 'the tombstone has kind text and no question');
select is((select count(*)::int from public.polls where message_id = current_setting('t.pq')::uuid), 0, 'no polls row is left');
select is((select count(*)::int from public.poll_options where poll_id = current_setting('t.pq')::uuid), 0, 'no option is left');
select is((select count(*)::int from private.poll_votes where poll_id = current_setting('t.pq')::uuid), 0, 'no ballot is left');
select is(tests.snap(current_setting('t.pq')::uuid), '{}'::jsonb, 'no weight row is left');

-- delete_channel with a poll inside succeeds
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.p3', tests.poll(current_setting('t.ch3'), 'En borrar', '{Sí,No}', 'equal')::text, true);
select tests.clear_authentication();
insert into private.poll_votes (poll_id, member_id, option_id)
  select current_setting('t.p3')::uuid, current_setting('t.b')::uuid, o.id
  from public.poll_options o where o.poll_id = current_setting('t.p3')::uuid and o.position = 1;
select tests.authenticate_as(current_setting('t.us')::uuid);
select lives_ok(format($$select public.delete_channel(%L)$$, current_setting('t.ch3')), 'delete_channel with a poll inside succeeds');
select tests.clear_authentication();
select is((select count(*)::int from public.polls where message_id = current_setting('t.p3')::uuid)
          + (select count(*)::int from public.poll_options where poll_id = current_setting('t.p3')::uuid)
          + (select count(*)::int from private.poll_votes where poll_id = current_setting('t.p3')::uuid), 0,
  'the poll, its options and its ballots went with the channel');

select * from finish();
rollback;
