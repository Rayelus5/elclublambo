-- F3 final fixes: bounty statuses that never mark an author who cannot pay (F3-R1), bounty record scoped to the enabled
-- networks (F3-R2, P0: was the active chain; other_chain is gone), tips on deleted messages on the profile (M3),
-- safe <> platform (M6), dead helper dropped (M5).
begin;
select plan(43);

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.post(p_ch uuid, p_body jsonb, p_root uuid default null)
returns uuid language sql as $$
  select public.post_message(p_ch, p_body, 'x', false, p_root, null, '[]'::jsonb)
$$;
create function tests.cfg(p_key text) returns text language sql as $$ select current_setting(p_key) $$;
create function tests.st(p_key text) returns text language sql as $$
  select public.bounty_status(b) from public.bounties b where b.message_id = current_setting(p_key)::uuid
$$;
-- a bounty by the current caller in t.ch; when p_solver_user is given, that user replies and the author marks it
create function tests.marked_bounty(p_author_user text, p_solver_user text)
returns uuid language plpgsql as $$
declare
  v_b uuid;
  v_r uuid;
begin
  perform tests.authenticate_as(p_author_user::uuid);
  v_b := public.create_bounty(current_setting('t.ch')::uuid, tests.td('bounty'), 84532, 'USDC', 10000000);
  if p_solver_user is not null then
    perform tests.authenticate_as(p_solver_user::uuid);
    v_r := tests.post(current_setting('t.ch')::uuid, tests.td('answer'), v_b);
    perform tests.authenticate_as(p_author_user::uuid);
    perform public.mark_bounty_solution(v_b, v_r);
  end if;
  perform tests.clear_authentication();
  if p_solver_user is not null then
    update public.bounties set solution_marked_at = now() - interval '8 days' where message_id = v_b;
  end if;
  return v_b;
end;
$$;

-- ===== fixtures =====
select set_config('t.a', tests.create_member('0x' || lpad('d8400', 40, '0'), null, true)::text, true);                       -- author
select set_config('t.b', tests.create_member('0x' || lpad('d8401', 40, '0'), current_setting('t.a')::uuid)::text, true);    -- solver
select set_config('t.c', tests.create_member('0x' || lpad('d8402', 40, '0'), current_setting('t.a')::uuid)::text, true);    -- solver, banned later
select set_config('t.m', tests.create_member('0x' || lpad('d8403', 40, '0'), current_setting('t.a')::uuid)::text, true);    -- moderator
select set_config('t.v', tests.create_member('0x' || lpad('d8404', 40, '0'), current_setting('t.a')::uuid)::text, true);    -- viewer
select set_config('t.h', tests.create_member('0x' || lpad('d8405', 40, '0'), current_setting('t.a')::uuid)::text, true);    -- cannot see t.ch
insert into public.member_roles (member_id, role_id)
  select x.id, r.id from (values (current_setting('t.a')::uuid), (current_setting('t.m')::uuid)) x(id), public.roles r where r.name = 'SuperAdmin';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uc', (select auth_user_id::text from public.members where id = current_setting('t.c')::uuid), true);
select set_config('t.um', (select auth_user_id::text from public.members where id = current_setting('t.m')::uuid), true);
select set_config('t.uv', (select auth_user_id::text from public.members where id = current_setting('t.v')::uuid), true);
select set_config('t.uh', (select auth_user_id::text from public.members where id = current_setting('t.h')::uuid), true);

select set_config('t.cat', tests.create_channel(null, 'category', 'T840cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't840')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.ch')::uuid, 'member', current_setting('t.h')::uuid, 0, 1);

