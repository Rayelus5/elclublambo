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
    jsonb_build_object('address', p_address, 'chain', 'ethereum', 'network', 59141),
    now(), now(), now()
  );

  return v_id;
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

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

select plan(1);
select ok(true);
select * from finish();
