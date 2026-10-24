-- P2 Task 4: public giveaways for any wallet account (free, equal weight, drand quicknet exactly as P1).
--
-- Why own tables (P2-R3): the public identity is auth.users, not members, so public_giveaways* never join club data
-- and no club query can mix club and public rows (D15). The club giveaways (20261024200006) are not touched; their
-- `scope` column stays unused. _giveaway_target_round and _keccak256 are reused as they are.
-- Why entering goes through the server (P2-R6): enter_public_giveaway is service role only, so the "minimum number of
-- transactions" requirement (checked on-chain by the server before calling it) cannot be skipped with a direct RPC.
-- Limits (P2-R14): 5 creates per user per day (bucket public_giveaway_create), <= 10 open giveaways per host,
-- closes_at in [now + 10 min, now + 90 days], 1..10 prizes, <= 5000 entries, allowlist <= 2000 addresses,
-- min_tx_count 0..1000; entering is charged to bucket public_giveaway_entry 30 / 10 min (subject 'u:' || user id).
-- Banned club members can neither create nor enter (P2-R12). Prizes (P2-R5): crypto (USDC on an enabled network,
-- paid by the host straight to the winner; ElClub. holds no funds) or custom text; no role prizes outside the club.
--
--   public_giveaways / _prizes / _entries / _allowlist   RLS on, no API access; everything through definer RPCs.
--   private.public_giveaway_seeds                        the secret seed; only keccak256(seed) is published
--                                                        (seed_commit). Revealed at the draw / void (Task 5),
--                                                        deleted unrevealed on cancel. Not even service_role reads it.
--   create_public_giveaway (authenticated, public account)   cancel_public_giveaway (host)
--   enter_public_giveaway (service role)                     leave_public_giveaway (authenticated)
--   public_giveaway_view (service role)                      my_public_giveaways (authenticated, host's own)
-- Entry wallets are public by design (P2-R13): the view lists them; the participant is warned when entering.
-- Lock order: giveaway row -> entries / prizes.

-- ===== tables =====
create table public.public_giveaways (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users (id) on delete cascade,
  host_address text not null check (host_address ~ '^0x[0-9a-f]{40}$'),
  host_name text check (host_name is null
                        or (host_name = btrim(host_name, E' \t\n\r\f\v') and char_length(btrim(host_name)) between 1 and 60)),
  title text not null check (title = btrim(title, E' \t\n\r\f\v') and char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) between 1 and 500),
  closes_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed', 'drawn', 'void', 'cancelled')),
  min_tx_count int not null default 0 check (min_tx_count between 0 and 1000),
  has_allowlist boolean not null default false,
  seed_commit text not null check (seed_commit ~ '^0x[0-9a-f]{64}$'),
  seed_reveal text check (seed_reveal is null or seed_reveal ~ '^0x[0-9a-f]{64}$'),
  target_round bigint not null check (target_round >= 1),
  drand_signature text check (drand_signature is null or drand_signature ~ '^[0-9a-f]{96}$'),
  drand_randomness text check (drand_randomness is null or drand_randomness ~ '^[0-9a-f]{64}$'),
  entry_count int check (entry_count is null or entry_count >= 0),
  drawn_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint public_giveaways_reveal_coherent check ((seed_reveal is not null) = (status in ('drawn', 'void'))),
  constraint public_giveaways_drawn_coherent check (
    (status = 'drawn') = (drawn_at is not null)
    and (status <> 'drawn' or (drand_signature is not null and drand_randomness is not null))),
  constraint public_giveaways_cancel_coherent check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint public_giveaways_count_coherent check (status not in ('closed', 'drawn', 'void') or entry_count is not null)
);
create index public_giveaways_status_idx on public.public_giveaways (status, closes_at);
create index public_giveaways_host_idx on public.public_giveaways (host_user_id, status);

