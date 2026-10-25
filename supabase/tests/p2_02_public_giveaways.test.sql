-- P2 Task 4 (migration 20261025100002): public giveaways for any wallet account (P2-R3, P2-R6, P2-R12, P2-R14).
--   - create_public_giveaway: public account only (a banned club member is not), 5 / day, <= 10 open per host,
--     closes_at in [now + 10 min, now + 90 days], 1..10 prizes (crypto USDC on an enabled network, or custom text),
--     allowlist normalised and deduped, seed_commit = keccak256(private seed), target_round as P1.
--   - enter_public_giveaway: service role only; open and before closes_at, not banned, the user's own wallet,
--     allowlist, 5000 cap, idempotent ('entered' / 'already').
--   - leave / cancel / public_giveaway_view / my_public_giveaways; no direct table reads; nothing for anon.
begin;
select plan(49);

create function tests.pg2_create(p_closes interval, p_prizes jsonb, p_allow text[] default null)
returns uuid language sql as $$
  select public.create_public_giveaway('Sorteo público', null, now() + p_closes, null, 0, p_allow, p_prizes)
$$;
create function tests.pg2_enter(p_id uuid, p_user uuid, p_wallet text) returns text language plpgsql as $$
declare
  v text;
begin
  set local role service_role;
  v := public.enter_public_giveaway(p_id, p_user, p_wallet);
  reset role;
  return v;
end;
$$;
create function tests.pg2_view(p_id uuid, p_viewer uuid) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  set local role service_role;
  v := public.public_giveaway_view(p_id, p_viewer);
  reset role;
  return v;
end;
$$;

-- ===== fixtures =====
select set_config('t.ha', '0x' || lpad('b2b01', 40, '0'), true);
select set_config('t.hb', '0x' || lpad('b2b02', 40, '0'), true);
select set_config('t.pa', '0x' || lpad('b2b03', 40, '0'), true);
select set_config('t.pb', '0x' || lpad('b2b04', 40, '0'), true);
select set_config('t.host_a', tests.create_wallet_user(current_setting('t.ha'))::text, true);
select set_config('t.host_b', tests.create_wallet_user(current_setting('t.hb'))::text, true);
select set_config('t.p1', tests.create_wallet_user(current_setting('t.pa'))::text, true);
select set_config('t.p2', tests.create_wallet_user(current_setting('t.pb'))::text, true);
select set_config('t.boot', tests.create_member('0x' || lpad('b2b05', 40, '0'), null, true)::text, true);
select set_config('t.banned', tests.create_member('0x' || lpad('b2b06', 40, '0'), current_setting('t.boot')::uuid, false)::text, true);
update public.members set status = 'banned' where id = current_setting('t.banned')::uuid;
select set_config('t.ubanned', (select auth_user_id::text from public.members where id = current_setting('t.banned')::uuid), true);

-- ===== 1. privileges =====
select ok(not has_function_privilege('anon', 'public.create_public_giveaway(text,text,timestamptz,text,int,text[],jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.cancel_public_giveaway(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.enter_public_giveaway(uuid,uuid,text)', 'execute')
      and not has_function_privilege('anon', 'public.leave_public_giveaway(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.public_giveaway_view(uuid,uuid)', 'execute')
      and not has_function_privilege('anon', 'public.my_public_giveaways(int)', 'execute'),
  'anon cannot execute any of the new functions');
select ok(has_function_privilege('authenticated', 'public.create_public_giveaway(text,text,timestamptz,text,int,text[],jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.cancel_public_giveaway(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.leave_public_giveaway(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.my_public_giveaways(int)', 'execute')
      and not has_function_privilege('authenticated', 'public.enter_public_giveaway(uuid,uuid,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.public_giveaway_view(uuid,uuid)', 'execute'),
  'authenticated: create / cancel / leave / mine, not enter nor view');
select ok(has_function_privilege('service_role', 'public.enter_public_giveaway(uuid,uuid,text)', 'execute')
      and has_function_privilege('service_role', 'public.public_giveaway_view(uuid,uuid)', 'execute'),
  'service_role: enter and view');
select ok(not has_table_privilege('service_role', 'private.public_giveaway_seeds', 'select')
      and not has_table_privilege('authenticated', 'public.public_giveaways', 'select')
      and not has_table_privilege('anon', 'public.public_giveaway_prizes', 'select')
      and not has_table_privilege('authenticated', 'public.public_giveaway_allowlist', 'select'),
  'seeds out of reach even of service_role; tables closed to the API roles');
select ok((select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.public_giveaways'::regclass, 'public.public_giveaway_prizes'::regclass,
                           'public.public_giveaway_entries'::regclass, 'public.public_giveaway_allowlist'::regclass,
                           'private.public_giveaway_seeds'::regclass)),
  'RLS on every new table');

