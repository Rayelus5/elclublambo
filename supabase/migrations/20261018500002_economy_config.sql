-- F3a Task 2: economy and network configuration. Per-chain Safe / platform addresses live in chain_config, the
-- active chain and the minimum fee in app_config. Only SuperAdmin (bit 512) can change them, through audited RPCs.

-- ===== chain_config =====
create table public.chain_config (
  chain_id int primary key check (chain_id in (59144, 59141)),
  safe_address text check (safe_address is null or safe_address ~ '^0x[0-9a-f]{40}$'),
  platform_wallet text check (platform_wallet is null or platform_wallet ~ '^0x[0-9a-f]{40}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members (id)
);

insert into public.chain_config (chain_id) values (59144), (59141);

alter table public.chain_config enable row level security;
revoke all on public.chain_config from anon;
revoke insert, update, delete, truncate on public.chain_config from authenticated;
grant select on public.chain_config to authenticated;
create policy chain_config_select on public.chain_config
  for select to authenticated using (public.is_active_member());

insert into public.app_config (key, value) values
  ('active_chain_id', '59141'::jsonb),
  ('min_fee_bps', '0'::jsonb);

-- ===== economy_config (invoker: RLS applies; explicit active-member check for a clean error) =====
create function public.economy_config()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'activeChainId', (select c.value from public.app_config c where c.key = 'active_chain_id'),
    'minFeeBps', (select c.value from public.app_config c where c.key = 'min_fee_bps'),
    'chains', (select coalesce(jsonb_object_agg(cc.chain_id::text,
                 jsonb_build_object('safe', cc.safe_address, 'platform', cc.platform_wallet)), '{}'::jsonb)
               from public.chain_config cc)
  );
end;
$$;

-- ===== set_active_chain =====
create function public.set_active_chain(p_chain int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_old jsonb;
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;

  select c.value into v_old from public.app_config c where c.key = 'active_chain_id' for update;
  update public.app_config set value = to_jsonb(p_chain) where key = 'active_chain_id';

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'economy.active_chain', jsonb_build_object('old', v_old, 'new', to_jsonb(p_chain)));
end;
$$;

-- ===== set_min_fee_bps =====
create function public.set_min_fee_bps(p_bps int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_old jsonb;
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_bps is null or p_bps < 0 or p_bps > 5000 then
    raise exception 'fee_out_of_range';
  end if;

  select c.value into v_old from public.app_config c where c.key = 'min_fee_bps' for update;
  update public.app_config set value = to_jsonb(p_bps) where key = 'min_fee_bps';

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'economy.min_fee', jsonb_build_object('old', v_old, 'new', to_jsonb(p_bps)));
end;
$$;

-- ===== set_chain_addresses =====
-- Replaces both addresses of a chain. Null or empty clears one; otherwise it is lowercased and must be a
-- well-formed, non-zero address.
create function public.set_chain_addresses(p_chain int, p_safe text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_safe text := nullif(lower(btrim(coalesce(p_safe, ''))), '');
  v_platform text := nullif(lower(btrim(coalesce(p_platform, ''))), '');
  v_old_safe text;
  v_old_platform text;
  v_zero constant text := '0x0000000000000000000000000000000000000000';
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  if p_chain is null or p_chain not in (59144, 59141) then
    raise exception 'chain_invalid';
  end if;
  if (v_safe is not null and (v_safe !~ '^0x[0-9a-f]{40}$' or v_safe = v_zero))
     or (v_platform is not null and (v_platform !~ '^0x[0-9a-f]{40}$' or v_platform = v_zero)) then
    raise exception 'address_invalid';
  end if;

  select c.safe_address, c.platform_wallet into v_old_safe, v_old_platform
  from public.chain_config c where c.chain_id = p_chain for update;

  update public.chain_config
  set safe_address = v_safe, platform_wallet = v_platform, updated_at = now(), updated_by = v_me
  where chain_id = p_chain;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'economy.addresses', jsonb_build_object(
    'chain', p_chain,
    'old', jsonb_build_object('safe', v_old_safe, 'platform', v_old_platform),
    'new', jsonb_build_object('safe', v_safe, 'platform', v_platform)));
end;
$$;

revoke execute on function
  public.economy_config(),
  public.set_active_chain(int),
  public.set_min_fee_bps(int),
  public.set_chain_addresses(int, text, text)
from public, anon;

grant execute on function
  public.economy_config(),
  public.set_active_chain(int),
  public.set_min_fee_bps(int),
  public.set_chain_addresses(int, text, text)
to authenticated;
