-- F1 permission + membership helpers and read policies.
-- All helpers are SECURITY DEFINER (bypass RLS => policies calling them never recurse).

-- Hardening (before creating functions so they inherit it)
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
revoke truncate on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate on tables from authenticated;

-- Wallet of the current auth user (lowercase), from the web3 identity. Never from client input.
create function public.auth_wallet_address()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(i.identity_data->'custom_claims'->>'address')
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'web3'
  order by i.created_at
  limit 1
$$;

-- Current member id, any status.
create function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.members m where m.auth_user_id = auth.uid()
$$;

create function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.auth_user_id = auth.uid() and m.status = 'active'
  )
$$;

create function public.my_membership_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.status from public.members m where m.auth_user_id = auth.uid()),
    'none'
  )
$$;

-- Pure computation of effective global permissions (ignores member status).
create function public.member_global_permissions(p_member uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base bigint;
  v_allow bigint;
  v_deny bigint;
begin
  select coalesce(bit_or(r.permissions), 0)
    into v_base
  from public.roles r
  where r.is_everyone
     or r.id in (select mr.role_id from public.member_roles mr where mr.member_id = p_member);

  if (v_base & 512) <> 0 then
    return 1023;
  end if;

  select o.allow, o.deny
    into v_allow, v_deny
  from public.member_permission_overrides o
  where o.member_id = p_member;

  return (v_base & ~coalesce(v_deny, 0)) | coalesce(v_allow, 0);
end;
$$;

create function public.has_global_perm(p_bit bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_bit > 0 and coalesce(
    (select (public.member_global_permissions(m.id) & p_bit) = p_bit
     from public.members m
     where m.auth_user_id = auth.uid() and m.status = 'active'),
    false
  )
$$;

create function public.my_permissions()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.member_global_permissions(m.id)
     from public.members m
     where m.auth_user_id = auth.uid() and m.status = 'active'),
    0::bigint
  )
$$;

create function public.member_top_position(p_member uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(r.position), 0)
  from public.roles r
  where r.is_everyone
     or r.id in (select mr.role_id from public.member_roles mr where mr.member_id = p_member)
$$;

revoke execute on function
  public.auth_wallet_address(),
  public.current_member_id(),
  public.is_active_member(),
  public.my_membership_status(),
  public.member_global_permissions(uuid),
  public.has_global_perm(bigint),
  public.my_permissions(),
  public.member_top_position(uuid)
from public, anon;

grant execute on function
  public.auth_wallet_address(),
  public.current_member_id(),
  public.is_active_member(),
  public.my_membership_status(),
  public.member_global_permissions(uuid),
  public.has_global_perm(bigint),
  public.my_permissions(),
  public.member_top_position(uuid)
to authenticated;

-- Read policies
create policy members_select on public.members
  for select to authenticated using (public.is_active_member());
create policy roles_select on public.roles
  for select to authenticated using (public.is_active_member());
create policy member_roles_select on public.member_roles
  for select to authenticated using (public.is_active_member());
create policy app_config_select on public.app_config
  for select to authenticated using (public.is_active_member());

create policy bans_select on public.bans
  for select to authenticated using (public.has_global_perm(32));
create policy member_permission_overrides_select on public.member_permission_overrides
  for select to authenticated using (public.has_global_perm(32));
create policy audit_log_select on public.audit_log
  for select to authenticated using (public.has_global_perm(32));

-- Members may only edit their own profile fields.
revoke update on public.members from authenticated;
grant update (display_name, avatar_path) on public.members to authenticated;
create policy members_update_own on public.members
  for update to authenticated
  using (auth_user_id = auth.uid() and public.is_active_member())
  with check (auth_user_id = auth.uid() and public.is_active_member());
