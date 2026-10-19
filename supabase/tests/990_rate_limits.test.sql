-- F5 Task 2 (migration 20261019700101): Postgres rate limits (F5-R1, F5-R2, F5-R16).
--   private.rate_limit_hits / private.rate_limit: fixed-window counter keyed (subject, bucket, window_start); usable by
--     no API role; a raise rolls the hit back with the action, so in-RPC buckets limit successful actions.
--   Buckets charged inside the RPCs: message_min 30/1 min + message_hour 600/1 h (_post_message_core), reaction 60/1 min,
--     ticket 20/1 min, payment_intent 30/10 min, poll_vote 30/1 min, raffle_entry 30/10 min, invite_create 30/1 day,
--     withdrawal 20/1 day, profile 30/1 h, presence 120/1 min (touch_presence; leave_presence is free).
--   rate_limit_hit(bucket): the server-action pre-hit, own transaction: chain_verify 120/10 min, redeem_invite 10/1 h
--     (subject 'u:'||auth.uid() before membership).
--   upload_quota_ok(bucket): chat-images 60 / avatars 20 objects created by the member in the last hour.
--   touch_presence keeps at most 10 device rows per member (the 11th device evicts the oldest).
begin;
set local client_min_messages = warning;
select plan(55);

-- ===== helpers (rolled back with the test) =====
create function tests.login(p_member text) returns void language plpgsql as $$
begin
  perform tests.clear_authentication();
  perform tests.authenticate_as((select m.auth_user_id from public.members m where m.id = p_member::uuid));
end;
$$;
-- runs p_sql p_n times in the caller's session
create function tests.rep(p_sql text, p_n int) returns void language plpgsql as $$
begin
  for i in 1..p_n loop
    execute p_sql;
  end loop;
end;
$$;
create function tests.doc(p_text text) returns jsonb language sql immutable as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.post(p_ch text) returns uuid language sql as $$
  select public.post_message(p_ch::uuid, tests.doc('hola'), 'hola', false, null, null, '[]'::jsonb)
$$;
create function tests.hits(p_subject text, p_bucket text) returns int language sql security definer set search_path = '' as $$
  select coalesce(sum(h.hits), 0)::int from private.rate_limit_hits h where h.subject = p_subject and h.bucket = p_bucket
$$;
create function tests.win(p_window interval) returns timestamptz language sql stable as $$
  select date_bin(p_window, now(), timestamptz '2000-01-01Z')
$$;
-- n tip intents as p_member, expiring each one so the 20-pending cap never interferes
create function tests.tips(p_member text, p_to text, p_n int) returns void language plpgsql as $$
begin
  for i in 1..p_n loop
    perform tests.login(p_member);
    perform public.create_tip_intent('profile', p_to::uuid, 'USDC', 10000, 0, false);
    perform tests.clear_authentication();
    update public.payment_intents set status = 'expired' where member_id = p_member::uuid and status = 'pending';
  end loop;
end;
$$;
-- n request + cancel pairs (2n withdrawal hits)
create function tests.wd(p_n int) returns void language plpgsql as $$
declare v uuid;
begin
  for i in 1..p_n loop
    v := public.request_withdrawal(10000000000000000000);
    perform public.cancel_withdrawal(v);
  end loop;
end;
$$;
-- objects created by p_member in a bucket, p_age ago
create function tests.objs(p_bucket text, p_member text, p_n int, p_age interval default '0 seconds')
returns void language plpgsql security definer set search_path = '' as $$
begin
  for i in 1..p_n loop
    insert into storage.objects (bucket_id, name, metadata, created_at)
    values (p_bucket,
            case p_bucket when 'chat-images' then current_setting('t.ch') || '/' || p_member || '/' || gen_random_uuid() || '.png'
                          else p_member || '/' || gen_random_uuid() || '.png' end,
            jsonb_build_object('mimetype', 'image/png', 'size', 1234), now() - p_age);
  end loop;
end;
$$;

