-- F4a Task 2: Safe operations log, treasurer notes and unexplained-outflow alerts.
begin;
select plan(58);

-- ===== privileges / RLS =====
select ok(not has_function_privilege('anon', 'public.record_safe_operations(int,jsonb,bigint)', 'execute'), 'anon cannot record_safe_operations');
select ok(not has_function_privilege('authenticated', 'public.record_safe_operations(int,jsonb,bigint)', 'execute'), 'authenticated cannot record_safe_operations');
select ok(has_function_privilege('service_role', 'public.record_safe_operations(int,jsonb,bigint)', 'execute'), 'service_role can record_safe_operations');
select ok(not has_function_privilege('authenticated', 'public.dao_scan_from(int)', 'execute'), 'authenticated cannot dao_scan_from');
select ok(has_function_privilege('service_role', 'public.dao_scan_from(int)', 'execute'), 'service_role can dao_scan_from');
select ok(not has_function_privilege('anon', 'public.set_operation_note(uuid,text)', 'execute'), 'anon cannot set_operation_note');
select ok(has_function_privilege('authenticated', 'public.set_operation_note(uuid,text)', 'execute'), 'authenticated can set_operation_note');
select ok(not has_function_privilege('anon', 'public.dao_operations(int)', 'execute'), 'anon cannot dao_operations');
select ok(has_function_privilege('authenticated', 'public.dao_operations(int)', 'execute'), 'authenticated can dao_operations');
select ok((select relrowsecurity from pg_class where oid = 'public.dao_safe_operations'::regclass), 'dao_safe_operations has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.dao_scan_state'::regclass), 'dao_scan_state has RLS');

-- ===== helpers =====
create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.mkdon(p_user uuid, p_amount numeric, p_n int)
returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(p_user);
  v := public.create_donation_intent(p_amount, 0, true);
  perform public.attach_intent_tx((v ->> 'id')::uuid, 'main', tests.hash(p_n));
  perform tests.clear_authentication();
  return (v ->> 'id')::uuid;
end;
$$;
create function tests.rec(p_intent uuid, p_n int) returns uuid language plpgsql as $$
declare v uuid;
begin
  set local role service_role;
  v := public.record_donation(p_intent, jsonb_build_object('txHash', tests.hash(p_n), 'logIndex', 0, 'blockNumber', 100), null);
  reset role;
  return v;
end;
$$;
create function tests.rso(p_chain int, p_ops jsonb, p_to bigint) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_safe_operations(p_chain, p_ops, p_to);
  reset role;
  return v;
end;
$$;
create function tests.sf(p_chain int) returns bigint language plpgsql as $$
declare v bigint;
begin
  set local role service_role;
  v := public.dao_scan_from(p_chain);
  reset role;
  return v;
end;
$$;
create function tests.op(p_hash text, p_log int, p_asset text, p_dir text, p_amount text, p_block text default '500')
returns jsonb language sql immutable as $$
  select jsonb_build_object('txHash', p_hash, 'logIndex', p_log, 'asset', p_asset, 'direction', p_dir, 'amount', p_amount,
    'counterparty', '0x' || lpad('c0ffee', 40, '0'), 'blockNumber', p_block, 'occurredAt', '2026-10-18T10:00:00Z')
$$;
create function tests.notes(p_member uuid) returns int language sql as $$
  select count(*)::int from public.notifications n where n.kind = 'treasury_outflow' and n.recipient_id = p_member
$$;

