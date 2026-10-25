-- F4e Task 3 (migration 20261019500003): secret votes changeable until the close, results only at the close with a
-- voter floor, sealed ballots and voter notices.
--   cast_poll_vote: VIEW + active member at vote time; cast / changed / same; only a new voter broadcasts poll_changed.
--   poll_details: open -> only the voter count and the caller's own vote; closed -> % per option (or insufficient),
--                 (F4e-R3: equal >= 3 voters at 0.1 %; weighted >= 5 weighted voters at whole %),
--                 never anyone's option; finalized -> the stored results, identical to the read-time tally.
--   close_due_polls: freezes the tallies, notifies still-active voters, seals the ballots, drops the snapshot.
--   _push_build: poll_closed -> Encuesta cerrada, deep link, the question as the excerpt; dropped without VIEW.
--   Carry (F4e-R1 and the Task 2 review): create_poll's explicit whitespace set, the 131075 check, and the moderator
--   hard-delete audit row without vote data.
-- Setup: 59141 active; voters V1-V5, treasurer T (256), SuperAdmin S, author A (Verificado), banned Z.
begin;
select plan(107);

-- ===== helpers (rolled back with the test) =====
create function tests.cfg(p_key text) returns text language sql as $$ select current_setting(p_key) $$;
create function tests.login(p_member text) returns void language plpgsql as $$
begin
  perform tests.clear_authentication();
  perform tests.authenticate_as((select m.auth_user_id from public.members m where m.id = p_member::uuid));
end;
$$;
-- P1 Task 1: create_poll no longer takes a weight mode. The weighted rows these cases read (what F4e left behind)
-- are seeded by hand: an equal poll turned linear / quadratic with the old creation snapshot (definer, session-proof).
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
create function tests.poll(p_question text, p_options text[], p_mode text default 'equal', p_ch text default null)
returns text language plpgsql as $$
declare v uuid;
begin
  perform tests.login(current_setting('t.a'));
  v := public.create_poll(coalesce(p_ch, current_setting('t.ch'))::uuid, p_question, p_options,
                          now() + interval '1 day');
  perform tests.clear_authentication();
  if p_mode in ('linear', 'quadratic') then perform tests.legacy_weights(v, p_mode); end if;
  return v::text;
end;
$$;
-- option id by position; definer so it also works inside a member session (poll_options has no client policy)
create function tests.opt(p_poll text, p_pos int) returns uuid language sql security definer set search_path = '' as $$
  select o.id from public.poll_options o where o.poll_id = p_poll::uuid and o.position = p_pos
$$;
create function tests.vote(p_poll text, p_pos int) returns jsonb language sql as $$
  select public.cast_poll_vote(p_poll::uuid, tests.opt(p_poll, p_pos))
$$;
create function tests.vote_as(p_member text, p_poll text, p_pos int) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.login(p_member);
  v := tests.vote(p_poll, p_pos);
  perform tests.clear_authentication();
  return v;
end;
$$;
-- poll_details of one poll for the current session, as one jsonb object (null when no row)
create function tests.det(p_poll text) returns jsonb language sql as $$
  select to_jsonb(d) from public.poll_details(array[p_poll::uuid]) d
