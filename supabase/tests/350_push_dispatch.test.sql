begin;
select plan(89);

-- helpers (rolled back with the test)
create function pg_temp.uid(p_member text) returns uuid language sql as
  $$ select auth_user_id from public.members where id = p_member::uuid $$;
create function pg_temp.mdoc(p_text text, p_target text, p_label text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', p_text || ' '),
      jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('kind', 'member', 'id', p_target, 'label', p_label))))))
$$;
create function pg_temp.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function pg_temp.sub(p_member text, p_ep text) returns void language sql as
  $$ insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
     values (p_member::uuid, 'https://fcm.googleapis.com/fcm/send/' || p_ep, repeat('A', 87), repeat('B', 22)) $$;
-- rows of a claim for one subscription endpoint suffix
create function pg_temp.rows_for(p_claim text, p_ep text) returns int language plpgsql as $$
declare v int;
begin
  execute format('select count(*)::int from %I where endpoint = %L', p_claim, 'https://fcm.googleapis.com/fcm/send/' || p_ep) into v;
  return v;
end;
$$;
create function pg_temp.pushed(p_id text) returns boolean language sql as
  $$ select pushed_at is not null from public.notifications where id = p_id::bigint $$;

-- ===== privileges =====
select ok(has_function_privilege('service_role', 'public.claim_push_notifications(int)', 'execute'), 'service_role can claim');
select ok(not has_function_privilege('authenticated', 'public.claim_push_notifications(int)', 'execute'), 'authenticated cannot claim');
select ok(not has_function_privilege('anon', 'public.claim_push_notifications(int)', 'execute'), 'anon cannot claim');
select ok(has_function_privilege('service_role', 'public.delete_push_subscription_by_endpoint(text)', 'execute'), 'service_role can delete by endpoint');
select ok(not has_function_privilege('authenticated', 'public.delete_push_subscription_by_endpoint(text)', 'execute'), 'authenticated cannot delete by endpoint');
select ok(not has_function_privilege('anon', 'public.delete_push_subscription_by_endpoint(text)', 'execute'), 'anon cannot delete by endpoint');
select ok(not has_function_privilege('authenticated', 'public._push_build(bigint)', 'execute'), 'authenticated cannot _push_build');
select ok(not has_function_privilege('service_role', 'public._push_build(bigint)', 'execute'), 'service_role cannot _push_build');

-- ===== endpoint allowlist: same case table as tests/fixtures/push-endpoints.json (a vitest test checks the parity) =====
select is(public._valid_push_endpoint(c.url), c.ok, 'endpoint ' || c.url) from (values
  ('https://fcm.googleapis.com/fcm/send/abc', true),
  ('https://fcm.googleapis.com', true),
  ('https://FCM.GOOGLEAPIS.COM/fcm/send/abc', true),
  ('https://updates.push.services.mozilla.com/wpush/v2/abc', true),
  ('https://web.push.apple.com/abc', true),
  ('https://api.push.apple.com/abc', true),
  ('https://a.b.push.apple.com/abc', true),
  ('https://wns2-par02p.notify.windows.com/w/?token=abc', true),
  ('http://fcm.googleapis.com/fcm/send/abc', false),
  ('ftp://fcm.googleapis.com/fcm/send/abc', false),
  ('https://127.0.0.1/x', false),
  ('https://localhost/x', false),
  ('https://evil.com/x', false),
  ('https://fcm.googleapis.com.evil.com/x', false),
  ('https://evil-fcm.googleapis.com.attacker.io/x', false),
  ('https://evilfcm.googleapis.com/x', false),
  ('https://evilnotify.windows.com/x', false),
  ('https://notify.windows.com/x', false),
  ('https://push.apple.com/x', false),
  ('https://user:pw@fcm.googleapis.com/x', false),
  ('https://fcm.googleapis.com@evil.com/x', false),
  ('https://fcm.googleapis.com:8443/x', false),
  ('https://fcm.googleapis.com/x#frag', false),
  ('https://fcm.googleapis.com/x y', false),
  ('', false)
) as c(url, ok);

