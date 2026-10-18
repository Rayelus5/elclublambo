begin;
select plan(23);

-- ===== privileges =====
select ok(not has_function_privilege('anon', 'public.record_reconciliation(int,numeric,numeric,uuid)', 'execute'), 'anon cannot record_reconciliation');
select ok(not has_function_privilege('authenticated', 'public.record_reconciliation(int,numeric,numeric,uuid)', 'execute'), 'authenticated cannot record_reconciliation');
select ok(has_function_privilege('service_role', 'public.record_reconciliation(int,numeric,numeric,uuid)', 'execute'), 'service_role can record_reconciliation');
select ok((select relrowsecurity from pg_class where oid = 'public.dao_reconciliations'::regclass), 'dao_reconciliations has RLS');
select ok(not has_table_privilege('authenticated', 'public.dao_reconciliations', 'select'), 'authenticated cannot read the table directly');

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d8200', 40, '0'), null, true)::text, true);
select set_config('t.m', tests.create_member('0x' || lpad('d8201', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.n', tests.create_member('0x' || lpad('d8202', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('d8203', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.z', tests.create_member('0x' || lpad('d8204', 40, '0'), current_setting('t.a')::uuid)::text, true);

-- m: MANAGE_TREASURY (256); n: no special role; x: MANAGE_TREASURY but banned; z: admin (512)
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T820 tesorero', '#AAAAAA', 50, 256);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T820 admin', '#BBBBBB', 51, 512);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.m')::uuid, id from public.roles where name = 'T820 tesorero';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.x')::uuid, id from public.roles where name = 'T820 tesorero';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.z')::uuid, id from public.roles where name = 'T820 admin';
update public.members set status = 'banned' where id = current_setting('t.x')::uuid;

create function tests.rec(p_chain int, p_ledger numeric, p_onchain numeric, p_actor uuid default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  set local role service_role;
  v := public.record_reconciliation(p_chain, p_ledger, p_onchain, p_actor);
  reset role;
  return v;
end;
$$;
create function tests.notes(p_rec uuid, p_member uuid) returns int language sql as $$
  select count(*)::int from public.notifications n
  where n.kind = 'treasury_mismatch' and n.recipient_id = p_member and n.data ->> 'reconciliationId' = p_rec::text
$$;

-- ===== no mismatch: recorded, nobody notified =====
select set_config('t.r0', tests.rec(59141, 5000000, 5000000)::text, true);
select is((select diff from public.dao_reconciliations where id = current_setting('t.r0')::uuid), 0::numeric, 'a zero diff is recorded');
select is((select count(*)::int from public.notifications where kind = 'treasury_mismatch'), 0, 'no notification when the diff is zero');
select is((select ran_by from public.dao_reconciliations where id = current_setting('t.r0')::uuid), null::uuid, 'cron runs have no actor');

-- ===== positive diff: notifies bit-256 holders only =====
select set_config('t.r1', tests.rec(59141, 5000000, 7000000, current_setting('t.a')::uuid)::text, true);
select is((select diff from public.dao_reconciliations where id = current_setting('t.r1')::uuid), 2000000::numeric, 'diff = onchain - ledger (positive)');
select is((select ran_by from public.dao_reconciliations where id = current_setting('t.r1')::uuid), current_setting('t.a')::uuid, 'the actor is stored');
select is(tests.notes(current_setting('t.r1')::uuid, current_setting('t.m')::uuid), 1, 'the MANAGE_TREASURY holder is notified');
select is(tests.notes(current_setting('t.r1')::uuid, current_setting('t.z')::uuid), 1, 'an admin (all bits) is notified');
select is(tests.notes(current_setting('t.r1')::uuid, current_setting('t.n')::uuid), 0, 'a plain member is not notified');
select is(tests.notes(current_setting('t.r1')::uuid, current_setting('t.x')::uuid), 0, 'a banned holder is not notified');
select is(
  (select n.data from public.notifications n where n.kind = 'treasury_mismatch' and n.recipient_id = current_setting('t.m')::uuid
   and n.data ->> 'reconciliationId' = current_setting('t.r1')::text),
  jsonb_build_object('chainId', 59141, 'diff', '2000000', 'reconciliationId', current_setting('t.r1')),
  'data is { chainId, diff, reconciliationId } in camelCase');

-- ===== negative diff =====
select set_config('t.r2', tests.rec(59144, 9000000, 4000000)::text, true);
select is((select diff from public.dao_reconciliations where id = current_setting('t.r2')::uuid), -5000000::numeric, 'diff is negative when the Safe holds less');
select is(tests.notes(current_setting('t.r2')::uuid, current_setting('t.m')::uuid), 1, 'a negative diff notifies too');
select is((select n.data ->> 'diff' from public.notifications n where n.kind = 'treasury_mismatch' and n.data ->> 'reconciliationId' = current_setting('t.r2') and n.recipient_id = current_setting('t.m')::uuid), '-5000000', 'the signed diff travels as text');

-- ===== the ledger is never touched =====
select is((select value_usdc from public.dao_state where chain_id = 59141), 0::numeric, 'dao_state is untouched');

-- ===== push copy =====
select is((select title from public._push_build((select n.id from public.notifications n where n.kind = 'treasury_mismatch'
  and n.recipient_id = current_setting('t.m')::uuid order by n.id limit 1))), 'Descuadre en la tesorería', 'push title');
select is((select url from public._push_build((select n.id from public.notifications n where n.kind = 'treasury_mismatch'
  and n.recipient_id = current_setting('t.m')::uuid order by n.id limit 1))), '/dao', 'push links to /dao');

-- ===== validation =====
select throws_ok($$select tests.rec(1, 0, 0)$$, 'P0001', 'chain_invalid', 'unknown chain is rejected');
select throws_ok($$select tests.rec(59141, -1, 0)$$, 'P0001', 'invalid_input', 'negative amounts are rejected');

select * from finish();
rollback;
