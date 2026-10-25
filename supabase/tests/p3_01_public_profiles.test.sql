-- P3 Task 2 (migration 20261025200001): ElClub Pay public profiles (P3-R3, D22, decision 12).
--   - public_profiles: own alias (^[a-z0-9_]{3,20}$, club reserved words + route words, tests/fixtures/public-aliases.json),
--     display name, wallet (the session wallet), accepted networks (base / arbitrum), opt-in member badge.
--   - upsert_public_profile / my_public_profile: authenticated public accounts (a banned club member is forbidden),
--     30 / hour on the shared 'profile' bucket with subject 'u:' || auth.uid().
--   - public_profile_view / public_profile_by_address: service role only. Nothing for anon; tables closed.
begin;
select plan(55);

create function pg_temp.up(p_alias text, p_name text, p_nets text[], p_badge boolean default false) returns text
language plpgsql as $$
begin
  perform public.upsert_public_profile(p_alias, p_name, p_nets, p_badge);
  return 'ok';
exception when others then
  return sqlerrm;
end $$;
create function tests.pp_view(p_target text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  set local role service_role;
  v := public.public_profile_view(p_target);
  reset role;
  return v;
end;
$$;
create function tests.pp_by_address(p_address text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  set local role service_role;
  v := public.public_profile_by_address(p_address);
  reset role;
  return v;
end;
$$;
grant execute on function pg_temp.up(text, text, text[], boolean) to public;

-- ===== fixtures =====
select set_config('t.a1', '0x' || lpad('c3c01', 40, '0'), true);
select set_config('t.a2', '0x' || lpad('c3c02', 40, '0'), true);
select set_config('t.a3', '0x' || lpad('c3c03', 40, '0'), true);
select set_config('t.u1', tests.create_wallet_user(current_setting('t.a1'))::text, true);
select set_config('t.u2', tests.create_wallet_user(current_setting('t.a2'))::text, true);
select set_config('t.u3', tests.create_wallet_user(current_setting('t.a3'))::text, true);
select set_config('t.boot', tests.create_member('0x' || lpad('c3c04', 40, '0'), null, true)::text, true);
select set_config('t.banned', tests.create_member('0x' || lpad('c3c05', 40, '0'), current_setting('t.boot')::uuid, false)::text, true);
update public.members set status = 'banned' where id = current_setting('t.banned')::uuid;
select set_config('t.uboot', (select auth_user_id::text from public.members where id = current_setting('t.boot')::uuid), true);
select set_config('t.ubanned', (select auth_user_id::text from public.members where id = current_setting('t.banned')::uuid), true);

-- ===== 1. privileges =====
select ok(not has_function_privilege('anon', 'public.upsert_public_profile(text,text,text[],boolean)', 'execute')
      and not has_function_privilege('anon', 'public.my_public_profile()', 'execute')
      and not has_function_privilege('anon', 'public.public_profile_view(text)', 'execute')
      and not has_function_privilege('anon', 'public.public_profile_by_address(text)', 'execute'),
  'anon cannot execute any of the new functions');
select ok(has_function_privilege('authenticated', 'public.upsert_public_profile(text,text,text[],boolean)', 'execute')
      and has_function_privilege('authenticated', 'public.my_public_profile()', 'execute')
      and not has_function_privilege('authenticated', 'public.public_profile_view(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.public_profile_by_address(text)', 'execute'),
  'authenticated: upsert / mine, not view nor by_address');
select ok(has_function_privilege('service_role', 'public.public_profile_view(text)', 'execute')
      and has_function_privilege('service_role', 'public.public_profile_by_address(text)', 'execute'),
  'service_role: view and by_address');
select ok(not has_table_privilege('anon', 'public.public_profiles', 'select')
      and not has_table_privilege('authenticated', 'public.public_profiles', 'select')
      and not has_table_privilege('authenticated', 'public.public_profiles', 'insert')
      and not has_table_privilege('authenticated', 'public.public_profiles', 'update'),
  'public_profiles closed to the API roles');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.public_profiles'::regclass), 'RLS on public_profiles');

set local role anon;
select throws_ok($$select public.upsert_public_profile('anon_x', null, array['base'], false)$$, '42501', null,
  'anon cannot call upsert_public_profile');
select throws_ok($$select public.public_profile_view('anon_x')$$, '42501', null, 'anon cannot call public_profile_view');
reset role;

-- ===== 2. create, read, change =====
select tests.authenticate_as(current_setting('t.u1')::uuid);
select is(public.my_public_profile(), null, 'no profile yet: my_public_profile is null');
select is(public.upsert_public_profile('Alias_1 ', '  Ray  ', array['ARBITRUM', 'base', 'base'], false),
  jsonb_build_object('alias', 'alias_1', 'displayName', 'Ray', 'address', current_setting('t.a1'),
    'acceptNetworks', jsonb_build_array('base', 'arbitrum'), 'showMemberBadge', false),
  '"Alias_1 " is stored as alias_1; name trimmed; networks normalised (lower, dedupe, base then arbitrum)');
select is(public.my_public_profile(),
  jsonb_build_object('alias', 'alias_1', 'displayName', 'Ray', 'address', current_setting('t.a1'),
    'acceptNetworks', jsonb_build_array('base', 'arbitrum'), 'showMemberBadge', false),
  'my_public_profile reads it back');
select is(public.upsert_public_profile('alias_2', '', array['arbitrum'], true),
  jsonb_build_object('alias', 'alias_2', 'displayName', null, 'address', current_setting('t.a1'),
    'acceptNetworks', jsonb_build_array('arbitrum'), 'showMemberBadge', true),
  'alias changed; a blank name is stored as null; one network; badge on');
select tests.clear_authentication();
select is((select count(*)::int from public.public_profiles where user_id = current_setting('t.u1')::uuid), 1,
  'one row per user: the change updated it');
select is((select alias::text from public.public_profiles where user_id = current_setting('t.u1')::uuid), 'alias_2',
  'alias persisted');

-- ===== 3. alias rules =====
select tests.authenticate_as(current_setting('t.u2')::uuid);
select is(pg_temp.up('ab', null, array['base']), 'alias_invalid', 'too short');
select is(pg_temp.up('aaaaaaaaaaaaaaaaaaaaa', null, array['base']), 'alias_invalid', '21 chars');
select is(pg_temp.up('a.b.c', null, array['base']), 'alias_invalid', 'dots rejected');
select is(pg_temp.up('a-b-c', null, array['base']), 'alias_invalid', 'dashes rejected');
select is(pg_temp.up(E'аdmin', null, array['base']), 'alias_invalid', 'cyrillic a look-alike rejected');
select is(pg_temp.up(E'Kelvin', null, array['base']), 'alias_invalid', 'kelvin sign rejected');
select is(pg_temp.up(null, null, array['base']), 'alias_invalid', 'null rejected');
select is(pg_temp.up('admin', null, array['base']), 'alias_reserved', 'admin is reserved');
select is(pg_temp.up('pay', null, array['base']), 'alias_reserved', 'pay is reserved');
select is(pg_temp.up('donar', null, array['base']), 'alias_reserved', 'donar is reserved');
select is(pg_temp.up('ADMIN ', null, array['base']), 'alias_reserved', 'ADMIN with a trailing space is reserved');
-- the same list as tests/fixtures/public-aliases.json (a unit test pins the parity of both lists)
select is((select count(*)::int from unnest(array['admin', 'administrador', 'superadmin', 'elclub', 'el_club', 'sistema',
  'system', 'soporte', 'support', 'moderador', 'mod', 'staff', 'everyone', 'here', 'todos', 'anonimo', 'null', 'undefined',
  'pay', 'tx', 'tools', 'herramientas', 'start', 'donar', 'donate', 'en', 'es', 'elclubpay']) r
  where pg_temp.up(upper(r), null, array['base']) = case when char_length(r) < 3 then 'alias_invalid' else 'alias_reserved' end),
  28, 'every reserved word is rejected in any case (2-letter ones fail the format first)');
select is(pg_temp.up('alias_2', null, array['base']), 'alias_taken', 'alias taken by another user');
select is(pg_temp.up('ALIAS_2', null, array['base']), 'alias_taken', 'a case variant is taken too');
select is(public.my_public_profile(), null, 'rejected inputs stored nothing');

-- ===== 4. networks and display name =====
select is(pg_temp.up('user_two', null, array[]::text[]), 'networks_invalid', 'no networks rejected');
select is(pg_temp.up('user_two', null, null), 'networks_invalid', 'null networks rejected');
select is(pg_temp.up('user_two', null, array['linea']), 'networks_invalid', 'linea rejected');
select is(pg_temp.up('user_two', null, array['base', 'linea']), 'networks_invalid', 'any unknown network rejects the set');
select is(pg_temp.up('user_two', repeat('n', 41), array['base']), 'display_name_invalid', '41-char name rejected');
select is(pg_temp.up('user_two', E'a\u0007b', array['base']), 'display_name_invalid', 'control characters rejected');
select is(pg_temp.up('user_two', repeat('n', 40), array['base']), 'ok', '40-char name accepted');
select tests.clear_authentication();

-- ===== 5. the session wallet is the identity =====
update auth.identities
  set identity_data = jsonb_set(identity_data, '{custom_claims,address}', to_jsonb(upper(current_setting('t.a3'))))
  where user_id = current_setting('t.u2')::uuid;
select tests.authenticate_as(current_setting('t.u2')::uuid);
select is(public.upsert_public_profile('user_two', null, array['base'], false)->>'address', current_setting('t.a3'),
  'wallet_address is refreshed from auth_wallet_address() on update (lower-cased)');
select tests.clear_authentication();

-- ===== 6. who may write =====
select tests.authenticate_as(current_setting('t.ubanned')::uuid);
select throws_ok($$select public.upsert_public_profile('banned_one', null, array['base'], false)$$, 'P0001', 'forbidden',
  'a banned club member cannot create a public profile');
select tests.clear_authentication();

insert into private.rate_limit_hits (subject, bucket, window_start, hits)
values ('u:' || current_setting('t.u3'), 'profile', date_bin(interval '1 hour', now(), timestamptz '2000-01-01Z'), 30);
select tests.authenticate_as(current_setting('t.u3')::uuid);
select throws_ok($$select public.upsert_public_profile('user_three', null, array['base'], false)$$, 'P0001', 'rate_limited',
  'the 31st profile write in an hour: rate_limited');
select tests.clear_authentication();

-- ===== 7. public view (service role) =====
select tests.authenticate_as(current_setting('t.u1')::uuid);
select throws_ok($$select public.public_profile_view('alias_2')$$, '42501', null, 'authenticated cannot call public_profile_view');
select tests.clear_authentication();

select is(tests.pp_view('alias_2'),
  jsonb_build_object('alias', 'alias_2', 'displayName', null, 'address', current_setting('t.a1'),
    'acceptNetworks', jsonb_build_array('arbitrum'), 'isMember', false),
  'view by alias: badge on but not a member, so isMember is false');
select is(tests.pp_view('ALIAS_2')->>'alias', 'alias_2', 'view by alias is case-insensitive');
select is(tests.pp_view(upper(replace(current_setting('t.a1'), '0x', '0X')))->>'alias', null,
  '0X prefix is not an address nor an alias');
select is(tests.pp_view('0x' || upper(substr(current_setting('t.a1'), 3)))->>'alias', 'alias_2',
  'view by address (mixed case) finds the profile');
select is(tests.pp_view('0x' || lpad('c3c99', 40, '0')),
  jsonb_build_object('alias', null, 'displayName', null, 'address', '0x' || lpad('c3c99', 40, '0'),
    'acceptNetworks', jsonb_build_array('base', 'arbitrum'), 'isMember', false),
  'an address without a profile accepts every network');
select is(tests.pp_view('nobody_here'), null, 'unknown alias: null');
select is(tests.pp_view('a.b'), null, 'invalid target: null');
select is(tests.pp_view(null), null, 'null target: null');

-- isMember needs the badge AND an active membership
select tests.authenticate_as(current_setting('t.uboot')::uuid);
select is(pg_temp.up('boot_one', null, array['base'], false), 'ok', 'an active member creates a profile');
select tests.clear_authentication();
select is(tests.pp_view('boot_one')->'isMember', 'false'::jsonb, 'member without the badge: isMember false');
select tests.authenticate_as(current_setting('t.uboot')::uuid);
select is(pg_temp.up('boot_one', null, array['base'], true), 'ok', 'the member turns the badge on');
select tests.clear_authentication();
select is(tests.pp_view('boot_one')->'isMember', 'true'::jsonb, 'member with the badge: isMember true');
update public.members set status = 'left' where id = current_setting('t.boot')::uuid;
select is(tests.pp_view('boot_one')->'isMember', 'false'::jsonb, 'a member no longer active: isMember false');

-- ===== 8. by address (receipt) =====
select is(tests.pp_by_address('0x' || upper(substr(current_setting('t.a3'), 3))), jsonb_build_object('alias', 'user_two', 'displayName', null),
  'by_address: alias and name of the profile with that wallet');
select is(tests.pp_by_address('0x' || lpad('c3c99', 40, '0')), null, 'by_address: no profile, null');
select is(tests.pp_by_address('nope'), null, 'by_address: invalid address, null');

select * from finish();
rollback;
