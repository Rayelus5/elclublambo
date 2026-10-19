-- F4e Task 3: secret votes changeable until the close, results only at the close with a 3-voter floor, sealed ballots
-- and voter notices.
--
--   _poll_tally(poll)    owner-only. Reads the private ballots and the creation snapshot: voterCount (all ballots),
--                        weightedVoterCount (ballots with weight > 0; every ballot weighs 1 in an equal poll) and,
--                        only when voterCount >= 3 and (equal or weightedVoterCount >= 3), the % per option as tenths
--                        rounded half-up: floor((2000 w + T) / (2 T)). Otherwise 'insufficient' and no number at all.
--                        Used on read and at finalize, so the two always agree.
--   cast_poll_vote       VIEW (bit 1) on the poll's channel and an active member at vote time; refused at or after
--                        closes_at or once finalized (checked under the poll row's share lock, which close_due_polls
--                        takes for update). cast / changed / same. Only a new voter broadcasts poll_changed (ids only);
--                        a change sends nothing. No audit row.
--   poll_details         open: the live voter count and only the caller's own option; closed: the tally (or the stored
--                        results once finalized), never anyone's option, never a weight, a total or a per-option count.
--   close_due_polls      service role. Freezes the tallies (tenths stored only when published), notifies the voters still
--                        active, seals the ballots (option_id := null), deletes the weight snapshot, sends poll_changed.
--   _push_build          poll_closed joins the message-notice checks, URL and excerpt (the question).
--   create_poll          carry of ruling F4e-R1 and the Task 2 review: one explicit whitespace set for the question and
--                        the options, and the bit check includes VIEW (131075) before any validation.

-- ===== create_poll (latest 20261019500002) =====
-- F4e-R1: whitespace = \s plus every space the JS \s class matches, listed explicitly so the result does not depend on
-- the database locale: U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
create or replace function public.create_poll(
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
  -- VIEW 1, SEND_MESSAGES 2 and CREATE_POLLS 131072 (the core also checks the channel kind)
  if (public.channel_permissions(v_me, p_channel) & 131075) <> 131075 then
    raise exception 'forbidden';
  end if;

  -- whitespace runs (newlines included) collapse to one space, then trim
  v_question := btrim(regexp_replace(coalesce(p_question, ''),
                                     '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'));
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
                                    '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'));
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

