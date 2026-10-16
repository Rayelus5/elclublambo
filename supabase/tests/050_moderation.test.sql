begin;
select plan(61);

-- fixtures
select set_config('t.admin', tests.create_member('0xc000000000000000000000000000000000000001', null, true)::text, true);
select set_config('t.admin2', tests.create_member('0xc000000000000000000000000000000000000002', current_setting('t.admin')::uuid)::text, true);
select set_config('t.sp', tests.create_member('0xc000000000000000000000000000000000000003', current_setting('t.admin')::uuid)::text, true);
select set_config('t.sp2', tests.create_member('0xc000000000000000000000000000000000000004', current_setting('t.admin')::uuid)::text, true);
select set_config('t.mod', tests.create_member('0xc000000000000000000000000000000000000005', current_setting('t.admin')::uuid)::text, true);
select set_config('t.peer', tests.create_member('0xc000000000000000000000000000000000000006', current_setting('t.admin')::uuid)::text, true);
select set_config('t.plain', tests.create_member('0xc000000000000000000000000000000000000007', current_setting('t.admin')::uuid)::text, true);
select set_config('t.vic', tests.create_member('0xc000000000000000000000000000000000000008', current_setting('t.sp')::uuid)::text, true);
select set_config('t.kid', tests.create_member('0xc000000000000000000000000000000000000009', current_setting('t.vic')::uuid)::text, true);
select set_config('t.vic2', tests.create_member('0xc00000000000000000000000000000000000000a', current_setting('t.sp2')::uuid)::text, true);
select set_config('t.vic3', tests.create_member('0xc00000000000000000000000000000000000000b', current_setting('t.admin')::uuid)::text, true);
select set_config('t.vic4', tests.create_member('0xc00000000000000000000000000000000000000c', current_setting('t.sp')::uuid)::text, true);
select set_config('t.newbie', tests.create_wallet_user('0xd000000000000000000000000000000000000001')::text, true);

insert into public.member_roles (member_id, role_id)
  select m, r.id from public.roles r,
    unnest(array[current_setting('t.admin')::uuid, current_setting('t.admin2')::uuid]) m where r.name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select m, r.id from public.roles r,
    unnest(array[current_setting('t.sp')::uuid, current_setting('t.sp2')::uuid,
                 current_setting('t.mod')::uuid, current_setting('t.peer')::uuid]) m where r.name = 'Padrino';
-- mod: Padrino (position 10) + BAN_MEMBERS (32) + MANAGE_ROLES (64) via override
insert into public.member_permission_overrides (member_id, allow) values (current_setting('t.mod')::uuid, 96);
-- extra roles for set_member_role hierarchy checks
insert into public.roles (name, color, position, permissions) values ('Helper', '#112233', 5, 0);
insert into public.roles (name, color, position, permissions) values ('Chief', '#112233', 20, 0);

-- active invites: victim's and the sponsors'
insert into public.invites (code, created_by, max_uses, expires_at) values
  ('vic-code-aaaaaaaaaaaa', current_setting('t.vic')::uuid, 5, now() + interval '1 day'),
  ('sp-code-aaaaaaaaaaaaa', current_setting('t.sp')::uuid, 5, now() + interval '1 day'),
  ('sp2-code-aaaaaaaaaaaa', current_setting('t.sp2')::uuid, 5, now() + interval '1 day');

-- sessions for the victim and for an unrelated member
insert into auth.sessions (id, user_id, created_at, updated_at)
  select gen_random_uuid(), auth_user_id, now(), now() from public.members
  where id in (current_setting('t.vic')::uuid, current_setting('t.sp')::uuid);

create function pg_temp.uid(p_member text) returns uuid language sql security definer as
  $$ select auth_user_id from public.members where id = p_member::uuid $$;

-- privileges
select ok(not has_function_privilege('anon', 'public.ban_member(uuid,text,boolean)', 'execute'), 'anon cannot ban_member');
select ok(not has_function_privilege('anon', 'public.set_member_role(uuid,uuid,boolean)', 'execute'), 'anon cannot set_member_role');
select ok(has_function_privilege('authenticated', 'public.ban_member(uuid,text,boolean)', 'execute'), 'authenticated can execute ban_member');
select ok(has_function_privilege('authenticated', 'public.set_member_role(uuid,uuid,boolean)', 'execute'), 'authenticated can execute set_member_role');