-- ===== fixtures =====
select set_config('t.s', tests.create_member('0x' || lpad('f9900', 40, '0'), null, true)::text, true);
select set_config('t.a', tests.create_member('0x' || lpad('f9901', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9902', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('f9903', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.p', tests.create_member('0x' || lpad('f9904', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.nu', tests.create_wallet_user('0x' || lpad('f9905', 40, '0'))::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.c')::uuid, id from public.roles where system_key = 'verified';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.b')::uuid, id from public.roles where name = 'Padrino';

select set_config('t.cat', tests.create_channel(null, 'category', 'T990cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't990')::text, true);
update public.channels set tickets_enabled = true where id = current_setting('t.ch')::uuid;
select set_config('t.alpha', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't990alpha')::text, true);
update public.channels set alpha_enabled = true where id = current_setting('t.alpha')::uuid;
insert into public.roles (name, color, position, permissions) values ('T990 links', '#AAAAAA', 61, 2048);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'T990 links';

update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';
update public.chain_config set withdrawals_enabled = true where chain_id = 59141;
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
delete from public.dao_positions where chain_id = 59141;
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 10000000,
                            nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc)
  values (59141, current_setting('t.a')::uuid, 10000000000000000000, 10000000);
insert into public.raffles (chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, closes_at, seed_commit, created_by)
  values (59141, 'T990 sorteo', 'USDC', 1000000, 1000000, 'equal', now() + interval '1 day', '0x' || lpad('99', 64, '0'),
          current_setting('t.s')::uuid);
select set_config('t.raffle', (select id::text from public.raffles where title = 'T990 sorteo'), true);
delete from private.rate_limit_hits;

-- ===== 1. grants =====
select ok(has_function_privilege('authenticated', 'public.rate_limit_hit(text)', 'execute')
          and not has_function_privilege('anon', 'public.rate_limit_hit(text)', 'execute'),
  'rate_limit_hit: authenticated yes, anon no');
select ok(not has_function_privilege('anon', 'private.rate_limit(text,text,int,interval)', 'execute')
          and not has_function_privilege('authenticated', 'private.rate_limit(text,text,int,interval)', 'execute')
          and not has_function_privilege('service_role', 'private.rate_limit(text,text,int,interval)', 'execute'),
  'private.rate_limit is executable by no API role');
select ok(has_function_privilege('authenticated', 'public.upload_quota_ok(text)', 'execute')
          and not has_function_privilege('anon', 'public.upload_quota_ok(text)', 'execute'),
  'upload_quota_ok: authenticated yes, anon no');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.rate_limit(text,text,int,interval)'::regprocedure, 'public.rate_limit_hit(text)'::regprocedure,
                           'public.upload_quota_ok(text)'::regprocedure)),
  'the three functions are security definer with an empty search_path');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'private.rate_limit_hits'::regclass), 'rate_limit_hits has RLS');
select tests.login(current_setting('t.a'));
select throws_ok($$select * from private.rate_limit_hits$$, '42501', null, 'a member cannot read rate_limit_hits');
select tests.clear_authentication();

-- ===== 2. helper =====
select lives_ok($$select tests.rep($q$select private.rate_limit('s1', 'b1', 3, '1 minute')$q$, 3)$$, 'three hits under max 3 pass');
select throws_ok($$select private.rate_limit('s1', 'b1', 3, '1 minute')$$, 'P0001', 'rate_limited', 'the fourth raises rate_limited');
select is(tests.hits('s1', 'b1'), 3, 'the refused hit is rolled back with the raise');
select lives_ok($$select private.rate_limit('s2', 'b1', 3, '1 minute'); select private.rate_limit('s1', 'b2', 3, '1 minute')$$,
  'another subject or another bucket has its own counter');
insert into private.rate_limit_hits (subject, bucket, window_start, hits)
  values ('s3', 'b1', tests.win('1 minute') - interval '1 minute', 100);
select lives_ok($$select private.rate_limit('s3', 'b1', 1, '1 minute')$$, 'hits of the previous window do not count');
insert into private.rate_limit_hits (subject, bucket, window_start, hits) values ('s4', 'b1', now() - interval '2 days', 5);
select private.rate_limit('s4', 'b1', 10, '1 minute');
select is((select count(*)::int from private.rate_limit_hits where subject = 's4' and window_start < now() - interval '1 day'), 0,
  'a stale row (older than 1 day) is deleted by the next call');
select lives_ok($$select private.rate_limit(null, 'b1', 0, '1 minute')$$, 'a null subject is a no-op');
select is((select count(*)::int from private.rate_limit_hits where subject is null), 0, 'and writes nothing');

-- ===== 3. messages (Review Focus 1) =====
delete from private.rate_limit_hits;
select tests.login(current_setting('t.a'));
select lives_ok($$select tests.rep($q$select tests.post(current_setting('t.ch'))$q$, 30)$$, '30 messages in one minute pass');
select throws_ok($$select tests.post(current_setting('t.ch'))$$, 'P0001', 'rate_limited', 'the 31st raises rate_limited');
select tests.login(current_setting('t.b'));
select lives_ok($$select tests.post(current_setting('t.ch'))$$, 'member B is unaffected');
select tests.clear_authentication();
delete from private.rate_limit_hits;
insert into private.rate_limit_hits (subject, bucket, window_start, hits)
  values (current_setting('t.a'), 'message_hour', tests.win('1 hour'), 600);