$$;
create function tests.det_as(p_member text, p_poll text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.login(p_member);
  v := tests.det(p_poll);
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.res(p_poll text, p_tenths int[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('optionId', tests.opt(p_poll, t.ord::int), 'tenths', t.v) order by t.ord)
  from unnest(p_tenths) with ordinality as t(v, ord)
$$;
-- security definer: the realtime.messages receive policy hides rows from a session without a joined topic
create function tests.ev(p_event text, p_id text) returns int language sql security definer set search_path = '' as $$
  select count(*)::int from realtime.messages m where m.event = p_event and m.payload->>'id' = p_id
$$;
create function tests.pos(p_member text, p_shares numeric) returns void language sql as $$
  insert into public.dao_positions (chain_id, member_id, shares, locked_shares) values (59141, p_member::uuid, p_shares, 0)
  on conflict (chain_id, member_id) do update set shares = excluded.shares, locked_shares = 0
$$;

-- ===== fixtures =====
select set_config('t.s', tests.create_member('0x' || lpad('f9720', 40, '0'), null, true)::text, true);
select set_config('t.a', tests.create_member('0x' || lpad('f9721', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.v1', tests.create_member('0x' || lpad('f9722', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.v2', tests.create_member('0x' || lpad('f9723', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.v3', tests.create_member('0x' || lpad('f9724', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.v4', tests.create_member('0x' || lpad('f9725', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.v5', tests.create_member('0x' || lpad('f9726', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9727', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.z', tests.create_member('0x' || lpad('f9728', 40, '0'), current_setting('t.s')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.s')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where system_key = 'verified';
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T972 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T972 tesorero';
update public.members set status = 'banned' where id = current_setting('t.z')::uuid;

select set_config('t.cat', tests.create_channel(null, 'category', 'T972cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't972')::text, true);
select set_config('t.ch2', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't972gate')::text, true);
select set_config('t.chv', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't972hidden')::text, true);
-- every member follows ch: the voters also hold the channel_message notice of the poll itself
update public.channels set default_follow = 'all' where id = current_setting('t.ch')::uuid;

update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
delete from public.dao_positions where chain_id = 59141;

-- ===== 1. grants =====
select ok(not has_function_privilege('anon', 'public.cast_poll_vote(uuid,uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.cast_poll_vote(uuid,uuid)', 'execute'),
  'cast_poll_vote: members yes, anon no');
select ok(not has_function_privilege('anon', 'public.poll_details(uuid[])', 'execute')
      and has_function_privilege('authenticated', 'public.poll_details(uuid[])', 'execute'),
  'poll_details: members yes, anon no');
select ok(has_function_privilege('service_role', 'public.close_due_polls()', 'execute')
      and not has_function_privilege('authenticated', 'public.close_due_polls()', 'execute')
      and not has_function_privilege('anon', 'public.close_due_polls()', 'execute'),
  'close_due_polls is service-only');
select ok(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where p.oid = 'public._poll_tally(uuid)'::regprocedure and a.grantee <> p.proowner
                        and a.privilege_type = 'EXECUTE'),
  '_poll_tally is executable by its owner only');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
           from pg_proc p
           where p.oid in ('public.cast_poll_vote(uuid,uuid)'::regprocedure, 'public.poll_details(uuid[])'::regprocedure,
                           'public.close_due_polls()'::regprocedure, 'public._poll_tally(uuid)'::regprocedure,
                           'public.create_poll(uuid,text,text[],timestamptz)'::regprocedure,
                           'public._push_build(bigint)'::regprocedure)),
  'the new and replaced functions are definer with an empty search_path');
select ok(not has_function_privilege('authenticated', 'public._push_build(bigint)', 'execute')
      and not has_function_privilege('service_role', 'public._push_build(bigint)', 'execute'),
  '_push_build is still internal');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace
                                                and p.oid not in ('private.rate_limit(text,text,int,interval)'::regprocedure,
                                                                  'private.chain_enabled(int)'::regprocedure,
                                                                  'private.giveaway_pick(bytea,bytea,int,int)'::regprocedure)),
  'schema private still holds no function but private.rate_limit, private.chain_enabled and private.giveaway_pick (F5 Task 2 / P0 Task 1 / P2 Task 5, executable by no API role: 990, 995, p2_03)');

-- ===== 2. carry: create_poll whitespace set (F4e-R1) and the VIEW-inclusive bit check =====
select tests.login(current_setting('t.a'));
select throws_ok($$select public.create_poll(tests.cfg('t.ch')::uuid, E'\u00a0\u00a0', '{Sí,No}', now() + interval '1 day')$$,
  'P0001', 'question_required', 'an NBSP-only question -> question_required');
select throws_ok($$select public.create_poll(tests.cfg('t.ch')::uuid, E'\ufeff \u202f\u2007', '{Sí,No}', now() + interval '1 day')$$,
  'P0001', 'question_required', 'a question of BOM, narrow NBSP and figure space only -> question_required');
select throws_ok($$select public.create_poll(tests.cfg('t.ch')::uuid, 'Q', array['Sí', E'Sí\ufeff'], now() + interval '1 day')$$,
  'P0001', 'poll_options_invalid', 'options differing only by a trailing BOM are duplicates');
select throws_ok($$select public.create_poll(tests.cfg('t.ch')::uuid, 'Q', array['a b', E'a\u3000\u00a0b'], now() + interval '1 day')$$,
  'P0001', 'poll_options_invalid', 'options differing only by an ideographic space + NBSP run are duplicates');
select tests.clear_authentication();
select set_config('t.pw', tests.poll(E'\ufeff¿Hoy\u00a0\u2028o\u205fmañana?\u202f', array[E'\u2007Hoy', E'Mañana\u3000\u1680']), true);
select is((select body_text from public.messages where id = current_setting('t.pw')::uuid), '¿Hoy o mañana?',
  'the question collapses and trims every space of the set');
select is((select array_agg(label order by position) from public.poll_options where poll_id = current_setting('t.pw')::uuid),
  array['Hoy', 'Mañana'], 'the options are trimmed with the same set');
-- A holds CREATE_POLLS and SEND_MESSAGES through Verificado but cannot see chv
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.chv')::uuid, 'member', current_setting('t.a')::uuid, 0, 1);
select tests.login(current_setting('t.a'));
select throws_ok($$select public.create_poll(tests.cfg('t.chv')::uuid, '  ', '{Sí,No}', now() + interval '1 day')$$,
  'P0001', 'forbidden', 'no VIEW on the channel -> forbidden before any validation');
select tests.clear_authentication();

-- ===== 3. vote and change =====
select set_config('t.pe', tests.poll('¿Pizza o sushi?', '{Pizza,Sushi,Ninguna}'), true);
select is(tests.ev('poll_changed', current_setting('t.pe')), 0, 'creating a poll sends no poll_changed');
select is(tests.vote_as(current_setting('t.v1'), current_setting('t.pe'), 2), '{"status": "cast", "voterCount": 1}'::jsonb,
  'V1 votes Sushi: cast, 1 voter');
select is(tests.vote_as(current_setting('t.v1'), current_setting('t.pe'), 2), '{"status": "same", "voterCount": 1}'::jsonb,
  'V1 votes Sushi again: same');
select is(tests.vote_as(current_setting('t.v1'), current_setting('t.pe'), 1), '{"status": "changed", "voterCount": 1}'::jsonb,
  'V1 switches to Pizza: changed, still 1 voter');
select is(tests.ev('poll_changed', current_setting('t.pe')), 1, 'one poll_changed in total: a change and a same send nothing');
select is((select payload - 'id' - 'channel_id' - 'thread_root_id' from realtime.messages
           where event = 'poll_changed' and payload->>'id' = current_setting('t.pe')),
  '{}'::jsonb, 'the poll_changed payload carries only id, channel_id and thread_root_id');
select is((select jsonb_build_object('ch', payload->>'channel_id', 'root', payload->'thread_root_id', 'topic', topic, 'private', private)
           from realtime.messages where event = 'poll_changed' and payload->>'id' = current_setting('t.pe')),
  jsonb_build_object('ch', current_setting('t.ch'), 'root', 'null'::jsonb, 'topic', 'channel:' || current_setting('t.ch'),
                     'private', true),
  'poll_changed goes privately to channel:<id> with a null thread root');
select is((select option_id from private.poll_votes where poll_id = current_setting('t.pe')::uuid
             and member_id = current_setting('t.v1')::uuid), tests.opt(current_setting('t.pe'), 1),
  'the ballot holds the latest choice');
select set_config('t.pl', tests.poll('Lineal', '{X,Y}', 'linear'), true);  -- nobody holds shares yet: empty snapshot
select tests.login(current_setting('t.v1'));
select throws_ok(format($$select public.cast_poll_vote(%L, tests.opt(%L, 1))$$, current_setting('t.pe'), current_setting('t.pl')),
  'P0001', 'invalid_input', 'an option of another poll -> invalid_input');
select throws_ok(format($$select public.cast_poll_vote(%L, null)$$, current_setting('t.pe')),
  'P0001', 'invalid_input', 'a null option -> invalid_input');
select throws_ok(format($$select public.cast_poll_vote(%L, tests.opt(%L, 1))$$, gen_random_uuid(), current_setting('t.pe')),
  'P0001', 'not_found', 'an unknown poll -> not_found');
select throws_ok($$select public.cast_poll_vote(null, null)$$, 'P0001', 'not_found', 'a null poll -> not_found');
select tests.clear_authentication();
select throws_ok(format($$select tests.vote(%L, 1)$$, current_setting('t.pe')), 'P0001', 'forbidden', 'no session -> forbidden');
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.ch')::uuid, 'member', current_setting('t.v5')::uuid, 0, 1);
select tests.login(current_setting('t.v5'));
select throws_ok(format($$select tests.vote(%L, 1)$$, current_setting('t.pe')), 'P0001', 'forbidden',
  'VIEW denied by an overwrite -> forbidden');
select tests.clear_authentication();
delete from public.permission_overwrites where channel_id = current_setting('t.ch')::uuid
  and target_id = current_setting('t.v5')::uuid;
select tests.login(current_setting('t.z'));
select throws_ok(format($$select tests.vote(%L, 1)$$, current_setting('t.pe')), 'P0001', 'forbidden', 'a banned member -> forbidden');
select tests.clear_authentication();
-- a view-gated channel: V5 has donated nothing, so it cannot see ch2 while the gate is on
select set_config('t.pg', tests.poll('Con puerta', '{Sí,No}', 'equal', current_setting('t.ch2')), true);
update public.channels set gate_min_donated_usd6 = 100, gate_scope = 'view' where id = current_setting('t.ch2')::uuid;
select tests.login(current_setting('t.v5'));
select throws_ok(format($$select tests.vote(%L, 1)$$, current_setting('t.pg')), 'P0001', 'forbidden',
  'a view gate the member fails -> forbidden');
select tests.clear_authentication();
update public.channels set gate_min_donated_usd6 = null, gate_scope = 'post' where id = current_setting('t.ch2')::uuid;
select is(tests.vote_as(current_setting('t.v5'), current_setting('t.pg'), 1) ->> 'status', 'cast', 'with the gate off V5 votes');
select is((select count(*)::int from private.poll_votes where poll_id = current_setting('t.pe')::uuid), 1,
  'no refused call left a ballot');

-- ===== 4. open reads (Review Focus 1) =====
select is(tests.vote_as(current_setting('t.v2'), current_setting('t.pe'), 2), '{"status": "cast", "voterCount": 2}'::jsonb, 'V2 votes Sushi');
select is(tests.vote_as(current_setting('t.v3'), current_setting('t.pe'), 1), '{"status": "cast", "voterCount": 3}'::jsonb, 'V3 votes Pizza');
select is(tests.ev('poll_changed', current_setting('t.pe')), 3, 'each new voter sent one poll_changed');
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pe')),
  jsonb_build_object('message_id', current_setting('t.pe'), 'weight_mode', 'equal',
                     'closes_at', (select closes_at from public.polls where message_id = current_setting('t.pe')::uuid),
                     'closed', false, 'voter_count', 3,
                     'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'position', o.position)
                                                  order by o.position)
                                 from public.poll_options o where o.poll_id = current_setting('t.pe')::uuid),
                     'my_option_id', tests.opt(current_setting('t.pe'), 1), 'i_voted', true, 'my_has_weight', null,
                     'results_status', 'pending', 'results', null),
  'V1 open read: 3 voters, its own Pizza, options, pending, no results');