-- ban_member: authorization and hierarchy
select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select throws_ok(format($q$select public.ban_member(%L::uuid, 'spam spam', false)$q$, current_setting('t.vic')),
  'P0001', 'forbidden', 'no BAN_MEMBERS -> forbidden');
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp')));
select throws_ok(format($q$select public.ban_member(%L::uuid, 'spam spam', false)$q$, current_setting('t.vic')),
  'P0001', 'forbidden', 'Padrino without BAN_MEMBERS -> forbidden');
select tests.clear_authentication();
select throws_ok($q$select public.ban_member(gen_random_uuid(), 'spam spam', false)$q$,
  'P0001', 'forbidden', 'no session -> forbidden');

select tests.authenticate_as(pg_temp.uid(current_setting('t.mod')));
select throws_ok(format($q$select public.ban_member(%L::uuid, 'spam spam', false)$q$, current_setting('t.peer')),
  'P0001', 'hierarchy', 'ban a peer (same position) -> hierarchy');
select throws_ok(format($q$select public.ban_member(%L::uuid, 'spam spam', false)$q$, current_setting('t.admin2')),
  'P0001', 'hierarchy', 'ban a superior -> hierarchy');
select throws_ok(format($q$select public.ban_member(%L::uuid, 'spam spam', false)$q$, current_setting('t.admin')),
  'P0001', 'hierarchy', 'ban the bootstrap admin -> hierarchy');
select throws_ok(format($q$select public.ban_member(%L::uuid, 'spam spam', false)$q$, current_setting('t.mod')),
  'P0001', 'hierarchy', 'ban self -> hierarchy');

select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select throws_ok(format($q$select public.ban_member(%L::uuid, 'spam spam', false)$q$, current_setting('t.admin')),
  'P0001', 'hierarchy', 'admin bans self -> hierarchy');
select throws_ok(format($q$select public.ban_member(%L::uuid, 'spam spam', false)$q$, current_setting('t.admin2')),
  'P0001', 'hierarchy', 'admin bans equal-rank admin -> hierarchy');
select throws_ok($q$select public.ban_member(gen_random_uuid(), 'spam spam', false)$q$,
  'P0001', 'invalid_input', 'nonexistent target -> invalid_input');
select throws_ok($q$select public.ban_member(null, 'spam spam', false)$q$,
  'P0001', 'invalid_input', 'null target -> invalid_input');
select throws_ok(format($q$select public.ban_member(%L::uuid, 'ab', false)$q$, current_setting('t.vic')),
  'P0001', 'invalid_input', '2-char reason -> invalid_input');
select throws_ok(format($q$select public.ban_member(%L::uuid, '   a   ', false)$q$, current_setting('t.vic')),
  'P0001', 'invalid_input', 'reason too short after trim -> invalid_input');
select throws_ok(format($q$select public.ban_member(%L::uuid, null, false)$q$, current_setting('t.vic')),
  'P0001', 'invalid_input', 'null reason -> invalid_input');
select throws_ok(format($q$select public.ban_member(%L::uuid, %L, false)$q$, current_setting('t.vic'), repeat('x', 501)),
  'P0001', 'invalid_input', '501-char reason -> invalid_input');
select tests.clear_authentication();
select is((select status from public.members where id = current_setting('t.vic')::uuid), 'active', 'rejected bans leave target active');

-- ban with sponsor penalty
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select set_config('t.ban1', public.ban_member(current_setting('t.vic')::uuid, '  scam links  ', true)::text, true);
select throws_ok(format($q$select public.ban_member(%L::uuid, 'again again', false)$q$, current_setting('t.vic')),
  'P0001', 'invalid_input', 'already banned -> invalid_input');
select tests.clear_authentication();

select is((select status from public.members where id = current_setting('t.vic')::uuid), 'banned', 'target is banned');
select ok((select banned_by = current_setting('t.admin')::uuid and member_id = current_setting('t.vic')::uuid
    and reason = 'scam links' and sponsor_member_id = current_setting('t.sp')::uuid and sponsor_penalized
    and lifted_at is null
  from public.bans where id = current_setting('t.ban1')::uuid), 'bans row: actor, trimmed reason, sponsor, penalized');