-- ===== 2. create =====
select tests.authenticate_as(current_setting('t.host_a')::uuid);
select set_config('t.g1', public.create_public_giveaway('  Gran sorteo  ', 'Dos premios', now() + interval '1 hour',
  '  Club Lambo  ', 3, null,
  '[{"kind":"crypto","chainId":84532,"amount":"5000000"},{"kind":"custom","label":"Camiseta"}]'::jsonb)::text, true);
select tests.clear_authentication();
select isnt(nullif(current_setting('t.g1'), '')::uuid, null, 'a valid create returns the new id');
select is((select g.seed_commit from public.public_giveaways g where g.id = current_setting('t.g1')::uuid),
          (select '0x' || encode(public._keccak256(s.seed), 'hex') from private.public_giveaway_seeds s
           where s.giveaway_id = current_setting('t.g1')::uuid),
  'seed_commit = keccak256(private seed)');
select is((select g.title || '|' || g.host_name || '|' || g.host_address || '|' || g.status || '|' || g.min_tx_count
                  || '|' || g.has_allowlist || '|' || (g.target_round = public._giveaway_target_round(g.closes_at))
           from public.public_giveaways g where g.id = current_setting('t.g1')::uuid),
          'Gran sorteo|Club Lambo|' || current_setting('t.ha') || '|open|3|false|true',
  'trimmed title and host name, host wallet, open, min_tx_count, no allowlist, target_round as P1');
select results_eq($$select rank, kind, label, coalesce(token, '-'), coalesce(amount::text, '-'), status
                    from public.public_giveaway_prizes where giveaway_id = current_setting('t.g1')::uuid order by rank$$,
  $$values (1, 'crypto'::text, '5 USDC'::text, 'USDC'::text, '5000000'::text, 'pending'::text),
           (2, 'custom', 'Camiseta', '-', '-', 'pending')$$,
  'prizes ranked in array order, crypto label defaults to the amount');

select tests.authenticate_as(current_setting('t.host_a')::uuid);
select throws_ok($$select tests.pg2_create('5 minutes', '[{"kind":"custom","label":"x"}]')$$,
  'P0001', 'invalid_input', 'closing in 5 minutes is refused');
select throws_ok($$select tests.pg2_create('91 days', '[{"kind":"custom","label":"x"}]')$$,
  'P0001', 'invalid_input', 'closing in 91 days is refused');
select throws_ok($$select tests.pg2_create('1 hour', (select jsonb_agg(jsonb_build_object('kind', 'custom', 'label', 'P' || i))
                                                     from generate_series(1, 11) i))$$,
  'P0001', 'invalid_input', '11 prizes is refused');
select throws_ok($$select tests.pg2_create('1 hour', '[]')$$, 'P0001', 'invalid_input', 'no prizes is refused');
select throws_ok($$select tests.pg2_create('1 hour', '[{"kind":"crypto","chainId":84532}]')$$,
  'P0001', 'invalid_input', 'a crypto prize without amount is refused');
select throws_ok($$select tests.pg2_create('1 hour', '[{"kind":"crypto","chainId":84532,"amount":"1","token":"WETH"}]')$$,
  'P0001', 'invalid_input', 'a crypto prize in another token is refused');
select throws_ok($$select tests.pg2_create('1 hour', '[{"kind":"role","label":"Rol"}]')$$,
  'P0001', 'invalid_input', 'a role prize does not exist in public giveaways');
select throws_ok($$select tests.pg2_create('1 hour', '[{"kind":"crypto","chainId":59144,"amount":"1000000"}]')$$,
  'P0001', 'chain_invalid', 'a crypto prize on a disabled network is chain_invalid');
select throws_ok($$select tests.pg2_create('1 hour', '[{"kind":"custom","label":"x"}]', array['0x123'])$$,
  'P0001', 'invalid_input', 'an invalid allowlist address is refused');
select throws_ok($$select tests.pg2_create('1 hour', '[{"kind":"custom","label":"x"}]',
                   (select array_agg('0x' || lpad(to_hex(i), 40, '0')) from generate_series(1, 2001) i))$$,
  'P0001', 'invalid_input', 'more than 2000 allowlist addresses is refused');
select throws_ok($$select public.create_public_giveaway('T', null, now() + interval '1 hour', repeat('n', 61), 0, null,
                   '[{"kind":"custom","label":"x"}]')$$,
  'P0001', 'invalid_input', 'a host name over 60 characters is refused');
select throws_ok($$select public.create_public_giveaway('T', null, now() + interval '1 hour', null, 1001, null,
                   '[{"kind":"custom","label":"x"}]')$$,
  'P0001', 'invalid_input', 'min_tx_count over 1000 is refused');
