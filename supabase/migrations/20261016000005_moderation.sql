-- F1 moderation: ban (with optional sponsor-penalty cascade) and role assignment.
-- Hierarchy rule: an actor may only act on members strictly below their top role position.

create function public.ban_member(p_target uuid, p_reason text, p_penalize_sponsor boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_target public.members;
  v_reason text;
  v_sponsor uuid;
  v_penalize boolean := false;
  v_ban_id uuid;
begin
  v_actor := public.current_member_id();
  if v_actor is null or not public.is_active_member() or not public.has_global_perm(32) then
    raise exception 'forbidden';
  end if;

  v_reason := btrim(p_reason);
  if p_target is null or v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'invalid_input';
  end if;

  -- Lock the target so status/hierarchy checks and the cascade are atomic.
  select * into v_target from public.members m where m.id = p_target for update;
  if not found or v_target.status = 'banned' then
    raise exception 'invalid_input';
  end if;

  if v_target.id = v_actor
     or v_target.is_bootstrap
     or public.member_top_position(v_actor) <= public.member_top_position(v_target.id) then
    raise exception 'hierarchy';
  end if;

  v_sponsor := v_target.invited_by_member_id;
  -- Admins are never penalized.
  if coalesce(p_penalize_sponsor, false)
     and v_sponsor is not null
     and (public.member_global_permissions(v_sponsor) & 512) = 0 then
    v_penalize := true;
  end if;

  if v_penalize then
    -- deny wins over base roles, but allow is applied last: strip bit 16 from allow as well.
    insert into public.member_permission_overrides as o (member_id, allow, deny, reason, set_by)
    values (v_sponsor, 0, 16, 'sponsor_penalty', v_actor)
    on conflict (member_id) do update
      set deny = o.deny | 16,
          allow = o.allow & ~16::bigint,
          reason = 'sponsor_penalty',
          set_by = v_actor;

    update public.invites
       set revoked_at = now(), revoked_reason = 'sponsor_penalized'
     where created_by = v_sponsor and revoked_at is null;
  end if;

  update public.invites
     set revoked_at = now(), revoked_reason = 'member_banned'
   where created_by = v_target.id and revoked_at is null;

  update public.members
     set needs_review_since = now()
   where invited_by_member_id = v_target.id
     and status = 'active'
     and needs_review_since is null;

  update public.members set status = 'banned' where id = v_target.id;

  -- Kill live sessions (refresh_tokens and mfa claims cascade from sessions).
  delete from auth.sessions where user_id = v_target.auth_user_id;

  insert into public.bans (member_id, banned_by, reason, sponsor_member_id, sponsor_penalized)
  values (v_target.id, v_actor, v_reason, v_sponsor, v_penalize)
  returning id into v_ban_id;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'member_banned', 'member', v_target.id,
          jsonb_build_object('penalized_sponsor', v_penalize, 'sponsor_member_id', v_sponsor));

  return v_ban_id;
end;
$$;

create function public.set_member_role(p_member uuid, p_role uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_role public.roles;
  v_target public.members;
  v_actor_top int;
begin
  v_actor := public.current_member_id();
  if v_actor is null
     or not public.is_active_member()
     or not (public.has_global_perm(64) or public.has_global_perm(512)) then
    raise exception 'forbidden';
  end if;

  if p_member is null or p_role is null or p_enabled is null then
    raise exception 'invalid_input';
  end if;

  select * into v_role from public.roles r where r.id = p_role;
  if not found then
    raise exception 'invalid_input';
  end if;

  select * into v_target from public.members m where m.id = p_member for update;
  if not found then
    raise exception 'invalid_input';
  end if;

  if v_role.is_everyone or v_role.is_system then
    raise exception 'forbidden';
  end if;

  v_actor_top := public.member_top_position(v_actor);
  if v_role.position >= v_actor_top
     or public.member_top_position(v_target.id) >= v_actor_top then
    raise exception 'hierarchy';
  end if;

  if p_enabled then
    insert into public.member_roles (member_id, role_id)
    values (v_target.id, v_role.id)
    on conflict do nothing;
  else
    delete from public.member_roles where member_id = v_target.id and role_id = v_role.id;
  end if;

  insert into public.audit_log (actor_member_id, action, target_type, target_id, payload)
  values (v_actor, 'member_role_set', 'member', v_target.id,
          jsonb_build_object('role_id', v_role.id, 'enabled', p_enabled));
end;
$$;

revoke execute on function
  public.ban_member(uuid, text, boolean),
  public.set_member_role(uuid, uuid, boolean)
from public, anon;

grant execute on function
  public.ban_member(uuid, text, boolean),
  public.set_member_role(uuid, uuid, boolean)
to authenticated;
