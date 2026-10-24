begin;
select plan(137);

-- helpers (rolled back with the test)
create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.post(p_ch uuid, p_body jsonb, p_root uuid default null)
returns uuid language sql as $$
  select public.post_message(p_ch, p_body, 'x', false, p_root, null, '[]'::jsonb)
$$;
create function tests.bounty(p_ch text, p_token text default 'USDC', p_amount numeric default 10000000)
returns uuid language sql as $$
  select public.create_bounty(p_ch::uuid, tests.td('bounty'), 84532, p_token, p_amount)
$$;
create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.cfg(p_key text) returns text language sql as $$ select current_setting(p_key) $$;
-- the RPCs no longer charge a fee (P0-R5); confirm_bounty_payment still handles one, so a legacy fee is simulated here
create function tests.simulate_fee(p_intent text, p_bps int) returns void language sql as $$
  update public.payment_intents
  set fee_bps = p_bps, fee_amount = div(amount * p_bps + 9999, 10000), platform_address = '0x' || lpad('f00', 40, '0')
  where id = p_intent::uuid
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d7100', 40, '0'), null, true)::text, true);                       -- author
select set_config('t.b', tests.create_member('0x' || lpad('d7101', 40, '0'), current_setting('t.a')::uuid)::text, true);    -- solver
select set_config('t.c', tests.create_member('0x' || lpad('d7102', 40, '0'), current_setting('t.a')::uuid)::text, true);    -- no bit
select set_config('t.v', tests.create_member('0x' || lpad('d7103', 40, '0'), current_setting('t.a')::uuid)::text, true);    -- cannot see the hidden channel
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
select set_config('t.uv', (select auth_user_id::text from public.members where id = current_setting('t.v')::uuid), true);
update public.members set handle = 'author1' where id = current_setting('t.a')::uuid;
update public.members set handle = 'solver1' where id = current_setting('t.b')::uuid;

select set_config('t.cat', tests.create_channel(null, 'category', 'T710cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't710')::text, true);
select set_config('t.hid', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't710hidden')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.hid')::uuid, 'member', current_setting('t.v')::uuid, 0, 1);

-- ===== schema / privileges =====
select ok((select relrowsecurity from pg_class where oid = 'public.bounties'::regclass), 'RLS on bounties');
select ok(not has_table_privilege('authenticated', 'public.bounties', 'select')
      and not has_table_privilege('authenticated', 'public.bounties', 'insert')
      and not has_table_privilege('authenticated', 'public.bounties', 'update')
      and not has_table_privilege('authenticated', 'public.bounties', 'delete'), 'authenticated has no direct access to bounties');
select ok(not has_table_privilege('anon', 'public.bounties', 'select'), 'anon cannot select bounties');
select ok(not has_function_privilege('authenticated', 'public.confirm_bounty_payment(uuid,jsonb,jsonb)', 'execute'), 'authenticated cannot confirm_bounty_payment');
select ok(not has_function_privilege('anon', 'public.confirm_bounty_payment(uuid,jsonb,jsonb)', 'execute'), 'anon cannot confirm_bounty_payment');
select ok(has_function_privilege('service_role', 'public.confirm_bounty_payment(uuid,jsonb,jsonb)', 'execute'), 'service_role confirms bounty payments');
select ok(has_function_privilege('authenticated', 'public.create_bounty(uuid,jsonb,int,text,numeric)', 'execute'), 'authenticated creates bounties');
select ok(not has_function_privilege('anon', 'public.create_bounty(uuid,jsonb,int,text,numeric)', 'execute'), 'anon cannot create bounties');

-- ===== creation =====
select tests.authenticate_as(current_setting('t.uc')::uuid);
select throws_ok($$select tests.bounty(tests.cfg('t.ch'))$$, 'P0001', 'forbidden', 'create_bounty without 65536 is forbidden');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select tests.bounty(tests.cfg('t.ch'), 'USDC', 999999)$$, 'P0001', 'amount_out_of_range', 'USDC below 1');
select throws_ok($$select tests.bounty(tests.cfg('t.ch'), 'USDC', 100000000001)$$, 'P0001', 'amount_out_of_range', 'USDC above 100000');
select throws_ok($$select tests.bounty(tests.cfg('t.ch'), 'ETH', 99999999999999)$$, 'P0001', 'amount_out_of_range', 'ETH below 0.0001');
select throws_ok($$select tests.bounty(tests.cfg('t.ch'), 'ETH', 100000000000000000001)$$, 'P0001', 'amount_out_of_range', 'ETH above 100');
select throws_ok($$select tests.bounty(tests.cfg('t.ch'), 'DAI', 1000000)$$, 'P0001', 'invalid_input', 'unknown token');
select throws_ok($$select tests.bounty(tests.cfg('t.ch'), 'USDC', 1000000.5)$$, 'P0001', 'invalid_input', 'fractional base units');
select lives_ok($$select tests.bounty(tests.cfg('t.ch'), 'USDC', 1000000)$$, 'USDC minimum accepted');
select lives_ok($$select tests.bounty(tests.cfg('t.ch'), 'USDC', 100000000000)$$, 'USDC maximum accepted');
select lives_ok($$select tests.bounty(tests.cfg('t.ch'), 'ETH', 100000000000000)$$, 'ETH minimum accepted');
select lives_ok($$select tests.bounty(tests.cfg('t.ch'), 'ETH', 100000000000000000000)$$, 'ETH maximum accepted');
select set_config('t.b1', tests.bounty(current_setting('t.ch'))::text, true);
select tests.clear_authentication();
select is((select kind from public.messages where id = current_setting('t.b1')::uuid), 'bounty', 'the message has kind bounty');
select is((select chain_id from public.bounties where message_id = current_setting('t.b1')::uuid), 84532, 'the bounty records its network');
select is((select count(*)::int from public.bounties), 5, 'every accepted bounty has a bounties row; rejected ones left none');
select is((select count(*)::int from public.messages where kind = 'bounty'), 5, 'rejected creations left no message behind');

-- the core validation is shared: bad doc and slowmode apply to bounties
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.create_bounty(tests.cfg('t.ch')::uuid, '{"type":"paragraph"}'::jsonb, 84532, 'USDC', 1000000)$$,
  'P0001', 'invalid_input', 'a non-doc body is refused by the shared core');
