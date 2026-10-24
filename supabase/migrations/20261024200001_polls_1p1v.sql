-- P1 Task 1: polls are one member = one vote. No weight modes, no network.
--   - create_poll(uuid, text, text[], timestamptz) replaces the 5-argument version (latest 20261019500003). It no
--     longer reads active_chain_id, asks for no chain and writes no private.poll_weight_snapshots row. It inserts
--     weight_mode = 'equal' and chain_id = null.
--   - polls.chain_id admits null (the Linea check is dropped, found by definition: Postgres named it).
--   - weight_mode stays: legacy rows keep their value and _poll_tally / poll_details / close_due_polls /
--     cast_poll_vote are untouched (they still read old linear / quadratic rows).

-- ===== polls.chain_id: nullable, no Linea check =====
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.polls'::regclass
      and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%59144%'
  loop
    execute format('alter table public.polls drop constraint %I', r.conname);
  end loop;
end;
$$;
alter table public.polls alter column chain_id drop not null;

-- ===== create_poll: four arguments =====
drop function public.create_poll(uuid, text, text[], timestamptz, text);

create function public.create_poll(
  p_channel uuid, p_question text, p_options text[], p_closes_at timestamptz
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
  v_body jsonb;
  v_id uuid;
begin
  if v_me is null or not public.is_active_member() or p_channel is null then
    raise exception 'forbidden';
  end if;
  -- VIEW 1, SEND_MESSAGES 2 and CREATE_POLLS 131072 (the core also checks the channel kind)
  if (public.channel_permissions(v_me, p_channel) & 131075) <> 131075 then
    raise exception 'forbidden';
  end if;

  -- whitespace runs (newlines included) collapse to one space, then trim; same explicit set as F4e-R1
  v_question := btrim(regexp_replace(coalesce(p_question, ''),
                                     '[\s   -     　﻿]+', ' ', 'g'));
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
    v_label := btrim(regexp_replace(v_opt,
                                    '[\s   -     　﻿]+', ' ', 'g'));
    if char_length(v_label) not between 1 and 80
       or exists (select 1 from unnest(v_options) x where lower(x) = lower(v_label)) then
      raise exception 'poll_options_invalid';
    end if;
    v_options := v_options || v_label;
  end loop;

  if p_closes_at is null or p_closes_at < now() + interval '1 hour' or p_closes_at > now() + interval '30 days' then
    raise exception 'closes_at_invalid';
  end if;

  -- one paragraph holding the question as a single text node; same validation, slowmode and insert path as any
  -- root message (no thread, quote, attachments or alpha address)
  v_body := jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_question)))));
  v_id := public._post_message_core(v_me, p_channel, v_body, null, false, null, null, null, null);
  update public.messages set kind = 'poll' where id = v_id;

  insert into public.polls (message_id, channel_id, author_id, chain_id, weight_mode, closes_at)
  values (v_id, p_channel, v_me, null, 'equal', p_closes_at);
  insert into public.poll_options (poll_id, position, label)
  select v_id, o.ord, o.label from unnest(v_options) with ordinality as o(label, ord);

  perform public._notify_message(v_id, false);
  return v_id;
end;
$$;

revoke execute on function public.create_poll(uuid, text, text[], timestamptz) from public, anon;
grant execute on function public.create_poll(uuid, text, text[], timestamptz) to authenticated;
