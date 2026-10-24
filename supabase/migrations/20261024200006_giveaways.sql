-- P1 Task 8: free, equal-weight club giveaways drawn with drand quicknet, with USDC, role or text prizes (P1-R8,
-- P1-R9, P1-R10). New tables: the legacy raffles stay untouched (forty DAO functions read them).
--
--   giveaways / giveaway_prizes / giveaway_entries   RLS on, no client access; everything goes through definer RPCs.
--   private.giveaway_seeds                           the secret seed (32 bytes). Only keccak256(seed) is published
--                                                    (giveaways.seed_commit); it is revealed at the draw or on void and
--                                                    deleted, unrevealed, on cancel.
--   create_giveaway (bit 256)          1..10 prizes, closes_at in [now + 10 min, now + 30 days], target_round fixed at
--                                      creation: the first drand quicknet round emitted strictly after closes_at.
--   enter_giveaway / leave_giveaway    active member, open giveaway, before closes_at; bucket raffle_entry 30 / 10 min.
--   close_due_giveaways (service)      positions 1..n by (entered_at, member_id) among ACTIVE members; 0 -> void.
--   draw_giveaway (service)            after TS fetched round target_round and verified its BLS signature; SQL checks
--                                      randomness = sha256(signature) by computing it, then runs the draw below.
--   record_giveaway_payout (service)   after TS verified the USDC Transfer from the Safe to winner_address.
--   mark_giveaway_prize_delivered      bit 256, custom prizes handed over by hand.
--   giveaways_list / giveaway_detail   active members.
--
-- ===== the draw (P1-R10); src/lib/giveaways/draw.ts mirrors it byte for byte, tests/fixtures/giveaway-draw.json pins it =====
--   seed       = the 32 raw bytes behind seed_reveal ('0x' || 64 hex)
--   randomness = sha256(signature bytes): 32 raw bytes (drand_randomness, 64 hex, no 0x)
--   entries    = the giveaway's entries with a position, ordered by position (1..n, assigned at close by
--                (entered_at, member_id) among active members): the list L = [p_1 .. p_n]
--   r_1        = keccak256(seed || randomness)      64 bytes in: seed first, randomness second; 32 bytes out
--   for k = 1 .. m (prizes by rank ascending):
--     if L is empty: prize k is 'unawarded' ('not_enough_entries')
--     else: i = uint256_be(r_k) mod len(L)      r_k read as an unsigned big-endian 256-bit integer; i is 0-based
--           prize k goes to L[i]; L[i] is removed (the remaining order is kept)
--     r_{k+1} = keccak256(r_k)                   the 32-byte digest itself is hashed, after every prize
--   The winners are a pure function of (seed, randomness, n, m): the expected winners of the fixture are 1-based
--   positions by rank. A role prize whose role is no longer allowed at the draw (P1-R9) still consumes its winner, so
--   that every later prize matches the public verifier; it is 'unawarded' ('role_unavailable') and grants nothing.
-- Lock order: giveaway row (for update / for share) -> prize rows.

-- ===== tables =====
create table public.giveaways (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'club' check (scope in ('club')),
  title text not null check (title = btrim(title, E' \t\n\r\f\v') and char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) between 1 and 500),
  closes_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed', 'drawn', 'void', 'cancelled')),
  seed_commit text not null check (seed_commit ~ '^0x[0-9a-f]{64}$'),
  seed_reveal text check (seed_reveal is null or seed_reveal ~ '^0x[0-9a-f]{64}$'),
  target_round bigint not null check (target_round >= 1),
  drand_signature text check (drand_signature is null or drand_signature ~ '^[0-9a-f]{96}$'),
  drand_randomness text check (drand_randomness is null or drand_randomness ~ '^[0-9a-f]{64}$'),
  entry_count int check (entry_count is null or entry_count >= 0),
  drawn_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 1 and 280),
  created_by uuid not null references public.members (id),
  created_at timestamptz not null default now(),
  constraint giveaways_reveal_coherent check ((seed_reveal is not null) = (status in ('drawn', 'void'))),
  constraint giveaways_drawn_coherent check (
    (status = 'drawn') = (drawn_at is not null)
    and (status <> 'drawn' or (drand_signature is not null and drand_randomness is not null))),
  constraint giveaways_cancel_coherent check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (status <> 'cancelled' or cancel_reason is not null)),
  constraint giveaways_count_coherent check (status not in ('closed', 'drawn', 'void') or entry_count is not null)
);
create index giveaways_status_idx on public.giveaways (status, closes_at);

