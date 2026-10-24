-- P1 Task 12 (migration 20261024200007): data for the new Inicio.
--   - home_unread_channels: my_unread_channels criteria (visible text channels, non-deleted messages by someone else
--     newer than the read mark or the join date), unread_count capped at 99, last excerpt (<= 140) and author label,
--     newest first.
--   - home_highlights: openBounties, the newest open poll the caller can view, the open giveaway closing first (with
--     iEntered) and whether the caller holds Mecenas.
begin;
select plan(25);

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
create function tests.msg(p_ch uuid, p_author uuid, p_text text, p_at timestamptz, p_kind text default 'text')
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.messages (id, channel_id, author_id, body, body_text, allow_links, created_at, kind)
  values (v_id, p_ch, p_author, tests.td(p_text), p_text, false, p_at, p_kind);
  return v_id;
end;
$$;
create function tests.poll(p_ch uuid, p_author uuid, p_question text, p_created timestamptz, p_closes timestamptz)
returns uuid language plpgsql as $$
declare
  v_id uuid := tests.msg(p_ch, p_author, p_question, p_created, 'poll');
begin
  insert into public.polls (message_id, channel_id, author_id, chain_id, weight_mode, closes_at, created_at)
  values (v_id, p_ch, p_author, null, 'equal', p_closes, p_created);
  return v_id;
end;
$$;
create function tests.gw(p_title text, p_closes timestamptz, p_by uuid) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.giveaways (title, closes_at, seed_commit, target_round, created_by)
  values (p_title, p_closes, '0x' || repeat('a', 64), 1, p_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- ===== fixtures: a (bootstrap), u (the reader), x (an author); channels c1 (busy), c2 (read), c3 (only u writes),
-- c5 (one newer message), cH (hidden under a category that denies VIEW to @everyone) =====
select set_config('t.a', tests.create_member('0x' || lpad('f1070a', 40, '0'), null, true)::text, true);
select set_config('t.u', tests.create_member('0x' || lpad('f10701', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.x', tests.create_member('0x' || lpad('f10702', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.uu', (select auth_user_id::text from public.members where id = current_setting('t.u')::uuid), true);
update public.members set created_at = now() - interval '1 day' where id <> current_setting('t.a')::uuid;

select set_config('t.cat', tests.create_channel(null, 'category', 'P107cat')::text, true);
select set_config('t.c1', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'p107busy')::text, true);
select set_config('t.c2', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'p107read')::text, true);
select set_config('t.c3', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'p107own')::text, true);
select set_config('t.c5', tests.create_channel(current_setting('t.cat')::uuid, 'text', 'p107new')::text, true);
select set_config('t.catH', tests.create_channel(null, 'category', 'P107hid')::text, true);
select set_config('t.cH', tests.create_channel(current_setting('t.catH')::uuid, 'text', 'p107hid')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
  (current_setting('t.catH')::uuid, 'role', (select id from public.roles where is_everyone), 0, 1);

-- c1: 120 messages by x in the last two hours, the newest one long (over 140 characters)
select tests.msg(current_setting('t.c1')::uuid, current_setting('t.x')::uuid, 'mensaje ' || g, now() - interval '2 hours' + g * interval '30 seconds')
from generate_series(1, 119) g;
select tests.msg(current_setting('t.c1')::uuid, current_setting('t.x')::uuid, repeat('larga ', 40), now() - interval '30 minutes');
-- c2: a message by x, then u read the channel
select tests.msg(current_setting('t.c2')::uuid, current_setting('t.x')::uuid, 'ya leído', now() - interval '1 hour');
insert into public.channel_reads (member_id, channel_id, last_read_at) values
  (current_setting('t.u')::uuid, current_setting('t.c2')::uuid, now() - interval '10 minutes');
-- c3: only u writes
select tests.msg(current_setting('t.c3')::uuid, current_setting('t.u')::uuid, 'lo mío', now() - interval '5 minutes');
-- c5: one message, newer than anything in c1
select tests.msg(current_setting('t.c5')::uuid, current_setting('t.x')::uuid, 'lo último', now() - interval '1 minute');
-- cH: unread but hidden
select tests.msg(current_setting('t.cH')::uuid, current_setting('t.x')::uuid, 'oculto', now() - interval '2 minutes');

-- ===== 1. shape and privileges =====
select ok(has_function_privilege('authenticated', 'public.home_unread_channels(int)', 'execute')
      and not has_function_privilege('anon', 'public.home_unread_channels(int)', 'execute'),
  'home_unread_channels: authenticated yes, anon no');
select ok(has_function_privilege('authenticated', 'public.home_highlights()', 'execute')
      and not has_function_privilege('anon', 'public.home_highlights()', 'execute'),
  'home_highlights: authenticated yes, anon no');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
           from pg_proc p where p.oid in ('public.home_unread_channels(int)'::regprocedure, 'public.home_highlights()'::regprocedure)),
  'both are SECURITY DEFINER with an empty search_path');