select throws_ok($$select public.create_bounty(tests.cfg('t.ch')::uuid, tests.td(repeat('x', 4001)), 84532, 'USDC', 1000000)$$,
  'P0001', 'too_long', 'an over-long body is refused by the shared core');
select tests.clear_authentication();
select set_config('t.slow', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't710slow')::text, true);
update public.channels set slowmode_seconds = 600 where id = current_setting('t.slow')::uuid;
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.slow')::uuid, 'member', current_setting('t.b')::uuid, 65536, 0);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select lives_ok($$select tests.bounty(tests.cfg('t.slow'))$$, 'a member granted the bit creates a bounty in a slowmode channel');
select throws_ok($$select tests.bounty(tests.cfg('t.slow'))$$, 'P0001', 'slowmode', 'slowmode applies to bounties');
select tests.clear_authentication();

-- ===== threads for marking =====
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r1', tests.post(current_setting('t.ch')::uuid, tests.td('solution'), current_setting('t.b1')::uuid)::text, true);
select set_config('t.r_del', tests.post(current_setting('t.ch')::uuid, tests.td('to delete'), current_setting('t.b1')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.r_auth', tests.post(current_setting('t.ch')::uuid, tests.td('mine'), current_setting('t.b1')::uuid)::text, true);
select set_config('t.b2', tests.bounty(current_setting('t.ch'))::text, true);
select tests.clear_authentication();
insert into public.messages (channel_id, thread_root_id, author_id, body, body_text, allow_links, kind)
  values (current_setting('t.ch')::uuid, current_setting('t.b1')::uuid, null, tests.td('notice'), 'notice', false, 'system');
select set_config('t.r_sys', (select id::text from public.messages where kind = 'system' order by created_at desc limit 1), true);
update public.messages set deleted_at = now() where id = current_setting('t.r_del')::uuid;

-- ===== marking a solution =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b1')::uuid, tests.cfg('t.r_auth')::uuid)$$,
  'P0001', 'invalid_solution', 'the author cannot mark their own reply');
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b2')::uuid, tests.cfg('t.r1')::uuid)$$,
  'P0001', 'invalid_solution', 'a reply from another thread is refused');
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b1')::uuid, tests.cfg('t.r_sys')::uuid)$$,
  'P0001', 'invalid_solution', 'a system notice is refused');
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b1')::uuid, tests.cfg('t.r_del')::uuid)$$,
  'P0001', 'invalid_solution', 'a deleted reply is refused');
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b1')::uuid, tests.cfg('t.b1')::uuid)$$,
  'P0001', 'invalid_solution', 'the bounty message itself is refused');
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b1')::uuid, gen_random_uuid())$$,
  'P0001', 'invalid_solution', 'an unknown reply is refused');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b1')::uuid, tests.cfg('t.r1')::uuid)$$,
  'P0001', 'forbidden', 'a non-author cannot mark');
