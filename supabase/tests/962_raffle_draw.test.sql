-- F4d Task 3 (migration 20261019400003): join / leave, close with a weight snapshot, the draw with the revealed seed and
-- the first block after the close, the member and treasurer reads, and the raffle notices.
--   The seed stays unreadable until draw_raffle reveals it; the SQL winner equals raffle_draw_preview(seed, hash,
--   weights in position order), the public formula the verifier recomputes.
-- Setup: 59141 valued at 100 USDC for S = 10 * 10^18. A (visible) 6 * 10^18, B (hidden) none, C (hidden) 4 * 10^18
-- with 1 * 10^18 locked in a pending withdrawal request. D (visible) and X (to be banned) hold nothing.
begin;
select plan(146);

-- ===== helpers (rolled back with the test) =====
create function tests.qh(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
create function tests.quser(p_member text) returns uuid language sql stable as $$
  select auth_user_id from public.members where id = current_setting('t.' || p_member)::uuid
$$;
create function tests.qcreate(p_title text, p_amount numeric, p_mode text) returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.quser('t'));
  v := public.create_raffle(p_title, 'USDC', p_amount, now() + interval '1 day', p_mode);
  perform tests.clear_authentication();
  return (v ->> 'id')::uuid;
end;
$$;
create function tests.qenter(p_member text, p_raffle uuid) returns void language plpgsql as $$
begin
  perform tests.authenticate_as(tests.quser(p_member));
  perform public.enter_raffle(p_raffle);
  perform tests.clear_authentication();
end;
$$;
create function tests.qleave(p_member text, p_raffle uuid) returns void language plpgsql as $$
begin
  perform tests.authenticate_as(tests.quser(p_member));
  perform public.leave_raffle(p_raffle);
  perform tests.clear_authentication();
end;
$$;
create function tests.qclose() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.close_due_raffles(59141);
  reset role;
  return v;
