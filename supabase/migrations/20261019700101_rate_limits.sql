-- F5 Task 2: rate limits in Postgres (rulings F5-R1, F5-R2, F5-R16; security review S3, S5).
--
-- Mechanics (F5-R2):
--   private.rate_limit_hits   fixed-window counter keyed (subject, bucket, window_start), window_start =
--                             date_bin(window, now(), '2000-01-01Z'). The subject is the member id, or 'u:' || auth.uid()
--                             before membership. Schema private is usable by no API role (pinned in 961).
--   private.rate_limit        bumps the counter and raises rate_limited past the max; also drops the same subject+bucket's
--                             rows older than greatest(window, 1 day). A null subject is a no-op (system writes).
--                             Called inside the abusable definer RPCs below: a raise rolls the hit back with the action,
--                             so these buckets limit successful actions only.
--   public.rate_limit_hit     the pre-hit a server action runs in its own transaction before work that fails often and
--                             costs something: chain_verify (on-chain verification, 120 / 10 min) and redeem_invite
--                             (10 / 1 h). Accepted gap: a direct PostgREST call to redeem_invite skips the pre-hit
--                             (codes carry 128 random bits).
--   public.upload_quota_ok    Storage insert policies: chat-images 60 / avatars 20 objects created by the member in the
--                             last hour.
--
-- Buckets charged in the RPCs (each one copies its latest definition and only adds the perform):
--   message_min 30 / 1 min and message_hour 600 / 1 h   _post_message_core (post_message, post_message_as, create_bounty,
--                                                        create_poll)
--   reaction 60 / 1 min                                  toggle_reaction
--   ticket 20 / 1 min                                    open_ticket, post_ticket_message
--   payment_intent 30 / 10 min                           create_tip_intent, create_bounty_payment_intent,
--                                                        create_donation_intent
--   poll_vote 30 / 1 min                                 cast_poll_vote
--   raffle_entry 30 / 10 min                             enter_raffle, leave_raffle
--   invite_create 30 / 1 day                             create_invite
--   withdrawal 20 / 1 day                                request_withdrawal, cancel_withdrawal
--   profile 30 / 1 h                                     update_profile, set_handle, set_avatar
--   presence 120 / 1 min (F5-R16, review S5)             touch_presence, which also keeps at most 10 device rows per
--                                                        member; leave_presence is not charged
-- Login/nonce is GoTrue's web3 limit (config.toml / dashboard), not Postgres.

-- ===== counter =====
create table private.rate_limit_hits (
  subject text not null,
  bucket text not null,
  window_start timestamptz not null,
  hits int not null,
  primary key (subject, bucket, window_start)
);
alter table private.rate_limit_hits enable row level security;
revoke all on private.rate_limit_hits from public, anon, authenticated, service_role;

create function private.rate_limit(p_subject text, p_bucket text, p_max int, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits int;
begin
  if p_subject is null then
    return;
  end if;
  delete from private.rate_limit_hits h
  where h.subject = p_subject and h.bucket = p_bucket
    and h.window_start < now() - greatest(p_window, interval '1 day');
  insert into private.rate_limit_hits as h (subject, bucket, window_start, hits)
  values (p_subject, p_bucket, date_bin(p_window, now(), timestamptz '2000-01-01Z'), 1)
  on conflict (subject, bucket, window_start) do update set hits = h.hits + 1
  returning h.hits into v_hits;
  if v_hits > p_max then
    raise exception 'rate_limited';
  end if;
end;
$$;

-- ===== server-action pre-hit =====
create function public.rate_limit_hit(p_bucket text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text := coalesce(public.current_member_id()::text, 'u:' || auth.uid()::text);
begin
  if v_subject is null then
    raise exception 'not_authenticated';
  end if;
  if p_bucket = 'chain_verify' then
    perform private.rate_limit(v_subject, 'chain_verify', 120, interval '10 minutes');
  elsif p_bucket = 'redeem_invite' then
    perform private.rate_limit(v_subject, 'redeem_invite', 10, interval '1 hour');
  else
    raise exception 'invalid_input';
  end if;
end;
$$;

-- ===== upload quota (Storage insert policies) =====
-- The member segment is the second path segment for chat-images (<channel>/<member>/<file>) and the first for avatars
-- (<member>/<file>). The row being inserted is not visible to the check, so the 60th / 20th upload is the last allowed.
create function public.upload_quota_ok(p_bucket text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_member_id() is not null and case p_bucket
    when 'chat-images' then (
      select count(*) from storage.objects o
      where o.bucket_id = 'chat-images' and split_part(o.name, '/', 2) = public.current_member_id()::text
        and o.created_at > now() - interval '1 hour') < 60
    when 'avatars' then (
      select count(*) from storage.objects o
      where o.bucket_id = 'avatars' and split_part(o.name, '/', 1) = public.current_member_id()::text
        and o.created_at > now() - interval '1 hour') < 20
    else false
  end
$$;

-- chat_images_insert: latest definition 20261016200006_f2b_final_fixes.sql, plus the upload quota.
drop policy chat_images_insert on storage.objects;
create policy chat_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp|gif)$'
        then split_part(name, '/', 2) = public.current_member_id()::text
             and public.is_active_member()
             and public.can(split_part(name, '/', 1)::uuid, 1024)
             -- an attachment is only usable by posting it: no posting rights, no upload (no orphan quota abuse)
             and (public.can(split_part(name, '/', 1)::uuid, 2) or public.can(split_part(name, '/', 1)::uuid, 4))
             and public.upload_quota_ok('chat-images')
      else false
    end
  );

-- avatars_insert: latest definition 20261018500001_profiles.sql, plus the upload quota.
drop policy avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
        then split_part(name, '/', 1) = (select public.current_member_id())::text
             and (select public.is_active_member())
             and public.upload_quota_ok('avatars')
      else false
    end
  );

