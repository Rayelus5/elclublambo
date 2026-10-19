-- F4e Task 2: polls. A poll is a messages row (kind 'poll', body = the normalized question as one paragraph) plus a
-- polls row keyed by the message id (mode, close, chain) and its poll_options. Creation goes through
-- _post_message_core, so VIEW, the channel kind, slowmode, the message_created broadcast and the channel notices come
-- for free, as with create_bounty.
--
--   private.poll_votes              one ballot per (poll, member). Schema private (20261019400002) is usable by no API
--                                   role (anon, authenticated, service_role): only definer functions owned by postgres
--                                   touch it. No RPC returns a member-to-option pair except the caller's own open vote.
--   private.poll_weight_snapshots   linear / quadratic weights frozen at creation (spec 13): unlocked shares
--                                   greatest(shares - locked_shares, 0) on the active chain, active members only,
--                                   positive weights only; quadratic = _isqrt. The club fund (dao_state.club_shares)
--                                   has no member row, so it never weighs. Equal polls store no snapshot.
--   polls / poll_options            RLS on, no policy (members read nothing directly), no client writes.
--   edit_message                    a poll is never editable (poll_not_editable).
--   delete_message                  deletes the polls row first; the cascades take its options, ballots and snapshot,
--                                   and the soft path turns the tombstone into kind 'text'.
--   delete_channel                  unchanged: polls cascade with the channel and with their messages.
-- No audit row is ever written for a poll or a vote.

-- ===== message / notification kinds =====
alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'alpha', 'system', 'bounty', 'poll'));

-- the list from 20261019400002 + poll_closed
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention', 'reply', 'channel_message',
  'invite_redeemed', 'godchild_banned', 'sponsor_penalized',
  'report_new', 'member_review',
  'ticket_new', 'ticket_reply', 'ticket_status',
  'tip_received', 'bounty_solution', 'bounty_paid',
  'treasury_mismatch', 'treasury_outflow',
  'withdrawal_approved', 'withdrawal_rejected', 'withdrawal_paid', 'withdrawal_expired', 'treasury_notice',
  'raffle_won',
  'poll_closed'
));

-- ===== polls =====
create table public.polls (
  message_id uuid primary key references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id uuid not null references public.members (id),
  chain_id int not null check (chain_id in (59144, 59141)),
  weight_mode text not null check (weight_mode in ('equal', 'linear', 'quadratic')),
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  voter_count int check (voter_count is null or voter_count >= 0),
  weighted_voter_count int check (weighted_voter_count is null or weighted_voter_count >= 0),
  results_published boolean,
  constraint polls_finalized_coherent check (
    (finalized_at is null and voter_count is null and weighted_voter_count is null and results_published is null)
    or (finalized_at is not null and voter_count is not null and weighted_voter_count is not null
        and results_published is not null))
);
create index polls_due_idx on public.polls (closes_at) where finalized_at is null;
create index polls_channel_idx on public.polls (channel_id);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (message_id) on delete cascade,
  position smallint not null check (position between 1 and 10),
  label text not null check (label = btrim(label) and char_length(label) between 1 and 80),
  result_tenths int check (result_tenths is null or result_tenths between 0 and 1000),
  unique (poll_id, position)
);
create unique index poll_options_label_uidx on public.poll_options (poll_id, lower(label));

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
-- members may only select (RLS without a policy returns nothing); every write goes through definer RPCs
revoke all on public.polls, public.poll_options from public, anon, authenticated;
grant select on public.polls, public.poll_options to authenticated;

-- ===== private: weight snapshots and ballots =====
create table private.poll_weight_snapshots (
  poll_id uuid not null references public.polls (message_id) on delete cascade,
  member_id uuid not null references public.members (id),
  weight numeric(78, 0) not null check (weight > 0),
  primary key (poll_id, member_id)
);