select is(tests.det_as(current_setting('t.v2'), current_setting('t.pe')) ->> 'my_option_id',
  tests.opt(current_setting('t.pe'), 2)::text, 'V2 sees its own Sushi, not V1''s Pizza');
select is(tests.det_as(current_setting('t.t'), current_setting('t.pe')) - 'options' - 'closes_at' - 'message_id',
  '{"weight_mode": "equal", "closed": false, "voter_count": 3, "my_option_id": null, "i_voted": false, "my_has_weight": null, "results_status": "pending", "results": null}'::jsonb,
  'the treasurer sees only the count: no option, pending, no results');
select is(tests.det_as(current_setting('t.s'), current_setting('t.pe')) - 'options' - 'closes_at' - 'message_id',
  '{"weight_mode": "equal", "closed": false, "voter_count": 3, "my_option_id": null, "i_voted": false, "my_has_weight": null, "results_status": "pending", "results": null}'::jsonb,
  'the SuperAdmin sees only the count too');
select is(tests.det_as(current_setting('t.z'), current_setting('t.pe')), null, 'a banned member gets no row');
select is(tests.det_as(current_setting('t.a'), current_setting('t.chv')), null, 'a non-poll id gets no row');
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.ch')::uuid, 'member', current_setting('t.v4')::uuid, 0, 1);
select is(tests.det_as(current_setting('t.v4'), current_setting('t.pe')), null, 'a member without VIEW gets no row');
delete from public.permission_overwrites where channel_id = current_setting('t.ch')::uuid
  and target_id = current_setting('t.v4')::uuid;
