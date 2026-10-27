begin;
select plan(83);

-- ===== privileges =====
select ok(not has_function_privilege('anon', 'public.channel_lock_state(uuid)', 'execute'), 'anon cannot channel_lock_state');
select ok(not has_function_privilege('anon', 'public.locked_channels()', 'execute'), 'anon cannot locked_channels');
select ok(not has_function_privilege('anon', 'public.set_channel_gate(uuid,numeric,text)', 'execute'), 'anon cannot set_channel_gate');
select ok(has_function_privilege('authenticated', 'public.channel_lock_state(uuid)', 'execute'), 'authenticated can channel_lock_state');
select ok(has_function_privilege('authenticated', 'public.locked_channels()', 'execute'), 'authenticated can locked_channels');
select ok(has_function_privilege('authenticated', 'public.set_channel_gate(uuid,numeric,text)', 'execute'), 'authenticated can set_channel_gate');
select ok(not has_function_privilege('authenticated', 'public.gate_passes(uuid,uuid,text)', 'execute'), 'authenticated cannot gate_passes (oracle)');
select ok(not has_function_privilege('authenticated', 'public._channel_permissions_core(uuid,uuid,boolean)', 'execute'), 'authenticated cannot the permissions core (oracle)');
select ok(not has_function_privilege('anon', 'public._channel_permissions_core(uuid,uuid,boolean)', 'execute'), 'anon cannot the permissions core');

-- ===== schema =====
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'channels' and column_name in ('gate_mode', 'gate_value')), 'gate_mode/gate_value are gone');
select has_column('public', 'channels', 'gate_min_donated_usd6', 'the gate is one column: the minimum donated, in usd6');
select throws_ok($$update public.channels set gate_min_donated_usd6 = -1 where kind = 'category'$$, '23514', null, 'a negative minimum donated is rejected');
select is((select count(*)::int from public.channels where gate_min_share_bps is not null or gate_min_net_usdc is not null), 0,
  'the legacy share and net columns were cleared by the migration');

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x00000000000000000000000000000000008100a1', null, true)::text, true);
select set_config('t.d', tests.create_member('0x00000000000000000000000000000000008100a2', current_setting('t.a')::uuid)::text, true);
select set_config('t.p', tests.create_member('0x00000000000000000000000000000000008100a3', current_setting('t.a')::uuid)::text, true);
select set_config('t.q', tests.create_member('0x00000000000000000000000000000000008100a4', current_setting('t.a')::uuid)::text, true);
select set_config('t.r', tests.create_member('0x00000000000000000000000000000000008100a5', current_setting('t.a')::uuid)::text, true);
select set_config('t.s', tests.create_member('0x00000000000000000000000000000000008100a6', current_setting('t.a')::uuid)::text, true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ud', (select auth_user_id::text from public.members where id = current_setting('t.d')::uuid), true);
select set_config('t.up', (select auth_user_id::text from public.members where id = current_setting('t.p')::uuid), true);
select set_config('t.us', (select auth_user_id::text from public.members where id = current_setting('t.s')::uuid), true);

-- d: a delegate with MANAGE_CHANNELS (128) only
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T810 gestor', '#AAAAAA', 50, 128);
insert into public.member_roles (member_id, role_id) select current_setting('t.d')::uuid, id from public.roles where name = 'T810 gestor';

select set_config('t.cat', tests.create_channel(null, 'category', 'T810cat')::text, true);
select set_config('t.chS', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'share')::text, true);
select set_config('t.chN', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'net')::text, true);
select set_config('t.chB', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'both')::text, true);
select set_config('t.chP', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'post')::text, true);
select set_config('t.chH', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'hidden')::text, true);
select set_config('t.chO', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'open')::text, true);
select set_config('t.catG', tests.create_channel(null, 'category', 'T810locked')::text, true);
select set_config('t.chK', tests.create_channel(current_setting('t.catG')::uuid, 'text', 'child')::text, true);

-- chB also carries legacy values that nothing reads any more (they must not open or close the gate)
update public.channels set gate_min_donated_usd6 = 10000000, gate_scope = 'view' where id = current_setting('t.chS')::uuid;
update public.channels set gate_min_donated_usd6 = 100000000, gate_scope = 'view' where id = current_setting('t.chN')::uuid;
update public.channels set gate_min_donated_usd6 = 10000000, gate_min_share_bps = 10000, gate_min_net_usdc = 1000000000000, gate_scope = 'view'
  where id = current_setting('t.chB')::uuid;
update public.channels set gate_min_donated_usd6 = 10000000, gate_scope = 'post' where id = current_setting('t.chP')::uuid;
update public.channels set gate_min_donated_usd6 = 10000000, gate_scope = 'view' where id = current_setting('t.chH')::uuid;
update public.channels set gate_min_donated_usd6 = 10000000, gate_scope = 'view' where id = current_setting('t.catG')::uuid;
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.chH')::uuid, 'role', (select id from public.roles where is_everyone), 0, 1);