select throws_ok($$select public.cancel_bounty(tests.cfg('t.b1')::uuid)$$, 'P0001', 'forbidden', 'a non-author cannot cancel');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok($$select public.mark_bounty_solution(tests.cfg('t.b1')::uuid, tests.cfg('t.r1')::uuid)$$, 'marking a valid reply works');
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b1')::uuid, tests.cfg('t.r1')::uuid)$$,
  'P0001', 'already_marked', 'a second mark (even of the same reply) is refused');
select throws_ok($$select public.cancel_bounty(tests.cfg('t.b1')::uuid)$$, 'P0001', 'already_marked', 'cancel after marking is refused');
select tests.clear_authentication();
select is((select solver_id from public.bounties where message_id = current_setting('t.b1')::uuid), current_setting('t.b')::uuid,
  'the solver is the reply author');
select is((select solution_message_id from public.bounties where message_id = current_setting('t.b1')::uuid), current_setting('t.r1')::uuid,
  'the solution message is stored');
select is((select count(*)::int from public.notifications where kind = 'bounty_solution' and recipient_id = current_setting('t.b')::uuid
    and actor_id = current_setting('t.a')::uuid and data ->> 'bountyId' = current_setting('t.b1')), 1,
  'the solver gets a bounty_solution notification with camelCase data');
select is((select data ->> 'threadRootId' from public.notifications where kind = 'bounty_solution'), current_setting('t.b1'),
  'the notification carries threadRootId');

-- ===== cancelling =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok($$select public.cancel_bounty(tests.cfg('t.b2')::uuid)$$, 'cancel works while open');
select throws_ok($$select public.cancel_bounty(tests.cfg('t.b2')::uuid)$$, 'P0001', 'bounty_closed', 'cancelling twice is refused');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r2', tests.post(current_setting('t.ch')::uuid, tests.td('late answer'), current_setting('t.b2')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b2')::uuid, tests.cfg('t.r2')::uuid)$$,
  'P0001', 'bounty_closed', 'a cancelled bounty cannot get a solution');

-- ===== expired =====
select set_config('t.b3', tests.bounty(current_setting('t.ch'))::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r3', tests.post(current_setting('t.ch')::uuid, tests.td('answer'), current_setting('t.b3')::uuid)::text, true);
select tests.clear_authentication();
update public.bounties set created_at = now() - interval '30 days' - interval '1 minute' where message_id = current_setting('t.b3')::uuid;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b3')::uuid, tests.cfg('t.r3')::uuid)$$,
  'P0001', 'bounty_closed', 'an expired bounty cannot get a solution');
select throws_ok($$select public.cancel_bounty(tests.cfg('t.b3')::uuid)$$, 'P0001', 'bounty_closed', 'an expired bounty cannot be cancelled');
select tests.clear_authentication();

-- ===== status boundaries =====
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b3')::uuid), 'expired',
  'unmarked at created -30d -1min is expired');
update public.bounties set created_at = now() - interval '30 days' + interval '1 minute' where message_id = current_setting('t.b3')::uuid;
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b3')::uuid), 'open',
  'unmarked at created -30d +1min is open');
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b2')::uuid), 'cancelled',
  'cancelled wins');
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b1')::uuid), 'solution_marked',
  'freshly marked is solution_marked');
update public.bounties set solution_marked_at = now() - interval '7 days' + interval '1 minute' where message_id = current_setting('t.b1')::uuid;
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b1')::uuid), 'solution_marked',
  'marked -7d +1min is still solution_marked');
update public.bounties set solution_marked_at = now() - interval '7 days' - interval '1 minute' where message_id = current_setting('t.b1')::uuid;
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b1')::uuid), 'unpaid',
  'marked -7d -1min is unpaid');
update public.bounties set created_at = now() - interval '90 days' where message_id = current_setting('t.b1')::uuid;
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b1')::uuid), 'unpaid',
  'a marked bounty never turns expired');
update public.bounties set paid_at = solution_marked_at + interval '7 days' - interval '1 minute' where message_id = current_setting('t.b1')::uuid;
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b1')::uuid), 'paid',
  'paid within 7 days is paid');
update public.bounties set paid_at = solution_marked_at + interval '7 days' + interval '1 minute' where message_id = current_setting('t.b1')::uuid;
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b1')::uuid), 'paid_late',
  'paid after 7 days is paid_late');
update public.bounties set paid_at = null where message_id = current_setting('t.b1')::uuid;