select tests.clear_authentication();
select is(tests.det(current_setting('t.pe')), null, 'no session gets no row');
select is((select count(*)::int from public.audit_log
           where payload::text like '%' || tests.opt(current_setting('t.pe'), 1)::text || '%'
              or payload::text like '%' || tests.opt(current_setting('t.pe'), 2)::text || '%'
              or target_id = current_setting('t.pe')::uuid), 0, 'no audit row mentions the poll or a ballot');

-- ===== 5. weighted polls (ruling F4e-R3: >= 5 weighted voters, whole %) =====
-- linear: V1 6, V2 3, V3 1, V5 1, T 1 (x10^18), V4 0
select tests.pos(current_setting('t.v1'), 6000000000000000000);
select tests.pos(current_setting('t.v2'), 3000000000000000000);
select tests.pos(current_setting('t.v3'), 1000000000000000000);
select tests.pos(current_setting('t.v5'), 1000000000000000000);
select tests.pos(current_setting('t.t'), 1000000000000000000);
select tests.pos(current_setting('t.v4'), 0);
select set_config('t.pl', tests.poll('Lineal 2', '{X,Y}', 'linear'), true);
select tests.vote_as(current_setting('t.v1'), current_setting('t.pl'), 1);
select tests.vote_as(current_setting('t.t'), current_setting('t.pl'), 1);
select tests.vote_as(current_setting('t.v2'), current_setting('t.pl'), 2);
select tests.vote_as(current_setting('t.v3'), current_setting('t.pl'), 2);
select tests.vote_as(current_setting('t.v5'), current_setting('t.pl'), 2);
select is(tests.vote_as(current_setting('t.v4'), current_setting('t.pl'), 2), '{"status": "cast", "voterCount": 6}'::jsonb,
  'V4 (no weight) still votes');
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pl')) ->> 'my_has_weight', 'true', 'V1 sees it has weight');
select is(tests.det_as(current_setting('t.v4'), current_setting('t.pl')) ->> 'my_has_weight', 'false', 'V4 sees it has none');
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pl')) -> 'results', 'null'::jsonb, 'no results while open');
-- quadratic: V1 9, V2 4, V3 1, V5 1, T 1 (x10^18) -> 3, 2, 1, 1, 1 (x10^9)
select tests.pos(current_setting('t.v1'), 9000000000000000000);
select tests.pos(current_setting('t.v2'), 4000000000000000000);
select set_config('t.pq', tests.poll('Cuadrática', '{X,Y}', 'quadratic'), true);
select is((select jsonb_object_agg(s.member_id::text, s.weight::text) from private.poll_weight_snapshots s
           where s.poll_id = current_setting('t.pq')::uuid),
  jsonb_build_object(current_setting('t.v1'), '3000000000', current_setting('t.v2'), '2000000000',
                     current_setting('t.v3'), '1000000000', current_setting('t.v5'), '1000000000',
                     current_setting('t.t'), '1000000000'), 'quadratic snapshot 3, 2, 1, 1, 1 x10^9');
