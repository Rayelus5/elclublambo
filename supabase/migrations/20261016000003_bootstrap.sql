-- F1 one-shot SuperAdmin bootstrap. Callable only by service_role (server-side).
-- The wallet is taken from the user's web3 identity; p_wallet is only compared against it.

create function public.bootstrap_super_admin(p_auth_user_id uuid, p_wallet text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity_wallet text;
  v_role_id uuid;
  v_existing public.members%rowtype;
  v_member_id uuid;
begin
  -- Serialize concurrent bootstraps.
  perform pg_advisory_xact_lock(hashtext('bootstrap_super_admin'));

  select lower(i.identity_data->'custom_claims'->>'address')
    into v_identity_wallet
  from auth.identities i
  where i.user_id = p_auth_user_id and i.provider = 'web3'
  order by i.created_at
  limit 1;

  if v_identity_wallet is null
     or p_wallet is null
     or v_identity_wallet <> lower(trim(p_wallet))
     or v_identity_wallet !~ '^0x[0-9a-f]{40}$' then
    raise exception 'wallet_mismatch';
  end if;

  select r.id into v_role_id
  from public.roles r
  where r.name = 'SuperAdmin' and r.is_system;

  if v_role_id is null then
    raise exception 'bootstrap_closed';
  end if;

  select * into v_existing
  from public.members m
  where m.auth_user_id = p_auth_user_id;

  if found then
    -- Idempotent only for the bootstrap member that still holds SuperAdmin.
    if v_existing.is_bootstrap
       and exists (
         select 1 from public.member_roles mr
         where mr.member_id = v_existing.id and mr.role_id = v_role_id
       ) then
      return v_existing.id;
    end if;
    raise exception 'bootstrap_closed';
  end if;

  if exists (select 1 from public.member_roles mr where mr.role_id = v_role_id) then
    raise exception 'bootstrap_closed';
  end if;

  insert into public.members (auth_user_id, wallet_address, is_bootstrap, status)
  values (p_auth_user_id, v_identity_wallet, true, 'active')
  returning id into v_member_id;

  insert into public.member_roles (member_id, role_id)
  values (v_member_id, v_role_id);

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_member_id, 'bootstrap_super_admin', 'member', v_member_id,
          jsonb_build_object('wallet', v_identity_wallet));

  return v_member_id;
end;
$$;

revoke execute on function public.bootstrap_super_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(uuid, text) to service_role;
