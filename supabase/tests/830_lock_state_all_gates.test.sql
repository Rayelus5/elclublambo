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

-- d: a delegate with MANAGE_CHANNELS (128) only, holding no donation
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T830 gestor', '#AAAAAA', 50, 128);
insert into public.member_roles (member_id, role_id) select current_setting('t.d')::uuid, id from public.roles where name = 'T830 gestor';

-- outer category gated at 5 USD, inner channel at 50 USD; a mirrored tree (outer 50 USD, inner 5 USD);
-- and a post-gated pair under a category (3 USD, then 20 USD)
select set_config('t.cat', tests.create_channel(null, 'category', 'T830outer')::text, true);
select set_config('t.mid', tests.create_channel(current_setting('t.cat')::uuid, 'forum', 'T830mid')::text, true);
select set_config('t.inn', tests.create_channel(current_setting('t.mid')::uuid, 'text', 'T830inner')::text, true);
select set_config('t.catB', tests.create_channel(null, 'category', 'T830outerB')::text, true);
select set_config('t.innB', tests.create_channel(current_setting('t.catB')::uuid, 'text', 'T830innerB')::text, true);
select set_config('t.pc', tests.create_channel(null, 'category', 'T830postcat')::text, true);
select set_config('t.pf', tests.create_channel(current_setting('t.pc')::uuid, 'forum', 'T830postforum')::text, true);
select set_config('t.pst', tests.create_channel(current_setting('t.pf')::uuid, 'text', 'T830post')::text, true);
update public.channels set gate_min_donated_usd6 = 5000000, gate_scope = 'view' where id = current_setting('t.cat')::uuid;
update public.channels set gate_min_donated_usd6 = 50000000, gate_scope = 'view' where id = current_setting('t.inn')::uuid;
update public.channels set gate_min_donated_usd6 = 50000000, gate_scope = 'view' where id = current_setting('t.catB')::uuid;
update public.channels set gate_min_donated_usd6 = 5000000, gate_scope = 'view' where id = current_setting('t.innB')::uuid;
update public.channels set gate_min_donated_usd6 = 3000000, gate_scope = 'post' where id = current_setting('t.pf')::uuid;
update public.channels set gate_min_donated_usd6 = 20000000, gate_scope = 'post' where id = current_setting('t.pst')::uuid;

-- q has donated 10 USD: it meets the 5 USD gates and fails the 50 USD ones. s has donated nothing.
select tests.give(current_setting('t.q')::uuid, 10000000);

-- ===== every failing view gate on the path is reported =====
select tests.authenticate_as(current_setting('t.us')::uuid);
select is(jsonb_array_length(public.channel_lock_state(current_setting('t.inn')::uuid) -> 'requirements'), 2,
  'member failing both nested gates gets both requirements');
select is(public.channel_lock_state(current_setting('t.inn')::uuid) -> 'requirements',
  jsonb_build_array(
    jsonb_build_object('channelId', current_setting('t.cat')::uuid, 'scope', 'view', 'minDonatedUsd6', '5000000'),
    jsonb_build_object('channelId', current_setting('t.inn')::uuid, 'scope', 'view', 'minDonatedUsd6', '50000000')),
  'requirements are ordered outermost first and carry channel, scope and the amount (as text)');
select is(public.channel_lock_state(current_setting('t.inn')::uuid) ->> 'minDonatedUsd6', '5000000',
  'top-level fields keep describing the outermost failing gate');
select is(public.channel_lock_state(current_setting('t.mid')::uuid) -> 'requirements',
  jsonb_build_array(jsonb_build_object('channelId', current_setting('t.cat')::uuid, 'scope', 'view', 'minDonatedUsd6', '5000000')),
  'a channel with only an outer gate lists just that gate');

-- ===== a donation that meets only the inner gate still lists the outer one =====
select tests.authenticate_as(current_setting('t.uq')::uuid);
select is(public.channel_lock_state(current_setting('t.innB')::uuid) -> 'requirements',
  jsonb_build_array(jsonb_build_object('channelId', current_setting('t.catB')::uuid, 'scope', 'view', 'minDonatedUsd6', '50000000')),
  'a member who meets the inner 5 USD gate only lists the outer 50 USD gate');
-- q meets the outer 5 USD gate: only the inner 50 USD gate is left, and the member is still locked, not silent
select is(public.channel_lock_state(current_setting('t.inn')::uuid) -> 'requirements',
  jsonb_build_array(jsonb_build_object('channelId', current_setting('t.inn')::uuid, 'scope', 'view', 'minDonatedUsd6', '50000000')),
  'meeting the outer gate leaves the inner requirement listed');
select is(public.channel_lock_state(current_setting('t.inn')::uuid) ->> 'minDonatedUsd6', '50000000',
  'top-level fields now describe the remaining gate');
select tests.clear_authentication();
select tests.give(current_setting('t.q')::uuid, 50000000);
select tests.authenticate_as(current_setting('t.uq')::uuid);
select is(public.channel_lock_state(current_setting('t.inn')::uuid), null::jsonb, 'meeting every gate: null');

-- ===== post scope reports every failing post gate, and only those =====
select tests.authenticate_as(current_setting('t.us')::uuid);
select is(public.channel_lock_state(current_setting('t.pst')::uuid) -> 'requirements',
  jsonb_build_array(
    jsonb_build_object('channelId', current_setting('t.pf')::uuid, 'scope', 'post', 'minDonatedUsd6', '3000000'),
    jsonb_build_object('channelId', current_setting('t.pst')::uuid, 'scope', 'post', 'minDonatedUsd6', '20000000')),
  'post scope lists both nested post gates');
select is((public.channel_lock_state(current_setting('t.pst')::uuid) ->> 'scope'), 'post', 'the scope is post');
select tests.clear_authentication();

-- ===== a MANAGE_CHANNELS delegate who fails the view gate cannot clear it =====
select tests.authenticate_as(current_setting('t.ud')::uuid);
select throws_ok($$select public.set_channel_gate(current_setting('t.cat')::uuid, null, null)$$, 'P0001', 'forbidden',
  'a delegate failing the view gate cannot clear it');
select throws_ok($$select public.set_channel_gate(current_setting('t.inn')::uuid, null, null)$$, 'P0001', 'forbidden',
  'nor a gate on a channel below a gate it fails');
select tests.clear_authentication();
select is((select gate_min_donated_usd6 from public.channels where id = current_setting('t.cat')::uuid), 5000000::numeric, 'the gate is untouched');
select is((select count(*)::int from public.audit_log where action = 'channel_gate_set' and target_id in (current_setting('t.cat')::uuid, current_setting('t.inn')::uuid)), 0,
  'no audit row for the refused attempts');

select * from finish();
rollback;