-- ===== soft delete, never hard delete (ruling F3c-R1) =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.b4', tests.bounty(current_setting('t.ch'))::text, true);   -- no replies at all
select set_config('t.b5', tests.bounty(current_setting('t.ch'))::text, true);   -- marked, then deleted
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r5', tests.post(current_setting('t.ch')::uuid, tests.td('solution 5'), current_setting('t.b5')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.mark_bounty_solution(current_setting('t.b5')::uuid, current_setting('t.r5')::uuid);
select tests.clear_authentication();
update public.bounties set solution_marked_at = now() - interval '8 days' where message_id = current_setting('t.b5')::uuid;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).unpaid), 2, 'two unpaid bounties before deleting');
-- F3-R6 (20261018800021): the author can no longer delete a bounty with a marked, unpaid solution; the soft-deleted
-- state below is set directly to keep covering the record and FK rules for bounties deleted before that guard.
select throws_ok($$select public.delete_message(tests.cfg('t.b5')::uuid)$$, 'P0001', 'bounty_has_solution',
  'the author cannot delete a bounty with a marked, unpaid solution');
select is((public.delete_message(current_setting('t.b4')::uuid) ->> 'hard')::boolean, false, 'deleting a bounty without replies is a soft delete');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((public.delete_message(current_setting('t.r5')::uuid) ->> 'hard')::boolean, false, 'deleting the solution reply is a soft delete');
select tests.clear_authentication();
update public.messages set deleted_at = now(), deleted_by = current_setting('t.a')::uuid where id = current_setting('t.b5')::uuid;
select ok((select deleted_at is not null from public.messages where id = current_setting('t.b5')::uuid), 'the bounty message survives, deleted');
select ok((select deleted_at is not null from public.messages where id = current_setting('t.r5')::uuid), 'the solution message survives, deleted');
select is((select kind from public.messages where id = current_setting('t.b5')::uuid), 'bounty', 'a soft-deleted bounty keeps its kind');
select is((select count(*)::int from public.bounties where message_id in (current_setting('t.b4')::uuid, current_setting('t.b5')::uuid)), 2,
  'the bounties rows survive deletion');
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b5')::uuid), 'unpaid',
  'deleting after marking keeps the unpaid status');
select throws_ok(format($$delete from public.messages where id = %L$$, current_setting('t.b4')), '23503', null,
  'a hard delete of a bounty message is blocked by the FK');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).unpaid), 2, 'the record still counts the deleted unpaid bounty');
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.b4')::uuid, tests.cfg('t.r1')::uuid)$$,
  'P0001', 'bounty_closed', 'a deleted unmarked bounty cannot get a solution');
select tests.clear_authentication();
select throws_ok(format($$select public.delete_channel(%L)$$, current_setting('t.ch')), 'P0001', null,
  'a channel with bounties cannot be deleted (also not as an anonymous caller)');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.delete_channel(%L)$$, current_setting('t.ch')), 'P0001', 'channel_has_bounties',
  'delete_channel refuses a channel that holds bounties');
select tests.clear_authentication();

-- ===== payment intent =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.b6', tests.bounty(current_setting('t.ch'))::text, true);   -- unmarked
select set_config('t.b7', tests.bounty(current_setting('t.ch'), 'USDC', 10000000)::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r7', tests.post(current_setting('t.ch')::uuid, tests.td('solution 7'), current_setting('t.b7')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.mark_bounty_solution(current_setting('t.b7')::uuid, current_setting('t.r7')::uuid);
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b6')::uuid, 84532, 10000000)$$, 'P0001', 'no_solution', 'no intent before marking');
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b7')::uuid, 84532, 9999999)$$, 'P0001', 'amount_below_bounty', 'below the announced amount');
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b2')::uuid, 84532, 10000000)$$, 'P0001', 'bounty_closed', 'a cancelled bounty cannot be paid');
select throws_ok($$select public.create_bounty_payment_intent(gen_random_uuid(), 84532, 10000000)$$, 'P0001', 'not_found', 'unknown bounty');
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b7')::uuid, 84532, 100000000001)$$, 'P0001', 'amount_out_of_range', 'above the USDC maximum');
select tests.authenticate_as(current_setting('t.uc')::uuid);
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b7')::uuid, 84532, 10000000)$$, 'P0001', 'forbidden', 'a non-author cannot create the intent');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b7')::uuid, 84532, 10000000)$$, 'P0001', 'forbidden', 'the solver cannot create the intent');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b7')::uuid, 59141, 10000000)$$, 'P0001', 'chain_invalid', 'a Linea chain is refused');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.i7', public.create_bounty_payment_intent(current_setting('t.b7')::uuid, 84532, 12000000)::text, true);
select is((current_setting('t.i7')::jsonb ->> 'recipientAddress'), '0x' || lpad('d7101', 40, '0'), 'recipient snapshot is the solver wallet');
select is((current_setting('t.i7')::jsonb ->> 'feeAmount'), '0', 'no fee on top of the amount');
select is((current_setting('t.i7')::jsonb ->> 'amount'), '12000000', 'an amount above the announced one is accepted');
select is((current_setting('t.i7')::jsonb ->> 'platformAddress'), null, 'no platform address');
select tests.clear_authentication();
-- i7 carries a legacy fee so confirm_bounty_payment's fee path stays covered
select tests.simulate_fee(current_setting('t.i7')::jsonb ->> 'id', 100);
select is((select purpose || '/' || target_type || '/' || target_id::text || '/' || token || '/' || anonymous::text
           from public.payment_intents where id = (current_setting('t.i7')::jsonb ->> 'id')::uuid),
  'bounty/bounty/' || current_setting('t.b7') || '/USDC/false', 'intent: purpose, target, token and never anonymous');
