-- P1 Task 6: club Safe expenses, noted by hand by a treasurer (D9, P1-R7).
--   - public.club_expenses: one row per outgoing transfer of the Safe, with the treasurer's note. The server verifies
--     the hash before calling record_club_expense: a USDC Transfer log from the Safe ('usdc_log', log_index >= 0) or an
--     ETH execTransaction to the Safe ('safe_tx', log_index -1, amount as declared).
--   - record_club_expense (service_role): p_actor must hold MANAGE_TREASURY (256), checked through its member id
--     because service_role has no auth.uid().
--   - club_expenses_list (active member) and set_club_expense_note (256, audit_log 'expense_noted').
-- Amounts travel as text (numeric(78,0)).

create table public.club_expenses (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null references public.chains (chain_id),
  token text not null check (token in ('USDC', 'ETH')),
  amount numeric(78, 0) not null check (amount > 0),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index int not null,
  note text not null check (char_length(note) between 1 and 280),
  recorded_by uuid not null references public.members (id),
  recorded_at timestamptz not null default now(),
  verified_kind text not null check (verified_kind in ('usdc_log', 'safe_tx')),
  unique (chain_id, tx_hash, log_index)
);
create index club_expenses_recorded_idx on public.club_expenses (recorded_at desc);

alter table public.club_expenses enable row level security;
revoke all on public.club_expenses from anon, authenticated;

-- ===== record_club_expense =====
create function public.record_club_expense(
  p_chain int, p_token text, p_amount numeric, p_tx_hash text, p_log_index int, p_note text, p_verified_kind text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := btrim(coalesce(p_note, ''));
  v_id uuid;
begin
  if p_actor is null
     or not exists (select 1 from public.members m where m.id = p_actor and m.status = 'active')
     or (public.member_global_permissions(p_actor) & 256) <> 256 then
    raise exception 'forbidden';
  end if;
  if p_token is null or p_token not in ('USDC', 'ETH')
     or p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount)
     or p_tx_hash is null or p_tx_hash !~ '^0x[0-9a-f]{64}$'
     or p_log_index is null
     or p_verified_kind is distinct from case p_token when 'ETH' then 'safe_tx' else 'usdc_log' end
     or (p_token = 'ETH' and p_log_index <> -1)
     or (p_token = 'USDC' and p_log_index < 0)
     or char_length(v_note) not between 1 and 280 then
    raise exception 'invalid_input';
  end if;
  if not exists (select 1 from public.chains c where c.chain_id = p_chain) then
    raise exception 'chain_invalid';
  end if;

  begin
    insert into public.club_expenses (chain_id, token, amount, tx_hash, log_index, note, recorded_by, verified_kind)
    values (p_chain, p_token, p_amount, p_tx_hash, p_log_index, v_note, p_actor, p_verified_kind)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'tx_already_used';
  end;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (p_actor, 'expense_recorded', 'club_expense', v_id,
          jsonb_build_object('chainId', p_chain, 'token', p_token, 'amount', p_amount::text, 'txHash', p_tx_hash));
  return v_id;
end;
$$;

-- ===== club_expenses_list =====
create function public.club_expenses_list(p_limit int default 30)
returns table (id uuid, chain_id int, token text, amount text, tx_hash text, note text, recorded_at timestamptz,
               recorder_label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lim int := greatest(1, least(100, coalesce(p_limit, 30)));
begin
  if public.current_member_id() is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  return query
  select e.id, e.chain_id, e.token, e.amount::text, e.tx_hash, e.note, e.recorded_at, public._member_label(e.recorded_by)
  from public.club_expenses e
  order by e.recorded_at desc, e.id
  limit v_lim;
end;
$$;

-- ===== set_club_expense_note =====
create function public.set_club_expense_note(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_me is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  if char_length(v_note) not between 1 and 280 then
    raise exception 'invalid_input';
  end if;
  update public.club_expenses set note = v_note where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_me, 'expense_noted', 'club_expense', p_id, '{}'::jsonb);
end;
$$;

-- ===== grants =====
revoke execute on function
  public.record_club_expense(int, text, numeric, text, int, text, text, uuid),
  public.club_expenses_list(int),
  public.set_club_expense_note(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function public.club_expenses_list(int), public.set_club_expense_note(uuid, text) to authenticated;
grant execute on function public.record_club_expense(int, text, numeric, text, int, text, text, uuid) to service_role;
