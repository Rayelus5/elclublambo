-- P1 Task 6 (migration 20261024200004): club Safe expenses noted by a treasurer.
--   - record_club_expense (service_role): forbidden for a non-treasurer, tx_already_used on a repeated
--     (chain, hash, log_index), invalid_input for a note over 280 characters or a kind/log index that does not fit.
--   - club_expenses_list: active members only, amounts as text, recorder label.
--   - set_club_expense_note: treasurer only, audit_log 'expense_noted'.
begin;
select plan(20);

create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;

select set_config('t.a', tests.create_member('0x' || lpad('e9c30', 40, '0'), null, true)::text, true);
select set_config('t.m', tests.create_member('0x' || lpad('e9c31', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.um', (select auth_user_id::text from public.members where id = current_setting('t.m')::uuid), true);
select set_config('t.stranger', tests.create_wallet_user('0x' || lpad('e9c3f', 40, '0'))::text, true);

-- ===== 1. schema and privileges =====
select ok(has_function_privilege('service_role', 'public.record_club_expense(int,text,numeric,text,int,text,text,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_club_expense(int,text,numeric,text,int,text,text,uuid)', 'execute'),
  'record_club_expense: service_role yes, authenticated no');
select ok(has_function_privilege('authenticated', 'public.club_expenses_list(int)', 'execute')
      and not has_function_privilege('anon', 'public.club_expenses_list(int)', 'execute'),
  'club_expenses_list: authenticated yes, anon no');
select tests.authenticate_as(current_setting('t.um')::uuid);
select throws_ok($$select count(*) from public.club_expenses$$, '42501', null, 'club_expenses has no direct read for members');
select tests.clear_authentication();

-- ===== 2. record_club_expense =====
set local role service_role;
select throws_ok(format($$select public.record_club_expense(84532, 'USDC', 5000000, %L, 1, 'Servidor', 'usdc_log', %L)$$,
  tests.hash(1), current_setting('t.m')), 'P0001', 'forbidden', 'a member without MANAGE_TREASURY cannot record an expense');
select throws_ok(format($$select public.record_club_expense(84532, 'USDC', 5000000, %L, 1, 'Servidor', 'usdc_log', null)$$,
  tests.hash(1)), 'P0001', 'forbidden', 'a missing actor is forbidden');
select set_config('t.e1', public.record_club_expense(84532, 'USDC', 5000000, tests.hash(1), 1, '  Servidor del mes  ', 'usdc_log',
  current_setting('t.a')::uuid)::text, true);
select ok(current_setting('t.e1')::uuid is not null, 'a treasurer records a USDC expense');
select throws_ok(format($$select public.record_club_expense(84532, 'USDC', 5000000, %L, 1, 'Otra vez', 'usdc_log', %L)$$,
  tests.hash(1), current_setting('t.a')), 'P0001', 'tx_already_used', 'repeating (chain, hash, log index) is tx_already_used');
select lives_ok(format($$select public.record_club_expense(84532, 'USDC', 1000000, %L, 2, 'Segunda transferencia', 'usdc_log', %L)$$,
  tests.hash(1), current_setting('t.a')), 'another log of the same hash is a different expense');
select lives_ok(format($$select public.record_club_expense(84532, 'ETH', 20000000000000000, %L, -1, 'Gas de la Safe', 'safe_tx', %L)$$,
  tests.hash(2), current_setting('t.a')), 'an ETH expense records with log index -1');
select throws_ok(format($$select public.record_club_expense(84532, 'USDC', 5000000, %L, 3, %L, 'usdc_log', %L)$$,
  tests.hash(3), repeat('x', 281), current_setting('t.a')), 'P0001', 'invalid_input', 'a note over 280 characters is invalid_input');
select throws_ok(format($$select public.record_club_expense(84532, 'USDC', 5000000, %L, 3, '   ', 'usdc_log', %L)$$,
  tests.hash(3), current_setting('t.a')), 'P0001', 'invalid_input', 'a blank note is invalid_input');
select throws_ok(format($$select public.record_club_expense(84532, 'ETH', 5, %L, 0, 'x', 'safe_tx', %L)$$,
  tests.hash(4), current_setting('t.a')), 'P0001', 'invalid_input', 'an ETH expense needs log index -1');
select throws_ok(format($$select public.record_club_expense(1, 'USDC', 5, %L, 1, 'x', 'usdc_log', %L)$$,
  tests.hash(5), current_setting('t.a')), 'P0001', 'chain_invalid', 'an unknown network is chain_invalid');
reset role;

-- ===== 3. reads and notes =====
select tests.authenticate_as(current_setting('t.um')::uuid);
select is((select count(*)::int from public.club_expenses_list()), 3, 'a member reads the three expenses');
select results_eq($$select amount, note, recorder_label from public.club_expenses_list() where token = 'USDC' and amount = '5000000'$$,
  format($$values ('5000000'::text, 'Servidor del mes'::text, public._member_label(%L))$$, current_setting('t.a')),
  'the list carries the amount as text, the trimmed note and the recorder label');
select throws_ok(format($$select public.set_club_expense_note(%L, 'Hackeado')$$, current_setting('t.e1')), 'P0001', 'forbidden',
  'a member without MANAGE_TREASURY cannot change a note');
select tests.authenticate_as(current_setting('t.stranger')::uuid);
select throws_ok($$select * from public.club_expenses_list()$$, 'P0001', 'forbidden', 'a wallet without membership cannot read the list');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($$select public.set_club_expense_note(%L, 'Servidor y dominio')$$, current_setting('t.e1')), 'a treasurer changes the note');
select throws_ok($$select public.set_club_expense_note(gen_random_uuid(), 'x')$$, 'P0001', 'not_found', 'an unknown expense is not_found');
select tests.clear_authentication();
select ok(exists (select 1 from public.audit_log where action = 'expense_noted' and target_id = current_setting('t.e1')::uuid)
      and exists (select 1 from public.audit_log where action = 'expense_recorded' and target_id = current_setting('t.e1')::uuid),
  'recording and noting leave audit_log rows');

select * from finish();
rollback;
