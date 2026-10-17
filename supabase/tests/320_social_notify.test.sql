begin;
select plan(31);

-- helpers (rolled back with the test)
create function pg_temp.uid(p_member text) returns uuid language sql as
  $$ select auth_user_id from public.members where id = p_member::uuid $$;
create function pg_temp.code(p_invite text) returns text language sql security definer as
  $$ select code from public.invites where id = p_invite::uuid $$;
-- how many notifications of a kind a member has
create function pg_temp.nn(p_member text, p_kind text) returns int language sql as
  $$ select count(*)::int from public.notifications n where n.recipient_id = p_member::uuid and n.kind = p_kind $$;

-- privileges: trigger functions are not callable by anyone
select ok(not has_function_privilege('authenticated', 'public._notify_invite_redeemed()', 'execute'), 'authenticated cannot run the redemption trigger fn');
select ok(not has_function_privilege('service_role', 'public._notify_ban()', 'execute'), 'service_role cannot run the ban trigger fn');
select ok(not has_function_privilege('anon', 'public._notify_member_review()', 'execute'), 'anon cannot run the review trigger fn');

-- ===== fixtures =====
select set_config('t.admin', tests.create_member('0x' || lpad('d3200', 40, '0'), null, true)::text, true);
select set_config('t.sp', tests.create_member('0x' || lpad('d3201', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.mod', tests.create_member('0x' || lpad('d3202', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.plain', tests.create_member('0x' || lpad('d3203', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.vic', tests.create_member('0x' || lpad('d3204', 40, '0'), current_setting('t.sp')::uuid)::text, true);
select set_config('t.kid', tests.create_member('0x' || lpad('d3205', 40, '0'), current_setting('t.vic')::uuid)::text, true);
select set_config('t.kid2', tests.create_member('0x' || lpad('d3206', 40, '0'), current_setting('t.vic')::uuid)::text, true);
select set_config('t.sp2', tests.create_member('0x' || lpad('d3207', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.vic2', tests.create_member('0x' || lpad('d3208', 40, '0'), current_setting('t.sp2')::uuid)::text, true);
-- sponsor with no roles at all (the relation must come from invited_by_member_id, never from the Padrino role)
select set_config('t.sp3', tests.create_member('0x' || lpad('d3209', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.vic3', tests.create_member('0x' || lpad('d320a', 40, '0'), current_setting('t.sp3')::uuid)::text, true);
-- banned sponsor
select set_config('t.sp4', tests.create_member('0x' || lpad('d320b', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.vic4', tests.create_member('0x' || lpad('d320c', 40, '0'), current_setting('t.sp4')::uuid)::text, true);
update public.members set status = 'banned' where id = current_setting('t.sp4')::uuid;
select set_config('t.newbie', tests.create_wallet_user('0x' || lpad('d320d', 40, '0'))::text, true);

insert into public.member_roles (member_id, role_id)
  select current_setting('t.admin')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select m, r.id from public.roles r,
    unnest(array[current_setting('t.sp')::uuid, current_setting('t.sp2')::uuid, current_setting('t.mod')::uuid]) m
  where r.name = 'Padrino';
-- mod: BAN_MEMBERS (32) through an override
insert into public.member_permission_overrides (member_id, allow) values (current_setting('t.mod')::uuid, 32);

insert into public.invites (code, created_by, max_uses, expires_at) values
  ('t320-sp-code-aaaaaaaa', current_setting('t.sp')::uuid, 5, now() + interval '1 day');

-- ===== invite_redeemed =====
select tests.authenticate_as(current_setting('t.newbie')::uuid);
select set_config('t.newm', public.redeem_invite('t320-sp-code-aaaaaaaa')::text, true);
select tests.clear_authentication();
select is(pg_temp.nn(current_setting('t.sp'), 'invite_redeemed'), 1, 'the invite creator gets one invite_redeemed');
select is((select actor_id from public.notifications where kind = 'invite_redeemed' and recipient_id = current_setting('t.sp')::uuid),
  current_setting('t.newm')::uuid, 'actor is the new member');
select is((select count(*)::int from public.notifications), 1, 'redeeming notifies nobody else');
select is((select data from public.notifications where kind = 'invite_redeemed'), '{}'::jsonb, 'no copied text in data');
select ok((select channel_id is null and message_id is null and ticket_id is null from public.notifications where kind = 'invite_redeemed'),
  'invite notice has no channel, message or ticket');
-- the creator reads it through RLS
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp')));
select is((select count(*)::int from public.notifications), 1, 'creator sees the notice through RLS');
select is(public.my_unread_notification_count(), 1, 'creator unread count includes it');
select tests.clear_authentication();
-- a banned creator is not notified
delete from public.notifications;
insert into public.invites (code, created_by, max_uses, expires_at) values
  ('t320-sp4-code-aaaaaaa', current_setting('t.sp4')::uuid, 5, now() + interval '1 day');
insert into public.invite_redemptions (invite_id, member_id)
  select i.id, current_setting('t.vic4')::uuid from public.invites i where i.code = 't320-sp4-code-aaaaaaa';
select is((select count(*)::int from public.notifications), 0, 'inactive invite creator gets nothing');

-- ===== ban: godchild_banned =====
delete from public.notifications;
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.ban_member(current_setting('t.vic')::uuid, 'spam spam spam', false);
select tests.clear_authentication();
select is(pg_temp.nn(current_setting('t.sp'), 'godchild_banned'), 1, 'sponsor gets godchild_banned');
select is(pg_temp.nn(current_setting('t.sp'), 'sponsor_penalized'), 0, 'no penalty, so no sponsor_penalized');
select is((select actor_id from public.notifications where kind = 'godchild_banned' and recipient_id = current_setting('t.sp')::uuid),
  current_setting('t.vic')::uuid, 'actor is the banned member');
select ok((select channel_id is null and message_id is null and data = '{}'::jsonb
  from public.notifications where kind = 'godchild_banned'), 'ban notice carries ids only');

-- ===== member_review: godchildren of the banned member flagged =====
select is(pg_temp.nn(current_setting('t.admin'), 'member_review'), 2, 'admin gets a member_review per flagged godchild');
select is(pg_temp.nn(current_setting('t.mod'), 'member_review'), 2, 'BAN_MEMBERS holder gets a member_review per flagged godchild');
select is(pg_temp.nn(current_setting('t.plain'), 'member_review'), 0, 'plain member gets no member_review');
select is(pg_temp.nn(current_setting('t.sp'), 'member_review'), 0, 'sponsor without BAN gets no member_review');
select is(pg_temp.nn(current_setting('t.kid'), 'member_review'), 0, 'the flagged member is not notified');
select is((select array_agg(actor_id order by actor_id) from public.notifications
  where kind = 'member_review' and recipient_id = current_setting('t.mod')::uuid),
  (select array_agg(x order by x) from unnest(array[current_setting('t.kid')::uuid, current_setting('t.kid2')::uuid]) x),
  'member_review actors are the flagged godchildren');
-- re-saving the flag does not notify again
update public.members set needs_review_since = now() + interval '1 second' where id = current_setting('t.kid')::uuid;
select is(pg_temp.nn(current_setting('t.mod'), 'member_review'), 2, 'updating an already-set needs_review_since does not notify again');
-- clearing and setting again does
update public.members set needs_review_since = null where id = current_setting('t.kid')::uuid;
select is(pg_temp.nn(current_setting('t.mod'), 'member_review'), 2, 'clearing the flag does not notify');
update public.members set needs_review_since = now() where id = current_setting('t.kid')::uuid;
select is(pg_temp.nn(current_setting('t.mod'), 'member_review'), 3, 'flag set again from null notifies');

-- a flagged staff member is not notified of themselves
delete from public.notifications;
update public.members set needs_review_since = now() where id = current_setting('t.mod')::uuid;
select is(pg_temp.nn(current_setting('t.mod'), 'member_review'), 0, 'flagged staff member does not notify themselves');
select is(pg_temp.nn(current_setting('t.admin'), 'member_review'), 1, 'but other staff are notified');
-- an inactive staff member is not notified
delete from public.notifications;
update public.members set status = 'banned' where id = current_setting('t.mod')::uuid;
update public.members set needs_review_since = now() where id = current_setting('t.plain')::uuid;
select is(pg_temp.nn(current_setting('t.mod'), 'member_review'), 0, 'banned staff member gets nothing');
update public.members set status = 'active' where id = current_setting('t.mod')::uuid;

-- ===== ban with penalty: sponsor_penalized =====
delete from public.notifications;
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.ban_member(current_setting('t.vic2')::uuid, 'estafa clara', true);
select tests.clear_authentication();
select is(pg_temp.nn(current_setting('t.sp2'), 'sponsor_penalized'), 1, 'penalized sponsor gets sponsor_penalized');
select is(pg_temp.nn(current_setting('t.sp2'), 'godchild_banned'), 0, 'penalized sponsor does not also get godchild_banned');

-- ===== relation never comes from the Padrino role =====
delete from public.notifications;
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.ban_member(current_setting('t.vic3')::uuid, 'spam spam spam', false);
select tests.clear_authentication();
select is(pg_temp.nn(current_setting('t.sp3'), 'godchild_banned'), 1, 'sponsor without the Padrino role still gets godchild_banned');

-- ===== banned sponsor =====
delete from public.notifications;
update public.members set status = 'active' where id = current_setting('t.vic4')::uuid;
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.ban_member(current_setting('t.vic4')::uuid, 'spam spam spam', false);
select tests.clear_authentication();
select is(pg_temp.nn(current_setting('t.sp4'), 'godchild_banned'), 0, 'banned sponsor gets nothing');

select * from finish();
rollback;