end;
$$;
create function tests.qdraw(p_raffle uuid, p_block jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.draw_raffle(p_raffle, p_block);
  reset role;
  return v;
end;
$$;
create function tests.qblock(p_raffle uuid, p_n int, p_after interval, p_parent interval, p_hash text default null)
returns jsonb language sql stable as $$
  select jsonb_build_object('number', p_n, 'hash', coalesce(p_hash, tests.qh(p_n)),
                            'timestamp', to_char((r.closes_at + p_after) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                            'parentTimestamp', to_char((r.closes_at + p_parent) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  from public.raffles r where r.id = p_raffle
$$;
create function tests.qlist(p_member text, p_limit int default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.quser(p_member));
  if p_limit is null then
    v := public.dao_raffles();
  else
    v := public.dao_raffles(p_limit);
  end if;
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.qcard(p_member text, p_raffle uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(tests.qlist(p_member)) x where x ->> 'id' = p_raffle::text
$$;
create function tests.qdetail(p_member text, p_raffle uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.quser(p_member));
  v := public.raffle_detail(p_raffle);
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.qtreasury(p_raffle uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as(tests.quser('t'));
  select to_jsonb(x) into v from public.treasury_raffles() x where x.id = p_raffle;
  perform tests.clear_authentication();
  return v;
end;
$$;
create function tests.qliab() returns numeric language plpgsql as $$
declare v numeric;
begin
  set local role service_role;
  v := public._dao_liabilities_usd6(59141, null);
  reset role;
  return v;
end;
$$;
create function tests.qvalue() returns numeric language sql as $$
  select value_usdc from public.dao_state where chain_id = 59141
$$;
create function tests.qseeds(p_raffle uuid) returns int language sql as $$
  select count(*)::int from private.raffle_seeds s where s.raffle_id = p_raffle
$$;
create function tests.qweights(p_raffle uuid) returns text language sql as $$
  select string_agg(e.position || ':' || e.weight, ',' order by e.position) from public.raffle_entries e
  where e.raffle_id = p_raffle
$$;
create function tests.qlabel(p_member text) returns text language sql as $$
  select public._member_label(current_setting('t.' || p_member)::uuid)
$$;
create function tests.qpush(p_recipient text, p_kind text, p_data jsonb) returns text language plpgsql as $$
declare
  v_id bigint;
  v text;
begin
  insert into public.notifications (recipient_id, kind, data)
  values (current_setting('t.' || p_recipient)::uuid, p_kind, p_data) returning id into v_id;
  select p.title || '|' || p.body || '|' || p.url into v from public._push_build(v_id) p;
  return v;
end;
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('f9620', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9621', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.c', tests.create_member('0x' || lpad('f9622', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.d', tests.create_member('0x' || lpad('f9623', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('f9624', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.t', tests.create_member('0x' || lpad('f9625', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.nouser', tests.create_wallet_user('0x' || lpad('f9626', 40, '0'))::text, true);
insert into public.roles (id, name, color, position, permissions) values (gen_random_uuid(), 'T962 tesorero', '#AAAAAA', 50, 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'T962 tesorero';
update public.members set dao_ranking_visible = true where id in (current_setting('t.a')::uuid, current_setting('t.d')::uuid);
update public.members set dao_ranking_visible = false
  where id in (current_setting('t.b')::uuid, current_setting('t.c')::uuid, current_setting('t.x')::uuid);

update public.chain_config set safe_address = '0x' || lpad('5afe96201', 40, '0'), platform_wallet = null,
                               withdrawals_enabled = true, weighted_raffles_enabled = true where chain_id = 59141;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
-- whatever the local database holds for 59141 is not part of these scenarios
delete from public.dao_safe_operations where raffle_id is not null;
delete from public.raffles;
update public.payment_intents set status = 'expired' where chain_id = 59141 and purpose = 'donation' and status = 'pending';
update public.dao_ledger set status = 'reverted' where chain_id = 59141 and status = 'pending_finality';
update public.withdrawal_requests set status = 'cancelled', cancelled_at = now() - interval '60 days', amount_usdc_locked = null,
       payout_tx_hash = null, payout_log_index = null, payout_block = null, payout_amount = null, payout_recorded_at = null
  where status in ('pending', 'approved');
delete from public.dao_safe_operations where chain_id = 59141;
delete from public.dao_nav_snapshots where chain_id = 59141;
delete from public.dao_positions where chain_id = 59141;
delete from public.dao_scan_state where chain_id = 59141;
update public.dao_state set total_shares = 10000000000000000000, club_shares = 0, value_usdc = 100000000,
                            approved_locked_shares = 0, nav_initialized = true where chain_id = 59141;
insert into public.dao_positions (chain_id, member_id, shares, net_contributed_usdc) values
  (59141, current_setting('t.a')::uuid, 6000000000000000000, 60000000),
  (59141, current_setting('t.c')::uuid, 4000000000000000000, 40000000);
select tests.authenticate_as(tests.quser('c'));
select set_config('t.wc', public.request_withdrawal(1000000000000000000)::text, true);
select tests.clear_authentication();

-- ===== 1. grants =====
select ok(not has_function_privilege('anon', 'public.close_due_raffles(int)', 'execute')
      and not has_function_privilege('authenticated', 'public.close_due_raffles(int)', 'execute')
      and has_function_privilege('service_role', 'public.close_due_raffles(int)', 'execute')
      and not has_function_privilege('anon', 'public.raffles_awaiting_draw(int)', 'execute')
      and not has_function_privilege('authenticated', 'public.raffles_awaiting_draw(int)', 'execute')
      and has_function_privilege('service_role', 'public.raffles_awaiting_draw(int)', 'execute')
      and not has_function_privilege('anon', 'public.draw_raffle(uuid,jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.draw_raffle(uuid,jsonb)', 'execute')
      and has_function_privilege('service_role', 'public.draw_raffle(uuid,jsonb)', 'execute'),
  'close_due_raffles, raffles_awaiting_draw and draw_raffle are service-only');
select ok(not has_function_privilege('anon', 'public.enter_raffle(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.leave_raffle(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.dao_raffles(int)', 'execute')
      and not has_function_privilege('anon', 'public.raffle_detail(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.treasury_raffles()', 'execute'),
  'anon cannot call the member raffle RPCs');
select ok(has_function_privilege('authenticated', 'public.enter_raffle(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.leave_raffle(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.dao_raffles(int)', 'execute')
      and has_function_privilege('authenticated', 'public.raffle_detail(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.treasury_raffles()', 'execute'),
  'members can call them (the checks are inside)');
select ok(not has_function_privilege('authenticated', 'public._raffle_card(public.raffles,uuid)', 'execute')
      and not has_function_privilege('service_role', 'public._raffle_card(public.raffles,uuid)', 'execute')
      and not has_function_privilege('anon', 'public._raffle_card(public.raffles,uuid)', 'execute'),
  'the internal card builder is granted to no API role');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'] and provolatile <> 'i') from pg_proc
           where oid in ('public.enter_raffle(uuid)'::regprocedure, 'public.leave_raffle(uuid)'::regprocedure,
                         'public.dao_raffles(int)'::regprocedure, 'public.raffle_detail(uuid)'::regprocedure,
                         'public.treasury_raffles()'::regprocedure, 'public.close_due_raffles(int)'::regprocedure,
                         'public.raffles_awaiting_draw(int)'::regprocedure, 'public.draw_raffle(uuid,jsonb)'::regprocedure,
                         'public._raffle_card(public.raffles,uuid)'::regprocedure, 'public._push_build(bigint)'::regprocedure,
                         'public.credit_donation(uuid,numeric,bigint,numeric)'::regprocedure,
                         'public.quote_withdrawal(uuid,text,numeric,bigint,numeric)'::regprocedure,
                         'public.approve_withdrawal(uuid,uuid,text,numeric,bigint,numeric)'::regprocedure,
                         'public.create_raffle(text,text,numeric,timestamptz,text)'::regprocedure)),
  'new and replaced functions are definer, empty search_path, never immutable');
select ok(not has_function_privilege('service_role', 'public._push_build(bigint)', 'execute')
      and has_function_privilege('service_role', 'public.credit_donation(uuid,numeric,bigint,numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public.credit_donation(uuid,numeric,bigint,numeric)', 'execute')
      and has_function_privilege('service_role', 'public.approve_withdrawal(uuid,uuid,text,numeric,bigint,numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public.quote_withdrawal(uuid,text,numeric,bigint,numeric)', 'execute'),
  'the replaced functions keep their grants');

-- ===== carry from Task 2 =====
set local role service_role;
select throws_ok($$select public.credit_donation(gen_random_uuid(), 1, 1, 0)$$, 'invalid_input', 'credit_donation: price 0 → invalid_input');
select throws_ok($$select public.credit_donation(gen_random_uuid(), 1, 1, -1)$$, 'invalid_input', 'credit_donation: a negative price → invalid_input');
select throws_ok($$select public.credit_donation(gen_random_uuid(), 1, 1, 1.5)$$, 'invalid_input', 'credit_donation: a fractional price → invalid_input');
select throws_ok($$select public.credit_donation(gen_random_uuid(), 1, 1, 300000000000)$$, 'not_found',
  'credit_donation: a valid price passes validation');
select throws_ok($$select public.quote_withdrawal(gen_random_uuid(), 'x', 1, 1, 0)$$, 'invalid_input', 'quote_withdrawal: price 0 → invalid_input');
select throws_ok($$select public.quote_withdrawal(gen_random_uuid(), 'x', 1, 1, -5)$$, 'invalid_input', 'quote_withdrawal: a negative price → invalid_input');
select throws_ok($$select public.quote_withdrawal(gen_random_uuid(), 'x', 1, 1, 2.25)$$, 'invalid_input', 'quote_withdrawal: a fractional price → invalid_input');
select throws_ok(format($$select public.approve_withdrawal(gen_random_uuid(), %L, 'x', 1, 1, 0)$$, current_setting('t.t')),
  'invalid_input', 'approve_withdrawal: price 0 → invalid_input');
select throws_ok(format($$select public.approve_withdrawal(gen_random_uuid(), %L, 'x', 1, 1, -1)$$, current_setting('t.t')),
  'invalid_input', 'approve_withdrawal: a negative price → invalid_input');
select throws_ok(format($$select public.approve_withdrawal(gen_random_uuid(), %L, 'x', 1, 1, 0.5)$$, current_setting('t.t')),
  'invalid_input', 'approve_withdrawal: a fractional price → invalid_input');
reset role;
select tests.authenticate_as(tests.quser('t'));
select throws_ok($$select public.create_raffle(E'\t\n', 'USDC', 1000000, now() + interval '1 day', 'equal')$$, 'title_required',
  'a tab/newline-only title → title_required');
select tests.clear_authentication();
select throws_ok($$insert into public.raffles (chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, closes_at,
                                               seed_commit, created_by)
                   values (59141, E'x\t', 'USDC', 1000000, 1000000, 'equal', now() + interval '1 day', tests.qh(1),
                           current_setting('t.t')::uuid)$$, '23514', null, 'the table refuses a title with trailing whitespace');
select throws_ok($$insert into public.raffles (chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, closes_at,
                                               seed_commit, status, cancelled_at, created_by)
                   values (59141, 'x', 'USDC', 1000000, 1000000, 'equal', now() + interval '1 day', tests.qh(1), 'cancelled',
                           now(), current_setting('t.t')::uuid)$$, '23514', null,
  'a cancelled raffle needs its reason and who cancelled it');

-- ===== 2. join and leave =====
select set_config('t.rw', tests.qcreate('Sorteo ponderado', 10000000, 'weighted')::text, true);
select set_config('t.re', tests.qcreate('Sorteo igual', 5000000, 'equal')::text, true);
select set_config('t.v1', tests.qcreate('Sin nadie', 2000000, 'equal')::text, true);
select set_config('t.v2', tests.qcreate('Solo B', 3000000, 'weighted')::text, true);
select is(tests.qvalue(), 80000000::numeric, 'four prizes (10 + 5 + 2 + 3) left the cached value');
select lives_ok(format($$select tests.qenter('a', %L)$$, current_setting('t.rw')), 'A enters');
select lives_ok(format($$select tests.qenter('a', %L)$$, current_setting('t.rw')), 'A enters again (idempotent)');
select is((select count(*)::int from public.raffle_entries where raffle_id = current_setting('t.rw')::uuid
           and member_id = current_setting('t.a')::uuid), 1, 'A has one entry');
select tests.qenter('b', current_setting('t.rw')::uuid);
select lives_ok(format($$select tests.qleave('b', %L)$$, current_setting('t.rw')), 'B leaves');
select is((select count(*)::int from public.raffle_entries where raffle_id = current_setting('t.rw')::uuid
           and member_id = current_setting('t.b')::uuid), 0, 'B has no entry after leaving');
select lives_ok(format($$select tests.qleave('b', %L)$$, current_setting('t.rw')), 'leaving when not entered does nothing');
select tests.qenter('b', current_setting('t.rw')::uuid);
select tests.qenter('c', current_setting('t.rw')::uuid);
select is((select count(*)::int from public.raffle_entries where raffle_id = current_setting('t.rw')::uuid), 3,
  'B entered again and C joined: three entries');
select throws_ok(format($$select tests.qenter('a', %L)$$, gen_random_uuid()), 'not_found', 'an unknown raffle → not_found');
update public.members set status = 'banned' where id = current_setting('t.x')::uuid;
select throws_ok(format($$select tests.qenter('x', %L)$$, current_setting('t.rw')), 'forbidden', 'a banned member → forbidden');
select throws_ok(format($$select tests.qleave('x', %L)$$, current_setting('t.rw')), 'forbidden', 'a banned member cannot leave either');
update public.members set status = 'active' where id = current_setting('t.x')::uuid;
-- the equal raffle: A, X, D (X is banned before the close)
select tests.qenter('a', current_setting('t.re')::uuid);
select tests.qenter('x', current_setting('t.re')::uuid);
select tests.qenter('d', current_setting('t.re')::uuid);
-- V2: B only (no shares)
select tests.qenter('b', current_setting('t.v2')::uuid);
-- Review Focus 2: the close date passed but the cron has not closed it yet
update public.raffles set closes_at = now() - interval '1 second' where id = current_setting('t.rw')::uuid;
select throws_ok(format($$select tests.qenter('d', %L)$$, current_setting('t.rw')), 'raffle_closed',
  'joining from closes_at on (still open) → raffle_closed');
select throws_ok(format($$select tests.qleave('a', %L)$$, current_setting('t.rw')), 'raffle_closed',
  'leaving from closes_at on (still open) → raffle_closed');
select is((select status from public.raffles where id = current_setting('t.rw')::uuid), 'open', 'the raffle is still open');

-- ===== 3. reads before close, as A =====
select set_config('t.card', tests.qcard('a', current_setting('t.rw')::uuid)::text, true);
select is((current_setting('t.card')::jsonb ->> 'entries')::int, 3, 'card: 3 entries');
select is(current_setting('t.card')::jsonb -> 'iEntered', 'true'::jsonb, 'card: iEntered');
select is(current_setting('t.card')::jsonb -> 'myWeight', 'null'::jsonb, 'card: myWeight null before close');
select is(current_setting('t.card')::jsonb -> 'seedReveal', 'null'::jsonb, 'card: seedReveal null before the draw');
select is(current_setting('t.card')::jsonb ->> 'commit', (select seed_commit from public.raffles where id = current_setting('t.rw')::uuid),
  'card: the commit is published');
select is((select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(current_setting('t.card')::jsonb) k),
  array['cancelReason', 'closesAt', 'commit', 'createdAt', 'drawBlockNumber', 'entries', 'iEntered', 'iWon', 'id', 'mode',
        'myWeight', 'paidLate', 'payoutRecorded', 'prizeAmount', 'prizeToken', 'seedReveal', 'status', 'title', 'totalWeight',
        'unpaid', 'winnerLabel'],
  'card keys are exactly the brief''s');
select is(current_setting('t.card')::jsonb ->> 'prizeAmount', '10000000', 'card: the prize amount is text');
select set_config('t.det', tests.qdetail('a', current_setting('t.rw')::uuid)::text, true);
select is((select jsonb_agg(x ->> 'label' order by o) from jsonb_array_elements(current_setting('t.det')::jsonb -> 'entryList')
             with ordinality e(x, o)),
  jsonb_build_array(tests.qlabel('a'), 'Anónimo #1', 'Anónimo #2'), 'entryList: A''s own label, then the hidden B and C');
select is((select jsonb_agg(x -> 'isMe' order by o) from jsonb_array_elements(current_setting('t.det')::jsonb -> 'entryList')
             with ordinality e(x, o)), '[true, false, false]'::jsonb, 'entryList: isMe only on A');
select ok((select bool_and(x -> 'position' = 'null'::jsonb and x -> 'weight' = 'null'::jsonb)
           from jsonb_array_elements(current_setting('t.det')::jsonb -> 'entryList') x), 'entryList: no position or weight before close');
select is(current_setting('t.det')::jsonb -> 'payoutTxHash', 'null'::jsonb, 'detail: no payout hash');
select is((current_setting('t.det')::jsonb ->> 'chainId')::int, 59141, 'detail: chainId');
select is(tests.qdetail('t', current_setting('t.rw')::uuid) -> 'seedReveal', 'null'::jsonb,
  'Review Focus 1: the treasurer''s detail has no seed either');
select is(tests.qdetail('t', current_setting('t.rw')::uuid) -> 'entryList' -> 1 ->> 'label', 'Anónimo #1',
  'the treasurer''s detail keeps the privacy rule');
select ok(not exists (select 1 from pg_proc p, unnest(p.proargnames) a
                      where p.oid = 'public.treasury_raffles()'::regprocedure and a like '%seed%'),
  'treasury_raffles exposes no seed column');
select ok(tests.qtreasury(current_setting('t.rw')::uuid) is not null, 'treasury_raffles lists the open raffle');
select tests.authenticate_as(current_setting('t.nouser')::uuid);
select throws_ok($$select public.dao_raffles()$$, 'forbidden', 'a non-member cannot list raffles');
select throws_ok(format($$select public.raffle_detail(%L)$$, current_setting('t.rw')), 'forbidden', 'a non-member cannot read a raffle');
select tests.clear_authentication();
select tests.authenticate_as(tests.quser('b'));
select throws_ok($$select * from public.treasury_raffles()$$, 'forbidden', 'treasury_raffles needs bit 256');
select tests.clear_authentication();
insert into public.raffles (id, chain_id, title, prize_token, prize_amount, prize_value_usd6, mode, closes_at, seed_commit, created_by)
  values ('00000000-0000-0000-0000-000000962044', 59144, 'Otra red', 'USDC', 1000000, 1000000, 'equal',
          now() + interval '1 day', tests.qh(44), current_setting('t.t')::uuid);
select throws_ok($$select tests.qdetail('a', '00000000-0000-0000-0000-000000962044')$$, 'not_found',
  'another chain''s raffle → not_found');
select throws_ok(format($$select tests.qdetail('a', %L)$$, gen_random_uuid()), 'not_found', 'an unknown raffle → not_found');
select ok(not exists (select 1 from jsonb_array_elements(tests.qlist('a')) x where x ->> 'id' = '00000000-0000-0000-0000-000000962044'),
  'dao_raffles lists the active chain only');
delete from public.raffles where id = '00000000-0000-0000-0000-000000962044';

-- ===== 4. close, weighted =====
select is(tests.qclose(), '{"closed": 1, "voided": 0}'::jsonb, 'close_due_raffles closes the one due raffle');
select is((select status from public.raffles where id = current_setting('t.rw')::uuid), 'closed', 'the raffle is closed');
select is(tests.qweights(current_setting('t.rw')::uuid), '1:6000000000000000000,2:0,3:3000000000000000000',
  'positions in entry order; weights A 6e18, B 0, C 3e18 (unlocked only)');
select is((select total_weight from public.raffles where id = current_setting('t.rw')::uuid), 9000000000000000000::numeric,
  'total_weight = 9e18');
select ok((select closed_at is not null from public.raffles where id = current_setting('t.rw')::uuid), 'closed_at is set');
select is((select payload from public.audit_log where action = 'raffle_closed' and target_id = current_setting('t.rw')::uuid),
  jsonb_build_object('raffle', current_setting('t.rw')::uuid, 'entries', 3, 'totalWeight', '9000000000000000000'),
  'raffle_closed is audited with {raffle, entries, totalWeight}');
select is(tests.qseeds(current_setting('t.rw')::uuid), 1, 'the seed is still private after the close');
select is((select seed_reveal from public.raffles where id = current_setting('t.rw')::uuid), null, 'and not revealed');
select tests.authenticate_as(tests.quser('c'));
select public.cancel_withdrawal(current_setting('t.wc')::uuid);
select tests.clear_authentication();
select is(tests.qweights(current_setting('t.rw')::uuid), '1:6000000000000000000,2:0,3:3000000000000000000',
  'C cancelling their withdrawal request does not change the stored weights');
select is(tests.qclose(), '{"closed": 0, "voided": 0}'::jsonb, 'a second close finds nothing due');
select throws_ok(format($$select tests.qenter('d', %L)$$, current_setting('t.rw')), 'raffle_closed', 'joining a closed raffle → raffle_closed');
select is(tests.qcard('c', current_setting('t.rw')::uuid) ->> 'myWeight', '3000000000000000000', 'C''s card: myWeight after close');
select is(tests.qcard('c', current_setting('t.rw')::uuid) ->> 'totalWeight', '9000000000000000000', 'C''s card: totalWeight');
select is(tests.qcard('d', current_setting('t.rw')::uuid) -> 'myWeight', 'null'::jsonb, 'a non-entrant has no weight');
select is((select jsonb_agg(jsonb_build_array(x -> 'position', x ->> 'label', x ->> 'weight', x -> 'isMe') order by o)
           from jsonb_array_elements(tests.qdetail('c', current_setting('t.rw')::uuid) -> 'entryList') with ordinality e(x, o)),
  jsonb_build_array(jsonb_build_array(1, tests.qlabel('a'), '6000000000000000000', false),
                    jsonb_build_array(2, 'Anónimo #1', '0', false),
                    jsonb_build_array(3, tests.qlabel('c'), '3000000000000000000', true)),
  'C''s detail: positions and weights, C sees themself, B stays Anónimo #1');
select set_config('t.wait', (select string_agg(raffle_id::text, ',') from public.raffles_awaiting_draw(59141)), true);
select is(current_setting('t.wait'), current_setting('t.rw'), 'raffles_awaiting_draw lists the closed raffle');

-- ===== 5. close, equal =====
update public.members set status = 'banned' where id = current_setting('t.x')::uuid;
update public.raffles set closes_at = now() - interval '2 seconds' where id = current_setting('t.re')::uuid;
select is(tests.qclose(), '{"closed": 1, "voided": 0}'::jsonb, 'the equal raffle closes');
select is(tests.qweights(current_setting('t.re')::uuid), '1:1,2:0,3:1', 'equal: the member banned before the close weighs 0');
select is((select total_weight from public.raffles where id = current_setting('t.re')::uuid), 2::numeric, 'equal: total_weight 2');
select is((select array_agg(raffle_id order by closes_at) from public.raffles_awaiting_draw(59141)),
  array[current_setting('t.re')::uuid, current_setting('t.rw')::uuid], 'awaiting draw: closed raffles by closes_at');

-- ===== 6. void (Review Focus 5) =====
select set_config('t.vv', tests.qvalue()::text, true);
select set_config('t.vl', tests.qliab()::text, true);
update public.raffles set closes_at = now() - interval '3 seconds'
  where id in (current_setting('t.v1')::uuid, current_setting('t.v2')::uuid);
select is(tests.qclose(), '{"closed": 0, "voided": 2}'::jsonb, 'no entries, and only a 0-share entrant: both void');
select is((select array_agg(status order by title) from public.raffles
           where id in (current_setting('t.v1')::uuid, current_setting('t.v2')::uuid)), array['void', 'void'], 'both are void');
select ok((select bool_and(seed_reveal ~ '^0x[0-9a-f]{64}$' and closed_at is not null and total_weight = 0) from public.raffles
           where id in (current_setting('t.v1')::uuid, current_setting('t.v2')::uuid)), 'void: seed revealed, closed, total 0');
select is((select '0x' || encode(public._keccak256(decode(substr(seed_reveal, 3), 'hex')), 'hex') = seed_commit from public.raffles
           where id = current_setting('t.v2')::uuid), true, 'void: the revealed seed matches the commit');
select is(tests.qseeds(current_setting('t.v1')::uuid) + tests.qseeds(current_setting('t.v2')::uuid), 0, 'void: the seed rows are gone');
select is(tests.qvalue(), current_setting('t.vv')::numeric + 5000000, 'void: value_usdc is restored by exactly 2 + 3 USDC');
select is(tests.qliab(), current_setting('t.vl')::numeric - 5000000, 'void: the liabilities drop by the two prizes');
select is((select count(*)::int from public.notifications where kind = 'raffle_won'
           and data ->> 'raffleId' in (current_setting('t.v1'), current_setting('t.v2'))), 0, 'void: no raffle_won notice');
select is((select count(*)::int from public.notifications where kind = 'treasury_notice'
           and data ->> 'raffleId' in (current_setting('t.v1'), current_setting('t.v2'))), 0, 'void: no treasury notice');
select is((select payload ->> 'valueUsd6' from public.audit_log where action = 'raffle_voided'
           and target_id = current_setting('t.v2')::uuid), '3000000', 'raffle_voided is audited');
select is(tests.qcard('b', current_setting('t.v2')::uuid) ->> 'seedReveal',
  (select seed_reveal from public.raffles where id = current_setting('t.v2')::uuid), 'a void card shows the revealed seed');
select is(tests.qcard('b', current_setting('t.v2')::uuid) -> 'winnerLabel', 'null'::jsonb, 'a void card has no winner');
select throws_ok(format($$select tests.qdraw(%L, tests.qblock(%L, 600, '1 second', '-1 second'))$$,
  current_setting('t.v1'), current_setting('t.v1')), 'invalid_state', 'a void raffle cannot be drawn');

-- ===== 7. draw, equal raffle with its own random seed =====
select throws_ok(format($$select tests.qdraw(%L, tests.qblock(%L, 500, '0 seconds', '-1 second'))$$,
  current_setting('t.re'), current_setting('t.re')), 'draw_block_invalid', 'a block at closes_at → draw_block_invalid');
select throws_ok(format($$select tests.qdraw(%L, tests.qblock(%L, 500, '2 seconds', '1 second'))$$,
  current_setting('t.re'), current_setting('t.re')), 'draw_block_invalid', 'a parent after closes_at → draw_block_invalid');
select throws_ok(format($$select tests.qdraw(%L, '{"number": 1}'::jsonb)$$, current_setting('t.re')), 'invalid_input',
  'a malformed block → invalid_input');
select throws_ok(format($$select tests.qdraw(%L, jsonb_set(tests.qblock(%L, 500, '1 second', '0 seconds'), '{timestamp}', '"ayer"'))$$,
  current_setting('t.re'), current_setting('t.re')), 'invalid_input', 'an unparseable time → invalid_input');
select throws_ok(format($$select tests.qdraw(%L, tests.qblock(%L, 500, '1 second', '0 seconds'))$$,
  gen_random_uuid(), current_setting('t.re')), 'not_found', 'an unknown raffle → not_found');
select is(tests.qseeds(current_setting('t.re')::uuid), 1, 'a refused draw leaves the seed private');
select set_config('t.ne0', (select count(*)::text from public.notifications), true);
select is(tests.qdraw(current_setting('t.re')::uuid, tests.qblock(current_setting('t.re')::uuid, 500, '1 second', '0 seconds')) ->> 'status',
  'drawn', 'a valid block (parent exactly at closes_at) draws');
select set_config('t.ewin', (select winner_position::text from public.raffles where id = current_setting('t.re')::uuid), true);
select is((select winner_position from public.raffles where id = current_setting('t.re')::uuid),
  (select (public.raffle_draw_preview(r.seed_reveal, r.draw_block_hash,
                                      (select array_agg(e.weight order by e.position) from public.raffle_entries e
                                       where e.raffle_id = r.id)) ->> 'winnerPosition')::int
   from public.raffles r where r.id = current_setting('t.re')::uuid),
  'the SQL winner equals raffle_draw_preview(seed, hash, weights in position order)');
select is((select draw_random from public.raffles where id = current_setting('t.re')::uuid),
  (select public.raffle_draw_preview(r.seed_reveal, r.draw_block_hash, array[1, 0, 1]::numeric[]) ->> 'random'
   from public.raffles r where r.id = current_setting('t.re')::uuid), 'draw_random is the public random');
select ok((select winner_position in (1, 3) from public.raffles where id = current_setting('t.re')::uuid),
  'the banned entrant (weight 0) did not win');
select is((select '0x' || encode(public._keccak256(decode(substr(seed_reveal, 3), 'hex')), 'hex') from public.raffles
           where id = current_setting('t.re')::uuid),
  (select seed_commit from public.raffles where id = current_setting('t.re')::uuid), 'keccak256(seed_reveal) = seed_commit');
select is(tests.qseeds(current_setting('t.re')::uuid), 0, 'the seed row is deleted at the draw');
select is((select row(r.status, r.draw_block_number, r.draw_block_hash, r.winner_member_id, r.winner_address,
                      r.drawn_at is not null,
                      abs(extract(epoch from r.draw_block_time - (r.closes_at + interval '1 second'))) < 0.001)::text
           from public.raffles r where r.id = current_setting('t.re')::uuid),
  (select row('drawn', 500::bigint, tests.qh(500), e.member_id, lower(m.wallet_address), true, true)::text
   from public.raffle_entries e join public.members m on m.id = e.member_id
   where e.raffle_id = current_setting('t.re')::uuid and e.position = current_setting('t.ewin')::int),
  'drawn: block, winner (the entry at winner_position) and the winner''s lowercased wallet');
select is((select count(*)::int from public.notifications n join public.raffles r on r.id = current_setting('t.re')::uuid
           where n.kind = 'raffle_won' and n.recipient_id = r.winner_member_id
             and n.data = jsonb_build_object('raffleId', r.id, 'title', 'Sorteo igual', 'token', 'USDC', 'amount', '5000000')),
  1, 'the winner has one raffle_won {raffleId, title, token, amount}');
select is((select count(*)::int from public.notifications where kind = 'raffle_won' and data ->> 'raffleId' = current_setting('t.re')),
  1, 'nobody else got raffle_won');
select ok((select bool_and((select count(*) from public.notifications n where n.recipient_id = m.id and n.kind = 'treasury_notice'
                            and n.data = jsonb_build_object('event', 'raffle_drawn', 'raffleId', current_setting('t.re'))) = 1)
           from public.members m where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0),
  'every active bit-256 holder has one treasury_notice raffle_drawn');
select is((select count(*)::int from public.notifications n where n.kind = 'treasury_notice'
           and n.data ->> 'raffleId' = current_setting('t.re')
           and (public.member_global_permissions(n.recipient_id) & 256) = 0), 0, 'no one else got the treasury notice');
select is((select payload from public.audit_log where action = 'raffle_drawn' and target_id = current_setting('t.re')::uuid),
  (select jsonb_build_object('raffle', r.id, 'block', 500, 'hash', tests.qh(500), 'random', r.draw_random,
                             'winnerPosition', r.winner_position)
   from public.raffles r where r.id = current_setting('t.re')::uuid), 'raffle_drawn is audited');
select is(tests.qdraw(current_setting('t.re')::uuid, tests.qblock(current_setting('t.re')::uuid, 500, '1 second', '0 seconds')),
  jsonb_build_object('status', 'already', 'winnerPosition', current_setting('t.ewin')::int), 'the same block again → already');
select is((select count(*)::int from public.notifications where kind = 'raffle_won' and data ->> 'raffleId' = current_setting('t.re')),
  1, 'the repeat sent no second notice');
select throws_ok(format($$select tests.qdraw(%L, tests.qblock(%L, 501, '2 seconds', '0 seconds'))$$,
  current_setting('t.re'), current_setting('t.re')), 'invalid_state', 'another block on a drawn raffle → invalid_state');
select is((select status from public.raffles where id = current_setting('t.re')::uuid), 'drawn', 'still drawn');
select is(tests.qcard('d', current_setting('t.re')::uuid) ->> 'seedReveal',
  (select seed_reveal from public.raffles where id = current_setting('t.re')::uuid), 'the card shows the seed after the draw');
select is(tests.qcard('d', current_setting('t.re')::uuid) ->> 'drawBlockNumber', '500', 'the card shows the draw block');
select is(tests.qliab(), current_setting('t.vl')::numeric - 5000000, 'the drawn prize is still a liability (nothing moved)');

-- ===== 8. hidden winner: the weighted raffle with the fixture's "equal-3" seed and hash (walk lands on C) =====
update private.raffle_seeds set seed = decode('030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc', 'hex')
  where raffle_id = current_setting('t.rw')::uuid;
update public.raffles set seed_commit = '0x04d1b47ed3b04c5ff6a0280293cb2ab55bd297c9c2e0c3449831b419285d7df2'
  where id = current_setting('t.rw')::uuid;
select is(tests.qdraw(current_setting('t.rw')::uuid,
                      tests.qblock(current_setting('t.rw')::uuid, 700, '1 second', '-1 second',
                                   '0xc8d5e2effc091623303d4a5764717e8b98a5b2bfccd9e6f3000d1a2734414e5b')),
  '{"status": "drawn", "winnerPosition": 3}'::jsonb, 'the weighted draw lands on position 3');
select is((select row(winner_member_id, draw_random, seed_reveal)::text from public.raffles where id = current_setting('t.rw')::uuid),
  row(current_setting('t.c')::uuid, '106188867100815727276200137309039438328669808845452583523039833177738565114133',
      '0x030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc')::text,
  'C wins, with the fixture''s random and the seed revealed');
select is((public.raffle_draw_preview('0x030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc',
                                      '0xc8d5e2effc091623303d4a5764717e8b98a5b2bfccd9e6f3000d1a2734414e5b',
                                      array[6000000000000000000, 0, 3000000000000000000]::numeric[]) ->> 'winnerPosition')::int,
  3, 'the public formula on the stored weights agrees');
select is(tests.qcard('a', current_setting('t.rw')::uuid) ->> 'winnerLabel', 'Anónimo', 'A sees a hidden winner as Anónimo');
select is(tests.qcard('a', current_setting('t.rw')::uuid) -> 'iWon', 'false'::jsonb, 'A did not win');
select is(tests.qcard('c', current_setting('t.rw')::uuid) ->> 'winnerLabel', tests.qlabel('c'), 'C sees their own label');
select is(tests.qcard('c', current_setting('t.rw')::uuid) -> 'iWon', 'true'::jsonb, 'C sees iWon');
select is(tests.qdetail('a', current_setting('t.rw')::uuid) ->> 'winnerLabel', 'Anónimo', 'the detail keeps the winner hidden');
select is((tests.qdetail('a', current_setting('t.rw')::uuid) ->> 'winnerPosition')::int, 3, 'detail: winnerPosition');
select is(tests.qdetail('a', current_setting('t.rw')::uuid) ->> 'drawBlockHash',
  '0xc8d5e2effc091623303d4a5764717e8b98a5b2bfccd9e6f3000d1a2734414e5b', 'detail: drawBlockHash');
select ok(tests.qdetail('a', current_setting('t.rw')::uuid) ->> 'drawRandom' is not null
      and tests.qdetail('a', current_setting('t.rw')::uuid) ->> 'drawBlockTime' is not null, 'detail: drawRandom and drawBlockTime');
select is((select jsonb_build_array(x ->> 'winner_label', x ->> 'winner_address', x ->> 'winner_member_id', x ->> 'status',
                                    x ->> 'total_weight', (x ->> 'entries')::int, x ->> 'created_by_label', x ->> 'prize_value_usd6')
           from tests.qtreasury(current_setting('t.rw')::uuid) x),
  jsonb_build_array(tests.qlabel('c'), '0x' || lpad('f9622', 40, '0'), current_setting('t.c'), 'drawn',
                    '9000000000000000000', 3, tests.qlabel('t'), '10000000'),
  'treasury_raffles: C''s real label and wallet, status, weights, creator');
-- the payout hash: treasurers and the winner only
update public.raffles set payout_tx_hash = tests.qh(900), payout_log_index = 0, payout_block = 900, payout_block_time = now(),
                          payout_amount = 10000000, payout_recorded_at = now()
  where id = current_setting('t.rw')::uuid;
select is(tests.qdetail('c', current_setting('t.rw')::uuid) ->> 'payoutTxHash', tests.qh(900), 'the winner sees the payout hash');
select is(tests.qdetail('t', current_setting('t.rw')::uuid) ->> 'payoutTxHash', tests.qh(900), 'a treasurer sees the payout hash');
select is(tests.qdetail('a', current_setting('t.rw')::uuid) -> 'payoutTxHash', 'null'::jsonb, 'another member does not');
select is(tests.qcard('a', current_setting('t.rw')::uuid) -> 'payoutRecorded', 'true'::jsonb, 'the card says a payout is recorded');
-- derived flags
update public.raffles set drawn_at = now() - interval '15 days' where id = current_setting('t.re')::uuid;
select is(tests.qcard('a', current_setting('t.re')::uuid) -> 'unpaid', 'true'::jsonb, 'a prize drawn 15 days ago and unpaid is unpaid');
select is(tests.qtreasury(current_setting('t.re')::uuid) -> 'unpaid', 'true'::jsonb, 'treasury_raffles shows unpaid too');
update public.raffles set status = 'paid', paid_at = now(), drawn_at = now() - interval '20 days',
                          payout_block_time = now() - interval '1 day'
  where id = current_setting('t.rw')::uuid;
select is(tests.qcard('a', current_setting('t.rw')::uuid) -> 'paidLate', 'true'::jsonb, 'paid 19 days after the draw: paidLate');
select is(tests.qdraw(current_setting('t.rw')::uuid,
                      tests.qblock(current_setting('t.rw')::uuid, 700, '1 second', '-1 second',
                                   '0xc8d5e2effc091623303d4a5764717e8b98a5b2bfccd9e6f3000d1a2734414e5b')) ->> 'status',
  'already', 'a paid raffle with the same block → already');
-- ordering: active first by closes_at, then the past by their end
select set_config('t.ro', tests.qcreate('Otro abierto', 1000000, 'equal')::text, true);
select is((select jsonb_agg(x ->> 'id' order by o) from jsonb_array_elements(tests.qlist('a')) with ordinality e(x, o)),
  jsonb_build_array(current_setting('t.ro'))
    || (select jsonb_agg(id::text order by id) from public.raffles
        where id in (current_setting('t.v1')::uuid, current_setting('t.v2')::uuid))
    || jsonb_build_array(current_setting('t.re'), current_setting('t.rw')),
  'dao_raffles: the open one first, then the past by drawn/closed time desc');
select is(jsonb_array_length(tests.qlist('a', 1)), 2, 'the limit applies to the past raffles only');
-- a cancelled one carries its public reason
select tests.authenticate_as(tests.quser('t'));
select public.cancel_raffle(current_setting('t.ro')::uuid, 'Premio mal puesto');
select tests.clear_authentication();
select is(tests.qcard('a', current_setting('t.ro')::uuid) ->> 'cancelReason', 'Premio mal puesto', 'a cancelled card shows the reason');
select is(tests.qcard('a', current_setting('t.ro')::uuid) -> 'seedReveal', 'null'::jsonb, 'a cancelled raffle never reveals its seed');

-- ===== 9. push copy =====
select is(tests.qpush('c', 'raffle_won', jsonb_build_object('raffleId', current_setting('t.rw'), 'title', 'Sorteo ponderado',
                                                           'token', 'USDC', 'amount', '12500000')),
  'Has ganado un sorteo|Premio: 12,5 USDC en «Sorteo ponderado». El tesorero te lo enviará desde la Safe.|/dao/sorteos/'
    || current_setting('t.rw'), 'raffle_won push: title, body, url');
select is(tests.qpush('c', 'raffle_won', jsonb_build_object('raffleId', current_setting('t.rw'),
                                                           'title', E'Un\ttítulo' || chr(7) || ' ' || repeat('x', 70),
                                                           'token', 'WETH', 'amount', '1500000000000000')),
  'Has ganado un sorteo|Premio: 0,0015 WETH en «' || left(E'Un título  ' || repeat('x', 70), 60)
    || '». El tesorero te lo enviará desde la Safe.|/dao/sorteos/' || current_setting('t.rw'),
  'raffle_won push: WETH at 18 decimals, control characters stripped, title cut at 60');
select is(tests.qpush('c', 'raffle_won', jsonb_build_object('raffleId', current_setting('t.rw'), 'title', 'x', 'token', 'USDC',
                                                           'amount', 'x')), null, 'a malformed amount → no push');
select is(tests.qpush('c', 'raffle_won', jsonb_build_object('raffleId', 'nope', 'title', 'x', 'token', 'USDC', 'amount', '1')),
  null, 'a non-uuid raffle id → no push');
select is(tests.qpush('c', 'raffle_won', jsonb_build_object('raffleId', current_setting('t.rw'), 'title', 'x', 'token', 'DOGE',
                                                           'amount', '1')), null, 'an unknown token → no push');
select is(tests.qpush('t', 'treasury_notice', jsonb_build_object('event', 'raffle_drawn', 'raffleId', current_setting('t.rw'))),
  'Aviso de tesorería|Un sorteo tiene ganador: hay un premio que pagar.|/dao/tesoreria#sorteos', 'treasury_notice raffle_drawn push');
select is(tests.qpush('t', 'treasury_notice', jsonb_build_object('event', 'raffle_unpaid', 'raffleId', current_setting('t.rw'))),
  'Aviso de tesorería|Un premio de sorteo lleva 14 días sin pagarse.|/dao/tesoreria#sorteos', 'treasury_notice raffle_unpaid push');
select is(tests.qpush('t', 'treasury_notice', jsonb_build_object('event', 'withdrawal_requested', 'requestId', gen_random_uuid())),
  'Aviso de tesorería|Hay una nueva solicitud de retirada.|/dao/tesoreria', 'the existing events keep their copy and url');
select is(tests.qpush('a', 'treasury_notice', jsonb_build_object('event', 'raffle_drawn', 'raffleId', current_setting('t.rw'))),
  null, 'a non-treasurer gets no treasury_notice push');

select * from finish();
rollback;
