begin;
select plan(34);

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.post(p_ch uuid, p_body jsonb, p_root uuid default null, p_quoted uuid default null)
returns uuid language sql as $$
  select public.post_message(p_ch, p_body, 'x', false, p_root, p_quoted, '[]'::jsonb)
$$;
create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
-- the RPCs no longer charge a fee (P0-R5); confirm_tip still handles one, so a legacy fee intent is simulated here
create function tests.simulate_fee(p_intent uuid, p_bps int) returns void language sql security definer set search_path = '' as $$
  update public.payment_intents
  set fee_bps = p_bps, fee_amount = div(amount * p_bps + 9999, 10000), platform_address = '0x' || lpad('f00', 40, '0')
  where id = p_intent
$$;
-- creates an intent on Base Sepolia as the donor (with a simulated legacy fee when p_bps > 0) and attaches a main hash
-- (and a fee hash when p_fee > 0); returns the intent id
create function tests.intent(p_msg text, p_bps int, p_main int, p_fee int default 0) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := (public.create_tip_intent('message', p_msg::uuid, 84532, 'USDC', 10000000, false) ->> 'id')::uuid;
  if p_bps > 0 then perform tests.simulate_fee(v_id, p_bps); end if;
  if p_main > 0 then perform public.attach_intent_tx(v_id, 'main', tests.hash(p_main)); end if;
  if p_fee > 0 then perform public.attach_intent_tx(v_id, 'fee', tests.hash(p_fee)); end if;
  return v_id;
end;
$$;

select set_config('t.a', tests.create_member('0x' || lpad('d6100', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('d6101', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.mod', tests.create_member('0x' || lpad('d6102', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.umod', (select auth_user_id::text from public.members where id = current_setting('t.mod')::uuid), true);
update public.members set handle = 'donorx' where id = current_setting('t.a')::uuid;
update public.members set handle = 'recipx' where id = current_setting('t.b')::uuid;
insert into public.roles (name, color, position, permissions) values ('T610 mods', '#AAAAAA', 63, 8);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.mod')::uuid, id from public.roles where name = 'T610 mods';
select set_config('t.cat', tests.create_channel(null, 'category', 'T610cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't610')::text, true);

select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.m1', tests.post(current_setting('t.ch')::uuid, tests.td('root one'))::text, true);
select set_config('t.m3', tests.post(current_setting('t.ch')::uuid, tests.td('root three'))::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);

-- two confirmed tips on m1 -> notices n1, n2
select set_config('t.i1', tests.intent(current_setting('t.m1'), 0, 1)::text, true);
select set_config('t.i2', tests.intent(current_setting('t.m1'), 0, 2)::text, true);
select tests.clear_authentication();
set local role service_role;
select set_config('t.tip1', public.confirm_tip(current_setting('t.i1')::uuid,
  jsonb_build_object('txHash', tests.hash(1), 'logIndex', 0, 'blockNumber', 1), null)::text, true);
select set_config('t.tip2', public.confirm_tip(current_setting('t.i2')::uuid,
  jsonb_build_object('txHash', tests.hash(2), 'logIndex', 0, 'blockNumber', 1), null)::text, true);
reset role;
select set_config('t.n1', (select id::text from public.messages where tip_id = current_setting('t.tip1')::uuid), true);
select set_config('t.n2', (select id::text from public.messages where tip_id = current_setting('t.tip2')::uuid), true);

-- ===== m5: camelCase data keys =====
select is((select (n.data ? 'tipId')::text || (n.data ? 'messageId')::text || (n.data ? 'threadRootId')::text
  || (n.data ? 'thread_root_id')::text from public.notifications n where n.data ->> 'tipId' = current_setting('t.tip1')),
  'truetruetruefalse', 'tip notification data uses camelCase keys');
select ok((select p.url like '%?thread=' || current_setting('t.m1') from public._push_build(
  (select n.id from public.notifications n where n.data ->> 'tipId' = current_setting('t.tip1'))) p),
  'the push url deep-links to the thread root');

-- ===== m6: quoting a notice =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($$select tests.post(%L, tests.td('quoting'), null, %L)$$, current_setting('t.ch'), current_setting('t.n2')),
  'a notice can be quoted');
select is((select count(*)::int from public.notifications n where n.kind = 'reply'), 0, 'quoting a notice notifies nobody');

-- ===== C1: deleting a system notice =====
select throws_ok(format($$select public.delete_message(%L)$$, current_setting('t.n1')), 'P0001', 'forbidden',
  'a plain viewer cannot delete a notice');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($$select public.delete_message(%L)$$, current_setting('t.n1')), 'P0001', 'forbidden',
  'the tip recipient cannot delete the notice either');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where id = current_setting('t.n1')::uuid), 1, 'the notice is still there');
select tests.authenticate_as(current_setting('t.umod')::uuid);
select lives_ok(format($$select public.delete_message(%L)$$, current_setting('t.n1')), 'a moderator deletes the notice');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where id = current_setting('t.n1')::uuid), 0, 'the notice is gone');
select is((select count(*)::int from public.audit_log where action = 'message_deleted' and target_id = current_setting('t.n1')::uuid
  and actor_member_id = current_setting('t.mod')::uuid), 1, 'the moderator delete is audited');
