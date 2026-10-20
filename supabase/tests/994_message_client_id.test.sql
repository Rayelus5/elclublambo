-- Ronda 1 T-004 (migration 20261020100001): idempotent post_message through a client key (R1-3).
--   messages.client_id (nullable) + unique (author_id, client_id) where client_id is not null.
--   post_message(..., p_client_id uuid default null): a key already used by the same author returns that message's id
--   before the rate limit, the slowmode check and any side effect; one signature only, same grants.
begin;
set local client_min_messages = warning;
select plan(22);

-- ===== helpers (rolled back with the test) =====
create function tests.login(p_member text) returns void language plpgsql as $$
begin
  perform tests.clear_authentication();
  perform tests.authenticate_as((select m.auth_user_id from public.members m where m.id = p_member::uuid));
end;
$$;
create function tests.doc(p_text text) returns jsonb language sql immutable as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
-- a doc that mentions a member (one mention notification)
create function tests.mdoc(p_member text) returns jsonb language sql immutable as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(
      jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('kind', 'member', 'id', p_member)),
      jsonb_build_object('type', 'text', 'text', ' hola')))))
$$;
create function tests.post(p_ch text, p_body jsonb, p_key text) returns uuid language sql as $$
  select public.post_message(p_ch::uuid, p_body, 'x', false, null, null, '[]'::jsonb, p_key::uuid)
$$;
create function tests.hits(p_subject text, p_bucket text) returns int language sql security definer set search_path = '' as $$
  select coalesce(sum(h.hits), 0)::int from private.rate_limit_hits h where h.subject = p_subject and h.bucket = p_bucket
$$;
create function tests.notes(p_msg text, p_member text) returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.notifications n where n.message_id = p_msg::uuid and n.recipient_id = p_member::uuid
$$;
create function tests.rows(p_ch text) returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.messages m where m.channel_id = p_ch::uuid
$$;

-- ===== fixtures =====
select set_config('t.s', tests.create_member('0x' || lpad('f9940', 40, '0'), null, true)::text, true);
select set_config('t.a', tests.create_member('0x' || lpad('f9941', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9942', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('f9943', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.cat', tests.create_channel(null, 'category', 'T994cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't994')::text, true);
select set_config('t.slow', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't994slow')::text, true);
update public.channels set slowmode_seconds = 60 where id = current_setting('t.slow')::uuid;
select set_config('t.k1', gen_random_uuid()::text, true);
select set_config('t.k2', gen_random_uuid()::text, true);
delete from private.rate_limit_hits;

-- ===== 1. schema and grants =====
select has_column('public', 'messages', 'client_id', 'messages.client_id exists');
select col_is_null('public', 'messages', 'client_id', 'client_id is nullable (system notices, bounties, polls)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'messages'
                  and indexdef ilike 'create unique index%(author_id, client_id)%where (client_id is not null)%'),
  'unique (author_id, client_id) where client_id is not null');
select is((select count(*)::int from pg_proc where proname = 'post_message' and pronamespace = 'public'::regnamespace), 1,
  'post_message has a single signature');
select ok(has_function_privilege('authenticated', 'public.post_message(uuid,jsonb,text,boolean,uuid,uuid,jsonb,uuid)', 'execute'),
  'authenticated can post_message');
select ok(not has_function_privilege('anon', 'public.post_message(uuid,jsonb,text,boolean,uuid,uuid,jsonb,uuid)', 'execute'),
  'anon cannot post_message');
select ok(not has_function_privilege('service_role', 'public.post_message(uuid,jsonb,text,boolean,uuid,uuid,jsonb,uuid)', 'execute'),
  'service_role cannot post_message (it uses post_message_as)');

-- ===== 2. same key twice: one message, one notification, one rate-limit hit =====
select tests.login(current_setting('t.a'));
select set_config('t.m1', tests.post(current_setting('t.ch'), tests.mdoc(current_setting('t.x')), current_setting('t.k1'))::text, true);
select set_config('t.m1b', tests.post(current_setting('t.ch'), tests.mdoc(current_setting('t.x')), current_setting('t.k1'))::text, true);
select is(current_setting('t.m1b'), current_setting('t.m1'), 'the same key returns the same message id');
select is(tests.rows(current_setting('t.ch')), 1, 'the same key writes one row');
select is((select client_id::text from public.messages where id = current_setting('t.m1')::uuid), current_setting('t.k1'),
  'the row carries its client_id');
select is(tests.notes(current_setting('t.m1'), current_setting('t.x')), 1, 'one notification for the mention');
select is(tests.hits(current_setting('t.a'), 'message_min'), 1, 'one rate-limit hit (the replay is not charged)');
select is(tests.hits(current_setting('t.a'), 'message_hour'), 1, 'one hourly rate-limit hit');

-- ===== 3. another author may use the same key =====
select tests.login(current_setting('t.b'));
select set_config('t.m2', tests.post(current_setting('t.ch'), tests.doc('otra'), current_setting('t.k1'))::text, true);
select isnt(current_setting('t.m2'), current_setting('t.m1'), 'another author with the same key gets their own message');
select is(tests.rows(current_setting('t.ch')), 2, 'two rows');

-- ===== 4. without a key: as before =====
select lives_ok($$select public.post_message(current_setting('t.ch')::uuid, tests.doc('sin clave'), 'x', false, null, null, '[]'::jsonb)$$,
  'the 7-argument call still works (p_client_id defaults to null)');
select lives_ok($$select public.post_message(current_setting('t.ch')::uuid, tests.doc('sin clave'), 'x', false, null, null, '[]'::jsonb)$$,
  'and posts again');
select is(tests.rows(current_setting('t.ch')), 4, 'no key: every call is a new message');
select is((select count(*)::int from public.messages where channel_id = current_setting('t.ch')::uuid and client_id is null), 2,
  'no key: client_id stays null');

-- ===== 5. a retry inside the slowmode window returns the message instead of «slowmode» =====
select tests.login(current_setting('t.a'));
select set_config('t.s1', tests.post(current_setting('t.slow'), tests.doc('lento'), current_setting('t.k2'))::text, true);
select is(tests.post(current_setting('t.slow'), tests.doc('lento'), current_setting('t.k2'))::text, current_setting('t.s1'),
  'retrying the same key inside the slowmode window returns the existing id');
select throws_ok($$select tests.post(current_setting('t.slow'), tests.doc('otro'), gen_random_uuid()::text)$$,
  'P0001', 'slowmode', 'a new key inside the window is still refused');
select is(tests.rows(current_setting('t.slow')), 1, 'slowmode channel: one row');

select * from finish();
rollback;