-- ===== _poll_tally (owner only) =====
create function public._poll_tally(p_poll uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_voters int;
  v_weighted int;
  v_total numeric;
  v_results jsonb;
begin
  select p.weight_mode into v_mode from public.polls p where p.message_id = p_poll;
  if not found then
    return null;
  end if;

  -- an equal poll weighs every ballot 1; a weighted one takes the creation snapshot, 0 for a member absent from it
  select count(*)::int, (count(*) filter (where b.w > 0))::int, coalesce(sum(b.w), 0)
    into v_voters, v_weighted, v_total
  from (
    select case when v_mode = 'equal' then 1::numeric else coalesce(s.weight, 0) end as w
    from private.poll_votes v
    left join private.poll_weight_snapshots s on s.poll_id = v.poll_id and s.member_id = v.member_id
    where v.poll_id = p_poll
  ) b;

  -- spec 14b: at least 3 voters, and at least 3 with weight in a weighted poll; otherwise no number at all
  if v_voters < 3 or (v_mode <> 'equal' and v_weighted < 3) or v_total <= 0 then
    return jsonb_build_object('voterCount', v_voters, 'weightedVoterCount', v_weighted,
                              'status', 'insufficient', 'results', null);
  end if;

  -- % per option rounded half-up to 1 decimal, as tenths 0-1000
  select jsonb_agg(jsonb_build_object('optionId', o.id,
                                      'tenths', floor((2000 * coalesce(w.w, 0) + v_total) / (2 * v_total))::int)
                   order by o.position)
    into v_results
  from public.poll_options o
  left join (
    select v.option_id, sum(case when v_mode = 'equal' then 1::numeric else coalesce(s.weight, 0) end) as w
    from private.poll_votes v
    left join private.poll_weight_snapshots s on s.poll_id = v.poll_id and s.member_id = v.member_id
    where v.poll_id = p_poll and v.option_id is not null
    group by v.option_id
  ) w on w.option_id = o.id
  where o.poll_id = p_poll;

  return jsonb_build_object('voterCount', v_voters, 'weightedVoterCount', v_weighted,
                            'status', 'published', 'results', v_results);
end;
$$;

-- ===== cast_poll_vote (member) =====
create function public.cast_poll_vote(p_poll uuid, p_option uuid)
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
  if now() >= p.closes_at or p.finalized_at is not null then
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

-- ===== poll_details (member) =====
create function public.poll_details(p_message_ids uuid[])
returns table (message_id uuid, weight_mode text, closes_at timestamptz, closed boolean, voter_count int,
               options jsonb, my_option_id uuid, i_voted boolean, my_has_weight boolean, results_status text,
               results jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select p.message_id,
         p.weight_mode,
         p.closes_at,
         c.closed,
         case when not c.closed then (select count(*)::int from private.poll_votes v where v.poll_id = p.message_id)
              when p.finalized_at is not null then p.voter_count
              else (t.tally ->> 'voterCount')::int end,
         (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'position', o.position) order by o.position)
          from public.poll_options o where o.poll_id = p.message_id),
         -- the caller's own option, and only while the poll is open
         case when not c.closed then mv.option_id end,
         mv.member_id is not null,
         case when not c.closed and p.weight_mode <> 'equal' then exists (
           select 1 from private.poll_weight_snapshots s where s.poll_id = p.message_id and s.member_id = mv_me.id) end,
         case when not c.closed then 'pending'
              when p.finalized_at is not null then case when p.results_published then 'published' else 'insufficient' end
              else t.tally ->> 'status' end,
         case when not c.closed then null
              when p.finalized_at is not null then case when p.results_published then (
                select jsonb_agg(jsonb_build_object('optionId', o.id, 'tenths', o.result_tenths) order by o.position)
                from public.poll_options o where o.poll_id = p.message_id) end
              else nullif(t.tally -> 'results', 'null'::jsonb) end
  from public.polls p
  join public.messages m on m.id = p.message_id and m.deleted_at is null
  cross join lateral (select now() >= p.closes_at or p.finalized_at is not null as closed) c
  cross join lateral (select public.current_member_id() as id) mv_me
  left join private.poll_votes mv on mv.poll_id = p.message_id and mv.member_id = mv_me.id
  cross join lateral (
    select case when c.closed and p.finalized_at is null then public._poll_tally(p.message_id) end as tally
  ) t
  where public.is_active_member()
    and p.message_id = any (p_message_ids)
    and p.channel_id in (select v.id from public.visible_channels() v)
$$;

-- ===== close_due_polls (service role) =====
-- Lock order: poll row (for update) -> its ballots. cast_poll_vote holds the poll row for share while it writes.
create function public.close_due_polls()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.polls;
  v_tally jsonb;
  v_published boolean;
  v_finalized int := 0;
begin
  for r in
    select * from public.polls x
    where x.closes_at <= now() and x.finalized_at is null
    order by x.closes_at, x.message_id
    for update
  loop
    v_tally := public._poll_tally(r.message_id);
    v_published := v_tally ->> 'status' = 'published';

    if v_published then
      update public.poll_options o
      set result_tenths = (e ->> 'tenths')::int
      from jsonb_array_elements(v_tally -> 'results') e
      where o.poll_id = r.message_id and o.id = (e ->> 'optionId')::uuid;
    end if;
    update public.polls
    set voter_count = (v_tally ->> 'voterCount')::int,
        weighted_voter_count = (v_tally ->> 'weightedVoterCount')::int,
        results_published = v_published,
        finalized_at = now()
    where message_id = r.message_id;

    -- one notice per voter still active. The (recipient, message) unique index allows one notice per message: the
    -- voter's earlier message notice about the poll itself (channel_message) is superseded by poll_closed.
    delete from public.notifications n
    using private.poll_votes v, public.members m
    where v.poll_id = r.message_id and m.id = v.member_id and m.status = 'active'
      and n.recipient_id = v.member_id and n.message_id = r.message_id
      and n.kind in ('mention', 'reply', 'channel_message');
    insert into public.notifications (recipient_id, kind, actor_id, channel_id, message_id, data)
    select v.member_id, 'poll_closed', null, r.channel_id, r.message_id, '{}'::jsonb
    from private.poll_votes v
    join public.members m on m.id = v.member_id and m.status = 'active'
    where v.poll_id = r.message_id
    on conflict (recipient_id, message_id) where message_id is not null do nothing;

    -- seal: from now on no member-to-option link exists anywhere
    update private.poll_votes set option_id = null where poll_id = r.message_id;
    delete from private.poll_weight_snapshots where poll_id = r.message_id;

    perform realtime.send(
      jsonb_build_object('id', r.message_id, 'channel_id', r.channel_id, 'thread_root_id', null),
      'poll_changed',
      'channel:' || r.channel_id::text,
      true
    );
    v_finalized := v_finalized + 1;
  end loop;

  return jsonb_build_object('finalized', v_finalized);
