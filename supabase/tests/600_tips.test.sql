begin;
select plan(99);

-- helpers (rolled back with the test)
create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.post(p_ch uuid, p_body jsonb, p_root uuid default null)
returns uuid language sql as $$
  select public.post_message(p_ch, p_body, 'x', false, p_root, null, '[]'::jsonb)
$$;
-- a message tip intent: (target message, token, amount, bps, anonymous) -> jsonb
create function tests.tip(p_msg text, p_token text, p_amount numeric, p_bps int, p_anon boolean default false)
returns jsonb language sql as $$
  select public.create_tip_intent('message', p_msg::uuid, p_token, p_amount, p_bps, p_anon)
$$;
create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;

-- ===== schema / privileges =====
select ok((select relrowsecurity from pg_class where oid = 'public.payment_intents'::regclass), 'RLS on payment_intents');
select ok((select relrowsecurity from pg_class where oid = 'public.onchain_transfers'::regclass), 'RLS on onchain_transfers');
select ok((select relrowsecurity from pg_class where oid = 'public.tips'::regclass), 'RLS on tips');
select is((select count(*)::int from pg_policies where schemaname = 'public'
  and tablename in ('payment_intents', 'onchain_transfers', 'tips') and cmd <> 'SELECT'), 0, 'no write policies on the tip tables');
select ok(not has_table_privilege('authenticated', 'public.tips', 'select'), 'authenticated cannot select tips');
select ok(not has_table_privilege('authenticated', 'public.onchain_transfers', 'select'), 'authenticated cannot select onchain_transfers');
select ok(not has_table_privilege('authenticated', 'public.payment_intents', 'insert')
      and not has_table_privilege('authenticated', 'public.payment_intents', 'update')
      and not has_table_privilege('authenticated', 'public.payment_intents', 'delete')
      and not has_table_privilege('authenticated', 'public.payment_intents', 'truncate'), 'no client writes on payment_intents');
select ok(not has_function_privilege('authenticated', 'public.confirm_tip(uuid,jsonb,jsonb)', 'execute'), 'authenticated cannot confirm_tip');
select ok(not has_function_privilege('anon', 'public.confirm_tip(uuid,jsonb,jsonb)', 'execute'), 'anon cannot confirm_tip');
select ok(has_function_privilege('service_role', 'public.confirm_tip(uuid,jsonb,jsonb)', 'execute'), 'service_role confirms tips');
select ok(not has_function_privilege('authenticated', 'public.fail_intent(uuid,text)', 'execute'), 'authenticated cannot fail_intent');
select ok(has_function_privilege('service_role', 'public.fail_intent(uuid,text)', 'execute'), 'service_role fails intents');
select ok(has_function_privilege('authenticated', 'public.create_tip_intent(text,uuid,text,numeric,int,boolean)', 'execute'), 'authenticated creates intents');
select ok(not has_function_privilege('anon', 'public.create_tip_intent(text,uuid,text,numeric,int,boolean)', 'execute'), 'anon cannot create intents');
select ok(not has_function_privilege('anon', 'public.message_tips(uuid)', 'execute'), 'anon cannot message_tips');
select throws_ok($$insert into public.messages (channel_id, author_id, body, body_text, allow_links, kind)
  values (gen_random_uuid(), null, '{}', 'x', false, 'text')$$, null, null, 'a non-system message needs an author');

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d6000', 40, '0'), null, true)::text, true);   -- donor
select set_config('t.b', tests.create_member('0x' || lpad('d6001', 40, '0'), current_setting('t.a')::uuid)::text, true); -- recipient
select set_config('t.c', tests.create_member('0x' || lpad('d6002', 40, '0'), current_setting('t.a')::uuid)::text, true); -- anon donor
select set_config('t.h', tests.create_member('0x' || lpad('d6003', 40, '0'), current_setting('t.a')::uuid)::text, true); -- cannot see channel
select set_config('t.m', tests.create_member('0x' || lpad('d6004', 40, '0'), current_setting('t.a')::uuid)::text, true); -- many intents
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
select set_config('t.uh', (select auth_user_id::text from public.members where id = current_setting('t.h')::uuid), true);
select set_config('t.um', (select auth_user_id::text from public.members where id = current_setting('t.m')::uuid), true);
update public.members set handle = 'donor1' where id = current_setting('t.a')::uuid;
update public.members set handle = 'recip1' where id = current_setting('t.b')::uuid;
update public.members set handle = 'anonym1' where id = current_setting('t.c')::uuid;

