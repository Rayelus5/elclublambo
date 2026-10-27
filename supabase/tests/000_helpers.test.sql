-- Test helpers (schema `tests`). Intentionally NO begin/rollback: these
-- definitions must persist for the test files that run after this one.
create schema if not exists tests;

create or replace function tests.create_wallet_user(p_address text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, raw_app_meta_data, created_at, updated_at
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    '{"provider":"web3","providers":["web3"]}'::jsonb, now(), now()
  );

  insert into auth.identities (
    provider, provider_id, user_id, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    'web3', 'web3:ethereum:' || p_address, v_id,
    jsonb_build_object('custom_claims', jsonb_build_object(
      'address', p_address, 'chain', 'ethereum', 'network', '59141')),
    now(), now(), now()
  );

  return v_id;
end;
$$;

create or replace function tests.create_member(
  p_address text,
  p_invited_by uuid default null,
  p_bootstrap boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_user uuid := tests.create_wallet_user(p_address);
  v_member uuid := gen_random_uuid();
begin
  insert into public.members (id, auth_user_id, wallet_address, invited_by_member_id, is_bootstrap)
  values (v_member, v_user, lower(p_address), p_invited_by, p_bootstrap);
  return v_member;
end;
$$;

create or replace function tests.authenticate_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function tests.create_channel(p_parent uuid, p_kind text, p_name text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.channels (id, parent_id, kind, name) values (v_id, p_parent, p_kind, p_name);
  return v_id;
end;
$$;

-- records a verified donation of p_usd6 (usd6) for a member, straight into public.donations (P1 gates read it)
create or replace function tests.give(p_member uuid, p_usd6 numeric)
returns void
language plpgsql
as $$
declare
  v_intent uuid := gen_random_uuid();
  v_hash text := '0x' || md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
begin
  insert into public.payment_intents (id, member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
    recipient_address, target_type, status, main_tx_hash)
  values (v_intent, p_member, 'donation', 84532, 'USDC', greatest(p_usd6, 1), 0, 0, 0,
    '0x' || repeat('a', 40), 'dao', 'confirmed', v_hash);
  insert into public.donations (intent_id, chain_id, token, amount, usd6, price_source, member_id, donor_address,
    tx_hash, log_index, block_number)
  values (v_intent, 84532, 'USDC', greatest(p_usd6, 1), p_usd6, 'usdc', p_member,
    '0x' || repeat('b', 40), v_hash, 1, 1);
end;
$$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

select plan(1);
select ok(true);
select * from finish();
