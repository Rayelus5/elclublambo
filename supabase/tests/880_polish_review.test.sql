-- Review fixes of the F3 polish round: system_key roles never raise a member's rank (I1), a delegate cannot shift them
-- (I2), and the activity feed only announces credited donations (M2).
begin;
select plan(7);

select set_config('t.a', tests.create_member('0x' || lpad('f8800', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f8801', 40, '0'), current_setting('t.a')::uuid)::text, true);
insert into public.member_roles (member_id, role_id) select current_setting('t.a')::uuid, id from public.roles where name = 'SuperAdmin';
-- b: Moderador + Verificado, with MANAGE_ROLES (64) via an override, like a delegate
insert into public.member_roles (member_id, role_id) select current_setting('t.b')::uuid, id from public.roles where name in ('Moderador', 'Verificado');
insert into public.member_permission_overrides (member_id, allow, deny) values (current_setting('t.b')::uuid, 64, 0);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.mod', (select id::text from public.roles where name = 'Moderador'), true);
select set_config('t.verified', (select id::text from public.roles where system_key = 'verified'), true);
select set_config('t.modpos', (select position::text from public.roles where name = 'Moderador'), true);

-- I1: the SuperAdmin ranks Verificado above Moderador; b's rank stays Moderador's
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok(format($q$select public.move_role(%L::uuid, %s)$q$, current_setting('t.verified'), current_setting('t.modpos')::int + 50),
  'the SuperAdmin moves Verificado above Moderador');
select tests.clear_authentication();
select is(public.member_top_position(current_setting('t.b')::uuid), current_setting('t.modpos')::int,
  'a system_key role never raises a member''s rank');
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.update_role(%L::uuid, 'Moderador', '#61DFFF', 0)$q$, current_setting('t.mod')),
  'P0001', 'hierarchy', 'a verified moderator still cannot edit the Moderador role');
select throws_ok(format($q$select public.delete_role(%L::uuid)$q$, current_setting('t.mod')),
  'P0001', 'hierarchy', 'nor delete it');
select tests.clear_authentication();

-- I2: a delegate's move that would shift a system_key role is refused
update public.roles set position = 300 where id = current_setting('t.verified')::uuid;
insert into public.roles (name, color, position, permissions) values ('T880low', '#A3A3A3', 299, 0);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select throws_ok(format($q$select public.move_role(%L::uuid, 300)$q$, (select id from public.roles where name = 'T880low')),
  'P0001', 'hierarchy', 'a delegate cannot push Verificado out of its slot');
select tests.clear_authentication();

-- M2: a pending donation is not announced; once credited it is
insert into public.payment_intents (id, member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
  recipient_address, target_type, status)
values ('8800b000-0000-4000-8000-000000000001', current_setting('t.b')::uuid, 'donation', 59141, 'USDC', 4000000, 0, 0, 0,
  '0x00000000000000000000000000000000000000cc', 'dao', 'confirmed');
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';
insert into public.dao_ledger (id, chain_id, kind, member_id, amount_usdc, intent_id, tx_hash, log_index, block_number)
values ('8800c000-0000-4000-8000-000000000001', 59141, 'donation', current_setting('t.b')::uuid, 4000000,
  '8800b000-0000-4000-8000-000000000001', '0x' || repeat('9', 64), 0, 1);
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select count(*)::int from public.club_activity(50) where kind = 'donation' and amount_text = '4000000'), 0,
  'a donation pending finality is not in the feed');
select tests.clear_authentication();
update public.dao_ledger set status = 'credited', shares_delta = 1, credited_at = now() where id = '8800c000-0000-4000-8000-000000000001';
select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select actor_label from public.club_activity(50) where kind = 'donation' and amount_text = '4000000'), 'Anónimo',
  'once credited it is announced, as Anónimo for a hidden donor');
select tests.clear_authentication();

select * from finish();
rollback;