select is((select count(*)::int from public.audit_log where action = 'member_banned' and actor_member_id = current_setting('t.admin')::uuid
    and target_type = 'member' and target_id = current_setting('t.vic')::uuid
    and payload = jsonb_build_object('penalized_sponsor', true, 'sponsor_member_id', current_setting('t.sp')::uuid)), 1,
  'member_banned audited with penalty payload');
select ok((select revoked_at is not null and revoked_reason = 'member_banned' from public.invites where code = 'vic-code-aaaaaaaaaaaa'),
  'target invites revoked with member_banned');
select ok((select revoked_at is not null and revoked_reason = 'sponsor_penalized' from public.invites where code = 'sp-code-aaaaaaaaaaaaa'),
  'sponsor invites revoked with sponsor_penalized');
select is((select count(*)::int from public.members where id = current_setting('t.kid')::uuid and needs_review_since is not null), 1,
  'invitees of target flagged for review');
select is((select count(*)::int from public.members where id = current_setting('t.vic4')::uuid and needs_review_since is not null), 0,
  'unrelated members not flagged');
select is(public.member_global_permissions(current_setting('t.sp')::uuid) & 16, 0::bigint, 'sponsor lost CREATE_INVITES');
select ok((select deny & 16 = 16 and reason = 'sponsor_penalty' and set_by = current_setting('t.admin')::uuid
  from public.member_permission_overrides where member_id = current_setting('t.sp')::uuid), 'sponsor override recorded');
select is(public.member_global_permissions(current_setting('t.sp')::uuid) & 7, 7::bigint, 'sponsor keeps base permissions');
select is((select count(*)::int from auth.sessions where user_id = pg_temp.uid(current_setting('t.vic'))), 0, 'target sessions deleted');
select is((select count(*)::int from auth.sessions where user_id = pg_temp.uid(current_setting('t.sp'))), 1, 'other sessions untouched');

-- consequences for the sponsor and the target
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp')));
select throws_ok($q$select public.create_invite(5, 24)$q$, 'P0001', 'forbidden', 'penalized sponsor cannot create invites');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.newbie')::uuid);
select throws_ok($q$select public.redeem_invite('vic-code-aaaaaaaaaaaa')$q$, 'P0001', 'invite_revoked', 'banned creator invite -> invite_revoked');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.vic')));
select is((select count(*)::int from public.members), 0, 'banned_member_reads_nothing');
select throws_ok($q$select public.create_invite(5, 24)$q$, 'P0001', 'forbidden', 'banned member cannot create invites');
select throws_ok(format($q$select public.ban_member(%L::uuid, 'revenge!', false)$q$, current_setting('t.vic4')),
  'P0001', 'forbidden', 'banned member cannot ban');
select tests.clear_authentication();

-- ban without penalty: sponsor keeps CREATE_INVITES and invites
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select set_config('t.ban2', public.ban_member(current_setting('t.vic2')::uuid, 'no penalty', false)::text, true);
select tests.clear_authentication();
select is(public.member_global_permissions(current_setting('t.sp2')::uuid) & 16, 16::bigint, 'unpenalized sponsor keeps CREATE_INVITES');
select ok((select revoked_at is null from public.invites where code = 'sp2-code-aaaaaaaaaaaa'), 'unpenalized sponsor keeps invites');
select is((select count(*)::int from public.member_permission_overrides where member_id = current_setting('t.sp2')::uuid), 0, 'no override created without penalty');
select ok((select not sponsor_penalized and sponsor_member_id = current_setting('t.sp2')::uuid from public.bans where id = current_setting('t.ban2')::uuid),
  'bans row records sponsor without penalty');

-- admin sponsors are never penalized, even when requested
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select set_config('t.ban3', public.ban_member(current_setting('t.vic3')::uuid, 'admin sponsor', true)::text, true);
select tests.clear_authentication();
select ok((select not sponsor_penalized and sponsor_member_id = current_setting('t.admin')::uuid from public.bans where id = current_setting('t.ban3')::uuid),
  'admin sponsor not penalized');
select is((select count(*)::int from public.member_permission_overrides where member_id = current_setting('t.admin')::uuid), 0, 'no override on admin sponsor');
select is(public.member_global_permissions(current_setting('t.admin')::uuid), 1023::bigint, 'admin keeps all permissions');