select tests.vote_as(current_setting('t.v1'), current_setting('t.pq'), 1);
select tests.vote_as(current_setting('t.v2'), current_setting('t.pq'), 2);
select tests.vote_as(current_setting('t.v3'), current_setting('t.pq'), 2);
select tests.vote_as(current_setting('t.v5'), current_setting('t.pq'), 2);
select tests.vote_as(current_setting('t.t'), current_setting('t.pq'), 2);
-- weighted polls with 3 and with 4 weighted voters (the second has 5 voters in all): below the R3 floor
select set_config('t.pk3', tests.poll('Tres con peso', '{X,Y}', 'linear'), true);
select tests.vote_as(current_setting('t.v1'), current_setting('t.pk3'), 1);
select tests.vote_as(current_setting('t.v2'), current_setting('t.pk3'), 2);
select tests.vote_as(current_setting('t.v3'), current_setting('t.pk3'), 2);
select set_config('t.pk4', tests.poll('Cuatro con peso', '{X,Y}', 'quadratic'), true);
select tests.vote_as(current_setting('t.v1'), current_setting('t.pk4'), 1);
select tests.vote_as(current_setting('t.v2'), current_setting('t.pk4'), 2);
select tests.vote_as(current_setting('t.v3'), current_setting('t.pk4'), 2);
select tests.vote_as(current_setting('t.v5'), current_setting('t.pk4'), 2);
select tests.vote_as(current_setting('t.v4'), current_setting('t.pk4'), 2);
-- insufficient: 2 voters (equal); 4 voters of whom only some weigh; nobody weighs
select set_config('t.pi1', tests.poll('Dos votos', '{Sí,No}'), true);
select tests.vote_as(current_setting('t.v1'), current_setting('t.pi1'), 1);
select tests.vote_as(current_setting('t.v2'), current_setting('t.pi1'), 2);
select tests.pos(current_setting('t.v3'), 0);
select set_config('t.pi2', tests.poll('Dos con peso', '{Sí,No}', 'linear'), true);
select tests.vote_as(current_setting('t.v1'), current_setting('t.pi2'), 1);
select tests.vote_as(current_setting('t.v2'), current_setting('t.pi2'), 2);
select tests.vote_as(current_setting('t.v3'), current_setting('t.pi2'), 2);
select tests.vote_as(current_setting('t.v4'), current_setting('t.pi2'), 2);
delete from public.dao_positions where chain_id = 59141;
select set_config('t.pi3', tests.poll('Nadie pesa', '{Sí,No}', 'quadratic'), true);
select tests.vote_as(current_setting('t.v1'), current_setting('t.pi3'), 1);
select tests.vote_as(current_setting('t.v2'), current_setting('t.pi3'), 1);
select tests.vote_as(current_setting('t.v3'), current_setting('t.pi3'), 2);
-- a later donation never changes a snapshot
select tests.pos(current_setting('t.v4'), 9000000000000000000);
-- the eight polls closed below, in a fixed order
create function tests.ids() returns text[] language sql as $$
  select array[current_setting('t.pe'), current_setting('t.pl'), current_setting('t.pq'), current_setting('t.pk3'),
               current_setting('t.pk4'), current_setting('t.pi1'), current_setting('t.pi2'), current_setting('t.pi3')]
$$;

-- ===== 6. closed before finalize (Review Focus 2) =====
-- the close is judged on the wall clock (M1): 1 ms after the transaction started, now() is still before closes_at
update public.polls set closes_at = now() + interval '1 millisecond' where message_id = current_setting('t.pi1')::uuid;
select pg_sleep(0.01);
select tests.login(current_setting('t.v3'));
select throws_ok(format($$select tests.vote(%L, 1)$$, current_setting('t.pi1')), 'P0001', 'poll_closed',
  'a close that passed during the transaction -> poll_closed (clock_timestamp, not now())');
select tests.clear_authentication();
-- exactly at closes_at the poll is closed
update public.polls set closes_at = now() where message_id = current_setting('t.pi1')::uuid;
select tests.login(current_setting('t.v3'));
select throws_ok(format($$select tests.vote(%L, 1)$$, current_setting('t.pi1')), 'P0001', 'poll_closed',
  'voting at closes_at -> poll_closed');
select tests.clear_authentication();
update public.polls set closes_at = now() - interval '1 minute'
  where message_id::text = any (tests.ids()) and message_id <> current_setting('t.pi1')::uuid;
select tests.login(current_setting('t.v4'));
select throws_ok(format($$select tests.vote(%L, 1)$$, current_setting('t.pe')), 'P0001', 'poll_closed',
  'a new vote after the close -> poll_closed');
