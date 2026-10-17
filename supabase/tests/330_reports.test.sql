begin;
select plan(53);

-- helpers (rolled back with the test)
create function pg_temp.uid(p_member text) returns uuid language sql as
  $$ select auth_user_id from public.members where id = p_member::uuid $$;
create function pg_temp.msg(p_ch text, p_author text, p_text text) returns uuid language sql as
  $$ insert into public.messages (channel_id, author_id, body, body_text, allow_links)
     values (p_ch::uuid, p_author::uuid, '{"type":"doc"}'::jsonb, p_text, false) returning id $$;
create function pg_temp.nn(p_member text, p_kind text) returns int language sql as
  $$ select count(*)::int from public.notifications n where n.recipient_id = p_member::uuid and n.kind = p_kind $$;

-- privileges
select ok(has_function_privilege('authenticated', 'public.report_message(uuid,text,text)', 'execute'), 'authenticated can report');
select ok(not has_function_privilege('anon', 'public.report_message(uuid,text,text)', 'execute'), 'anon cannot report');
select ok(not has_function_privilege('service_role', 'public.report_message(uuid,text,text)', 'execute'), 'service_role cannot report');
select ok(has_function_privilege('authenticated', 'public.resolve_report(uuid,text)', 'execute'), 'authenticated can resolve');
select ok(not has_function_privilege('anon', 'public.resolve_report(uuid,text)', 'execute'), 'anon cannot resolve');
select ok(not has_table_privilege('authenticated', 'public.reports', 'insert'), 'no direct insert on reports');
select ok(not has_table_privilege('authenticated', 'public.reports', 'update'), 'no direct update on reports');