create table public.public_giveaway_prizes (
  id uuid primary key default gen_random_uuid(),
  giveaway_id uuid not null references public.public_giveaways (id) on delete cascade,
  rank int not null check (rank between 1 and 10),
  kind text not null check (kind in ('crypto', 'custom')),
  chain_id int references public.chains (chain_id),
  token text check (token is null or token = 'USDC'),
  amount numeric(78, 0) check (amount is null or amount > 0),
  label text not null check (char_length(label) between 1 and 120),
  -- no FK: the winner row survives the winner's account (winner_address keeps the public record)
  winner_user_id uuid,
  winner_address text check (winner_address is null or winner_address ~ '^0x[0-9a-f]{40}$'),
  winner_position int check (winner_position is null or winner_position >= 1),
  status text not null default 'pending' check (status in ('pending', 'awarded', 'unawarded', 'paid', 'delivered')),
  unawarded_reason text check (unawarded_reason is null or unawarded_reason in ('not_enough_entries')),
  payout_tx_hash text check (payout_tx_hash is null or payout_tx_hash ~ '^0x[0-9a-f]{64}$'),
  payout_log_index int check (payout_log_index is null or payout_log_index >= 0),
  paid_at timestamptz,
  delivered_at timestamptz,
  unique (giveaway_id, rank),
  unique (chain_id, payout_tx_hash, payout_log_index),
  constraint public_giveaway_prizes_kind_coherent check (
    (kind = 'crypto' and chain_id is not null and token is not null and amount is not null)
    or (kind = 'custom' and chain_id is null and token is null and amount is null)),
  constraint public_giveaway_prizes_unawarded_coherent check ((status = 'unawarded') = (unawarded_reason is not null)),
  constraint public_giveaway_prizes_winner_coherent check (
    (winner_user_id is null) = (status in ('pending', 'unawarded'))
    and (winner_user_id is null) = (winner_position is null)
    and (winner_user_id is null) = (winner_address is null)),
  constraint public_giveaway_prizes_paid_coherent check (
    (status = 'paid') = (paid_at is not null)
    and (status = 'paid') = (payout_tx_hash is not null)
    and (payout_tx_hash is null) = (payout_log_index is null)
    and (status <> 'paid' or kind = 'crypto')),
  constraint public_giveaway_prizes_delivered_coherent check (
    (status = 'delivered') = (delivered_at is not null)
    and (status <> 'delivered' or kind = 'custom'))
);

