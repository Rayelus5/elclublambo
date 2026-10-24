-- P0 Task 1: multi-network foundation (spec D2/D21; rulings P0-R1, P0-R3, P0-R14).
--   - public.chains is the list of networks and which ones are enabled (D2's "enabled_chain_ids" IS chains.enabled,
--     P0-R1). The four Base/Arbitrum networks start enabled in every DB (P0-R14); the build's network set decides
--     which ones the app uses. Linea stays as disabled rows so legacy rows keep a valid FK, and it can never be enabled.
--   - The live money tables (payment_intents, tips, onchain_transfers, bounties) swap their Linea checks for an FK to
--     chains (P0-R3). raffles, polls, alpha_details, chain_config and dao_* keep theirs until P1.
--   - members.receive_networks: the network keys a member accepts payments on (D22, P0-R7), never empty.
--   - Flags: legacy_dao_enabled = false pauses the on-chain DAO (P0-R2); min_fee_bps = 0 (no fee, P0-R5).

-- ===== chains =====
create table public.chains (
  chain_id int primary key,
  network text not null check (network in ('base', 'arbitrum', 'linea')),
  name text not null,
  testnet boolean not null,
  enabled boolean not null default false,
  safe_address text check (safe_address ~ '^0x[0-9a-f]{40}$')
);

insert into public.chains (chain_id, network, name, testnet, enabled, safe_address) values
  (8453, 'base', 'Base', false, true, '0x380f2e12081995359e2ab88e3c31c6b227904234'),
  (42161, 'arbitrum', 'Arbitrum', false, true, '0x380f2e12081995359e2ab88e3c31c6b227904234'),
  (84532, 'base', 'Base Sepolia', true, true, '0x380f2e12081995359e2ab88e3c31c6b227904234'),
  (421614, 'arbitrum', 'Arbitrum Sepolia', true, true, '0x380f2e12081995359e2ab88e3c31c6b227904234'),
  (59144, 'linea', 'Linea', false, false, null),
  (59141, 'linea', 'Linea Sepolia', true, false, null);

alter table public.chains enable row level security;
revoke all on public.chains from anon;
revoke insert, update, delete, truncate on public.chains from authenticated;
grant select on public.chains to authenticated;
create policy chains_select on public.chains
  for select to authenticated using (public.is_active_member());

-- ===== live tables: Linea checks -> FK to chains =====
-- The checks were named by Postgres, so they are found by definition.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.conrelid in ('public.payment_intents'::regclass, 'public.tips'::regclass,
                         'public.onchain_transfers'::regclass, 'public.bounties'::regclass)
      and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%59144%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end;
$$;

alter table public.payment_intents add foreign key (chain_id) references public.chains (chain_id);
alter table public.tips add foreign key (chain_id) references public.chains (chain_id);
alter table public.onchain_transfers add foreign key (chain_id) references public.chains (chain_id);
alter table public.bounties add foreign key (chain_id) references public.chains (chain_id);

-- ===== private.chain_enabled: the row exists and is enabled =====
create function private.chain_enabled(p_chain int)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.enabled from public.chains c where c.chain_id = p_chain), false)
$$;
revoke execute on function private.chain_enabled(int) from public, anon, authenticated, service_role;

-- ===== set_chain_enabled (SuperAdmin, audited; a Linea chain cannot be enabled) =====
create function public.set_chain_enabled(p_chain int, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_network text;
begin
  if v_me is null or not public.has_global_perm(512) then
    raise exception 'forbidden';
  end if;
  select c.network into v_network from public.chains c where c.chain_id = p_chain for update;
  if v_network is null or p_enabled is null or (v_network = 'linea' and p_enabled) then
    raise exception 'chain_invalid';
  end if;

  update public.chains set enabled = p_enabled where chain_id = p_chain;

  insert into public.audit_log (actor_member_id, action, payload)
  values (v_me, 'economy.chain_enabled', jsonb_build_object('chainId', p_chain, 'enabled', p_enabled));
end;
$$;

-- ===== members.receive_networks =====
alter table public.members
  add column receive_networks text[] not null default '{base,arbitrum}'
  check (cardinality(receive_networks) >= 1 and receive_networks <@ array['base', 'arbitrum']);

-- Stored in canonical order (base, arbitrum), so duplicates collapse.
create function public.set_receive_networks(p_networks text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_allowed constant text[] := array['base', 'arbitrum'];
  v_networks text[];
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  -- same bucket as update_profile, set_handle and set_avatar
  perform private.rate_limit(v_me::text, 'profile', 30, interval '1 hour');

  if p_networks is null or cardinality(p_networks) = 0 or array_position(p_networks, null) is not null
     or not (p_networks <@ v_allowed) then
    raise exception 'invalid_input';
  end if;
  v_networks := array(select k from unnest(v_allowed) with ordinality as a(k, n) where k = any (p_networks) order by n);

  update public.members set receive_networks = v_networks where id = v_me;
end;
$$;

create function public.receive_networks_of(p_member uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_networks text[];
begin
  if not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select m.receive_networks into v_networks from public.members m where m.id = p_member and m.status = 'active';
  if v_networks is null then
    raise exception 'not_found';
  end if;
  return v_networks;
end;
$$;

-- ===== flags =====
insert into public.app_config (key, value) values ('legacy_dao_enabled', 'false'::jsonb);
update public.app_config set value = '0'::jsonb where key = 'min_fee_bps';

-- ===== economy_config (latest 20261019400002) + enabledChainIds, networks, legacyDaoEnabled =====
-- enabledChainIds: base before arbitrum, mainnet before testnet, then chain_id. networks: every non-Linea chain.
create or replace function public.economy_config()
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
                 jsonb_build_object('safe', cc.safe_address, 'platform', cc.platform_wallet,
                                    'withdrawalsEnabled', cc.withdrawals_enabled,
                                    'weightedRafflesEnabled', cc.weighted_raffles_enabled)), '{}'::jsonb)
               from public.chain_config cc),
    'enabledChainIds', (select coalesce(jsonb_agg(n.chain_id order by n.network <> 'base', n.testnet, n.chain_id),
                                        '[]'::jsonb)
                        from public.chains n where n.enabled),
    'networks', (select coalesce(jsonb_object_agg(n.chain_id::text,
                   jsonb_build_object('enabled', n.enabled, 'safe', n.safe_address)), '{}'::jsonb)
                 from public.chains n where n.network <> 'linea'),
    'legacyDaoEnabled', coalesce((select c.value from public.app_config c where c.key = 'legacy_dao_enabled'),
                                 'false'::jsonb)
  );
end;
$$;

revoke execute on function
  public.set_chain_enabled(int, boolean),
  public.set_receive_networks(text[]),
  public.receive_networks_of(uuid)
from public, anon;

grant execute on function
  public.set_chain_enabled(int, boolean),
  public.set_receive_networks(text[]),
  public.receive_networks_of(uuid)
to authenticated;