create table public.giveaway_prizes (
  id uuid primary key default gen_random_uuid(),
  giveaway_id uuid not null references public.giveaways (id) on delete cascade,
  rank int not null check (rank between 1 and 10),
  kind text not null check (kind in ('crypto', 'role', 'custom')),
  chain_id int references public.chains (chain_id),
  token text check (token is null or token = 'USDC'),
  amount numeric(78, 0) check (amount is null or amount > 0),
  -- 'role' needs role_id when created (create_giveaway); a role deleted later leaves null and the draw says role_unavailable
  role_id uuid references public.roles (id) on delete set null,
  label text not null check (char_length(label) between 1 and 120),
  winner_member_id uuid references public.members (id),
  winner_address text check (winner_address is null or winner_address ~ '^0x[0-9a-f]{40}$'),
  winner_position int check (winner_position is null or winner_position >= 1),
  status text not null default 'pending' check (status in ('pending', 'awarded', 'unawarded', 'paid', 'delivered')),
  unawarded_reason text check (unawarded_reason is null or unawarded_reason in ('not_enough_entries', 'role_unavailable')),
  payout_tx_hash text check (payout_tx_hash is null or payout_tx_hash ~ '^0x[0-9a-f]{64}$'),
  payout_log_index int check (payout_log_index is null or payout_log_index >= 0),
  paid_at timestamptz,
  delivered_at timestamptz,
  unique (giveaway_id, rank),
  unique (chain_id, payout_tx_hash, payout_log_index),
  constraint giveaway_prizes_kind_coherent check (
    (kind = 'crypto' and chain_id is not null and token is not null and amount is not null and role_id is null)
    or (kind = 'role' and chain_id is null and token is null and amount is null)
    or (kind = 'custom' and chain_id is null and token is null and amount is null and role_id is null)),
  constraint giveaway_prizes_unawarded_coherent check ((status = 'unawarded') = (unawarded_reason is not null)),
  constraint giveaway_prizes_winner_coherent check (
    (winner_member_id is null) = (status = 'pending' or unawarded_reason is not distinct from 'not_enough_entries')
    and (winner_member_id is null) = (winner_position is null)),
  constraint giveaway_prizes_paid_coherent check (
    (status = 'paid') = (paid_at is not null)
    and (status = 'paid') = (payout_tx_hash is not null)
    and (payout_tx_hash is null) = (payout_log_index is null)
    and (status <> 'paid' or kind = 'crypto')),
  constraint giveaway_prizes_delivered_coherent check (
    (status = 'delivered') = (delivered_at is not null)
    and (status <> 'delivered' or kind in ('role', 'custom')))
);

create table public.giveaway_entries (
  giveaway_id uuid not null references public.giveaways (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  entered_at timestamptz not null default clock_timestamp(),
  position int check (position is null or position >= 1),
  primary key (giveaway_id, member_id)
);
create index giveaway_entries_member_idx on public.giveaway_entries (member_id);

alter table public.giveaways enable row level security;
alter table public.giveaway_prizes enable row level security;
alter table public.giveaway_entries enable row level security;
revoke all on public.giveaways, public.giveaway_prizes, public.giveaway_entries from public, anon, authenticated;

create table private.giveaway_seeds (
  giveaway_id uuid primary key references public.giveaways (id) on delete cascade,
  seed bytea not null check (length(seed) = 32)
);
alter table private.giveaway_seeds enable row level security;
revoke all on private.giveaway_seeds from public, anon, authenticated, service_role;

-- ===== notifications: giveaway_won (latest list 20261019600001) =====
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'mention', 'reply', 'channel_message',
  'invite_redeemed', 'godchild_banned', 'sponsor_penalized',
  'report_new', 'member_review',
  'ticket_new', 'ticket_reply', 'ticket_status',
  'tip_received', 'bounty_solution', 'bounty_paid',
  'treasury_outflow',
  'withdrawal_approved', 'withdrawal_rejected', 'withdrawal_paid', 'withdrawal_expired', 'treasury_notice',
  'raffle_won',
  'poll_closed',
  'giveaway_won'
));