select tests.clear_authentication();
select tests.login(current_setting('t.v1'));
select throws_ok(format($$select tests.vote(%L, 2)$$, current_setting('t.pe')), 'P0001', 'poll_closed',
  'a change after the close -> poll_closed');
select throws_ok(format($$select tests.vote(%L, 1)$$, current_setting('t.pe')), 'P0001', 'poll_closed',
  'even the same option after the close -> poll_closed');
select tests.clear_authentication();
select is(tests.ev('poll_changed', current_setting('t.pe')), 3, 'refused votes send nothing');
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pe')) - 'options' - 'closes_at' - 'message_id',
  jsonb_build_object('weight_mode', 'equal', 'closed', true, 'voter_count', 3, 'my_option_id', null, 'i_voted', true,
                     'my_has_weight', null, 'results_status', 'published',
                     'results', tests.res(current_setting('t.pe'), array[667, 333, 0])),
  'closed equal poll: no own option any more, "voted", 2 Pizza 1 Sushi -> 66.7 / 33.3 / 0');
select is(tests.det_as(current_setting('t.v4'), current_setting('t.pe')) ->> 'i_voted', 'false', 'V4 did not vote');
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pl')) - 'options' - 'closes_at' - 'message_id',
  jsonb_build_object('weight_mode', 'linear', 'closed', true, 'voter_count', 6, 'my_option_id', null, 'i_voted', true,
                     'my_has_weight', null, 'results_status', 'published',
                     'results', tests.res(current_setting('t.pl'), array[580, 420])),
  'closed linear poll: 6 + 1 vs 3 + 1 + 1 + 0 -> 58 % / 42 % in whole percent (not 58.3 / 41.7), 6 voters');
select is(public._poll_tally(current_setting('t.pl')::uuid),
  jsonb_build_object('voterCount', 6, 'weightedVoterCount', 5, 'status', 'published',
                     'results', tests.res(current_setting('t.pl'), array[580, 420])),
  '_poll_tally linear: 6 voters, 5 with weight, published');
select is(tests.det_as(current_setting('t.v2'), current_setting('t.pq')) -> 'results',
  tests.res(current_setting('t.pq'), array[380, 630]),
  'closed quadratic poll: 3 vs 2 + 1 + 1 + 1 -> 37.5 % / 62.5 % rounded half-up to 38 % / 63 %');
select is(public._poll_tally(current_setting('t.pk3')::uuid),
  '{"voterCount": 3, "weightedVoterCount": 3, "status": "insufficient", "results": null}'::jsonb,
  'a weighted poll with 3 weighted voters -> insufficient');
select is(public._poll_tally(current_setting('t.pk4')::uuid),
  '{"voterCount": 5, "weightedVoterCount": 4, "status": "insufficient", "results": null}'::jsonb,
  'a weighted poll with 5 voters but 4 weighted -> insufficient');
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pk4')) - 'options' - 'closes_at' - 'message_id',
  jsonb_build_object('weight_mode', 'quadratic', 'closed', true, 'voter_count', 5, 'my_option_id', null, 'i_voted', true,
                     'my_has_weight', null, 'results_status', 'insufficient', 'results', null),
  'and poll_details shows only the voter count');
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pi1')) - 'options' - 'closes_at' - 'message_id',
  jsonb_build_object('weight_mode', 'equal', 'closed', true, 'voter_count', 2, 'my_option_id', null, 'i_voted', true,
                     'my_has_weight', null, 'results_status', 'insufficient', 'results', null),
  'two voters -> insufficient, no results');
select is(public._poll_tally(current_setting('t.pi2')::uuid),
  '{"voterCount": 4, "weightedVoterCount": 2, "status": "insufficient", "results": null}'::jsonb,
  'four voters, only two with weight -> insufficient');
select is(tests.det_as(current_setting('t.v4'), current_setting('t.pi2')) ->> 'results_status', 'insufficient',
  'and poll_details says insufficient');
select is(public._poll_tally(current_setting('t.pi3')::uuid),
  '{"voterCount": 3, "weightedVoterCount": 0, "status": "insufficient", "results": null}'::jsonb,
  'three voters, nobody with weight -> insufficient');
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pi3')) -> 'results', 'null'::jsonb, 'no results there either');
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pw')) ->> 'results_status', 'pending',
  'a poll still open stays pending');

-- ===== 7. finalize =====
-- a voter banned before finalize: no notice, but the ballot still counts
update public.members set status = 'banned' where id = current_setting('t.v3')::uuid;
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pe')) -> 'results',
  tests.res(current_setting('t.pe'), array[667, 333, 0]), 'a ban does not move the closed results');
select set_config('t.before', (select jsonb_object_agg(x.id, tests.det_as(current_setting('t.v1'), x.id) - 'closed')::text
                               from unnest(tests.ids()) x(id)), true);
select set_config('t.due', (select count(*)::text from public.polls where closes_at <= now() and finalized_at is null), true);
select is(current_setting('t.due')::int >= 8, true, 'at least the eight closed polls are due');
select is((select count(*)::int from public.notifications where kind = 'channel_message'
             and message_id = current_setting('t.pe')::uuid and recipient_id = current_setting('t.v1')::uuid), 1,
  'V1 holds the channel_message notice of the poll message');