select is((select recipient_member_id from public.payment_intents where id = (current_setting('t.i7')::jsonb ->> 'id')::uuid),
  current_setting('t.b')::uuid, 'recipient member is the solver');

-- ===== confirmation =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.attach_intent_tx((current_setting('t.i7')::jsonb ->> 'id')::uuid, 'main', tests.hash(71));
select public.attach_intent_tx((current_setting('t.i7')::jsonb ->> 'id')::uuid, 'fee', tests.hash(72));
select throws_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, %L::jsonb)$$, current_setting('t.i7')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(71), 'logIndex', 3, 'blockNumber', 500, 'blockTimestamp', now()),
  jsonb_build_object('txHash', tests.hash(72), 'logIndex', 4, 'blockNumber', 500, 'blockTimestamp', now())), '42501', null,
  'authenticated is refused at the privilege level');
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, %L::jsonb)$$, current_setting('t.i7')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(70), 'logIndex', 3, 'blockNumber', 500, 'blockTimestamp', now()),
  jsonb_build_object('txHash', tests.hash(72), 'logIndex', 4, 'blockNumber', 500, 'blockTimestamp', now())), 'P0001', 'tx_mismatch',
  'a main hash that was not attached is a mismatch');
select set_config('t.tip7', public.confirm_bounty_payment((current_setting('t.i7')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.hash(71), 'logIndex', 3, 'blockNumber', 500, 'blockTimestamp', now()),
  jsonb_build_object('txHash', tests.hash(72), 'logIndex', 4, 'blockNumber', 500, 'blockTimestamp', now()))::text, true);
reset role;
select is((select message_id::text || '/' || to_member::text || '/' || amount::text || '/' || anonymous::text || '/' || target_type
           from public.tips where id = current_setting('t.tip7')::uuid),
  current_setting('t.r7') || '/' || current_setting('t.b') || '/12000000/false/message', 'the tip lands on the solution message, to the solver');
select is((select paid_tip_id from public.bounties where message_id = current_setting('t.b7')::uuid), current_setting('t.tip7')::uuid,
  'the bounty records the tip');
select ok((select paid_at is not null from public.bounties where message_id = current_setting('t.b7')::uuid), 'the bounty is marked paid');
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b7')::uuid), 'paid', 'status is paid');
select is((select body_text from public.messages where thread_root_id = current_setting('t.b7')::uuid and kind = 'system'),
  '@author1 ha pagado el bounty: 12 USDC a @solver1', 'the payment notice text is exact');
select is((select reply_count from public.messages where id = current_setting('t.b7')::uuid), 2, 'reply_count counts the reply and the notice');
select is((select count(*)::int from public.notifications where kind = 'bounty_paid' and recipient_id = current_setting('t.b')::uuid
    and actor_id = current_setting('t.a')::uuid and data ->> 'bountyId' = current_setting('t.b7')
    and data ->> 'tipId' = current_setting('t.tip7')), 1, 'the solver gets bounty_paid with camelCase data');
select is((select count(*)::int from public.notifications where kind = 'tip_received' and recipient_id = current_setting('t.b')::uuid), 0,
  'no tip_received on top of bounty_paid');