select set_config('t.x1', tests.marked_bounty(current_setting('t.ua'), current_setting('t.ub'))::text, true);  -- unpaid
select set_config('t.x2', tests.marked_bounty(current_setting('t.ua'), current_setting('t.ub'))::text, true);  -- moderator-deleted
select set_config('t.x3', tests.marked_bounty(current_setting('t.ua'), current_setting('t.ub'))::text, true);  -- author-deleted
select set_config('t.x4', tests.marked_bounty(current_setting('t.ua'), current_setting('t.uc'))::text, true);  -- solver banned
select set_config('t.x5', tests.marked_bounty(current_setting('t.ua'), current_setting('t.ub'))::text, true);  -- other network
select set_config('t.x6', tests.marked_bounty(current_setting('t.ua'), null)::text, true);                     -- open, moderator-deleted
select set_config('t.x7', tests.marked_bounty(current_setting('t.ua'), current_setting('t.ub'))::text, true);  -- paid, then moderator-deleted
select set_config('t.x8', tests.marked_bounty(current_setting('t.ua'), current_setting('t.uc'))::text, true);  -- other network + solver banned
select set_config('t.x9', tests.marked_bounty(current_setting('t.ua'), null)::text, true);                     -- open, other network
select set_config('t.x10', tests.marked_bounty(current_setting('t.ua'), current_setting('t.ub'))::text, true); -- paid on the other network
select set_config('t.x11', tests.marked_bounty(current_setting('t.ua'), current_setting('t.ub'))::text, true); -- moderator-deleted, other network

update public.bounties set paid_at = solution_marked_at + interval '1 day'
  where message_id in (current_setting('t.x7')::uuid, current_setting('t.x10')::uuid);
update public.bounties set chain_id = 421614
  where message_id in (current_setting('t.x5')::uuid, current_setting('t.x8')::uuid, current_setting('t.x9')::uuid,
                       current_setting('t.x10')::uuid, current_setting('t.x11')::uuid);
select tests.authenticate_as(current_setting('t.um')::uuid);
select public.delete_message(current_setting('t.x2')::uuid);
select public.delete_message(current_setting('t.x6')::uuid);
select public.delete_message(current_setting('t.x7')::uuid);
select public.delete_message(current_setting('t.x11')::uuid);
select tests.clear_authentication();
-- an author deletion of a marked bounty (refused since 20261018800021, F3-R6): set directly, as a pre-guard row
update public.messages set deleted_at = now(), deleted_by = current_setting('t.a')::uuid where id = current_setting('t.x3')::uuid;
update public.members set status = 'banned' where id = current_setting('t.c')::uuid;

-- ===== F3-R1: derived statuses and precedence =====
select is(tests.st('t.x1'), 'unpaid', 'baseline: marked over 7 days ago, payable, is unpaid');
select is(tests.st('t.x2'), 'removed', 'a bounty soft-deleted by a moderator is removed, not unpaid');
select is(tests.st('t.x3'), 'unpaid', 'a bounty the author deleted keeps its normal status');
select is(tests.st('t.x4'), 'solver_unavailable', 'a banned solver makes the payment impossible: solver_unavailable');
select is(tests.st('t.x5'), 'unpaid', 'a bounty on the other network keeps its lifecycle status');
select is(tests.st('t.x6'), 'removed', 'an open bounty removed by a moderator is removed');
select is(tests.st('t.x7'), 'paid', 'paid wins over removed');
select is(tests.st('t.x8'), 'solver_unavailable', 'solver_unavailable on the other network too');
select is(tests.st('t.x9'), 'open', 'an open bounty on the other network is open');
select is(tests.st('t.x10'), 'paid', 'paid on the other network');
select is(tests.st('t.x11'), 'removed', 'removed on the other network');
update public.bounties set cancelled_at = now(), solution_message_id = null, solver_id = null, solution_marked_at = null, paid_at = null
  where message_id = current_setting('t.x9')::uuid;
select is(tests.st('t.x9'), 'cancelled', 'cancelled wins over everything');
update public.members set status = 'left' where id = current_setting('t.b')::uuid;
select is(tests.st('t.x1'), 'solver_unavailable', 'a solver who left is unavailable too');
update public.members set status = 'active' where id = current_setting('t.b')::uuid;
update public.bounties set solution_marked_at = now() - interval '2 days' where message_id = current_setting('t.x4')::uuid;
select is(tests.st('t.x4'), 'solver_unavailable', 'the status applies before the 7 days too (no clock while unpayable)');
update public.bounties set solution_marked_at = now() - interval '8 days' where message_id = current_setting('t.x4')::uuid;