-- G2: allowlist, mixed case, padded and duplicated
select set_config('t.g2', tests.pg2_create('1 hour', '[{"kind":"custom","label":"Lista"}]',
  array[upper(current_setting('t.pb')), '  ' || current_setting('t.pb') || ' ', '0x' || lpad('b2bff', 40, '0')])::text, true);
-- G3 (moved past closes_at below), G4 (cancelled), G5 (full): five creates today
select set_config('t.g3', tests.pg2_create('1 hour', '[{"kind":"custom","label":"Tarde"}]')::text, true);
select set_config('t.g4', tests.pg2_create('1 hour', '[{"kind":"custom","label":"Cancelado"}]')::text, true);
select set_config('t.g5', tests.pg2_create('1 hour', '[{"kind":"custom","label":"Lleno"}]')::text, true);
select throws_ok($$select tests.pg2_create('1 hour', '[{"kind":"custom","label":"Sexto"}]')$$,
  'P0001', 'rate_limited', 'the sixth create of the day is rate_limited');
select tests.clear_authentication();
select results_eq($$select address from public.public_giveaway_allowlist
                    where giveaway_id = current_setting('t.g2')::uuid order by address$$,
  $$values (current_setting('t.pb')), ('0x' || lpad('b2bff', 40, '0'))$$,
  'the allowlist is lower-cased, trimmed and deduped');
select is((select has_allowlist from public.public_giveaways where id = current_setting('t.g2')::uuid), true,
  'has_allowlist is set');

select tests.authenticate_as(current_setting('t.ubanned')::uuid);
select throws_ok($$select tests.pg2_create('1 hour', '[{"kind":"custom","label":"x"}]')$$,
  'P0001', 'forbidden', 'a banned club member cannot create');
select tests.clear_authentication();

insert into public.public_giveaways (host_user_id, host_address, title, closes_at, seed_commit, target_round)
select current_setting('t.host_b')::uuid, current_setting('t.hb'), 'Abierto ' || i, now() + interval '1 day',
       '0x' || repeat('0', 64), 1
from generate_series(1, 10) i;
select tests.authenticate_as(current_setting('t.host_b')::uuid);
select throws_ok($$select tests.pg2_create('1 hour', '[{"kind":"custom","label":"Once"}]')$$,
  'P0001', 'too_many_open', 'the eleventh open giveaway is too_many_open');
select tests.clear_authentication();

-- ===== 3. enter =====
select tests.authenticate_as(current_setting('t.p1')::uuid);
select throws_ok(format($$select public.enter_public_giveaway(%L, %L, %L)$$,
                        current_setting('t.g1'), current_setting('t.p1'), current_setting('t.pa')),
  '42501', null, 'enter as authenticated is permission denied');
select tests.clear_authentication();
select is(tests.pg2_enter(current_setting('t.g1')::uuid, current_setting('t.p1')::uuid, upper(current_setting('t.pa'))),
  'entered', 'enter through the service role');
select is(tests.pg2_enter(current_setting('t.g1')::uuid, current_setting('t.p1')::uuid, current_setting('t.pa')),
  'already', 'entering twice is already');
select is((select string_agg(wallet_address, ',') from public.public_giveaway_entries
           where giveaway_id = current_setting('t.g1')::uuid),
  current_setting('t.pa'), 'one entry, with the wallet lower-cased');
select throws_ok(format($$select tests.pg2_enter(%L, %L, %L)$$,
                        current_setting('t.g1'), current_setting('t.p2'), current_setting('t.pa')),
  'P0001', 'forbidden', 'a wallet that is not the user''s own is forbidden');
select throws_ok(format($$select tests.pg2_enter(%L, %L, %L)$$,
                        current_setting('t.g1'), current_setting('t.ubanned'), '0x' || lpad('b2b06', 40, '0')),
  'P0001', 'forbidden', 'a banned club member cannot enter');
select throws_ok(format($$select tests.pg2_enter(%L, %L, %L)$$,
                        current_setting('t.g2'), current_setting('t.p1'), current_setting('t.pa')),
  'P0001', 'not_allowed', 'a wallet outside the allowlist is not_allowed');
select is(tests.pg2_enter(current_setting('t.g2')::uuid, current_setting('t.p2')::uuid, current_setting('t.pb')),
  'entered', 'a wallet on the allowlist enters');
update public.public_giveaways set closes_at = now() - interval '1 second' where id = current_setting('t.g3')::uuid;
select throws_ok(format($$select tests.pg2_enter(%L, %L, %L)$$,
                        current_setting('t.g3'), current_setting('t.p1'), current_setting('t.pa')),
  'P0001', 'giveaway_closed', 'entering after closes_at is giveaway_closed');