select is((select status from public.payment_intents where id = (current_setting('t.i7')::jsonb ->> 'id')::uuid), 'confirmed', 'intent confirmed');
set local role service_role;
select is(public.confirm_bounty_payment((current_setting('t.i7')::jsonb ->> 'id')::uuid,
  jsonb_build_object('txHash', tests.hash(71), 'logIndex', 3, 'blockNumber', 500, 'blockTimestamp', now()),
  jsonb_build_object('txHash', tests.hash(72), 'logIndex', 4, 'blockNumber', 500, 'blockTimestamp', now()))::text, current_setting('t.tip7'),
  'confirming a confirmed intent is idempotent');
reset role;
select is((select count(*)::int from public.tips), 1, 'still one tip');

-- already paid / replay
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b7')::uuid, 84532, 10000000)$$, 'P0001', 'already_paid', 'a paid bounty refuses a new intent');
select set_config('t.b8', tests.bounty(current_setting('t.ch'))::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r8', tests.post(current_setting('t.ch')::uuid, tests.td('solution 8'), current_setting('t.b8')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.mark_bounty_solution(current_setting('t.b8')::uuid, current_setting('t.r8')::uuid);
select set_config('t.i8', public.create_bounty_payment_intent(current_setting('t.b8')::uuid, 84532, 10000000)::text, true);
select is(public.create_bounty_payment_intent(current_setting('t.b8')::uuid, 84532, 10000000) ->> 'id', current_setting('t.i8')::jsonb ->> 'id',
  'asking again returns the same hashless intent (F3c-R3 a)');
-- simulate a racing second intent (the RPC no longer produces one) to pin the confirm-time already_paid guard
select tests.clear_authentication();
select set_config('t.i8b', jsonb_build_object('id', gen_random_uuid())::text, true);
insert into public.payment_intents (id, member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
    recipient_member_id, recipient_address, target_type, target_id, anonymous)
  select (current_setting('t.i8b')::jsonb ->> 'id')::uuid, member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
    recipient_member_id, recipient_address, target_type, target_id, anonymous
  from public.payment_intents where id = (current_setting('t.i8')::jsonb ->> 'id')::uuid;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.attach_intent_tx((current_setting('t.i8')::jsonb ->> 'id')::uuid, 'main', tests.hash(71));
select public.attach_intent_tx((current_setting('t.i8b')::jsonb ->> 'id')::uuid, 'main', tests.hash(81));
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, null)$$, current_setting('t.i8')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(71), 'logIndex', 3, 'blockNumber', 500, 'blockTimestamp', now())), 'P0001', 'tx_already_used',
  'replaying a credited transfer is refused');
reset role;
select is((select paid_at from public.bounties where message_id = current_setting('t.b8')::uuid), null, 'the replay paid nothing');
set local role service_role;
select lives_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, null)$$, current_setting('t.i8b')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(81), 'logIndex', 1, 'blockNumber', 600, 'blockTimestamp', now())), 'a fresh transfer pays the bounty');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.attach_intent_tx((current_setting('t.i8')::jsonb ->> 'id')::uuid, 'main', tests.hash(71));
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, null)$$, current_setting('t.i8')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(71), 'logIndex', 3, 'blockNumber', 500, 'blockTimestamp', now())), 'P0001', 'already_paid',
  'a second intent of an already paid bounty is refused');
select throws_ok(format($$select public.confirm_bounty_payment(%L, null, null)$$, (select id::text from public.payment_intents
  where purpose = 'bounty' and status = 'pending' limit 1)), 'P0001', 'already_paid', 'already_paid wins over input validation');
reset role;
select is((select count(*)::int from public.tips), 2, 'two tips in total');

-- a tip intent cannot be confirmed as a bounty payment, and vice versa
select tests.authenticate_as(current_setting('t.uc')::uuid);
select set_config('t.itip', public.create_tip_intent('message', current_setting('t.r7')::uuid, 84532, 'USDC', 10000000, false)::text, true);
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_bounty_payment(%L, null, null)$$, current_setting('t.itip')::jsonb ->> 'id'),
  'P0001', 'not_found', 'a tip intent is not a bounty payment');
select throws_ok(format($$select public.confirm_tip(%L, null, null)$$, (select id::text from public.payment_intents where purpose = 'bounty' limit 1)),
  'P0001', 'not_found', 'a bounty intent is not a tip');
reset role;

-- ===== reads =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select count(*)::int from public.bounty_details(array[current_setting('t.b7')::uuid, current_setting('t.b1')::uuid, current_setting('t.r1')::uuid])), 2,
  'bounty_details returns rows for bounty messages only');
select is((select status || '/' || amount_text || '/' || token from public.bounty_details(array[current_setting('t.b7')::uuid])), 'paid/10000000/USDC',
  'bounty_details: status, text amount, token');
