begin;
select plan(14);

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x00000000000000000000000000000000008300a1', null, true)::text, true);
select set_config('t.d', tests.create_member('0x00000000000000000000000000000000008300a2', current_setting('t.a')::uuid)::text, true);
select set_config('t.q', tests.create_member('0x00000000000000000000000000000000008300a3', current_setting('t.a')::uuid)::text, true);
select set_config('t.s', tests.create_member('0x00000000000000000000000000000000008300a4', current_setting('t.a')::uuid)::text, true);
select set_config('t.ud', (select auth_user_id::text from public.members where id = current_setting('t.d')::uuid), true);
select set_config('t.uq', (select auth_user_id::text from public.members where id = current_setting('t.q')::uuid), true);
select set_config('t.us', (select auth_user_id::text from public.members where id = current_setting('t.s')::uuid), true);

-- d: a delegate with MANAGE_CHANNELS (128) only, holding no position
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T830 gestor', '#AAAAAA', 50, 128);
insert into public.member_roles (member_id, role_id) select current_setting('t.d')::uuid, id from public.roles where name = 'T830 gestor';

-- outer category gated by share (5 %), inner channel gated by net (50 USDC), a post-gated sibling under the category
select set_config('t.cat', tests.create_channel(null, 'category', 'T830outer')::text, true);
select set_config('t.mid', tests.create_channel(current_setting('t.cat')::uuid, 'forum', 'T830mid')::text, true);
select set_config('t.inn', tests.create_channel(current_setting('t.mid')::uuid, 'text', 'T830inner')::text, true);
select set_config('t.pc', tests.create_channel(null, 'category', 'T830postcat')::text, true);
select set_config('t.pf', tests.create_channel(current_setting('t.pc')::uuid, 'forum', 'T830postforum')::text, true);
select set_config('t.pst', tests.create_channel(current_setting('t.pf')::uuid, 'text', 'T830post')::text, true);
update public.channels set gate_min_share_bps = 500, gate_scope = 'view' where id = current_setting('t.cat')::uuid;
update public.channels set gate_min_net_usdc = 50000000, gate_scope = 'view' where id = current_setting('t.inn')::uuid;
update public.channels set gate_min_share_bps = 300, gate_scope = 'post' where id = current_setting('t.pf')::uuid;
update public.channels set gate_min_net_usdc = 20000000, gate_scope = 'post' where id = current_setting('t.pst')::uuid;

-- chain 59141 (active): S = 1,000,000. q: 50 bps (fails 500), net 100 USDC (passes the inner net rule)
update public.dao_state set total_shares = 1000000, value_usdc = 500000000 where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc)
  values (59141, current_setting('t.q')::uuid, 5000, 100000000);

-- ===== every failing view gate on the path is reported =====
select tests.authenticate_as(current_setting('t.us')::uuid);
select is(jsonb_array_length(public.channel_lock_state(current_setting('t.inn')::uuid) -> 'requirements'), 2,
  'member failing both nested gates gets both requirements');
select is(public.channel_lock_state(current_setting('t.inn')::uuid) -> 'requirements',
  jsonb_build_array(
    jsonb_build_object('channelId', current_setting('t.cat')::uuid, 'scope', 'view', 'minShareBps', 500, 'minNetUsdc', null),
    jsonb_build_object('channelId', current_setting('t.inn')::uuid, 'scope', 'view', 'minShareBps', null, 'minNetUsdc', 50000000)),
  'requirements are ordered outermost first and carry channel, scope and both rules');
select is((public.channel_lock_state(current_setting('t.inn')::uuid) ->> 'minShareBps')::int, 500,
  'top-level fields keep describing the outermost failing gate');
select is(public.channel_lock_state(current_setting('t.mid')::uuid) -> 'requirements',
  jsonb_build_array(jsonb_build_object('channelId', current_setting('t.cat')::uuid, 'scope', 'view', 'minShareBps', 500, 'minNetUsdc', null)),
  'a channel with only an outer gate lists just that gate');

-- ===== a donation that meets only the outer gate still lists the inner one =====
select tests.authenticate_as(current_setting('t.uq')::uuid);
select is(public.channel_lock_state(current_setting('t.inn')::uuid) -> 'requirements',
  jsonb_build_array(jsonb_build_object('channelId', current_setting('t.cat')::uuid, 'scope', 'view', 'minShareBps', 500, 'minNetUsdc', null)),
  'a member who passes the inner net rule only lists the outer share gate');
-- raise q above the outer gate: now only the inner gate is left, and the member is still locked, not silent
select tests.clear_authentication();
update public.dao_positions set shares = 60000, net_contributed_usdc = 10000000 where member_id = current_setting('t.q')::uuid and chain_id = 59141;
select tests.authenticate_as(current_setting('t.uq')::uuid);
select is(public.channel_lock_state(current_setting('t.inn')::uuid) -> 'requirements',
  jsonb_build_array(jsonb_build_object('channelId', current_setting('t.inn')::uuid, 'scope', 'view', 'minShareBps', null, 'minNetUsdc', 50000000)),
  'meeting the outer gate leaves the inner requirement listed');
select is((public.channel_lock_state(current_setting('t.inn')::uuid) ->> 'minNetUsdc')::numeric, 50000000::numeric,
  'top-level fields now describe the remaining gate');
select tests.clear_authentication();
update public.dao_positions set shares = 60000, net_contributed_usdc = 60000000 where member_id = current_setting('t.q')::uuid and chain_id = 59141;
select tests.authenticate_as(current_setting('t.uq')::uuid);
select is(public.channel_lock_state(current_setting('t.inn')::uuid), null::jsonb, 'meeting every gate: null');

-- ===== post scope reports every failing post gate, and only those =====
select tests.authenticate_as(current_setting('t.us')::uuid);
select is(public.channel_lock_state(current_setting('t.pst')::uuid) -> 'requirements',
  jsonb_build_array(
    jsonb_build_object('channelId', current_setting('t.pf')::uuid, 'scope', 'post', 'minShareBps', 300, 'minNetUsdc', null),
    jsonb_build_object('channelId', current_setting('t.pst')::uuid, 'scope', 'post', 'minShareBps', null, 'minNetUsdc', 20000000)),
  'post scope lists both nested post gates');
select is((public.channel_lock_state(current_setting('t.pst')::uuid) ->> 'scope'), 'post', 'the scope is post');
select tests.clear_authentication();

-- ===== a MANAGE_CHANNELS delegate who fails the view gate cannot clear it =====
select tests.authenticate_as(current_setting('t.ud')::uuid);
select throws_ok($$select public.set_channel_gate(current_setting('t.cat')::uuid, null, null, null)$$, 'P0001', 'forbidden',
  'a delegate failing the view gate cannot clear it');
select throws_ok($$select public.set_channel_gate(current_setting('t.inn')::uuid, null, null, null)$$, 'P0001', 'forbidden',
  'nor a gate on a channel below a gate it fails');
select tests.clear_authentication();
select is((select gate_min_share_bps from public.channels where id = current_setting('t.cat')::uuid), 500, 'the gate is untouched');
select is((select count(*)::int from public.audit_log where action = 'channel_gate_set' and target_id in (current_setting('t.cat')::uuid, current_setting('t.inn')::uuid)), 0,
  'no audit row for the refused attempts');

select * from finish();