create table private.poll_votes (
  poll_id uuid not null references public.polls (message_id) on delete cascade,
  member_id uuid not null references public.members (id),
  -- null once sealed at finalize (Task 3): no member-to-option link survives the close
  option_id uuid references public.poll_options (id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (poll_id, member_id)
);
create index poll_votes_option_idx on private.poll_votes (option_id) where option_id is not null;
create index poll_votes_member_idx on private.poll_votes (member_id);
create index poll_weight_snapshots_member_idx on private.poll_weight_snapshots (member_id);

alter table private.poll_weight_snapshots enable row level security;
alter table private.poll_votes enable row level security;
revoke all on private.poll_weight_snapshots, private.poll_votes from public, anon, authenticated, service_role;

-- ===== _isqrt: exact integer square root (floor) =====
create function public._isqrt(p numeric)
returns numeric
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  r numeric;
begin
  if p < 0 then
    raise exception 'invalid_input';
  end if;
  r := floor(sqrt(p));
  -- sqrt on numeric is rounded: correct by whole steps until r^2 <= p < (r + 1)^2
  while r * r > p loop
    r := r - 1;
  end loop;
  while (r + 1) * (r + 1) <= p loop
    r := r + 1;
  end loop;
  return r;
end;
$$;

-- ===== create_poll =====
create function public.create_poll(
  p_channel uuid, p_question text, p_options text[], p_closes_at timestamptz, p_weight_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_question text;
  v_options text[] := '{}';
  v_opt text;
  v_label text;
  v_chain_text text;
  v_chain int;
  v_body jsonb;
  v_id uuid;
begin
  if v_me is null or not public.is_active_member() or p_channel is null then
    raise exception 'forbidden';
  end if;
  -- CREATE_POLLS 131072 and SEND_MESSAGES 2 (the core also checks VIEW and the channel kind)
  if (public.channel_permissions(v_me, p_channel) & 131074) <> 131074 then
    raise exception 'forbidden';
  end if;

  -- whitespace runs (newlines included) collapse to one space, then trim
  v_question := btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'));
  if char_length(v_question) not between 1 and 300 then
    raise exception 'question_required';
  end if;

  if p_options is null or array_ndims(p_options) is distinct from 1 or cardinality(p_options) not between 2 and 10 then
    raise exception 'poll_options_invalid';
  end if;
  foreach v_opt in array p_options loop
    if v_opt is null then
      raise exception 'poll_options_invalid';
    end if;
    v_label := btrim(regexp_replace(v_opt, '\s+', ' ', 'g'));
    if char_length(v_label) not between 1 and 80
       or exists (select 1 from unnest(v_options) x where lower(x) = lower(v_label)) then
      raise exception 'poll_options_invalid';
    end if;
    v_options := v_options || v_label;
  end loop;

  if p_weight_mode is null or p_weight_mode not in ('equal', 'linear', 'quadratic') then
    raise exception 'invalid_input';
  end if;
  if p_closes_at is null or p_closes_at < now() + interval '1 hour' or p_closes_at > now() + interval '30 days' then
    raise exception 'closes_at_invalid';
  end if;
  select c.value #>> '{}' into v_chain_text from public.app_config c where c.key = 'active_chain_id';
  if v_chain_text is null or v_chain_text !~ '^[0-9]{1,9}$' then
    raise exception 'chain_invalid';
  end if;
  v_chain := v_chain_text::int;
  if v_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;

  -- one paragraph holding the question as a single text node; same validation, slowmode and insert path as any
  -- root message (no thread, quote, attachments or alpha address)
  v_body := jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_question)))));
  v_id := public._post_message_core(v_me, p_channel, v_body, null, false, null, null, null, null);
  update public.messages set kind = 'poll' where id = v_id;

  insert into public.polls (message_id, channel_id, author_id, chain_id, weight_mode, closes_at)
  values (v_id, p_channel, v_me, v_chain, p_weight_mode, p_closes_at);
  insert into public.poll_options (poll_id, position, label)
  select v_id, o.ord, o.label from unnest(v_options) with ordinality as o(label, ord);

  -- spec 13: the weights are frozen now, over unlocked shares on the active chain, active members only, positive
  -- only; the club fund has no member row
  if p_weight_mode in ('linear', 'quadratic') then
    insert into private.poll_weight_snapshots (poll_id, member_id, weight)
    select v_id, w.member_id, w.weight
    from (
      select p.member_id,
             case when p_weight_mode = 'linear' then greatest(p.shares - p.locked_shares, 0)
                  else public._isqrt(greatest(p.shares - p.locked_shares, 0)) end as weight
      from public.dao_positions p
      join public.members m on m.id = p.member_id and m.status = 'active'
      where p.chain_id = v_chain
    ) w
    where w.weight > 0;
  end if;

  perform public._notify_message(v_id, false);
  return v_id;
end;
$$;

