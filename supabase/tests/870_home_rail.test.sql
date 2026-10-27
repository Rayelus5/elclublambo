-- Home summary + contextual rail RPCs: only visible channels, anonymity kept, no tx hashes, members only.
begin;
select plan(26);

select set_config('t.a', tests.create_member('0x' || lpad('e8700', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('e8701', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
update public.members set handle = 'ana870', welcome_completed_at = now() where id = current_setting('t.a')::uuid;
update public.members set handle = 'beto870', welcome_completed_at = now() where id = current_setting('t.b')::uuid;
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';

select set_config('t.cat', tests.create_channel(null, 'category', 'T870cat')::text, true);
select set_config('t.open', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't870open')::text, true);
select set_config('t.hid', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't870hid')::text, true);
-- hidden from everyone but A (member allow)
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.hid')::uuid, 'role', (select id from public.roles where is_everyone), 0, 1),
         (current_setting('t.hid')::uuid, 'member', current_setting('t.a')::uuid, 1, 0);

-- messages: a pinned one in each channel, and a bounty in each
insert into public.messages (id, channel_id, author_id, body, body_text, allow_links, pinned_at, pinned_by)
values ('8700a000-0000-4000-8000-000000000001', current_setting('t.open')::uuid, current_setting('t.a')::uuid, '{"type":"doc","content":[]}', 'anuncio abierto', true, now(), current_setting('t.a')::uuid),
       ('8700a000-0000-4000-8000-000000000002', current_setting('t.hid')::uuid, current_setting('t.a')::uuid, '{"type":"doc","content":[]}', 'anuncio secreto', true, now(), current_setting('t.a')::uuid),
       ('8700a000-0000-4000-8000-000000000003', current_setting('t.open')::uuid, current_setting('t.a')::uuid, '{"type":"doc","content":[]}', 'bounty abierto', true, null, null),
       ('8700a000-0000-4000-8000-000000000004', current_setting('t.hid')::uuid, current_setting('t.a')::uuid, '{"type":"doc","content":[]}', 'bounty secreto', true, null, null),
       ('8700a000-0000-4000-8000-000000000005', current_setting('t.open')::uuid, current_setting('t.b')::uuid, '{"type":"doc","content":[]}', 'mensaje propinado', true, null, null);
update public.messages set kind = 'bounty' where id in ('8700a000-0000-4000-8000-000000000003', '8700a000-0000-4000-8000-000000000004');
insert into public.bounties (message_id, channel_id, author_id, chain_id, token, amount)
values ('8700a000-0000-4000-8000-000000000003', current_setting('t.open')::uuid, current_setting('t.a')::uuid, 84532, 'USDC', 5000000),
       ('8700a000-0000-4000-8000-000000000004', current_setting('t.hid')::uuid, current_setting('t.a')::uuid, 421614, 'USDC', 7000000);

-- an anonymous tip from A to B's message, and a hidden-ranking donation from A
insert into public.payment_intents (id, member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount, recipient_member_id,
  recipient_address, target_type, target_id, status)
values ('8700b000-0000-4000-8000-000000000001', current_setting('t.a')::uuid, 'tip', 84532, 'USDC', 3000000, 0, 0, 0, current_setting('t.b')::uuid,
  '0x00000000000000000000000000000000000000bb', 'message', '8700a000-0000-4000-8000-000000000005', 'confirmed');
insert into public.tips (intent_id, chain_id, from_member, to_member, target_type, message_id, token, amount, fee_amount, anonymous, main_tx_hash, block_number)
values ('8700b000-0000-4000-8000-000000000001', 84532, current_setting('t.a')::uuid, current_setting('t.b')::uuid, 'message',
  '8700a000-0000-4000-8000-000000000005', 'USDC', 3000000, 0, true, '0x' || repeat('7', 64), 1);


-- ===== B (cannot see the hidden channel) =====
select tests.authenticate_as(current_setting('t.ub')::uuid);
select is((select count(*)::int from public.home_open_bounties(10) where message_id = '8700a000-0000-4000-8000-000000000003'), 1, 'open bounty in a visible channel is listed');
select is((select count(*)::int from public.home_open_bounties(10) where message_id = '8700a000-0000-4000-8000-000000000004'), 0, 'bounty in a hidden channel is not');
select is((select amount_text from public.home_open_bounties(10) where message_id = '8700a000-0000-4000-8000-000000000003'), '5000000', 'amounts travel as text');
select is((select count(*)::int from public.home_pinned(10) where message_id = '8700a000-0000-4000-8000-000000000001'), 1, 'visible pin is listed');
select is((select count(*)::int from public.home_pinned(10) where message_id = '8700a000-0000-4000-8000-000000000002'), 0, 'hidden pin is not');
select is((select count(*)::int from public.home_active_channels(20) where channel_id = current_setting('t.open')::uuid), 1, 'active visible channel is listed');
select is((select count(*)::int from public.home_open_bounties(10, current_setting('t.open')::uuid)), 1, 'the channel filter keeps that channel''s bounties');
select is((select count(*)::int from public.home_pinned(10, current_setting('t.hid')::uuid)), 0, 'filtering by a hidden channel still returns nothing');
select is((select count(*)::int from public.home_active_channels(20) where channel_id = current_setting('t.hid')::uuid), 0, 'hidden channel activity is not');
select is((select count(*)::int from public.club_activity(50) where kind = 'bounty' and message_id = '8700a000-0000-4000-8000-000000000004'), 0, 'activity hides bounties of hidden channels');
select is((select count(*)::int from public.club_activity(50) where kind = 'bounty' and message_id = '8700a000-0000-4000-8000-000000000003'), 1, 'activity shows visible bounties');
select is((select actor_label from public.club_activity(50) where kind = 'tip' and message_id = '8700a000-0000-4000-8000-000000000005'), 'Anónimo', 'an anonymous tip reads Anónimo to others');
select is((select target_label from public.club_activity(50) where kind = 'tip' and message_id = '8700a000-0000-4000-8000-000000000005'), '@beto870', 'the recipient is named');
select is(public.channel_overview(current_setting('t.hid')::uuid), null, 'channel_overview of a hidden channel is null (looks missing, no error)');
select is((select count(*)::int from public.channel_members(current_setting('t.open')::uuid)) >= 2, true, 'channel_members lists members who can view it');


-- ===== A (sees everything, own anonymous tip is named for them) =====
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select count(*)::int from public.home_open_bounties(10) where message_id in ('8700a000-0000-4000-8000-000000000003', '8700a000-0000-4000-8000-000000000004')), 2, 'A sees both bounties');
select is((select actor_label from public.club_activity(50) where kind = 'tip' and message_id = '8700a000-0000-4000-8000-000000000005'), '@ana870', 'the donor sees their own anonymous tip as theirs');
select ok((select count(*) from public.channel_members(current_setting('t.hid')::uuid))
          < (select count(*) from public.channel_members(current_setting('t.open')::uuid)),
  'the hidden channel counts fewer members (B is not among them)');