-- a leftover Linea bounty that expired: marking and cancelling still see the lifecycle
select set_config('t.x12', tests.marked_bounty(current_setting('t.ua'), null)::text, true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.r12', tests.post(current_setting('t.ch')::uuid, tests.td('late answer'), current_setting('t.x12')::uuid)::text, true);
select tests.clear_authentication();
update public.bounties set chain_id = 59141, created_at = now() - interval '31 days' where message_id = current_setting('t.x12')::uuid;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.mark_bounty_solution(tests.cfg('t.x12')::uuid, tests.cfg('t.r12')::uuid)$$,
  'P0001', 'bounty_closed', 'an expired bounty on a disabled network still cannot get a solution');
select throws_ok($$select public.cancel_bounty(tests.cfg('t.x12')::uuid)$$, 'P0001', 'bounty_closed',
  'nor be cancelled');
select tests.clear_authentication();

-- bounty_details carries the new statuses (as the author)
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select status from public.bounty_details(array[current_setting('t.x4')::uuid])), 'solver_unavailable', 'bounty_details: solver_unavailable');
select is((select status from public.bounty_details(array[current_setting('t.x5')::uuid])), 'unpaid', 'bounty_details: no other_chain');

-- ===== F3-R2 / P0: the record counts the enabled networks only =====
select tests.authenticate_as(current_setting('t.uv')::uuid);
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).unpaid), 3,
  'record: x1, x3 and x5 are unpaid on the two enabled networks (removed and unavailable ones are not)');
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).paid), 2, 'record: x7 and x10 are paid');
select is((select count(*)::int from public.member_unpaid_bounties(current_setting('t.a')::uuid)), 3, 'unpaid list: three entries');
select ok((select bool_and(chain_id in (84532, 421614)) from public.member_unpaid_bounties(current_setting('t.a')::uuid)), 'unpaid list carries the chain');
select tests.clear_authentication();
update public.chains set enabled = false where chain_id = 421614;
select tests.authenticate_as(current_setting('t.uv')::uuid);
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).unpaid), 2, 'with the other network disabled only x1 and x3 are unpaid');
select is((select (public.member_bounty_record(current_setting('t.a')::uuid)).paid), 1, 'and only x7 is paid');
select is((select count(*)::int from public.member_unpaid_bounties(current_setting('t.a')::uuid) where chain_id = 421614), 0,
  'the unpaid list leaves out the disabled network');
select tests.clear_authentication();
select is(tests.st('t.x5'), 'unpaid', 'a bounty on a disabled network keeps its status (no other_chain)');
update public.chains set enabled = true where chain_id = 421614;
update public.members set status = 'active' where id = current_setting('t.c')::uuid;
select is(tests.st('t.x4'), 'unpaid', 'a reinstated solver makes it payable, and unpaid, again');
update public.members set status = 'banned' where id = current_setting('t.c')::uuid;

-- ===== M3: tips on deleted messages stay on the recipient's profile =====
select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.mt1', tests.post(current_setting('t.ch')::uuid, tests.td('tip me, hard'))::text, true);
select set_config('t.mt2', tests.post(current_setting('t.ch')::uuid, tests.td('tip me, soft'))::text, true);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.ti1', (public.create_tip_intent('message', current_setting('t.mt1')::uuid, 84532, 'USDC', 1000000, false) ->> 'id'), true);
select set_config('t.ti2', (public.create_tip_intent('message', current_setting('t.mt2')::uuid, 84532, 'USDC', 2000000, false) ->> 'id'), true);
select tests.clear_authentication();
insert into public.tips (intent_id, chain_id, from_member, to_member, target_type, message_id, token, amount, fee_amount, anonymous, main_tx_hash, block_number)
values (current_setting('t.ti1')::uuid, 84532, current_setting('t.a')::uuid, current_setting('t.b')::uuid, 'message', current_setting('t.mt1')::uuid,
        'USDC', 1000000, 0, false, '0x' || lpad('8401', 64, '0'), 1),
       (current_setting('t.ti2')::uuid, 84532, current_setting('t.a')::uuid, current_setting('t.b')::uuid, 'message', current_setting('t.mt2')::uuid,
        'USDC', 2000000, 0, false, '0x' || lpad('8402', 64, '0'), 1);
