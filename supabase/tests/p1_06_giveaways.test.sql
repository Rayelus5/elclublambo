-- P1 Task 8 (migration 20261024200006): free, equal-weight giveaways drawn with drand quicknet (P1-R8..R10).
--   - create_giveaway: MANAGE_TREASURY only, 1..10 prizes, role prizes under P1-R9, closes_at window, enabled networks.
--   - enter / leave: idempotent, refused from closes_at on (giveaway_closed).
--   - create_giveaway role prizes also need MANAGE_ROLES (or ADMINISTRATOR) and a role inside the creator's permissions.
--   - close_due_giveaways: positions 1..n over every entry, frozen at the close; 0 entries -> void, seed revealed (RF 3).
--   - draw_giveaway: the target round only, randomness = sha256(signature) of the real round 1000, distinct winners,
--     not_enough_entries (RF 3), role_unavailable for a deleted or widened role (RF 4), winner_inactive for a winner
--     who left or was banned, giveaway_won notified.
--   - cancel_giveaway: only open and before closes_at.
--   - record_giveaway_payout: tx_already_used for a hash behind an intent or another prize; delivered / cancel / reads.
begin;
select plan(82);

create function tests.hash(p_n int) returns text language sql immutable as $$
  select '0x' || lpad(to_hex(p_n), 64, '0')
$$;
-- the drand quicknet round 1000 (implementer-common, Global Constraints)
create function tests.sig() returns text language sql immutable as $$
  select 'b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39'::text
$$;
-- as postgres: closes_at in the past and, optionally, target_round 1000 so the real round can be drawn
create function tests.gw_due(p_id uuid, p_round1000 boolean default false) returns void language sql as $$
  update public.giveaways
  set closes_at = now() - interval '1 second',
      target_round = case when p_round1000 then 1000 else target_round end
  where id = p_id
$$;
create function tests.gw_create(p_prizes jsonb) returns uuid language sql as $$
  select (public.create_giveaway('Sorteo de prueba', null, now() + interval '1 hour', p_prizes) ->> 'id')::uuid
$$;
create function tests.enter_as(p_member uuid, p_id uuid) returns void language plpgsql as $$
begin
  perform tests.authenticate_as((select auth_user_id from public.members where id = p_member));
  perform public.enter_giveaway(p_id);
  perform tests.clear_authentication();