create table public.public_giveaway_entries (
  giveaway_id uuid not null references public.public_giveaways (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  entered_at timestamptz not null default clock_timestamp(),
  position int check (position is null or position >= 1),
  primary key (giveaway_id, user_id),
  unique (giveaway_id, wallet_address)
);
create index public_giveaway_entries_user_idx on public.public_giveaway_entries (user_id);

create table public.public_giveaway_allowlist (
  giveaway_id uuid not null references public.public_giveaways (id) on delete cascade,
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  primary key (giveaway_id, address)
);

alter table public.public_giveaways enable row level security;
alter table public.public_giveaway_prizes enable row level security;
alter table public.public_giveaway_entries enable row level security;
alter table public.public_giveaway_allowlist enable row level security;
revoke all on public.public_giveaways, public.public_giveaway_prizes, public.public_giveaway_entries,
  public.public_giveaway_allowlist from public, anon, authenticated;

create table private.public_giveaway_seeds (
  giveaway_id uuid primary key references public.public_giveaways (id) on delete cascade,
  seed bytea not null check (octet_length(seed) = 32)
);
alter table private.public_giveaway_seeds enable row level security;
revoke all on private.public_giveaway_seeds from public, anon, authenticated, service_role;

-- ===== create_public_giveaway (public account) =====
-- p_prizes: [{kind, label?, chainId?, amount?, token?}], rank = array order. crypto: chainId (enabled network), amount
-- (USDC base units, string or integer, > 0), token absent or 'USDC'; the label defaults to '<amount> USDC'.
-- custom: label (1..120) only. p_allowlist: addresses, trimmed and lower-cased, deduped, <= 2000; empty or null = none.
-- The rate-limit upsert locks the host's counter row, so two creates of one host run one after the other and the
-- too_many_open count of the second sees the first.
create function public.create_public_giveaway(
  p_title text, p_description text, p_closes_at timestamptz, p_host_name text, p_min_tx_count int,
  p_allowlist text[], p_prizes jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_address text := public.auth_wallet_address();
  v_title text := btrim(coalesce(p_title, ''), E' \t\n\r\f\v');
  v_description text := nullif(btrim(coalesce(p_description, ''), E' \t\n\r\f\v'), '');
  v_host_name text := nullif(btrim(coalesce(p_host_name, ''), E' \t\n\r\f\v'), '');
  v_min_tx int := coalesce(p_min_tx_count, 0);
  v_allow text[];
  v_count int;
  v_prize jsonb;
  v_rank int;
  v_kind text;
  v_label text;
  v_chain int;
  v_amount numeric;
  v_seed bytea;
  v_commit text;
  v_id uuid;
begin
  if v_me is null or v_address is null or not public.is_public_account() then
    raise exception 'forbidden';
  end if;
  perform private.rate_limit('u:' || v_me::text, 'public_giveaway_create', 5, interval '1 day');

  if char_length(v_title) not between 1 and 80
     or (v_description is not null and char_length(v_description) > 500)
     or (v_host_name is not null and char_length(v_host_name) > 60)
     or v_min_tx not between 0 and 1000 then
    raise exception 'invalid_input';
  end if;
  if p_closes_at is null or not isfinite(p_closes_at)
     or p_closes_at < now() + interval '10 minutes' or p_closes_at > now() + interval '90 days' then
    raise exception 'invalid_input';
  end if;
  if p_prizes is null or jsonb_typeof(p_prizes) <> 'array' then
    raise exception 'invalid_input';
  end if;
  v_count := jsonb_array_length(p_prizes);
  if v_count not between 1 and 10 then
    raise exception 'invalid_input';
  end if;

  if exists (select 1 from unnest(coalesce(p_allowlist, '{}'::text[])) a(x)
             where a.x is null or lower(btrim(a.x)) !~ '^0x[0-9a-f]{40}$') then
    raise exception 'invalid_input';
  end if;
  select coalesce(array_agg(distinct lower(btrim(a.x))), '{}'::text[]) into v_allow
  from unnest(coalesce(p_allowlist, '{}'::text[])) a(x);
  if cardinality(v_allow) > 2000 then
    raise exception 'invalid_input';
  end if;

  if (select count(*) from public.public_giveaways g where g.host_user_id = v_me and g.status = 'open') >= 10 then
    raise exception 'too_many_open';
  end if;

  v_seed := extensions.gen_random_bytes(32);
  v_commit := '0x' || encode(public._keccak256(v_seed), 'hex');

  insert into public.public_giveaways (host_user_id, host_address, host_name, title, description, closes_at,
                                       min_tx_count, has_allowlist, seed_commit, target_round)
  values (v_me, v_address, v_host_name, v_title, v_description, p_closes_at,
          v_min_tx, cardinality(v_allow) > 0, v_commit, public._giveaway_target_round(p_closes_at))
  returning id into v_id;
  insert into private.public_giveaway_seeds (giveaway_id, seed) values (v_id, v_seed);
  insert into public.public_giveaway_allowlist (giveaway_id, address) select v_id, a.x from unnest(v_allow) a(x);

  for v_prize, v_rank in
    select e.value, e.ordinality::int from jsonb_array_elements(p_prizes) with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_prize) is distinct from 'object' or jsonb_typeof(v_prize -> 'kind') is distinct from 'string' then
      raise exception 'invalid_input';
    end if;
    v_kind := v_prize ->> 'kind';
    if v_prize ? 'label' and jsonb_typeof(v_prize -> 'label') not in ('string', 'null') then
      raise exception 'invalid_input';
    end if;
    v_label := nullif(btrim(coalesce(v_prize ->> 'label', ''), E' \t\n\r\f\v'), '');
    if v_label is not null and char_length(v_label) > 120 then
      raise exception 'invalid_input';
    end if;

    if v_kind = 'crypto' then
      if jsonb_typeof(v_prize -> 'chainId') is distinct from 'number'
         or (v_prize ->> 'chainId') !~ '^[0-9]{1,9}$'
         or jsonb_typeof(v_prize -> 'amount') not in ('string', 'number')
         or coalesce(v_prize ->> 'amount', '') !~ '^[0-9]{1,78}$'
         or (v_prize ? 'token' and (v_prize ->> 'token') is distinct from 'USDC') then
        raise exception 'invalid_input';
      end if;
      v_chain := (v_prize ->> 'chainId')::int;
      v_amount := (v_prize ->> 'amount')::numeric;
      if v_amount <= 0 then
        raise exception 'invalid_input';
      end if;
      if not private.chain_enabled(v_chain) then
        raise exception 'chain_invalid';
      end if;
      v_label := coalesce(v_label, public._format_token_amount(v_amount, 'USDC') || ' USDC');
      insert into public.public_giveaway_prizes (giveaway_id, rank, kind, chain_id, token, amount, label)
      values (v_id, v_rank, 'crypto', v_chain, 'USDC', v_amount, v_label);
    elsif v_kind = 'custom' then
      if v_prize ? 'chainId' or v_prize ? 'amount' or v_prize ? 'token' or v_label is null then
        raise exception 'invalid_input';
      end if;
      insert into public.public_giveaway_prizes (giveaway_id, rank, kind, label)
      values (v_id, v_rank, 'custom', v_label);
    else
      raise exception 'invalid_input';
    end if;
  end loop;

  return v_id;
end;
$$;

-- ===== cancel_public_giveaway (host): open and before closes_at only; the seed is deleted, never revealed =====
-- From closes_at on the entries are frozen and the round is public soon after: a cancel then would let the host void
-- a draw whose outcome they can already compute (invalid_state), as in P1.
create function public.cancel_public_giveaway(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  g public.public_giveaways;
begin
  if v_me is null then
    raise exception 'forbidden';
  end if;
  select * into g from public.public_giveaways x where x.id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if g.host_user_id <> v_me then
    raise exception 'forbidden';
  end if;
  if g.status <> 'open' or now() >= g.closes_at then
    raise exception 'invalid_state';
  end if;
  update public.public_giveaways set status = 'cancelled', cancelled_at = now() where id = g.id;
  delete from private.public_giveaway_seeds s where s.giveaway_id = g.id;
end;
$$;

-- ===== enter_public_giveaway (service role, after the server checked min_tx_count on-chain) =====
-- p_user: the session's auth user; p_wallet: that session's wallet, which must be one of p_user's web3 identities.
-- The giveaway row is taken FOR NO KEY UPDATE: entries of one giveaway run one at a time (exact 5000 cap) and the
-- close (Task 5, FOR UPDATE) either sees a committed entry or makes the next one wait and see giveaway_closed.
create function public.enter_public_giveaway(p_id uuid, p_user uuid, p_wallet text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet text := lower(btrim(coalesce(p_wallet, '')));
  v_rows int;
  g public.public_giveaways;
begin
  if p_id is null or p_user is null or v_wallet !~ '^0x[0-9a-f]{40}$' then
    raise exception 'invalid_input';
  end if;
  if exists (select 1 from public.members m where m.auth_user_id = p_user and m.status = 'banned')
     or not exists (select 1 from auth.identities i
                    where i.user_id = p_user and i.provider = 'web3'
                      and lower(i.identity_data -> 'custom_claims' ->> 'address') = v_wallet) then
    raise exception 'forbidden';
  end if;
  perform private.rate_limit('u:' || p_user::text, 'public_giveaway_entry', 30, interval '10 minutes');

  select * into g from public.public_giveaways x where x.id = p_id for no key update;
  if not found then
    raise exception 'not_found';
  end if;
  if g.status <> 'open' or now() >= g.closes_at then
    raise exception 'giveaway_closed';
  end if;
  if exists (select 1 from public.public_giveaway_entries e where e.giveaway_id = g.id and e.user_id = p_user) then
    return 'already';
  end if;
  if g.has_allowlist
     and not exists (select 1 from public.public_giveaway_allowlist a where a.giveaway_id = g.id and a.address = v_wallet) then
    raise exception 'not_allowed';
  end if;
  if (select count(*) from public.public_giveaway_entries e where e.giveaway_id = g.id) >= 5000 then
    raise exception 'giveaway_full';
  end if;

  -- clock_timestamp: entries made in one transaction still get their own order
  insert into public.public_giveaway_entries (giveaway_id, user_id, wallet_address, entered_at)
  values (g.id, p_user, v_wallet, clock_timestamp())
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'already';
  end if;
  return 'entered';
end;
$$;

-- ===== leave_public_giveaway (authenticated): own entry, open giveaway, before closes_at =====
create function public.leave_public_giveaway(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  g public.public_giveaways;
begin
  if v_me is null then
    raise exception 'forbidden';
  end if;
  select * into g from public.public_giveaways x where x.id = p_id for share;
  if not found then
    raise exception 'not_found';
  end if;
  if g.status <> 'open' or now() >= g.closes_at then
    raise exception 'giveaway_closed';
  end if;
  delete from public.public_giveaway_entries e where e.giveaway_id = g.id and e.user_id = v_me;
end;
$$;

-- ===== public_giveaway_view (service role): everything a visitor may see; null when it does not exist =====
-- entries: [{position, walletAddress}] by position once closed, by (entered_at, user_id) before. seedReveal stays null
-- until the draw or void (table check public_giveaways_reveal_coherent).
create function public.public_giveaway_view(p_id uuid, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.public_giveaways;
begin
  select * into g from public.public_giveaways x where x.id = p_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', g.id,
    'title', g.title,
    'description', g.description,
    'hostName', g.host_name,
    'hostAddress', g.host_address,
    'closesAt', g.closes_at,
    'status', g.status,
    'targetRound', g.target_round,
    'seedCommit', g.seed_commit,
    'seedReveal', g.seed_reveal,
    'drandSignature', g.drand_signature,
    'drandRandomness', g.drand_randomness,
    'entryCount', coalesce(g.entry_count,
                           (select count(*)::int from public.public_giveaway_entries e where e.giveaway_id = g.id)),
    'minTxCount', g.min_tx_count,
    'hasAllowlist', g.has_allowlist,
    'drawnAt', g.drawn_at,
    'cancelledAt', g.cancelled_at,
    'createdAt', g.created_at,
    'isHost', coalesce(g.host_user_id = p_viewer, false),
    'iEntered', exists (select 1 from public.public_giveaway_entries e
                        where e.giveaway_id = g.id and e.user_id = p_viewer),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('position', e.position, 'walletAddress', e.wallet_address)
                                          order by e.position nulls last, e.entered_at, e.user_id), '[]'::jsonb)
                from public.public_giveaway_entries e where e.giveaway_id = g.id),
    'prizes', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', p.id,
                 'rank', p.rank,
                 'kind', p.kind,
                 'chainId', p.chain_id,
                 'token', p.token,
                 'amount', p.amount::text,
                 'label', p.label,
                 'status', p.status,
                 'unawardedReason', p.unawarded_reason,
                 'winnerPosition', p.winner_position,
                 'winnerAddress', p.winner_address,
                 'payoutTxHash', p.payout_tx_hash,
                 'paidAt', p.paid_at,
                 'deliveredAt', p.delivered_at)
                 order by p.rank), '[]'::jsonb)
               from public.public_giveaway_prizes p where p.giveaway_id = g.id));