select set_config('t.cat', tests.create_channel(null, 'category', 'T600cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't600')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.ch')::uuid, 'member', current_setting('t.h')::uuid, 0, 1);

update public.chain_config set platform_wallet = '0x' || lpad('f00', 40, '0') where chain_id = 59141;

select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.m1', tests.post(current_setting('t.ch')::uuid, tests.td('root one'))::text, true);
select set_config('t.m2', tests.post(current_setting('t.ch')::uuid, tests.td('root two'))::text, true);
select set_config('t.m3', tests.post(current_setting('t.ch')::uuid, tests.td('to be deleted'))::text, true);
select set_config('t.reply', tests.post(current_setting('t.ch')::uuid, tests.td('a reply'), current_setting('t.m2')::uuid)::text, true);
select tests.clear_authentication();
update public.messages set deleted_at = now() where id = current_setting('t.m3')::uuid;

-- ===== intent creation =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.i1', tests.tip(current_setting('t.m1'), 'USDC', 10000000, 260)::text, true);
select is((current_setting('t.i1')::jsonb ->> 'feeAmount'), '260000', 'fee: 10 USDC at 260 bps = 260000');
select is((current_setting('t.i1')::jsonb ->> 'amount'), '10000000', 'amount is returned as a string');
select is((current_setting('t.i1')::jsonb ->> 'chainId')::int, 59141, 'chainId is the active chain');
select is((current_setting('t.i1')::jsonb ->> 'recipientAddress'), '0x' || lpad('d6001', 40, '0'), 'recipient wallet is snapshotted');
select is((current_setting('t.i1')::jsonb ->> 'platformAddress'), '0x' || lpad('f00', 40, '0'), 'platform wallet is snapshotted');
select is((tests.tip(current_setting('t.m1'), 'USDC', 10001, 1) ->> 'feeAmount'), '2', 'fee rounds up (ceil)');
select is((tests.tip(current_setting('t.m1'), 'USDC', 10000, 0) ->> 'platformAddress'), null, 'no platform address without a fee');
select is((select chain_id from public.payment_intents where id = (current_setting('t.i1')::jsonb ->> 'id')::uuid),
  59141, 'intent snapshot equals the active chain');
select is((select count(*)::int from public.payment_intents), 3, 'a member reads their own intents');

select throws_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 9999, 0)$$, 'P0001', 'amount_out_of_range', 'USDC below minimum');
select throws_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 100000000001, 0)$$, 'P0001', 'amount_out_of_range', 'USDC above maximum');
select throws_ok($$select tests.tip(current_setting('t.m1'), 'ETH', 9999999999999, 0)$$, 'P0001', 'amount_out_of_range', 'ETH below minimum');
select throws_ok($$select tests.tip(current_setting('t.m1'), 'ETH', 100000000000000000001, 0)$$, 'P0001', 'amount_out_of_range', 'ETH above maximum');
select throws_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 10000000, 5001)$$, 'P0001', 'fee_out_of_range', 'fee above 5000 bps');
select throws_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 10000000, -1)$$, 'P0001', 'fee_out_of_range', 'negative fee');
select tests.clear_authentication();
update public.app_config set value = '100'::jsonb where key = 'min_fee_bps';
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 10000000, 99)$$, 'P0001', 'fee_out_of_range', 'fee below the configured minimum');
select tests.clear_authentication();
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';
update public.chain_config set platform_wallet = null where chain_id = 59141;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 10000000, 100)$$, 'P0001', 'platform_not_configured', 'fee without platform wallet');
select lives_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 10000000, 0)$$, 'no fee needs no platform wallet');
select tests.clear_authentication();
update public.chain_config set platform_wallet = '0x' || lpad('f00', 40, '0') where chain_id = 59141;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select tests.tip(current_setting('t.m3'), 'USDC', 10000000, 0)$$, 'P0001', 'not_found', 'deleted message is not found');
select throws_ok($$select public.create_tip_intent('profile', current_setting('t.a')::uuid, 'USDC', 10000000, 0, false)$$,
  'P0001', 'self_payment', 'self-tip to own profile');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 10000000, 0)$$, 'P0001', 'self_payment', 'self-tip to own message');