-- ===== _giveaway_target_round: the first quicknet round emitted strictly after p_closes_at =====
-- Round r is emitted at genesis + (r - 1) * period, genesis 1692803367, period 3 s.
create function public._giveaway_target_round(p_closes_at timestamptz)
returns bigint
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select floor((extract(epoch from p_closes_at) - 1692803367) / 3)::bigint + 2
$$;

-- ===== _giveaway_role_ok: P1-R9 for a role prize, checked at creation and again at the draw =====
-- Not @everyone, not is_system, no system_key (Verificado, Padrino, Mecenas), permissions inside the member-safe mask
-- 207895 (also every channel overwrite's allow bits on the role), and the actor (active) is ADMINISTRATOR or strictly above the role (member_top_position, as set_member_role).
create function public._giveaway_role_ok(p_role uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select not r.is_everyone
       and not r.is_system
       and r.system_key is null
       and (r.permissions & ~207895::bigint) = 0
       -- a channel overwrite can widen a role too (e.g. MANAGE_MESSAGES in one channel): same mask
       and not exists (select 1 from public.permission_overwrites o
                       where o.target_type = 'role' and o.target_id = r.id and (o.allow & ~207895::bigint) <> 0)
       and exists (select 1 from public.members m where m.id = p_actor and m.status = 'active')
       and ((public.member_global_permissions(p_actor) & 512) <> 0
            or r.position < public.member_top_position(p_actor))
    from public.roles r
    where r.id = p_role), false)
$$;