end;
$$;

create or replace function public._push_build(p_id bigint)
returns table (title text, body text, url text, tag text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  n public.notifications;
  v_perms bigint := 0;
  v_actor text;
  v_wallet text;
  v_channel text;
  v_subject text;
  v_phrase text;
  v_title text;
  v_url text;
  v_excerpt text;
  v_root text;
  v_asset text;
  v_raffle_title text;
begin
  select * into n from public.notifications x where x.id = p_id;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.members m where m.id = n.recipient_id and m.status = 'active') then
    return;
  end if;
  if n.kind in ('mention', 'reply', 'channel_message', 'poll_closed') and n.channel_id is null then
    return;
  end if;
  if n.channel_id is not null then
    v_perms := public.channel_permissions(n.recipient_id, n.channel_id);
    if (v_perms & 1) = 0 then
      return;
    end if;
  end if;
  if n.ticket_id is not null and not public._member_can_access_ticket(n.recipient_id, n.ticket_id) then
    return;
  end if;
  if n.kind = 'report_new' and (v_perms & 8) = 0 then
    return;
  end if;
  if n.kind = 'member_review' and (public.member_global_permissions(n.recipient_id) & (32 | 512)) = 0 then
    return;
  end if;
  if n.kind = 'treasury_mismatch' and (public.member_global_permissions(n.recipient_id) & (256 | 512)) = 0 then
    return;
  end if;
  if n.kind = 'treasury_outflow' and (public.member_global_permissions(n.recipient_id) & (256 | 512)) = 0 then
    return;
  end if;
  if n.kind = 'treasury_notice' and (public.member_global_permissions(n.recipient_id) & (256 | 512)) = 0 then
    return;
  end if;

  select coalesce('@' || a.handle::text,
                  '@' || nullif(btrim(regexp_replace(a.display_name, '[[:cntrl:]]+', ' ', 'g')), ''),
                  '@' || left(a.wallet_address, 6) || '…' || right(a.wallet_address, 4)),
         a.wallet_address
    into v_actor, v_wallet
  from public.members a where a.id = n.actor_id;
  v_actor := coalesce(v_actor, case when n.kind = 'tip_received' then 'Anónimo' else 'Alguien' end);

  if n.channel_id is not null then
    select btrim(regexp_replace(c.name, '[[:cntrl:]]+', ' ', 'g')) into v_channel
    from public.channels c where c.id = n.channel_id;
  end if;
  if n.ticket_id is not null then
    select btrim(regexp_replace(t.subject, '[[:cntrl:]]+', ' ', 'g')) into v_subject
    from public.tickets t where t.id = n.ticket_id;
  end if;

  v_url := '/notifications';
  if n.kind in ('mention', 'reply', 'channel_message', 'poll_closed') then
    v_url := '/c/' || n.channel_id::text;
    v_root := n.data ->> 'thread_root_id';
    if n.message_id is not null then
      -- jump to (and highlight) the exact message, like the in-app link (src/lib/notifications/queries.ts)
      v_url := v_url || '?m=' || n.message_id::text;
      if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_url := v_url || '&thread=' || v_root;
      end if;
      v_url := v_url || '&h=n' || n.id::text;
    elsif v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_url := v_url || '?thread=' || v_root;
    end if;
    select btrim(left(btrim(regexp_replace(m.body_text, '[[:space:][:cntrl:]]+', ' ', 'g')), 80)) into v_excerpt
    from public.messages m
    where m.id = n.message_id and m.channel_id = n.channel_id and m.deleted_at is null;
    v_excerpt := nullif(v_excerpt, '');
  elsif n.kind in ('tip_received', 'bounty_solution', 'bounty_paid') then
    if n.channel_id is not null then
      v_url := '/c/' || n.channel_id::text;
      v_root := n.data ->> 'threadRootId';
      if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_url := v_url || '?thread=' || v_root;
      end if;
    end if;
  elsif n.kind in ('invite_redeemed', 'godchild_banned', 'sponsor_penalized') then
    if v_wallet is not null then
      v_url := '/u/' || v_wallet;
    end if;
  elsif n.kind = 'report_new' then
    v_url := '/moderation/reports';
  elsif n.kind = 'member_review' then
    v_url := '/admin/members';
  elsif n.kind = 'treasury_mismatch' then
    v_url := '/dao';
  elsif n.kind = 'treasury_notice' and n.data ->> 'event' in ('raffle_drawn', 'raffle_unpaid') then
    v_url := '/dao/tesoreria#sorteos';
  elsif n.kind in ('treasury_outflow', 'treasury_notice') then
    v_url := '/dao/tesoreria'; -- ruling F4a-R1
  elsif n.kind in ('withdrawal_approved', 'withdrawal_rejected', 'withdrawal_paid', 'withdrawal_expired') then
    v_url := '/dao#retirada';
  elsif n.ticket_id is not null then
    v_url := '/tickets/' || n.ticket_id::text;
  end if;

  case n.kind
    when 'mention' then
      v_title := 'Nueva mención';
      v_phrase := v_actor || ' te mencionó en #' || coalesce(v_channel, '');
    when 'reply' then
      v_title := 'Nueva respuesta';
      v_phrase := v_actor || ' respondió en #' || coalesce(v_channel, '');
    when 'channel_message' then
      v_title := 'Nuevo mensaje';
      v_phrase := v_actor || ' publicó en #' || coalesce(v_channel, '');
    when 'poll_closed' then
      v_title := 'Encuesta cerrada';
      v_phrase := 'Ha cerrado la encuesta en la que votaste en #' || coalesce(v_channel, '');
    when 'tip_received' then
      v_title := 'Nueva propina';
      v_phrase := 'Has recibido una propina de ' || v_actor;
    when 'bounty_solution' then
      v_title := 'Solución elegida';
      v_phrase := v_actor || ' ha elegido tu respuesta como solución del bounty';
    when 'bounty_paid' then
      v_title := 'Bounty pagado';
      v_phrase := v_actor || ' te ha pagado el bounty';
    when 'invite_redeemed' then
      v_title := 'Invitación canjeada';
      v_phrase := v_actor || ' se unió con tu invitación';
    when 'godchild_banned' then
      v_title := 'Ahijado baneado';
      v_phrase := 'Tu ahijado ' || v_actor || ' ha sido baneado';
    when 'sponsor_penalized' then
      v_title := 'Penalización de padrino';
      v_phrase := 'Te han penalizado porque ' || v_actor || ' fue baneado';
    when 'report_new' then
      v_title := 'Nuevo reporte';
      v_phrase := v_actor || ' reportó un mensaje en #' || coalesce(v_channel, '');
    when 'member_review' then
      v_title := 'Miembro por revisar';
      v_phrase := v_actor || ' necesita revisión';
    when 'treasury_mismatch' then
      v_title := 'Descuadre en la tesorería';
      v_phrase := 'El saldo de la Safe no coincide con el registro de la DAO';
    when 'treasury_outflow' then
      v_asset := case when n.data ->> 'asset' in ('USDC', 'WETH', 'ETH') then n.data ->> 'asset' else null end;
      if v_asset is null or coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,60}$' then
        return;
      end if;
      v_title := 'Salida de la tesorería';
      -- WETH has 18 decimals like ETH: _format_token_amount knows only ETH (18) and USDC (6)
      v_phrase := public._format_token_amount((n.data ->> 'amount')::numeric, case when v_asset = 'USDC' then 'USDC' else 'ETH' end)
                  || ' ' || v_asset || ' salió de la Safe sin explicar';
    when 'withdrawal_approved' then
      if coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,60}$' then
        return;
      end if;
      v_title := 'Retirada aprobada';
      v_phrase := 'Tu retirada de ' || public._format_token_amount((n.data ->> 'amount')::numeric, 'USDC')
                  || ' USDC está aprobada. El tesorero la pagará desde la Safe.';
    when 'withdrawal_rejected' then
      v_title := 'Retirada rechazada';
      v_phrase := 'El tesorero rechazó tu retirada';
      v_excerpt := nullif(btrim(left(btrim(regexp_replace(coalesce(n.data ->> 'reason', ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 80)), '');
    when 'withdrawal_paid' then
      if coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,60}$' then
        return;
      end if;
      v_title := 'Retirada pagada';
      v_phrase := 'Has recibido ' || public._format_token_amount((n.data ->> 'amount')::numeric, 'USDC') || ' USDC de la tesorería.';
    when 'withdrawal_expired' then
      v_title := 'Aprobación caducada';
      v_phrase := 'Tu retirada no se pagó en 14 días y vuelve a estar pendiente de aprobación.';
    when 'treasury_notice' then
      v_title := 'Aviso de tesorería';
      v_phrase := case n.data ->> 'event'
                    when 'withdrawal_requested' then 'Hay una nueva solicitud de retirada.'
                    when 'approval_expired' then 'Una retirada aprobada caducó sin pagarse.'
                    when 'raffle_drawn' then 'Un sorteo tiene ganador: hay un premio que pagar.'
                    when 'raffle_unpaid' then 'Un premio de sorteo lleva 14 días sin pagarse.'
                  end;
      if v_phrase is null then
        return;
      end if;
    when 'raffle_won' then
      if coalesce(n.data ->> 'raffleId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or coalesce(n.data ->> 'amount', '') !~ '^[0-9]{1,78}$'
         or coalesce(n.data ->> 'token', '') not in ('USDC', 'WETH') then
        return;
      end if;
      v_url := '/dao/sorteos/' || (n.data ->> 'raffleId');
      v_raffle_title := btrim(left(btrim(regexp_replace(coalesce(n.data ->> 'title', ''), '[[:cntrl:]]+', ' ', 'g')), 60));
      v_title := 'Has ganado un sorteo';
      -- WETH has 18 decimals like ETH: _format_token_amount knows only ETH (18) and USDC (6)
      v_phrase := 'Premio: '
                  || public._format_token_amount((n.data ->> 'amount')::numeric,
                                                  case when n.data ->> 'token' = 'USDC' then 'USDC' else 'ETH' end)
                  || ' ' || (n.data ->> 'token') || ' en «' || v_raffle_title
                  || '». El tesorero te lo enviará desde la Safe.';
    when 'ticket_new' then
      v_title := 'Nuevo ticket';
      v_phrase := v_actor || ' abrió un ticket: ' || coalesce(v_subject, '');
    when 'ticket_reply' then
      v_title := 'Respuesta en un ticket';
      v_phrase := v_actor || ' escribió en el ticket: ' || coalesce(v_subject, '');
    when 'ticket_status' then
      if n.data ->> 'status' = 'closed' then
        v_title := 'Ticket cerrado';
        v_phrase := v_actor || ' cerró el ticket: ' || coalesce(v_subject, '');
      else
        v_title := 'Ticket reabierto';
        v_phrase := v_actor || ' reabrió el ticket: ' || coalesce(v_subject, '');
      end if;
    else
      return;
  end case;

  title := v_title;
  body := case when v_excerpt is not null then v_phrase || ': «' || v_excerpt || '»' else v_phrase end;
  url := v_url;
  tag := n.kind || ':' || coalesce(n.message_id::text, n.ticket_id::text, n.id::text);
  return next;
end;
$$;

-- ===== grants =====
revoke execute on function public.create_poll(uuid, text, text[], timestamptz, text) from public, anon;
grant execute on function public.create_poll(uuid, text, text[], timestamptz, text) to authenticated;
revoke execute on function public._poll_tally(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.cast_poll_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_poll_vote(uuid, uuid) to authenticated;
revoke execute on function public.poll_details(uuid[]) from public, anon;
grant execute on function public.poll_details(uuid[]) to authenticated;
revoke execute on function public.close_due_polls() from public, anon, authenticated;
grant execute on function public.close_due_polls() to service_role;