select tests.login(current_setting('t.a'));
select throws_ok($$select tests.post(current_setting('t.ch'))$$, 'P0001', 'rate_limited', '600 messages in the hour: the next raises');
select tests.clear_authentication();
delete from private.rate_limit_hits;
set local role service_role;
select lives_ok($$select public.post_message_as(current_setting('t.a')::uuid, current_setting('t.alpha')::uuid, tests.doc('alpha'),
                                                'alpha', false, null, null, '[]'::jsonb, '0x' || lpad('a990', 40, '0'))$$, 'post_message_as posts for A');
reset role;
select is(tests.hits(current_setting('t.a'), 'message_min') || ':' || tests.hits(current_setting('t.a'), 'message_hour'), '1:1',
  'post_message_as is charged to A (both buckets)');

-- ===== 4. one bucket at max + 1 each =====
delete from private.rate_limit_hits;
select tests.login(current_setting('t.b'));
select set_config('t.m', tests.post(current_setting('t.ch'))::text, true);
select tests.login(current_setting('t.a'));
select lives_ok($$select tests.rep($q$select public.toggle_reaction(current_setting('t.m')::uuid, '👍')$q$, 60)$$, '60 reactions pass');
select throws_ok($$select public.toggle_reaction(current_setting('t.m')::uuid, '👍')$$, 'P0001', 'rate_limited', 'reaction 61st raises');

select set_config('t.tk', public.open_ticket(current_setting('t.ch')::uuid, 'Necesito ayuda', 'hola')::text, true);
select lives_ok($$select tests.rep($q$select public.post_ticket_message(current_setting('t.tk')::uuid, 'más')$q$, 19)$$,
  'open_ticket + 19 ticket messages (20) pass');
select throws_ok($$select public.post_ticket_message(current_setting('t.tk')::uuid, 'más')$$, 'P0001', 'rate_limited',
  'ticket 21st raises');
select tests.clear_authentication();

select lives_ok(format($$select tests.tips(%L, %L, 30)$$, current_setting('t.a'), current_setting('t.b')), '30 tip intents pass');
select tests.login(current_setting('t.a'));
select throws_ok(format($$select public.create_tip_intent('profile', %L::uuid, 'USDC', 10000, 0, false)$$, current_setting('t.b')),
  'P0001', 'rate_limited', 'payment_intent 31st raises');
select tests.clear_authentication();

select tests.login(current_setting('t.c'));
select set_config('t.poll', public.create_poll(current_setting('t.ch')::uuid, '¿Sí o no?', array['Sí', 'No'],
                                               now() + interval '1 day', 'equal')::text, true);
select tests.clear_authentication();
select set_config('t.o1', (select id::text from public.poll_options where poll_id = current_setting('t.poll')::uuid and position = 1), true);
select set_config('t.o2', (select id::text from public.poll_options where poll_id = current_setting('t.poll')::uuid and position = 2), true);
select tests.login(current_setting('t.a'));
select lives_ok($$select tests.rep($q$select public.cast_poll_vote(current_setting('t.poll')::uuid, current_setting('t.o1')::uuid);
                                     select public.cast_poll_vote(current_setting('t.poll')::uuid, current_setting('t.o2')::uuid)$q$, 15)$$,
  '30 votes pass');
select throws_ok($$select public.cast_poll_vote(current_setting('t.poll')::uuid, current_setting('t.o1')::uuid)$$, 'P0001',
  'rate_limited', 'poll_vote 31st raises');

select lives_ok($$select tests.rep($q$select public.enter_raffle(current_setting('t.raffle')::uuid);
                                     select public.leave_raffle(current_setting('t.raffle')::uuid)$q$, 15)$$, '30 raffle entries/leaves pass');
select throws_ok($$select public.enter_raffle(current_setting('t.raffle')::uuid)$$, 'P0001', 'rate_limited', 'raffle_entry 31st raises');

select lives_ok($$select tests.wd(10)$$, '20 withdrawal requests/cancels pass');
select throws_ok($$select public.request_withdrawal(10000000000000000000)$$, 'P0001', 'rate_limited', 'withdrawal 21st raises');

select lives_ok($$select tests.rep($q$select public.update_profile('Nombre', null, null)$q$, 30)$$, '30 profile edits pass');
select throws_ok($$select public.set_handle('t990_a')$$, 'P0001', 'rate_limited', 'profile 31st (set_handle) raises');

