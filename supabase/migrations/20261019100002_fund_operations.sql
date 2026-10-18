-- F4a Task 2: the Safe's operations log (ERC-20 Transfer logs of USDC/WETH plus native-ETH changes), treasurer notes
-- and alerts for outflows nobody has explained.
--
-- record_safe_operations (service_role) stores the scanned operations idempotently, links USDC inflows to the donation
-- that caused them (dao_ledger.tx_hash), advances the scan cursor and notifies every active MANAGE_TREASURY holder once
-- per new outflow. dao_operations is the public feed: no counterparty, no donation inflows. A treasurer explains an
-- outflow with set_operation_note (<= 280 chars); inflows count as explained.

-- ===== notification kind =====
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention', 'reply', 'channel_message',
  'invite_redeemed', 'godchild_banned', 'sponsor_penalized',
  'report_new', 'member_review',
  'ticket_new', 'ticket_reply', 'ticket_status',
  'tip_received', 'bounty_solution', 'bounty_paid',
  'treasury_mismatch', 'treasury_outflow'
));

-- ===== tables (RLS on, no client access) =====
create table public.dao_scan_state (
  chain_id int primary key check (chain_id in (59144, 59141)),
  last_block bigint not null check (last_block >= 0)
);

create table public.dao_safe_operations (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null check (chain_id in (59144, 59141)),
  tx_hash text check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index int check (log_index is null or log_index >= 0),
  asset text not null check (asset in ('USDC', 'WETH', 'ETH')),
  direction text not null check (direction in ('in', 'out')),
  amount numeric(78, 0) not null check (amount > 0),
  counterparty text,
  block_number bigint not null check (block_number >= 0),
  occurred_at timestamptz not null,
  ledger_id uuid references public.dao_ledger (id),
  note text check (note is null or char_length(note) between 1 and 280),
  noted_by uuid references public.members (id),
  noted_at timestamptz,
  alerted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dao_safe_operations_hash_coherent check ((tx_hash is null) = (log_index is null))
);
-- ops with a hash: one per log; ETH ops without a hash: one per block and asset
create unique index dao_safe_operations_log_uidx on public.dao_safe_operations (chain_id, tx_hash, log_index, asset)
  where tx_hash is not null;
create unique index dao_safe_operations_eth_uidx on public.dao_safe_operations (chain_id, block_number, asset)
  where tx_hash is null;
create index dao_safe_operations_feed_idx on public.dao_safe_operations (chain_id, occurred_at desc, id);
create index dao_safe_operations_ledger_idx on public.dao_safe_operations (ledger_id) where ledger_id is not null;

alter table public.dao_scan_state enable row level security;
alter table public.dao_safe_operations enable row level security;
revoke all on public.dao_scan_state, public.dao_safe_operations from public, anon, authenticated;

-- ===== dao_scan_from (service_role) =====
create function public.dao_scan_from(p_chain int)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select s.last_block from public.dao_scan_state s where s.chain_id = p_chain
$$;