-- donated (usd6), whatever the network:
--   p: exactly 10 USD
--   q: exactly 100 USD
--   r: 9.999999 USD
--   s: nothing donated, but a big legacy DAO position (it counts for nothing)
select tests.give(current_setting('t.p')::uuid, 10000000);
select tests.give(current_setting('t.q')::uuid, 100000000);
select tests.give(current_setting('t.r')::uuid, 9999999);
update public.dao_state set total_shares = 1000000, value_usdc = 500000000 where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.s')::uuid, 900000, 900000000);

create function tests.gp(p_member text, p_channel text) returns boolean language sql as $$
  select public.gate_passes(current_setting('t.' || p_member)::uuid, current_setting('t.' || p_channel)::uuid,
    (select gate_scope from public.channels where id = current_setting('t.' || p_channel)::uuid))
$$;

-- ===== gate_passes: one rule, >= passes at the exact threshold (chS: 10 USD) =====
select is(tests.gp('p', 'chS'), true, 'exactly 10 USD donated passes');
select is(tests.gp('q', 'chS'), true, '100 USD donated passes a 10 USD gate');
select is(tests.gp('r', 'chS'), false, '9.999999 USD fails (one micro-dollar short)');
select is(tests.gp('s', 'chS'), false, 'nothing donated fails');
-- ===== a higher gate (chN: 100 USD) =====
select is(tests.gp('q', 'chN'), true, 'exactly 100 USD passes');
select is(tests.gp('r', 'chN'), false, '9.999999 USD fails a 100 USD gate');
select is(tests.gp('p', 'chN'), false, '10 USD fails a 100 USD gate');
select is(tests.gp('s', 'chN'), false, 'nothing donated fails');
-- ===== legacy share and net values are ignored (chB: 10 USD, legacy 100 % and 10^12) =====
select is(tests.gp('p', 'chB'), true, 'legacy columns do not close the gate for a donor who meets it');
select is(tests.gp('q', 'chB'), true, 'more than enough passes');
select is(tests.gp('r', 'chB'), false, 'short of the donated minimum fails');
select is(tests.gp('s', 'chB'), false, 'a DAO position does not open the gate');
-- no rule / other scope / missing channel
select is(public.gate_passes(current_setting('t.s')::uuid, current_setting('t.chO')::uuid, 'view'), true, 'ungated channel passes');
select is(public.gate_passes(current_setting('t.s')::uuid, current_setting('t.chS')::uuid, 'post'), true, 'a view gate does not answer a post question');
select is(public.gate_passes(current_setting('t.s')::uuid, gen_random_uuid(), 'view'), true, 'missing channel passes (permissions decide)');
-- a legacy DAO position never counts: s holds 90 % of the shares and still fails
select is(tests.gp('s', 'chS'), false, 'the shares of the DAO count for nothing: donations only');

-- ===== channel_permissions =====
select is(public.channel_permissions(current_setting('t.p')::uuid, current_setting('t.chS')::uuid), 8199::bigint, 'passer keeps its bits');
select is(public.channel_permissions(current_setting('t.s')::uuid, current_setting('t.chS')::uuid), 0::bigint, 'view-gate failure removes every channel bit');
select is(public.channel_permissions(current_setting('t.s')::uuid, current_setting('t.chP')::uuid), 8193::bigint, 'post-gate failure keeps VIEW, drops SEND and SEND_IN_THREADS');
select is(public.channel_permissions(current_setting('t.p')::uuid, current_setting('t.chP')::uuid), 8199::bigint, 'post-gate passer keeps SEND');
select is(public.channel_permissions(current_setting('t.s')::uuid, current_setting('t.chK')::uuid), 0::bigint, 'a view-gated category hides its children');
insert into public.member_roles (member_id, role_id) select current_setting('t.a')::uuid, id from public.roles where (permissions & 512) <> 0 and is_system limit 1;
select is(public.channel_permissions(current_setting('t.a')::uuid, current_setting('t.chS')::uuid), 228367::bigint, 'an administrator bypasses every gate');
select is(public._channel_permissions_core(current_setting('t.s')::uuid, current_setting('t.chS')::uuid, true), 8199::bigint, 'core ignoring the view gate returns the role bits');
select is(public._channel_permissions_core(current_setting('t.s')::uuid, current_setting('t.chS')::uuid, false), 0::bigint, 'core honouring the gate matches channel_permissions');
select is(public._channel_permissions_core(current_setting('t.s')::uuid, current_setting('t.chP')::uuid, true), 8193::bigint, 'ignoring the view gate does not ignore the post gate');
select is(public._channel_permissions_core(current_setting('t.s')::uuid, current_setting('t.chH')::uuid, true), 0::bigint, 'ignoring the view gate never reveals a role-hidden channel');