select ok((select pay_deadline is not null and paid_tip_id = current_setting('t.tip7')::uuid
           from public.bounty_details(array[current_setting('t.b7')::uuid])), 'bounty_details: deadline and tip');
select is((select pay_deadline from public.bounty_details(array[current_setting('t.b6')::uuid])), null, 'no deadline before marking');
select is((select count(*)::int from public.bounty_details(array[current_setting('t.b5')::uuid])), 0, 'deleted bounty messages are not in bounty_details');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).paid), 2, 'record: paid');
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).unpaid), 2, 'record: unpaid');
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).paid_late), 0, 'record: paid_late');
select is((select count(*)::int from public.member_unpaid_bounties(current_setting('t.a')::uuid)), 2, 'unpaid list');
select ok((select bool_and(amount_text = '10000000' and token = 'USDC') from public.member_unpaid_bounties(current_setting('t.a')::uuid)), 'unpaid list rows');
select tests.clear_authentication();

-- ===== visibility (review focus 5) =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.bh', tests.bounty(current_setting('t.hid'))::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.rh', tests.post(current_setting('t.hid')::uuid, tests.td('hidden solution'), current_setting('t.bh')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.mark_bounty_solution(current_setting('t.bh')::uuid, current_setting('t.rh')::uuid);
select tests.clear_authentication();
update public.bounties set solution_marked_at = now() - interval '9 days' where message_id = current_setting('t.bh')::uuid;
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).unpaid), 3, 'a viewer with access counts the hidden-channel bounty');
select tests.authenticate_as(current_setting('t.uv')::uuid);
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).unpaid), 2, 'a viewer without VIEW does not count it');
select is((select count(*)::int from public.member_unpaid_bounties(current_setting('t.a')::uuid)), 2, 'nor list it');
select is((select count(*)::int from public.bounty_details(array[current_setting('t.bh')::uuid])), 0, 'nor read its details');
select tests.clear_authentication();

-- ===== F3c-R3: no second payment while one is creditable =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.b9', tests.bounty(current_setting('t.ch'))::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r9', tests.post(current_setting('t.ch')::uuid, tests.td('solution 9'), current_setting('t.b9')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.mark_bounty_solution(current_setting('t.b9')::uuid, current_setting('t.r9')::uuid);
select set_config('t.i9', public.create_bounty_payment_intent(current_setting('t.b9')::uuid, 84532, 10000000)::text, true);
select is(public.create_bounty_payment_intent(current_setting('t.b9')::uuid, 84532, 20000000), current_setting('t.i9')::jsonb,
  'a live hashless intent is returned unchanged, new amount ignored');
select is((select count(*)::int from public.payment_intents where purpose = 'bounty' and target_id = current_setting('t.b9')::uuid), 1,
  'no second intent row was created');
-- i9 carries a legacy fee: a missing fee hash must still block a new intent
select tests.clear_authentication();
select tests.simulate_fee(current_setting('t.i9')::jsonb ->> 'id', 100);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.attach_intent_tx((current_setting('t.i9')::jsonb ->> 'id')::uuid, 'main', tests.hash(91));
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b9')::uuid, 84532, 10000000)$$, 'P0001', 'payment_in_progress',
  'one hash attached (fee hash missing) already blocks a new intent');
select public.attach_intent_tx((current_setting('t.i9')::jsonb ->> 'id')::uuid, 'fee', tests.hash(92));
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b9')::uuid, 84532, 10000000)$$, 'P0001', 'payment_in_progress',
  'both hashes attached blocks a new intent');
-- expired but both hashes were attached before expiry, inside 7 days: still creditable
select tests.clear_authentication();
update public.payment_intents set created_at = now() - interval '3 hours', expires_at = now() - interval '1 hour',
  hashes_attached_at = now() - interval '2 hours' where id = (current_setting('t.i9')::jsonb ->> 'id')::uuid;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b9')::uuid, 84532, 10000000)$$, 'P0001', 'payment_in_progress',
  'an expired intent that is still creditable (F3b-R2) blocks a new intent');
-- no longer creditable: older than 7 days
select tests.clear_authentication();
update public.payment_intents set created_at = now() - interval '8 days', expires_at = now() - interval '7 days',
  hashes_attached_at = now() - interval '7 days' - interval '1 hour' where id = (current_setting('t.i9')::jsonb ->> 'id')::uuid;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok($$select public.create_bounty_payment_intent(tests.cfg('t.b9')::uuid, 84532, 10000000)$$,
  'a dead intent (past the 7-day late-credit window) does not block a new one');