-- ===== record_safe_operations (service_role) =====
create function public.record_safe_operations(p_chain int, p_ops jsonb, p_to_block bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op jsonb;
  v_hash text;
  v_log int;
  v_asset text;
  v_dir text;
  v_amount numeric;
  v_block bigint;
  v_id uuid;
  v_ledger uuid;
  v_n int;
  v_inserted int := 0;
  v_alerts int := 0;
begin
  if p_chain not in (59144, 59141) or p_to_block is null or p_to_block < 0
     or p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'invalid_input';
  end if;

  for v_op in select e from jsonb_array_elements(p_ops) e loop
    v_hash := lower(nullif(v_op ->> 'txHash', ''));
    v_log := (v_op ->> 'logIndex')::int;
    v_asset := v_op ->> 'asset';
    v_dir := v_op ->> 'direction';
    v_amount := (v_op ->> 'amount')::numeric;
    v_block := (v_op ->> 'blockNumber')::bigint;
    if v_asset is null or v_asset not in ('USDC', 'WETH', 'ETH') or v_dir is null or v_dir not in ('in', 'out')
       or v_amount is null or v_amount <= 0 or v_block is null or (v_hash is null) <> (v_log is null) then
      raise exception 'invalid_input';
    end if;

    v_ledger := null;
    if v_asset = 'USDC' and v_dir = 'in' and v_hash is not null then
      select l.id into v_ledger from public.dao_ledger l where l.chain_id = p_chain and l.tx_hash = v_hash limit 1;
    end if;

    v_id := null;
    insert into public.dao_safe_operations
      (chain_id, tx_hash, log_index, asset, direction, amount, counterparty, block_number, occurred_at, ledger_id)
    values
      (p_chain, v_hash, v_log, v_asset, v_dir, v_amount, nullif(lower(v_op ->> 'counterparty'), ''), v_block,
       (v_op ->> 'occurredAt')::timestamptz, v_ledger)
    on conflict do nothing
    returning id into v_id;

    if v_id is not null then
      v_inserted := v_inserted + 1;
      if v_dir = 'out' then
        insert into public.notifications (recipient_id, kind, data)
        select m.id, 'treasury_outflow',
               jsonb_build_object('opId', v_id, 'asset', v_asset, 'amount', v_amount::text)
        from public.members m
        where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;
        get diagnostics v_n = row_count;
        v_alerts := v_alerts + v_n;
        update public.dao_safe_operations set alerted_at = clock_timestamp() where id = v_id;
      end if;
    end if;
  end loop;

  insert into public.dao_scan_state (chain_id, last_block) values (p_chain, p_to_block)
  on conflict (chain_id) do update set last_block = greatest(public.dao_scan_state.last_block, excluded.last_block);

  return jsonb_build_object('inserted', v_inserted, 'alerts', v_alerts);
end;
$$;

-- ===== set_operation_note (members with MANAGE_TREASURY) =====
create function public.set_operation_note(p_op uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_me is null or not public.is_active_member() or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  if char_length(v_note) < 1 or char_length(v_note) > 280 then
    raise exception 'invalid_input';
  end if;
  update public.dao_safe_operations
     set note = v_note, noted_by = v_me, noted_at = now()
   where id = p_op;
  if not found then
    raise exception 'invalid_input';
  end if;
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_me, 'operation_noted', 'dao_safe_operation', p_op, jsonb_build_object('length', char_length(v_note)));
end;
$$;

-- ===== dao_operations (members): the public feed, never the counterparty, never donation inflows =====
create function public.dao_operations(p_limit int default 30)
returns table (id uuid, asset text, direction text, amount text, tx_hash text, occurred_at timestamptz, note text, explained boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  return query
  select o.id, o.asset, o.direction, o.amount::text, o.tx_hash, o.occurred_at, o.note,
         (o.direction = 'in' or o.note is not null)
  from public.dao_safe_operations o
  where o.chain_id = (select (c.value #>> '{}')::int from public.app_config c where c.key = 'active_chain_id')
    and o.ledger_id is null
  order by o.occurred_at desc, o.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
end;
$$;

revoke execute on function public.dao_scan_from(int), public.record_safe_operations(int, jsonb, bigint),
  public.set_operation_note(uuid, text), public.dao_operations(int) from public, anon, authenticated, service_role;
grant execute on function public.dao_scan_from(int), public.record_safe_operations(int, jsonb, bigint) to service_role;
grant execute on function public.set_operation_note(uuid, text), public.dao_operations(int) to authenticated;

-- ===== _push_build: + treasury_outflow (copy of 20261019000009 with one gate, one url and one case branch) =====
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
begin
  select * into n from public.notifications x where x.id = p_id;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.members m where m.id = n.recipient_id and m.status = 'active') then
    return;
  end if;
  if n.kind in ('mention', 'reply', 'channel_message') and n.channel_id is null then
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
  if n.kind in ('mention', 'reply', 'channel_message') then
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
  elsif n.kind = 'treasury_outflow' then
    v_url := '/dao#operaciones'; -- ruling F4a-R1: /dao/tesoreria arrives with F4c
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