-- ===== fixtures =====
select set_config('t.admin', tests.create_member('0x' || lpad('d3300', 40, '0'), null, true)::text, true);
select set_config('t.au', tests.create_member('0x' || lpad('d3301', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.rep', tests.create_member('0x' || lpad('d3302', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.rep2', tests.create_member('0x' || lpad('d3303', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.mod', tests.create_member('0x' || lpad('d3304', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.mod2', tests.create_member('0x' || lpad('d3305', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.plain', tests.create_member('0x' || lpad('d3306', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.gone', tests.create_member('0x' || lpad('d3307', 40, '0'), current_setting('t.admin')::uuid)::text, true);
update public.members set status = 'banned' where id = current_setting('t.gone')::uuid;
-- mod3: MANAGE_MESSAGES only through an overwrite on channel c2; vm: has the mods role but VIEW denied on channel c
select set_config('t.mod3', tests.create_member('0x' || lpad('d3308', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.vm', tests.create_member('0x' || lpad('d3309', 40, '0'), current_setting('t.admin')::uuid)::text, true);

-- moderators: role with MANAGE_MESSAGES (8) on top of @everyone
insert into public.roles (name, color, position, permissions) values ('T330 mods', '#AAAAAA', 63, 8);
insert into public.member_roles (member_id, role_id)
  select m, r.id from public.roles r,
    unnest(array[current_setting('t.mod')::uuid, current_setting('t.mod2')::uuid, current_setting('t.gone')::uuid,
                 current_setting('t.vm')::uuid]) m
  where r.name = 'T330 mods';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.admin')::uuid, id from public.roles where name = 'SuperAdmin';

select set_config('t.cat', tests.create_channel(null, 'category', 'T330cat')::text, true);
select set_config('t.c', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't330')::text, true);
select set_config('t.c2', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't330b')::text, true);
select set_config('t.hid', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't330hid')::text, true);
-- rep cannot see the hidden channel; mod2 has no MANAGE_MESSAGES in t.c
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
  (current_setting('t.hid')::uuid, 'member', current_setting('t.rep')::uuid, 0, 1),
  (current_setting('t.c')::uuid, 'member', current_setting('t.mod2')::uuid, 0, 8),
  (current_setting('t.c2')::uuid, 'member', current_setting('t.mod3')::uuid, 8, 0),
  (current_setting('t.c')::uuid, 'member', current_setting('t.vm')::uuid, 0, 1);

select set_config('t.m1', pg_temp.msg(current_setting('t.c'), current_setting('t.au'), 'estafa total aqui')::text, true);
select set_config('t.m2', pg_temp.msg(current_setting('t.c'), current_setting('t.rep'), 'mensaje del reportante')::text, true);
select set_config('t.m3', pg_temp.msg(current_setting('t.c'), current_setting('t.au'), 'mensaje borrado')::text, true);
update public.messages set deleted_at = now() where id = current_setting('t.m3')::uuid;
select set_config('t.m4', pg_temp.msg(current_setting('t.hid'), current_setting('t.au'), 'mensaje oculto')::text, true);
select set_config('t.m6', pg_temp.msg(current_setting('t.c2'), current_setting('t.au'), 'texto en c2')::text, true);
select set_config('t.m5', pg_temp.msg(current_setting('t.c'), current_setting('t.au'), repeat('x', 1500))::text, true);

-- ===== forbidden: own, deleted, hidden, missing (same error, no existence oracle) =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.rep')));
select throws_ok(format($q$select public.report_message(%L::uuid, 'spam', null)$q$, current_setting('t.m2')), 'forbidden', 'own message: forbidden');
select throws_ok(format($q$select public.report_message(%L::uuid, 'spam', null)$q$, current_setting('t.m3')), 'forbidden', 'deleted message: forbidden');
select throws_ok(format($q$select public.report_message(%L::uuid, 'spam', null)$q$, current_setting('t.m4')), 'forbidden', 'message in a hidden channel: forbidden');
select throws_ok($q$select public.report_message(gen_random_uuid(), 'spam', null)$q$, 'forbidden', 'missing message: same forbidden');
select throws_ok($q$select public.report_message(null, 'spam', null)$q$, 'forbidden', 'null message: forbidden');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.gone')));
select throws_ok(format($q$select public.report_message(%L::uuid, 'spam', null)$q$, current_setting('t.m1')), 'forbidden', 'banned member: forbidden');
select tests.clear_authentication();

-- ===== validation =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.rep')));
select throws_ok(format($q$select public.report_message(%L::uuid, 'nope', null)$q$, current_setting('t.m1')), 'invalid_input', 'unknown reason: invalid_input');
select throws_ok(format($q$select public.report_message(%L::uuid, 'spam', %L)$q$, current_setting('t.m1'), repeat('n', 501)), 'invalid_input', 'note over 500: invalid_input');
select is((select count(*)::int from public.reports), 0, 'nothing stored by the failed calls');

-- ===== happy path =====
select set_config('t.r1', public.report_message(current_setting('t.m1')::uuid, 'scam', 'parece una estafa')::text, true);
select tests.clear_authentication();
select is((select reason from public.reports where id = current_setting('t.r1')::uuid), 'scam', 'reason stored');
select is((select note from public.reports where id = current_setting('t.r1')::uuid), 'parece una estafa', 'note stored');
select is((select snapshot_author_id from public.reports where id = current_setting('t.r1')::uuid), current_setting('t.au')::uuid, 'snapshot author');
select is((select snapshot_text from public.reports where id = current_setting('t.r1')::uuid), 'estafa total aqui', 'snapshot text');
select is((select status from public.reports where id = current_setting('t.r1')::uuid), 'open', 'status open');

-- long text is cut to 1000
select tests.authenticate_as(pg_temp.uid(current_setting('t.rep')));
select set_config('t.r5', public.report_message(current_setting('t.m5')::uuid, 'other', null)::text, true);
select tests.clear_authentication();
select is((select char_length(snapshot_text) from public.reports where id = current_setting('t.r5')::uuid), 1000, 'snapshot cut to 1000 chars');

-- ===== notifications to staff =====
select is(pg_temp.nn(current_setting('t.mod'), 'report_new'), 2, 'moderator with MANAGE_MESSAGES got report_new per report');
select is(pg_temp.nn(current_setting('t.admin'), 'report_new'), 2, 'administrator got report_new');
select is(pg_temp.nn(current_setting('t.mod2'), 'report_new') + pg_temp.nn(current_setting('t.plain'), 'report_new')
  + pg_temp.nn(current_setting('t.rep'), 'report_new') + pg_temp.nn(current_setting('t.gone'), 'report_new'), 0,
  'no notice for deny-8 moderator, plain member, reporter or banned staff');
select ok((select n.message_id is null and n.channel_id = current_setting('t.c')::uuid
             and n.data = jsonb_build_object('report_id', current_setting('t.r1')) and n.actor_id = current_setting('t.rep')::uuid
           from public.notifications n where n.recipient_id = current_setting('t.mod')::uuid and n.kind = 'report_new'
             and n.data->>'report_id' = current_setting('t.r1')),
  'notice carries channel, report id and actor, no message id');

-- ===== per-channel staff scope: a report in c2 (mod3 has 8 only there; vm has 8 everywhere but VIEW denied in c) =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.rep2')));
select set_config('t.r6', public.report_message(current_setting('t.m6')::uuid, 'spam', null)::text, true);
select tests.clear_authentication();
select is(pg_temp.nn(current_setting('t.mod3'), 'report_new'), 1, 'bit 8 through an overwrite in c2 gets the c2 report notice');
select is((select count(*)::int from public.notifications where recipient_id = current_setting('t.mod3')::uuid
  and kind = 'report_new' and channel_id = current_setting('t.c')::uuid), 0, 'mod3 got no notice for channel c');
select is((select count(*)::int from public.notifications where recipient_id = current_setting('t.vm')::uuid
  and kind = 'report_new' and channel_id = current_setting('t.c')::uuid), 0, 'bit 8 with VIEW denied: no report_new for channel c');

-- ===== already_reported (same member, same open report) =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.rep')));
select throws_ok(format($q$select public.report_message(%L::uuid, 'spam', null)$q$, current_setting('t.m1')), 'already_reported', 'second open report: already_reported');
select tests.clear_authentication();
-- another reporter can still report the same message
select tests.authenticate_as(pg_temp.uid(current_setting('t.rep2')));
select set_config('t.r1b', public.report_message(current_setting('t.m1')::uuid, 'abuse', null)::text, true);
select tests.clear_authentication();
select is((select count(*)::int from public.reports where message_id = current_setting('t.m1')::uuid), 2, 'a second reporter adds a second report');

-- ===== rate limit: 10 per hour per reporter, any status =====
-- rep already has 2 reports (m1, m5); 8 more reach 10, the 11th is rejected
do $$
declare i int; v_m uuid;
begin
  for i in 1..9 loop
    v_m := pg_temp.msg(current_setting('t.c'), current_setting('t.au'), 'bulk ' || i);
    perform set_config('t.bulk' || i, v_m::text, true);
  end loop;
end $$;
select tests.authenticate_as(pg_temp.uid(current_setting('t.rep')));
select public.report_message(current_setting('t.bulk' || i)::uuid, 'spam', null) from generate_series(1, 8) i;
select throws_ok(format($q$select public.report_message(%L::uuid, 'spam', null)$q$, current_setting('t.bulk9')), 'rate_limited', 'the 11th report in an hour: rate_limited');
select tests.clear_authentication();
select is((select count(*)::int from public.reports where reporter_id = current_setting('t.rep')::uuid), 10, 'exactly 10 reports stored');
-- resolved reports still count; old ones (>1h) do not
update public.reports set status = 'dismissed'
  where reporter_id = current_setting('t.rep')::uuid and message_id <> current_setting('t.m1')::uuid;
select tests.authenticate_as(pg_temp.uid(current_setting('t.rep')));
select throws_ok(format($q$select public.report_message(%L::uuid, 'spam', null)$q$, current_setting('t.bulk9')), 'rate_limited', 'resolved reports still count toward the limit');
select tests.clear_authentication();
update public.reports set created_at = now() - interval '2 hours' where reporter_id = current_setting('t.rep')::uuid;
select tests.authenticate_as(pg_temp.uid(current_setting('t.rep')));
select lives_ok(format($q$select public.report_message(%L::uuid, 'spam', null)$q$, current_setting('t.bulk9')), 'reports older than an hour free the quota');
select tests.clear_authentication();

-- ===== queue (RLS) =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select is((select count(*)::int from public.reports), 0, 'plain member sees no reports');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.rep')));
select is((select count(*)::int from public.reports), 0, 'the reporter does not see the queue either');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.mod2')));
select is((select count(*)::int from public.reports where channel_id = current_setting('t.c')::uuid), 0, 'moderator with deny 8 in the channel sees none of its reports');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.mod')));
-- rep: m1, m5, bulk 1..8 and bulk 9 = 11; rep2: m1 and the c2 message = 2
select is((select count(*)::int from public.reports), 13, 'moderator with 8 sees exactly the 13 reports');
select is((select string_agg(distinct snapshot_text, '|' order by snapshot_text) from public.reports where status = 'open'),
  'bulk 9|estafa total aqui|texto en c2', 'open queue snapshots are exactly the expected texts');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.mod3')));
select is((select string_agg(snapshot_text, '|') from public.reports), 'texto en c2', 'overwrite-only moderator sees only the c2 report');
select throws_ok(format($q$select public.resolve_report(%L::uuid, 'dismissed')$q$, current_setting('t.r1')), 'forbidden', 'overwrite-only moderator cannot resolve a report of channel c');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.vm')));
select is((select count(*)::int from public.reports where channel_id = current_setting('t.c')::uuid), 0, 'bit 8 with VIEW denied sees no report of channel c');
select throws_ok(format($q$select public.resolve_report(%L::uuid, 'dismissed')$q$, current_setting('t.r1')), 'forbidden', 'bit 8 with VIEW denied cannot resolve');
select tests.clear_authentication();

-- ===== resolve_report =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.plain')));
select throws_ok(format($q$select public.resolve_report(%L::uuid, 'dismissed')$q$, current_setting('t.r1')), 'forbidden', 'plain member cannot resolve');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.mod2')));
select throws_ok(format($q$select public.resolve_report(%L::uuid, 'dismissed')$q$, current_setting('t.r1')), 'forbidden', 'deny-8 moderator cannot resolve');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.mod')));
select throws_ok(format($q$select public.resolve_report(%L::uuid, 'open')$q$, current_setting('t.r1')), 'invalid_input', 'invalid status');
select throws_ok($q$select public.resolve_report(gen_random_uuid(), 'dismissed')$q$, 'forbidden', 'missing report: forbidden');
select is(public.resolve_report(current_setting('t.r1')::uuid, 'actioned'), 2, 'resolving closes every open report of the message');
select tests.clear_authentication();
select is((select count(*)::int from public.reports where message_id = current_setting('t.m1')::uuid and status = 'actioned'
  and resolved_by = current_setting('t.mod')::uuid and resolved_at is not null), 2, 'both marked with resolver and time');
select is((select payload from public.audit_log where action = 'report_resolved' and target_id = current_setting('t.r1')::uuid),
  jsonb_build_object('status', 'actioned', 'count', 2, 'message_id', current_setting('t.m1')), 'audit entry with status, count and message');
select tests.authenticate_as(pg_temp.uid(current_setting('t.mod')));
select is(public.resolve_report(current_setting('t.r1')::uuid, 'dismissed'), 0, 'resolving again changes nothing');
select tests.clear_authentication();

-- ===== message deletion keeps the snapshot =====
delete from public.messages where id = current_setting('t.m1')::uuid;
select ok((select message_id is null and snapshot_text = 'estafa total aqui' and snapshot_author_id = current_setting('t.au')::uuid
           from public.reports where id = current_setting('t.r1')::uuid), 'report keeps its snapshot after the message is gone');

select * from finish();
rollback;