-- a hashless intent that expired is not returned and does not block
select tests.clear_authentication();
update public.payment_intents set expires_at = now() - interval '1 minute', created_at = now() - interval '25 hours'
  where purpose = 'bounty' and target_id = current_setting('t.b9')::uuid and main_tx_hash is null;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select isnt(public.create_bounty_payment_intent(current_setting('t.b9')::uuid, 84532, 10000000) ->> 'id', null, 'an expired hashless intent is replaced by a new one');
select is((select count(*)::int from public.payment_intents where purpose = 'bounty' and target_id = current_setting('t.b9')::uuid), 3,
  'three intent rows for b9 in total');
select tests.clear_authentication();

-- ===== F3c-R4: paid_at is the block timestamp =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.b10', tests.bounty(current_setting('t.ch'))::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r10', tests.post(current_setting('t.ch')::uuid, tests.td('solution 10'), current_setting('t.b10')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.mark_bounty_solution(current_setting('t.b10')::uuid, current_setting('t.r10')::uuid);
select set_config('t.i10', public.create_bounty_payment_intent(current_setting('t.b10')::uuid, 84532, 10000000)::text, true);
select public.attach_intent_tx((current_setting('t.i10')::jsonb ->> 'id')::uuid, 'main', tests.hash(101));
select tests.clear_authentication();
-- marked 8 days ago; the intent was created 2 days ago (expired, but creditable under F3b-R2); the transfer was mined
-- 1 hour after the intent, i.e. 6 days + 23 hours after marking
update public.bounties set solution_marked_at = now() - interval '8 days' where message_id = current_setting('t.b10')::uuid;
update public.payment_intents set created_at = now() - interval '2 days', expires_at = now() - interval '1 day',
  hashes_attached_at = now() - interval '47 hours' where id = (current_setting('t.i10')::jsonb ->> 'id')::uuid;
set local role service_role;
select throws_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, null)$$, current_setting('t.i10')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(101), 'logIndex', 1, 'blockNumber', 700)), 'P0001', 'invalid_input',
  'a missing blockTimestamp is refused');
select throws_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, null)$$, current_setting('t.i10')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(101), 'logIndex', 1, 'blockNumber', 700, 'blockTimestamp', 'yesterday')), 'P0001', 'invalid_input',
  'a malformed blockTimestamp is refused');
select throws_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, null)$$, current_setting('t.i10')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(101), 'logIndex', 1, 'blockNumber', 700, 'blockTimestamp', now() - interval '2 days' - interval '3 minutes')),
  'P0001', 'tx_mismatch', 'a timestamp before the intent (minus 120 s) is a mismatch');
select lives_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, null)$$, current_setting('t.i10')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(101), 'logIndex', 1, 'blockNumber', 700,
    'blockTimestamp', to_char((now() - interval '1 day' - interval '23 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
  'confirm 8 days after marking with an ISO block time inside the window');
reset role;
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.b10')::uuid), 'paid',
  'paid_at is the block time, so the status is paid and not paid_late');
select ok((select paid_at < solution_marked_at + interval '7 days' and paid_at < now() - interval '1 day' from public.bounties
  where message_id = current_setting('t.b10')::uuid), 'paid_at is not the confirm time');

-- ===== F3c Task 3: a block timestamp ahead of the database clock is clamped to now() =====
reset role;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.b11', tests.bounty(current_setting('t.ch'))::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r11', tests.post(current_setting('t.ch')::uuid, tests.td('solution 11'), current_setting('t.b11')::uuid)::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select public.mark_bounty_solution(current_setting('t.b11')::uuid, current_setting('t.r11')::uuid);
select set_config('t.i11', public.create_bounty_payment_intent(current_setting('t.b11')::uuid, 84532, 10000000)::text, true);
select public.attach_intent_tx((current_setting('t.i11')::jsonb ->> 'id')::uuid, 'main', tests.hash(111));
select tests.clear_authentication();
set local role service_role;
select lives_ok(format($$select public.confirm_bounty_payment(%L, %L::jsonb, null)$$, current_setting('t.i11')::jsonb ->> 'id',
  jsonb_build_object('txHash', tests.hash(111), 'logIndex', 1, 'blockNumber', 710,
    'blockTimestamp', to_char((now() + interval '10 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
  'a block time a few minutes ahead of the database clock is accepted');
reset role;
select is((select paid_at from public.bounties where message_id = current_setting('t.b11')::uuid), now(),
  'paid_at is clamped to now()');

select * from finish();
rollback;
