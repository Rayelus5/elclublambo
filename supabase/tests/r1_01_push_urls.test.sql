-- R1 Task 3 (migration 20261025400001): every push url of the club lives under /foro; the legacy /dao targets
-- go to /foro/donar and the legacy raffles to the giveaway list. Title, body and tag are asserted elsewhere.
begin;
select plan(18);

create function pg_temp.mdoc(p_text text, p_target text, p_label text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', p_text || ' '),
      jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('kind', 'member', 'id', p_target, 'label', p_label))))))
$$;
create function pg_temp.url(p_id text) returns text language sql as
  $$ select url from public._push_build(p_id::bigint) $$;
create function pg_temp.note(p_recipient text, p_kind text, p_channel text, p_message text, p_ticket text, p_data jsonb)
returns text language sql as $$
  insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id, ticket_id, data)
  values (current_setting('t.' || p_recipient)::uuid, p_kind, current_setting('t.a')::uuid,
          nullif(p_channel, '')::uuid, nullif(p_message, '')::uuid, nullif(p_ticket, '')::uuid, p_data)
  returning id::text
$$;

select set_config('t.admin', tests.create_member('0x' || lpad('a1301', 40, '0'), null, true)::text, true);
select set_config('t.a', tests.create_member('0x' || lpad('a1302', 40, '0'), current_setting('t.admin')::uuid)::text, true);
select set_config('t.r', tests.create_member('0x' || lpad('a1303', 40, '0'), current_setting('t.admin')::uuid)::text, true);
insert into public.roles (name, color, position, permissions) values ('R1 staff', '#CCCCCC', 71, 8 | 32 | 256);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.admin')::uuid, id from public.roles where name = 'R1 staff';
select set_config('t.cat', tests.create_channel(null, 'category', 'R1cat')::text, true);
select set_config('t.c', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'r1push')::text, true);
select set_config('t.root', gen_random_uuid()::text, true);

select tests.authenticate_as((select auth_user_id from public.members where id = current_setting('t.a')::uuid));
select set_config('t.m1', public.post_message(current_setting('t.c')::uuid,
  pg_temp.mdoc('hola', current_setting('t.r'), 'R'), 'hola @R', false, null, null, '[]'::jsonb)::text, true);
select tests.clear_authentication();
select set_config('t.n_mention', (select n.id::text from public.notifications n where n.message_id = current_setting('t.m1')::uuid), true);

select is(pg_temp.url(current_setting('t.n_mention')),
  '/foro/c/' || current_setting('t.c') || '?m=' || current_setting('t.m1') || '&h=n' || current_setting('t.n_mention'),
  'mention: /foro/c/<channel>?m=<message>&h=n<id>');
select set_config('t.n_reply', pg_temp.note('admin', 'reply', current_setting('t.c'), current_setting('t.m1'), '',
  jsonb_build_object('thread_root_id', current_setting('t.root'))), true);
select is(pg_temp.url(current_setting('t.n_reply')),
  '/foro/c/' || current_setting('t.c') || '?m=' || current_setting('t.m1') || '&thread=' || current_setting('t.root')
    || '&h=n' || current_setting('t.n_reply'),
  'reply in a thread: ?m=&thread=&h= kept under /foro');
select is(pg_temp.url(pg_temp.note('r', 'channel_message', current_setting('t.c'), '', '', '{}')),
  '/foro/c/' || current_setting('t.c'), 'channel_message without message: /foro/c/<channel>');
select is(pg_temp.url(pg_temp.note('r', 'mention', current_setting('t.c'), '', '', jsonb_build_object('thread_root_id', current_setting('t.root')))),
  '/foro/c/' || current_setting('t.c') || '?thread=' || current_setting('t.root'), 'thread only: /foro/c/<channel>?thread=');
select is(pg_temp.url(pg_temp.note('r', 'tip_received', current_setting('t.c'), '', '', jsonb_build_object('threadRootId', current_setting('t.root')))),
  '/foro/c/' || current_setting('t.c') || '?thread=' || current_setting('t.root'), 'tip with a thread: /foro/c/...?thread=');
select is(pg_temp.url(pg_temp.note('r', 'bounty_solution', current_setting('t.c'), '', '', '{}')),
  '/foro/c/' || current_setting('t.c'), 'bounty solution: /foro/c/<channel>');
select is(pg_temp.url(pg_temp.note('r', 'bounty_paid', current_setting('t.c'), '', '', '{}')),
  '/foro/c/' || current_setting('t.c'), 'bounty paid: /foro/c/<channel>');
select is(pg_temp.url(pg_temp.note('r', 'tip_received', '', '', '', '{}')), '/foro/notifications', 'tip without channel: /foro/notifications');
select is(pg_temp.url(pg_temp.note('r', 'invite_redeemed', '', '', '', '{}')),
  '/foro/u/' || (select wallet_address from public.members where id = current_setting('t.a')::uuid), 'member notices: /foro/u/<wallet>');
select is(pg_temp.url(pg_temp.note('admin', 'report_new', current_setting('t.c'), '', '', '{}')), '/foro/moderation/reports', 'report');
select is(pg_temp.url(pg_temp.note('admin', 'member_review', '', '', '', '{}')), '/foro/admin/members', 'member review');
select is(pg_temp.url(pg_temp.note('admin', 'treasury_notice', '', '', '', jsonb_build_object('event', 'raffle_drawn'))), '/foro/donar', 'legacy raffle notice -> /foro/donar');
select is(pg_temp.url(pg_temp.note('admin', 'treasury_notice', '', '', '', jsonb_build_object('event', 'withdrawal_requested'))), '/foro/donar', 'treasury notice -> /foro/donar');
select is(pg_temp.url(pg_temp.note('admin', 'treasury_outflow', '', '', '', jsonb_build_object('asset', 'USDC', 'amount', '1000000'))), '/foro/donar', 'treasury outflow -> /foro/donar');
select is(pg_temp.url(pg_temp.note('admin', 'withdrawal_paid', '', '', '', jsonb_build_object('amount', '1000000'))), '/foro/donar', 'withdrawal -> /foro/donar');
select is(pg_temp.url(pg_temp.note('r', 'raffle_won', '', '', '',
  jsonb_build_object('raffleId', gen_random_uuid(), 'title', 'x', 'token', 'USDC', 'amount', '1'))), '/foro/sorteos', 'legacy raffle won -> the giveaway list');
select is(pg_temp.url(pg_temp.note('r', 'giveaway_won', '', '', '',
  jsonb_build_object('giveawayId', current_setting('t.root'), 'title', 'x', 'prizeLabel', 'y'))),
  '/foro/sorteos/' || current_setting('t.root'), 'giveaway won -> /foro/sorteos/<id>');
select ok((select bool_and(b.url like '/foro/%') from public.notifications n, public._push_build(n.id) b
           where n.id::text in (current_setting('t.n_mention'), current_setting('t.n_reply'))), 'no club url escapes /foro');

select * from finish();
rollback;