end;
$$;

-- ===== my_public_giveaways (authenticated): the host's own cards, open first, then newest =====
create function public.my_public_giveaways(p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(1, least(50, coalesce(p_limit, 20)));
begin
  if v_me is null then
    raise exception 'forbidden';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', x.id,
             'title', x.title,
             'status', x.status,
             'closesAt', x.closes_at,
             'entryCount', coalesce(x.entry_count,
                                    (select count(*)::int from public.public_giveaway_entries e where e.giveaway_id = x.id)),
             'prizeCount', (select count(*)::int from public.public_giveaway_prizes p where p.giveaway_id = x.id))
             order by x.ord), '[]'::jsonb)
    from (
      select g.*, row_number() over (order by (g.status = 'open') desc, g.created_at desc, g.id) as ord
      from public.public_giveaways g
      where g.host_user_id = v_me
      order by (g.status = 'open') desc, g.created_at desc, g.id
      limit v_limit
    ) x);
end;
$$;

-- ===== grants =====
revoke execute on function
  public.create_public_giveaway(text, text, timestamptz, text, int, text[], jsonb),
  public.cancel_public_giveaway(uuid),
  public.enter_public_giveaway(uuid, uuid, text),
  public.leave_public_giveaway(uuid),
  public.public_giveaway_view(uuid, uuid),
  public.my_public_giveaways(int)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_public_giveaway(text, text, timestamptz, text, int, text[], jsonb),
  public.cancel_public_giveaway(uuid),
  public.leave_public_giveaway(uuid),
  public.my_public_giveaways(int)
to authenticated;

grant execute on function
  public.enter_public_giveaway(uuid, uuid, text),
  public.public_giveaway_view(uuid, uuid)
to service_role;