set local role service_role;
select is(public.close_due_polls(), jsonb_build_object('finalized', current_setting('t.due')::int),
  'close_due_polls finalizes every due poll');
reset role;
select is((select count(*)::int from public.polls
           where message_id::text = any (tests.ids()) and finalized_at = now()), 8, 'the eight polls are finalized now');
select is((select finalized_at from public.polls where message_id = current_setting('t.pw')::uuid), null,
  'an open poll is left alone');
select is((select jsonb_agg(jsonb_build_object('vc', voter_count, 'wvc', weighted_voter_count, 'pub', results_published)
                            order by array_position(tests.ids(), message_id::text))
           from public.polls
           where message_id::text = any (tests.ids())),
  '[{"vc": 3, "wvc": 3, "pub": true}, {"vc": 6, "wvc": 5, "pub": true}, {"vc": 5, "wvc": 5, "pub": true},
    {"vc": 3, "wvc": 3, "pub": false}, {"vc": 5, "wvc": 4, "pub": false},
    {"vc": 2, "wvc": 2, "pub": false}, {"vc": 4, "wvc": 2, "pub": false}, {"vc": 3, "wvc": 0, "pub": false}]'::jsonb,
  'the stored counts and the published flags');
select is((select array_agg(result_tenths order by position) from public.poll_options where poll_id = current_setting('t.pe')::uuid),
  array[667, 333, 0], 'equal: tenths stored (0.1 % precision)');
select is((select array_agg(result_tenths order by position) from public.poll_options where poll_id = current_setting('t.pl')::uuid),
  array[580, 420], 'linear: whole percent stored as tenths');
select is((select array_agg(result_tenths order by position) from public.poll_options where poll_id = current_setting('t.pq')::uuid),
  array[380, 630], 'quadratic: whole percent stored as tenths');
select is((select count(*)::int from public.poll_options
           where poll_id::text in (current_setting('t.pk3'), current_setting('t.pk4'), current_setting('t.pi1'),
                                   current_setting('t.pi2'), current_setting('t.pi3'))
             and result_tenths is not null), 0, 'insufficient polls store no tenths at all');
select is((select count(*)::int from private.poll_votes
           where poll_id::text = any (tests.ids()) and option_id is not null), 0, 'every ballot is sealed (option_id null)');
select is((select count(*)::int from private.poll_votes where poll_id::text = any (tests.ids())), 31,
  'the ballots themselves remain (who voted, not what)');
select is((select count(*)::int from private.poll_weight_snapshots where poll_id::text = any (tests.ids())), 0,
  'the weight snapshots are gone');
select is((select jsonb_object_agg(x.id, tests.det_as(current_setting('t.v1'), x.id) - 'closed')
           from unnest(tests.ids()) x(id)),
  current_setting('t.before')::jsonb, 'poll_details returns exactly what it returned before finalizing');
select is(tests.det_as(current_setting('t.v1'), current_setting('t.pe')) ->> 'closed', 'true', 'a finalized poll reads closed');
select is(tests.det_as(current_setting('t.t'), current_setting('t.pe')) - 'options' - 'closes_at' - 'message_id',
  jsonb_build_object('weight_mode', 'equal', 'closed', true, 'voter_count', 3, 'my_option_id', null, 'i_voted', false,
                     'my_has_weight', null, 'results_status', 'published',
                     'results', tests.res(current_setting('t.pe'), array[667, 333, 0])),
  'a non-voter sees the same results and "not voted"');
-- notices
select is((select jsonb_agg(jsonb_build_object('r', recipient_id, 'actor', actor_id, 'ch', channel_id, 'data', data)
                            order by recipient_id)
           from public.notifications where kind = 'poll_closed' and message_id = current_setting('t.pe')::uuid),
  (select jsonb_agg(jsonb_build_object('r', x.r, 'actor', null, 'ch', current_setting('t.ch')::uuid, 'data', '{}'::jsonb)
                    order by x.r)
   from unnest(array[current_setting('t.v1')::uuid, current_setting('t.v2')::uuid]) x(r)),
  'pe: one poll_closed each to V1 and V2, no actor, the channel, empty data; none to the banned V3');
select is((select count(*)::int from public.notifications
           where message_id = current_setting('t.pe')::uuid and recipient_id = current_setting('t.v1')::uuid), 1,
  'the poll_closed notice supersedes V1''s channel_message notice of the same message');
select is((select count(*)::int from public.notifications where kind = 'poll_closed'
             and recipient_id = current_setting('t.a')::uuid), 0, 'the non-voting author gets no notice');
select is((select count(*)::int from public.notifications where kind = 'poll_closed'
             and message_id::text = any (tests.ids()) and message_id <> current_setting('t.pe')::uuid),
  5 + 4 + 2 + 4 + 2 + 3 + 2, 'every still-active voter of every poll gets one notice (V3 banned)');