update public.payment_intents set status = 'confirmed' where id in (current_setting('t.ti1')::uuid, current_setting('t.ti2')::uuid);
select tests.authenticate_as(current_setting('t.uv')::uuid);
select is((select count(*)::int from public.member_tips(current_setting('t.b')::uuid) where not message_deleted), 2,
  'live messages: message_deleted is false');
select tests.clear_authentication();
delete from public.messages where id = current_setting('t.mt1')::uuid;
update public.messages set deleted_at = now() where id = current_setting('t.mt2')::uuid;
select is((select message_id from public.tips where intent_id = current_setting('t.ti1')::uuid), null, 'the hard delete nulled the tip''s message');

select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((select count(*)::int from public.member_tips(current_setting('t.b')::uuid) where message_deleted), 2,
  'the recipient still sees both tips, flagged as deleted messages');
select is((select total_text from public.member_tips_totals(current_setting('t.b')::uuid) where token = 'USDC'), '3000000',
  'and both count in the recipient''s totals');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select count(*)::int from public.member_tips(current_setting('t.b')::uuid) where message_deleted), 2,
  'the donor sees both');
select tests.authenticate_as(current_setting('t.uv')::uuid);
select is((select array_agg(amount_text order by amount_text) from public.member_tips(current_setting('t.b')::uuid) where message_deleted),
  array['2000000'], 'another viewer sees the soft-deleted one (its channel is visible) but not the hard-deleted one (channel unknown)');
select is((select total_text from public.member_tips_totals(current_setting('t.b')::uuid) where token = 'USDC'), '2000000',
  'nor counts it');
select tests.authenticate_as(current_setting('t.uh')::uuid);
select is((select count(*)::int from public.member_tips(current_setting('t.b')::uuid)), 0,
  'a viewer who cannot see the channel sees neither');
select tests.clear_authentication();

-- ===== M6: safe <> platform =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select throws_ok($$select public.set_chain_addresses(59144, '0x1111111111111111111111111111111111111111', '0x1111111111111111111111111111111111111111')$$,
  'P0001', 'safe_equals_platform', 'the platform wallet cannot be the Safe');
select throws_ok($$select public.set_chain_addresses(59144, '0xABCDEF1111111111111111111111111111111111', '0xabcdef1111111111111111111111111111111111')$$,
  'P0001', 'safe_equals_platform', 'compared after lowercasing');
select lives_ok($$select public.set_chain_addresses(59144, '0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222')$$,
  'different addresses are accepted');
select lives_ok($$select public.set_chain_addresses(59144, null, null)$$, 'clearing both is accepted');
select tests.clear_authentication();

-- ===== M5 / grants =====
select hasnt_function('public', '_channel_failing_gate', array['uuid', 'uuid', 'text'], 'the dead _channel_failing_gate helper is gone');
select ok(not has_function_privilege('authenticated', 'public.bounty_status(public.bounties)', 'execute'), 'bounty_status is not callable by clients');
select ok(has_function_privilege('authenticated', 'public.member_unpaid_bounties(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.member_unpaid_bounties(uuid)', 'execute'), 'member_unpaid_bounties grants restated');
select ok(has_function_privilege('authenticated', 'public.member_tips(uuid,int)', 'execute')
      and not has_function_privilege('anon', 'public.member_tips(uuid,int)', 'execute'), 'member_tips grants restated');

select * from finish();
rollback;