select tests.authenticate_as(current_setting('t.uh')::uuid);
select throws_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 10000000, 0)$$, 'P0001', 'not_found', 'message in a hidden channel is not found');
select tests.authenticate_as(current_setting('t.um')::uuid);
select lives_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 10000, 0) from generate_series(1, 20)$$, '20 pending intents are allowed');
select throws_ok($$select tests.tip(current_setting('t.m1'), 'USDC', 10000, 0)$$, 'P0001', 'too_many_intents', 'the 21st pending intent fails');
select tests.clear_authentication();
-- the failing 21st (and ETH one) leave the count; expire the batch so the member can tip again
update public.payment_intents set expires_at = now() - interval '1 minute' where member_id = current_setting('t.m')::uuid;
select tests.authenticate_as(current_setting('t.um')::uuid);
select lives_ok($$select tests.tip(current_setting('t.m1'), 'ETH', 100000000000000000000, 0)$$, 'expired intents do not count; ETH at the maximum is accepted');
select tests.clear_authentication();

-- ===== attaching hashes =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($$select public.attach_intent_tx(%L, 'main', %L)$$, current_setting('t.i1')::jsonb ->> 'id', tests.hash(1)),
  'attach the main hash');
select lives_ok(format($$select public.attach_intent_tx(%L, 'main', %L)$$, current_setting('t.i1')::jsonb ->> 'id', tests.hash(1)),
  'attaching the same hash again is a no-op');
select throws_ok(format($$select public.attach_intent_tx(%L, 'main', %L)$$, current_setting('t.i1')::jsonb ->> 'id', tests.hash(9)),
  'P0001', 'tx_already_attached', 'a second different hash is rejected');
select lives_ok(format($$select public.attach_intent_tx(%L, 'fee', %L)$$, current_setting('t.i1')::jsonb ->> 'id', tests.hash(2)),
  'attach the fee hash');
select throws_ok(format($$select public.attach_intent_tx(%L, 'main', %L)$$, current_setting('t.i1')::jsonb ->> 'id', 'not-a-hash'),
  'P0001', 'invalid_input', 'a malformed hash is rejected');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($$select public.attach_intent_tx(%L, 'main', %L)$$, current_setting('t.i1')::jsonb ->> 'id', tests.hash(3)),
  'P0001', 'not_found', 'another member''s intent is not found');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.iexp', tests.tip(current_setting('t.m1'), 'USDC', 10000000, 0)::text, true);
select tests.clear_authentication();
update public.payment_intents set expires_at = now() - interval '1 minute' where id = (current_setting('t.iexp')::jsonb ->> 'id')::uuid;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.attach_intent_tx(%L, 'main', %L)$$, current_setting('t.iexp')::jsonb ->> 'id', tests.hash(4)),
  'P0001', 'intent_expired', 'an expired intent cannot take a hash');
select tests.clear_authentication();

-- ===== confirmation =====
set local role service_role;
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, null)$$, current_setting('t.i1')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(1), 'logIndex', 5, 'blockNumber', 100)),
  'P0001', 'tx_mismatch', 'a missing fee transfer is a mismatch when the intent has a fee');
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, %L::jsonb)$$, current_setting('t.i1')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(7), 'logIndex', 5, 'blockNumber', 100),
  jsonb_build_object('txHash', tests.hash(2), 'logIndex', 6, 'blockNumber', 100)),
  'P0001', 'tx_mismatch', 'a main hash different from the attached one is a mismatch');
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, null)$$, current_setting('t.iexp')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(4), 'logIndex', 5, 'blockNumber', 100)),
  'P0001', 'intent_expired', 'an expired intent cannot be confirmed');