select is((select count(*)::int from public.notifications where kind = 'poll_closed'
             and recipient_id = current_setting('t.v3')::uuid), 0, 'the banned V3 gets none anywhere');
select is(tests.ev('poll_changed', current_setting('t.pe')), 4, 'finalizing sends one poll_changed');
select is(tests.ev('poll_changed', current_setting('t.pi3')), 4, 'also for an insufficient poll (3 voters + finalize)');
select is((select count(*)::int from public.audit_log where target_id::text = any (tests.ids())),
  0, 'finalizing writes no audit row');
set local role service_role;
select is(public.close_due_polls(), '{"finalized": 0}'::jsonb, 'a second run finalizes nothing');
reset role;
select is((select count(*)::int from public.notifications where kind = 'poll_closed' and message_id::text = any (tests.ids())),
  2 + 22, 'and sends no second notice');
select tests.login(current_setting('t.v1'));
select throws_ok(format($$select tests.vote(%L, 1)$$, current_setting('t.pe')), 'P0001', 'poll_closed',
  'a finalized poll refuses votes');
select tests.clear_authentication();
-- finalized_at alone closes a poll even if closes_at were in the future
update public.polls set closes_at = now() + interval '1 day' where message_id = current_setting('t.pe')::uuid;
select tests.login(current_setting('t.v4'));
select throws_ok(format($$select tests.vote(%L, 1)$$, current_setting('t.pe')), 'P0001', 'poll_closed',
  'finalized_at set -> poll_closed');
select tests.clear_authentication();

-- ===== 8. push =====
select set_config('t.n1', (select id::text from public.notifications where kind = 'poll_closed'
                             and message_id = current_setting('t.pe')::uuid and recipient_id = current_setting('t.v1')::uuid), true);
select set_config('t.n2', (select id::text from public.notifications where kind = 'poll_closed'
                             and message_id = current_setting('t.pe')::uuid and recipient_id = current_setting('t.v2')::uuid), true);
select is((select jsonb_build_object('title', title, 'body', body, 'url', url, 'tag', tag)
           from public._push_build(current_setting('t.n1')::bigint)),
  jsonb_build_object('title', 'Encuesta cerrada',
                     -- copy as of 20261019500004 (ruling F4e-R5)
                     'body', 'Se ha cerrado la encuesta en la que votaste en #t972: «¿Pizza o sushi?»',
                     'url', '/c/' || current_setting('t.ch') || '?m=' || current_setting('t.pe') || '&h=n' || current_setting('t.n1'),
                     'tag', 'poll_closed:' || current_setting('t.pe')),
  'poll_closed push: title, phrase with the question, deep link to the message');
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.ch')::uuid, 'member', current_setting('t.v2')::uuid, 0, 1);
select is((select count(*)::int from public._push_build(current_setting('t.n2')::bigint)), 0,
  'a recipient who lost VIEW gets no push');
select tests.login(current_setting('t.v2'));
select is((select count(*)::int from public.notifications where kind = 'poll_closed'), 0,
  'nor sees the notice in the app (RLS)');
select tests.clear_authentication();
select is((select count(*)::int from public._push_build(current_setting('t.n1')::bigint)), 1, 'V1 still gets its push');
-- a poll_closed row without a channel cannot exist; _push_build would drop it anyway
select throws_ok(format($$update public.notifications set channel_id = null where id = %s$$, current_setting('t.n1')),
  '23514', null, 'a poll notice always carries its channel');

-- ===== 9. carry: a moderator hard-deletes a poll with ballots; the audit row holds no vote data =====
select tests.pos(current_setting('t.v1'), 4000000000000000000);
select set_config('t.pd', tests.poll('Para borrar', '{Sí,No}', 'linear'), true);
select tests.vote_as(current_setting('t.v1'), current_setting('t.pd'), 2);
select set_config('t.pd_opt', tests.opt(current_setting('t.pd'), 2)::text, true);
select tests.login(current_setting('t.s'));
select is(public.delete_message(current_setting('t.pd')::uuid) ->> 'hard', 'true', 'the SuperAdmin hard-deletes A''s poll');
select tests.clear_authentication();
select is((select jsonb_agg(jsonb_build_object('action', action, 'payload', payload))
           from public.audit_log where target_id = current_setting('t.pd')::uuid),
  jsonb_build_array(jsonb_build_object('action', 'message_deleted',
                                       'payload', jsonb_build_object('channel_id', current_setting('t.ch')::uuid,
                                                                     'author_id', current_setting('t.a')::uuid))),
  'one message_deleted audit row, holding only the channel and the author');
select is((select count(*)::int from public.audit_log
           where payload::text like '%' || current_setting('t.pd_opt') || '%'
              or payload::text like '%' || current_setting('t.v1') || '%'), 0,
  'no audit row names the option or the voter');
select is((select count(*)::int from private.poll_votes where poll_id = current_setting('t.pd')::uuid)
          + (select count(*)::int from private.poll_weight_snapshots where poll_id = current_setting('t.pd')::uuid), 0,
  'the ballot and the snapshot went with it');

select * from finish();
rollback;
