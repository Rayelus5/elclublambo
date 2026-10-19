-- F4e final review fixes (migration 20261019500004).
--   F4e-R5: the poll_closed push reads "Se ha cerrado la encuesta en la que votaste en #<canal>" (impersonal), like the
--           in-app notice; _push_build keeps its definer settings and stays internal.
--   M4 (accepted behaviour, pinned): a voter who also holds a moderator notice (report_new) on the poll message keeps
--      it at finalize; the one-notice-per-member-per-message index then drops that voter's poll_closed. Other voters get
--      theirs as usual.
--   M5 (comment only, see the migration): a vote in flight at closes_at can appear in reads a few milliseconds after the
--      close; the finalized result waits for it (close_due_polls locks the poll row FOR UPDATE).
-- Setup: SuperAdmin S, author A (Verificado), moderator M (Moderador), voters V1, V2; channel t973.
begin;
select plan(7);

create function tests.login(p_member text) returns void language plpgsql as $$
begin
  perform tests.clear_authentication();
  perform tests.authenticate_as((select m.auth_user_id from public.members m where m.id = p_member::uuid));
end;
$$;
create function tests.opt(p_poll text, p_pos int) returns uuid language sql security definer set search_path = '' as $$
  select o.id from public.poll_options o where o.poll_id = p_poll::uuid and o.position = p_pos
$$;
create function tests.vote_as(p_member text, p_poll text, p_pos int) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.login(p_member);
  v := public.cast_poll_vote(p_poll::uuid, tests.opt(p_poll, p_pos));
  perform tests.clear_authentication();
  return v;
end;
$$;

-- ===== fixtures =====
select set_config('t.s', tests.create_member('0x' || lpad('f9730', 40, '0'), null, true)::text, true);
select set_config('t.a', tests.create_member('0x' || lpad('f9731', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.m', tests.create_member('0x' || lpad('f9732', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.v1', tests.create_member('0x' || lpad('f9733', 40, '0'), current_setting('t.s')::uuid)::text, true);
select set_config('t.v2', tests.create_member('0x' || lpad('f9734', 40, '0'), current_setting('t.s')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.s')::uuid, id from public.roles where name = 'SuperAdmin';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.a')::uuid, id from public.roles where system_key = 'verified';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.m')::uuid, id from public.roles where name = 'Moderador';
select set_config('t.cat', tests.create_channel(null, 'category', 'T973cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't973')::text, true);
update public.app_config set value = '59141'::jsonb where key = 'active_chain_id';

select tests.login(current_setting('t.a'));
select set_config('t.p', public.create_poll(current_setting('t.ch')::uuid, '¿Té o café?', array['Té', 'Café'],
                                             now() + interval '1 day', 'equal')::text, true);
select tests.clear_authentication();
select tests.vote_as(current_setting('t.m'), current_setting('t.p'), 1);
select tests.vote_as(current_setting('t.v1'), current_setting('t.p'), 1);
select tests.vote_as(current_setting('t.v2'), current_setting('t.p'), 2);
-- the moderator holds a report notice about the poll message itself
insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id, data)
  values (current_setting('t.m')::uuid, 'report_new', current_setting('t.v1')::uuid, current_setting('t.ch')::uuid,
          current_setting('t.p')::uuid, '{}'::jsonb);
update public.polls set closes_at = now() - interval '1 minute' where message_id = current_setting('t.p')::uuid;
set local role service_role;
select public.close_due_polls();
reset role;

-- ===== M4 =====
select is((select jsonb_agg(kind order by kind) from public.notifications
           where recipient_id = current_setting('t.m')::uuid and message_id = current_setting('t.p')::uuid),
  '["report_new"]'::jsonb, 'M4: the voting moderator keeps the report_new notice on the poll message');
select is((select count(*)::int from public.notifications
           where recipient_id = current_setting('t.m')::uuid and kind = 'poll_closed'), 0,
  'M4: and gets no poll_closed (one notice per member per message)');
select is((select count(*)::int from public.notifications
           where kind = 'poll_closed' and message_id = current_setting('t.p')::uuid
             and recipient_id in (current_setting('t.v1')::uuid, current_setting('t.v2')::uuid)), 2,
  'M4: the other voters get their poll_closed');

-- ===== F4e-R5 =====
select set_config('t.n1', (select id::text from public.notifications where kind = 'poll_closed'
                             and recipient_id = current_setting('t.v1')::uuid and message_id = current_setting('t.p')::uuid), true);
select is((select jsonb_build_object('title', title, 'body', body, 'url', url, 'tag', tag)
           from public._push_build(current_setting('t.n1')::bigint)),
  jsonb_build_object('title', 'Encuesta cerrada',
                     'body', 'Se ha cerrado la encuesta en la que votaste en #t973: «¿Té o café?»',
                     'url', '/c/' || current_setting('t.ch') || '?m=' || current_setting('t.p') || '&h=n' || current_setting('t.n1'),
                     'tag', 'poll_closed:' || current_setting('t.p')),
  'F4e-R5: the poll_closed push uses the impersonal copy; title, URL and tag unchanged');
select ok((select position('Ha cerrado la encuesta' in p.prosrc) = 0
           from pg_proc p where p.oid = 'public._push_build(bigint)'::regprocedure),
  'F4e-R5: the old wording is gone from _push_build');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
           from pg_proc p where p.oid = 'public._push_build(bigint)'::regprocedure),
  '_push_build is still security definer with an empty search_path');
select ok(not has_function_privilege('anon', 'public._push_build(bigint)', 'execute')
      and not has_function_privilege('authenticated', 'public._push_build(bigint)', 'execute')
      and not has_function_privilege('service_role', 'public._push_build(bigint)', 'execute'),
  '_push_build is still internal');

select * from finish();
rollback;
