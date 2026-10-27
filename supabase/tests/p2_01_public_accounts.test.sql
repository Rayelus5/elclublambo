-- P2 Task 3 (migration 20261025100001): is_public_account() and the isolation of the club from wallets without membership.
begin;
select plan(11);

select set_config('t.w', tests.create_wallet_user('0x' || lpad('a2a01', 40, '0'))::text, true);
select set_config('t.m', tests.create_member('0x' || lpad('a2a02', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('a2a03', 40, '0'), current_setting('t.m')::uuid, false)::text, true);
update public.members set display_name = 'Zorrovolante' where id = current_setting('t.m')::uuid;
select set_config('t.cat', tests.create_channel(null, 'category', 'P2cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'p2txt')::text, true);
insert into public.messages (channel_id, author_id, body, body_text, allow_links)
  values (current_setting('t.ch')::uuid, current_setting('t.m')::uuid, '{"type":"doc","content":[]}'::jsonb, 'quokkaword hola', true);
update public.members set status = 'banned' where id = current_setting('t.b')::uuid;

select tests.authenticate_as(current_setting('t.w')::uuid);
select is(public.is_public_account(), true, 'a wallet user without membership is a public account');
select throws_ok($$select public.giveaways_list(10)$$, 'P0001', 'forbidden', 'giveaways_list is closed to a wallet without membership');
select throws_ok($$select public.donation_overview()$$, 'P0001', 'forbidden', 'donation_overview is closed to a wallet without membership');
select throws_ok($$select public.giveaway_detail(gen_random_uuid())$$, 'P0001', 'forbidden', 'giveaway_detail is closed to a wallet without membership');
select is((select count(*)::int from public.search_messages('quokkaword', 10)), 0, 'search_messages returns no rows to a wallet without membership');
select is((select count(*)::int from public.search_members('Zorrovolante', 10)), 0, 'search_members returns no rows to a wallet without membership');
select tests.clear_authentication();

select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.m')::uuid));
select is(public.is_public_account(), true, 'an active member is a public account too');
select cmp_ok((select count(*)::int from public.search_messages('quokkaword', 10)), '>=', 1, 'positive control: the member finds the message');
select cmp_ok((select count(*)::int from public.search_members('Zorrovolante', 10)), '>=', 1, 'positive control: the member finds the member');
select tests.clear_authentication();

select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.b')::uuid));
select is(public.is_public_account(), false, 'a banned member is not');
select tests.clear_authentication();

select is(public.is_public_account(), false, 'unauthenticated is not');

select * from finish();
rollback;