-- ===== edit_message (latest 20261018600001): a poll is never editable =====
create or replace function public.edit_message(p_id uuid, p_body jsonb, p_body_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
  v_msg public.messages;
  v_perms bigint;
  v_text text;
begin
  select * into v_msg from public.messages m where m.id = p_id for update;
  if v_actor is null or not found or v_msg.kind = 'system' or v_msg.author_id is distinct from v_actor
     or v_msg.deleted_at is not null then
    raise exception 'forbidden';
  end if;
  v_perms := public.channel_permissions(v_actor, v_msg.channel_id);
  if (v_perms & 1) = 0 or (v_perms & case when v_msg.thread_root_id is null then 2 else 4 end) = 0 then
    raise exception 'forbidden';
  end if;
  -- F4e: editing the question would change what others already voted on
  if v_msg.kind = 'poll' then
    raise exception 'poll_not_editable';
  end if;

  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception 'invalid_input';
  end if;
  if p_body ->> 'type' is distinct from 'doc' then
    raise exception 'invalid_input';
  end if;
  if octet_length(p_body::text) > 65536 then
    raise exception 'too_long';
  end if;
  v_text := public._doc_text(p_body);
  if char_length(v_text) > 20000 or (not v_msg.expanded and char_length(v_text) > 4000) then
    raise exception 'too_long';
  end if;
  if v_text = '' and not exists (
    select 1 from public.message_attachments a where a.message_id = p_id) then
    raise exception 'invalid_input';
  end if;

  update public.messages
  set body = p_body, body_text = v_text, allow_links = (v_perms & 2048) = 2048, edited_at = now()
  where id = p_id;

  delete from public.message_mentions where message_id = p_id;
  perform public._insert_mentions(p_id, p_body, v_perms);

  perform public._notify_message(p_id, true);
end;
$$;

-- ===== delete_message (latest 20261018800021): the poll, its options, ballots and snapshot go first =====
create or replace function public.delete_message(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_member_id();
  v_msg public.messages;
  v_root uuid;
  v_root_row public.messages;
  v_perms bigint;
  v_paths text[];
  v_soft boolean;
  v_bounty boolean;
begin
  select * into v_msg from public.messages m where m.id = p_id;
  if v_actor is null or not found then
    raise exception 'forbidden';
  end if;
  -- lock order: thread root first, then the message (post/delete of replies serialize on the root)
  v_root := coalesce(v_msg.thread_root_id, v_msg.id);
  select * into v_root_row from public.messages r where r.id = v_root for update;
  select * into v_msg from public.messages m where m.id = p_id for update;
  if not found then
    raise exception 'forbidden';
  end if;

  v_perms := public.channel_permissions(v_actor, v_msg.channel_id);
  -- a system notice (null author) can only be removed by a moderator (MANAGE_MESSAGES)
  if (v_perms & 1) = 0 or not (v_msg.author_id is not distinct from v_actor or (v_perms & 8) = 8) then
    raise exception 'forbidden';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'invalid_input';
  end if;
  -- F3-R6: the author cannot delete their own bounty while a marked solution is unpaid (it would keep its unpaid
  -- status with no way left to pay it). A moderator still can: the bounty then reads "removed".
  if v_msg.author_id is not distinct from v_actor and exists (
    select 1 from public.bounties b
    where b.message_id = p_id and b.solution_marked_at is not null and b.paid_at is null and b.cancelled_at is null
  ) then
    raise exception 'bounty_has_solution';
  end if;

  select coalesce(array_agg(a.storage_path order by a.storage_path), '{}') into v_paths
  from public.message_attachments a where a.message_id = p_id;

  if v_msg.author_id is distinct from v_actor then
    insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
    values (v_actor, 'message_deleted', 'message', p_id,
            jsonb_build_object('channel_id', v_msg.channel_id, 'author_id', v_msg.author_id));
  end if;

  -- F4e: a deleted poll leaves nothing behind; the cascades take its options, ballots and weight snapshot
  delete from public.polls where message_id = p_id;

  -- ruling F3c-R1: a bounty message and its marked solution are only ever soft-deleted, so the bounties row
  -- (FK on delete restrict) and its unpaid status survive
  v_bounty := exists (select 1 from public.bounties b where b.message_id = p_id or b.solution_message_id = p_id);
  v_soft := v_bounty
            or (v_msg.thread_root_id is null
                and exists (select 1 from public.messages r where r.thread_root_id = p_id));

  if v_soft then
    delete from public.message_attachments where message_id = p_id;
    delete from public.message_reactions where message_id = p_id;
    delete from public.message_mentions where message_id = p_id;
    delete from public.alpha_details where message_id = p_id;
    update public.messages
    set body = '{"type":"doc","content":[]}'::jsonb, body_text = '',
        kind = case when kind = 'bounty' then kind else 'text' end, pinned_at = null,
        pinned_by = null, deleted_at = now(), deleted_by = v_actor
    where id = p_id;
    return jsonb_build_object('hard', false, 'paths', to_jsonb(v_paths));
  end if;

  delete from public.messages where id = p_id;

  if v_msg.thread_root_id is not null then
    update public.messages
    set reply_count = greatest(reply_count - 1, 0),
        last_reply_at = (select max(r.created_at) from public.messages r where r.thread_root_id = v_root)
    where id = v_root;
    -- a tombstone whose last reply is gone has nothing left to hold
    if v_root_row.deleted_at is not null
       and not exists (select 1 from public.bounties b where b.message_id = v_root)
       and not exists (select 1 from public.messages r where r.thread_root_id = v_root) then
      delete from public.messages where id = v_root;
    end if;
  end if;
  return jsonb_build_object('hard', true, 'paths', to_jsonb(v_paths));
end;
$$;

-- ===== grants =====
revoke execute on function public._isqrt(numeric) from public, anon, authenticated, service_role;
revoke execute on function public.create_poll(uuid, text, text[], timestamptz, text) from public, anon;
grant execute on function public.create_poll(uuid, text, text[], timestamptz, text) to authenticated;
revoke execute on function public.edit_message(uuid, jsonb, text) from public, anon;
grant execute on function public.edit_message(uuid, jsonb, text) to authenticated;
revoke execute on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;
