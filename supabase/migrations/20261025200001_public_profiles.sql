-- P3 Task 2: ElClub Pay public profiles (P3-R3, D22, decision 12).
-- A public profile is independent of the club: its own alias, an optional display name, the networks it receives on, and
-- an opt-in "Miembro de ElClub." badge. The wallet is always the session wallet (auth_wallet_address()): set on insert and
-- refreshed on every update, so a profile can never point at an address its owner did not sign in with.
--   upsert_public_profile / my_public_profile   authenticated public accounts (a banned club member is not one)
--   public_profile_view / public_profile_by_address   service role only: public reads go through the server
--   released_aliases   an alias given up by a change is held for its previous owner for 30 days (closed table)
-- The reserved alias list must equal tests/fixtures/public-aliases.json (pinned by tests/unit/pay/public-aliases.test.ts).

create table public.public_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  alias extensions.citext not null unique check (alias::text ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  accept_networks text[] not null default '{base,arbitrum}'
    check (cardinality(accept_networks) >= 1 and accept_networks <@ '{base,arbitrum}'::text[]),
  show_member_badge boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index public_profiles_wallet_idx on public.public_profiles (wallet_address);

alter table public.public_profiles enable row level security;
revoke all on public.public_profiles from public, anon, authenticated;

-- An alias given up by a change stays held for its previous owner for 30 days (alias_held for anyone else), so an old
-- payment link cannot be taken over at once by another account. The previous owner may reclaim it at any time.
create table public.released_aliases (
  alias extensions.citext primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  released_at timestamptz not null default now()
);
alter table public.released_aliases enable row level security;
revoke all on public.released_aliases from public, anon, authenticated;

-- ===== my_public_profile (authenticated) =====
-- The owner's view of the profile; also what upsert_public_profile returns. Null without one.
create function public.my_public_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'alias', p.alias::text,
    'displayName', p.display_name,
    'address', p.wallet_address,
    'acceptNetworks', to_jsonb(p.accept_networks),
    'showMemberBadge', p.show_member_badge)
  from public.public_profiles p
  where p.user_id = auth.uid()
$$;

