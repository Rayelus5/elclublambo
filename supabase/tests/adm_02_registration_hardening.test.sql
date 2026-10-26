-- Administración Task 7 fix (migration 20261026100002): a held account (registration closed ∧ hold ∧ no members row)
-- cannot act through the service-role RPCs, where auth.uid() is null and is_public_account() never runs.
--   - private.registration_blocked_for(uuid): the shared rule; my_registration_blocked() is that rule for auth.uid().
--   - enter_public_giveaway refuses a held p_user; record_public_giveaway_payout a held p_actor;
--     mark_public_prize_delivered a held caller ('forbidden').
--   - is_public_account() also needs the auth user to still exist.
begin;
select plan(19);

create function pg_temp.set_registration(p_open boolean) returns void language sql as $$
  update public.app_config set value = jsonb_set(value, '{registration}', to_jsonb(p_open)) where key = 'site_switches'
$$;
create function pg_temp.payout() returns jsonb language sql immutable as $$
  select jsonb_build_object('txHash', '0x' || lpad('ab', 64, '0'), 'logIndex', '0', 'blockNumber', '1')
$$;

-- ===== privileges =====
select ok(not has_function_privilege('anon', 'private.registration_blocked_for(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.registration_blocked_for(uuid)', 'execute')
      and not has_function_privilege('service_role', 'private.registration_blocked_for(uuid)', 'execute'),
  'private.registration_blocked_for is executable by no API role');
select ok(has_function_privilege('authenticated', 'public.my_registration_blocked()', 'execute')
      and not has_function_privilege('anon', 'public.my_registration_blocked()', 'execute'),
  'my_registration_blocked keeps its grants (authenticated only)');

-- ===== fixtures: made while registration is open =====
select set_config('t.admin', tests.create_member('0xad02000000000000000000000000000000000000', null, true)::text, true);
select set_config('t.host', tests.create_wallet_user('0xad02000000000000000000000000000000000001')::text, true);
select set_config('t.old', tests.create_wallet_user('0xad02000000000000000000000000000000000002')::text, true);
select tests.authenticate_as(current_setting('t.host')::uuid);
select set_config('t.g', public.create_public_giveaway('Sorteo', null, now() + interval '1 hour', null, 0, null,
  '[{"kind":"custom","label":"Camiseta"}]'::jsonb)::text, true);
select tests.clear_authentication();

-- ===== registration closed =====
select pg_temp.set_registration(false);
select set_config('t.held', tests.create_wallet_user('0xad02000000000000000000000000000000000003')::text, true);
select set_config('t.member', tests.create_member('0xad02000000000000000000000000000000000004', current_setting('t.admin')::uuid)::text, true);

select is(private.registration_blocked_for(current_setting('t.held')::uuid), true, 'a user made while closed is held');
select is(private.registration_blocked_for(current_setting('t.old')::uuid), false, 'a user made while open is not held');
select is(private.registration_blocked_for((select auth_user_id from public.members where id = current_setting('t.member')::uuid)),
  false, 'a member made while closed is not held');
select is(private.registration_blocked_for(null), false, 'null is not held');

select tests.authenticate_as(current_setting('t.held')::uuid);
select is(public.my_registration_blocked(), true, 'my_registration_blocked is the shared rule for auth.uid()');
select is(public.is_public_account(), false, 'a held user is not a public account');
select throws_ok(format($$select public.mark_public_prize_delivered(%L)$$, gen_random_uuid()), 'P0001', 'forbidden',
  'mark_public_prize_delivered refuses a held caller');
select tests.clear_authentication();

-- enter_public_giveaway (service role)
select throws_ok(format($$select public.enter_public_giveaway(%L, %L, %L)$$, current_setting('t.g'), current_setting('t.held'),
  '0xad02000000000000000000000000000000000003'), 'P0001', 'forbidden', 'enter_public_giveaway refuses a held p_user');
select is((select count(*)::int from public.public_giveaway_entries where user_id = current_setting('t.held')::uuid), 0,
  'the held user has no entry');
select is(public.enter_public_giveaway(current_setting('t.g')::uuid, current_setting('t.old')::uuid,
  '0xad02000000000000000000000000000000000002'), 'entered', 'an account made while open still enters while closed');

-- record_public_giveaway_payout (service role)
select throws_ok(format($$select public.record_public_giveaway_payout(%L, %L, %L)$$, gen_random_uuid(), pg_temp.payout(),
  current_setting('t.held')), 'P0001', 'forbidden', 'record_public_giveaway_payout refuses a held p_actor');
select throws_ok(format($$select public.record_public_giveaway_payout(%L, %L, %L)$$, gen_random_uuid(), pg_temp.payout(),
  current_setting('t.host')), 'P0001', 'not_found', 'a non-held host goes on past the check');

select tests.authenticate_as(current_setting('t.host')::uuid);
select throws_ok(format($$select public.mark_public_prize_delivered(%L)$$, gen_random_uuid()), 'P0001', 'not_found',
  'mark_public_prize_delivered: a non-held host goes on past the check');
select tests.clear_authentication();

-- ===== reopening clears the holds =====
select pg_temp.set_registration(true);
delete from public.registration_holds where true;
select is(private.registration_blocked_for(current_setting('t.held')::uuid), false, 'reopened: nobody is held');
select is(public.enter_public_giveaway(current_setting('t.g')::uuid, current_setting('t.held')::uuid,
  '0xad02000000000000000000000000000000000003'), 'entered', 'reopened: the former held user enters');

-- ===== is_public_account needs the auth user to still exist =====
select set_config('t.gone', tests.create_wallet_user('0xad02000000000000000000000000000000000005')::text, true);
select tests.authenticate_as(current_setting('t.gone')::uuid);
select is(public.is_public_account(), true, 'an existing account is a public account');
select tests.clear_authentication();
delete from auth.users where id = current_setting('t.gone')::uuid;
select tests.authenticate_as(current_setting('t.gone')::uuid);
select is(public.is_public_account(), false, 'a deleted auth user (a leftover JWT) is not a public account');
select tests.clear_authentication();

select * from finish();
rollback;