-- ===== leakage: a view-gate failure leaves no VIEW =====
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links, pinned_by)
  values (gen_random_uuid(), current_setting('t.chS')::uuid, current_setting('t.a')::uuid, '{"type":"doc","content":[]}'::jsonb, 'secreto zzgated', true, current_setting('t.a')::uuid);
select set_config('t.msg', (select id::text from public.messages where channel_id = current_setting('t.chS')::uuid), true);
insert into public.payment_intents (id, member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount, recipient_member_id,
  recipient_address, target_type, target_id, status)
  values (gen_random_uuid(), current_setting('t.p')::uuid, 'tip', 59141, 'USDC', 5, 0, 0, 0, current_setting('t.a')::uuid,
  '0x00000000000000000000000000000000000000aa', 'message', current_setting('t.msg')::uuid, 'confirmed');
insert into public.tips (intent_id, chain_id, from_member, to_member, target_type, message_id, token, amount, fee_amount, anonymous, main_tx_hash, block_number)
  select pi.id, 59141, current_setting('t.p')::uuid, current_setting('t.a')::uuid, 'message', current_setting('t.msg')::uuid, 'USDC', 5, 0, false,
  '0x' || repeat('8', 64), 1 from public.payment_intents pi where pi.target_id = current_setting('t.msg')::uuid;

select tests.authenticate_as(current_setting('t.up')::uuid);
select is((select count(*)::int from public.messages where channel_id = current_setting('t.chS')::uuid), 1, 'positive control: the passer reads the message');
select is((select count(*)::int from public.messages where channel_id = current_setting('t.chS')::uuid and pinned_by is not null), 1, 'positive control: the passer reads the pin');
select is((select count(*)::int from public.search_messages('zzgated')), 1, 'positive control: the passer finds it in search');
select is((select count(*)::int from public.tips_summary(array[current_setting('t.msg')::uuid])), 1, 'positive control: the passer sees the tip summary');
select is((select count(*)::int from public.visible_channels() where id = current_setting('t.chS')::uuid), 1, 'positive control: the passer sees the channel');
select tests.authenticate_as(current_setting('t.us')::uuid);
select is((select count(*)::int from public.messages where channel_id = current_setting('t.chS')::uuid), 0, 'failing member: messages RLS returns nothing');
select is((select count(*)::int from public.messages where channel_id = current_setting('t.chS')::uuid and pinned_by is not null), 0, 'failing member: no pins');
select is((select count(*)::int from public.search_messages('zzgated')), 0, 'failing member: search returns nothing');
select is((select count(*)::int from public.tips_summary(array[current_setting('t.msg')::uuid])), 0, 'failing member: tips_summary returns nothing');
select is((select count(*)::int from public.visible_channels() where id = current_setting('t.chS')::uuid), 0, 'failing member: not in visible_channels');

-- ===== channel_lock_state =====
select is((public.channel_lock_state(current_setting('t.chS')::uuid) ->> 'scope'), 'view', 'lock state: view scope');
select is(public.channel_lock_state(current_setting('t.chB')::uuid),
  jsonb_build_object('scope', 'view', 'minDonatedUsd6', '10000000', 'myDonatedUsd6', '0',
    'name', 'both', 'kind', 'text', 'parentId', current_setting('t.cat')::uuid,
    'requirements', jsonb_build_array(jsonb_build_object('channelId', current_setting('t.chB')::uuid, 'scope', 'view',
      'minDonatedUsd6', '10000000'))),
  'lock state carries exactly the requirement, what the member donated and name/kind/parent');
select is((select array_agg(k order by k) from jsonb_object_keys(public.channel_lock_state(current_setting('t.chS')::uuid)) k),
  array['kind','minDonatedUsd6','myDonatedUsd6','name','parentId','requirements','scope'], 'lock state exposes no other key');
select is((public.channel_lock_state(current_setting('t.chP')::uuid) ->> 'scope'), 'post', 'post-gate failure: scope post');
select is(public.channel_lock_state(current_setting('t.chO')::uuid), null::jsonb, 'open channel: null');
select is(public.channel_lock_state(current_setting('t.chH')::uuid), null::jsonb, 'role-hidden channel: null (no leak of its existence)');
select is(public.channel_lock_state(gen_random_uuid()), null::jsonb, 'unknown channel: null');
select tests.authenticate_as(current_setting('t.up')::uuid);
select is(public.channel_lock_state(current_setting('t.chS')::uuid), null::jsonb, 'passer: null on the view gate');
select is(public.channel_lock_state(current_setting('t.chP')::uuid), null::jsonb, 'passer: null on the post gate');
select tests.clear_authentication();
select is(public.channel_lock_state(current_setting('t.chS')::uuid), null::jsonb, 'no session: null');