-- ===== upsert_public_profile (public account) =====
-- Alias: trimmed (ASCII whitespace) and validated as ASCII BEFORE lowercasing, like set_handle, so Unicode look-alikes
-- are never folded into an ASCII alias. An alias another account released less than 30 days ago is alias_held.
-- Display name (same rules as src/lib/pay/display-name.ts): null or '' = no name; any bidi control or zero-width
-- character (U+200B-U+200F, U+202A-U+202E, U+2066-U+2069, U+FEFF) is rejected; then a Unicode-whitespace trim (the
-- String#trim set), and the result must be 1..40 characters with no control characters (whitespace-only is rejected).
-- Networks: trimmed, lower-cased, deduped, ordered base then arbitrum; empty, null or unknown -> networks_invalid.
create function public.upsert_public_profile(
  p_alias text,
  p_display_name text,
  p_accept_networks text[],
  p_show_member_badge boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_wallet text;
  v_raw text;
  v_alias text;
  v_name text;
  v_old text;
  v_nets text[];
  -- the String#trim whitespace set, minus U+FEFF (rejected above as zero-width)
  v_ws constant text := '[\u0009-\u000d    -     　]';
  v_reserved constant text[] := array['admin', 'administrador', 'superadmin', 'elclub', 'el_club', 'sistema', 'system',
    'soporte', 'support', 'moderador', 'mod', 'staff', 'everyone', 'here', 'todos', 'anonimo', 'null', 'undefined',
    'pay', 'tx', 'tools', 'herramientas', 'start', 'donar', 'donate', 'en', 'es', 'elclubpay'];
begin
  if not public.is_public_account() then
    raise exception 'forbidden';
  end if;
  -- 30 per hour on the shared profile bucket, keyed by the auth user (a public account may have no membership)
  perform private.rate_limit('u:' || v_uid::text, 'profile', 30, interval '1 hour');
  v_wallet := public.auth_wallet_address();

  v_raw := regexp_replace(coalesce(p_alias, ''), '^[ \t\n\r]+|[ \t\n\r]+$', '', 'g');
  if v_raw !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'alias_invalid';
  end if;
  v_alias := translate(v_raw, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  if v_alias = any (v_reserved) then
    raise exception 'alias_reserved';
  end if;

  -- serialize on the aliases involved (sorted: no deadlock), so a release and a take of the same alias cannot interleave
  select p.alias::text into v_old from public.public_profiles p where p.user_id = v_uid for update;
  if v_old is not null and v_old <> v_alias then
    perform pg_advisory_xact_lock(hashtextextended('public_alias:' || least(v_old, v_alias), 0));
    perform pg_advisory_xact_lock(hashtextextended('public_alias:' || greatest(v_old, v_alias), 0));
  else
    perform pg_advisory_xact_lock(hashtextextended('public_alias:' || v_alias, 0));
  end if;
  if exists (select 1 from public.released_aliases r
             where r.alias = v_alias::extensions.citext and r.user_id <> v_uid
               and r.released_at > now() - interval '30 days') then
    raise exception 'alias_held';
  end if;

  if coalesce(p_display_name, '') = '' then
    v_name := null;
  else
    if p_display_name ~ '[​-‏‪-‮⁦-⁩﻿]' then
      raise exception 'display_name_invalid';
    end if;
    v_name := regexp_replace(p_display_name, '^' || v_ws || '+|' || v_ws || '+$', '', 'g');
    if char_length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]\u007f-\u009f]' then
      raise exception 'display_name_invalid';
    end if;
  end if;

  if p_accept_networks is null or cardinality(p_accept_networks) = 0
     or exists (select 1 from unnest(p_accept_networks) n
                where n is null or lower(btrim(n)) not in ('base', 'arbitrum')) then
    raise exception 'networks_invalid';
  end if;
  v_nets := array(
    select k.n from unnest(array['base', 'arbitrum']) with ordinality k(n, o)
    where k.n in (select lower(btrim(x)) from unnest(p_accept_networks) x)
    order by k.o);

  begin
    insert into public.public_profiles as pp (user_id, alias, display_name, wallet_address, accept_networks, show_member_badge)
    values (v_uid, v_alias, v_name, v_wallet, v_nets, coalesce(p_show_member_badge, false))
    on conflict (user_id) do update set
      alias = excluded.alias,
      display_name = excluded.display_name,
      wallet_address = excluded.wallet_address,
      accept_networks = excluded.accept_networks,
      show_member_badge = excluded.show_member_badge,
      updated_at = now();
  exception when unique_violation then
    raise exception 'alias_taken';
  end;

  -- the alias given up is held for this account; the alias now in use is no longer held for anyone
  if v_old is not null and v_old <> v_alias then
    insert into public.released_aliases (alias, user_id, released_at) values (v_old, v_uid, now())
    on conflict (alias) do update set user_id = excluded.user_id, released_at = excluded.released_at;
  end if;
  delete from public.released_aliases r where r.alias = v_alias::extensions.citext;
  return public.my_public_profile();
end;
$$;

-- ===== public_profile_view (service role) =====
-- p_target: an address (^0x[0-9a-fA-F]{40}$, matched lower-cased) or an alias (ASCII, case-insensitive).
-- Address without a profile -> every network, no alias. Unknown alias or invalid target -> null.
-- isMember only when the owner turned the badge on AND is an active club member.
create function public.public_profile_view(p_target text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target text := coalesce(p_target, '');
  v_address text;
  v_row public.public_profiles;
begin
  if v_target ~ '^0x[0-9a-fA-F]{40}$' then
    v_address := lower(v_target);
    select * into v_row from public.public_profiles p
    where p.wallet_address = v_address order by p.updated_at desc limit 1;
    if not found then
      return jsonb_build_object('alias', null, 'displayName', null, 'address', v_address,
        'acceptNetworks', jsonb_build_array('base', 'arbitrum'), 'isMember', false);
    end if;
  elsif v_target ~ '^[A-Za-z0-9_]{3,20}$' then
    select * into v_row from public.public_profiles p
    where p.alias = translate(v_target, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')::extensions.citext;
    if not found then
      return null;
    end if;
  else
    return null;
  end if;

  return jsonb_build_object(
    'alias', v_row.alias::text,
    'displayName', v_row.display_name,
    'address', v_row.wallet_address,
    'acceptNetworks', to_jsonb(v_row.accept_networks),
    'isMember', v_row.show_member_badge and exists (
      select 1 from public.members m where m.auth_user_id = v_row.user_id and m.status = 'active'));
end;
$$;

-- ===== public_profile_by_address (service role; the receipt names the recipient) =====
-- {alias, displayName} of the profile whose wallet is p_address, or null (no profile, invalid address).
create function public.public_profile_by_address(p_address text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('alias', p.alias::text, 'displayName', p.display_name)
  from public.public_profiles p
  where coalesce(p_address, '') ~ '^0x[0-9a-fA-F]{40}$' and p.wallet_address = lower(p_address)
  order by p.updated_at desc
  limit 1
$$;

-- ===== grants =====
revoke execute on function
  public.upsert_public_profile(text, text, text[], boolean),
  public.my_public_profile(),
  public.public_profile_view(text),
  public.public_profile_by_address(text)
from public, anon, authenticated, service_role;

grant execute on function
  public.upsert_public_profile(text, text, text[], boolean),
  public.my_public_profile()
to authenticated;

grant execute on function
  public.public_profile_view(text),
  public.public_profile_by_address(text)
to service_role;