-- ===== fixtures =====
select set_config('t.admin', tests.create_member('0x' || lpad('d3500', 40, '0'), null, true)::text, true);
select set_config('t.a', tests.create_member('0x' || lpad('d3501', 40, '0'), current_setting('t.admin')::uuid)::text, true);  -- actor with display name
select set_config('t.r', tests.create_member('0x' || lpad('d3502', 40, '0'), current_setting('t.admin')::uuid)::text, true);  -- recipient, no display name
select set_config('t.x', tests.create_member('0x' || lpad('d3503', 40, '0'), current_setting('t.admin')::uuid)::text, true);  -- plain member
select set_config('t.mod', tests.create_member('0x' || lpad('d3504', 40, '0'), current_setting('t.admin')::uuid)::text, true); -- MANAGE_MESSAGES
select set_config('t.rv', tests.create_member('0x' || lpad('d3505', 40, '0'), current_setting('t.admin')::uuid)::text, true);  -- BAN_MEMBERS
select set_config('t.s', tests.create_member('0x' || lpad('d3506', 40, '0'), current_setting('t.admin')::uuid)::text, true);   -- MANAGE_TICKETS
select set_config('t.bn', tests.create_member('0x' || lpad('d3507', 40, '0'), current_setting('t.admin')::uuid)::text, true);  -- banned later
select set_config('t.tk', tests.create_member('0x' || lpad('d3508', 40, '0'), current_setting('t.admin')::uuid)::text, true);  -- ticket author
update public.members set display_name = 'Ana' where id = current_setting('t.a')::uuid;

insert into public.roles (name, color, position, permissions) values
  ('T350 mod', '#AAAAAA', 61, 8),
  ('T350 ban', '#BBBBBB', 62, 32);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.mod')::uuid, id from public.roles where name = 'T350 mod';
insert into public.member_roles (member_id, role_id)
  select current_setting('t.rv')::uuid, id from public.roles where name = 'T350 ban';

select set_config('t.cat', tests.create_channel(null, 'category', 'T350cat')::text, true);
select set_config('t.c', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't350')::text, true);
select set_config('t.tc', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't350tickets')::text, true);
update public.channels set tickets_enabled = true where id = current_setting('t.tc')::uuid;
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.tc')::uuid, 'member', current_setting('t.s')::uuid, 16384, 0);

select pg_temp.sub(current_setting('t.a'), 'a1');
select pg_temp.sub(current_setting('t.r'), 'r1');
select pg_temp.sub(current_setting('t.r'), 'r2');
select pg_temp.sub(current_setting('t.x'), 'x1');
select pg_temp.sub(current_setting('t.mod'), 'mod1');
select pg_temp.sub(current_setting('t.rv'), 'rv1');
select pg_temp.sub(current_setting('t.s'), 's1');
select pg_temp.sub(current_setting('t.bn'), 'bn1');
select pg_temp.sub(current_setting('t.tk'), 'tk1');

-- ===== a mention: identity from members, never from the mention label; excerpt <= 80 =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select set_config('t.m1', public.post_message(current_setting('t.c')::uuid,
  pg_temp.mdoc('hola ' || repeat('y', 200), current_setting('t.r'), 'SuperAdmin'),
  'hola ' || repeat('y', 200) || ' @SuperAdmin', false, null, null, '[]'::jsonb)::text, true);
select tests.clear_authentication();
select set_config('t.n1', (select n.id::text from public.notifications n where n.message_id = current_setting('t.m1')::uuid), true);
select ok(current_setting('t.n1') is not null, 'the mention produced one notification');

create temp table c1 as select * from public.claim_push_notifications();
grant select on c1 to public;
select is((select count(*)::int from c1), 2, 'one row per subscription of the recipient (2)');
select is(pg_temp.rows_for('c1', 'r1') + pg_temp.rows_for('c1', 'r2'), 2, 'both rows belong to the recipient subscriptions');
select is((select count(distinct notification_id)::int from c1), 1, 'both rows carry the same notification');
select is((select min(title) from c1), 'Nueva mención', 'title');
select is((select min(split_part(body, ':', 1)) from c1), 'Ana te mencionó en #t350', 'identity phrase uses members.display_name');
select ok((select bool_and(title not like '%SuperAdmin%' and split_part(body, ':', 1) not like '%SuperAdmin%') from c1), 'the fake mention label never reaches the title or the identity phrase');
select ok((select bool_and(body like '%: «%»') from c1), 'the body carries a quoted excerpt');
select ok((select bool_and(char_length(substring(body from '«(.*)»')) between 1 and 80) from c1), 'the excerpt has at most 80 characters');
select is((select min(substring(body from '«(.*)»')) from c1),
  left(regexp_replace((select body_text from public.messages where id = current_setting('t.m1')::uuid), '[[:space:][:cntrl:]]+', ' ', 'g'), 80),
  'the excerpt is the start of the message text');
