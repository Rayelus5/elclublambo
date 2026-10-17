begin;
select plan(98);

create function pg_temp.uid(p_member text) returns uuid language sql as
  $$ select auth_user_id from public.members where id = p_member::uuid $$;
-- notices of one kind, for one recipient and one ticket
create function pg_temp.nt(p_member text, p_kind text, p_ticket text) returns int language sql as
  $$ select count(*)::int from public.notifications n
     where n.recipient_id = p_member::uuid and n.kind = p_kind and n.ticket_id = p_ticket::uuid $$;

-- privileges
select ok(has_function_privilege('authenticated', 'public.open_ticket(uuid,text,text)', 'execute'), 'authenticated can open');
select ok(not has_function_privilege('anon', 'public.open_ticket(uuid,text,text)', 'execute'), 'anon cannot open');
select ok(not has_function_privilege('service_role', 'public.open_ticket(uuid,text,text)', 'execute'), 'service_role cannot open');
select ok(has_function_privilege('authenticated', 'public.post_ticket_message(uuid,text)', 'execute'), 'authenticated can post');
select ok(not has_function_privilege('anon', 'public.post_ticket_message(uuid,text)', 'execute'), 'anon cannot post');
select ok(has_function_privilege('authenticated', 'public.set_ticket_status(uuid,text)', 'execute'), 'authenticated can set status');
select ok(not has_function_privilege('anon', 'public.set_ticket_status(uuid,text)', 'execute'), 'anon cannot set status');
select ok(has_function_privilege('authenticated', 'public._can_access_ticket(uuid)', 'execute'), 'authenticated can call _can_access_ticket');
select ok(not has_function_privilege('anon', 'public._can_access_ticket(uuid)', 'execute'), 'anon cannot call _can_access_ticket');
select ok(not has_function_privilege('authenticated', 'public._member_can_access_ticket(uuid,uuid)', 'execute'), 'authenticated cannot call _member_can_access_ticket');
select ok(not has_function_privilege('service_role', 'public._member_can_access_ticket(uuid,uuid)', 'execute'), 'service_role cannot call _member_can_access_ticket');
select ok(not has_table_privilege('authenticated', 'public.tickets', 'insert'), 'no direct insert on tickets');
select ok(not has_table_privilege('authenticated', 'public.tickets', 'update'), 'no direct update on tickets');
select ok(not has_table_privilege('authenticated', 'public.ticket_messages', 'insert'), 'no direct insert on ticket_messages');
select ok(not has_table_privilege('anon', 'public.tickets', 'select'), 'anon cannot read tickets');
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'realtime_receive_ticket_topics'),
  'ticket topic receive policy exists');

