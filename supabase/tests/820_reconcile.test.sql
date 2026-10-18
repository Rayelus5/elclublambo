begin;
select plan(46);

-- ===== privileges =====
select ok(not has_function_privilege('anon', 'public.record_reconciliation(int,numeric,uuid)', 'execute'), 'anon cannot record_reconciliation');
select ok(not has_function_privilege('authenticated', 'public.record_reconciliation(int,numeric,uuid)', 'execute'), 'authenticated cannot record_reconciliation');
select ok(has_function_privilege('service_role', 'public.record_reconciliation(int,numeric,uuid)', 'execute'), 'service_role can record_reconciliation');
select ok(not has_function_privilege('anon', 'public.donation_missing(uuid,boolean)', 'execute'), 'anon cannot donation_missing');
select ok(not has_function_privilege('authenticated', 'public.donation_missing(uuid,boolean)', 'execute'), 'authenticated cannot donation_missing');
select ok(has_function_privilege('service_role', 'public.donation_missing(uuid,boolean)', 'execute'), 'service_role can donation_missing');
select ok((select relrowsecurity from pg_class where oid = 'public.dao_reconciliations'::regclass), 'dao_reconciliations has RLS');
select ok(not has_table_privilege('authenticated', 'public.dao_reconciliations', 'select'), 'authenticated cannot read the table directly');

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
-- one reconciliation run as the service; returns the jsonb result
create function tests.rr(p_chain int, p_onchain numeric, p_actor uuid default null)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.record_reconciliation(p_chain, p_onchain, p_actor);
  reset role;
  return v;
end;
$$;
create function tests.dm(p_ledger uuid, p_missing boolean) returns boolean language plpgsql as $$
declare v boolean;
begin
  set local role service_role;
  v := public.donation_missing(p_ledger, p_missing);
  reset role;
  return v;
