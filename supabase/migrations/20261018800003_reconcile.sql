-- F3d Task 3: reconciliation of the DAO ledger against the Safe's on-chain USDC balance.
-- record_reconciliation (service_role) stores one run and, when the balance differs from the ledger, notifies every
-- active member holding MANAGE_TREASURY (global bit 256). It never touches the ledger, positions or state.

-- ===== notification kind =====
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention', 'reply', 'channel_message',
  'invite_redeemed', 'godchild_banned', 'sponsor_penalized',
  'report_new', 'member_review',
  'ticket_new', 'ticket_reply', 'ticket_status',
  'tip_received', 'bounty_solution', 'bounty_paid',
  'treasury_mismatch'
));

-- ===== table (RLS on, no client access) =====
create table public.dao_reconciliations (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null check (chain_id in (59144, 59141)),
  ledger_value numeric(78, 0) not null check (ledger_value >= 0),
  onchain_balance numeric(78, 0) not null check (onchain_balance >= 0),
  diff numeric(78, 0) not null,
  ran_at timestamptz not null default now(),
  ran_by uuid references public.members (id),
  constraint dao_reconciliations_diff_coherent check (diff = onchain_balance - ledger_value)
);
create index dao_reconciliations_chain_idx on public.dao_reconciliations (chain_id, ran_at desc);
alter table public.dao_reconciliations enable row level security;
revoke all on public.dao_reconciliations from anon, authenticated;

-- ===== record_reconciliation (service_role) =====
create function public.record_reconciliation(p_chain int, p_ledger numeric, p_onchain numeric, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_diff numeric;
begin
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if p_ledger is null or p_onchain is null or p_ledger < 0 or p_onchain < 0
     or p_ledger <> trunc(p_ledger) or p_onchain <> trunc(p_onchain) then
    raise exception 'invalid_input';
  end if;
  if p_actor is not null and not exists (select 1 from public.members m where m.id = p_actor) then
    raise exception 'not_found';
  end if;

  v_diff := p_onchain - p_ledger;
  insert into public.dao_reconciliations (chain_id, ledger_value, onchain_balance, diff, ran_by)
  values (p_chain, p_ledger, p_onchain, v_diff, p_actor)
  returning id into v_id;

  if v_diff <> 0 then
    insert into public.notifications (recipient_id, kind, data)
    select m.id, 'treasury_mismatch',
           jsonb_build_object('chainId', p_chain, 'diff', v_diff::text, 'reconciliationId', v_id)
    from public.members m
    where m.status = 'active' and (public.member_global_permissions(m.id) & 256) <> 0;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.record_reconciliation(int, numeric, numeric, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_reconciliation(int, numeric, numeric, uuid) to service_role;

-- _push_build: identical to 20261018700002 plus treasury_mismatch (holders of MANAGE_TREASURY, link /dao).
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
    if v_root ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
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