-- ===== fixtures =====
select set_config('t.admin', tests.create_member('0x' || lpad('d3400', 40, '0'), null, true)::text, true);
select set_config('t.a', tests.create_member('0x' || lpad('d3401', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('d3402', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.s', tests.create_member('0x' || lpad('d3403', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.s2', tests.create_member('0x' || lpad('d3404', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.s3', tests.create_member('0x' || lpad('d3405', 40, '0'), current_setting('t.admin')::uuid)::text, true);

insert into public.roles (name, color, position, permissions) values ('T340 support', '#AAAAAA', 62, 16384);
insert into public.member_roles (member_id, role_id)
  select m, r.id from public.roles r,
    unnest(array[current_setting('t.s2')::uuid]) m
  where r.name = 'T340 support';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.admin')::uuid, id from public.roles where name = 'SuperAdmin';

select set_config('t.cat', tests.create_channel(null, 'category', 'T340cat')::text, true);
select set_config('t.tc', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't340')::text, true);
select set_config('t.no', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't340no')::text, true);
select set_config('t.other', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't340other')::text, true);
select set_config('t.voice', tests.create_channel(current_setting('t.cat')::uuid, 'forum', 't340forum')::text, true);
update public.channels set tickets_enabled = true where id in (current_setting('t.tc')::uuid, current_setting('t.other')::uuid);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
  (current_setting('t.tc')::uuid, 'member', current_setting('t.s')::uuid, 16384, 0),
  (current_setting('t.tc')::uuid, 'member', current_setting('t.s2')::uuid, 0, 16384),
  (current_setting('t.other')::uuid, 'member', current_setting('t.s3')::uuid, 16384, 0);

-- ===== opening: rules =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select throws_ok(format($q$select public.open_ticket(%L::uuid, 'Necesito ayuda', 'hola')$q$, current_setting('t.no')), 'forbidden', 'channel without tickets_enabled: forbidden');
select throws_ok(format($q$select public.open_ticket(%L::uuid, 'Necesito ayuda', 'hola')$q$, current_setting('t.voice')), 'forbidden', 'non-text channel: forbidden');
select throws_ok($q$select public.open_ticket(gen_random_uuid(), 'Necesito ayuda', 'hola')$q$, 'forbidden', 'missing channel: forbidden');
select throws_ok(format($q$select public.open_ticket(%L::uuid, 'ab', 'hola')$q$, current_setting('t.tc')), 'invalid_input', 'subject under 3: invalid_input');
select throws_ok(format($q$select public.open_ticket(%L::uuid, %L, 'hola')$q$, current_setting('t.tc'), repeat('s', 121)), 'invalid_input', 'subject over 120: invalid_input');
select throws_ok(format($q$select public.open_ticket(%L::uuid, 'Necesito ayuda', '   ')$q$, current_setting('t.tc')), 'invalid_input', 'blank body: invalid_input');
select throws_ok(format($q$select public.open_ticket(%L::uuid, 'Necesito ayuda', %L)$q$, current_setting('t.tc'), repeat('b', 4001)), 'invalid_input', 'body over 4000: invalid_input');
select is((select count(*)::int from public.tickets), 0, 'failed calls stored nothing');

select set_config('t.t1', public.open_ticket(current_setting('t.tc')::uuid, '  Necesito ayuda  ', '  Mi acceso falla https://ejemplo.com  ')::text, true);
select tests.clear_authentication();
select is((select subject from public.tickets where id = current_setting('t.t1')::uuid), 'Necesito ayuda', 'subject trimmed');
select is((select status from public.tickets where id = current_setting('t.t1')::uuid), 'open', 'opens as open');
select is((select count(*)::int from public.ticket_messages where ticket_id = current_setting('t.t1')::uuid
  and author_id = current_setting('t.a')::uuid and body_text = 'Mi acceso falla https://ejemplo.com'), 1, 'first message created, trimmed');
select is((select allow_links from public.ticket_messages where ticket_id = current_setting('t.t1')::uuid),
  (public.channel_permissions(current_setting('t.a')::uuid, current_setting('t.tc')::uuid) & 2048) = 2048,
  'allow_links = author EMBED_LINKS in the channel');

-- ticket_new: staff with 16384 in the channel only
select is(pg_temp.nt(current_setting('t.s'), 'ticket_new', current_setting('t.t1')), 1, 'support got ticket_new');
select is(pg_temp.nt(current_setting('t.admin'), 'ticket_new', current_setting('t.t1')), 1, 'administrator got ticket_new');
select is(pg_temp.nt(current_setting('t.s2'), 'ticket_new', current_setting('t.t1'))
  + pg_temp.nt(current_setting('t.s3'), 'ticket_new', current_setting('t.t1'))
  + pg_temp.nt(current_setting('t.b'), 'ticket_new', current_setting('t.t1'))
  + pg_temp.nt(current_setting('t.a'), 'ticket_new', current_setting('t.t1')), 0,
  'no ticket_new for deny-16384 staff, staff of another channel, a plain member or the author');
select ok((select n.channel_id is null and n.message_id is null and n.actor_id = current_setting('t.a')::uuid
           from public.notifications n where n.recipient_id = current_setting('t.s')::uuid and n.kind = 'ticket_new'),
  'ticket_new carries ticket and actor but no channel or message');

-- ===== open-ticket limit: 3 open per author =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select set_config('t.t2', public.open_ticket(current_setting('t.tc')::uuid, 'Segundo asunto', 'segundo')::text, true);
select set_config('t.t3', public.open_ticket(current_setting('t.other')::uuid, 'Tercer asunto', 'tercero')::text, true);
select throws_ok(format($q$select public.open_ticket(%L::uuid, 'Cuarto asunto', 'cuarto')$q$, current_setting('t.tc')), 'too_many_open_tickets', 'fourth open ticket: too_many_open_tickets');
select public.set_ticket_status(current_setting('t.t3')::uuid, 'closed');
select set_config('t.t4', public.open_ticket(current_setting('t.tc')::uuid, 'Cuarto asunto', 'cuarto')::text, true);
select tests.clear_authentication();
select is((select count(*)::int from public.tickets where author_id = current_setting('t.a')::uuid and status = 'open'), 3, 'closing one frees a slot');

-- ===== access =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.b')));
select is((select count(*)::int from public.tickets), 0, 'plain member sees no ticket');
select is((select count(*)::int from public.ticket_messages), 0, 'plain member sees no ticket message');
select is((select count(*)::int from public.notifications), 0, 'plain member sees no ticket notice');
select ok(not public._can_access_ticket(current_setting('t.t1')::uuid), '_can_access_ticket false for a plain member');
select throws_ok(format($q$select public.post_ticket_message(%L::uuid, 'hola')$q$, current_setting('t.t1')), 'forbidden', 'plain member cannot post');
select throws_ok(format($q$select public.set_ticket_status(%L::uuid, 'closed')$q$, current_setting('t.t1')), 'forbidden', 'plain member cannot change status');
select throws_ok($q$select public.post_ticket_message(gen_random_uuid(), 'hola')$q$, 'forbidden', 'missing ticket: same forbidden');
select throws_ok(format($q$insert into public.tickets (channel_id, author_id, subject) values (%L::uuid, %L::uuid, 'directo')$q$, current_setting('t.tc'), current_setting('t.b')), '42501', null, 'no direct insert');
select tests.clear_authentication();

select tests.authenticate_as(pg_temp.uid(current_setting('t.s')));
select is((select count(*)::int from public.tickets where id in (current_setting('t.t1')::uuid, current_setting('t.t2')::uuid, current_setting('t.t4')::uuid)), 3, 'support sees the tickets of its channel');
select is((select count(*)::int from public.tickets where id = current_setting('t.t3')::uuid), 0, 'support does not see a ticket of another channel');
select is((select count(*)::int from public.ticket_messages where ticket_id = current_setting('t.t1')::uuid), 1, 'support sees ticket messages');
select ok(public._can_access_ticket(current_setting('t.t1')::uuid), '_can_access_ticket true for support');
select tests.clear_authentication();

select tests.authenticate_as(pg_temp.uid(current_setting('t.s2')));
select is((select count(*)::int from public.tickets where channel_id = current_setting('t.tc')::uuid), 0, 'support with 16384 denied by overwrite in the channel sees nothing there');
select throws_ok(format($q$select public.post_ticket_message(%L::uuid, 'hola')$q$, current_setting('t.t1')), 'forbidden', 'denied support cannot post');
select tests.clear_authentication();

select tests.authenticate_as(pg_temp.uid(current_setting('t.s3')));
select is((select count(*)::int from public.tickets where id in (current_setting('t.t1')::uuid, current_setting('t.t2')::uuid, current_setting('t.t4')::uuid)), 0, 'staff of another channel does not see these tickets');
select is((select count(*)::int from public.tickets where id = current_setting('t.t3')::uuid), 1, 'but sees the ticket of its own channel');
select tests.clear_authentication();

select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select is((select count(*)::int from public.tickets), 4, 'the author sees own tickets, open and closed');
select tests.clear_authentication();

-- ===== replies and notices =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.s')));
select lives_ok(format($q$select public.post_ticket_message(%L::uuid, 'Lo miramos')$q$, current_setting('t.t1')), 'support replies');
select tests.clear_authentication();
select is(pg_temp.nt(current_setting('t.a'), 'ticket_reply', current_setting('t.t1')), 1, 'staff reply notifies the author');
select is(pg_temp.nt(current_setting('t.admin'), 'ticket_reply', current_setting('t.t1')), 0, 'staff reply does not notify other staff');

select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select lives_ok(format($q$select public.post_ticket_message(%L::uuid, 'Gracias')$q$, current_setting('t.t1')), 'author replies');
select lives_ok(format($q$select public.post_ticket_message(%L::uuid, 'Sin respuesta aun')$q$, current_setting('t.t2')), 'author writes where nobody has replied');
select tests.clear_authentication();
select is(pg_temp.nt(current_setting('t.s'), 'ticket_reply', current_setting('t.t1')), 1, 'author reply notifies the staff who took part');
select is(pg_temp.nt(current_setting('t.admin'), 'ticket_reply', current_setting('t.t1')), 0, 'author reply skips staff who did not take part');
select is(pg_temp.nt(current_setting('t.s'), 'ticket_reply', current_setting('t.t2'))
  + pg_temp.nt(current_setting('t.admin'), 'ticket_reply', current_setting('t.t2')), 2, 'with no staff reply yet, all staff of the channel are notified');
select is(pg_temp.nt(current_setting('t.s2'), 'ticket_reply', current_setting('t.t2'))
  + pg_temp.nt(current_setting('t.s3'), 'ticket_reply', current_setting('t.t2')), 0, 'never to staff without access');
select is((select last_message_at from public.tickets where id = current_setting('t.t1')::uuid),
  (select max(created_at) from public.ticket_messages where ticket_id = current_setting('t.t1')::uuid), 'last_message_at follows the latest message');

select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select throws_ok(format($q$select public.post_ticket_message(%L::uuid, '')$q$, current_setting('t.t1')), 'invalid_input', 'empty message: invalid_input');
select throws_ok(format($q$select public.post_ticket_message(%L::uuid, %L)$q$, current_setting('t.t1'), repeat('x', 4001)), 'invalid_input', 'message over 4000: invalid_input');
select tests.clear_authentication();

-- ===== status transitions =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.s')));
select lives_ok(format($q$select public.set_ticket_status(%L::uuid, 'closed')$q$, current_setting('t.t1')), 'staff closes');
select throws_ok(format($q$select public.set_ticket_status(%L::uuid, 'pending')$q$, current_setting('t.t1')), 'invalid_input', 'unknown status: invalid_input');
select throws_ok(format($q$select public.post_ticket_message(%L::uuid, 'tarde')$q$, current_setting('t.t1')), 'ticket_closed', 'staff cannot write in a closed ticket');
select tests.clear_authentication();
select is(pg_temp.nt(current_setting('t.a'), 'ticket_status', current_setting('t.t1')), 1, 'staff closing notifies the author');
select ok((select closed_by = current_setting('t.s')::uuid and closed_at is not null from public.tickets where id = current_setting('t.t1')::uuid), 'closed_by and closed_at set');

select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select throws_ok(format($q$select public.post_ticket_message(%L::uuid, 'mas cosas')$q$, current_setting('t.t1')), 'ticket_closed', 'author cannot write in a closed ticket');
select throws_ok(format($q$select public.set_ticket_status(%L::uuid, 'open')$q$, current_setting('t.t1')), 'forbidden', 'author cannot reopen');
select tests.clear_authentication();

select tests.authenticate_as(pg_temp.uid(current_setting('t.s')));
select lives_ok(format($q$select public.set_ticket_status(%L::uuid, 'open')$q$, current_setting('t.t1')), 'staff reopens');
select lives_ok(format($q$select public.set_ticket_status(%L::uuid, 'open')$q$, current_setting('t.t1')), 'reopening an open ticket is a no-op');
select tests.clear_authentication();
select is(pg_temp.nt(current_setting('t.a'), 'ticket_status', current_setting('t.t1')), 2, 'reopen notifies once more, the no-op notifies nobody');
select ok((select closed_by is null and closed_at is null and status = 'open' from public.tickets where id = current_setting('t.t1')::uuid), 'reopen clears closed_by and closed_at');

select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select lives_ok(format($q$select public.set_ticket_status(%L::uuid, 'closed')$q$, current_setting('t.t1')), 'author closes');
select tests.clear_authentication();
select is(pg_temp.nt(current_setting('t.s'), 'ticket_status', current_setting('t.t1')), 1, 'author closing notifies the staff who took part');
select is(pg_temp.nt(current_setting('t.admin'), 'ticket_status', current_setting('t.t1')), 0, 'but not staff who did not');
select is(pg_temp.nt(current_setting('t.a'), 'ticket_status', current_setting('t.t1')), 2, 'and not the author');

-- ===== the generic notification filter hides inaccessible tickets everywhere =====
insert into public.notifications (recipient_id, kind, ticket_id)
  values (current_setting('t.b')::uuid, 'ticket_reply', current_setting('t.t2')::uuid);
select tests.authenticate_as(pg_temp.uid(current_setting('t.b')));
select is((select count(*)::int from public.notifications), 0, 'SELECT hides a notice of a ticket the member cannot access');
select is(public.my_unread_notification_count(), 0, 'unread count skips it');
select is(public.mark_notifications_read(null), 0, 'mark all read skips it');
select tests.clear_authentication();
select is((select count(*)::int from public.notifications where recipient_id = current_setting('t.b')::uuid and read_at is null), 1, 'the hidden notice stayed unread');

-- ===== the author keeps the ticket after losing VIEW; loses it when inactive =====
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.tc')::uuid, 'member', current_setting('t.a')::uuid, 0, 1);
select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select is((select count(*)::int from public.tickets where id = current_setting('t.t2')::uuid), 1, 'author without VIEW still sees the ticket');
select is((select count(*)::int from public.ticket_messages where ticket_id = current_setting('t.t2')::uuid), 2, 'and its messages');
select ok(public.my_unread_notification_count() > 0, 'and its notices are counted');
select ok(exists (select 1 from public.notifications where ticket_id = current_setting('t.t1')::uuid), 'and listed');
select lives_ok(format($q$select public.post_ticket_message(%L::uuid, 'sigo aqui')$q$, current_setting('t.t2')), 'and can still write');
select is((select allow_links from public.ticket_messages where ticket_id = current_setting('t.t2')::uuid and body_text = 'sigo aqui'),
  false, 'without channel permissions the message has no links');
select throws_ok(format($q$select public.open_ticket(%L::uuid, 'Otro asunto', 'hola')$q$, current_setting('t.tc')), 'forbidden', 'but cannot open a new ticket without VIEW');
select ok(public.mark_notifications_read(null) > 0, 'mark all read still reaches its ticket notices');
select tests.clear_authentication();

update public.members set status = 'banned' where id = current_setting('t.a')::uuid;
select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select is((select count(*)::int from public.tickets), 0, 'a banned author no longer sees tickets');
select tests.clear_authentication();
update public.members set status = 'active' where id = current_setting('t.a')::uuid;
delete from public.permission_overwrites where channel_id = current_setting('t.tc')::uuid and target_id = current_setting('t.a')::uuid;

-- ===== staff that loses VIEW loses the ticket, its notices, the count and mark-read =====
select is(pg_temp.nt(current_setting('t.s'), 'ticket_new', current_setting('t.t2')), 1, 'support has a ticket_new for t2 before losing VIEW');
update public.permission_overwrites set deny = 1
  where channel_id = current_setting('t.tc')::uuid and target_type = 'member' and target_id = current_setting('t.s')::uuid;
select tests.authenticate_as(pg_temp.uid(current_setting('t.s')));
select is((select count(*)::int from public.tickets where channel_id = current_setting('t.tc')::uuid), 0, 'support without VIEW sees no ticket');
select is((select count(*)::int from public.notifications where ticket_id in (current_setting('t.t1')::uuid, current_setting('t.t2')::uuid, current_setting('t.t4')::uuid)), 0, 'nor their notices');
select is(public.my_unread_notification_count(), 0, 'nor counts them');
select is(public.mark_notifications_read(null), 0, 'nor marks them read');
select tests.clear_authentication();

-- ===== realtime triggers =====
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.ticket_messages'::regclass and tgname = 'ticket_messages_broadcast_insert'), 'ticket_messages broadcast trigger');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.tickets'::regclass and tgname = 'tickets_broadcast_update'), 'tickets broadcast trigger');

select * from finish();
rollback;