select is((select reply_count from public.messages where id = current_setting('t.m1')::uuid), 1,
  'reply_count follows the deletion');

-- ===== I2: confirm_tip hash checks =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.i3', tests.intent(current_setting('t.m1'), 100, 3)::text, true);   -- fee intent, main hash only
select is((select hashes_attached_at is null from public.payment_intents where id = current_setting('t.i3')::uuid), true,
  'hashes_attached_at stays null until the fee hash arrives');
select set_config('t.i4', tests.intent(current_setting('t.m1'), 0, 4)::text, true);     -- no-fee intent
select tests.clear_authentication();
set local role service_role;
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, %L::jsonb)$$, current_setting('t.i3'),
  jsonb_build_object('txHash', tests.hash(3), 'logIndex', 0, 'blockNumber', 1), jsonb_build_object('logIndex', 0)),
  'P0001', 'tx_mismatch', 'fee intent without an attached fee hash: fee without txHash is a mismatch');
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, %L::jsonb)$$, current_setting('t.i3'),
  jsonb_build_object('txHash', tests.hash(3), 'logIndex', 0, 'blockNumber', 1),
  '{"txHash":null,"logIndex":0,"blockNumber":1}'),
  'P0001', 'tx_mismatch', 'fee intent without an attached fee hash: null fee txHash is a mismatch');
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, %L::jsonb)$$, current_setting('t.i3'),
  jsonb_build_object('txHash', tests.hash(3), 'logIndex', 0, 'blockNumber', 1),
  jsonb_build_object('txHash', tests.hash(30), 'logIndex', 1, 'blockNumber', 1)),
  'P0001', 'tx_mismatch', 'fee intent without an attached fee hash: any fee hash is a mismatch');
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, null)$$, current_setting('t.i3'),
  jsonb_build_object('txHash', tests.hash(3), 'logIndex', 0, 'blockNumber', 1)),
  'P0001', 'tx_mismatch', 'fee intent confirmed without p_fee is a mismatch');
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, %L::jsonb)$$, current_setting('t.i4'),
  jsonb_build_object('txHash', tests.hash(4), 'logIndex', 0, 'blockNumber', 1),
  jsonb_build_object('txHash', tests.hash(40), 'logIndex', 1, 'blockNumber', 1)),
  'P0001', 'tx_mismatch', 'a no-fee intent must not carry a fee transfer');
select throws_ok(format($$select public.confirm_tip(%L, '{"logIndex":0,"blockNumber":1}'::jsonb, null)$$, current_setting('t.i4')),
  'P0001', 'invalid_input', 'a main transfer without txHash is invalid');
reset role;
select is((select count(*)::int from public.tips), 2, 'none of the bad confirmations credited anything');
select is((select status from public.payment_intents where id = current_setting('t.i3')::uuid), 'pending', 'the fee intent is still pending');

-- ===== R2: signed before expiry still credits =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.i5', tests.intent(current_setting('t.m1'), 0, 5)::text, true);
select set_config('t.i6', tests.intent(current_setting('t.m1'), 0, 6)::text, true);
select set_config('t.i7', tests.intent(current_setting('t.m1'), 0, 7)::text, true);
select tests.clear_authentication();
select ok((select hashes_attached_at is not null from public.payment_intents where id = current_setting('t.i5')::uuid),
  'attaching the last required hash stamps hashes_attached_at');