select tests.login(current_setting('t.b'));
select lives_ok($$select tests.rep($q$select public.create_invite(1, 24)$q$, 30)$$, '30 invites pass');
select throws_ok($$select public.create_invite(1, 24)$$, 'P0001', 'rate_limited', 'invite_create 31st raises');
select tests.clear_authentication();

-- ===== 5. rate_limit_hit =====
delete from private.rate_limit_hits;
select tests.login(current_setting('t.a'));
select lives_ok($$select tests.rep($q$select public.rate_limit_hit('chain_verify')$q$, 120)$$, '120 chain_verify hits pass');
select throws_ok($$select public.rate_limit_hit('chain_verify')$$, 'P0001', 'rate_limited', 'chain_verify 121st raises');
select throws_ok($$select public.rate_limit_hit('other')$$, 'P0001', 'invalid_input', 'an unknown bucket raises invalid_input');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.nu')::uuid);
select lives_ok($$select tests.rep($q$select public.rate_limit_hit('redeem_invite')$q$, 10)$$, '10 redeem_invite hits pass');
select throws_ok($$select public.rate_limit_hit('redeem_invite')$$, 'P0001', 'rate_limited', 'redeem_invite 11th raises');
select tests.clear_authentication();
select is(tests.hits('u:' || current_setting('t.nu'), 'redeem_invite'), 10, 'a non-member is keyed u:<auth uid>');
select throws_ok($$select public.rate_limit_hit('chain_verify')$$, 'P0001', 'not_authenticated', 'no member and no user: not_authenticated');

-- ===== 6. uploads =====
select tests.objs('chat-images', current_setting('t.a'), 59);
select tests.objs('chat-images', current_setting('t.a'), 5, '2 hours');
select tests.objs('avatars', current_setting('t.a'), 19);
select tests.objs('avatars', current_setting('t.a'), 5, '2 hours');
select tests.login(current_setting('t.a'));
select is(public.upload_quota_ok('chat-images'), true, '59 chat images in the last hour (older ones ignored): still allowed');
select is(public.upload_quota_ok('avatars'), true, '19 avatars in the last hour (older ones ignored): still allowed');
select tests.clear_authentication();
select tests.objs('chat-images', current_setting('t.a'), 1);
select tests.objs('avatars', current_setting('t.a'), 1);
select tests.login(current_setting('t.a'));
select is(public.upload_quota_ok('chat-images'), false, '60 chat images in the last hour: refused');
select is(public.upload_quota_ok('avatars'), false, '20 avatars in the last hour: refused');
select is(public.upload_quota_ok('other'), false, 'an unknown bucket: refused');
select tests.login(current_setting('t.b'));
select is(public.upload_quota_ok('chat-images'), true, 'another member keeps their own quota');
select tests.clear_authentication();

-- ===== 7. presence (F5-R16) =====
delete from private.rate_limit_hits;
select tests.login(current_setting('t.p'));
select lives_ok($$select tests.rep($q$select public.touch_presence('99000000-0000-4000-8000-000000000001')$q$, 120)$$,
  '120 presence beats in a minute pass');
select throws_ok($$select public.touch_presence('99000000-0000-4000-8000-000000000001')$$, 'P0001', 'rate_limited',
  'presence 121st raises');
select lives_ok($$select tests.rep($q$select public.leave_presence('99000000-0000-4000-8000-000000000002')$q$, 130)$$,
  'leave_presence is not charged');
select tests.clear_authentication();
select is(tests.hits(current_setting('t.p'), 'presence'), 120, 'only touch_presence counted');
delete from private.rate_limit_hits;
delete from public.member_presence where member_id = current_setting('t.p')::uuid;
insert into public.member_presence (member_id, device_id, last_seen_at)
  select current_setting('t.p')::uuid, ('99100000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, now() - make_interval(mins => i)
  from generate_series(1, 10) i;
select tests.login(current_setting('t.p'));
select public.touch_presence('99200000-0000-4000-8000-000000000001');
select tests.clear_authentication();
select is((select count(*)::int from public.member_presence where member_id = current_setting('t.p')::uuid), 10,
  'an 11th device keeps the member at 10 device rows');
select is((select count(*)::int from public.member_presence where member_id = current_setting('t.p')::uuid
             and device_id in ('99100000-0000-4000-8000-000000000010', '99200000-0000-4000-8000-000000000001')), 1,
  'the oldest device row is evicted and the new one is kept');

select * from finish();
rollback;