-- a moderator with BAN_MEMBERS (lower than admin) can ban a lower member
select tests.authenticate_as(pg_temp.uid(current_setting('t.mod')));
select ok(public.ban_member(current_setting('t.vic4')::uuid, 'mod ban', false) is not null, 'moderator bans lower-ranked member');
select tests.clear_authentication();

-- set_member_role
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.set_member_role(current_setting('t.plain')::uuid, (select id from public.roles where name = 'Padrino'), true);
select tests.clear_authentication();
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where mr.member_id = current_setting('t.plain')::uuid and r.name = 'Padrino'), 1, 'admin assigns Padrino');
select is(public.member_global_permissions(current_setting('t.plain')::uuid) & 16, 16::bigint, 'plain member now has CREATE_INVITES');
select is((select count(*)::int from public.audit_log where action = 'member_role_set' and actor_member_id = current_setting('t.admin')::uuid
    and target_type = 'member' and target_id = current_setting('t.plain')::uuid
    and payload = jsonb_build_object('role_id', (select id from public.roles where name = 'Padrino'), 'enabled', true)), 1,
  'member_role_set audited');

select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.set_member_role(current_setting('t.plain')::uuid, (select id from public.roles where name = 'Padrino'), true);
select public.set_member_role(current_setting('t.plain')::uuid, (select id from public.roles where name = 'Padrino'), false);
select tests.clear_authentication();
select is((select count(*)::int from public.member_roles where member_id = current_setting('t.plain')::uuid), 0, 'enable is idempotent; disable removes');

select tests.authenticate_as(pg_temp.uid(current_setting('t.sp2')));
select throws_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, true)$q$, current_setting('t.plain'), (select id from public.roles where name = 'Helper')),
  'P0001', 'forbidden', 'Padrino without MANAGE_ROLES -> forbidden');
select tests.clear_authentication();

select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select throws_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, true)$q$, current_setting('t.plain'), (select id from public.roles where name = 'SuperAdmin')),
  'P0001', 'forbidden', 'cannot assign system role');
select throws_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, true)$q$, current_setting('t.plain'), (select id from public.roles where name = '@everyone')),
  'P0001', 'forbidden', 'cannot touch @everyone');
select throws_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, false)$q$, current_setting('t.admin2'), (select id from public.roles where name = 'SuperAdmin')),
  'P0001', 'forbidden', 'cannot remove system role');
select throws_ok(format($q$select public.set_member_role(%L::uuid, gen_random_uuid(), true)$q$, current_setting('t.plain')),
  'P0001', 'invalid_input', 'unknown role -> invalid_input');
select throws_ok(format($q$select public.set_member_role(gen_random_uuid(), %L::uuid, true)$q$, (select id from public.roles where name = 'Padrino')),
  'P0001', 'invalid_input', 'unknown member -> invalid_input');
select throws_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, true)$q$, current_setting('t.admin2'), (select id from public.roles where name = 'Padrino')),
  'P0001', 'hierarchy', 'cannot edit an equal-rank member');
select tests.clear_authentication();

-- moderator (position 10, MANAGE_ROLES via override)
select tests.authenticate_as(pg_temp.uid(current_setting('t.mod')));
select throws_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, true)$q$, current_setting('t.plain'), (select id from public.roles where name = 'Padrino')),
  'P0001', 'hierarchy', 'role at actor position -> hierarchy');
select throws_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, true)$q$, current_setting('t.plain'), (select id from public.roles where name = 'Chief')),
  'P0001', 'hierarchy', 'role above actor -> hierarchy');
select throws_ok(format($q$select public.set_member_role(%L::uuid, %L::uuid, true)$q$, current_setting('t.peer'), (select id from public.roles where name = 'Helper')),
  'P0001', 'hierarchy', 'target peer of actor -> hierarchy');
select public.set_member_role(current_setting('t.plain')::uuid, (select id from public.roles where name = 'Helper'), true);
select tests.clear_authentication();
select is((select count(*)::int from public.member_roles mr join public.roles r on r.id = mr.role_id
  where mr.member_id = current_setting('t.plain')::uuid and r.name = 'Helper'), 1, 'moderator assigns a lower role to a lower member');

select * from finish();
rollback;
