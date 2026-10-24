-- F3-R6: the author cannot delete their own bounty while it has a marked, unpaid solution (bounty_has_solution);
-- moderators still can (the bounty then reads "removed").
begin;
select plan(8);

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.cfg(p_key text) returns text language sql as $$ select current_setting(p_key) $$;
create function tests.marked(p_author_user text, p_solver_user text) returns uuid language plpgsql as $$
declare
  v_b uuid;
  v_r uuid;
begin
  perform tests.authenticate_as(p_author_user::uuid);
  v_b := public.create_bounty(current_setting('t.ch')::uuid, tests.td('bounty'), 84532, 'USDC', 10000000);
  perform tests.authenticate_as(p_solver_user::uuid);
  v_r := public.post_message(current_setting('t.ch')::uuid, tests.td('answer'), 'x', false, v_b, null, '[]'::jsonb);
  perform tests.authenticate_as(p_author_user::uuid);
  perform public.mark_bounty_solution(v_b, v_r);
  perform tests.clear_authentication();
  return v_b;
end;
$$;

select set_config('t.a', tests.create_member('0x' || lpad('d8500', 40, '0'), null, true)::text, true);                       -- author (admin)
select set_config('t.b', tests.create_member('0x' || lpad('d8501', 40, '0'), current_setting('t.a')::uuid)::text, true);    -- solver
select set_config('t.m', tests.create_member('0x' || lpad('d8502', 40, '0'), current_setting('t.a')::uuid)::text, true);    -- moderator
insert into public.member_roles (member_id, role_id)
  select x.id, r.id from (values (current_setting('t.a')::uuid), (current_setting('t.m')::uuid)) x(id), public.roles r where r.name = 'SuperAdmin';
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.um', (select auth_user_id::text from public.members where id = current_setting('t.m')::uuid), true);
select set_config('t.cat', tests.create_channel(null, 'category', 'T850cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't850')::text, true);

select set_config('t.x1', tests.marked(current_setting('t.ua'), current_setting('t.ub'))::text, true);   -- marked, unpaid
select set_config('t.x2', tests.marked(current_setting('t.ua'), current_setting('t.ub'))::text, true);   -- marked, paid
select set_config('t.x3', tests.marked(current_setting('t.ua'), current_setting('t.ub'))::text, true);   -- marked, unpaid (moderator)
update public.bounties set paid_at = solution_marked_at + interval '1 hour' where message_id = current_setting('t.x2')::uuid;
select tests.authenticate_as(current_setting('t.ua')::uuid);
select set_config('t.x4', public.create_bounty(current_setting('t.ch')::uuid, tests.td('open'), 84532, 'USDC', 10000000)::text, true);

select throws_ok($$select public.delete_message(tests.cfg('t.x1')::uuid)$$, 'P0001', 'bounty_has_solution',
  'the author (even with MANAGE_MESSAGES) cannot delete a bounty with a marked, unpaid solution');
select ok((select deleted_at is null from public.messages where id = current_setting('t.x1')::uuid), 'the bounty is still there');
select lives_ok($$select public.delete_message(tests.cfg('t.x2')::uuid)$$, 'a paid bounty can be deleted by its author');
select lives_ok($$select public.delete_message(tests.cfg('t.x4')::uuid)$$, 'an open bounty can be deleted by its author');
select tests.authenticate_as(current_setting('t.um')::uuid);
select lives_ok($$select public.delete_message(tests.cfg('t.x3')::uuid)$$, 'a moderator can still delete it');
select tests.clear_authentication();
select is((select public.bounty_status(b) from public.bounties b where b.message_id = current_setting('t.x3')::uuid), 'removed',
  'and it then reads removed');
select set_config('t.s1', (select solution_message_id::text from public.bounties where message_id = current_setting('t.x1')::uuid), true);
select tests.authenticate_as(current_setting('t.ub')::uuid);
select lives_ok($$select public.delete_message(tests.cfg('t.s1')::uuid)$$,
  'the solver can still delete their own reply (soft delete)');
select tests.clear_authentication();
select ok(not has_function_privilege('anon', 'public.delete_message(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.delete_message(uuid)', 'execute'), 'delete_message grants restated');

select * from finish();
rollback;