select set_config('t.tip1', public.confirm_tip((current_setting('t.i1')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.hash(1), 'logIndex', 5, 'blockNumber', 100),
  jsonb_build_object('txHash', tests.hash(2), 'logIndex', 6, 'blockNumber', 100))::text, true);
reset role;

select is((select status from public.payment_intents where id = (current_setting('t.i1')::jsonb ->> 'id')::uuid),
  'confirmed', 'the intent is confirmed');
select is((select count(*)::int from public.onchain_transfers where intent_id = (current_setting('t.i1')::jsonb ->> 'id')::uuid),
  2, 'both transfers are recorded');
select is((select t.amount::text || '/' || t.fee_amount::text || '/' || t.block_number::text || '/' || t.anonymous::text
  from public.tips t where t.id = current_setting('t.tip1')::uuid), '10000000/260000/100/false', 'the tip row holds the snapshot');
select is((select t.message_id from public.tips t where t.id = current_setting('t.tip1')::uuid), current_setting('t.m1')::uuid, 'the tip points at the message');
select is((select count(*)::int from public.messages where tip_id = current_setting('t.tip1')::uuid), 1, 'one system notice');
select is((select m.kind || '/' || coalesce(m.author_id::text, 'null') || '/' || (m.thread_root_id = current_setting('t.m1')::uuid)::text
  from public.messages m where m.tip_id = current_setting('t.tip1')::uuid), 'system/null/true', 'notice: system kind, null author, thread of the root');
select is((select m.body_text from public.messages m where m.tip_id = current_setting('t.tip1')::uuid),
  '@donor1 ha enviado 10 USDC a @recip1 por este mensaje', 'notice text is exact');
select is((select jsonb_typeof(m.body) from public.messages m where m.tip_id = current_setting('t.tip1')::uuid), 'object', 'notice body is a doc');
select is((select reply_count from public.messages where id = current_setting('t.m1')::uuid), 1, 'reply_count of the root is bumped');
select ok((select last_reply_at is not null from public.messages where id = current_setting('t.m1')::uuid), 'last_reply_at of the root is set');
select is((select n.kind || '/' || n.actor_id::text || '/' || (n.data ->> 'tipId')
  from public.notifications n where n.recipient_id = current_setting('t.b')::uuid and n.kind = 'tip_received'),
  'tip_received/' || current_setting('t.a') || '/' || current_setting('t.tip1'), 'the recipient gets a tip_received notification');
select is((select count(*)::int from public.notifications n
  where n.message_id = (select m.id from public.messages m where m.tip_id = current_setting('t.tip1')::uuid)), 1,
  'the notice produces only the tip notification (no reply or channel fan-out)');
select is((select m.reply_count from public.messages m where m.id = current_setting('t.m1')::uuid), 1, 'still one reply');
select is((select p.body from public._push_build((select n.id from public.notifications n
  where n.recipient_id = current_setting('t.b')::uuid and n.kind = 'tip_received' limit 1)) p),
  'Has recibido una propina de @donor1', 'push text names the donor');

-- confirming twice returns the same tip
set local role service_role;
select is(public.confirm_tip((current_setting('t.i1')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.hash(1), 'logIndex', 5, 'blockNumber', 100),
  jsonb_build_object('txHash', tests.hash(2), 'logIndex', 6, 'blockNumber', 100))::text, current_setting('t.tip1'),
  'confirming an already confirmed intent is idempotent');
reset role;
select is((select count(*)::int from public.tips), 1, 'still one tip');