select is((select min(url) from c1), '/c/' || current_setting('t.c'), 'url is the internal channel route');
select ok((select bool_and(tag like 'mention:%') from c1), 'tag is stable and kind-prefixed');
select ok(pg_temp.pushed(current_setting('t.n1')), 'the notification is marked as pushed');
create temp table c1b as select * from public.claim_push_notifications();
select is((select count(*)::int from c1b), 0, 'a second claim returns nothing');

-- the same ids survive as service_role (the real caller)
set local role service_role;
create temp table c1c as select * from public.claim_push_notifications();
reset role;
select is((select count(*)::int from c1c), 0, 'service_role can call the claim');

-- ===== identity from the wallet when there is no display name =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.r')));
select set_config('t.m2', public.post_message(current_setting('t.c')::uuid,
  pg_temp.mdoc('ey', current_setting('t.a'), 'Ana'), 'ey @Ana', false, null, null, '[]'::jsonb)::text, true);
select tests.clear_authentication();
create temp table c2 as select * from public.claim_push_notifications();
grant select on c2 to public;
select is((select count(*)::int from c2), 1, 'the mentioned actor gets one row');
select is((select split_part(body, ':', 1) from c2),
  (select left(wallet_address, 6) || '…' || right(wallet_address, 4) || ' te mencionó en #t350' from public.members where id = current_setting('t.r')::uuid),
  'without display name the actor is the short wallet');