-- ===== 2. home_unread_channels =====
select set_config('t.xlabel', public._member_label(current_setting('t.x')::uuid), true);
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is((select unread_count from public.home_unread_channels(20) where channel_id = current_setting('t.c1')::uuid), 99,
  '120 unread messages are counted as 99');
select is((select char_length(last_excerpt) from public.home_unread_channels(20) where channel_id = current_setting('t.c1')::uuid), 140,
  'the excerpt is cut at 140 characters');
select is((select last_excerpt from public.home_unread_channels(20) where channel_id = current_setting('t.c1')::uuid),
  left(repeat('larga ', 40), 140), 'the excerpt is the newest unread message');
select is((select last_author from public.home_unread_channels(20) where channel_id = current_setting('t.c1')::uuid),
  current_setting('t.xlabel'), 'last_author is the member label of its author');
select is((select channel_name from public.home_unread_channels(20) where channel_id = current_setting('t.c1')::uuid), 'p107busy',
  'channel_name is the channel name');
select ok(not exists (select 1 from public.home_unread_channels(20) where channel_id = current_setting('t.c2')::uuid),
  'a channel read after its last message is not listed');
select ok(not exists (select 1 from public.home_unread_channels(20) where channel_id = current_setting('t.cH')::uuid),
  'a channel the member cannot view is never listed');
select ok(not exists (select 1 from public.home_unread_channels(20) where channel_id = current_setting('t.c3')::uuid),
  'the member''s own messages do not make a channel unread');
select is((select array_agg(channel_id order by last_at desc) from public.home_unread_channels(20)),
  (select array_agg(channel_id) from public.home_unread_channels(20)), 'rows come ordered by last_at desc');
select is((select channel_id from public.home_unread_channels(20) limit 1), current_setting('t.c5')::uuid,
  'the channel with the newest message comes first');
select is((select unread_count from public.home_unread_channels(20) where channel_id = current_setting('t.c5')::uuid), 1,
  'one unread message counts 1');
select is((select count(*)::int from public.home_unread_channels(1)), 1, 'p_limit caps the rows');
select is((select array_agg(channel_id order by channel_id) from public.home_unread_channels(20)),
  (select array_agg(c order by c) from public.my_unread_channels() c), 'same channels as my_unread_channels');
select tests.clear_authentication();
select is((select count(*)::int from public.home_unread_channels(20)), 0, 'without a session there are no rows');

-- ===== 3. home_highlights =====
select tests.poll(current_setting('t.cH')::uuid, current_setting('t.x')::uuid, '¿Oculta?', now() - interval '1 minute', now() + interval '1 day');
select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(public.home_highlights() -> 'poll', 'null'::jsonb, 'poll is null when the only open poll is in a hidden channel');
select is(public.home_highlights() -> 'giveaway', 'null'::jsonb, 'giveaway is null without open giveaways');
select is(public.home_highlights() -> 'openBounties', '0'::jsonb, 'openBounties is the number 0 without bounties');
select is(public.home_highlights() -> 'donor', '{"isMecenas": false}'::jsonb, 'a member without the donor role is not Mecenas');
select tests.clear_authentication();

select set_config('t.p1', tests.poll(current_setting('t.c1')::uuid, current_setting('t.x')::uuid, '¿Abierta?',
  now() - interval '1 hour', now() + interval '1 day')::text, true);
-- newer but already closed: not open
select tests.poll(current_setting('t.c1')::uuid, current_setting('t.x')::uuid, '¿Cerrada?', now() - interval '1 minute', now() - interval '1 second');
select set_config('t.g1', tests.gw('Sorteo tardío', now() + interval '3 days', current_setting('t.a')::uuid)::text, true);
select set_config('t.g2', tests.gw('Sorteo pronto', now() + interval '1 day', current_setting('t.a')::uuid)::text, true);
insert into public.giveaway_entries (giveaway_id, member_id) values (current_setting('t.g2')::uuid, current_setting('t.u')::uuid);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.u')::uuid, id from public.roles where system_key = 'donor';

select tests.authenticate_as(current_setting('t.uu')::uuid);
select is(public.home_highlights() -> 'poll',
  jsonb_build_object('messageId', current_setting('t.p1'), 'channelId', current_setting('t.c1'), 'question', '¿Abierta?',
                     'closesAt', now() + interval '1 day'),
  'poll is the newest open poll in a visible channel, with its question');
select is(public.home_highlights() -> 'giveaway' ->> 'id', current_setting('t.g2'), 'giveaway is the open one closing first');
select is(public.home_highlights() -> 'giveaway' -> 'iEntered', 'true'::jsonb, 'iEntered is true once the member entered');
select is(public.home_highlights() -> 'donor', '{"isMecenas": true}'::jsonb, 'the donor role makes the member Mecenas');
select tests.clear_authentication();

select * from finish();
rollback;
