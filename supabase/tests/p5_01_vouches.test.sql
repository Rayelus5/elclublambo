-- P5 Task 2 (migration 20261025500001): EAS vouches on Base (P5-R5, P5-R5b, P5-R5c).
--   - public.vouches: one row per attestation uid; public read (RLS) of non-revoked rows only; no client writes.
--   - record_vouch / apply_vouch_state / vouches_for / vouches_given_by / vouch_attester: service_role only.
--   - rate_limit_hit('vouch_write') 30 / 10 min per session; ip_rate_limit_hit(..., 'vouch_refresh') 30 / 10 min per IP.
begin;
select plan(66);

create function tests.vh(p_n int) returns text language sql immutable as $$ select '0x' || lpad(to_hex(p_n), 64, '0') $$;
create function tests.va(p_n int) returns text language sql immutable as $$ select '0x' || lpad(to_hex(p_n), 40, '0') $$;
-- runs p_sql (an expression) as service_role and returns it as jsonb
create function tests.sr(p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  set local role service_role;
  execute 'select to_jsonb(' || p_sql || ')' into v;
  reset role;
  return v;
end;
$$;

-- ===== 1. privileges =====
select ok(not has_table_privilege('anon', 'public.vouches', 'insert') and not has_table_privilege('anon', 'public.vouches', 'update')
      and not has_table_privilege('anon', 'public.vouches', 'delete')
      and not has_table_privilege('authenticated', 'public.vouches', 'insert') and not has_table_privilege('authenticated', 'public.vouches', 'update')
      and not has_table_privilege('authenticated', 'public.vouches', 'delete'),
  'anon / authenticated cannot write vouches');
select ok(has_table_privilege('anon', 'public.vouches', 'select') and has_table_privilege('authenticated', 'public.vouches', 'select'),
  'anon / authenticated can select vouches (RLS filters)');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.vouches'::regclass), 'RLS on vouches');
select ok(not exists (
  select 1 from unnest(array[
    'public.record_vouch(int,text,text,text,int,text,timestamptz,timestamptz)', 'public.apply_vouch_state(text,text,timestamptz)',
    'public.vouches_for(text)', 'public.vouches_given_by(text)', 'public.vouch_attester(text)']) f
  where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
     or not has_function_privilege('service_role', f, 'execute')),
  'the five vouch functions: service_role only');

set local role anon;
select throws_ok($$select public.record_vouch(8453, tests.vh(1), tests.va(1), tests.va(2), 1, tests.vh(100), now(), null)$$, '42501', null, 'anon cannot call record_vouch');
select throws_ok($$select public.apply_vouch_state(tests.vh(1), 'active', null)$$, '42501', null, 'anon cannot call apply_vouch_state');
select throws_ok($$select public.vouches_for(tests.va(2))$$, '42501', null, 'anon cannot call vouches_for');
select throws_ok($$select public.vouches_given_by(tests.va(1))$$, '42501', null, 'anon cannot call vouches_given_by');
select throws_ok($$select public.vouch_attester(tests.vh(1))$$, '42501', null, 'anon cannot call vouch_attester');
select throws_ok($$insert into public.vouches (chain_id, uid, attester, recipient, kind, tx_hash, attested_at)
  values (8453, tests.vh(1), tests.va(1), tests.va(2), 1, tests.vh(100), now())$$, '42501', null, 'anon cannot insert');
reset role;
set local role authenticated;
select throws_ok($$select public.record_vouch(8453, tests.vh(1), tests.va(1), tests.va(2), 1, tests.vh(100), now(), null)$$, '42501', null, 'authenticated cannot call record_vouch');
select throws_ok($$select public.apply_vouch_state(tests.vh(1), 'removed', null)$$, '42501', null, 'authenticated cannot call apply_vouch_state');
select throws_ok($$select public.vouches_for(tests.va(2))$$, '42501', null, 'authenticated cannot call vouches_for');
select throws_ok($$select public.vouches_given_by(tests.va(1))$$, '42501', null, 'authenticated cannot call vouches_given_by');
select throws_ok($$select public.vouch_attester(tests.vh(1))$$, '42501', null, 'authenticated cannot call vouch_attester');
select throws_ok($$update public.vouches set kind = 2$$, '42501', null, 'authenticated cannot update');
select throws_ok($$delete from public.vouches$$, '42501', null, 'authenticated cannot delete');
reset role;

-- ===== 2. record_vouch =====
select is(tests.sr($$public.record_vouch(8453, upper(tests.vh(1)), upper(tests.va(1)), upper(tests.va(9)), 1, tests.vh(101), '2026-10-01Z', null)$$),
  jsonb_build_object('already', false, 'uid', tests.vh(1)), 'first call inserts; reports already = false and the lowercase uid');
select is((select row(v.attester, v.recipient, v.uid, v.tx_hash)::text from public.vouches v where v.uid = tests.vh(1)),
  row(tests.va(1), tests.va(9), tests.vh(1), tests.vh(101))::text, 'everything is stored in lowercase');
select is(tests.sr($$public.record_vouch(8453, tests.vh(1), tests.va(1), tests.va(9), 1, tests.vh(101), '2026-10-01Z', null)$$),
  jsonb_build_object('already', true, 'uid', tests.vh(1)), 'same uid again: already = true');
select is((select count(*)::int from public.vouches where uid = tests.vh(1)), 1, 'and still one row');
select throws_ok($$select tests.sr($q$public.record_vouch(8453, tests.vh(2), tests.va(1), tests.va(1), 1, tests.vh(102), now(), null)$q$)$$,
  'P0001', 'self_vouch', 'attester = recipient: self_vouch');
select throws_ok($$select tests.sr($q$public.record_vouch(8453, tests.vh(2), tests.va(1), upper(tests.va(1)), 1, tests.vh(102), now(), null)$q$)$$,
  'P0001', 'self_vouch', 'self_vouch ignores case');
select throws_ok($$select tests.sr($q$public.record_vouch(42161, tests.vh(2), tests.va(1), tests.va(3), 1, tests.vh(102), now(), null)$q$)$$,
  'P0001', 'invalid_input', 'Arbitrum is not a vouch network');
select throws_ok($$select tests.sr($q$public.record_vouch(8453, '0x12', tests.va(1), tests.va(3), 1, tests.vh(102), now(), null)$q$)$$,
  'P0001', 'invalid_input', 'bad uid');
select throws_ok($$select tests.sr($q$public.record_vouch(8453, tests.vh(2), 'nope', tests.va(3), 1, tests.vh(102), now(), null)$q$)$$,
  'P0001', 'invalid_input', 'bad attester');
select throws_ok($$select tests.sr($q$public.record_vouch(8453, tests.vh(2), tests.va(1), tests.va(3), 256, tests.vh(102), now(), null)$q$)$$,
  'P0001', 'invalid_input', 'kind out of range');
select throws_ok($$select tests.sr($q$public.record_vouch(8453, tests.vh(2), tests.va(1), tests.va(3), 1, 'zz', now(), null)$q$)$$,
  'P0001', 'invalid_input', 'bad tx hash');
set local role service_role;
select throws_ok($$insert into public.vouches (chain_id, uid, attester, recipient, kind, tx_hash, attested_at)
  values (8453, tests.vh(3), tests.va(1), tests.va(1), 1, tests.vh(103), now())$$, '23514', null, 'the table check also blocks a direct self-vouch');
select throws_ok($$insert into public.vouches (chain_id, uid, attester, recipient, kind, tx_hash, attested_at)
  values (42161, tests.vh(3), tests.va(1), tests.va(3), 1, tests.vh(103), now())$$, '23514', null, 'the table blocks chain 42161');
reset role;

-- ===== 3. vouches_for =====
-- recipient va(20): kind 1 from va(1) (twice, two uids) and va(2); kind 9 from va(3); kind 2 from va(1) revoked.
select tests.sr($$public.record_vouch(8453, tests.vh(11), tests.va(1), tests.va(20), 1, tests.vh(111), '2026-10-01Z', null)$$);
select tests.sr($$public.record_vouch(84532, tests.vh(12), tests.va(1), tests.va(20), 1, tests.vh(112), '2026-10-02Z', null)$$);
select tests.sr($$public.record_vouch(8453, tests.vh(13), tests.va(2), tests.va(20), 1, tests.vh(113), '2026-10-03Z', null)$$);
select tests.sr($$public.record_vouch(8453, tests.vh(14), tests.va(3), tests.va(20), 9, tests.vh(114), '2026-10-04Z', null)$$);
select tests.sr($$public.record_vouch(8453, tests.vh(15), tests.va(1), tests.va(20), 2, tests.vh(115), '2026-10-05Z', '2026-10-06Z')$$);
select set_config('t.u2', tests.create_wallet_user(tests.va(2))::text, true);
insert into public.public_profiles (user_id, alias, wallet_address) values (current_setting('t.u2')::uuid, 'ana_pay', tests.va(2));

select is(tests.sr($$public.vouches_for(upper(tests.va(20)))$$) -> 'counts',
  '[{"kind": 1, "attesters": 2}, {"kind": 9, "attesters": 1}]'::jsonb,
  'counts: distinct attesters per kind (a repeated attester counts once), kind 9 listed, revoked kind 2 absent');
select is((tests.sr($$public.vouches_for(tests.va(20))$$) ->> 'total')::int, 3, 'total: distinct attesters, revoked ones excluded');
select is(jsonb_array_length(tests.sr($$public.vouches_for(tests.va(20))$$) -> 'items'), 4, 'items: the 4 live vouches');
select is(tests.sr($$public.vouches_for(tests.va(20))$$) -> 'items' -> 0,
  jsonb_build_object('uid', tests.vh(14), 'chainId', 8453, 'kind', 9, 'attester', tests.va(3), 'attesterAlias', null,
    'attestedAt', to_jsonb('2026-10-04Z'::timestamptz), 'txHash', tests.vh(114)),
  'items: newest first, with the exact shape; no alias -> null');
select is(tests.sr($$public.vouches_for(tests.va(20))$$) -> 'items' -> 1 ->> 'attesterAlias', 'ana_pay', 'attesterAlias comes from the Pay profile');
select is(tests.sr($$public.vouches_for(tests.va(77))$$), '{"counts": [], "total": 0, "items": []}'::jsonb, 'no vouches: empty shape');
select throws_ok($$select tests.sr($q$public.vouches_for('nope')$q$)$$, 'P0001', 'invalid_input', 'vouches_for: bad address');

-- ===== 4. vouches_given_by / vouch_attester =====
select is(tests.sr($$public.vouches_given_by(tests.va(1))$$),
  jsonb_build_array(
    jsonb_build_object('uid', tests.vh(12), 'chainId', 84532, 'kind', 1, 'recipient', tests.va(20), 'recipientAlias', null,
      'attestedAt', to_jsonb('2026-10-02Z'::timestamptz)),
    jsonb_build_object('uid', tests.vh(1), 'chainId', 8453, 'kind', 1, 'recipient', tests.va(9), 'recipientAlias', null,
      'attestedAt', to_jsonb('2026-10-01Z'::timestamptz)),
    jsonb_build_object('uid', tests.vh(11), 'chainId', 8453, 'kind', 1, 'recipient', tests.va(20), 'recipientAlias', null,
      'attestedAt', to_jsonb('2026-10-01Z'::timestamptz))), 'vouches_given_by: live ones only, newest first');
select is(tests.sr($$public.vouches_given_by(tests.va(78))$$), '[]'::jsonb, 'vouches_given_by: none -> []');
select is(tests.sr($$public.vouch_attester(upper(tests.vh(13)))$$), to_jsonb(tests.va(2)), 'vouch_attester returns the attester');
select is(tests.sr($$public.vouch_attester(tests.vh(999))$$), null, 'vouch_attester: unknown uid -> null');

-- ===== 5. public read =====
set local role anon;
select is((select count(*)::int from public.vouches), 5, 'anon reads only the non-revoked rows (5 of 6)');
select is((select count(*)::int from public.vouches where uid = tests.vh(15)), 0, 'the revoked row is invisible');
reset role;

-- ===== 6. apply_vouch_state =====
select is(tests.sr($$public.apply_vouch_state(tests.vh(11), 'revoked', '2026-10-07Z')$$), to_jsonb('revoked'::text), 'revoked is applied');
select is((select revoked_at from public.vouches where uid = tests.vh(11)), '2026-10-07Z'::timestamptz, 'revoked_at is set');
select tests.sr($$public.apply_vouch_state(tests.vh(11), 'revoked', '2026-10-09Z')$$);
select is((select revoked_at from public.vouches where uid = tests.vh(11)), '2026-10-07Z'::timestamptz, 'a second revoke does not change revoked_at');
select is(tests.sr($$public.apply_vouch_state(tests.vh(12), 'active', null)$$), to_jsonb('active'::text), 'active is applied');
select is((select revoked_at from public.vouches where uid = tests.vh(12)), null, 'active changes nothing');
-- A zero read right after recording may come from a lagging RPC node: rows younger than 10 minutes are never deleted,
-- the current state is returned instead.
select is(tests.sr($$public.apply_vouch_state(tests.vh(12), 'removed', null)$$), to_jsonb('active'::text), 'removed on a row younger than 10 min: active');
select is((select count(*)::int from public.vouches where uid = tests.vh(12)), 1, 'and the young row is kept');
select is(tests.sr($$public.apply_vouch_state(tests.vh(11), 'removed', null)$$), to_jsonb('revoked'::text), 'removed on a young revoked row: revoked');
select is((select count(*)::int from public.vouches where uid = tests.vh(11)), 1, 'and the young revoked row is kept');
update public.vouches set created_at = now() - interval '10 minutes 1 second' where uid = tests.vh(12);
select is(tests.sr($$public.apply_vouch_state(tests.vh(12), 'removed', null)$$), to_jsonb('removed'::text), 'removed is applied');
select is((select count(*)::int from public.vouches where uid = tests.vh(12)), 0, 'removed deletes the row');
select is(tests.sr($$public.apply_vouch_state(tests.vh(12), 'removed', null)$$), to_jsonb('not_found'::text), 'unknown uid: not_found');
select throws_ok($$select tests.sr($q$public.apply_vouch_state(tests.vh(1), 'weird', null)$q$)$$, 'P0001', 'invalid_input', 'unknown state');

-- ===== 7. alias tie-break (as the Pay page: the most recently updated profile of a wallet) =====
select set_config('t.u2b', tests.create_wallet_user(tests.va(42))::text, true);
insert into public.public_profiles (user_id, alias, wallet_address, created_at, updated_at)
  values (current_setting('t.u2b')::uuid, 'ana_old', tests.va(2), '2026-01-01Z', '2026-01-01Z');
select tests.sr($$public.record_vouch(8453, tests.vh(16), tests.va(5), tests.va(2), 3, tests.vh(116), '2026-10-08Z', null)$$);
select is((select i ->> 'attesterAlias' from jsonb_array_elements(tests.sr($$public.vouches_for(tests.va(20))$$) -> 'items') i
            where i ->> 'attester' = tests.va(2)), 'ana_pay', 'vouches_for: two profiles for one wallet -> the latest updated alias');
select is(tests.sr($$public.vouches_given_by(tests.va(5))$$) -> 0 ->> 'recipientAlias', 'ana_pay',
  'vouches_given_by: two profiles for one wallet -> the latest updated alias');

-- ===== 8. rate limits =====
select set_config('t.u1', tests.create_wallet_user(tests.va(1))::text, true);
select tests.authenticate_as(current_setting('t.u1')::uuid);
select lives_ok($$select public.rate_limit_hit('vouch_write') from generate_series(1, 30)$$, '30 vouch_write hits pass');
select throws_ok($$select public.rate_limit_hit('vouch_write')$$, 'P0001', 'rate_limited', 'the 31st vouch_write hit is rate_limited');
select lives_ok($$select public.rate_limit_hit('chain_verify')$$, 'chain_verify still works');
select lives_ok($$select public.rate_limit_hit('redeem_invite')$$, 'redeem_invite still works');
select throws_ok($$select public.rate_limit_hit('nope')$$, 'P0001', 'invalid_input', 'unknown bucket still invalid_input');
select tests.clear_authentication();
set local role service_role;
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('e', 32), 'vouch_refresh') from generate_series(1, 30)$$, '30 vouch_refresh hits pass');
select throws_ok($$select public.ip_rate_limit_hit('ip:' || repeat('e', 32), 'vouch_refresh')$$, 'P0001', 'rate_limited', 'the 31st vouch_refresh hit is rate_limited');
select lives_ok($$select public.ip_rate_limit_hit('ip:' || repeat('e', 32), 'checker_web'), public.ip_rate_limit_hit('ip:' || repeat('e', 32), 'api_free'),
  public.ip_rate_limit_hit('ip:' || repeat('e', 32), 'api_paid_attempt')$$, 'the old IP buckets still work');
reset role;

select * from finish();
rollback;
