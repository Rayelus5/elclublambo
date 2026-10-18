begin;
select plan(5);

select set_config('t.a', tests.create_member('0x' || lpad('f9000', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('f9001', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);

select is((select chat_density from public.members where id = current_setting('t.a')::uuid), 'standard', 'standard by default');
select tests.authenticate_as(current_setting('t.ua')::uuid);
select lives_ok($$select public.set_chat_density('compact')$$, 'a member switches to compact');
select throws_ok($$select public.set_chat_density('tiny')$$, 'P0001', 'invalid_input', 'only standard or compact');
select tests.clear_authentication();
select is((select chat_density from public.members where id = current_setting('t.a')::uuid), 'compact', 'stored on the caller');
select is((select chat_density from public.members where id = current_setting('t.b')::uuid), 'standard', 'nobody else changes');

select * from finish();
rollback;