end;
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('e9d00', 40, '0'), null, true)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
select set_config('t.t', tests.create_member('0x' || lpad('e9d01', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.roles (name, color, position, permissions) values
  ('Tesorería P1', '#112233', 50, 320),
  ('Solo caja P1', '#112244', 50, 256),
  ('Raro P1', '#112255', 10, 16),
  ('Premio P1', '#223344', 20, 0),
  ('Alto P1', '#334455', 60, 0),
  ('Caro P1', '#445566', 5, 256),
  ('Temporal P1', '#556677', 21, 0),
  ('Crece P1', '#667788', 22, 0),
  ('Canal P1', '#778899', 23, 0),
  ('Ovr P1', '#8899AA', 24, 0);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t')::uuid, id from public.roles where name = 'Tesorería P1';
-- a treasurer without MANAGE_ROLES
select set_config('t.t2', tests.create_member('0x' || lpad('e9d02', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.t2')::uuid, id from public.roles where name = 'Solo caja P1';
select set_config('t.ut2', (select auth_user_id::text from public.members where id = current_setting('t.t2')::uuid), true);
do $$
begin
  for i in 1 .. 8 loop
    perform set_config('t.m' || i, tests.create_member('0x' || lpad('e9d1' || i, 40, '0'),
                                                       current_setting('t.a')::uuid)::text, true);
  end loop;
end;
$$;
select set_config('t.ut', (select auth_user_id::text from public.members where id = current_setting('t.t')::uuid), true);
select set_config('t.um1', (select auth_user_id::text from public.members where id = current_setting('t.m1')::uuid), true);
select set_config('t.stranger', tests.create_wallet_user('0x' || lpad('e9d1f', 40, '0'))::text, true);
select set_config('t.r_premio', (select id::text from public.roles where name = 'Premio P1'), true);
select set_config('t.r_temporal', (select id::text from public.roles where name = 'Temporal P1'), true);
select set_config('t.r_crece', (select id::text from public.roles where name = 'Crece P1'), true);
select set_config('t.r_canal', (select id::text from public.roles where name = 'Canal P1'), true);
select set_config('t.r_ovr', (select id::text from public.roles where name = 'Ovr P1'), true);
select set_config('t.cat', tests.create_channel(null, 'category', 'P106cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'p106mod')::text, true);
-- 'Canal P1' moderates one channel (MANAGE_MESSAGES = 8, outside the member mask) through an overwrite
insert into public.permission_overwrites (channel_id, target_type, target_id, allow)
values (current_setting('t.ch')::uuid, 'role', current_setting('t.r_canal')::uuid, 8);

-- ===== 1. privileges =====
select ok(has_function_privilege('authenticated', 'public.create_giveaway(text,text,timestamptz,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.create_giveaway(text,text,timestamptz,jsonb)', 'execute'),
  'create_giveaway: authenticated yes, anon no');
select ok(has_function_privilege('service_role', 'public.draw_giveaway(uuid,bigint,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.draw_giveaway(uuid,bigint,text)', 'execute')
      and has_function_privilege('service_role', 'public.close_due_giveaways()', 'execute')
      and not has_function_privilege('authenticated', 'public.close_due_giveaways()', 'execute')
      and has_function_privilege('service_role', 'public.giveaways_awaiting_draw()', 'execute')
      and not has_function_privilege('authenticated', 'public.giveaways_awaiting_draw()', 'execute')
      and has_function_privilege('service_role', 'public.record_giveaway_payout(uuid,jsonb,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_giveaway_payout(uuid,jsonb,uuid)', 'execute'),
  'close / awaiting / draw / payout: service_role only');
select ok(not has_function_privilege('authenticated', 'public._giveaway_role_ok(uuid,uuid)', 'execute')
      and not has_function_privilege('service_role', 'public._giveaway_role_ok(uuid,uuid)', 'execute')
      and not has_table_privilege('service_role', 'private.giveaway_seeds', 'select'),
  'the role check and the seeds are out of reach of the API roles');
select tests.authenticate_as(current_setting('t.um1')::uuid);
select throws_ok($$select count(*) from public.giveaways$$, '42501', null, 'giveaways has no direct read for members');
select throws_ok($$select count(*) from public.giveaway_entries$$, '42501', null, 'giveaway_entries has no direct read');
select tests.clear_authentication();

-- ===== 2. target round =====
-- 2026-10-24 12:00:00Z = 1792843200; (1792843200 - 1692803367) / 3 = 33346611 exactly: round 33346612 is emitted AT
-- the close, so the first round strictly after it is 33346613
select is(public._giveaway_target_round('2026-10-24 12:00:00+00'), 33346613::bigint, 'target round computed by hand');
select is(public._giveaway_target_round('2026-10-24 12:00:01+00'), 33346613::bigint, 'one second later, same round');

-- ===== 3. create_giveaway =====
select tests.authenticate_as(current_setting('t.um1')::uuid);
select throws_ok($$select tests.gw_create('[{"kind":"custom","label":"x"}]')$$, 'P0001', 'forbidden',
  'a member without MANAGE_TREASURY cannot create a giveaway');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok($$select tests.gw_create((select jsonb_agg(jsonb_build_object('kind', 'custom', 'label', 'P' || i))
                                           from generate_series(1, 11) i))$$,
  'P0001', 'invalid_input', '11 prizes is invalid_input');
select throws_ok($$select tests.gw_create('[]')$$, 'P0001', 'invalid_input', 'no prizes is invalid_input');
select throws_ok(format($$select tests.gw_create('[{"kind":"role","roleId":"%s"}]')$$,
                        (select id from public.roles where name = 'SuperAdmin')),
  'P0001', 'role_not_allowed', 'SuperAdmin (is_system) is not a prize');
select throws_ok(format($$select tests.gw_create('[{"kind":"role","roleId":"%s"}]')$$,
                        (select id from public.roles where system_key = 'donor')),
  'P0001', 'role_not_allowed', 'Mecenas (system_key) is not a prize');
select throws_ok(format($$select tests.gw_create('[{"kind":"role","roleId":"%s"}]')$$,
                        (select id from public.roles where name = 'Caro P1')),
  'P0001', 'role_not_allowed', 'a role with permissions outside the member mask is not a prize');
select throws_ok(format($$select tests.gw_create('[{"kind":"role","roleId":"%s"}]')$$,
                        (select id from public.roles where name = 'Alto P1')),
  'P0001', 'role_not_allowed', 'a role above the creator is not a prize');
select throws_ok(format($$select tests.gw_create('[{"kind":"role","roleId":"%s"}]')$$, current_setting('t.r_canal')),
  'P0001', 'role_not_allowed', 'a role widened by a channel overwrite outside the member mask is not a prize');
select throws_ok(format($$select tests.gw_create('[{"kind":"role","roleId":"%s"}]')$$,
                        (select id from public.roles where name = 'Raro P1')),
  'P0001', 'role_not_allowed', 'a role with a permission the creator lacks is not a prize (subset, as set_member_role)');
select tests.authenticate_as(current_setting('t.ut2')::uuid);
select throws_ok(format($$select tests.gw_create('[{"kind":"role","roleId":"%s"}]')$$, current_setting('t.r_premio')),
  'P0001', 'role_not_allowed', 'a treasurer without MANAGE_ROLES cannot offer a role prize');
select lives_ok($$select tests.gw_create('[{"kind":"custom","label":"Sin rol"}]')$$,
  'a treasurer without MANAGE_ROLES still creates non-role giveaways');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select throws_ok($$select tests.gw_create('[{"kind":"crypto","chainId":59144,"amount":"5000000"}]')$$,
  'P0001', 'chain_invalid', 'a crypto prize on a disabled network is chain_invalid');
select throws_ok($$select tests.gw_create('[{"kind":"crypto","chainId":84532,"amount":"0"}]')$$,
  'P0001', 'invalid_input', 'a zero amount is invalid_input');
select throws_ok($$select tests.gw_create('[{"kind":"custom"}]')$$, 'P0001', 'invalid_input',
  'a custom prize needs a label');
select throws_ok($$select public.create_giveaway('Pronto', null, now() + interval '5 minutes', '[{"kind":"custom","label":"x"}]')$$,
  'P0001', 'closes_at_invalid', 'closing in under 10 minutes is refused');

-- G1: the main draw, 3 prizes (crypto, role, custom), 7 active entries + 1 that leaves the club
select set_config('t.g1r', public.create_giveaway('  Gran sorteo  ', 'Tres premios', now() + interval '1 hour',
  format('[{"kind":"crypto","chainId":84532,"amount":"5000000"},{"kind":"role","roleId":"%s"},{"kind":"custom","label":"Camiseta del club"}]',
         current_setting('t.r_premio'))::jsonb)::text, true);
select set_config('t.g1', current_setting('t.g1r')::jsonb ->> 'id', true);
-- G2: 2 crypto prizes + 1 custom, only 2 entries
select set_config('t.g2', tests.gw_create('[{"kind":"crypto","chainId":84532,"amount":"1000000"},{"kind":"crypto","chainId":84532,"amount":"2000000"},{"kind":"custom","label":"Pegatinas"}]')::text, true);
-- G3: a role prize whose role is deleted before the draw; G4: one whose role gains permissions
select set_config('t.g3', tests.gw_create(format('[{"kind":"role","roleId":"%s"}]', current_setting('t.r_temporal'))::jsonb)::text, true);
select set_config('t.g4', tests.gw_create(format('[{"kind":"role","roleId":"%s"}]', current_setting('t.r_crece'))::jsonb)::text, true);
-- G8: a role that gains a moderating channel overwrite before the draw; G9: an entry vanishes before the draw
select set_config('t.g8', tests.gw_create(format('[{"kind":"role","roleId":"%s"}]', current_setting('t.r_ovr'))::jsonb)::text, true);
select set_config('t.g9', tests.gw_create('[{"kind":"custom","label":"Taza"}]')::text, true);
-- G10: two entrants, one who leaves the club before the close and one banned after it (winner_inactive)
select set_config('t.g10', tests.gw_create('[{"kind":"custom","label":"Gorra"},{"kind":"custom","label":"Llavero"}]')::text, true);
-- G11: due (closes_at passed) but not yet closed by the cron, then cancelled too late
select set_config('t.g11', tests.gw_create('[{"kind":"custom","label":"Tarde para cancelar"}]')::text, true);
-- G5: nobody enters (void); G6: entered after the close; G7: cancelled
select set_config('t.g5', tests.gw_create('[{"kind":"custom","label":"Nada"}]')::text, true);
select set_config('t.g6', tests.gw_create('[{"kind":"custom","label":"Tarde"}]')::text, true);
select set_config('t.g7', tests.gw_create('[{"kind":"custom","label":"Cancelado"}]')::text, true);
select tests.clear_authentication();

select is((select g.title || '|' || g.target_round::text || '|' || g.seed_commit from public.giveaways g
           where g.id = current_setting('t.g1')::uuid),
          'Gran sorteo|' || public._giveaway_target_round((select closes_at from public.giveaways where id = current_setting('t.g1')::uuid))::text
            || '|' || (current_setting('t.g1r')::jsonb ->> 'commit'),
  'the title is trimmed, target_round follows closes_at and the commit is returned');
select is((current_setting('t.g1r')::jsonb ->> 'commit'),
          (select '0x' || encode(public._keccak256(s.seed), 'hex') from private.giveaway_seeds s
           where s.giveaway_id = current_setting('t.g1')::uuid),
  'commit = keccak256(private seed)');
select results_eq($$select rank, kind, label, coalesce(amount::text, '-') from public.giveaway_prizes
                    where giveaway_id = current_setting('t.g1')::uuid order by rank$$,
  $$values (1, 'crypto'::text, '5 USDC'::text, '5000000'::text), (2, 'role', 'Premio P1', '-'), (3, 'custom', 'Camiseta del club', '-')$$,
  'prizes get ranks in array order and default labels');
select ok(exists (select 1 from public.audit_log where action = 'giveaway_created' and target_id = current_setting('t.g1')::uuid),
  'giveaway_created is audited');

-- ===== 4. enter / leave =====
do $$
begin
  for i in 1 .. 7 loop
    perform tests.enter_as(current_setting('t.m' || i)::uuid, current_setting('t.g1')::uuid);
  end loop;
end;
$$;
select tests.enter_as(current_setting('t.m1')::uuid, current_setting('t.g1')::uuid);
select is((select count(*)::int from public.giveaway_entries where giveaway_id = current_setting('t.g1')::uuid), 7,
  'entering twice is idempotent');
select tests.authenticate_as(current_setting('t.um1')::uuid);
select lives_ok(format($$select public.leave_giveaway(%L)$$, current_setting('t.g2')), 'leaving a giveaway never entered is a no-op');
select tests.clear_authentication();
select tests.enter_as(current_setting('t.m1')::uuid, current_setting('t.g2')::uuid);
select tests.enter_as(current_setting('t.m2')::uuid, current_setting('t.g2')::uuid);
select tests.enter_as(current_setting('t.m3')::uuid, current_setting('t.g2')::uuid);
select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.m3')::uuid));
select public.leave_giveaway(current_setting('t.g2')::uuid);
select tests.clear_authentication();
select is((select count(*)::int from public.giveaway_entries where giveaway_id = current_setting('t.g2')::uuid), 2,
  'leave removes the entry');
select tests.enter_as(current_setting('t.m1')::uuid, current_setting('t.g3')::uuid);
select tests.enter_as(current_setting('t.m2')::uuid, current_setting('t.g4')::uuid);
select tests.enter_as(current_setting('t.m3')::uuid, current_setting('t.g8')::uuid);
select tests.enter_as(current_setting('t.m4')::uuid, current_setting('t.g9')::uuid);
select tests.enter_as(current_setting('t.m5')::uuid, current_setting('t.g9')::uuid);
select tests.enter_as(current_setting('t.m1')::uuid, current_setting('t.g7')::uuid);
select tests.enter_as(current_setting('t.m8')::uuid, current_setting('t.g10')::uuid);
select tests.enter_as(current_setting('t.m6')::uuid, current_setting('t.g10')::uuid);

select tests.gw_due(current_setting('t.g6')::uuid);
select tests.authenticate_as(current_setting('t.um1')::uuid);
select throws_ok(format($$select public.enter_giveaway(%L)$$, current_setting('t.g6')), 'P0001', 'giveaway_closed',
  'entering after closes_at is giveaway_closed, even before the cron closes it');
select throws_ok($$select public.enter_giveaway(gen_random_uuid())$$, 'P0001', 'not_found', 'an unknown giveaway is not_found');
select tests.authenticate_as(current_setting('t.stranger')::uuid);
select throws_ok(format($$select public.enter_giveaway(%L)$$, current_setting('t.g1')), 'P0001', 'forbidden',
  'a wallet without membership cannot enter');
select tests.clear_authentication();

-- ===== 5. close =====
update public.members set status = 'left' where id = current_setting('t.m8')::uuid;
select tests.gw_due(current_setting('t.g1')::uuid, true);
select tests.gw_due(current_setting('t.g2')::uuid, true);
select tests.gw_due(current_setting('t.g3')::uuid, true);
select tests.gw_due(current_setting('t.g4')::uuid, true);
select tests.gw_due(current_setting('t.g8')::uuid, true);
select tests.gw_due(current_setting('t.g9')::uuid, true);
select tests.gw_due(current_setting('t.g10')::uuid, true);
select tests.gw_due(current_setting('t.g5')::uuid);
select set_config('t.g5seed', (select '0x' || encode(seed, 'hex') from private.giveaway_seeds
                               where giveaway_id = current_setting('t.g5')::uuid), true);
set local role service_role;
select is(public.close_due_giveaways(), '{"closed": 7, "voided": 2}'::jsonb,
  'close_due_giveaways closes the seven with entries and voids the two without');
reset role;
select results_eq($$select position from public.giveaway_entries where giveaway_id = current_setting('t.g1')::uuid
                    and position is not null order by position$$,
  $$select generate_series(1, 7)$$, 'positions 1..7 for the seven entries');
select results_eq($$select member_id::text, position from public.giveaway_entries
                    where giveaway_id = current_setting('t.g10')::uuid order by position$$,
  $$values (current_setting('t.m8'), 1), (current_setting('t.m6'), 2)$$,
  'a member who left before the close keeps their position: positions are frozen over every entry');
select is((select entry_count from public.giveaways where id = current_setting('t.g10')::uuid), 2,
  'entry_count counts every entry, active or not');
select is((select entry_count from public.giveaways where id = current_setting('t.g1')::uuid), 7, 'entry_count of G1');
-- m6 is banned between the close and the draw; a later cron run recomputes nothing
update public.members set status = 'banned' where id = current_setting('t.m6')::uuid;
set local role service_role;
select is(public.close_due_giveaways(), '{"closed": 0, "voided": 0}'::jsonb, 'a later cron run leaves closed giveaways alone');
reset role;
-- G11 is due now, after the cron run: still open, but past closes_at
select tests.gw_due(current_setting('t.g11')::uuid);
select results_eq($$select member_id::text, position from public.giveaway_entries
                    where giveaway_id = current_setting('t.g10')::uuid order by position$$,
  $$values (current_setting('t.m8'), 1), (current_setting('t.m6'), 2)$$,
  'a ban after the close changes no position');
select is((select position from public.giveaway_entries where giveaway_id = current_setting('t.g1')::uuid
           and member_id = current_setting('t.m1')::uuid), 1, 'positions follow entered_at');
select ok((select status = 'void' and seed_reveal = current_setting('t.g5seed') and entry_count = 0
           from public.giveaways where id = current_setting('t.g5')::uuid)
      and not exists (select 1 from private.giveaway_seeds where giveaway_id = current_setting('t.g5')::uuid),
  'with 0 entries: void, the seed revealed and deleted (RF 3)');
select is((select status || ':' || unawarded_reason from public.giveaway_prizes where giveaway_id = current_setting('t.g5')::uuid),
  'unawarded:not_enough_entries', 'a void giveaway leaves its prizes unawarded');

-- ===== 6. draw =====
-- the fixture seed (tests/fixtures/giveaway-draw.json) behind G1, so the SQL draw can be compared with TS (Task 9)
update private.giveaway_seeds set seed = decode('a9995a7fffe0d4622f0efd52f42fe4072d63053b0f19cbecb3e31f20671f0936', 'hex')
where giveaway_id = current_setting('t.g1')::uuid;
update public.giveaways
set seed_commit = '0x' || encode(public._keccak256(decode('a9995a7fffe0d4622f0efd52f42fe4072d63053b0f19cbecb3e31f20671f0936', 'hex')), 'hex')
where id = current_setting('t.g1')::uuid;
-- G4's role gains a permission outside the member mask, G3's role is deleted
update public.roles set permissions = 256 where id = current_setting('t.r_crece')::uuid;
delete from public.roles where id = current_setting('t.r_temporal')::uuid;
-- G8's role gets a moderating overwrite after creation
insert into public.permission_overwrites (channel_id, target_type, target_id, allow)
values (current_setting('t.ch')::uuid, 'role', current_setting('t.r_ovr')::uuid, 8);
-- G9 loses an entry after the close (what a hard-deleted member's cascade does)
delete from public.giveaway_entries where giveaway_id = current_setting('t.g9')::uuid and member_id = current_setting('t.m5')::uuid;

set local role service_role;
select is((select array_agg(id order by id) from public.giveaways_awaiting_draw()),
          (select array_agg(id order by id) from public.giveaways where status = 'closed'),
  'giveaways_awaiting_draw lists the closed giveaways');
select throws_ok(format($$select public.draw_giveaway(%L, 1001, %L)$$, current_setting('t.g1'), tests.sig()),
  'P0001', 'invalid_input', 'another round than target_round is invalid_input');
select throws_ok(format($$select public.draw_giveaway(%L, 1000, 'abcd')$$, current_setting('t.g1')),
  'P0001', 'invalid_input', 'a malformed signature is invalid_input');
select is(public.draw_giveaway(current_setting('t.g1')::uuid, 1000, tests.sig()) ->> 'status', 'drawn',
  'the real round 1000 draws');
select is(public.draw_giveaway(current_setting('t.g1')::uuid, 1000, upper(tests.sig())) ->> 'status', 'already',
  'the same round again is already');
select is(public.draw_giveaway(current_setting('t.g2')::uuid, 1000, tests.sig()) ->> 'status', 'drawn', 'G2 draws');
select lives_ok(format($$select public.draw_giveaway(%L, 1000, %L)$$, current_setting('t.g3'), tests.sig()), 'G3 draws');
select lives_ok(format($$select public.draw_giveaway(%L, 1000, %L)$$, current_setting('t.g4'), tests.sig()), 'G4 draws');
select lives_ok(format($$select public.draw_giveaway(%L, 1000, %L)$$, current_setting('t.g8'), tests.sig()), 'G8 draws');
select lives_ok(format($$select public.draw_giveaway(%L, 1000, %L)$$, current_setting('t.g10'), tests.sig()), 'G10 draws');
select throws_ok(format($$select public.draw_giveaway(%L, 1000, %L)$$, current_setting('t.g9'), tests.sig()),
  'P0001', 'invalid_state', 'an entry list shorter than entry_count refuses to draw (parity with the verifier)');
reset role;

select ok((select status = 'drawn'
                  and drand_randomness = 'fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd'
                  and seed_reveal = '0xa9995a7fffe0d4622f0efd52f42fe4072d63053b0f19cbecb3e31f20671f0936'
                  and drand_signature = tests.sig()
           from public.giveaways where id = current_setting('t.g1')::uuid)
      and not exists (select 1 from private.giveaway_seeds where giveaway_id = current_setting('t.g1')::uuid),
  'drawn: randomness = sha256(signature), the seed revealed and deleted');
select results_eq($$select winner_position from public.giveaway_prizes where giveaway_id = current_setting('t.g1')::uuid order by rank$$,
  $$values (4), (2), (5)$$, 'the fixture seed and round 1000 give the fixture winners by rank (tests/fixtures/giveaway-draw.json, TS drawWinners)');
select is((select count(distinct winner_member_id)::int from public.giveaway_prizes
           where giveaway_id = current_setting('t.g1')::uuid and winner_position between 1 and 7), 3,
  'three distinct winners among the seven positions');
select ok((select bool_and(p.winner_member_id = e.member_id and p.winner_address = m.wallet_address)
           from public.giveaway_prizes p
           join public.giveaway_entries e on e.giveaway_id = p.giveaway_id and e.position = p.winner_position
           join public.members m on m.id = p.winner_member_id
           where p.giveaway_id = current_setting('t.g1')::uuid),
  'each winner is the member at the winning position, with their wallet');
select results_eq($$select status from public.giveaway_prizes where giveaway_id = current_setting('t.g1')::uuid order by rank$$,
  $$values ('awarded'::text), ('delivered'), ('awarded')$$, 'crypto and custom awarded, the valid role delivered');
select ok(exists (select 1 from public.member_roles mr join public.giveaway_prizes p
                  on p.giveaway_id = current_setting('t.g1')::uuid and p.rank = 2
                  where mr.member_id = p.winner_member_id and mr.role_id = current_setting('t.r_premio')::uuid),
  'the role winner holds the role');
select results_eq($$select status, coalesce(unawarded_reason, '-'), winner_member_id is not null
                    from public.giveaway_prizes where giveaway_id = current_setting('t.g2')::uuid order by rank$$,
  $$values ('awarded'::text, '-'::text, true), ('awarded', '-', true), ('unawarded', 'not_enough_entries', false)$$,
  '2 entries for 3 prizes: the third is unawarded, not_enough_entries (RF 3)');
select is((select status || ':' || unawarded_reason from public.giveaway_prizes where giveaway_id = current_setting('t.g3')::uuid),
  'unawarded:role_unavailable', 'a role deleted before the draw is role_unavailable (RF 4)');
select ok((select status = 'unawarded' and unawarded_reason = 'role_unavailable' from public.giveaway_prizes
           where giveaway_id = current_setting('t.g4')::uuid)
      and not exists (select 1 from public.member_roles where member_id = current_setting('t.m2')::uuid
                      and role_id = current_setting('t.r_crece')::uuid),
  'a role that gained permissions is role_unavailable and is not granted (RF 4)');
select ok((select status = 'unawarded' and unawarded_reason = 'role_unavailable' from public.giveaway_prizes
           where giveaway_id = current_setting('t.g8')::uuid)
      and not exists (select 1 from public.member_roles where member_id = current_setting('t.m3')::uuid
                      and role_id = current_setting('t.r_ovr')::uuid),
  'a role that gained a moderating overwrite is role_unavailable and is not granted (RF 4)');
select results_eq($$select status, unawarded_reason, winner_member_id is not null, winner_position
                    from public.giveaway_prizes where giveaway_id = current_setting('t.g10')::uuid order by winner_position$$,
  $$values ('unawarded'::text, 'winner_inactive'::text, true, 1), ('unawarded', 'winner_inactive', true, 2)$$,
  'winners who left or were banned are consumed but unawarded (winner_inactive)');
select ok((select count(*) = 3 and bool_and(n.data ->> 'giveawayId' = current_setting('t.g1')
                                         and n.data ->> 'title' = 'Gran sorteo' and n.data ? 'prizeLabel')
           from public.notifications n where n.kind = 'giveaway_won' and n.data ->> 'giveawayId' = current_setting('t.g1'))
      and not exists (select 1 from public.notifications n where n.kind = 'giveaway_won'
                      and n.data ->> 'giveawayId' in (current_setting('t.g3'), current_setting('t.g4'), current_setting('t.g8'),
                                                      current_setting('t.g10'))),
  'giveaway_won to each winner; nothing for an unavailable role or an inactive winner');
select is((select b.url || '|' || b.body from public.notifications n, public._push_build(n.id) b
           where n.kind = 'giveaway_won' and n.data ->> 'giveawayId' = current_setting('t.g1') and n.data ->> 'prizeLabel' = '5 USDC'),
  '/sorteos/' || current_setting('t.g1') || '|Has ganado «5 USDC» en «Gran sorteo»', 'the push links to /sorteos/<id>');

-- ===== 7. payouts and deliveries =====
select set_config('t.p1', (select id::text from public.giveaway_prizes where giveaway_id = current_setting('t.g1')::uuid and rank = 1), true);
select set_config('t.p3', (select id::text from public.giveaway_prizes where giveaway_id = current_setting('t.g1')::uuid and rank = 3), true);
select set_config('t.q1', (select id::text from public.giveaway_prizes where giveaway_id = current_setting('t.g2')::uuid and rank = 1), true);
select set_config('t.q2', (select id::text from public.giveaway_prizes where giveaway_id = current_setting('t.g2')::uuid and rank = 2), true);
-- a hash already behind a confirmed intent
insert into public.payment_intents (id, member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
  recipient_address, target_type, status, main_tx_hash)
values ('00000000-0000-4000-8000-0000000e9d77', current_setting('t.m1')::uuid, 'donation', 84532, 'USDC', 1, 0, 0, 0,
  '0x' || repeat('a', 40), 'dao', 'confirmed', tests.hash(77));
insert into public.onchain_transfers (chain_id, tx_hash, log_index, intent_id, role)
values (84532, tests.hash(77), 0, '00000000-0000-4000-8000-0000000e9d77', 'main');

set local role service_role;
select throws_ok(format($$select public.record_giveaway_payout(%L, %L, %L)$$, current_setting('t.p1'),
  jsonb_build_object('txHash', tests.hash(1), 'logIndex', 0, 'blockNumber', '123'), current_setting('t.m1')),
  'P0001', 'forbidden', 'a payout recorded by a non-treasurer is forbidden');
select is(public.record_giveaway_payout(current_setting('t.p1')::uuid,
  jsonb_build_object('txHash', tests.hash(1), 'logIndex', 0, 'blockNumber', '123'), current_setting('t.t')::uuid) ->> 'status',
  'paid', 'a treasurer records the payout');
select throws_ok(format($$select public.record_giveaway_payout(%L, %L, %L)$$, current_setting('t.q1'),
  jsonb_build_object('txHash', tests.hash(1), 'logIndex', 0, 'blockNumber', '124'), current_setting('t.t')),
  'P0001', 'tx_already_used', 'a hash already used by another prize is tx_already_used');
select throws_ok(format($$select public.record_giveaway_payout(%L, %L, %L)$$, current_setting('t.q2'),
  jsonb_build_object('txHash', tests.hash(77), 'logIndex', 0, 'blockNumber', '124'), current_setting('t.t')),
  'P0001', 'tx_already_used', 'a hash behind an onchain transfer is tx_already_used');
select throws_ok(format($$select public.record_giveaway_payout(%L, %L, %L)$$, current_setting('t.p3'),
  jsonb_build_object('txHash', tests.hash(2), 'logIndex', 0, 'blockNumber', '124'), current_setting('t.t')),
  'P0001', 'invalid_state', 'a custom prize cannot be paid on-chain');
reset role;

select tests.authenticate_as(current_setting('t.um1')::uuid);
select throws_ok(format($$select public.mark_giveaway_prize_delivered(%L)$$, current_setting('t.p3')), 'P0001', 'forbidden',
  'a member cannot mark a prize delivered');
select tests.authenticate_as(current_setting('t.ut')::uuid);
select lives_ok(format($$select public.mark_giveaway_prize_delivered(%L)$$, current_setting('t.p3')),
  'a treasurer marks the custom prize delivered');
select throws_ok(format($$select public.mark_giveaway_prize_delivered(%L)$$, current_setting('t.p1')), 'P0001', 'invalid_state',
  'a crypto prize is not marked delivered');

-- ===== 8. cancel =====
select throws_ok(format($$select public.cancel_giveaway(%L, 'Ya sorteado')$$, current_setting('t.g1')), 'P0001', 'invalid_state',
  'a drawn giveaway cannot be cancelled');
select throws_ok(format($$select public.cancel_giveaway(%L, 'Demasiado tarde')$$, current_setting('t.g11')), 'P0001', 'invalid_state',
  'an open giveaway past closes_at cannot be cancelled (the entries are frozen)');
select throws_ok(format($$select public.cancel_giveaway(%L, 'Esperando')$$, current_setting('t.g9')), 'P0001', 'invalid_state',
  'a closed giveaway awaiting its draw cannot be cancelled');
select lives_ok(format($$select public.cancel_giveaway(%L, 'Premio no disponible')$$, current_setting('t.g7')),
  'a treasurer cancels an open giveaway');
select tests.clear_authentication();
select ok((select status = 'cancelled' and seed_reveal is null from public.giveaways where id = current_setting('t.g7')::uuid)
      and not exists (select 1 from private.giveaway_seeds where giveaway_id = current_setting('t.g7')::uuid)
      and exists (select 1 from public.audit_log where action = 'giveaway_cancelled' and target_id = current_setting('t.g7')::uuid),
  'cancel deletes the seed unrevealed and is audited');

-- ===== 9. reads =====
select tests.authenticate_as(current_setting('t.um1')::uuid);
select ok((select c ->> 'status' = 'drawn' and (c ->> 'iEntered')::boolean and (c ->> 'entryCount')::int = 7
                  and jsonb_array_length(c -> 'prizes') = 3 and jsonb_array_length(c -> 'winners') = 3
                  and c -> 'prizes' -> 0 ->> 'amount' = '5000000'
           from unnest(public.giveaways_list()) c where c ->> 'id' = current_setting('t.g1')),
  'giveaways_list: the card with entries, prizes (amount as text) and winners');
select ok((select d ->> 'seedReveal' is not null and d ->> 'drandRandomness' = 'fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd'
                  and (d ->> 'targetRound')::bigint = 1000 and jsonb_array_length(d -> 'entries') = 7
                  and d -> 'prizeStates' -> 0 ->> 'payoutTxHash' = tests.hash(1)
           from public.giveaway_detail(current_setting('t.g1')::uuid) d),
  'giveaway_detail: the draw inputs, the entries and the payout hash');
select tests.authenticate_as(current_setting('t.stranger')::uuid);
select throws_ok($$select public.giveaways_list()$$, 'P0001', 'forbidden', 'a wallet without membership cannot read giveaways');
select tests.clear_authentication();

select * from finish();
rollback;