-- i5: hashes attached before expiry
update public.payment_intents set expires_at = now() - interval '1 minute', hashes_attached_at = now() - interval '2 minutes'
  where id = current_setting('t.i5')::uuid;
-- i6: hashes attached after expiry
update public.payment_intents set expires_at = now() - interval '1 minute' where id = current_setting('t.i6')::uuid;
-- i7: attached before expiry but created more than 7 days ago
update public.payment_intents set expires_at = now() - interval '1 minute', hashes_attached_at = now() - interval '2 minutes',
  created_at = now() - interval '8 days' where id = current_setting('t.i7')::uuid;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok(format($$select public.attach_intent_tx(%L, 'main', %L)$$, current_setting('t.i6'), tests.hash(66)),
  'P0001', 'intent_expired', 'attach still refuses expired intents');
select tests.clear_authentication();
set local role service_role;
select lives_ok(format($$select public.confirm_tip(%L, %L::jsonb, null)$$, current_setting('t.i5'),
  jsonb_build_object('txHash', tests.hash(5), 'logIndex', 0, 'blockNumber', 1)), 'an intent signed before expiry is credited late');
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, null)$$, current_setting('t.i6'),
  jsonb_build_object('txHash', tests.hash(6), 'logIndex', 0, 'blockNumber', 1)),
  'P0001', 'intent_expired', 'hashes attached after expiry cannot be credited');
select throws_ok(format($$select public.confirm_tip(%L, %L::jsonb, null)$$, current_setting('t.i7'),
  jsonb_build_object('txHash', tests.hash(7), 'logIndex', 0, 'blockNumber', 1)),
  'P0001', 'intent_expired', 'late credit stops 7 days after creation');
reset role;
select is((select status from public.payment_intents where id = current_setting('t.i5')::uuid), 'confirmed', 'the late intent is confirmed');

-- ===== m2: deleted target =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.i8', tests.intent(current_setting('t.m3'), 0, 8)::text, true);
select tests.clear_authentication();
update public.messages set deleted_at = now() where id = current_setting('t.m3')::uuid;
set local role service_role;
select set_config('t.tip8', public.confirm_tip(current_setting('t.i8')::uuid,
  jsonb_build_object('txHash', tests.hash(8), 'logIndex', 0, 'blockNumber', 1), null)::text, true);
reset role;
select ok(exists (select 1 from public.tips where id = current_setting('t.tip8')::uuid), 'the tip is credited although the message was deleted');
select is((select count(*)::int from public.messages where tip_id = current_setting('t.tip8')::uuid), 0, 'no notice for a deleted message');
select is((select n.message_id::text from public.notifications n where n.data ->> 'tipId' = current_setting('t.tip8')), null,
  'the notification has no message_id');
select is((select n.data ->> 'messageId' from public.notifications n where n.data ->> 'tipId' = current_setting('t.tip8')),
  current_setting('t.m3'), 'the notification keeps the tipped message in data.messageId');

-- ===== m6: fail_intent on a non-pending intent =====
set local role service_role;
select public.fail_intent(current_setting('t.i1')::uuid, 'tx_failed');
reset role;
select is((select status || '/' || coalesce(failure_code, 'null') from public.payment_intents where id = current_setting('t.i1')::uuid),
  'confirmed/null', 'fail_intent leaves a confirmed intent alone');
set local role service_role;
select public.fail_intent(current_setting('t.i4')::uuid, 'tx_failed');
select public.fail_intent(current_setting('t.i4')::uuid, 'tx_mismatch');
reset role;
select is((select failure_code from public.payment_intents where id = current_setting('t.i4')::uuid), 'tx_failed',
  'a failed intent keeps its first failure code');

-- ===== P0-R5: no fee, whatever min_fee_bps says =====
update public.app_config set value = '100'::jsonb where key = 'min_fee_bps';
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.i9', public.create_tip_intent('message', current_setting('t.m1')::uuid, 84532, 'USDC', 10000000, false)::text, true);
select is((current_setting('t.i9')::jsonb ->> 'feeAmount'), '0', 'a leftover min_fee_bps charges no fee');
select tests.clear_authentication();
select is((select fee_bps || '/' || min_fee_bps from public.payment_intents where id = (current_setting('t.i9')::jsonb ->> 'id')::uuid),
  '0/0', 'the intent stores fee_bps and min_fee_bps 0');

select * from finish();
rollback;