select throws_ok(format($$select tests.pg2_enter(gen_random_uuid(), %L, %L)$$,
                        current_setting('t.p1'), current_setting('t.pa')),
  'P0001', 'not_found', 'an unknown giveaway is not_found');
with u as (
  insert into auth.users (id, instance_id, aud, role, raw_app_meta_data, created_at, updated_at)
  select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, now(), now()
  from generate_series(1, 5000)
  returning id
)
insert into public.public_giveaway_entries (giveaway_id, user_id, wallet_address)
select current_setting('t.g5')::uuid, u.id, '0x' || substr(md5(u.id::text) || md5(u.id::text || 'x'), 1, 40) from u;
select throws_ok(format($$select tests.pg2_enter(%L, %L, %L)$$,
                        current_setting('t.g5'), current_setting('t.p1'), current_setting('t.pa')),
  'P0001', 'giveaway_full', 'the 5001st entry is giveaway_full');

-- ===== 4. view =====
select is((select v ->> 'status' || '|' || coalesce(v ->> 'seedReveal', 'null') || '|' || (v ->> 'seedCommit' ~ '^0x[0-9a-f]{64}$')
           from tests.pg2_view(current_setting('t.g1')::uuid, current_setting('t.p1')::uuid) v),
  'open|null|true', 'the view shows the commit and no seed reveal while open');
select is((select (v ->> 'entryCount') || '|' || (v ->> 'iEntered') || '|' || (v ->> 'isHost') || '|'
                  || (v -> 'entries' -> 0 ->> 'walletAddress') || '|' || coalesce(v -> 'entries' -> 0 ->> 'position', 'null')
                  || '|' || (v ->> 'hostName') || '|' || (v ->> 'minTxCount') || '|' || jsonb_array_length(v -> 'prizes')
                  || '|' || (v -> 'prizes' -> 0 ->> 'amount') || '|' || (v -> 'prizes' -> 0 ->> 'chainId')
           from tests.pg2_view(current_setting('t.g1')::uuid, current_setting('t.p1')::uuid) v),
  '1|true|false|' || current_setting('t.pa') || '|null|Club Lambo|3|2|5000000|84532',
  'the participant sees their entry, the entries, the host name and the prizes');
select is((select (v ->> 'isHost') || '|' || (v ->> 'iEntered')
           from tests.pg2_view(current_setting('t.g1')::uuid, current_setting('t.host_a')::uuid) v),
  'true|false', 'the host is isHost and has not entered');
select is(tests.pg2_view(gen_random_uuid(), null), null, 'an unknown giveaway is null');

select tests.authenticate_as(current_setting('t.p1')::uuid);
select throws_ok($$select count(*) from public.public_giveaway_entries$$, '42501', null,
  'a public wallet cannot read public_giveaway_entries directly');
select throws_ok($$select count(*) from public.public_giveaways$$, '42501', null,
  'a public wallet cannot read public_giveaways directly');

-- ===== 5. leave / cancel / mine =====
select public.leave_public_giveaway(current_setting('t.g1')::uuid);
select tests.clear_authentication();
select is((select count(*)::int from public.public_giveaway_entries where giveaway_id = current_setting('t.g1')::uuid), 0,
  'leave removes the entry');
select tests.authenticate_as(current_setting('t.p1')::uuid);
select throws_ok(format($$select public.cancel_public_giveaway(%L)$$, current_setting('t.g4')),
  'P0001', 'forbidden', 'only the host can cancel');
select tests.authenticate_as(current_setting('t.host_a')::uuid);
select lives_ok(format($$select public.cancel_public_giveaway(%L)$$, current_setting('t.g4')), 'the host cancels');
select throws_ok(format($$select public.cancel_public_giveaway(%L)$$, current_setting('t.g4')),
  'P0001', 'invalid_state', 'a cancelled giveaway cannot be cancelled again');
select set_config('t.mine', public.my_public_giveaways(50)::text, true);
select tests.clear_authentication();
select is((select g.status || '|' || (g.cancelled_at is not null) || '|'
                  || exists (select 1 from private.public_giveaway_seeds s where s.giveaway_id = g.id)
           from public.public_giveaways g where g.id = current_setting('t.g4')::uuid),
  'cancelled|true|false', 'cancel sets the status and deletes the seed unrevealed');
select is((select jsonb_array_length(current_setting('t.mine')::jsonb) || '|'
                  || (current_setting('t.mine')::jsonb -> 0 ->> 'status') || '|'
                  || (current_setting('t.mine')::jsonb -> 4 ->> 'id') || '|'
                  || (current_setting('t.mine')::jsonb -> 4 ->> 'status')),
  '5|open|' || current_setting('t.g4') || '|cancelled', 'my_public_giveaways lists the host''s five, open first');

select * from finish();
rollback;