-- ===== rate-limited RPCs (create or replace keeps their grants) =====
-- _post_message_core: latest definition 20261016200006_f2b_final_fixes.sql, plus the rate limit.
create or replace function public._post_message_core(
  p_member uuid, p_channel uuid, p_body jsonb, p_body_text text, p_expanded boolean,
  p_thread_root uuid, p_quoted uuid, p_attachments jsonb, p_alpha_address text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perms bigint;
  v_channel public.channels;
  v_expanded boolean := coalesce(p_expanded, false);
  v_atts jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_att jsonb;
  v_path text;
  v_mime text;
  v_size text;
  v_path_re text;
  v_meta jsonb;
  v_found boolean;
  v_norm jsonb := '[]'::jsonb;
  v_remaining int;
  v_id uuid;
  v_kind text := 'text';
  v_paths text[] := '{}';
  v_text text;
begin
  if p_member is null or p_channel is null then
    raise exception 'forbidden';
  end if;
  v_perms := public.channel_permissions(p_member, p_channel);
  if (v_perms & 1) = 0 then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 per minute and 600 per hour per author (post_message, post_message_as, create_bounty, create_poll)
  perform private.rate_limit(p_member::text, 'message_min', 30, interval '1 minute');
  perform private.rate_limit(p_member::text, 'message_hour', 600, interval '1 hour');

  select * into v_channel from public.channels c where c.id = p_channel;
  if v_channel.kind <> 'text' then
    raise exception 'invalid_input';
  end if;

  if p_thread_root is null then
    if (v_perms & 2) = 0 then
      raise exception 'forbidden';
    end if;
  else
    if (v_perms & 4) = 0 then
      raise exception 'forbidden';
    end if;
    -- one-level threads: the root belongs to this channel and is not itself a reply (soft-deleted roots keep their thread)
    perform 1 from public.messages r
    where r.id = p_thread_root and r.channel_id = p_channel and r.thread_root_id is null
    for update;
    if not found then
      raise exception 'thread_invalid';
    end if;
  end if;

  -- p_body_text is accepted for signature compatibility only: the stored text is derived from the doc
  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception 'invalid_input';
  end if;
  -- the renderer shows nothing for a non-doc root, so it must not carry text or mentions either
  if p_body ->> 'type' is distinct from 'doc' then
    raise exception 'invalid_input';
  end if;
  if octet_length(p_body::text) > 65536 then
    raise exception 'too_long';
  end if;
  v_text := public._doc_text(p_body);
  if char_length(v_text) > 20000 or (not v_expanded and char_length(v_text) > 4000) then
    raise exception 'too_long';
  end if;

  if jsonb_typeof(v_atts) <> 'array' then
    raise exception 'invalid_input';
  end if;
  if jsonb_array_length(v_atts) > 4 then
    raise exception 'too_many_attachments';
  end if;
  if v_text = '' and jsonb_array_length(v_atts) = 0 then
    raise exception 'invalid_input';
  end if;

  if jsonb_array_length(v_atts) > 0 then
    if (v_perms & 1024) = 0 then
      raise exception 'forbidden';
    end if;
    v_path_re := '^' || p_channel::text || '/' || p_member::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$';
    for v_att in select e.value from jsonb_array_elements(v_atts) e loop
      if jsonb_typeof(v_att) <> 'object' or jsonb_typeof(v_att -> 'path') is distinct from 'string' then
        raise exception 'invalid_input';
      end if;
      v_path := v_att ->> 'path';
      if v_path !~ v_path_re then
        raise exception 'forbidden';
      end if;
      -- the object must exist in storage; its metadata (set by Storage, not the client) is the only source of
      -- mime and size: the client claims are ignored
      select true, o.metadata into v_found, v_meta
      from storage.objects o where o.bucket_id = 'chat-images' and o.name = v_path;
      if v_found is not true then
        raise exception 'invalid_input';
      end if;
      v_mime := v_meta ->> 'mimetype';
      v_size := v_meta ->> 'size';
      if v_mime is null or v_size is null then
        raise exception 'invalid_input';   -- fail closed: Storage is the only authority
      end if;
      if v_mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
         or v_size !~ '^[0-9]{1,9}$' or v_size::bigint not between 1 and 5242880
         or v_path = any (v_paths)
         or exists (select 1 from public.message_attachments a where a.storage_path = v_path) then
        raise exception 'invalid_input';
      end if;
      v_paths := v_paths || v_path;
      v_norm := v_norm || jsonb_build_array((v_att - 'mime' - 'size')
                                            || jsonb_build_object('mime', v_mime, 'size', v_size::bigint));
    end loop;
    v_atts := v_norm;
  end if;

  if p_alpha_address is not null then
    if not v_channel.alpha_enabled or (v_perms & 2048) = 0 then
      raise exception 'forbidden';
    end if;
    if p_alpha_address !~ '^0x[0-9a-fA-F]{40}$' then
      raise exception 'invalid_input';
    end if;
    v_kind := 'alpha';
  end if;

  -- serialize one author's posts in a channel so concurrent requests cannot skip the slowmode window
  perform pg_advisory_xact_lock(hashtextextended(p_member::text || p_channel::text, 0));
  v_remaining := public._slowmode_remaining(p_member, p_channel);
  if v_remaining > 0 then
    raise exception 'slowmode' using detail = v_remaining::text;
  end if;

  if p_quoted is not null then
    perform 1 from public.messages q
    where q.id = p_quoted and q.channel_id = p_channel and q.deleted_at is null;
    if not found then
      raise exception 'invalid_input';
    end if;
  end if;

  insert into public.messages (channel_id, thread_root_id, author_id, body, body_text, expanded,
                               allow_links, kind, quoted_message_id)
  values (p_channel, p_thread_root, p_member, p_body, v_text, v_expanded,
          (v_perms & 2048) = 2048, v_kind, p_quoted)
  returning id into v_id;

  if p_thread_root is not null then
    update public.messages set reply_count = reply_count + 1, last_reply_at = now() where id = p_thread_root;
  end if;

  if v_kind = 'alpha' then
    insert into public.alpha_details (message_id, contract_address) values (v_id, lower(p_alpha_address));
  end if;

  insert into public.member_channel_last_post (member_id, channel_id, last_post_at)
  values (p_member, p_channel, now())
  on conflict (member_id, channel_id) do update set last_post_at = excluded.last_post_at;

  begin
    insert into public.message_attachments (message_id, storage_path, mime, size_bytes, width, height)
    select v_id, e.value ->> 'path', e.value ->> 'mime', (e.value ->> 'size')::int,
           case when (e.value ->> 'width') ~ '^[0-9]{1,5}$' then (e.value ->> 'width')::int end,
           case when (e.value ->> 'height') ~ '^[0-9]{1,5}$' then (e.value ->> 'height')::int end
    from jsonb_array_elements(v_atts) e;
  exception when unique_violation then
    -- a concurrent request claimed the same storage path
    raise exception 'invalid_input';
  end;

  perform public._insert_mentions(v_id, p_body, v_perms);
  return v_id;
end;
$$;

-- toggle_reaction: latest definition 20261016200004_message_realtime.sql, plus the rate limit.
create or replace function public.toggle_reaction(p_message uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
  v_msg public.messages;
  v_perms bigint;
begin
  if v_actor is null or p_message is null then
    raise exception 'forbidden';
  end if;
  select * into v_msg from public.messages m where m.id = p_message for share;
  if not found then
    raise exception 'forbidden';
  end if;
  v_perms := public.channel_permissions(v_actor, v_msg.channel_id);
  if (v_perms & 1) = 0 or (v_perms & 8192) = 0 then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 60 reactions per minute
  perform private.rate_limit(v_actor::text, 'reaction', 60, interval '1 minute');

  -- plain emoji sequences only: no whitespace or control characters, 1..32 bytes
  if p_emoji is null or octet_length(p_emoji) not between 1 and 32 or p_emoji ~ '[[:cntrl:][:space:]]' then
    raise exception 'invalid_input';
  end if;

  if v_msg.deleted_at is not null then
    raise exception 'invalid_input';
  end if;

  -- serialize reactions per message so the distinct-emoji limit cannot be raced
  perform pg_advisory_xact_lock(hashtextextended('reaction:' || p_message::text, 0));

  delete from public.message_reactions r
  where r.message_id = p_message and r.member_id = v_actor and r.emoji = p_emoji;
  if found then
    return false;
  end if;

  if not exists (select 1 from public.message_reactions r where r.message_id = p_message and r.emoji = p_emoji)
     and (select count(distinct r.emoji) from public.message_reactions r where r.message_id = p_message) >= 20 then
    raise exception 'too_many_reactions';
  end if;

  insert into public.message_reactions (message_id, member_id, emoji) values (p_message, v_actor, p_emoji);
  return true;
end;
$$;

-- open_ticket: latest definition 20261017300006_push_dispatch.sql, plus the rate limit.
create or replace function public.open_ticket(p_channel uuid, p_subject text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_perms bigint;
  v_subject text := btrim(p_subject, E' \t\n\x0b\f\r');
  v_body text := btrim(p_body, E' \t\n\x0b\f\r');
  v_id uuid;
begin
  if v_me is null or not public.is_active_member() or p_channel is null then
    raise exception 'forbidden';
  end if;
  if not exists (
    select 1 from public.channels c where c.id = p_channel and c.kind = 'text' and c.tickets_enabled
  ) then
    raise exception 'forbidden';
  end if;
  v_perms := public.channel_permissions(v_me, p_channel);
  if (v_perms & 1) = 0 or (v_perms & 2) = 0 then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 20 per minute, shared with post_ticket_message
  perform private.rate_limit(v_me::text, 'ticket', 20, interval '1 minute');
  if v_subject is null or char_length(v_subject) not between 3 and 120
     or v_body is null or char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ticket_open:' || v_me::text, 0));
  if (select count(*) from public.tickets t where t.author_id = v_me and t.status = 'open') >= 3 then
    raise exception 'too_many_open_tickets';
  end if;

  insert into public.tickets (channel_id, author_id, subject) values (p_channel, v_me, v_subject)
  returning id into v_id;
  insert into public.ticket_messages (ticket_id, author_id, body_text, allow_links)
  values (v_id, v_me, v_body, (v_perms & 2048) = 2048);

  insert into public.notifications (recipient_id, kind, actor_id, ticket_id)
  select s.id, 'ticket_new', v_me, v_id
  from public.members s
  where s.status = 'active'
    and s.id <> v_me
    and (public.channel_permissions(s.id, p_channel) & 16384) = 16384;

  return v_id;
end;
$$;

-- post_ticket_message: latest definition 20261017300006_push_dispatch.sql, plus the rate limit.
create or replace function public.post_ticket_message(p_ticket uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  t public.tickets;
  v_body text := btrim(p_body, E' \t\n\x0b\f\r');
  v_id uuid;
  v_links boolean;
  v_now timestamptz := clock_timestamp();
  v_n int;
begin
  if v_me is null or not public.is_active_member() or p_ticket is null then
    raise exception 'forbidden';
  end if;
  select * into t from public.tickets x where x.id = p_ticket for update;
  if not found or not public._member_can_access_ticket(v_me, t.id) then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 20 per minute, shared with open_ticket
  perform private.rate_limit(v_me::text, 'ticket', 20, interval '1 minute');
  if t.status = 'closed' then
    raise exception 'ticket_closed';
  end if;
  if v_body is null or char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid_input';
  end if;

  v_links := (public.channel_permissions(v_me, t.channel_id) & 2048) = 2048;
  insert into public.ticket_messages (ticket_id, author_id, body_text, allow_links, created_at)
  values (t.id, v_me, v_body, v_links, v_now)
  returning id into v_id;
  update public.tickets set last_message_at = v_now where id = t.id;

  if v_me = t.author_id then
    -- staff who already replied and still have access; if there are none, every staff member of the channel
    insert into public.notifications (recipient_id, kind, actor_id, ticket_id)
    select s.id, 'ticket_reply', v_me, t.id
    from public.members s
    where s.status = 'active'
      and s.id <> v_me
      and s.id in (select tm.author_id from public.ticket_messages tm where tm.ticket_id = t.id and tm.author_id <> t.author_id)
      and (public.channel_permissions(s.id, t.channel_id) & 16384) = 16384;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      insert into public.notifications (recipient_id, kind, actor_id, ticket_id)
      select s.id, 'ticket_reply', v_me, t.id
      from public.members s
      where s.status = 'active'
        and s.id <> v_me
        and (public.channel_permissions(s.id, t.channel_id) & 16384) = 16384;
    end if;
  else
    insert into public.notifications (recipient_id, kind, actor_id, ticket_id)
    select a.id, 'ticket_reply', v_me, t.id
    from public.members a
    where a.id = t.author_id and a.status = 'active';
  end if;

  return v_id;
end;
$$;

-- create_tip_intent: latest definition 20261018600002_tips_fixes.sql, plus the rate limit.
create or replace function public.create_tip_intent(
  p_target_type text, p_target_id uuid, p_token text, p_amount numeric, p_fee_bps int, p_anonymous boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_min_fee int;
  v_fee numeric;
  v_recipient uuid;
  v_addr text;
  v_platform text;
  v_msg public.messages;
  v_id uuid;
  v_exp timestamptz;
  v_min numeric;
  v_max numeric;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 intents per 10 minutes (tips, bounty payments, donations)
  perform private.rate_limit(v_me::text, 'payment_intent', 30, interval '10 minutes');
  if p_target_type is null or p_target_type not in ('message', 'profile') or p_target_id is null
     or p_token is null or p_token not in ('ETH', 'USDC')
     or p_amount is null or p_amount <> trunc(p_amount)
     or p_fee_bps is null or p_anonymous is null then
    raise exception 'invalid_input';
  end if;

  if p_token = 'USDC' then
    v_min := 10000;                       -- 0.01
    v_max := 100000::numeric * 1000000;   -- 100000
  else
    v_min := 10000000000000;              -- 0.00001
    v_max := 100::numeric * 1000000000000000000; -- 100
  end if;
  if p_amount < v_min or p_amount > v_max then
    raise exception 'amount_out_of_range';
  end if;

  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select (c.value #>> '{}')::int into v_min_fee from public.app_config c where c.key = 'min_fee_bps';
  if v_chain is null or v_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if p_fee_bps < 0 or p_fee_bps > 5000 then
    raise exception 'fee_out_of_range';
  end if;
  if p_fee_bps < coalesce(v_min_fee, 0) then
    raise exception 'fee_below_minimum';
  end if;

  if p_target_type = 'message' then
    select * into v_msg from public.messages x where x.id = p_target_id;
    if not found or v_msg.deleted_at is not null or v_msg.kind = 'system' or v_msg.author_id is null
       or not public.can(v_msg.channel_id, 1) then
      raise exception 'not_found';
    end if;
    v_recipient := v_msg.author_id;
  else
    v_recipient := p_target_id;
  end if;
  select m.wallet_address into v_addr from public.members m where m.id = v_recipient and m.status = 'active';
  if v_addr is null then
    raise exception 'not_found';
  end if;
  if v_recipient = v_me then
    raise exception 'self_payment';
  end if;

  v_fee := div(p_amount * p_fee_bps + 9999, 10000);
  if v_fee > 0 then
    select cc.platform_wallet into v_platform from public.chain_config cc where cc.chain_id = v_chain;
    if v_platform is null then
      raise exception 'platform_not_configured';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tip_intent:' || v_me::text, 0));
  if (select count(*) from public.payment_intents i
      where i.member_id = v_me and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, platform_address,
                                      target_type, target_id, anonymous)
  values (v_me, 'tip', v_chain, p_token, p_amount, p_fee_bps, coalesce(v_min_fee, 0), v_fee,
          v_recipient, v_addr, case when v_fee > 0 then v_platform end,
          p_target_type, p_target_id, p_anonymous)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', v_chain, 'token', p_token,
    'amount', p_amount::text, 'feeAmount', v_fee::text,
    'recipientAddress', v_addr, 'platformAddress', case when v_fee > 0 then v_platform end,
    'expiresAt', v_exp);
end;
$$;

-- create_bounty_payment_intent: latest definition 20261018700003_bounty_fixes.sql, plus the rate limit.
create or replace function public.create_bounty_payment_intent(p_bounty uuid, p_amount numeric, p_fee_bps int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  b public.bounties;
  v_chain int;
  v_min_fee int;
  v_fee numeric;
  v_addr text;
  v_platform text;
  v_id uuid;
  v_exp timestamptz;
  v_max numeric;
  v_open public.payment_intents;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  if p_bounty is null or p_amount is null or p_amount <> trunc(p_amount) or p_fee_bps is null then
    raise exception 'invalid_input';
  end if;

  select * into b from public.bounties x where x.message_id = p_bounty;
  if not found then
    raise exception 'not_found';
  end if;
  if b.author_id <> v_me then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 intents per 10 minutes (tips, bounty payments, donations)
  perform private.rate_limit(v_me::text, 'payment_intent', 30, interval '10 minutes');

  -- same lock key and cap as tip intents; serializes this author's intents for the checks below
  perform pg_advisory_xact_lock(hashtextextended('tip_intent:' || v_me::text, 0));
  select * into b from public.bounties x where x.message_id = p_bounty;

  if b.cancelled_at is not null then
    raise exception 'bounty_closed';
  end if;
  if b.paid_at is not null then
    raise exception 'already_paid';
  end if;
  if b.solution_marked_at is null then
    raise exception 'no_solution';
  end if;

  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select (c.value #>> '{}')::int into v_min_fee from public.app_config c where c.key = 'min_fee_bps';
  if v_chain is null or v_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if v_chain <> b.chain_id then
    raise exception 'bounty_chain_inactive';
  end if;

  -- (b) a payment of this bounty may already be on its way
  if exists (
    select 1 from public.payment_intents i
    where i.purpose = 'bounty' and i.target_id = b.message_id and i.status = 'pending'
      and (i.main_tx_hash is not null or i.fee_tx_hash is not null)
      and (i.expires_at > now()
           or (i.hashes_attached_at is not null and i.hashes_attached_at <= i.expires_at
               and now() <= i.created_at + interval '7 days'))
  ) then
    raise exception 'payment_in_progress';
  end if;

  -- (a) idempotent: hand back the live, hashless intent as it is
  select * into v_open from public.payment_intents i
  where i.purpose = 'bounty' and i.target_id = b.message_id and i.member_id = v_me and i.status = 'pending'
    and i.expires_at > now() and i.main_tx_hash is null and i.fee_tx_hash is null
  order by i.created_at desc, i.id
  limit 1;
  if found then
    return jsonb_build_object(
      'id', v_open.id, 'chainId', v_open.chain_id, 'token', v_open.token,
      'amount', v_open.amount::text, 'feeAmount', v_open.fee_amount::text,
      'recipientAddress', v_open.recipient_address, 'platformAddress', v_open.platform_address,
      'expiresAt', v_open.expires_at);
  end if;

  -- (c) a new intent
  if p_amount < b.amount then
    raise exception 'amount_below_bounty';
  end if;
  v_max := case b.token when 'USDC' then 100000::numeric * 1000000 else 100::numeric * 1000000000000000000 end;
  if p_amount > v_max then
    raise exception 'amount_out_of_range';
  end if;
  if p_fee_bps < 0 or p_fee_bps > 5000 then
    raise exception 'fee_out_of_range';
  end if;
  if p_fee_bps < coalesce(v_min_fee, 0) then
    raise exception 'fee_below_minimum';
  end if;

  select m.wallet_address into v_addr from public.members m where m.id = b.solver_id and m.status = 'active';
  if v_addr is null then
    raise exception 'not_found';
  end if;

  v_fee := div(p_amount * p_fee_bps + 9999, 10000);
  if v_fee > 0 then
    select cc.platform_wallet into v_platform from public.chain_config cc where cc.chain_id = v_chain;
    if v_platform is null then
      raise exception 'platform_not_configured';
    end if;
  end if;

  if (select count(*) from public.payment_intents i
      where i.member_id = v_me and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, platform_address,
                                      target_type, target_id, anonymous)
  values (v_me, 'bounty', v_chain, b.token, p_amount, p_fee_bps, coalesce(v_min_fee, 0), v_fee,
          b.solver_id, v_addr, case when v_fee > 0 then v_platform end,
          'bounty', b.message_id, false)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', v_chain, 'token', b.token,
    'amount', p_amount::text, 'feeAmount', v_fee::text,
    'recipientAddress', v_addr, 'platformAddress', case when v_fee > 0 then v_platform end,
    'expiresAt', v_exp);
end;
$$;

-- create_donation_intent: latest definition 20261019300001_f4c_carry.sql, plus the rate limit.
create or replace function public.create_donation_intent(p_amount numeric, p_fee_bps int, p_acknowledged boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_min_fee int;
  v_fee numeric;
  v_safe text;
  v_platform text;
  v_id uuid;
  v_exp timestamptz;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 intents per 10 minutes (tips, bounty payments, donations)
  perform private.rate_limit(v_me::text, 'payment_intent', 30, interval '10 minutes');
  if p_acknowledged is distinct from true then
    raise exception 'acknowledgement_required';
  end if;
  if p_amount is null or p_amount <> trunc(p_amount) or p_fee_bps is null then
    raise exception 'invalid_input';
  end if;
  -- 1 USDC .. 1000000 USDC
  if p_amount < 1000000 or p_amount > 1000000::numeric * 1000000 then
    raise exception 'amount_out_of_range';
  end if;

  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select (c.value #>> '{}')::int into v_min_fee from public.app_config c where c.key = 'min_fee_bps';
  if v_chain is null or v_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if p_fee_bps < 0 or p_fee_bps > 5000 then
    raise exception 'fee_out_of_range';
  end if;
  if p_fee_bps < coalesce(v_min_fee, 0) then
    raise exception 'fee_below_minimum';
  end if;

  -- for share (F4a carry b): a concurrent Safe change waits for this intent, then sees it and is blocked
  select cc.safe_address, cc.platform_wallet into v_safe, v_platform
  from public.chain_config cc where cc.chain_id = v_chain for share;
  if v_safe is null then
    raise exception 'safe_not_configured';
  end if;

  v_fee := div(p_amount * p_fee_bps + 9999, 10000);
  if v_fee > 0 and v_platform is null then
    raise exception 'platform_not_configured';
  end if;

  -- same lock key and cap as tip intents
  perform pg_advisory_xact_lock(hashtextextended('tip_intent:' || v_me::text, 0));
  if (select count(*) from public.payment_intents i
      where i.member_id = v_me and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_intents';
  end if;

  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, platform_address,
                                      target_type, target_id, anonymous)
  values (v_me, 'donation', v_chain, 'USDC', p_amount, p_fee_bps, coalesce(v_min_fee, 0), v_fee,
          null, v_safe, case when v_fee > 0 then v_platform end,
          'dao', null, false)
  returning id, expires_at into v_id, v_exp;

  return jsonb_build_object(
    'id', v_id, 'chainId', v_chain, 'token', 'USDC',
    'amount', p_amount::text, 'feeAmount', v_fee::text,
    'recipientAddress', v_safe, 'platformAddress', case when v_fee > 0 then v_platform end,
    'expiresAt', v_exp);
end;
$$;

-- cast_poll_vote: latest definition 20261019500003_poll_votes.sql, plus the rate limit.
create or replace function public.cast_poll_vote(p_poll uuid, p_option uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  p public.polls;
  v_old uuid;
  v_rows int;
  v_status text;
  v_count int;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- share lock: close_due_polls takes the row for update, so no ballot lands or changes once it is finalizing
  select * into p from public.polls x where x.message_id = p_poll for share;
  if not found then
    raise exception 'not_found';
  end if;
  -- eligibility is judged now: VIEW on the channel (overwrites, penalties and view gates included)
  if (public.channel_permissions(v_me, p.channel_id) & 1) = 0 then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 votes per minute
  perform private.rate_limit(v_me::text, 'poll_vote', 30, interval '1 minute');
  -- the wall clock, not the transaction start (review M1): no vote lands after closes_at, however long the call took
  if clock_timestamp() >= p.closes_at or p.finalized_at is not null then
    raise exception 'poll_closed';
  end if;
  if p_option is null
     or not exists (select 1 from public.poll_options o where o.id = p_option and o.poll_id = p_poll) then
    raise exception 'invalid_input';
  end if;

  insert into private.poll_votes (poll_id, member_id, option_id)
  values (p_poll, v_me, p_option)
  on conflict (poll_id, member_id) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 1 then
    v_status := 'cast';
  else
    select v.option_id into v_old
    from private.poll_votes v where v.poll_id = p_poll and v.member_id = v_me
    for update;
    if v_old is not distinct from p_option then
      v_status := 'same';
    else
      update private.poll_votes set option_id = p_option, voted_at = now()
      where poll_id = p_poll and member_id = v_me;
      v_status := 'changed';
    end if;
  end if;

  select count(*)::int into v_count from private.poll_votes v where v.poll_id = p_poll;

  -- only a new voter moves the visible count; a change must not be observable
  if v_status = 'cast' then
    perform realtime.send(
      jsonb_build_object('id', p_poll, 'channel_id', p.channel_id, 'thread_root_id', null),
      'poll_changed',
      'channel:' || p.channel_id::text,
      true
    );
  end if;

  return jsonb_build_object('status', v_status, 'voterCount', v_count);
end;
$$;

-- enter_raffle: latest definition 20261019400003_raffle_draw.sql, plus the rate limit.
create or replace function public.enter_raffle(p_raffle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  r public.raffles;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 per 10 minutes, shared with leave_raffle
  perform private.rate_limit(v_me::text, 'raffle_entry', 30, interval '10 minutes');
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select * into r from public.raffles x where x.id = p_raffle and x.chain_id = v_chain for share;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status <> 'open' or now() >= r.closes_at then
    raise exception 'raffle_closed';
  end if;

  -- clock_timestamp: entries made in one transaction still get their own order (position = (entered_at, member_id))
  insert into public.raffle_entries (raffle_id, member_id, entered_at)
  values (r.id, v_me, clock_timestamp())
  on conflict (raffle_id, member_id) do nothing;
end;
$$;

-- leave_raffle: latest definition 20261019400003_raffle_draw.sql, plus the rate limit.
create or replace function public.leave_raffle(p_raffle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  r public.raffles;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 per 10 minutes, shared with enter_raffle
  perform private.rate_limit(v_me::text, 'raffle_entry', 30, interval '10 minutes');
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';
  select * into r from public.raffles x where x.id = p_raffle and x.chain_id = v_chain for share;
  if not found then
    raise exception 'not_found';
  end if;
  if r.status <> 'open' or now() >= r.closes_at then
    raise exception 'raffle_closed';
  end if;

  delete from public.raffle_entries e where e.raffle_id = r.id and e.member_id = v_me;
end;
$$;

-- create_invite: latest definition 20261016000004_invites.sql, plus the rate limit.
create or replace function public.create_invite(p_max_uses int, p_expires_in_hours int)
returns public.invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_invite public.invites;
begin
  if not public.is_active_member() or not public.has_global_perm(16) then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 invites per day
  perform private.rate_limit(public.current_member_id()::text, 'invite_create', 30, interval '1 day');

  if p_max_uses is null or p_max_uses not between 1 and 100
     or p_expires_in_hours is null or p_expires_in_hours not between 1 and 720 then
    raise exception 'invalid_input';
  end if;

  v_member := public.current_member_id();

  insert into public.invites (code, created_by, max_uses, expires_at)
  values (
    translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_'),
    v_member,
    p_max_uses,
    now() + make_interval(hours => p_expires_in_hours)
  )
  returning * into v_invite;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_member, 'invite_created', 'invite', v_invite.id,
          jsonb_build_object('max_uses', p_max_uses, 'expires_in_hours', p_expires_in_hours));

  return v_invite;
end;
$$;

-- request_withdrawal: latest definition 20261019600001_f4_polish.sql, plus the rate limit.
create or replace function public.request_withdrawal(p_shares numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_chain int;
  v_enabled boolean;
  s public.dao_state;
  p public.dao_positions;
  v_supply numeric;
  v_id uuid;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 20 per day, shared with cancel_withdrawal
  perform private.rate_limit(v_me::text, 'withdrawal', 20, interval '1 day');
  select (c.value #>> '{}')::int into v_chain from public.app_config c where c.key = 'active_chain_id';

  -- held until commit: switching withdrawals off waits for a request in flight
  select cc.withdrawals_enabled into v_enabled from public.chain_config cc where cc.chain_id = v_chain for share;
  if not coalesce(v_enabled, false) then
    raise exception 'withdrawals_disabled';
  end if;
  if p_shares is null or p_shares <= 0 or p_shares <> trunc(p_shares) then
    raise exception 'invalid_input';
  end if;

  -- dao_state before the insert (lock order), then the position
  select * into s from public.dao_state x where x.chain_id = v_chain for update;
  if not found then
    raise exception 'chain_invalid';
  end if;
  select * into p from public.dao_positions x where x.chain_id = v_chain and x.member_id = v_me for update;
  if not found or p_shares > p.shares then
    raise exception 'insufficient_shares';
  end if;

  v_supply := s.total_shares - s.approved_locked_shares;
  if p_shares <> p.shares and (v_supply <= 0 or div(p_shares * s.value_usdc, v_supply) < 1000000) then
    raise exception 'amount_too_small';
  end if;

  if exists (select 1 from public.withdrawal_requests w
             where w.chain_id = v_chain and w.member_id = v_me and w.status in ('pending', 'approved')) then
    raise exception 'withdrawal_exists';
  end if;
  begin
    insert into public.withdrawal_requests (chain_id, member_id, shares)
    values (v_chain, v_me, p_shares)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'withdrawal_exists';
  end;

  update public.dao_positions
  set locked_shares = p_shares, updated_at = now()
  where chain_id = v_chain and member_id = v_me;

  -- treasurers only learn that a request exists (no name, no amount in the notice); a requesting treasurer already knows
  insert into public.notifications (recipient_id, kind, data)
  select m.id, 'treasury_notice', jsonb_build_object('event', 'withdrawal_requested', 'requestId', v_id)
  from public.members m
  where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0 and m.id <> v_me;

  return v_id;
end;
$$;

-- cancel_withdrawal: latest definition 20261019300002_withdrawals.sql, plus the rate limit.
create or replace function public.cancel_withdrawal(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  w public.withdrawal_requests;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 20 per day, shared with request_withdrawal
  perform private.rate_limit(v_me::text, 'withdrawal', 20, interval '1 day');
  select * into w from public.withdrawal_requests x where x.id = p_request for update;
  if not found or w.member_id is distinct from v_me then
    raise exception 'not_found';
  end if;
  if w.status <> 'pending' then
    raise exception 'invalid_state';
  end if;

  update public.withdrawal_requests
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = w.id;

  update public.dao_positions
  set locked_shares = 0, updated_at = now()
  where chain_id = w.chain_id and member_id = v_me;
end;
$$;

-- update_profile: latest definition 20261018500001_profiles.sql, plus the rate limit.
create or replace function public.update_profile(p_display_name text, p_bio text, p_links jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_name text;
  v_bio text;
  v_links jsonb := coalesce(p_links, '[]'::jsonb);
  v_link jsonb;
  v_url text;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 per hour, shared with set_handle and set_avatar
  perform private.rate_limit(v_me::text, 'profile', 30, interval '1 hour');

  v_name := nullif(regexp_replace(coalesce(p_display_name, ''), '^[ \t\n\r]+|[ \t\n\r]+$', '', 'g'), '');
  if v_name is not null and (char_length(v_name) not between 2 and 32 or v_name ~ '[[:cntrl:]]') then
    raise exception 'invalid_input';
  end if;

  v_bio := nullif(regexp_replace(coalesce(p_bio, ''), '^[ \t\n\r]+|[ \t\n\r]+$', '', 'g'), '');
  if v_bio is not null and char_length(v_bio) > 280 then
    raise exception 'bio_too_long';
  end if;

  if jsonb_typeof(v_links) <> 'array' or jsonb_array_length(v_links) > 3 then
    raise exception 'links_invalid';
  end if;
  for v_link in select e from jsonb_array_elements(v_links) e loop
    if jsonb_typeof(v_link) <> 'string' then
      raise exception 'links_invalid';
    end if;
    v_url := v_link #>> '{}';
    if char_length(v_url) > 200
       or v_url ~ '[[:cntrl:][:space:]]'
       or v_url !~* '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}(:[0-9]{1,5})?([/?#].*)?$' then
      raise exception 'links_invalid';
    end if;
  end loop;

  update public.members set display_name = v_name, bio = v_bio, links = v_links where id = v_me;
end;
$$;

-- set_handle: latest definition 20261018500001_profiles.sql, plus the rate limit.
create or replace function public.set_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_raw text;
  v_handle text;
  v_cur text;
  v_changed timestamptz;
  v_reserved constant text[] := array['admin', 'administrador', 'superadmin', 'elclub', 'el_club', 'sistema', 'system',
    'soporte', 'support', 'moderador', 'mod', 'staff', 'everyone', 'here', 'todos', 'anonimo', 'null', 'undefined'];
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 per hour, shared with update_profile and set_avatar
  perform private.rate_limit(v_me::text, 'profile', 30, interval '1 hour');
  v_raw := regexp_replace(coalesce(p_handle, ''), '^[ \t\n\r]+|[ \t\n\r]+$', '', 'g');
  if v_raw !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'handle_invalid';
  end if;
  v_handle := translate(v_raw, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  if v_handle = any (v_reserved) then
    raise exception 'handle_reserved';
  end if;

  select m.handle::text, m.handle_changed_at into v_cur, v_changed
  from public.members m where m.id = v_me for update;

  if v_cur = v_handle then
    return v_cur;
  end if;
  if v_cur is not null and v_changed is not null and v_changed > now() - interval '30 days' then
    raise exception 'handle_cooldown';
  end if;

  begin
    update public.members set handle = v_handle, handle_changed_at = now() where id = v_me;
  exception when unique_violation then
    raise exception 'handle_taken';
  end;
  return v_handle;
end;
$$;

-- set_avatar: latest definition 20261018500001_profiles.sql, plus the rate limit.
create or replace function public.set_avatar(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_meta jsonb;
  v_found boolean;
  v_mime text;
  v_size text;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- F5-R1 rate limit: 30 per hour, shared with update_profile and set_handle
  perform private.rate_limit(v_me::text, 'profile', 30, interval '1 hour');
  if p_path is null then
    update public.members set avatar_path = null where id = v_me;
    return;
  end if;
  if p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
     or split_part(p_path, '/', 1) <> v_me::text then
    raise exception 'avatar_invalid';
  end if;
  select true, o.metadata into v_found, v_meta
  from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path;
  if v_found is not true then
    raise exception 'avatar_invalid';
  end if;
  v_mime := v_meta ->> 'mimetype';
  v_size := v_meta ->> 'size';
  if v_mime is null or v_mime not in ('image/png', 'image/jpeg', 'image/webp')
     or v_size is null or v_size !~ '^[0-9]{1,9}$' or v_size::bigint not between 1 and 2097152 then
    raise exception 'avatar_invalid';
  end if;
  update public.members set avatar_path = p_path where id = v_me;
end;
$$;

-- touch_presence: latest definition 20261019000008_presence_per_device.sql, plus the rate limit.
create or replace function public.touch_presence(p_device uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_was boolean;
begin
  if v_me is null or not public.is_active_member() or p_device is null then
    return;
  end if;
  -- F5-R16 rate limit: 120 beats per minute (leave_presence is not charged)
  perform private.rate_limit(v_me::text, 'presence', 120, interval '1 minute');
  v_was := public._member_online(v_me);
  insert into public.member_presence as p (member_id, device_id, last_seen_at) values (v_me, p_device, now())
  on conflict (member_id, device_id) do update set last_seen_at = now()
  where p.last_seen_at < now() - interval '15 seconds';
  -- a member never keeps more than a handful of device rows: drop the long-dead ones
  delete from public.member_presence p where p.member_id = v_me and p.last_seen_at < now() - interval '1 day';
  -- F5-R16: at most 10 device rows per member; a new device evicts the oldest (this device is always kept)
  delete from public.member_presence p
  where p.member_id = v_me and p.device_id <> p_device
    and p.device_id not in (select q.device_id from public.member_presence q
                            where q.member_id = v_me and q.device_id <> p_device
                            order by q.last_seen_at desc, q.device_id desc
                            limit 9);
  if not v_was then
    perform realtime.send(jsonb_build_object('member_id', v_me, 'online', true), 'presence_changed', 'presence', true);
  end if;
end;
$$;

-- ===== grants =====
revoke execute on function private.rate_limit(text, text, int, interval) from public, anon, authenticated, service_role;
revoke execute on function public.rate_limit_hit(text) from public, anon, service_role;
grant execute on function public.rate_limit_hit(text) to authenticated;
revoke execute on function public.upload_quota_ok(text) from public, anon, service_role;
grant execute on function public.upload_quota_ok(text) to authenticated;