-- replay of the same transfer on another intent
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.i3', tests.tip(current_setting('t.m2'), 'USDC', 10000000, 0)::text, true);
select public.attach_intent_tx((current_setting('t.i3')::jsonb ->> 'id')::uuid, 'main', tests.hash(1));
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, null)$$, current_setting('t.i3')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(1), 'logIndex', 5, 'blockNumber', 100)),
  'P0001', 'tx_already_used', 'the same transfer cannot credit a second intent');
reset role;
select is((select status from public.payment_intents where id = (current_setting('t.i3')::jsonb ->> 'id')::uuid), 'pending',
  'the failed replay leaves the intent pending');
select is((select count(*)::int from public.tips), 1, 'the replay credited nothing');
-- the same hash with another log index is another transfer (USDC logs)
set local role service_role;
select lives_ok(format($$select public.confirm_tip(%L, %L::jsonb, null)$$, current_setting('t.i3')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(1), 'logIndex', 8, 'blockNumber', 100)),
  'a different log index of the same tx is a distinct transfer');
reset role;
select is((select m.body_text from public.messages m where m.thread_root_id = current_setting('t.m2')::uuid and m.kind = 'system'),
  '@donor1 ha enviado 10 USDC a @recip1 por este mensaje', 'a tip on a reply posts the notice in the root thread');
select is((select reply_count from public.messages where id = current_setting('t.m2')::uuid), 2, 'reply_count counts the reply and the notice');

-- ===== anonymity =====
select tests.authenticate_as(current_setting('t.uc')::uuid);
select set_config('t.i4', tests.tip(current_setting('t.m1'), 'ETH', 12500000000000000, 100, true)::text, true);
select public.attach_intent_tx((current_setting('t.i4')::jsonb ->> 'id')::uuid, 'main', tests.hash(10));
select public.attach_intent_tx((current_setting('t.i4')::jsonb ->> 'id')::uuid, 'fee', tests.hash(11));
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, %L::jsonb)$$, current_setting('t.i4')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(10), 'logIndex', 3, 'blockNumber', 101),
  jsonb_build_object('txHash', tests.hash(11), 'logIndex', -1, 'blockNumber', 101)),
  'P0001', 'invalid_input', 'a native ETH transfer must be recorded with log index -1');
select set_config('t.tip4', public.confirm_tip((current_setting('t.i4')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.hash(10), 'logIndex', -1, 'blockNumber', 101),
  jsonb_build_object('txHash', tests.hash(11), 'logIndex', -1, 'blockNumber', 101))::text, true);
reset role;
select is((select m.body_text from public.messages m where m.tip_id = current_setting('t.tip4')::uuid),
  'Anónimo ha enviado 0,0125 ETH a @recip1 por este mensaje', 'anonymous notice hides the donor; ETH formatted with decimal comma');
select is((select n.actor_id from public.notifications n where n.data ->> 'tipId' = current_setting('t.tip4')), null,
  'anonymous notification has no actor');
select is((select p.body from public._push_build((select n.id from public.notifications n where n.data ->> 'tipId' = current_setting('t.tip4'))) p),
  'Has recibido una propina de Anónimo', 'anonymous push text');
select ok(not exists (select 1 from public.messages m where m.tip_id = current_setting('t.tip4')::uuid
  and (m.body_text like '%anonym1%' or m.body::text like '%anonym1%' or m.body_text like '%' || current_setting('t.c') || '%')),
  'anonymous notice never carries the donor');

select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select t.donor_id from public.message_tips(current_setting('t.m1')::uuid) t where t.tip_id = current_setting('t.tip4')::uuid),
  null, 'a third member sees a null donor on an anonymous tip');
select is((select t.is_me from public.message_tips(current_setting('t.m1')::uuid) t where t.tip_id = current_setting('t.tip4')::uuid),
  false, 'a third member is not the donor');
select is((select t.donor_id from public.message_tips(current_setting('t.m1')::uuid) t where t.tip_id = current_setting('t.tip1')::uuid),
  current_setting('t.a')::uuid, 'a public tip shows its donor');
select is((select t.donor_id from public.member_tips(current_setting('t.b')::uuid) t where t.tip_id = current_setting('t.tip4')::uuid),
  null, 'member_tips hides the anonymous donor too');