-- ===== create_giveaway (bit 256) =====
-- p_prizes: [{kind, label?, chainId?, amount?, roleId?}], rank = array order. crypto: chainId (enabled network) and
-- amount (USDC base units, string or integer); the label defaults to '<amount> USDC'. role: roleId; the label defaults
-- to the role name. custom: label (1..120) only.
create function public.create_giveaway(p_title text, p_description text, p_closes_at timestamptz, p_prizes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_title text := btrim(coalesce(p_title, ''), E' \t\n\r\f\v');
  v_description text := nullif(btrim(coalesce(p_description, ''), E' \t\n\r\f\v'), '');
  v_count int;
  v_prize jsonb;
  v_rank int;
  v_kind text;
  v_label text;
  v_chain int;
  v_amount numeric;
  v_role public.roles;
  v_seed bytea;
  v_commit text;
  v_round bigint;
  v_id uuid;
begin
  if v_me is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  if char_length(v_title) not between 1 and 80
     or (v_description is not null and char_length(v_description) > 500) then
    raise exception 'invalid_input';
  end if;
  if p_closes_at is null or not isfinite(p_closes_at)
     or p_closes_at < now() + interval '10 minutes' or p_closes_at > now() + interval '30 days' then
    raise exception 'closes_at_invalid';
  end if;
  if p_prizes is null or jsonb_typeof(p_prizes) <> 'array' then
    raise exception 'invalid_input';
  end if;
  v_count := jsonb_array_length(p_prizes);
  if v_count not between 1 and 10 then
    raise exception 'invalid_input';
  end if;

  v_seed := extensions.gen_random_bytes(32);
  v_commit := '0x' || encode(public._keccak256(v_seed), 'hex');
  v_round := public._giveaway_target_round(p_closes_at);

  insert into public.giveaways (title, description, closes_at, seed_commit, target_round, created_by)
  values (v_title, v_description, p_closes_at, v_commit, v_round, v_me)
  returning id into v_id;
  insert into private.giveaway_seeds (giveaway_id, seed) values (v_id, v_seed);

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
         or v_prize ? 'roleId' then
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
      insert into public.giveaway_prizes (giveaway_id, rank, kind, chain_id, token, amount, label)
      values (v_id, v_rank, 'crypto', v_chain, 'USDC', v_amount, v_label);
    elsif v_kind = 'role' then
      if v_prize ? 'chainId' or v_prize ? 'amount'
         or jsonb_typeof(v_prize -> 'roleId') is distinct from 'string'
         or (v_prize ->> 'roleId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid_input';
      end if;
      select * into v_role from public.roles r where r.id = (v_prize ->> 'roleId')::uuid;
      if not found or not public._giveaway_role_ok(v_role.id, v_me) then
        raise exception 'role_not_allowed';
      end if;
      v_label := coalesce(v_label, left(v_role.name, 120));
      insert into public.giveaway_prizes (giveaway_id, rank, kind, role_id, label)
      values (v_id, v_rank, 'role', v_role.id, v_label);
    elsif v_kind = 'custom' then
      if v_prize ? 'chainId' or v_prize ? 'amount' or v_prize ? 'roleId' or v_label is null then
        raise exception 'invalid_input';
      end if;
      insert into public.giveaway_prizes (giveaway_id, rank, kind, label)
      values (v_id, v_rank, 'custom', v_label);
    else
      raise exception 'invalid_input';
    end if;
  end loop;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_me, 'giveaway_created', 'giveaway', v_id, jsonb_build_object(
    'giveaway', v_id, 'closesAt', p_closes_at, 'commit', v_commit, 'targetRound', v_round, 'prizes', v_count));

  return jsonb_build_object('id', v_id, 'commit', v_commit, 'targetRound', v_round);
end;
$$;

-- ===== cancel_giveaway (bit 256): open or closed only; the seed is deleted, never revealed =====
create function public.cancel_giveaway(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_reason text := btrim(coalesce(p_reason, ''), E' \t\n\r\f\v');
  g public.giveaways;
begin
  if v_me is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  if char_length(v_reason) not between 1 and 280 then
    raise exception 'invalid_input';
  end if;
  select * into g from public.giveaways x where x.id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if g.status not in ('open', 'closed') then
    raise exception 'invalid_state';
  end if;

  update public.giveaways set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason where id = g.id;
  delete from private.giveaway_seeds s where s.giveaway_id = g.id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_me, 'giveaway_cancelled', 'giveaway', g.id, jsonb_build_object('giveaway', g.id, 'reason', v_reason));
end;
$$;

-- ===== enter_giveaway / leave_giveaway (active member; open giveaway, before closes_at) =====
-- The giveaway row is read FOR SHARE: close_due_giveaways takes it FOR UPDATE, so an entry in flight either commits
-- before the positions are assigned or waits and then sees giveaway_closed.
create function public.enter_giveaway(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  g public.giveaways;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  perform private.rate_limit(v_me::text, 'raffle_entry', 30, interval '10 minutes');
  select * into g from public.giveaways x where x.id = p_id for share;
  if not found then
    raise exception 'not_found';
  end if;
  if g.status <> 'open' or now() >= g.closes_at then
    raise exception 'giveaway_closed';
  end if;
  -- clock_timestamp: entries made in one transaction still get their own order (positions by (entered_at, member_id))
  insert into public.giveaway_entries (giveaway_id, member_id, entered_at)
  values (g.id, v_me, clock_timestamp())
  on conflict (giveaway_id, member_id) do nothing;
end;
$$;

create function public.leave_giveaway(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  g public.giveaways;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  perform private.rate_limit(v_me::text, 'raffle_entry', 30, interval '10 minutes');
  select * into g from public.giveaways x where x.id = p_id for share;
  if not found then
    raise exception 'not_found';
  end if;
  if g.status <> 'open' or now() >= g.closes_at then
    raise exception 'giveaway_closed';
  end if;
  delete from public.giveaway_entries e where e.giveaway_id = g.id and e.member_id = v_me;
end;
$$;

-- ===== close_due_giveaways (service role, cron) =====
-- Each due giveaway, in id order and FOR UPDATE: positions 1..n by (entered_at, member_id) among the entries of
-- active members (the rest keep a null position and cannot win), entry_count = n. n = 0 -> void: the seed is
-- revealed (copied, then deleted) and every prize is unawarded ('not_enough_entries').
create function public.close_due_giveaways()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.giveaways;
  v_count int;
  v_seed text;
  v_closed int := 0;
  v_voided int := 0;
begin
  for g in
    select * from public.giveaways x
    where x.status = 'open' and x.closes_at <= now()
    order by x.id
    for update
  loop
    update public.giveaway_entries e set position = null where e.giveaway_id = g.id;
    update public.giveaway_entries e
    set position = o.pos
    from (select e2.member_id, row_number() over (order by e2.entered_at, e2.member_id)::int as pos
          from public.giveaway_entries e2
          join public.members m on m.id = e2.member_id
          where e2.giveaway_id = g.id and m.status = 'active') o
    where e.giveaway_id = g.id and e.member_id = o.member_id;
    select count(*)::int into v_count
    from public.giveaway_entries e where e.giveaway_id = g.id and e.position is not null;

    if v_count > 0 then
      update public.giveaways set status = 'closed', entry_count = v_count where id = g.id;
      insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
      values (null, 'giveaway_closed', 'giveaway', g.id, jsonb_build_object('giveaway', g.id, 'entries', v_count));
      v_closed := v_closed + 1;
    else
      select '0x' || encode(s.seed, 'hex') into v_seed from private.giveaway_seeds s where s.giveaway_id = g.id;
      if v_seed is null then
        raise exception 'invalid_state';
      end if;
      update public.giveaways set status = 'void', entry_count = 0, seed_reveal = v_seed where id = g.id;
      delete from private.giveaway_seeds s where s.giveaway_id = g.id;
      update public.giveaway_prizes p
      set status = 'unawarded', unawarded_reason = 'not_enough_entries'
      where p.giveaway_id = g.id;
      insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
      values (null, 'giveaway_voided', 'giveaway', g.id, jsonb_build_object('giveaway', g.id, 'entries', 0));
      v_voided := v_voided + 1;
    end if;
  end loop;

  return jsonb_build_object('closed', v_closed, 'voided', v_voided);
end;
$$;

-- ===== giveaways_awaiting_draw (service role): closed giveaways, earliest round first =====
create function public.giveaways_awaiting_draw()
returns table (id uuid, target_round bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.target_round from public.giveaways g
  where g.status = 'closed'
  order by g.target_round, g.id
$$;

-- ===== draw_giveaway (service role, after TS fetched the round and verified its BLS signature) =====
-- p_signature: the round's signature, 48 bytes as 96 hex (no 0x). randomness = sha256(signature) is computed here.
-- Idempotent: a drawn giveaway called again with the same round and signature -> 'already'.
create function public.draw_giveaway(p_id uuid, p_round bigint, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sig text := lower(coalesce(p_signature, ''));
  g public.giveaways;
  p public.giveaway_prizes;
  v_seed bytea;
  v_randomness bytea;
  v_r bytea;
  v_members uuid[];
  v_positions int[];
  v_n int;
  v_i int;
  v_winner uuid;
  v_pos int;
  v_wallet text;
  v_ok boolean;
  v_winners jsonb := '[]'::jsonb;
begin
  if p_id is null or p_round is null or p_round < 1 or v_sig !~ '^[0-9a-f]{96}$' then
    raise exception 'invalid_input';
  end if;
  select * into g from public.giveaways x where x.id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if g.status = 'drawn' then
    if g.target_round = p_round and g.drand_signature = v_sig then
      return jsonb_build_object('status', 'already');
    end if;
    raise exception 'invalid_state';
  end if;
  if p_round <> g.target_round then
    raise exception 'invalid_input';
  end if;
  if g.status <> 'closed' then
    raise exception 'invalid_state';
  end if;
  -- the round must already exist: genesis + (round - 1) * 3 s
  if now() < to_timestamp(1692803367 + (p_round - 1) * 3) then
    raise exception 'round_not_ready';
  end if;

  select s.seed into v_seed from private.giveaway_seeds s where s.giveaway_id = g.id;
  if v_seed is null then
    raise exception 'invalid_state';
  end if;
  select array_agg(e.member_id order by e.position), array_agg(e.position order by e.position)
    into v_members, v_positions
  from public.giveaway_entries e
  where e.giveaway_id = g.id and e.position is not null;
  -- a member hard-deleted after the close would shorten the list and break parity with the public verifier
  if v_members is null or cardinality(v_members) <> g.entry_count then
    raise exception 'invalid_state';
  end if;

  v_randomness := extensions.digest(decode(v_sig, 'hex'), 'sha256');
  v_r := public._keccak256(v_seed || v_randomness);

  for p in
    select * from public.giveaway_prizes x where x.giveaway_id = g.id order by x.rank for update
  loop
    v_n := coalesce(cardinality(v_members), 0);
    if v_n = 0 then
      update public.giveaway_prizes set status = 'unawarded', unawarded_reason = 'not_enough_entries' where id = p.id;
    else
      v_i := mod(public._uint256_be(v_r), v_n)::int;
      v_winner := v_members[v_i + 1];
      v_pos := v_positions[v_i + 1];
      v_members := v_members[1:v_i] || v_members[v_i + 2:v_n];
      v_positions := v_positions[1:v_i] || v_positions[v_i + 2:v_n];
      select lower(m.wallet_address) into v_wallet from public.members m where m.id = v_winner;
      v_winners := v_winners || jsonb_build_object('rank', p.rank, 'position', v_pos);

      v_ok := true;
      if p.kind = 'role' then
        v_ok := p.role_id is not null and public._giveaway_role_ok(p.role_id, g.created_by);
      end if;

      if not v_ok then
        update public.giveaway_prizes
        set status = 'unawarded', unawarded_reason = 'role_unavailable',
            winner_member_id = v_winner, winner_address = v_wallet, winner_position = v_pos
        where id = p.id;
      else
        if p.kind = 'role' then
          insert into public.member_roles (member_id, role_id) values (v_winner, p.role_id) on conflict do nothing;
          update public.giveaway_prizes
          set status = 'delivered', delivered_at = now(),
              winner_member_id = v_winner, winner_address = v_wallet, winner_position = v_pos
          where id = p.id;
        else
          update public.giveaway_prizes
          set status = 'awarded', winner_member_id = v_winner, winner_address = v_wallet, winner_position = v_pos
          where id = p.id;
        end if;
        insert into public.notifications (recipient_id, kind, data)
        values (v_winner, 'giveaway_won', jsonb_build_object('giveawayId', g.id, 'title', g.title, 'prizeLabel', p.label));
      end if;
    end if;
    v_r := public._keccak256(v_r);
  end loop;

  update public.giveaways
  set status = 'drawn',
      seed_reveal = '0x' || encode(v_seed, 'hex'),
      drand_signature = v_sig,
      drand_randomness = encode(v_randomness, 'hex'),
      drawn_at = now()
  where id = g.id;
  delete from private.giveaway_seeds s where s.giveaway_id = g.id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (null, 'giveaway_drawn', 'giveaway', g.id, jsonb_build_object(
    'giveaway', g.id, 'round', p_round, 'randomness', encode(v_randomness, 'hex'), 'winners', v_winners));

  return jsonb_build_object('status', 'drawn');
end;
$$;

-- ===== record_giveaway_payout (service role, after TS verified the USDC Transfer from the Safe) =====
-- p_payout {txHash, logIndex, blockNumber}. The (chain, hash, log) may not back a tip / bounty / donation intent
-- (onchain_transfers) nor another prize (tx_already_used). The same payout again on a paid prize -> 'already'.
create function public.record_giveaway_payout(p_prize uuid, p_payout jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.giveaway_prizes;
  v_hash text;
  v_log int;
  v_block bigint;
begin
  if p_actor is null
     or not exists (select 1 from public.members m where m.id = p_actor and m.status = 'active')
     or (public.member_global_permissions(p_actor) & 256) = 0 then
    raise exception 'forbidden';
  end if;
  if p_payout is null or jsonb_typeof(p_payout) <> 'object'
     or coalesce(p_payout ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$'
     or coalesce(p_payout ->> 'logIndex', '') !~ '^[0-9]{1,9}$'
     or coalesce(p_payout ->> 'blockNumber', '') !~ '^[0-9]{1,18}$' then
    raise exception 'invalid_input';
  end if;
  v_hash := lower(p_payout ->> 'txHash');
  v_log := (p_payout ->> 'logIndex')::int;
  v_block := (p_payout ->> 'blockNumber')::bigint;

  select * into p from public.giveaway_prizes x where x.id = p_prize for update;
  if not found then
    raise exception 'not_found';
  end if;
  if p.status = 'paid' and p.payout_tx_hash = v_hash and p.payout_log_index = v_log then
    return jsonb_build_object('status', 'already');
  end if;
  if p.kind <> 'crypto' or p.status <> 'awarded' then
    raise exception 'invalid_state';
  end if;
  if exists (select 1 from public.onchain_transfers t
             where t.chain_id = p.chain_id and t.tx_hash = v_hash and t.log_index = v_log)
     or exists (select 1 from public.giveaway_prizes o
                where o.chain_id = p.chain_id and o.payout_tx_hash = v_hash and o.payout_log_index = v_log) then
    raise exception 'tx_already_used';
  end if;

  begin
    update public.giveaway_prizes
    set status = 'paid', payout_tx_hash = v_hash, payout_log_index = v_log, paid_at = now()
    where id = p.id;
  exception when unique_violation then
    raise exception 'tx_already_used';
  end;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (p_actor, 'giveaway_prize_paid', 'giveaway', p.giveaway_id, jsonb_build_object(
    'giveaway', p.giveaway_id, 'prize', p.id, 'rank', p.rank, 'chainId', p.chain_id, 'amount', p.amount::text,
    'txHash', v_hash, 'logIndex', v_log, 'blockNumber', v_block));

  return jsonb_build_object('status', 'paid');
end;
$$;

-- ===== mark_giveaway_prize_delivered (bit 256): a custom prize handed over =====
create function public.mark_giveaway_prize_delivered(p_prize uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  p public.giveaway_prizes;
begin
  if v_me is null or not public.has_global_perm(256) then
    raise exception 'forbidden';
  end if;
  select * into p from public.giveaway_prizes x where x.id = p_prize for update;
  if not found then
    raise exception 'not_found';
  end if;
  if p.kind <> 'custom' or p.status <> 'awarded' then
    raise exception 'invalid_state';
  end if;
  update public.giveaway_prizes set status = 'delivered', delivered_at = now() where id = p.id;
  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_me, 'giveaway_prize_delivered', 'giveaway', p.giveaway_id, jsonb_build_object(
    'giveaway', p.giveaway_id, 'prize', p.id, 'rank', p.rank));
end;
$$;

-- ===== _giveaway_card (internal): the member-facing card of giveaway g for viewer p_me =====
-- winners: the prizes that went to someone (awarded, paid, delivered); a role_unavailable prize is not a win.
create function public._giveaway_card(g public.giveaways, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', g.id,
    'title', g.title,
    'closesAt', g.closes_at,
    'status', g.status,
    'entryCount', coalesce(g.entry_count,
                           (select count(*)::int from public.giveaway_entries e where e.giveaway_id = g.id)),
    'iEntered', exists (select 1 from public.giveaway_entries e where e.giveaway_id = g.id and e.member_id = p_me),
    'prizes', (select coalesce(jsonb_agg(jsonb_build_object(
                 'rank', p.rank, 'kind', p.kind, 'label', p.label, 'chainId', p.chain_id, 'amount', p.amount::text)
                 order by p.rank), '[]'::jsonb)
               from public.giveaway_prizes p where p.giveaway_id = g.id),
    'winners', (select coalesce(jsonb_agg(jsonb_build_object(
                  'rank', p.rank, 'label', public._member_label(p.winner_member_id), 'iWon', p.winner_member_id = p_me)
                  order by p.rank), '[]'::jsonb)
                from public.giveaway_prizes p
                where p.giveaway_id = g.id and p.status in ('awarded', 'paid', 'delivered')))
$$;

-- ===== giveaways_list (members): open / closed by closes_at, then up to p_limit ended ones, most recent first =====
create function public.giveaways_list(p_limit int default 30)
returns jsonb[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_limit int := greatest(1, least(100, coalesce(p_limit, 30)));
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  return (
    select coalesce(array_agg(public._giveaway_card(x.g, v_me) order by x.grp, x.ord), '{}'::jsonb[])
    from (
      (select a as g, 0 as grp, row_number() over (order by a.closes_at, a.id) as ord
       from public.giveaways a
       where a.status in ('open', 'closed'))
      union all
      (select b as g, 1 as grp,
              row_number() over (order by coalesce(b.drawn_at, b.cancelled_at, b.closes_at) desc, b.id) as ord
       from public.giveaways b
       where b.status not in ('open', 'closed')
       order by coalesce(b.drawn_at, b.cancelled_at, b.closes_at) desc, b.id
       limit v_limit)
    ) x);
end;
$$;

-- ===== giveaway_detail (members): the card, the draw inputs, the entries and every prize's state =====
-- entries: by position once closed, by (entered_at, member_id) before. winnerAddress only for treasurers and the winner.
create function public.giveaway_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_member_id();
  v_treasurer boolean;
  g public.giveaways;
begin
  if v_me is null or not public.is_active_member() then
    raise exception 'forbidden';
  end if;
  select * into g from public.giveaways x where x.id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
  v_treasurer := public.has_global_perm(256);

  return public._giveaway_card(g, v_me) || jsonb_build_object(
    'description', g.description,
    'commit', g.seed_commit,
    'seedReveal', g.seed_reveal,
    'targetRound', g.target_round,
    'drandSignature', g.drand_signature,
    'drandRandomness', g.drand_randomness,
    'drawnAt', g.drawn_at,
    'cancelReason', g.cancel_reason,
    'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                  'position', e.position, 'label', public._member_label(e.member_id), 'isMe', e.member_id = v_me)
                  order by e.position nulls last, e.entered_at, e.member_id), '[]'::jsonb)
                from public.giveaway_entries e where e.giveaway_id = g.id),
    'prizeStates', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', p.id,
                      'rank', p.rank,
                      'kind', p.kind,
                      'label', p.label,
                      'chainId', p.chain_id,
                      'token', p.token,
                      'amount', p.amount::text,
                      'status', p.status,
                      'unawardedReason', p.unawarded_reason,
                      'winnerPosition', p.winner_position,
                      'winnerLabel', public._member_label(p.winner_member_id),
                      'iWon', coalesce(p.winner_member_id = v_me, false),
                      'winnerAddress', case when v_treasurer or p.winner_member_id = v_me then p.winner_address end,
                      'payoutTxHash', p.payout_tx_hash,
                      'paidAt', p.paid_at,
                      'deliveredAt', p.delivered_at)
                      order by p.rank), '[]'::jsonb)
                    from public.giveaway_prizes p where p.giveaway_id = g.id));
end;
$$;

-- ===== _push_build (latest 20261019600001) + giveaway_won (url /sorteos/<id>) =====
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
  v_prize_label text;
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
      v_phrase := 'Se ha cerrado la encuesta en la que votaste en #' || coalesce(v_channel, '');
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
    when 'giveaway_won' then
      if coalesce(n.data ->> 'giveawayId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return;
      end if;
      v_url := '/sorteos/' || (n.data ->> 'giveawayId');
      v_raffle_title := btrim(left(btrim(regexp_replace(coalesce(n.data ->> 'title', ''), '[[:cntrl:]]+', ' ', 'g')), 60));
      v_prize_label := btrim(left(btrim(regexp_replace(coalesce(n.data ->> 'prizeLabel', ''), '[[:cntrl:]]+', ' ', 'g')), 60));
      v_title := 'Has ganado un sorteo';
      v_phrase := 'Has ganado «' || v_prize_label || '» en «' || v_raffle_title || '»';
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
revoke execute on function
  public._giveaway_target_round(timestamptz),
  public._giveaway_role_ok(uuid, uuid),
  public._giveaway_card(public.giveaways, uuid),
  public.create_giveaway(text, text, timestamptz, jsonb),
  public.cancel_giveaway(uuid, text),
  public.enter_giveaway(uuid),
  public.leave_giveaway(uuid),
  public.close_due_giveaways(),
  public.giveaways_awaiting_draw(),
  public.draw_giveaway(uuid, bigint, text),
  public.record_giveaway_payout(uuid, jsonb, uuid),
  public.mark_giveaway_prize_delivered(uuid),
  public.giveaways_list(int),
  public.giveaway_detail(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_giveaway(text, text, timestamptz, jsonb),
  public.cancel_giveaway(uuid, text),
  public.enter_giveaway(uuid),
  public.leave_giveaway(uuid),
  public.mark_giveaway_prize_delivered(uuid),
  public.giveaways_list(int),
  public.giveaway_detail(uuid)
to authenticated;

grant execute on function
  public.close_due_giveaways(),
  public.giveaways_awaiting_draw(),
  public.draw_giveaway(uuid, bigint, text),
  public.record_giveaway_payout(uuid, jsonb, uuid)
to service_role;
