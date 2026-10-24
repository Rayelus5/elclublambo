-- P1 Task 1 (migration 20261024200001): polls are one member = one vote.
--   - create_poll takes four arguments, needs no active chain, stores weight_mode 'equal' and chain_id null, and
--     writes no weight snapshot.
--   - The five-argument function is gone; polls.chain_id admits null and has no Linea check left.
--   - Two ballots from different members weigh 1 each in _poll_tally.
begin;
select plan(9);

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.cfg(p_key text) returns text language sql as $$ select current_setting(p_key) $$;
-- option id by position; definer so it also works inside a member session
create function tests.opt(p_poll text, p_pos int) returns uuid language sql security definer set search_path = '' as $$
  select o.id from public.poll_options o where o.poll_id = p_poll::uuid and o.position = p_pos
$$;
create function tests.vote_as(p_member text, p_poll text, p_pos int) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as((select m.auth_user_id from public.members m where m.id = p_member::uuid));
  v := public.cast_poll_vote(p_poll::uuid, tests.opt(p_poll, p_pos));
  perform tests.clear_authentication();
  return v;
end;
$$;

-- ===== fixtures: SuperAdmin S, author A (Verificado, holds CREATE_POLLS), voters B and C =====
select set_config('t.s', tests.create_member('0x' || lpad('d9a10', 40, '0'), null, true)::text, true);
select set_config('t.a', tests.create_member('0x' || lpad('d9a11', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('d9a12', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('d9a13', 40, '0'), current_setting('t.s')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.s')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where system_key = 'verified';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);

select set_config('t.cat', tests.create_channel(null, 'category', 'Tp101cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'tp101')::text, true);

-- no active chain at all: a poll must not need one
update public.app_config set value = 'null'::jsonb where key = 'active_chain_id';

-- ===== 1. signatures =====
select hasnt_function('public', 'create_poll', array['uuid', 'text', 'text[]', 'timestamptz', 'text'],
  'the five-argument create_poll is gone');
select ok(has_function_privilege('authenticated', 'public.create_poll(uuid,text,text[],timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.create_poll(uuid,text,text[],timestamptz)', 'execute'),
  'create_poll(uuid, text, text[], timestamptz): authenticated yes, anon no');

-- ===== 2. schema =====
select ok((select not a.attnotnull from pg_attribute a where a.attrelid = 'public.polls'::regclass and a.attname = 'chain_id')
      and not exists (select 1 from pg_constraint c where c.conrelid = 'public.polls'::regclass
                      and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%59144%'),
  'polls.chain_id admits null and the Linea check is gone');

-- ===== 3. create without a chain =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok($$select set_config('t.p', public.create_poll(tests.cfg('t.ch')::uuid, '¿Pizza o sushi?',
                    '{Pizza,Sushi}', now() + interval '1 day')::text, true)$$,
  'a member with CREATE_POLLS creates a poll with active_chain_id = null');
select tests.clear_authentication();
select is((select weight_mode || '/' || (chain_id is null)::text from public.polls where message_id = current_setting('t.p')::uuid),
  'equal/true', 'the row is equal and has no chain');
select is((select count(*)::int from private.poll_weight_snapshots where poll_id = current_setting('t.p')::uuid), 0,
  'no weight snapshot is written');

-- ===== 4. one member = one vote =====
select tests.vote_as(current_setting('t.b'), current_setting('t.p'), 1);
select tests.vote_as(current_setting('t.c'), current_setting('t.p'), 1);
select is((public._poll_tally(current_setting('t.p')::uuid)) - 'results',
  '{"voterCount": 2, "weightedVoterCount": 2, "status": "insufficient"}'::jsonb,
  'two ballots from two members count 1 each');
select tests.vote_as(current_setting('t.s'), current_setting('t.p'), 2);
select is((public._poll_tally(current_setting('t.p')::uuid)) #> '{results}',
  jsonb_build_array(jsonb_build_object('optionId', tests.opt(current_setting('t.p'), 1), 'tenths', 667),
                    jsonb_build_object('optionId', tests.opt(current_setting('t.p'), 2), 'tenths', 333)),
  'three ballots: 2 vs 1 published as 66.7 % / 33.3 %, no weights involved');

select * from finish();
rollback;