-- ===== locked_channels =====
select tests.authenticate_as(current_setting('t.us')::uuid);
select is((select array_agg(name order by name) from public.locked_channels()), array['both','child','net','share','T810locked']::text[],
  'lists exactly the view-gated channels the member would see, children of a locked category included');
select is((select count(*)::int from public.locked_channels() where id = current_setting('t.chH')::uuid), 0, 'role-hidden gated channel is not listed');
select is((select count(*)::int from public.locked_channels() where id = current_setting('t.chP')::uuid), 0, 'post-gated channel is not listed (it is readable)');
select is((select array_agg(k order by k) from jsonb_object_keys((select to_jsonb(l) from public.locked_channels() l limit 1)) k),
  array['id','kind','name','parent_id','position','scope'], 'locked_channels exposes only id, parent, kind, name, position, scope');
select tests.authenticate_as(current_setting('t.up')::uuid);
select is((select array_agg(name order by name) from public.locked_channels()), array['net']::text[],
  'a member passing some gates sees only the ones that still lock it');
select tests.clear_authentication();
select is((select count(*)::int from public.locked_channels()), 0, 'no session: nothing');

-- ===== network switch: donations add up over every network, so the active chain changes nothing =====
update public.app_config set value = '59144'::jsonb where key = 'active_chain_id';
select is(tests.gp('r', 'chS'), false, 'chain 59144: r still fails with 9.999999 USD');
select is(tests.gp('p', 'chS'), true, 'chain 59144: p still passes with 10 USD');
select tests.authenticate_as(current_setting('t.us')::uuid);
select is(public.channel_lock_state(current_setting('t.chS')::uuid) ->> 'myDonatedUsd6', '0', 'lock state shows what the member donated, on any network');
select tests.clear_authentication();
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
select is(tests.gp('p', 'chS'), true, 'back on 59141 p passes the same');

-- ===== set_channel_gate =====
select tests.authenticate_as(current_setting('t.us')::uuid);
select throws_ok($$select public.set_channel_gate(current_setting('t.chO')::uuid, 50, 'view')$$, 'P0001', 'forbidden', 'without MANAGE_CHANNELS: forbidden');
select tests.authenticate_as(current_setting('t.ud')::uuid);
select throws_ok($$select public.set_channel_gate(current_setting('t.chH')::uuid, 50, 'view')$$, 'P0001', 'forbidden', 'delegate cannot act on a channel it cannot see');
select throws_ok($$select public.set_channel_gate(current_setting('t.chO')::uuid, -5, 'view')$$, 'P0001', 'invalid_input', 'negative amount: invalid_input');
select throws_ok($$select public.set_channel_gate(current_setting('t.chO')::uuid, 1.5, 'view')$$, 'P0001', 'invalid_input', 'fractional amount: invalid_input');
select throws_ok($$select public.set_channel_gate(current_setting('t.chO')::uuid, 1000000000000000000000000000001::numeric, 'view')$$, 'P0001', 'invalid_input', 'amount above 10^30: invalid_input');
select throws_ok($$select public.set_channel_gate(current_setting('t.chO')::uuid, 50, 'edit')$$, 'P0001', 'invalid_input', 'unknown scope: invalid_input');
select throws_ok($$select public.set_channel_gate(gen_random_uuid(), 50, 'view')$$, 'P0001', 'invalid_input', 'unknown channel: invalid_input');
select throws_ok($$select public.set_channel_gate(null, 50, 'view')$$, 'P0001', 'invalid_input', 'null channel: invalid_input');
select lives_ok($$select public.set_channel_gate(current_setting('t.chO')::uuid, 5000000, 'post')$$, 'delegate sets the minimum donated');
select tests.clear_authentication();
select is((select gate_min_donated_usd6::text || '/' || gate_scope from public.channels where id = current_setting('t.chO')::uuid),
  '5000000/post', 'the rule was written');
select is((select payload ->> 'minDonatedUsd6' from public.audit_log where action = 'channel_gate_set' and target_id = current_setting('t.chO')::uuid), '5000000', 'an audit row was written');
select tests.authenticate_as(current_setting('t.ud')::uuid);
select lives_ok($$select public.set_channel_gate(current_setting('t.chO')::uuid, null, null)$$, 'a null amount clears the rule');
select tests.clear_authentication();
select is((select gate_min_donated_usd6 is null from public.channels where id = current_setting('t.chO')::uuid), true, 'the rule is null again');
select is((select count(*)::int from public.audit_log where action = 'channel_gate_set' and target_id = current_setting('t.chO')::uuid), 2, 'the clearing was audited too');

select * from finish();
rollback;