-- a paid/cancelled bounty leaves the open list
select tests.clear_authentication();
update public.bounties set cancelled_at = now() where message_id = '8700a000-0000-4000-8000-000000000003';
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select count(*)::int from public.home_open_bounties(10) where message_id = '8700a000-0000-4000-8000-000000000003'), 0, 'a cancelled bounty is not open');
select tests.clear_authentication();

-- ===== outsiders and privileges =====
select ok(not has_function_privilege('anon', 'public.club_activity(int)', 'execute'), 'anon cannot read the activity');
select ok(not has_function_privilege('authenticated', 'public._active_chain()', 'execute'), '_active_chain is internal');
select ok(not has_function_privilege('authenticated', 'public.broadcast_activity_event()', 'execute'), 'the broadcast trigger function is internal');
select is((select count(*)::int from public.club_activity(5)), 0, 'no session: nothing');

-- ===== realtime =====
select has_trigger('public', 'tips', 'tips_activity_broadcast', 'tips broadcast activity');
select has_trigger('public', 'bounties', 'bounties_activity_broadcast', 'bounties broadcast activity');
select ok((select count(*) from realtime.messages where topic = 'activity' and event = 'activity_changed') >= 3,
  'the inserts above broadcast activity_changed on the private activity topic');

select * from finish();
rollback;