end;
$$;
create function tests.notes(p_member uuid, p_chain int) returns int language sql as $$
  select count(*)::int from public.notifications n
  where n.kind = 'treasury_mismatch' and n.recipient_id = p_member and (n.data ->> 'chainId')::int = p_chain
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d8200', 40, '0'), null, true)::text, true);
select set_config('t.m', tests.create_member('0x' || lpad('d8201', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.n', tests.create_member('0x' || lpad('d8202', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('d8203', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.z', tests.create_member('0x' || lpad('d8204', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.um', (select auth_user_id::text from public.members where id = current_setting('t.n')::uuid), true);

-- m: MANAGE_TREASURY (256); n: plain (also the donor); x: MANAGE_TREASURY but banned; z: admin (512)
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T820 tesorero', '#AAAAAA', 50, 256);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T820 admin', '#BBBBBB', 51, 512);
insert into public.member_roles (member_id, role_id) select current_setting('t.m')::uuid, id from public.roles where name = 'T820 tesorero';
insert into public.member_roles (member_id, role_id) select current_setting('t.x')::uuid, id from public.roles where name = 'T820 tesorero';
insert into public.member_roles (member_id, role_id) select current_setting('t.z')::uuid, id from public.roles where name = 'T820 admin';
update public.members set status = 'banned' where id = current_setting('t.x')::uuid;
update public.chain_config set safe_address = '0x' || lpad('5afe59141', 40, '0'), platform_wallet = '0x' || lpad('f00', 40, '0') where chain_id = 59141;
update public.chain_config set safe_address = '0x' || lpad('5afe59144', 40, '0'), platform_wallet = '0x' || lpad('f00', 40, '0') where chain_id = 59144;

-- ===== zero diff: recorded, nobody notified =====
select is((tests.rr(59141, 0) ->> 'diff')::numeric, 0::numeric, 'a zero diff is recorded');
select is((select count(*)::int from public.notifications where kind = 'treasury_mismatch'), 0, 'no notification when the diff is zero');
select is((select ran_by from public.dao_reconciliations where chain_id = 59141), null::uuid, 'cron runs have no actor');

-- ===== positive diff: notifies bit-256 holders only =====
update public.dao_state set value_usdc = 5000000, total_shares = 5000000 where chain_id = 59141;
select set_config('t.r1', (tests.rr(59141, 7000000, current_setting('t.a')::uuid) ->> 'id'), true);
select is((select diff from public.dao_reconciliations where id = current_setting('t.r1')::uuid), 2000000::numeric, 'raw diff = onchain - ledger');
select is((select effective_diff from public.dao_reconciliations where id = current_setting('t.r1')::uuid), 2000000::numeric, 'effective diff equals raw with nothing pending');
select is((select ledger_value from public.dao_reconciliations where id = current_setting('t.r1')::uuid), 5000000::numeric, 'the ledger value is read from dao_state');
select is((select ran_by from public.dao_reconciliations where id = current_setting('t.r1')::uuid), current_setting('t.a')::uuid, 'the actor is stored');
select is(tests.notes(current_setting('t.m')::uuid, 59141), 1, 'the MANAGE_TREASURY holder is notified');
select is(tests.notes(current_setting('t.z')::uuid, 59141), 1, 'an admin (all bits) is notified');
select is(tests.notes(current_setting('t.n')::uuid, 59141), 0, 'a plain member is not notified');
select is(tests.notes(current_setting('t.x')::uuid, 59141), 0, 'a banned holder is not notified');
select is(
  (select n.data from public.notifications n where n.kind = 'treasury_mismatch' and n.recipient_id = current_setting('t.m')::uuid),
  jsonb_build_object('chainId', 59141, 'diff', '2000000', 'reconciliationId', current_setting('t.r1')),
  'data is { chainId, diff, reconciliationId } in camelCase');

-- ===== dedupe (F3d-R4) =====
select tests.rr(59141, 7000000);
select is(tests.notes(current_setting('t.m')::uuid, 59141), 1, 'the same diff twice notifies once');
select tests.rr(59141, 5000000);
select is(tests.notes(current_setting('t.m')::uuid, 59141), 1, 'a return to zero does not notify');
select tests.rr(59141, 7000000);
select is(tests.notes(current_setting('t.m')::uuid, 59141), 2, '0 -> X notifies again (a zero in between resets)');
select tests.rr(59141, 8000000);
select is(tests.notes(current_setting('t.m')::uuid, 59141), 3, 'a changed diff notifies again');
select is((select count(*)::int from public.dao_reconciliations where chain_id = 59141), 6, 'every run is recorded, notified or not');

-- ===== pending donations are not a mismatch (F3d-R5) =====
select set_config('t.i1', tests.mkdon(current_setting('t.um')::uuid, 3000000, 8201)::text, true);
select set_config('t.l1', tests.rec(current_setting('t.i1')::uuid, 8201)::text, true);
select is((select status from public.dao_ledger where id = current_setting('t.l1')::uuid), 'pending_finality', 'the donation is pending finality');
select set_config('t.rp', (tests.rr(59141, 8000000))::text, true);
select is(current_setting('t.rp')::jsonb ->> 'pendingValue', '3000000', 'the result carries the pending value');
select is(current_setting('t.rp')::jsonb ->> 'rawDiff', '3000000', 'the raw diff still shows the full gap');
select is(current_setting('t.rp')::jsonb ->> 'diff', '0', 'the effective diff excludes pending donations');
select is(tests.notes(current_setting('t.m')::uuid, 59141), 3, 'a gap explained by a pending donation does not notify');
select is((select pending_value from public.dao_reconciliations where id = (current_setting('t.rp')::jsonb ->> 'id')::uuid), 3000000::numeric, 'pending_value is stored');

-- ===== negative diff (other chain) =====
update public.dao_state set value_usdc = 9000000, total_shares = 9000000 where chain_id = 59144;
select is((tests.rr(59144, 4000000) ->> 'diff')::numeric, -5000000::numeric, 'effective diff is negative when the Safe holds less');
select is(tests.notes(current_setting('t.m')::uuid, 59144), 1, 'a negative diff notifies');
select is((select n.data ->> 'diff' from public.notifications n where n.kind = 'treasury_mismatch' and (n.data ->> 'chainId')::int = 59144 and n.recipient_id = current_setting('t.m')::uuid), '-5000000', 'the signed diff travels as text');
select is(tests.notes(current_setting('t.m')::uuid, 59141), 3, 'chains are deduplicated independently');

-- ===== the ledger is never touched =====
select is((select value_usdc from public.dao_state where chain_id = 59141), 5000000::numeric, 'dao_state is untouched');

-- ===== push copy =====
select is((select title from public._push_build((select n.id from public.notifications n where n.kind = 'treasury_mismatch'
  and n.recipient_id = current_setting('t.m')::uuid order by n.id limit 1))), 'Descuadre en la tesorería', 'push title');
select is((select url from public._push_build((select n.id from public.notifications n where n.kind = 'treasury_mismatch'
  and n.recipient_id = current_setting('t.m')::uuid order by n.id limit 1))), '/dao', 'push links to /dao');

-- ===== validation =====
select throws_ok($$select tests.rr(1, 0)$$, 'P0001', 'chain_invalid', 'unknown chain is rejected');
select throws_ok($$select tests.rr(59141, -1)$$, 'P0001', 'invalid_input', 'a negative balance is rejected');

-- ===== donation_missing (M4) =====
select is(tests.dm(current_setting('t.l1')::uuid, true), false, 'the first sighting of a missing tx does not allow a revert');
select ok((select missing_since is not null from public.dao_ledger where id = current_setting('t.l1')::uuid), 'missing_since is set');
select is(tests.dm(current_setting('t.l1')::uuid, true), false, 'still not allowed right after');
update public.dao_ledger set missing_since = now() - interval '31 minutes' where id = current_setting('t.l1')::uuid;
select is(tests.dm(current_setting('t.l1')::uuid, true), true, 'allowed once missing for more than 30 minutes');
select is(tests.dm(current_setting('t.l1')::uuid, false), false, 'finding the tx again answers false');
select ok((select missing_since is null from public.dao_ledger where id = current_setting('t.l1')::uuid), '... and clears missing_since');

select * from finish();
rollback;