-- ===== reply and channel_message wording =====
select set_config('t.a_ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't350all')::text, true);
update public.channels set default_follow = 'all' where id = current_setting('t.a_ch')::uuid;
select tests.authenticate_as(pg_temp.uid(current_setting('t.r')));
select set_config('t.root', public.post_message(current_setting('t.c')::uuid, pg_temp.td('raiz'), 'raiz', false, null, null, '[]'::jsonb)::text, true);
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select set_config('t.rep', public.post_message(current_setting('t.c')::uuid, pg_temp.td('respuesta'), 'respuesta', false, current_setting('t.root')::uuid, null, '[]'::jsonb)::text, true);
select set_config('t.pub', public.post_message(current_setting('t.a_ch')::uuid, pg_temp.td('anuncio'), 'anuncio', false, null, null, '[]'::jsonb)::text, true);
select tests.clear_authentication();
create temp table c3 as select * from public.claim_push_notifications();
grant select on c3 to public;
select is((select title from c3 where url = '/c/' || current_setting('t.c') || '?thread=' || current_setting('t.root') limit 1), 'Nueva respuesta', 'reply title');
select is((select split_part(body, ':', 1) from c3 where url like '%?thread=%' limit 1), 'Ana respondió en #t350', 'reply identity phrase');
select ok(exists (select 1 from c3 where url = '/c/' || current_setting('t.c') || '?thread=' || current_setting('t.root')), 'reply url opens the thread');
select ok(exists (select 1 from c3 where title = 'Nuevo mensaje' and url = '/c/' || current_setting('t.a_ch') and split_part(body, ':', 1) = 'Ana publicó en #t350all'),
  'channel_message wording and url');

-- ===== a recipient who lost VIEW: not returned, marked =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select set_config('t.m3', public.post_message(current_setting('t.c')::uuid,
  pg_temp.mdoc('secreto', current_setting('t.r'), 'r'), 'secreto @r', false, null, null, '[]'::jsonb)::text, true);
select tests.clear_authentication();
select set_config('t.n3', (select n.id::text from public.notifications n where n.message_id = current_setting('t.m3')::uuid), true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.c')::uuid, 'member', current_setting('t.r')::uuid, 0, 1);
create temp table c4 as select * from public.claim_push_notifications();
select is((select count(*)::int from c4), 0, 'a notice of a channel the recipient lost is not returned');
select ok(pg_temp.pushed(current_setting('t.n3')), 'and it is marked, so it never goes out later');
delete from public.permission_overwrites where channel_id = current_setting('t.c')::uuid and target_id = current_setting('t.r')::uuid;

-- ===== deleted message: row without excerpt =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select set_config('t.m4', public.post_message(current_setting('t.c')::uuid,
  pg_temp.mdoc('borrame', current_setting('t.r'), 'r'), 'borrame @r', false, null, null, '[]'::jsonb)::text, true);
select tests.clear_authentication();
update public.messages set deleted_at = now() where id = current_setting('t.m4')::uuid;
create temp table c5 as select * from public.claim_push_notifications();
select is((select count(*)::int from c5), 2, 'a deleted message still notifies the identity');
select ok((select bool_and(body not like '%«%' and body not like '%borrame%') from c5), 'but its excerpt is not shown');

-- ===== old notices: marked, not returned =====
insert into public.notifications (recipient_id, kind, actor_id, created_at)
  values (current_setting('t.r')::uuid, 'invite_redeemed', current_setting('t.a')::uuid, now() - interval '20 minutes');
select set_config('t.n_old', (select max(id)::text from public.notifications where created_at < now() - interval '19 minutes'), true);
create temp table c6 as select * from public.claim_push_notifications();
select is((select count(*)::int from c6), 0, 'a 20 minute old notice is not returned');
select ok(pg_temp.pushed(current_setting('t.n_old')), 'but it is marked');

-- ===== other kinds: wording and urls =====
insert into public.notifications (recipient_id, kind, actor_id) values
  (current_setting('t.r')::uuid, 'invite_redeemed', current_setting('t.a')::uuid),
  (current_setting('t.r')::uuid, 'godchild_banned', current_setting('t.a')::uuid),
  (current_setting('t.r')::uuid, 'sponsor_penalized', current_setting('t.a')::uuid);
create temp table c7 as select * from public.claim_push_notifications();
select is((select count(*)::int from c7), 6, 'three notices x two subscriptions');
select ok((select bool_and(url = '/u/' || (select wallet_address from public.members where id = current_setting('t.a')::uuid)) from c7), 'member notices link to the profile');
select ok((select bool_and(body like '%Ana%') from c7), 'identity from members');
select is((select count(distinct title)::int from c7), 3, 'one distinct title per kind');

-- ===== reports: MANAGE_MESSAGES re-checked at send time =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.x')));
select set_config('t.rp', public.report_message(current_setting('t.m1')::uuid, 'spam', null)::text, true);
select tests.clear_authentication();
create temp table c8 as select * from public.claim_push_notifications();
select is(pg_temp.rows_for('c8', 'mod1'), 1, 'the moderator gets the report notice');
select is((select min(url) from c8 where endpoint like '%/mod1'), '/moderation/reports', 'report url');
insert into public.notifications (recipient_id, kind, actor_id, channel_id)
  values (current_setting('t.x')::uuid, 'report_new', current_setting('t.a')::uuid, current_setting('t.c')::uuid);
create temp table c9 as select * from public.claim_push_notifications();
select is((select count(*)::int from c9), 0, 'a report notice for a member without MANAGE_MESSAGES is not returned');

-- ===== member_review: BAN_MEMBERS or ADMINISTRATOR re-checked =====
insert into public.notifications (recipient_id, kind, actor_id) values
  (current_setting('t.x')::uuid, 'member_review', current_setting('t.a')::uuid),
  (current_setting('t.rv')::uuid, 'member_review', current_setting('t.a')::uuid);
create temp table c10 as select * from public.claim_push_notifications();
select is((select count(*)::int from c10), 1, 'only the reviewer with BAN_MEMBERS gets the review notice');
select is(pg_temp.rows_for('c10', 'rv1'), 1, 'it is the reviewer');
select is((select min(url) from c10), '/admin/members', 'review url');

-- ===== inactive recipient =====
update public.members set status = 'banned' where id = current_setting('t.bn')::uuid;
insert into public.notifications (recipient_id, kind, actor_id) values (current_setting('t.bn')::uuid, 'invite_redeemed', current_setting('t.a')::uuid);
select set_config('t.n_bn', (select max(id)::text from public.notifications where recipient_id = current_setting('t.bn')::uuid), true);
create temp table c11 as select * from public.claim_push_notifications();
select is((select count(*)::int from c11), 0, 'a banned recipient gets nothing');
select ok(pg_temp.pushed(current_setting('t.n_bn')), 'and it is marked');

-- ===== tickets: identified by subject only, never the ticket text; access re-checked =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.tk')));
select set_config('t.t1', public.open_ticket(current_setting('t.tc')::uuid, 'Problema de acceso', 'TEXTO-PRIVADO-DEL-TICKET')::text, true);
select tests.clear_authentication();
create temp table c12 as select * from public.claim_push_notifications();
select is(pg_temp.rows_for('c12', 's1'), 1, 'staff gets the ticket_new row');
select is((select min(url) from c12 where endpoint like '%/s1'), '/tickets/' || current_setting('t.t1'), 'ticket url');
select ok((select bool_and(body like '%Problema de acceso%' and body not like '%«%') from c12), 'identified by subject, no excerpt');
select ok((select bool_and(body not like '%TEXTO-PRIVADO%') from c12), 'the ticket text is never in the payload');
select is((select min(title) from c12 where endpoint like '%/s1'), 'Nuevo ticket', 'ticket_new title');

-- a notice of a ticket the recipient cannot access: not returned, marked
insert into public.notifications (recipient_id, kind, actor_id, ticket_id)
  values (current_setting('t.x')::uuid, 'ticket_reply', current_setting('t.tk')::uuid, current_setting('t.t1')::uuid);
select set_config('t.n_tk', (select max(id)::text from public.notifications where recipient_id = current_setting('t.x')::uuid and kind = 'ticket_reply'), true);
create temp table c13 as select * from public.claim_push_notifications();
select is((select count(*)::int from c13), 0, 'a notice of a ticket the recipient cannot access is not returned');
select ok(pg_temp.pushed(current_setting('t.n_tk')), 'and it is marked');

-- the author keeps access: reply wording
select tests.authenticate_as(pg_temp.uid(current_setting('t.s')));
select public.post_ticket_message(current_setting('t.t1')::uuid, 'RESPUESTA-PRIVADA');
select tests.clear_authentication();
create temp table c14 as select * from public.claim_push_notifications();
select is(pg_temp.rows_for('c14', 'tk1'), 1, 'the author gets the ticket_reply row');
select is((select min(title) from c14), 'Respuesta en un ticket', 'ticket_reply title');
select ok((select bool_and(body not like '%RESPUESTA-PRIVADA%') from c14), 'reply text never in the payload');
select tests.authenticate_as(pg_temp.uid(current_setting('t.s')));
select public.set_ticket_status(current_setting('t.t1')::uuid, 'closed');
select tests.clear_authentication();
create temp table c15 as select * from public.claim_push_notifications();
select is((select min(title) from c15), 'Ticket cerrado', 'ticket_status closed title');

-- ===== batch limit =====
insert into public.notifications (recipient_id, kind, actor_id) select current_setting('t.a')::uuid, 'invite_redeemed', current_setting('t.r')::uuid from generate_series(1, 3);
create temp table c16 as select * from public.claim_push_notifications(2);
select is((select count(distinct notification_id)::int from c16), 2, 'p_limit caps the number of notifications claimed');
create temp table c17 as select * from public.claim_push_notifications(2);
select is((select count(distinct notification_id)::int from c17), 1, 'the rest is claimed by the next call');

-- ===== delete by endpoint =====
select public.delete_push_subscription_by_endpoint('https://fcm.googleapis.com/fcm/send/x1');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/x1'), 0, 'subscription deleted by endpoint');
select lives_ok($q$select public.delete_push_subscription_by_endpoint('https://fcm.googleapis.com/fcm/send/none')$q$, 'deleting an unknown endpoint is a no-op');

-- ===== authenticated cannot claim =====
select tests.authenticate_as(pg_temp.uid(current_setting('t.a')));
select throws_ok($q$select * from public.claim_push_notifications()$q$, '42501', null, 'authenticated cannot execute the claim');
select throws_ok($q$select public.delete_push_subscription_by_endpoint('x')$q$, '42501', null, 'authenticated cannot delete by endpoint');
select tests.clear_authentication();

select * from finish();
rollback;