select is((select count(*)::int from public.member_tips(current_setting('t.b')::uuid)), 3, 'member_tips lists the visible tips received');
select tests.authenticate_as(current_setting('t.uc')::uuid);
select is((select t.donor_id from public.message_tips(current_setting('t.m1')::uuid) t where t.tip_id = current_setting('t.tip4')::uuid),
  current_setting('t.c')::uuid, 'the donor sees themselves on their anonymous tip');
select is((select t.is_me from public.message_tips(current_setting('t.m1')::uuid) t where t.tip_id = current_setting('t.tip4')::uuid),
  true, 'is_me is true for the donor');

-- ===== summary =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select s.total::text || '/' || s.tip_count::text from public.tips_summary(array[current_setting('t.m1')::uuid]) s where s.token = 'USDC'),
  '10000000/1', 'USDC total per message');
select is((select s.total::text from public.tips_summary(array[current_setting('t.m1')::uuid]) s where s.token = 'ETH'),
  '12500000000000000', 'ETH total per message');
select tests.authenticate_as(current_setting('t.uh')::uuid);
select is((select count(*)::int from public.tips_summary(array[current_setting('t.m1')::uuid])), 0, 'tips_summary hides hidden channels');
select is((select count(*)::int from public.message_tips(current_setting('t.m1')::uuid)), 0, 'message_tips hides hidden channels');
select is((select count(*)::int from public.member_tips(current_setting('t.b')::uuid)), 0, 'member_tips hides tips on invisible messages');
select tests.clear_authentication();

-- ===== profile tip =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.i5', public.create_tip_intent('profile', current_setting('t.b')::uuid, 'ETH', 10000000000000, 0, false)::text, true);
select public.attach_intent_tx((current_setting('t.i5')::jsonb ->> 'id')::uuid, 'main', tests.hash(20));
select tests.clear_authentication();
set local role service_role;
select set_config('t.tip5', public.confirm_tip((current_setting('t.i5')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.hash(20), 'logIndex', -1, 'blockNumber', 102), null)::text, true);
reset role;
select is((select count(*)::int from public.messages where tip_id = current_setting('t.tip5')::uuid), 0, 'a profile tip posts no notice');
select is((select n.channel_id::text || n.message_id::text from public.notifications n where n.data ->> 'tipId' = current_setting('t.tip5')), null,
  'a profile tip notification has no channel or message');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select count(*)::int from public.member_tips(current_setting('t.b')::uuid)), 4, 'profile tips appear in member_tips');
select tests.clear_authentication();

-- ===== failing an intent =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.i6', tests.tip(current_setting('t.m1'), 'USDC', 10000000, 0)::text, true);
select tests.clear_authentication();
set local role service_role;
select public.fail_intent((current_setting('t.i6')::jsonb ->> 'id')::uuid, 'tx_failed');
reset role;
select is((select status || '/' || failure_code from public.payment_intents where id = (current_setting('t.i6')::jsonb ->> 'id')::uuid),
  'failed/tx_failed', 'fail_intent records the code');

-- ===== system messages =====
select set_config('t.notice', (select m.id::text from public.messages m where m.tip_id = current_setting('t.tip1')::uuid), true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select tests.tip(current_setting('t.notice'), 'USDC', 10000000, 0)$$, 'P0001', 'not_found', 'a system notice is never a tip target');
select throws_ok($$select public.edit_message(current_setting('t.notice')::uuid, tests.td('hacked'), 'x')$$, 'P0001', 'forbidden', 'a system notice cannot be edited');
select throws_ok($$select public.report_message(current_setting('t.notice')::uuid, 'spam', null)$$, 'P0001', 'forbidden', 'a system notice cannot be reported');
select lives_ok($$select public.toggle_reaction(current_setting('t.notice')::uuid, '👍')$$, 'a system notice accepts reactions');
select is((select count(*)::int from public.search_messages('donor1')), 0, 'system notices are not searchable');
select tests.clear_authentication();

select * from finish();
rollback;