-- ===== fixtures =====
-- a: bootstrap (no role); t: MANAGE_TREASURY; z: administrator (512); n: plain donor; x: MANAGE_TREASURY but banned
select set_config('t.a', tests.create_member('0x' || lpad('d9200', 40, '0'), null, true)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('d9201', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.z', tests.create_member('0x' || lpad('d9204', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.n', tests.create_member('0x' || lpad('d9202', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('d9203', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ut', (select auth_user_id::text from public.members where id = current_setting('t.t')::uuid), true);
select set_config('t.un', (select auth_user_id::text from public.members where id = current_setting('t.n')::uuid), true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T920 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id) select current_setting('t.t')::uuid, id from public.roles where name = 'T920 tesorero';
insert into public.member_roles (member_id, role_id) select current_setting('t.x')::uuid, id from public.roles where name = 'T920 tesorero';
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T920 admin', '#BBBBBB', 51, 512);
insert into public.member_roles (member_id, role_id) select current_setting('t.z')::uuid, id from public.roles where name = 'T920 admin';
update public.members set status = 'banned' where id = current_setting('t.x')::uuid;
update public.app_config set value = to_jsonb(59141) where key = 'active_chain_id';
update public.chain_config set safe_address = '0x' || lpad('5afe59141', 40, '0'), platform_wallet = '0x' || lpad('f00', 40, '0') where chain_id = 59141;

-- a donation whose tx hash the USDC inflow will match
select set_config('t.led', tests.rec(tests.mkdon(current_setting('t.un')::uuid, 4000000, 9201), 9201)::text, true);
select set_config('t.expected', (select count(*)::text from public.members m
  where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0), true);

-- ===== 1. insert + alerts =====
select set_config('t.batch', jsonb_build_array(
  tests.op(tests.hash(9301), 0, 'USDC', 'out', '2500000'),
  tests.op(tests.hash(9302), 3, 'WETH', 'in', '1000000000000000000'),
  tests.op(tests.hash(9201), 0, 'USDC', 'in', '4000000'))::text, true);
select set_config('t.r1', tests.rso(59141, current_setting('t.batch')::jsonb, 777)::text, true);
select is((current_setting('t.r1')::jsonb ->> 'inserted')::int, 3, 'three operations inserted');
select is((current_setting('t.r1')::jsonb ->> 'alerts')::int, current_setting('t.expected')::int, 'one alert per treasurer for the single outflow');
select ok(current_setting('t.expected')::int >= 2, 'the fixture has at least two treasurers (role holder + administrator)');
select is(tests.notes(current_setting('t.t')::uuid), 1, 'the role holder is notified once');
select is(tests.notes(current_setting('t.z')::uuid), 1, 'the administrator is notified once');
select is(tests.notes(current_setting('t.n')::uuid), 0, 'a plain member is not notified');
select is(tests.notes(current_setting('t.x')::uuid), 0, 'a banned holder is not notified');
select is(
  (select n.data ->> 'asset' from public.notifications n where n.kind = 'treasury_outflow' and n.recipient_id = current_setting('t.t')::uuid),
  'USDC', 'data carries the asset');
select is(
  (select n.data ->> 'amount' from public.notifications n where n.kind = 'treasury_outflow' and n.recipient_id = current_setting('t.t')::uuid),
  '2500000', 'data carries the amount as text');
select is(
  (select n.data ->> 'opId' from public.notifications n where n.kind = 'treasury_outflow' and n.recipient_id = current_setting('t.t')::uuid),
  (select o.id::text from public.dao_safe_operations o where o.direction = 'out'), 'data carries the operation id');
select isnt((select o.alerted_at from public.dao_safe_operations o where o.direction = 'out'), null::timestamptz, 'alerted_at is set on the outflow');
select is((select count(*)::int from public.dao_safe_operations where alerted_at is not null), 1, 'inflows are never alerted');

-- idempotent re-send
select set_config('t.r2', tests.rso(59141, current_setting('t.batch')::jsonb, 778)::text, true);
select is((current_setting('t.r2')::jsonb ->> 'inserted')::int, 0, 're-sending inserts nothing');
select is((current_setting('t.r2')::jsonb ->> 'alerts')::int, 0, 're-sending alerts nothing');
select is(tests.notes(current_setting('t.t')::uuid), 1, 'still a single notification');

-- ===== 2. donation match =====
select is((select ledger_id from public.dao_safe_operations where tx_hash = tests.hash(9201)), current_setting('t.led')::uuid, 'the USDC inflow is linked to the donation');
select is((select count(*)::int from public.dao_safe_operations where ledger_id is null), 2, 'the other operations have no ledger link');

select set_config('t.out', (select id::text from public.dao_safe_operations where direction = 'out'), true);

-- ===== 3. public feed =====
select tests.authenticate_as(current_setting('t.un')::uuid);
select is((select count(*)::int from public.dao_operations()), 1, 'a member sees only the outflow: unnoted inflows and the donation are hidden');
select is((select explained from public.dao_operations() where direction = 'out'), false, 'the USDC outflow is unexplained');
select is((select tx_hash from public.dao_operations() where direction = 'out'), tests.hash(9301), 'outflows keep their hash');
select ok(not exists (select 1 from information_schema.parameters p
  where p.specific_schema = 'public' and p.specific_name like 'dao_operations%' and p.parameter_mode = 'OUT' and p.parameter_name ilike '%counterparty%'),
  'no counterparty column');
select is((select amount from public.dao_operations() where direction = 'out'), '2500000', 'amount is returned as text');
select tests.clear_authentication();

-- treasurer view: also the un-noted non-donation inflow, with its hash; the donation stays hidden
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is((select count(*)::int from public.dao_operations()), 2, 'a treasurer also sees the un-noted WETH inflow, not the donation');
select is((select tx_hash from public.dao_operations() where direction = 'in'), tests.hash(9302), 'a treasurer gets the inflow hash');
select tests.clear_authentication();

-- ===== 4. notes by role =====
select tests.authenticate_as(current_setting('t.un')::uuid);
select throws_ok(format($q$select public.set_operation_note(%L::uuid, 'nota')$q$, current_setting('t.out')::uuid),
  'forbidden', 'a plain member cannot write notes');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.ut')::uuid);
select public.set_operation_note(current_setting('t.out')::uuid, '  Swap a WETH aprobado en la reunión  ');
select tests.clear_authentication();
select is((select note from public.dao_safe_operations where direction = 'out'), 'Swap a WETH aprobado en la reunión', 'the note is trimmed and stored');
select is((select noted_by from public.dao_safe_operations where direction = 'out'), current_setting('t.t')::uuid, 'noted_by is the treasurer');
select is((select count(*)::int from public.audit_log where action = 'operation_noted' and actor_member_id = current_setting('t.t')::uuid), 1, 'an audit row is written');
select tests.authenticate_as(current_setting('t.un')::uuid);
select is((select explained from public.dao_operations() where direction = 'out'), true, 'after a note the outflow is explained');
select tests.clear_authentication();

-- (a)/(b): a noted inflow becomes visible to members, without its hash
select tests.authenticate_as(current_setting('t.ut')::uuid);
select public.set_operation_note((select id from public.dao_operations() where direction = 'in'), 'Producto del swap');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.un')::uuid);
select is((select count(*)::int from public.dao_operations()), 2, 'a noted inflow is listed to members');
select is((select tx_hash from public.dao_operations() where direction = 'in'), null::text, 'inflow hash is null for members');
select tests.clear_authentication();
select is((select payload ->> 'previous' from public.audit_log where action = 'operation_noted' order by id desc limit 1), null::text, 'audit keeps the previous note (none)');

-- banned treasurer is forbidden
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.x')::uuid));
select throws_ok(format($q$select public.set_operation_note(%L::uuid, 'x')$q$, current_setting('t.out')), 'forbidden', 'a banned treasurer is forbidden');
select tests.clear_authentication();

-- (c) scan before record: the inflow is stored unlinked, then record_donation links it and it stays hidden
select tests.rso(59141, jsonb_build_array(tests.op(tests.hash(9202), 0, 'USDC', 'in', '3000000')), 800);
select is((select ledger_id from public.dao_safe_operations where tx_hash = tests.hash(9202)), null::uuid, 'scanned before the donation is recorded: unlinked');
select set_config('t.led2', tests.rec(tests.mkdon(current_setting('t.un')::uuid, 3000000, 9202), 9202)::text, true);
select is((select ledger_id from public.dao_safe_operations where tx_hash = tests.hash(9202)), current_setting('t.led2')::uuid, 'record_donation links the already scanned inflow');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select is((select count(*)::int from public.dao_operations() where amount = '3000000'), 0, 'the late-linked donation is hidden even from treasurers');
select tests.clear_authentication();

-- ===== 5. note length =====
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok(format($q$select public.set_operation_note(%L::uuid, '')$q$, current_setting('t.out')::uuid),
  'invalid_input', 'an empty note is invalid');
select throws_ok(format($q$select public.set_operation_note(%L::uuid, %L)$q$, current_setting('t.out')::uuid, repeat('x', 281)),
  'invalid_input', 'a 281-character note is invalid');
select tests.clear_authentication();

-- ===== 6. scan state =====
select is((select last_block from public.dao_scan_state where chain_id = 59141), 800::bigint, 'last_block advanced');
select is(tests.sf(59141), 800::bigint, 'dao_scan_from returns it');
select is(tests.sf(59144), null::bigint, 'dao_scan_from is null for an unscanned chain');

-- ===== 7. ETH op without hash, keyed by block =====
select set_config('t.eth', jsonb_build_array(jsonb_build_object('txHash', null, 'logIndex', null, 'asset', 'ETH', 'direction', 'out',
  'amount', '10000000000000000', 'counterparty', null, 'blockNumber', '900', 'occurredAt', '2026-10-18T11:00:00Z'))::text, true);
select is((tests.rso(59141, current_setting('t.eth')::jsonb, 900) ->> 'inserted')::int, 1, 'an ETH op without hash is inserted');
select is((tests.rso(59141, current_setting('t.eth')::jsonb, 901) ->> 'inserted')::int, 0, 'and is idempotent by block');

-- ===== 8. push builder =====
select is((select title from public._push_build((select n.id from public.notifications n where n.kind = 'treasury_outflow'
  and n.recipient_id = current_setting('t.t')::uuid order by n.id limit 1))), 'Salida de la tesorería', 'push title');
select is((select url from public._push_build((select n.id from public.notifications n where n.kind = 'treasury_outflow'
  and n.recipient_id = current_setting('t.t')::uuid order by n.id limit 1))), '/dao#operaciones', 'push url (ruling F4a-R1)');
select is((select body from public._push_build((select n.id from public.notifications n where n.kind = 'treasury_outflow'
  and n.recipient_id = current_setting('t.t')::uuid order by n.id limit 1))), '2,5 USDC salió de la Safe sin explicar', 'push body');
select is((select body from public._push_build((select n.id from public.notifications n where n.kind = 'treasury_outflow'
  and n.recipient_id = current_setting('t.t')::uuid order by n.id desc limit 1))), '0,01 ETH salió de la Safe sin explicar', 'push body formats 18-decimal assets');

select * from finish();
rollback;
