begin;
select plan(43);

-- fixtures: admin (bootstrap, SuperAdmin), sponsor + sponsor2 (Padrino), plain member
select set_config('t.admin', tests.create_member('0xa000000000000000000000000000000000000001', null, true)::text, true);
select set_config('t.sp', tests.create_member('0xa000000000000000000000000000000000000002', current_setting('t.admin')::uuid)::text, true);
select set_config('t.sp2', tests.create_member('0xa000000000000000000000000000000000000003', current_setting('t.admin')::uuid)::text, true);
select set_config('t.plain', tests.create_member('0xa000000000000000000000000000000000000004', current_setting('t.admin')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.admin')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select m, r.id from public.roles r,
    unnest(array[current_setting('t.sp')::uuid, current_setting('t.sp2')::uuid]) m where r.name = 'Padrino';

create function pg_temp.uid(p_member text) returns uuid language sql as
  $$ select auth_user_id from public.members where id = p_member::uuid $$;

create function pg_temp.code(p_invite text) returns text language sql security definer as
  $$ select code from public.invites where id = p_invite::uuid $$;

select set_config('t.n1', tests.create_wallet_user('0xb000000000000000000000000000000000000001')::text, true);
select set_config('t.n2', tests.create_wallet_user('0xb000000000000000000000000000000000000002')::text, true);
select set_config('t.n3', tests.create_wallet_user('0xb000000000000000000000000000000000000003')::text, true);
select set_config('t.n5', tests.create_wallet_user('0xb000000000000000000000000000000000000005')::text, true);

-- privileges
select ok(not has_function_privilege('anon', 'public.create_invite(int,int)', 'execute'), 'anon cannot create_invite');
select ok(not has_function_privilege('anon', 'public.revoke_invite(uuid,text)', 'execute'), 'anon cannot revoke_invite');
select ok(not has_function_privilege('anon', 'public.redeem_invite(text)', 'execute'), 'anon cannot redeem_invite');
select ok(has_function_privilege('authenticated', 'public.redeem_invite(text)', 'execute'), 'authenticated can redeem_invite');

-- create_invite
select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select throws_ok($q$select public.create_invite(5, 24)$q$, 'P0001', 'forbidden', 'no CREATE_INVITES -> forbidden');

select tests.authenticate_as(pg_temp.uid(current_setting('t.sp')));
select set_config('t.inv1', (public.create_invite(5, 24)).id::text, true);
select set_config('t.inv_x', (public.create_invite(1, 24)).id::text, true);
select throws_ok($q$select public.create_invite(0, 24)$q$, 'P0001', 'invalid_input', 'max_uses 0');
select throws_ok($q$select public.create_invite(101, 24)$q$, 'P0001', 'invalid_input', 'max_uses 101');
select throws_ok($q$select public.create_invite(5, 0)$q$, 'P0001', 'invalid_input', 'hours 0');
select throws_ok($q$select public.create_invite(5, 721)$q$, 'P0001', 'invalid_input', 'hours 721');
select throws_ok($q$select public.create_invite(null, 24)$q$, 'P0001', 'invalid_input', 'null max_uses');
select throws_ok($q$select public.create_invite(5, null)$q$, 'P0001', 'invalid_input', 'null hours');
select tests.clear_authentication();

select ok((select length(code) = 22 and code ~ '^[A-Za-z0-9_-]{22}$' and created_by = current_setting('t.sp')::uuid
    and max_uses = 5 and uses = 0 and expires_at > now() + interval '23 hours' and expires_at < now() + interval '25 hours'
  from public.invites where id = current_setting('t.inv1')::uuid), 'invite row: 22-char base64url code, creator, expiry');
select is((select count(*)::int from public.audit_log where action = 'invite_created' and target_id = current_setting('t.inv1')::uuid
  and actor_member_id = current_setting('t.sp')::uuid and payload = '{"max_uses":5,"expires_in_hours":24}'::jsonb), 1, 'invite_created audited');

-- banned padrino cannot create
update public.members set status = 'banned' where id = current_setting('t.sp2')::uuid;
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp2')));
select throws_ok($q$select public.create_invite(5, 24)$q$, 'P0001', 'forbidden', 'banned padrino -> forbidden');
select tests.clear_authentication();
update public.members set status = 'active' where id = current_setting('t.sp2')::uuid;

-- redeem: valid
select tests.authenticate_as(current_setting('t.n1')::uuid);
select set_config('t.m_n1', public.redeem_invite(pg_temp.code(current_setting('t.inv1')))::text, true);
select tests.clear_authentication();
select ok((select invited_by_member_id = current_setting('t.sp')::uuid and invite_id = current_setting('t.inv1')::uuid
    and status = 'active' and not is_bootstrap and wallet_address = '0xb000000000000000000000000000000000000001'
    and auth_user_id = current_setting('t.n1')::uuid
  from public.members where id = current_setting('t.m_n1')::uuid), 'member created with sponsor linkage');
select is((select uses from public.invites where id = current_setting('t.inv1')::uuid), 1, 'uses incremented');
select is((select count(*)::int from public.invite_redemptions where invite_id = current_setting('t.inv1')::uuid
  and member_id = current_setting('t.m_n1')::uuid), 1, 'redemption recorded');
select is((select count(*)::int from public.audit_log where action = 'invite_redeemed' and actor_member_id = current_setting('t.m_n1')::uuid
  and target_type = 'invite' and target_id = current_setting('t.inv1')::uuid
  and payload = jsonb_build_object('code_prefix', left(pg_temp.code(current_setting('t.inv1')), 4))), 1,
  'invite_redeemed audited with code prefix only');

-- already member (same user)
select tests.authenticate_as(current_setting('t.n1')::uuid);
select throws_ok(format($q$select public.redeem_invite(%L)$q$, pg_temp.code(current_setting('t.inv1'))),
  'P0001', 'already_member', 'existing member -> already_member');
select tests.clear_authentication();
select is((select uses from public.invites where id = current_setting('t.inv1')::uuid), 1, 'uses unchanged after already_member');

-- same wallet, other auth user, different casing
select set_config('t.dup', tests.create_wallet_user('0xB000000000000000000000000000000000000001')::text, true);
select tests.authenticate_as(current_setting('t.dup')::uuid);
select throws_ok(format($q$select public.redeem_invite(%L)$q$, pg_temp.code(current_setting('t.inv1'))),
  'P0001', 'already_member', 'same wallet other auth user -> already_member');
select tests.clear_authentication();
select is((select count(*)::int from public.members where wallet_address = '0xb000000000000000000000000000000000000001'), 1, 'no duplicate member');

-- exhausted at max_uses (inv_x has max_uses = 1)
select tests.authenticate_as(current_setting('t.n2')::uuid);
select ok(public.redeem_invite(pg_temp.code(current_setting('t.inv_x'))) is not null, 'last use redeemed');
select tests.clear_authentication();
select tests.authenticate_as(current_setting('t.n3')::uuid);
select throws_ok(format($q$select public.redeem_invite(%L)$q$, pg_temp.code(current_setting('t.inv_x'))),
  'P0001', 'invite_exhausted', 'second redeem of last use -> invite_exhausted');
select throws_ok($q$select public.redeem_invite('nope-no-such-code')$q$, 'P0001', 'invite_not_found', 'unknown code -> invite_not_found');
select throws_ok($q$select public.redeem_invite(null)$q$, 'P0001', 'invite_not_found', 'null code -> invite_not_found');
select tests.clear_authentication();

-- expired
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp')));
select set_config('t.inv_e', (public.create_invite(5, 24)).id::text, true);
select set_config('t.inv_r', (public.create_invite(5, 24)).id::text, true);
select set_config('t.inv_b', (public.create_invite(5, 24)).id::text, true);
select tests.clear_authentication();
update public.invites set expires_at = now() - interval '1 second' where id = current_setting('t.inv_e')::uuid;
select tests.authenticate_as(current_setting('t.n3')::uuid);
select throws_ok(format($q$select public.redeem_invite(%L)$q$, pg_temp.code(current_setting('t.inv_e'))),
  'P0001', 'invite_expired', 'expired -> invite_expired');
select tests.clear_authentication();

-- revoke_invite
select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select throws_ok(format($q$select public.revoke_invite(%L::uuid, 'x')$q$, current_setting('t.inv_r')), 'P0001', 'forbidden', 'non-creator without BAN -> forbidden');
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp')));
select throws_ok($q$select public.revoke_invite(gen_random_uuid(), 'x')$q$, 'P0001', 'invite_not_found', 'unknown invite -> invite_not_found');
select public.revoke_invite(current_setting('t.inv_r')::uuid, '   ');
select tests.clear_authentication();
select ok((select revoked_at is not null and revoked_reason = 'revoked_by_user' from public.invites where id = current_setting('t.inv_r')::uuid),
  'creator revoked with default reason');
select is((select count(*)::int from public.audit_log where action = 'invite_revoked' and target_id = current_setting('t.inv_r')::uuid), 1, 'invite_revoked audited');
select tests.authenticate_as(current_setting('t.n3')::uuid);
select throws_ok(format($q$select public.redeem_invite(%L)$q$, pg_temp.code(current_setting('t.inv_r'))),
  'P0001', 'invite_revoked', 'revoked -> invite_revoked');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.revoke_invite(current_setting('t.inv_b')::uuid, 'spam');
select tests.clear_authentication();
select is((select revoked_reason from public.invites where id = current_setting('t.inv_b')::uuid), 'spam', 'admin (BAN_MEMBERS) can revoke any invite');

-- revoking twice keeps the original reason and does not re-audit
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select public.revoke_invite(current_setting('t.inv_b')::uuid, 'second reason');
select tests.clear_authentication();
select is((select revoked_reason from public.invites where id = current_setting('t.inv_b')::uuid), 'spam', 'second revoke keeps original reason');
select is((select count(*)::int from public.audit_log where action = 'invite_revoked' and target_id = current_setting('t.inv_b')::uuid), 1, 'second revoke is not re-audited');

-- reason length cap (200 after trim)
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp')));
select throws_ok(format($q$select public.revoke_invite(%L::uuid, %L)$q$, current_setting('t.inv1'), repeat('x', 201)),
  'P0001', 'invalid_input', '201-char reason -> invalid_input');
select tests.clear_authentication();

-- creator no longer active -> invite_revoked
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp')));
select set_config('t.inv_c', (public.create_invite(5, 24)).id::text, true);
select tests.clear_authentication();
update public.members set status = 'banned' where id = current_setting('t.sp')::uuid;
select tests.authenticate_as(current_setting('t.n3')::uuid);
select throws_ok(format($q$select public.redeem_invite(%L)$q$, pg_temp.code(current_setting('t.inv_c'))),
  'P0001', 'invite_revoked', 'banned creator -> invite_revoked');
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp')));
select is((select count(*)::int from public.invites), 0, 'banned creator sees 0 of their invites');
select tests.clear_authentication();
update public.members set status = 'active' where id = current_setting('t.sp')::uuid;

-- not authenticated (no wallet identity)
select tests.authenticate_as(gen_random_uuid());
select throws_ok($q$select public.redeem_invite('whatever')$q$, 'P0001', 'not_authenticated', 'no identity -> not_authenticated');
select tests.clear_authentication();

-- visibility (sponsor created 6 invites: inv1, inv_x, inv_e, inv_r, inv_b, inv_c)
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp')));
select is((select count(*)::int from public.invites), 6, 'creator sees own invites');
select tests.authenticate_as(pg_temp.uid(current_setting('t.sp2')));
select is((select count(*)::int from public.invites), 0, 'other padrino sees none');
select tests.authenticate_as(pg_temp.uid(current_setting('t.admin')));
select is((select count(*)::int from public.invites), 6, 'admin sees all');
select tests.authenticate_as(current_setting('t.n5')::uuid);
select is((select count(*)::int from public.invites), 0, 'non-member sees none');
select tests.clear_authentication();

select * from finish();
rollback;
